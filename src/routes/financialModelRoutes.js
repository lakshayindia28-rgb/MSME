import express from 'express';
import multer from 'multer';

import { FinancialAnalysisService } from '../services/financial-model/financial_analysis_service.js';
import { YearwiseVendorSheetService } from '../services/financial-model/yearwise_vendor_sheet_service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const service = new FinancialAnalysisService();
const yearwiseService = new YearwiseVendorSheetService();
const ANALYZE_TIMEOUT_MS = Number(process.env.FINANCIAL_MODEL_ANALYZE_TIMEOUT_MS) > 0
  ? Number(process.env.FINANCIAL_MODEL_ANALYZE_TIMEOUT_MS)
  : 900000;
const YEARWISE_ANALYZE_TIMEOUT_MS = Number(process.env.FINANCIAL_MODEL_YEARWISE_ANALYZE_TIMEOUT_MS) > 0
  ? Number(process.env.FINANCIAL_MODEL_YEARWISE_ANALYZE_TIMEOUT_MS)
  : 900000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 2
  }
});

const uploadYearwise = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 5
  }
});

function parseJsonField(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function isPdf(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  return mime === 'application/pdf' || String(file?.originalname || '').toLowerCase().endsWith('.pdf');
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error(`Financial analysis timed out after ${timeoutMs}ms`);
        err.status = 504;
        reject(err);
      }, timeoutMs);
    })
  ]);
}

function toLimitedText(value, maxChars = 1200) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}…`;
}

function buildAnalyzeCompanyResponse(data, { compact = false, gradeOnly = false } = {}) {
  if (gradeOnly) {
    return {
      grade: data?.decision?.grade || data?.risk_assessment?.grade || null,
      final_decision: data?.decision?.final_decision || data?.decision?.decision || null,
      confidence_score: data?.confidence_score ?? null,
      reliability_level: data?.reliability_level || 'DECLARED',
      analyst_summary: toLimitedText(data?.analyst_summary || '', 900),
      report_pdf_path: data?.report_pdf_path || null,
      decision: data?.decision || null
    };
  }

  const base = {
    decision: data?.decision || null,
    grade: data?.decision?.grade || data?.risk_assessment?.grade || null,
    final_decision: data?.decision?.final_decision || data?.decision?.decision || null,
    confidence_score: data?.confidence_score ?? null,
    confidence_reason: data?.confidence_reason || '',
    reliability_level: data?.reliability_level || 'DECLARED',
    improvement_suggestions: data?.improvement_suggestions || {
      mandatory_conditions: [],
      risk_mitigation: [],
      advisory_recommendations: []
    },
    analyst_summary: compact
      ? toLimitedText(data?.analyst_summary || '', 1200)
      : (data?.analyst_summary || ''),
    ai_explanation: compact
      ? {
        bullet_summary: Array.isArray(data?.ai_explanation?.bullet_summary)
          ? data.ai_explanation.bullet_summary.slice(0, 5)
          : [],
        detailed_summary: toLimitedText(data?.ai_explanation?.detailed_summary || '', 1800),
        key_concerns: Array.isArray(data?.ai_explanation?.key_concerns)
          ? data.ai_explanation.key_concerns.slice(0, 5)
          : [],
        improvement_suggestions: Array.isArray(data?.ai_explanation?.improvement_suggestions)
          ? data.ai_explanation.improvement_suggestions.slice(0, 5)
          : []
      }
      : (data?.ai_explanation || null),
    report_pdf_path: data?.report_pdf_path || null,
    financials_evidence: data?.financials_evidence || {},
    calculation_audit_trail: data?.calculation_audit_trail || {},
    decision_code_explanations: data?.decision_code_explanations || [],
    accounting_observations: compact
      ? toLimitedText(data?.accounting_observations || '', 1200)
      : (data?.accounting_observations || ''),
    company_profile: data?.company_profile || null,
    authenticity_check: data?.authenticity_check || null,
    extracted_financials: data?.extracted_financials || {},
    ratios: data?.ratios || {},
    trend_analysis: data?.trend_analysis || {},
    risk_assessment: data?.risk_assessment || null,
    data_conflict_analysis: data?.data_conflict_analysis || null
  };

  return base;
}

function parseYearList(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(input || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

router.post(
  '/analyze',
  upload.fields([
    { name: 'bank_submitted_pdf', maxCount: 1 },
    { name: 'vendor_verified_pdf', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const bankFile = req.files?.bank_submitted_pdf?.[0];
      const vendorFile = req.files?.vendor_verified_pdf?.[0];

      if (!bankFile || !vendorFile) {
        return res.status(400).json({
          success: false,
          error: 'Both files are required: bank_submitted_pdf and vendor_verified_pdf'
        });
      }

      if (!isPdf(bankFile) || !isPdf(vendorFile)) {
        return res.status(400).json({
          success: false,
          error: 'Only PDF files are allowed for both inputs'
        });
      }

      const toleranceInput = Number(req.body?.tolerancePct);
      const tolerancePct = Number.isFinite(toleranceInput) ? toleranceInput : 0.5;
      const previousYearFinancials = parseJsonField(req.body?.previous_year_financials);
      const itrFinancials = parseJsonField(req.body?.itr_financials);
      const companyName = String(req.body?.company_name || req.body?.companyName || '').trim() || null;

      const data = await service.analyze({
        bankSubmittedPdfBuffer: bankFile.buffer,
        vendorVerifiedPdfBuffer: vendorFile.buffer,
        tolerancePct,
        previousYearFinancials,
        itrFinancials,
        companyName
      });

      return res.json({
        success: true,
        data
      });
    } catch (error) {
      logger.error('Financial model analysis error:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Financial model analysis failed'
      });
    }
  }
);

router.post(
  '/analyze-company',
  upload.fields([
    { name: 'bank_submitted_pdf', maxCount: 1 },
    { name: 'vendor_verified_pdf', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const bankFile = req.files?.bank_submitted_pdf?.[0];
      const vendorFile = req.files?.vendor_verified_pdf?.[0];

      if (!bankFile || !vendorFile) {
        return res.status(400).json({
          error: 'Both files are required: bank_submitted_pdf and vendor_verified_pdf'
        });
      }

      if (!isPdf(bankFile) || !isPdf(vendorFile)) {
        return res.status(400).json({
          error: 'Only PDF files are allowed for both inputs'
        });
      }

      const toleranceInput = Number(req.body?.tolerancePct);
      const tolerancePct = Number.isFinite(toleranceInput) ? toleranceInput : 0.5;
      const previousYearFinancials = parseJsonField(req.body?.previous_year_financials);
      const itrFinancials = parseJsonField(req.body?.itr_financials);
      const companyName = String(req.body?.company_name || req.body?.companyName || '').trim() || null;
      const responseMode = String(req.body?.responseMode || '').trim().toLowerCase();
      const compactResponse = responseMode === 'compact';
      const gradeOnlyResponse = responseMode === 'grade';

      const data = await withTimeout(service.analyze({
        bankSubmittedPdfBuffer: bankFile.buffer,
        vendorVerifiedPdfBuffer: vendorFile.buffer,
        tolerancePct,
        previousYearFinancials,
        itrFinancials,
        companyName
      }), ANALYZE_TIMEOUT_MS);

      return res.json(buildAnalyzeCompanyResponse(data, { compact: compactResponse, gradeOnly: gradeOnlyResponse }));
    } catch (error) {
      logger.error('Analyze-company underwriting error:', error);
      const status = Number.isFinite(error?.status) ? Number(error.status) : 500;
      return res.status(status).json({
        error: error?.message || 'Financial underwriting analysis failed'
      });
    }
  }
);

router.post(
  '/vendor-yearwise/analyze',
  uploadYearwise.fields([
    { name: 'bank_submitted_pdf', maxCount: 1 },
    { name: 'vendor_verified_yearly_pdf', maxCount: 3 },
    { name: 'vendor_verified_pdf_yearwise', maxCount: 3 }
  ]),
  async (req, res) => {
    try {
      const bankFile = req.files?.bank_submitted_pdf?.[0] || null;
      const vendorFiles = [
        ...(req.files?.vendor_verified_yearly_pdf || []),
        ...(req.files?.vendor_verified_pdf_yearwise || [])
      ];

      if (!bankFile) {
        return res.status(400).json({
          success: false,
          error: 'Bank financial PDF is required: bank_submitted_pdf'
        });
      }
      if (!isPdf(bankFile)) {
        return res.status(400).json({
          success: false,
          error: 'Bank financial file must be a PDF'
        });
      }

      if (!vendorFiles.length) {
        return res.status(400).json({
          success: false,
          error: 'Upload at least one file in vendor_verified_yearly_pdf (1 to 3 PDFs).'
        });
      }

      const invalid = vendorFiles.find((file) => !isPdf(file));
      if (invalid) {
        return res.status(400).json({
          success: false,
          error: `Only PDF files are allowed. Invalid file: ${invalid.originalname || 'unknown'}`
        });
      }

      const years = parseYearList(req.body?.years || req.body?.financial_years);
      const companyName = String(req.body?.company_name || req.body?.companyName || '').trim() || null;
      const toleranceInput = Number(req.body?.tolerancePct);
      const tolerancePct = Number.isFinite(toleranceInput) ? toleranceInput : 5;
      if (years.length && years.length !== vendorFiles.length) {
        return res.status(400).json({
          success: false,
          error: `Year mapping mismatch: uploaded ${vendorFiles.length} vendor files but received ${years.length} financial years.`
        });
      }
      const generatePdfRaw = String(req.body?.generate_pdf || 'true').trim().toLowerCase();
      const generatePdf = !['0', 'false', 'no'].includes(generatePdfRaw);

      const data = await withTimeout(
        yearwiseService.analyzeAndFill({
          bankFile,
          vendorYearlyFiles: vendorFiles,
          years,
          companyName,
          generatePdf,
          tolerancePct
        }),
        YEARWISE_ANALYZE_TIMEOUT_MS
      );

      return res.json({
        success: true,
        mode: 'vendor_yearwise_financial_fill',
        data
      });
    } catch (error) {
      logger.error('Vendor year-wise financial fill error:', error);
      const status = Number.isFinite(error?.status) ? Number(error.status) : 500;
      return res.status(status).json({
        success: false,
        error: error?.message || 'Vendor year-wise financial analysis failed'
      });
    }
  }
);

export default router;