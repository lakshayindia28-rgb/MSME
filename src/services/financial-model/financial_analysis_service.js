import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import OpenAI from 'openai';

import { ExtractionService } from './extraction_service.js';
import { OpenAIDocumentService } from './openai_document_service.js';
import { ComparisonService } from './comparison_service.js';
import { RatioEngine } from './ratio_engine.js';
import { RiskEngine } from './risk_engine.js';
import { SummaryEngine } from './summary_engine.js';
import { CompanyProfileService } from './company_profile_service.js';
import { AnalystFormatter } from './analyst_formatter.js';
import { FinancialReportPdfService } from './financial_report_pdf.js';
import { TrendAnalysisService } from './trend_analysis_service.js';
import { DataReliabilityService } from './data_reliability_service.js';
import { CalculationAuditService } from './calculation_audit_service.js';
import { DataConflictService } from './data_conflict_service.js';
import { explainDecisionCodes } from './decision_dictionary.js';
import { ConfidenceService } from './confidence_service.js';
import { CreditAdvisoryService } from './credit_advisory_service.js';

const FINANCIAL_FIELDS = [
  'revenue',
  'cogs',
  'gross_profit',
  'net_profit',
  'total_assets',
  'current_assets',
  'inventory',
  'receivables',
  'cash',
  'current_liabilities',
  'long_term_debt',
  'equity',
  'employee_expenses',
  'other_expenses'
];

async function writeTempPdf(buffer, prefix) {
  const filePath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export class FinancialAnalysisService {
  constructor({
    openaiClient,
    openaiModel = process.env.OPENAI_FINANCIAL_MODEL || 'gpt-4.1-mini',
    auditDir = path.resolve(process.cwd(), 'logs', 'financial-model')
  } = {}) {
    this.openai = openaiClient || (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null);
    this.model = openaiModel;
    this.auditDir = auditDir;

    this.extractionService = new ExtractionService({ openaiClient: this.openai, model: this.model });
    this.openaiDocumentService = new OpenAIDocumentService({ openaiClient: this.openai });
    this.comparisonService = new ComparisonService({ openaiClient: this.openai, model: this.model });
    this.ratioEngine = new RatioEngine();
    this.companyProfileService = new CompanyProfileService();
    this.riskEngine = new RiskEngine();
    this.summaryEngine = new SummaryEngine({ openaiClient: this.openai, model: this.model });
    this.analystFormatter = new AnalystFormatter();
    this.financialReportPdfService = new FinancialReportPdfService();
    this.trendAnalysisService = new TrendAnalysisService();
    this.dataReliabilityService = new DataReliabilityService();
    this.calculationAuditService = new CalculationAuditService();
    this.dataConflictService = new DataConflictService();
    this.confidenceService = new ConfidenceService();
    this.creditAdvisoryService = new CreditAdvisoryService();
  }

  async analyze({
    bankSubmittedPdfBuffer,
    vendorVerifiedPdfBuffer,
    tolerancePct = 0.5,
    previousYearFinancials = null,
    itrFinancials = null,
    companyName = null
  }) {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not configured. OpenAI API is required for this flow.');
    }

    const auditId = `fa_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    const tempFiles = [];
    const uploadedFileIds = [];

    let bankExtraction;
    let vendorExtraction;

    try {
      const [bankTempPath, vendorTempPath] = await Promise.all([
        writeTempPdf(bankSubmittedPdfBuffer, 'bank_submitted_pdf'),
        writeTempPdf(vendorVerifiedPdfBuffer, 'vendor_verified_pdf')
      ]);
      tempFiles.push(bankTempPath, vendorTempPath);

      const [bankFileId, vendorFileId] = await Promise.all([
        this.openaiDocumentService.uploadAndGetFileId(bankTempPath),
        this.openaiDocumentService.uploadAndGetFileId(vendorTempPath)
      ]);
      uploadedFileIds.push(bankFileId, vendorFileId);

      const [modelComparison, bankExtractResult, vendorExtractResult] = await Promise.all([
        this.comparisonService.compareDocumentsByFileId({
          bankFileId,
          vendorFileId
        }),
        this.extractionService.extractFinancialsFromFileId({
          fileId: bankFileId,
          sourceLabel: 'bank_submitted_pdf'
        }),
        this.extractionService.extractFinancialsFromFileId({
          fileId: vendorFileId,
          sourceLabel: 'vendor_verified_pdf'
        })
      ]);
      bankExtraction = bankExtractResult;
      vendorExtraction = vendorExtractResult;

      const resolvedCompanyName = this.resolveCompanyName({
        explicitCompanyName: companyName,
        preferred: vendorExtraction?.company_identifiers,
        fallback: bankExtraction?.company_identifiers,
        modelNarrative: modelComparison?.narrative
      });

      const authenticityCheck = this.comparisonService.compareAuthenticity({
        bankFinancials: bankExtraction.financials,
        vendorFinancials: vendorExtraction.financials,
        tolerancePct,
        tamperSignals: {
          bank_table_irregularity: bankExtraction.tamperSignals.table_irregularity,
          bank_manual_edit_indicator: bankExtraction.tamperSignals.manual_edit_indicator,
          vendor_table_irregularity: vendorExtraction.tamperSignals.table_irregularity,
          vendor_manual_edit_indicator: vendorExtraction.tamperSignals.manual_edit_indicator
        }
      });
      const riskScoreLabel = this.mapRiskScoreLabel(authenticityCheck.risk_score);

      const extractedFinancials = this.mergePreferredFinancials({
        preferred: vendorExtraction.financials,
        fallback: bankExtraction.financials
      });
      const financialsEvidence = this.mergePreferredEvidence({
        preferred: vendorExtraction.financials_evidence,
        fallback: bankExtraction.financials_evidence
      });
      this.applyDerivedFinancialFallbacks({
        financials: extractedFinancials,
        evidence: financialsEvidence
      });

      const ratios = this.ratioEngine.compute(extractedFinancials);
      const calculationAudit = this.calculationAuditService.build({
        financials: extractedFinancials,
        ratios
      });
      const previousRatios = previousYearFinancials ? this.ratioEngine.compute(previousYearFinancials) : null;

      const trendAnalysis = this.trendAnalysisService.analyze({
        currentFinancials: extractedFinancials,
        previousFinancials: previousYearFinancials,
        currentRatios: ratios,
        previousRatios
      });

      const dataReliability = this.dataReliabilityService.assess({
        itrFinancials,
        extractedFinancials
      });
      const dataConflictAnalysis = this.dataConflictService.analyze({
        itrFinancials,
        extractedFinancials
      });

      const companyProfile = this.companyProfileService.detect(extractedFinancials);
      const riskAssessment = this.riskEngine.evaluate({
        ratios,
        extractedFinancials,
        companyProfile,
        authenticityCheck,
        trendAnalysis,
        dataReliability
      });
      const decision = {
        decision: riskAssessment.final_decision || riskAssessment.decision,
        final_decision: riskAssessment.final_decision || riskAssessment.decision,
        decision_priority_reason: riskAssessment.decision_priority_reason || '',
        decision_explanation: riskAssessment.decision_explanation || '',
        grade: riskAssessment.grade,
        score: riskAssessment.score,
        reasons: riskAssessment.reasons,
        decision_reason_codes: riskAssessment.decision_reason_codes || []
      };
      const normalizedDecisionCodes = this.normalizeDecisionCodes({
        decisionReasonCodes: decision.decision_reason_codes,
        ratios,
        reliabilityLevel: dataReliability.reliability_level,
        authenticityStatus: authenticityCheck.authenticity_status
      });
      decision.decision_reason_codes = normalizedDecisionCodes;
      const decisionCodeExplanations = explainDecisionCodes(normalizedDecisionCodes);

      const confidence = this.confidenceService.compute({
        authenticityCheck,
        dataReliability,
        financialsEvidence,
        extractionConfidence: vendorExtraction?.confidence || bankExtraction?.confidence || {}
      });

      const aiExplanation = await this.summaryEngine.generate({
        companyName: resolvedCompanyName,
        authenticityCheck,
        extractedFinancials,
        ratios,
        riskAssessment,
        decision,
        companyProfile,
        trendAnalysis,
        dataReliability,
        confidence
      });

      const creditAdvisory = this.creditAdvisoryService.build({
        ratios,
        extractedFinancials,
        decision,
        riskAssessment,
        dataReliability
      });

      const analystSummary = this.analystFormatter.format({
        decision,
        companyProfile,
        extractedFinancials,
        ratios,
        riskAssessment,
        explanationSummary: aiExplanation,
        riskScoreLabel,
        confidenceReason: confidence.confidence_reason
      });

      const reportPdfPath = await this.financialReportPdfService.generate({
        auditId,
        companyName: resolvedCompanyName,
        decision,
        analystSummary,
        authenticityCheck,
        riskScoreLabel,
        companyProfile,
        extractedFinancials,
        previousYearFinancials,
        ratios,
        previousRatios,
        trendAnalysis,
        dataReliability,
        confidence,
        confidenceReason: confidence.confidence_reason,
        improvementSuggestions: creditAdvisory,
        creditAdvisory,
        financialsEvidence,
        calculationAudit,
        decisionCodeExplanations,
        accountingObservations: dataConflictAnalysis?.paragraph || ''
      });

      const finalOutput = {
        company_name: resolvedCompanyName,
        company_identifiers: {
          preferred_source: vendorExtraction?.company_identifiers || null,
          fallback_source: bankExtraction?.company_identifiers || null
        },
        decision,
        decision_explanation: decision.decision_explanation,
        confidence_score: confidence.confidence_score,
        confidence_reason: confidence.confidence_reason,
        reliability_level: dataReliability.reliability_level,
        confidence_breakdown: confidence,
        improvement_suggestions: creditAdvisory,
        analyst_summary: analystSummary,
        report_pdf_path: reportPdfPath,
        financials_evidence: financialsEvidence,
        calculation_audit_trail: calculationAudit,
        decision_code_explanations: decisionCodeExplanations,
        accounting_observations: dataConflictAnalysis?.paragraph || '',
        authenticity_check: {
          authenticity_status: authenticityCheck.authenticity_status,
          severity: authenticityCheck.severity,
          mismatch_fields: authenticityCheck.mismatch_fields,
          risk_score: authenticityCheck.risk_score,
          risk_score_label: riskScoreLabel,
          message: `${authenticityCheck.message} Audit ID: ${auditId}`
        },
        company_profile: companyProfile,
        trend_analysis: trendAnalysis,
        data_reliability: dataReliability,
        data_conflict_analysis: dataConflictAnalysis,
        extracted_financials: extractedFinancials,
        ratios,
        flags: riskAssessment.flags,
        credit_score: riskAssessment.grade,
        risk_assessment: riskAssessment,
        ai_summary: aiExplanation?.detailed_summary || '',
        ai_explanation: aiExplanation
      };

      await this.writeAuditLog({
        auditId,
        tolerancePct,
        ingestion_mode: 'openai_file_id',
        model_comparison: modelComparison,
        bank: {
          file_id: bankFileId,
          extraction: bankExtraction
        },
        vendor: {
          file_id: vendorFileId,
          extraction: vendorExtraction
        },
        output: finalOutput,
        generated_at: new Date().toISOString()
      });

      return finalOutput;
    } finally {
      await Promise.allSettled(tempFiles.map((p) => fs.unlink(p)));
      await Promise.allSettled(uploadedFileIds.map((id) => this.openaiDocumentService.deleteFile(id)));
    }
  }

  mergePreferredFinancials({ preferred, fallback }) {
    const out = {};
    for (const field of FINANCIAL_FIELDS) {
      out[field] = preferred?.[field] ?? fallback?.[field] ?? null;
    }
    return out;
  }

  resolveCompanyName({ explicitCompanyName, preferred, fallback, modelNarrative }) {
    const explicit = String(explicitCompanyName || '').trim();
    if (explicit) return explicit;

    const preferredName = String(preferred?.company_name || '').trim();
    if (preferredName) return preferredName;

    const fallbackName = String(fallback?.company_name || '').trim();
    if (fallbackName) return fallbackName;

    const narrative = String(modelNarrative || '');
    const match = narrative.match(/company\s+name\s*\(([^)]+)\)/i);
    const fromNarrative = String(match?.[1] || '').trim();
    if (fromNarrative) return fromNarrative;

    return 'UNKNOWN COMPANY';
  }

  mergePreferredEvidence({ preferred, fallback }) {
    const out = {};
    for (const field of FINANCIAL_FIELDS) {
      const p = preferred?.[field] || null;
      const f = fallback?.[field] || null;
      const chosen = p?.value != null ? p : f;

      out[field] = {
        value: chosen?.value ?? null,
        source_section: String(chosen?.source_section || 'UNSPECIFIED'),
        page_number: chosen?.page_number ?? null,
        confidence_score: chosen?.confidence_score ?? 0
      };
    }
    return out;
  }

  applyDerivedFinancialFallbacks({ financials = {}, evidence = {} }) {
    const asNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const stampDerivedEvidence = (field, value, sources = []) => {
      const sourceEvidence = sources
        .map((sourceField) => evidence?.[sourceField])
        .filter((item) => item && item.value != null);
      const minConfidence = sourceEvidence.length
        ? Math.min(...sourceEvidence.map((item) => Number(item.confidence_score) || 0))
        : 0.6;

      evidence[field] = {
        value,
        source_section: 'DERIVED_FROM_FORMULA',
        page_number: null,
        confidence_score: Number(Math.max(0, Math.min(1, minConfidence * 0.95)).toFixed(4))
      };
      financials[field] = value;
    };

    const revenue = asNumber(financials?.revenue);
    const cogs = asNumber(financials?.cogs);
    const grossProfit = asNumber(financials?.gross_profit);
    const currentAssets = asNumber(financials?.current_assets);
    const inventory = asNumber(financials?.inventory);
    const receivables = asNumber(financials?.receivables);
    const cash = asNumber(financials?.cash);
    const totalAssets = asNumber(financials?.total_assets);
    const currentLiabilities = asNumber(financials?.current_liabilities);
    const longTermDebt = asNumber(financials?.long_term_debt);
    const equity = asNumber(financials?.equity);

    if (grossProfit == null && revenue != null && cogs != null) {
      stampDerivedEvidence('gross_profit', Number((revenue - cogs).toFixed(2)), ['revenue', 'cogs']);
    }

    if (currentAssets == null && inventory != null && receivables != null && cash != null) {
      stampDerivedEvidence(
        'current_assets',
        Number((inventory + receivables + cash).toFixed(2)),
        ['inventory', 'receivables', 'cash']
      );
    }

    const nextCurrentAssets = asNumber(financials?.current_assets);
    if (totalAssets == null && nextCurrentAssets != null && equity != null && currentLiabilities != null && longTermDebt != null) {
      stampDerivedEvidence(
        'total_assets',
        Number((equity + currentLiabilities + longTermDebt).toFixed(2)),
        ['equity', 'current_liabilities', 'long_term_debt']
      );
    }

    const nextTotalAssets = asNumber(financials?.total_assets);
    if (equity == null && nextTotalAssets != null && currentLiabilities != null && longTermDebt != null) {
      stampDerivedEvidence(
        'equity',
        Number((nextTotalAssets - currentLiabilities - longTermDebt).toFixed(2)),
        ['total_assets', 'current_liabilities', 'long_term_debt']
      );
    }
  }

  normalizeDecisionCodes({ decisionReasonCodes = [], ratios = {}, reliabilityLevel, authenticityStatus }) {
    const codes = new Set(Array.isArray(decisionReasonCodes) ? decisionReasonCodes : []);

    if (ratios?.current_ratio != null && ratios.current_ratio < 1) codes.add('LIQ_LOW');
    if (ratios?.debtor_days != null && ratios.debtor_days > 90) codes.add('REC_HIGH');
    if (ratios?.net_profit_margin != null && ratios.net_profit_margin < 0.02) codes.add('PROF_LOW');
    if (String(reliabilityLevel || '').toUpperCase() === 'DERIVED') codes.add('REL_DERIVED');
    if (String(reliabilityLevel || '').toUpperCase() === 'DECLARED') codes.add('REL_DECLARED');
    if (String(authenticityStatus || '').toUpperCase() === 'TAMPERED_CRITICAL') codes.add('AUTH_CRITICAL');

    return [...codes];
  }

  mapRiskScoreLabel(riskScore) {
    const score = Number(riskScore);
    if (!Number.isFinite(score)) return 'UNAVAILABLE';
    if (score < 20) return 'LOW_CONCERN';
    if (score < 40) return 'MODERATE_CONCERN';
    if (score < 70) return 'HIGH_CONCERN';
    return 'CRITICAL_REVIEW';
  }

  async writeAuditLog(payload) {
    await fs.mkdir(this.auditDir, { recursive: true });
    const outPath = path.join(this.auditDir, `${payload.auditId}.json`);
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  }
}

export default FinancialAnalysisService;