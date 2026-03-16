import { callClaude, isBedrockConfigured } from './bedrockClient.js';
import PDFDocument from 'pdfkit';
import puppeteer from 'puppeteer';
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * AI Report Generation Service
 * Uses OpenAI GPT to generate professional company reports
 */
class ReportService {
  constructor() {
    // In-memory storage for company data (in production, use database)
    this.companyDataStore = new Map();
  }

  /**
   * Store company data for report generation
   */
  storeCompanyData(companyId, dataType, data) {
    if (!this.companyDataStore.has(companyId)) {
      this.companyDataStore.set(companyId, {});
    }
    
    const companyData = this.companyDataStore.get(companyId);
    companyData[dataType] = data;
    companyData.lastUpdated = new Date().toISOString();
    
    logger.info(`Stored ${dataType} data for company: ${companyId}`);
  }

  /**
   * Get stored company data
   */
  getCompanyData(companyId) {
    return this.companyDataStore.get(companyId) || null;
  }

  /**
   * Generate AI report using GPT
   */
  async generateAIReport(gstData, mcaData, moduleSummaries = []) {
    try {
      if (!isBedrockConfigured()) {
        logger.warn('Bedrock not configured, using template report');
        return this.generateTemplateReport(gstData, mcaData, moduleSummaries);
      }

      logger.info('Generating AI report using Claude via Bedrock...');

      const prompt = this.buildReportPrompt(gstData, mcaData, moduleSummaries);

      const reportText = await callClaude(
        'You are a professional business analyst specializing in Indian company analysis. Generate comprehensive, professional reports based on GST and MCA data.\n\n' +
        prompt
      );

      logger.info('AI report generated successfully');
      return reportText;

    } catch (error) {
      logger.error(`AI report generation failed: ${error.message}`);
      return this.generateTemplateReport(gstData, mcaData, moduleSummaries);
    }
  }

  /**
   * Build GPT prompt from company data
   */
  buildReportPrompt(gstData, mcaData, moduleSummaries = []) {
    let prompt = `Generate a professional company analysis report based on the following data:\n\n`;

    // GST Data Section
    if (gstData) {
      prompt += `**GST INFORMATION:**\n`;
      prompt += `- GSTIN: ${gstData.gstin || 'N/A'}\n`;
      prompt += `- Legal Name: ${gstData.legalName || 'N/A'}\n`;
      prompt += `- Trade Name: ${gstData.tradeName || 'N/A'}\n`;
      prompt += `- Registration Date: ${gstData.registrationDate || 'N/A'}\n`;
      prompt += `- Status: ${gstData.status || 'N/A'}\n`;
      prompt += `- Taxpayer Type: ${gstData.taxpayerType || 'N/A'}\n`;
      prompt += `- Business Activities: ${gstData.businessActivities || 'N/A'}\n`;
      prompt += `- Address: ${gstData.address || 'N/A'}\n\n`;
    }

    // MCA Data Section
    if (mcaData) {
      prompt += `**MCA CORPORATE INFORMATION:**\n`;
      prompt += `- Company Name: ${mcaData.companyName || 'N/A'}\n`;
      prompt += `- CIN: ${mcaData.cin || 'N/A'}\n`;
      prompt += `- Status: ${mcaData.status || 'N/A'}\n`;
      prompt += `- Registration Date: ${mcaData.dateOfIncorporation || 'N/A'}\n`;
      prompt += `- Class of Company: ${mcaData.classOfCompany || 'N/A'}\n`;
      prompt += `- Category: ${mcaData.category || 'N/A'}\n`;
      prompt += `- Authorized Capital: ${mcaData.authorizedCapital || 'N/A'}\n`;
      prompt += `- Paid-up Capital: ${mcaData.paidUpCapital || 'N/A'}\n`;
      prompt += `- Registered Office: ${mcaData.registeredOffice || 'N/A'}\n`;
      
      if (mcaData.directors && mcaData.directors.length > 0) {
        prompt += `- Number of Directors: ${mcaData.directors.length}\n`;
        prompt += `- Key Directors: ${mcaData.directors.slice(0, 3).map(d => d.name).join(', ')}\n`;
      }
      
      prompt += `\n`;
    }

    const selectedSummaries = Array.isArray(moduleSummaries)
      ? moduleSummaries.filter((item) => item && typeof item === 'object' && String(item.summary || '').trim())
      : [];

    if (selectedSummaries.length) {
      prompt += `**EXECUTIVE MODULE SUMMARIES (Include these in final report):**\n`;
      selectedSummaries.slice(0, 20).forEach((item, idx) => {
        const moduleLabel = String(item.moduleLabel || item.moduleKey || `Module ${idx + 1}`).trim();
        const summary = String(item.summary || '').trim();
        prompt += `- ${moduleLabel}: ${summary}\n`;
      });
      prompt += `\n`;
    }

    prompt += `Please generate a comprehensive company analysis report with the following sections:
1. Executive Summary
2. Company Overview
3. Legal & Compliance Status
4. Financial Highlights (based on capital structure)
5. Business Activities & Operations
6. Management & Key Personnel
7. Risk Assessment
8. Conclusion & Recommendations

Format the report professionally with clear headings and bullet points.`;

    return prompt;
  }

  /**
   * Generate template report (fallback when no API key)
   */
  generateTemplateReport(gstData, mcaData, moduleSummaries = []) {
    let report = `COMPANY ANALYSIS REPORT\n`;
    report += `Generated on: ${new Date().toLocaleDateString('en-IN')}\n`;
    report += `${'='.repeat(80)}\n\n`;

    // Executive Summary
    report += `1. EXECUTIVE SUMMARY\n`;
    report += `${'-'.repeat(80)}\n`;
    
    const companyName = mcaData?.companyName || gstData?.legalName || 'Unknown Company';
    const status = mcaData?.status || gstData?.status || 'Unknown';
    
    report += `This report provides a comprehensive analysis of ${companyName}.\n`;
    report += `Current Status: ${status}\n`;
    report += `Data Sources: GST Portal & Ministry of Corporate Affairs\n\n`;

    // Company Overview
    report += `2. COMPANY OVERVIEW\n`;
    report += `${'-'.repeat(80)}\n`;
    
    if (mcaData) {
      report += `Company Name: ${mcaData.companyName || 'N/A'}\n`;
      report += `CIN: ${mcaData.cin || 'N/A'}\n`;
      report += `Date of Incorporation: ${mcaData.dateOfIncorporation || 'N/A'}\n`;
      report += `Class: ${mcaData.classOfCompany || 'N/A'}\n`;
      report += `Category: ${mcaData.category || 'N/A'}\n`;
    }
    
    if (gstData) {
      report += `GSTIN: ${gstData.gstin || 'N/A'}\n`;
      report += `Trade Name: ${gstData.tradeName || 'N/A'}\n`;
      report += `GST Registration Date: ${gstData.registrationDate || 'N/A'}\n`;
    }
    
    report += `\n`;

    // Financial Information
    report += `3. FINANCIAL HIGHLIGHTS\n`;
    report += `${'-'.repeat(80)}\n`;
    
    if (mcaData) {
      report += `Authorized Capital: ${mcaData.authorizedCapital || 'N/A'}\n`;
      report += `Paid-up Capital: ${mcaData.paidUpCapital || 'N/A'}\n`;
    }
    
    report += `\n`;

    // Compliance Status
    report += `4. LEGAL & COMPLIANCE STATUS\n`;
    report += `${'-'.repeat(80)}\n`;
    report += `Company Status: ${status}\n`;
    
    if (gstData) {
      report += `GST Status: ${gstData.status || 'N/A'}\n`;
      report += `Taxpayer Type: ${gstData.taxpayerType || 'N/A'}\n`;
    }
    
    report += `\n`;

    // Business Activities
    report += `5. BUSINESS ACTIVITIES\n`;
    report += `${'-'.repeat(80)}\n`;
    
    if (gstData?.businessActivities) {
      report += `${gstData.businessActivities}\n`;
    }
    
    if (mcaData?.mainActivity) {
      report += `Main Activity: ${mcaData.mainActivity}\n`;
    }
    
    report += `\n`;

    // Management
    report += `6. MANAGEMENT & KEY PERSONNEL\n`;
    report += `${'-'.repeat(80)}\n`;
    
    if (mcaData?.directors && mcaData.directors.length > 0) {
      report += `Total Directors: ${mcaData.directors.length}\n\n`;
      mcaData.directors.forEach((director, idx) => {
        report += `${idx + 1}. ${director.name}\n`;
        report += `   DIN: ${director.din}\n`;
        report += `   Designation: ${director.designation}\n`;
        report += `   Appointed: ${director.appointedOn || 'N/A'}\n\n`;
      });
    }

    // Registered Office
    report += `7. REGISTERED OFFICE\n`;
    report += `${'-'.repeat(80)}\n`;
    
    if (mcaData?.registeredOffice) {
      report += `${mcaData.registeredOffice}\n`;
    } else if (gstData?.address) {
      report += `${gstData.address}\n`;
    }
    
    report += `\n`;

    // Conclusion
    report += `8. CONCLUSION\n`;
    report += `${'-'.repeat(80)}\n`;
    report += `This analysis provides key information about ${companyName}.\n`;
    report += `The company is currently ${status.toLowerCase()}.\n`;
    report += `For detailed due diligence, please verify information from official sources.\n\n`;

    const selectedSummaries = Array.isArray(moduleSummaries)
      ? moduleSummaries.filter((item) => item && typeof item === 'object' && String(item.summary || '').trim())
      : [];

    if (selectedSummaries.length > 0) {
      report += `9. EXECUTIVE MODULE SUMMARIES\n`;
      report += `${'-'.repeat(80)}\n`;
      selectedSummaries.forEach((item, idx) => {
        const moduleLabel = String(item.moduleLabel || item.moduleKey || `Module ${idx + 1}`).trim();
        const summary = String(item.summary || '').trim();
        report += `${idx + 1}. ${moduleLabel}\n`;
        report += `   ${summary || '—'}\n\n`;
      });
    }

    report += `${'='.repeat(80)}\n`;
    report += `Report generated by MCA-GST Analysis Portal\n`;
    report += `Disclaimer: This report is for informational purposes only.\n`;

    return report;
  }

  /**
   * Generate PDF from report text
   */
  async generatePDF(reportText, companyName = 'Company') {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 50, right: 50 }
        });

        const chunks = [];
        
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).font('Helvetica-Bold')
           .text('COMPANY ANALYSIS REPORT', { align: 'center' });
        
        doc.moveDown();
        doc.fontSize(14).font('Helvetica')
           .text(companyName, { align: 'center' });
        
        doc.moveDown();
        doc.fontSize(10)
           .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
        
        doc.moveDown(2);

        // Report Content
        const lines = reportText.split('\n');
        
        lines.forEach(line => {
          // Headers (all caps or starts with number)
          if (line.match(/^[A-Z\s]{10,}$/) || line.match(/^\d+\./)) {
            doc.fontSize(12).font('Helvetica-Bold')
               .text(line, { continued: false });
            doc.moveDown(0.5);
          }
          // Section dividers
          else if (line.match(/^[-=]{10,}$/)) {
            doc.moveDown(0.3);
          }
          // Regular text
          else if (line.trim()) {
            doc.fontSize(10).font('Helvetica')
               .text(line, { align: 'left', continued: false });
          }
          // Empty lines
          else {
            doc.moveDown(0.5);
          }
        });

        // Footer
        doc.fontSize(8).font('Helvetica')
           .text('MCA-GST Analysis Portal | For informational purposes only', 
                 50, doc.page.height - 30, 
                 { align: 'center', width: doc.page.width - 100 });

        doc.end();

      } catch (error) {
        reject(error);
      }
    });
  }

  async generateFinancialReconciliationPDF({
    dataset,
    companyInfo = {}
  } = {}) {
    const payload = dataset && typeof dataset === 'object' ? dataset : {};
    const extractedValues = Array.isArray(payload.EXTRACTED_VALUES) ? payload.EXTRACTED_VALUES : [];
    const reconciliationRows = Array.isArray(payload.RECONCILIATION_TABLE) ? payload.RECONCILIATION_TABLE : [];
    const risk = payload.RISK_CLASSIFICATION && typeof payload.RISK_CLASSIFICATION === 'object'
      ? payload.RISK_CLASSIFICATION
      : {};
    const interpretation = payload.FINANCIAL_INTERPRETATION && typeof payload.FINANCIAL_INTERPRETATION === 'object'
      ? payload.FINANCIAL_INTERPRETATION
      : {};
    const creditNoteLines = Array.isArray(payload.CREDIT_NOTE)
      ? payload.CREDIT_NOTE.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 5)
      : String(payload.CREDIT_NOTE || '').split(/\r?\n/).map((v) => String(v || '').trim()).filter(Boolean).slice(0, 5);
    const creditNoteJustification = Array.isArray(payload.CREDIT_NOTE_JUSTIFICATION)
      ? payload.CREDIT_NOTE_JUSTIFICATION
      : [];
    const approvalJustification = payload.APPROVAL_JUSTIFICATION && typeof payload.APPROVAL_JUSTIFICATION === 'object'
      ? payload.APPROVAL_JUSTIFICATION
      : null;
    const decision = String(payload.CREDIT_DECISION || '').trim().toLowerCase();

    const canonicalRows = [
      { label: 'Revenue', aliases: ['revenue', 'total_revenue', 'sales', 'turnover'] },
      { label: 'COGS', aliases: ['cogs', 'cost_of_goods_sold', 'cost_of_sales'] },
      { label: 'Expenses', aliases: ['expenses', 'total_expenses', 'operating_expenses'] },
      { label: 'Profit', aliases: ['profit', 'pat', 'net_profit', 'ebitda'] },
      { label: 'Assets', aliases: ['assets', 'total_assets'] },
      { label: 'Liabilities', aliases: ['liabilities', 'total_liabilities', 'current_liabilities'] }
    ];

    const normalizeField = (value) => String(value || '').trim().toLowerCase();
    const pickFirstMatch = (rows, aliases) => {
      const aliasSet = new Set(aliases.map((a) => normalizeField(a)));
      return rows.find((row) => aliasSet.has(normalizeField(row?.field)));
    };

    const flatText = (value) => {
      if (value == null) return '';
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
      if (typeof value === 'string') return value.trim();
      if (Array.isArray(value)) return value.map((v) => flatText(v)).filter(Boolean).join(', ');
      if (typeof value === 'object') return Object.values(value).map((v) => flatText(v)).filter(Boolean).join(' ');
      return '';
    };

    const clipped = (value, max = 38) => {
      const text = flatText(value).replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const statusLabel = (value) => {
      const v = String(value || '').trim().toLowerCase();
      if (v === 'match') return 'MATCH';
      if (v === 'acceptable') return 'ACCEPTABLE VARIATION';
      if (v === 'review') return 'REVIEW REQUIRED';
      if (v === 'suspicious') return 'SUSPICIOUS';
      return '';
    };

    const riskLabel = (value) => {
      const v = String(value || '').trim().toLowerCase();
      if (!v) return '';
      return v.charAt(0).toUpperCase() + v.slice(1);
    };

    const decisionLabel = (() => {
      if (decision === 'approve') return 'APPROVE';
      if (decision === 'manual_review') return 'MANUAL REVIEW';
      if (decision === 'reject') return 'REJECT';
      return '';
    })();

    const decisionReason = (() => {
      if (decision === 'approve') return 'All key fields remain within tolerance with verified authenticity.';
      if (decision === 'manual_review') return 'One or more fields require analyst validation before final lending action.';
      if (decision === 'reject') return 'Tolerance breaches or authenticity risk indicate material data inconsistency.';
      return 'Analyst validation required before final lending action.';
    })();

    const interpretationParagraphs = [
      interpretation.business_profile,
      interpretation.revenue_behavior,
      interpretation.profitability_quality,
      interpretation.liquidity_position,
      interpretation.receivable_risk,
      interpretation.liability_pressure,
      interpretation.cashflow_indicator,
      interpretation.mismatch_meaning,
      interpretation.credit_servicing_ability,
      interpretation.overall_financial_character
    ].map((v) => String(v || '').trim()).filter(Boolean);

    const extractedTableRows = canonicalRows.map((row) => {
      const found = pickFirstMatch(extractedValues, row.aliases);
      return [
        row.label,
        clipped(found?.bank_value),
        clipped(found?.vendor_value)
      ];
    });

    const reconciliationTableRows = canonicalRows.map((row) => {
      const found = pickFirstMatch(reconciliationRows, row.aliases);
      const diff = found && Number.isFinite(Number(found['difference%']))
        ? Number(found['difference%']).toFixed(2)
        : '';
      return [
        row.label,
        diff,
        statusLabel(found?.tolerance_status)
      ];
    });

    const companyName = clipped(companyInfo.companyName ?? companyInfo.company_name ?? '', 60);
    const pan = clipped(companyInfo.pan ?? '', 20);
    const assessmentYear = clipped(companyInfo.assessmentYear ?? companyInfo.assessment_year ?? '', 20);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 42, bottom: 42, left: 42, right: 42 }
        });

        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const tableHeaderHeight = 20;
        const rowHeight = 18;
        const sectionGap = 12;

        const ensureSpace = (heightNeeded) => {
          if (doc.y + heightNeeded > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }
        };

        const drawSectionTitle = (title) => {
          ensureSpace(24);
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(title, { align: 'left' });
          doc.moveDown(0.35);
        };

        const drawTable = ({ headers, rows, widths }) => {
          const colWidths = widths && widths.length === headers.length
            ? widths
            : headers.map(() => pageWidth / headers.length);

          const drawRow = (values, y, isHeader = false) => {
            let x = doc.page.margins.left;
            for (let i = 0; i < values.length; i++) {
              const w = colWidths[i];
              doc.rect(x, y, w, isHeader ? tableHeaderHeight : rowHeight)
                .fillAndStroke(isHeader ? '#F3F4F6' : '#FFFFFF', '#D1D5DB');
              doc.fillColor('#111827')
                .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(9)
                .text(String(values[i] ?? ''), x + 6, y + 5, {
                  width: w - 12,
                  align: i === 1 && headers[i]?.includes('%') ? 'right' : 'left',
                  ellipsis: true,
                  lineBreak: false
                });
              x += w;
            }
          };

          ensureSpace(tableHeaderHeight + rowHeight);
          let y = doc.y;
          drawRow(headers, y, true);
          y += tableHeaderHeight;

          for (const row of rows) {
            ensureSpace(rowHeight);
            if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
              doc.addPage();
              y = doc.y;
              drawRow(headers, y, true);
              y += tableHeaderHeight;
            }
            drawRow(row, y, false);
            y += rowHeight;
          }

          doc.y = y + sectionGap;
        };

        const drawBoxedStatement = ({ line1, line2 }) => {
          const boxHeight = 58;
          ensureSpace(boxHeight + 8);
          const x = doc.page.margins.left;
          const y = doc.y;

          doc.rect(x, y, pageWidth, boxHeight).fillAndStroke('#FFFFFF', '#9CA3AF');
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(line1, x + 10, y + 16, { width: pageWidth - 20 });
          doc.font('Helvetica').fontSize(9).fillColor('#374151').text(line2, x + 10, y + 34, { width: pageWidth - 20, lineBreak: false, ellipsis: true });
          doc.y = y + boxHeight + sectionGap;
        };

        const drawParagraphBlock = ({ paragraphs }) => {
          const lines = Array.isArray(paragraphs)
            ? paragraphs.map((p) => String(p || '').trim()).filter(Boolean)
            : [];
          if (!lines.length) {
            ensureSpace(24);
            doc.font('Helvetica').fontSize(9).fillColor('#374151').text('No interpretation available in dataset.', { align: 'left' });
            doc.moveDown(0.8);
            return;
          }

          for (const paragraph of lines) {
            ensureSpace(28);
            doc.font('Helvetica').fontSize(9.5).fillColor('#111827').text(paragraph, {
              align: 'left',
              width: pageWidth,
              lineGap: 2
            });
            doc.moveDown(0.5);
          }

          doc.moveDown(0.3);
        };

        const drawCreditNoteLines = (lines) => {
          const list = Array.isArray(lines) ? lines.map((v) => String(v || '').trim()).filter(Boolean) : [];
          if (!list.length) {
            drawTable({
              headers: ['Line', 'Statement'],
              rows: [['1', 'Credit note unavailable in dataset']],
              widths: [pageWidth * 0.12, pageWidth * 0.88]
            });
            return;
          }

          drawTable({
            headers: ['Line', 'Statement'],
            rows: list.map((line, idx) => [String(idx + 1), line]),
            widths: [pageWidth * 0.12, pageWidth * 0.88]
          });
        };

        const drawAuditJustificationTable = (rows) => {
          const list = Array.isArray(rows) ? rows : [];
          const tableRows = list.length
            ? list.map((entry) => {
              const evidence = Array.isArray(entry?.supporting_evidence)
                ? entry.supporting_evidence
                : [];
              const evidenceText = evidence.length
                ? evidence.map((ev) => {
                    const field = String(ev?.field || '').trim();
                    const value = String(ev?.value ?? '').trim();
                    const section = String(ev?.source_section || '').trim();
                    const page = ev?.page_number == null ? '' : `p.${String(ev.page_number)}`;
                    return [field, value, section, page].filter(Boolean).join(' | ');
                  }).join(' || ')
                : 'No supporting evidence mapped';
              const derived = Array.isArray(entry?.derived_from) ? entry.derived_from.join(', ') : '';

              return [
                String(entry?.line_number ?? ''),
                clipped(String(entry?.statement || '').trim(), 46),
                clipped(evidenceText, 72),
                clipped(derived, 20),
                String(entry?.audit_confidence || '').trim()
              ];
            })
            : [['1', 'Justification mapping unavailable', 'No supporting evidence mapped', '', 'LOW']];

          drawTable({
            headers: ['Line', 'Statement', 'Supporting Evidence', 'Derived From', 'Audit Confidence'],
            rows: tableRows,
            widths: [pageWidth * 0.08, pageWidth * 0.25, pageWidth * 0.39, pageWidth * 0.14, pageWidth * 0.14]
          });
        };

        const drawUnderwritingJustification = (data) => {
          const item = data && typeof data === 'object' ? data : null;
          if (!item) {
            drawTable({
              headers: ['Type', 'Justification'],
              rows: [['FINAL_RATIONALE', 'Underwriting justification not available in dataset']],
              widths: [pageWidth * 0.26, pageWidth * 0.74]
            });
            return;
          }

          const lines = Array.isArray(item.justification_lines) ? item.justification_lines : [];
          const rows = lines.length
            ? lines.map((line) => [
                String(line?.type || '').trim(),
                clipped(String(line?.text || '').trim(), 92)
              ])
            : [['FINAL_RATIONALE', 'No deterministic justification line available']];

          drawTable({
            headers: ['Type', 'Justification'],
            rows,
            widths: [pageWidth * 0.26, pageWidth * 0.74]
          });

          drawTable({
            headers: ['Decision Type', 'Audit Defensibility'],
            rows: [[
              String(item.decision_type || '').trim(),
              String(item.audit_defensibility || '').trim()
            ]],
            widths: [pageWidth * 0.5, pageWidth * 0.5]
          });
        };

        drawSectionTitle('Section 1 — Company Information');
        drawTable({
          headers: ['Field', 'Value'],
          rows: [
            ['Company Name', companyName],
            ['PAN', pan],
            ['Assessment Year', assessmentYear]
          ],
          widths: [pageWidth * 0.34, pageWidth * 0.66]
        });

        drawSectionTitle('Section 2 — Extracted Financial Values');
        drawTable({
          headers: ['Field', 'Bank Document', 'Vendor Document'],
          rows: extractedTableRows,
          widths: [pageWidth * 0.26, pageWidth * 0.37, pageWidth * 0.37]
        });

        drawSectionTitle('Section 3 — Reconciliation Results');
        drawTable({
          headers: ['Field', 'Difference %', 'Tolerance Status'],
          rows: reconciliationTableRows,
          widths: [pageWidth * 0.28, pageWidth * 0.24, pageWidth * 0.48]
        });

        drawSectionTitle('Section 4 — Risk Classification');
        drawTable({
          headers: ['Area', 'Classification'],
          rows: [
            ['Liquidity', riskLabel(risk.liquidity)],
            ['Profitability', riskLabel(risk.profitability)],
            ['Authenticity', riskLabel(risk.authenticity)]
          ],
          widths: [pageWidth * 0.36, pageWidth * 0.64]
        });

        drawSectionTitle('Section 5 — Financial Interpretation (Credit Understanding View)');
        drawParagraphBlock({ paragraphs: interpretationParagraphs });

        drawSectionTitle('Section 6 — Credit Decision');
        drawBoxedStatement({
          line1: `Decision: ${decisionLabel}`,
          line2: `Reason: ${decisionReason}`
        });

        drawSectionTitle('Section 7 — Credit Note');
        drawCreditNoteLines(creditNoteLines);

        drawSectionTitle('Section 8 — Audit Justification Table');
        drawAuditJustificationTable(creditNoteJustification);

        drawSectionTitle('Section 9 — Underwriting Justification Note');
        drawUnderwritingJustification(approvalJustification);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate a fixed-structure, consulting-grade Pre‑Sanction Due Diligence PDF.
   * Notes:
   * - Deterministic template (no model claims inside the report)
   * - Accepts optional images as data URLs for embedding in the PDF
   */
  async generatePreSanctionDueDiligencePDF(payload) {
    const html = this.buildPreSanctionDueDiligenceHTML(payload);

    const UDYAM_MARKER = '<!-- UDYAM_PDF_INSERT -->';
    const hasUdyamPdf = !!payload?.udyamPdfBase64;
    const markerIdx = html.indexOf(UDYAM_MARKER);
    const canSplit = hasUdyamPdf && markerIdx !== -1;

    /* ── Step 1: Render HTML to PDF via Puppeteer ── */
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const pdfOpts = {
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '18mm', left: '10mm' },
      displayHeaderFooter: false
    };

    let part1PdfBuffer, part2PdfBuffer, contentPdfBuffer;
    try {
      const page = await browser.newPage();

      if (canSplit) {
        // Extract <html>...<body> wrapper so we can reuse it for part 2
        const bodyOpenMatch = html.match(/^([\s\S]*?<body[^>]*>)/i);
        const headWrapper = bodyOpenMatch ? bodyOpenMatch[1] : '<!doctype html><html><head></head><body>';

        const htmlBefore = html.substring(0, markerIdx + UDYAM_MARKER.length) + '</body></html>';
        const htmlAfter = headWrapper + html.substring(markerIdx + UDYAM_MARKER.length);

        // Render part 1 (everything up to and including Udyam details section)
        await page.setContent(htmlBefore, { waitUntil: 'networkidle0' });
        part1PdfBuffer = await page.pdf(pdfOpts);

        // Render part 2 (everything after Udyam section — site visit, conclusion, etc.)
        await page.setContent(htmlAfter, { waitUntil: 'networkidle0' });
        part2PdfBuffer = await page.pdf(pdfOpts);
      } else {
        // No Udyam PDF or no marker — single render as before
        await page.setContent(html, { waitUntil: 'networkidle0' });
        contentPdfBuffer = await page.pdf(pdfOpts);
      }
    } finally {
      await browser.close();
    }

    /* ── Step 2: Merge with shree.pdf template (cover + content + ending) ── */
    try {
      const templatePath = path.join(__dirname, 'templates', 'shree.pdf');
      const hasTemplate = fs.existsSync(templatePath);
      if (!hasTemplate) {
        logger.warn('Template PDF (shree.pdf) not found at ' + templatePath + ', will merge content parts without template');
      }

      let templateDoc = null;
      if (hasTemplate) {
        const templateBytes = fs.readFileSync(templatePath);
        templateDoc = await PdfLibDocument.load(templateBytes);
      }

      // Load Udyam PDF for direct merge
      let udyamDoc = null;
      let udyamPageCount = 0;
      if (hasUdyamPdf) {
        try {
          const udyamBytes = Buffer.from(payload.udyamPdfBase64, 'base64');
          udyamDoc = await PdfLibDocument.load(udyamBytes, { ignoreEncryption: true });
          udyamPageCount = udyamDoc.getPageCount();
        } catch (udyamLoadErr) {
          logger.warn('Could not load Udyam PDF for merge:', udyamLoadErr?.message);
        }
      }

      // Load content PDFs
      let part1Doc, part2Doc, contentDoc;
      let part1Count = 0, part2Count = 0, contentCount = 0;
      if (canSplit) {
        part1Doc = await PdfLibDocument.load(part1PdfBuffer);
        part2Doc = await PdfLibDocument.load(part2PdfBuffer);
        part1Count = part1Doc.getPageCount();
        part2Count = part2Doc.getPageCount();
      } else {
        contentDoc = await PdfLibDocument.load(contentPdfBuffer);
        contentCount = contentDoc.getPageCount();
      }

      const totalContentPages = canSplit ? (part1Count + udyamPageCount + part2Count) : (contentCount + udyamPageCount);
      const totalPages = totalContentPages; // content pages only

      const finalDoc = await PdfLibDocument.create();
      const helvetica = await finalDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await finalDoc.embedFont(StandardFonts.HelveticaBold);

      /* ── Extract dynamic data from payload ── */
      const p = payload || {};
      const c = p.case || {};
      const gst = p.gstData || null;
      const mca = p.mcaData || null;
      const companyName =
        c.companyName || c.businessName ||
        (mca && (mca.companyName || mca.company || mca.name)) ||
        (gst && (gst.legalName || gst.tradeName)) || '';
      const reportDate = c.reportDate || new Date().toISOString();
      const d = new Date(reportDate);
      const formattedDate = Number.isFinite(d.getTime())
        ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : reportDate;

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const white = rgb(1, 1, 1);
      const black = rgb(0, 0, 0);
      const gray = rgb(0.39, 0.39, 0.39);

      /* ── Footer removed (was date + Private and Confidential) ── */
      const drawFooter = () => {};

      let pageNum = 0;

      if (canSplit) {
        /* ── Part 1: content up to Udyam section ── */
        const p1Indices = part1Doc.getPageIndices();
        const p1Pages = await finalDoc.copyPages(part1Doc, p1Indices);
        p1Pages.forEach(pg => { drawFooter(pg, ++pageNum); finalDoc.addPage(pg); });

        /* ── Udyam PDF pages (scaled to fit A4 with margins) ── */
        if (udyamDoc && udyamPageCount > 0) {
          const udyamIndices = udyamDoc.getPageIndices();
          for (const idx of udyamIndices) {
            const [embeddedPage] = await finalDoc.embedPdf(udyamDoc, [idx]);
            const { width: srcW, height: srcH } = embeddedPage;
            // Scale to fit within A4 with 10mm (≈28.35pt) margins
            const margin = 28.35;
            const availW = PAGE_WIDTH - 2 * margin;
            const availH = PAGE_HEIGHT - 2 * margin;
            const scale = Math.min(availW / srcW, availH / srcH, 1); // never upscale
            const drawW = srcW * scale;
            const drawH = srcH * scale;
            // Center on A4 page
            const x = (PAGE_WIDTH - drawW) / 2;
            const y = (PAGE_HEIGHT - drawH) / 2;
            const newPage = finalDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            newPage.drawPage(embeddedPage, { x, y, width: drawW, height: drawH });
            drawFooter(newPage, ++pageNum);
          }
        }

        /* ── Part 2: remaining sections after Udyam ── */
        const p2Indices = part2Doc.getPageIndices();
        const p2Pages = await finalDoc.copyPages(part2Doc, p2Indices);
        p2Pages.forEach(pg => { drawFooter(pg, ++pageNum); finalDoc.addPage(pg); });

      } else {
        /* ── Single content (no split) — fallback same as before ── */
        const contentIndices = contentDoc.getPageIndices();
        const contentPages = await finalDoc.copyPages(contentDoc, contentIndices);
        contentPages.forEach(pg => { drawFooter(pg, ++pageNum); finalDoc.addPage(pg); });

        if (udyamDoc && udyamPageCount > 0) {
          const udyamIndices = udyamDoc.getPageIndices();
          for (const idx of udyamIndices) {
            const [embeddedPage] = await finalDoc.embedPdf(udyamDoc, [idx]);
            const { width: srcW, height: srcH } = embeddedPage;
            const margin = 28.35;
            const availW = PAGE_WIDTH - 2 * margin;
            const availH = PAGE_HEIGHT - 2 * margin;
            const scale = Math.min(availW / srcW, availH / srcH, 1);
            const drawW = srcW * scale;
            const drawH = srcH * scale;
            const x = (PAGE_WIDTH - drawW) / 2;
            const y = (PAGE_HEIGHT - drawH) / 2;
            const newPage = finalDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            newPage.drawPage(embeddedPage, { x, y, width: drawW, height: drawH });
            drawFooter(newPage, ++pageNum);
          }
        }
      }

      /* ── Ending: no template pages appended ── */

      /* ── Step 3: Return merged PDF ── */
      const pdfBytes = await finalDoc.save();
      return Buffer.from(pdfBytes);

    } catch (err) {
      logger.error('PDF template merge failed, attempting simple concatenation fallback:', err.message);
      // Fallback: try to merge part1 + part2 without fancy footers/template
      if (canSplit && part1PdfBuffer && part2PdfBuffer) {
        try {
          const fallbackDoc = await PdfLibDocument.create();
          const fb1 = await PdfLibDocument.load(part1PdfBuffer);
          const fb1Pages = await fallbackDoc.copyPages(fb1, fb1.getPageIndices());
          fb1Pages.forEach(pg => fallbackDoc.addPage(pg));
          const fb2 = await PdfLibDocument.load(part2PdfBuffer);
          const fb2Pages = await fallbackDoc.copyPages(fb2, fb2.getPageIndices());
          fb2Pages.forEach(pg => fallbackDoc.addPage(pg));
          const fbBytes = await fallbackDoc.save();
          return Buffer.from(fbBytes);
        } catch (fbErr) {
          logger.error('Fallback concatenation also failed:', fbErr.message);
        }
      }
      return canSplit ? part1PdfBuffer : contentPdfBuffer;
    }
  }

  buildPreSanctionDueDiligenceHTML(payload) {
    const p = payload || {};
    const c = p.case || {};
    const officer = p.officer || {};
    const modules = p.modules || {};
    const uploads = p.uploads || {};
    const gst = p.gstData || null;
    const mca = p.mcaData || null;
    const fieldImages = Array.isArray(p.fieldImages) ? p.fieldImages.filter(img => img && img.dataUrl) : [];
    const businessSummary = typeof p.businessSummary === 'string' ? p.businessSummary.trim() : '';
    const fieldDataVerifiedBy = typeof p.fieldDataVerifiedBy === 'string' ? p.fieldDataVerifiedBy.trim() : '';
    const moduleSummaries = p.moduleSummaries && typeof p.moduleSummaries === 'object' ? p.moduleSummaries : {};
    const overallObservation = typeof p.overallObservation === 'string' ? p.overallObservation.trim() : '';
    const udyamDocumentImage = typeof p.udyamDocumentImage === 'string' && p.udyamDocumentImage.startsWith('data:') ? p.udyamDocumentImage : null;

    // Case Overview (manually entered executive data — first page table)
    const caseOverview = p.caseOverview && typeof p.caseOverview === 'object' ? p.caseOverview : {};

    // Additional Details (supplementary business params for Details of Business Entity page)
    const additionalDetails = p.additionalDetails && typeof p.additionalDetails === 'object' ? p.additionalDetails : {};

    // Company Snapshot fields (page 4 — boxes layout)
    const csProjectDescription = additionalDetails.projectDescription || '';
    const csProjectLocation = additionalDetails.projectLocation || '';
    const csMajorBrands = additionalDetails.majorBrands || '';
    const csAuditorName = additionalDetails.auditorName || '';
    const csExistingBankers = additionalDetails.existingBankers || '';
    const csTotalEmployees = additionalDetails.totalEmployees || '';
    const csTotalIncomeFY = additionalDetails.totalIncomeFY || '';
    const csWilfulDefaulter = additionalDetails.wilfulDefaulterStatus || '';
    const csExternalRating = additionalDetails.externalRatingDetails || '';
    const csEpfDefaulter = additionalDetails.epfDefaulterStatus || '';
    const csKeyRegulatory = additionalDetails.keyRegulatoryApprovals || '';

    // Group Company Details
    const gcName = additionalDetails.groupCompanyName || '';
    const gcDOI = additionalDetails.groupCompanyDOI || '';
    const gcRegOffice = additionalDetails.groupCompanyRegOffice || '';
    const gcNature = additionalDetails.groupCompanyNature || '';
    const gcFY = additionalDetails.groupCompanyFY || '';
    const gcTotalIncome = additionalDetails.groupCompanyTotalIncome || '';
    const gcNetProfit = additionalDetails.groupCompanyNetProfit || '';
    const gcNetWorth = additionalDetails.groupCompanyNetWorth || '';
    const gcTotalDebt = additionalDetails.groupCompanyTotalDebt || '';
    const gcComments = additionalDetails.groupCompanyComments || '';
    const hasGroupCompanyData = gcName || gcDOI || gcRegOffice || gcNature || gcComments;

    // Organization Structure
    const orgStructureText = additionalDetails.organizationStructure || '';

    // Certification Details
    const certificationDetails = Array.isArray(additionalDetails.certificationDetails) ? additionalDetails.certificationDetails : [];
    const validCertifications = certificationDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));

    // Statutory Taxation & Filing Details
    const statutoryTaxDetails = Array.isArray(additionalDetails.statutoryTaxDetails) ? additionalDetails.statutoryTaxDetails : [];
    const validStatutoryTax = statutoryTaxDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));

    // Build directors and promoters list for company snapshot page
    // If executive has made a selection via MCA Director Picker, use only those.
    // Otherwise fall back to all MCA directors.
    // Format: { selectionMade: boolean, directors: [...] } or legacy array
    const mcaDirPayload = p.selectedMcaDirectors || {};
    const selectionWasMade = Array.isArray(mcaDirPayload) 
      ? mcaDirPayload.length > 0 
      : !!mcaDirPayload.selectionMade;
    const selectedMcaDirs = Array.isArray(mcaDirPayload) 
      ? mcaDirPayload 
      : (Array.isArray(mcaDirPayload.directors) ? mcaDirPayload.directors : []);

    const csDirectorsList = (() => {
      if (selectionWasMade && selectedMcaDirs.length) {
        // Executive explicitly picked directors from MCA — use those
        return selectedMcaDirs.map(d => {
          const name = (d?.name || '').trim();
          const din = (d?.din || '').trim();
          return din ? `${name} (DIN: ${din})` : name;
        }).filter(Boolean);
      }
      if (selectionWasMade && selectedMcaDirs.length === 0) {
        // Executive explicitly cleared all MCA directors — show none from MCA
        return [];
      }
      // No selection ever made — fallback: all MCA directors
      const dirs = mca && Array.isArray(mca.directors) ? mca.directors : [];
      return dirs.map(d => d?.name || d?.directorName || '').filter(Boolean);
    })();
    // Promoters from additionalDetails / personalInfo — always shown alongside directors
    const csPromotersList = (() => {
      const prs = Array.isArray(p?.personalInfo?.promoters) ? p.personalInfo.promoters
        : Array.isArray(additionalDetails.promoters) ? additionalDetails.promoters
        : [];
      return prs.map(pr => (typeof pr === 'string' ? pr : (pr?.name || '')).trim()).filter(Boolean);
    })();

    // Filed Agent / Site Visit data
    const filedAgentData = p.filedAgentData && typeof p.filedAgentData === 'object' ? p.filedAgentData : null;
    const faFields = filedAgentData?.fields || {};
    const faImages = Array.isArray(filedAgentData?.images) ? filedAgentData.images.filter(img => img && img.dataUrl) : [];

    // Resident Verification data (address + images)
    const residentVerificationData = p.residentVerificationData && typeof p.residentVerificationData === 'object' ? p.residentVerificationData : null;
    const rvAddress = residentVerificationData?.addressData || {};
    const rvImages = Array.isArray(residentVerificationData?.images) ? residentVerificationData.images.filter(img => img && img.dataUrl) : [];

    // Personal Information Block data (applicant, PAN, Aadhaar, resident_verification)
    const personalInfo = p.personalInfo && typeof p.personalInfo === 'object' ? p.personalInfo : {};
    const piApplicant = personalInfo.applicant || {};
    const piPan = personalInfo.pan || {};
    const piAadhaar = personalInfo.aadhaar || {};
    const piRV = personalInfo.resident_verification || {};

    // PAN verified photo (from personal block PAN data)
    const panVerifiedPhoto = (() => {
      const pn = piPan.primary || {};
      if (pn.verified_photo_url && typeof pn.verified_photo_url === 'string' && pn.verified_photo_url.startsWith('data:')) return pn.verified_photo_url;
      if (pn.photo_url && typeof pn.photo_url === 'string' && pn.photo_url.startsWith('data:')) return pn.photo_url;
      // Also check verified_document.data_url (personal block upload stores docs here)
      if (pn.verified_document && typeof pn.verified_document === 'object' && pn.verified_document.data_url && typeof pn.verified_document.data_url === 'string' && pn.verified_document.data_url.startsWith('data:')) return pn.verified_document.data_url;
      return null;
    })();

    // Aadhaar verified document (from personal block)
    const aadhaarDocPhoto = (() => {
      const aa = piAadhaar.primary || {};
      if (aa.verified_document && typeof aa.verified_document === 'object') {
        if (aa.verified_document.data_url && typeof aa.verified_document.data_url === 'string' && aa.verified_document.data_url.startsWith('data:')) return aa.verified_document.data_url;
      }
      return null;
    })();

    // Udyam document image (from payload or module data)
    const udyamDocImageFromModule = (() => {
      const um = modules?.udyam || {};
      if (um.pdf_data_url && typeof um.pdf_data_url === 'string' && um.pdf_data_url.startsWith('data:')) return um.pdf_data_url;
      if (um.document_image && typeof um.document_image === 'string' && um.document_image.startsWith('data:')) return um.document_image;
      return null;
    })();
    const udyamDocImage = udyamDocumentImage || udyamDocImageFromModule;

    // Nature of business from Udyam
    const udyamNatureOfBusiness = (() => {
      const um = modules?.udyam || {};
      return um.nature_of_activity || um.major_activity || um.nic_2_digit || um.nic_code || um.activity || '';
    })();

    const escapeHtml = (value) => {
      if (value == null) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const safe = (value, fallback = '—') => {
      const s = value == null ? '' : String(value).trim();
      return s ? escapeHtml(s) : escapeHtml(fallback);
    };

    const prettyValue = (value) => {
      if (value == null) return '—';
      if (typeof value === 'string') return value.trim() || '—';
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try {
        const text = JSON.stringify(value, null, 2);
        if (!text) return '—';
        return text.length > 1400 ? `${text.slice(0, 1400)}\n... [truncated]` : text;
      } catch {
        return String(value);
      }
    };

    const yn = (value) => {
      if (value === true) return 'Yes';
      if (value === false) return 'No';
      if (value == null) return '—';
      const s = String(value).toLowerCase();
      if (s === 'yes' || s === 'y') return 'Yes';
      if (s === 'no' || s === 'n') return 'No';
      return '—';
    };

    const formatDate = (value) => {
      if (!value) return '—';
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return safe(value);
      return escapeHtml(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    };

    const parseNum = (value) => {
      if (value == null) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const cleaned = String(value).replace(/[^0-9.\-]/g, '').replace(/\.(?=.*\.)/g, '');
      if (!cleaned) return null;
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : null;
    };

    const formatNum = (value, digits = 2) => {
      const n = parseNum(value);
      if (n == null) return '—';
      return escapeHtml(n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
    };

    const formatPct = (value) => {
      const n = parseNum(value);
      if (n == null) return '—';
      return escapeHtml(`${n.toFixed(2)}%`);
    };

    const collectNumericPaths = (obj, basePath = '', out = []) => {
      if (obj == null) return out;
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => collectNumericPaths(item, `${basePath}[${idx}]`, out));
        return out;
      }
      if (typeof obj === 'object') {
        Object.entries(obj).forEach(([k, v]) => {
          const nextPath = basePath ? `${basePath}.${k}` : k;
          collectNumericPaths(v, nextPath, out);
        });
        return out;
      }
      const n = parseNum(obj);
      if (n != null) out.push({ path: basePath, value: obj, number: n });
      return out;
    };

    const firstMatchFromCandidates = (candidates, regexList) => {
      if (!Array.isArray(candidates) || !candidates.length) return null;
      for (const re of regexList) {
        const found = candidates.find((c) => re.test(String(c.path || '')));
        if (found) return found.number;
      }
      return null;
    };

    const reportDate = c.reportDate || new Date().toISOString();
    const caseId = c.caseId || '—';

    const companyName =
      c.companyName ||
      c.businessName ||
      (mca && (mca.companyName || mca.company || mca.name)) ||
      (gst && (gst.legalName || gst.tradeName)) ||
      '—';

    const businessType = c.businessType || c.constitution || (gst && (gst.constitutionOfBusiness || gst.constitution)) || '—';
    const gstin = (gst && (gst.gstin || gst.GSTIN)) || c.gstin || '—';
    const cin = (mca && (mca.cin || mca.CIN)) || c.cin || '—';
    const registeredOffice = (mca && (mca.registeredOffice || mca.registeredOfficeAddress || mca.registeredAddress)) || (gst && (gst.address || gst.principalAddress)) || '—';

    const promoterText = (() => {
      const directors = mca && Array.isArray(mca.directors) ? mca.directors : [];
      if (directors.length) {
        const top = directors.slice(0, 4).map((d) => {
          const name = d?.name || d?.directorName || '—';
          const din = d?.din || d?.DIN || '';
          return din ? `${name} (DIN: ${din})` : `${name}`;
        });
        return escapeHtml(top.join('; '));
      }
      return escapeHtml('—');
    })();

    const overallRisk = (c.overallRisk || c.riskAssessment || '').toString().trim();
    const overallRiskLabel = overallRisk ? escapeHtml(overallRisk) : 'Medium';

    // ── 10 standard compliance categories mapped from findings ──
    const complianceFindings = Array.isArray(modules.compliance?.findings)
      ? modules.compliance.findings
      : [];
    const complianceSections = modules.compliance?.sections || modules.compliance || {};

    // Map source names from findings to our canonical keys
    const findingsByKey = {};
    complianceFindings.forEach((item) => {
      const src = (item?.source || '').toUpperCase().trim();
      if (src.includes('NCLT') || src.includes('IBBI')) findingsByKey.nclt = item;
      else if (src.includes('COURT') || src.includes('LITIGATION')) findingsByKey.court = item;
      else if (src.includes('SEBI')) {
        // If multiple SEBI findings, map to sebi_orders (primary)
        if (!findingsByKey.sebi) findingsByKey.sebi = item;
      }
      else if (src.includes('NSE')) findingsByKey.nse = item;
      else if (src.includes('BSE')) findingsByKey.bse = item;
      else if (src.includes('RBI')) findingsByKey.rbi = item;
      else if (src.includes('FIU') || src.includes('FINANCIAL INTELLIGENCE')) findingsByKey.fiu = item;
      else if (src.includes('SFIO') || src.includes('SERIOUS FRAUD')) findingsByKey.sfio = item;
    });

    const COMPLIANCE_CATEGORIES = [
      { key: 'rbi', label: 'RBI Defaulter\'s List' },
      { key: 'nclt', label: 'NCLT Checks' },
      { key: 'court', label: 'Litigation Checks (High Court & Supreme Court)' },
      { key: 'sebi_summons', label: 'SEBI Un-Served Summons / Notices' },
      { key: 'sebi_consent', label: 'SEBI Consent Application Rejections' },
      { key: 'sebi', label: 'SEBI Court Orders' },
      { key: 'nse', label: 'NSE Defaulters / Expelled Members' },
      { key: 'bse', label: 'BSE Defaulters / Expelled Members' },
      { key: 'fiu', label: 'Financial Intelligence Unit' },
      { key: 'sfio', label: 'Serious Fraud Investigation Office' }
    ];

    const complianceRows = COMPLIANCE_CATEGORIES.map((cat) => {
      // Try findings first, then sections, then direct keys
      const f = findingsByKey[cat.key] || null;
      const s = complianceSections?.[cat.key] || {};
      if (f) {
        return {
          label: cat.label,
          adverse: f.match_found === true ? true : f.match_found === false ? false : null,
          riskFlag: f.risk_flag || '',
          date: f.checked_at || null,
          remarks: f.details || ''
        };
      }
      if (s && (s.adverse !== undefined || s.summary || s.risk_flag)) {
        return {
          label: cat.label,
          adverse: s.adverse,
          riskFlag: s.risk_flag || s.riskFlag || '',
          date: s.date || null,
          remarks: s.remarks || s.details || s.summary || ''
        };
      }
      // Not checked / no data
      return {
        label: cat.label,
        adverse: null,
        riskFlag: '',
        date: null,
        remarks: ''
      };
    });

    const financialModule = modules.financial && typeof modules.financial === 'object' ? modules.financial : {};
    const financialAnalysis = financialModule.analysis && typeof financialModule.analysis === 'object' ? financialModule.analysis : {};
    const matchedFields = Array.isArray(financialAnalysis.matched_fields) ? financialAnalysis.matched_fields : [];
    const keyDifferences = Array.isArray(financialAnalysis.key_differences) ? financialAnalysis.key_differences : [];
    const riskFlags = Array.isArray(financialAnalysis.risk_flags) ? financialAnalysis.risk_flags : [];

    const doc1Extract = financialModule?.raw?.doc1?.extracted ?? financialModule?.raw?.doc1 ?? {};
    const doc2Extract = financialModule?.raw?.doc2?.extracted ?? financialModule?.raw?.doc2 ?? {};

    const doc1Numbers = collectNumericPaths(doc1Extract);
    const doc2Numbers = collectNumericPaths(doc2Extract);

    const metrics = {
      netSalesCurrent: firstMatchFromCandidates(doc1Numbers, [/net.?sales/i, /total.?operating.?income/i, /turnover/i, /revenue/i]),
      netSalesPrevious: firstMatchFromCandidates(doc2Numbers, [/net.?sales/i, /total.?operating.?income/i, /turnover/i, /revenue/i]),
      pbildtCurrent: firstMatchFromCandidates(doc1Numbers, [/pbildt/i, /ebitda/i]),
      opatCurrent: firstMatchFromCandidates(doc1Numbers, [/opat/i, /apat/i, /profit.?after.?tax/i, /net.?profit/i]),
      currentAssets: firstMatchFromCandidates(doc1Numbers, [/total.?current.?assets/i, /current.?assets/i]),
      currentLiabilities: firstMatchFromCandidates(doc1Numbers, [/total.?current.?liabilit/i, /current.?liabilit/i]),
      totalDebt: firstMatchFromCandidates(doc1Numbers, [/total.?debt/i, /outside.?liabilit/i, /long.?term.?debt/i, /short.?term.?debt/i]),
      netWorth: firstMatchFromCandidates(doc1Numbers, [/net.?worth/i, /tangible.?net.?worth/i, /equity/i])
    };

    const yoySalesGrowth =
      metrics.netSalesCurrent != null && metrics.netSalesPrevious != null && metrics.netSalesPrevious !== 0
        ? ((metrics.netSalesCurrent - metrics.netSalesPrevious) / Math.abs(metrics.netSalesPrevious)) * 100
        : null;

    const pbildtMargin =
      metrics.pbildtCurrent != null && metrics.netSalesCurrent != null && metrics.netSalesCurrent !== 0
        ? (metrics.pbildtCurrent / metrics.netSalesCurrent) * 100
        : null;

    const opatMargin =
      metrics.opatCurrent != null && metrics.netSalesCurrent != null && metrics.netSalesCurrent !== 0
        ? (metrics.opatCurrent / metrics.netSalesCurrent) * 100
        : null;

    const currentRatio =
      metrics.currentAssets != null && metrics.currentLiabilities != null && metrics.currentLiabilities !== 0
        ? (metrics.currentAssets / metrics.currentLiabilities)
        : null;

    const debtToNetWorth =
      metrics.totalDebt != null && metrics.netWorth != null && metrics.netWorth !== 0
        ? (metrics.totalDebt / metrics.netWorth)
        : null;

    const matchedFieldsTable = matchedFields.length
      ? `
        <table class="tbl" style="margin-top:8px">
          <thead>
            <tr>
              <th>Field</th>
              <th>Doc 1</th>
              <th>Doc 2</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${matchedFields.slice(0, 20).map((m) => `
              <tr>
                <td>${safe(m?.field || '')}</td>
                <td>${safe(m?.doc1_value || '')}</td>
                <td>${safe(m?.doc2_value || '')}</td>
                <td>${safe(m?.status || '')}</td>
                <td>${safe(m?.remarks || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : '<div class="muted" style="margin-top:8px">No field-match rows available yet.</div>';

    const financialDiffList = keyDifferences.length
      ? `<ul class="ul">${keyDifferences.slice(0, 12).map((d) => `<li><strong>${safe(d?.topic || 'Difference')}:</strong> ${safe(d?.detail || '')} ${d?.severity ? `(Severity: ${safe(d.severity)})` : ''}</li>`).join('')}</ul>`
      : '<div class="muted">No key differences captured.</div>';

    const financialRiskList = riskFlags.length
      ? `<ul class="ul">${riskFlags.slice(0, 12).map((r) => `<li><strong>${safe(r?.flag || 'Risk')}:</strong> ${safe(r?.rationale || '')} ${r?.severity ? `(Severity: ${safe(r.severity)})` : ''}</li>`).join('')}</ul>`
      : '<div class="muted">No risk flags captured.</div>';

    // ── Build Financial Calc Engine Section (yearwise tables) ──
    const buildFinancialCalcHtml = () => {
      // The financial module holds calc-engine output when source is 'financial-calc-engine'
      const fc = financialModule;
      const fcYears = Array.isArray(fc.years) ? fc.years : [];
      if (!fcYears.length) return '';

      const fmtN = (v, digits = 2) => {
        if (v == null || v === 0) return '—';
        if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
        return v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
      };
      const fmtP = (v) => {
        if (v == null || v === 0) return '—';
        if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
        return v.toFixed(2) + '%';
      };
      const fmtD = (v) => {
        if (v == null || v === 0) return '—';
        if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
        return v.toFixed(1);
      };
      // Keys whose values represent days, not percentages
      const daysKeys = new Set(['avg_collection_period','avg_creditors_period','working_capital_cycle']);

      const headers = fcYears.map(y => escapeHtml(y.period || 'Year'));

      // Asset keys (balance sheet)
      const bsAssetKeys = [
        'gross_block','accumulated_depreciation','net_block','capital_work_in_progress','net_fixed_assets',
        'investments_affiliate','marketable_securities','total_investments',
        'receivables_gt6m','receivables_lt6m','provision_doubtful_debts','bills_receivable','total_receivables',
        'loans_advances_subsidiaries','loans_advances_affiliates','loans_advances_current_ops',
        'cash_and_bank','total_inventories_non_ops','loans_advances_non_ops','advance_tax_paid',
        'total_other_assets','total_current_assets_ops','total_assets'
      ];
      // Liability keys (balance sheet)
      const bsLiabilityKeys = [
        'paid_up_equity_share_capital','share_application_money','quasi_equity',
        'gross_reserves','intangible_assets','misc_expenses_not_written_off','debit_balance_pnl',
        'net_reserves','tangible_net_worth',
        'deferred_payment_credit','rupee_term_loans','total_long_term_debt','current_portion_ltd','net_long_term_debt',
        'current_portion_ltd_dup','working_capital_bank_borrowings','intercorporate_borrowings',
        'loans_advances_from_subsidiaries','loans_advances_from_promoters','other_short_term_loans','new_short_term_loans',
        'total_short_term_debt',
        'creditors_for_goods','creditors_for_expenses','other_current_liabilities_ops','current_liabilities_non_ops',
        'total_other_liabilities','provision_dividend','provision_taxes','other_provisions_regular','total_provisions',
        'total_current_liabilities_ops','total_outside_liabilities','total_liabilities'
      ];

      const sections = [
        { title: 'Profitability Statement', key: 'profit_and_loss' },
        { title: 'Balance Sheet — Assets', key: 'balance_sheet', filterKeys: bsAssetKeys },
        { title: 'Balance Sheet — Liabilities', key: 'balance_sheet', filterKeys: bsLiabilityKeys },
        { title: 'Profitability Ratios', key: 'profitability' },
        { title: 'Liquidity', key: 'liquidity' },
        { title: 'Capital Structure', key: 'capital_structure' },
        { title: 'Solvency', key: 'solvency' },
        { title: 'Turnover', key: 'turnover' },
        { title: 'Growth', key: 'growth' }
      ];

      let sectionsHtml = '';
      const ratioSections = new Set(['profitability','growth']);

      sections.forEach(sec => {
        // Collect all keys for this section across all years
        const allKeys = [];
        fcYears.forEach(y => {
          const obj = y.computed ? y.computed[sec.key] : null;
          if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach(k => { if (!allKeys.includes(k)) allKeys.push(k); });
          }
        });
        // If filterKeys is defined, only include those keys (in order) that exist in allKeys
        const displayKeys = sec.filterKeys
          ? sec.filterKeys.filter(k => allKeys.includes(k))
          : allKeys;
        if (!displayKeys.length) return;

        // Highlight keys (totals / subtotals) get bold styling
        const highlightKeys = ['net_fixed_assets','total_investments','total_receivables','total_other_assets','total_current_assets_ops','total_assets','tangible_net_worth','total_long_term_debt','net_long_term_debt','total_short_term_debt','total_other_liabilities','total_provisions','total_current_liabilities_ops','total_outside_liabilities','total_liabilities'];

        // Each section is a separate compact table with break-inside:avoid
        let secHtml = '<div style="break-inside:avoid;page-break-inside:avoid;margin-bottom:4px">';
        secHtml += '<table class="tbl" style="font-size:10px;margin-bottom:0"><thead><tr>';
        secHtml += '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10px;padding:5px 6px;width:40%;letter-spacing:0.3px">' + escapeHtml(sec.title) + '</th>';
        headers.forEach(h => { secHtml += '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10px;padding:5px 6px;text-align:right">' + h + '</th>'; });
        secHtml += '</tr></thead><tbody>';

        displayKeys.forEach(k => {
          let label = k.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
          if (daysKeys.has(k)) label += ' (in Days)';
          const isBold = highlightKeys.includes(k);
          const rowStyle = isBold ? 'background:rgba(11,31,58,0.06);font-weight:800' : '';
          secHtml += '<tr' + (rowStyle ? ' style="' + rowStyle + '"' : '') + '><td class="k" style="font-size:10px;padding:3px 6px' + (isBold ? ';font-weight:800;color:var(--navy,#0b1f3a)' : '') + '">' + escapeHtml(label) + '</td>';
          fcYears.forEach(y => {
            const v = (y.computed && y.computed[sec.key]) ? y.computed[sec.key][k] : undefined;
            let display = '—';
            if (typeof v === 'number' && Number.isFinite(v)) {
              display = daysKeys.has(k) ? fmtD(v) : (ratioSections.has(sec.key) ? fmtP(v) : fmtN(v));
            } else if (v != null) {
              display = escapeHtml(String(v));
            }
            secHtml += '<td style="text-align:right;font-size:10px;padding:3px 6px">' + display + '</td>';
          });
          secHtml += '</tr>';
        });

        secHtml += '</tbody></table></div>';
        sectionsHtml += secHtml;
      });

      return `
        <div style="margin-top:8px;padding:8px 10px">
          ${sectionsHtml}
        </div>`;
    };
    const financialCalcHtml = buildFinancialCalcHtml();

    const hasAdverse = complianceRows.some((r) => r.adverse === true || String(r.adverse || '').toLowerCase() === 'yes');
    const totalChecks = complianceRows.filter((r) => r.adverse === true || r.adverse === false || String(r.adverse || '').toLowerCase() === 'yes' || String(r.adverse || '').toLowerCase() === 'no').length;
    const adverseCount = complianceRows.filter((r) => r.adverse === true || String(r.adverse || '').toLowerCase() === 'yes').length;
    const cleanCount = complianceRows.filter((r) => r.adverse === false || String(r.adverse || '').toLowerCase() === 'no').length;
    const pendingCount = complianceRows.filter((r) => r.adverse === null && String(r.adverse || '').toLowerCase() !== 'yes' && String(r.adverse || '').toLowerCase() !== 'no').length;

    const signatureDataUrl = officer.signatureImage?.dataUrl || '';
    const stampDataUrl = officer.stampImage?.dataUrl || '';
    const officerPhotoDataUrl = officer.photoImage?.dataUrl || '';
    const assignedTo = typeof p.assignedTo === 'string' ? p.assignedTo.trim() : '';
    const preparedBy = typeof p.preparedBy === 'string' ? p.preparedBy.trim() : '';



    const selectedModules = Array.isArray(p?.reportConfig?.selectedModules)
      ? p.reportConfig.selectedModules.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean)
      : [];

    // ── Module selection gate — only ticked modules appear in the report ──
    const selSet = new Set(selectedModules);
    const isModuleSelected = (key) => selSet.has(key);

    const showGst = isModuleSelected('gst');
    const showMca = isModuleSelected('mca');
    const showEntity = showGst || showMca;
    const showGstDetail = showGst;
    const showStatutory = showGst || showMca;
    const showFinancial = isModuleSelected('financial');
    const showCompliance = isModuleSelected('compliance');

    const dynamicModuleEntries = Object.entries(modules || {})
      .filter(([key, value]) => key && value != null)
      .filter(([key]) => key !== 'compliance' && key !== 'gst' && key !== 'financial' && key !== 'mca' && key !== 'udyam' && key !== 'itr')
      .filter(([key]) => selSet.has(String(key || '').trim().toLowerCase()));

    const dynamicModulesHtml = dynamicModuleEntries.length
      ? dynamicModuleEntries.map(([moduleKey, moduleValue]) => {
        const dataObj = moduleValue && typeof moduleValue === 'object' ? moduleValue : { value: moduleValue };
        const rows = Object.entries(dataObj)
          .slice(0, 28)
          .map(([k, v]) => `<tr><td class="k">${safe(k)}</td><td><pre style="margin:0;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:1.45">${safe(prettyValue(v))}</pre></td></tr>`)
          .join('');

        let aiSummary = moduleSummaries[moduleKey] ? String(moduleSummaries[moduleKey]).trim() : '';

        // Fallback: if no AI summary, generate a basic manual summary from data keys
        if (!aiSummary) {
          const keys = Object.keys(dataObj).filter(k => {
            const v = dataObj[k];
            return v != null && String(v).trim() !== '' && String(v).trim() !== '—';
          });
          if (keys.length) {
            const moduleLabel = moduleKey.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
            aiSummary = `${moduleLabel} module data reviewed. Key fields: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ` and ${keys.length - 8} more fields` : ''}. Manual verification recommended.`;
          }
        }

        const aiSummaryHtml = aiSummary
          ? `<div class="ai-section" style="margin-top:10px;padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">
              <div style="font-weight:800;font-size:11px;color:#1b2559;margin-bottom:6px;letter-spacing:0.5px">${moduleSummaries[moduleKey] ? 'VERIFICATION SUMMARY' : 'MODULE SUMMARY'}</div>
              <div style="font-size:11.5px;line-height:1.55;white-space:pre-wrap">${safe(aiSummary)}</div>
            </div>`
          : '';

        return `
          <div class="block" style="margin-top:10px">
            <h3 style="margin-bottom:8px;font-size:13px;color:#1a3c5e">Module: ${safe(moduleKey.toUpperCase())}</h3>
            ${aiSummaryHtml}
            <table class="tbl" style="margin-top:8px">
              <tbody>
                ${rows || '<tr><td class="muted" colspan="2">No structured values available</td></tr>'}
              </tbody>
            </table>
          </div>
        `;
      }).join('')
      : '<div class="muted">No additional module data was found in payload.modules.</div>';

    // ── Pre-compute dynamic section numbering and HTML ──
    // Sequential numbering: only visible sections get a number
    let _sn = 1; // Cover = section 1 (implicit)
    const secExecSummary = ++_sn; // always shown
    const secEntity = showEntity ? ++_sn : 0;
    const secGstDetailLabel = showGstDetail && secEntity ? `${secEntity}A` : '';
    const secStatutory = showStatutory ? ++_sn : 0;
    const secFinancial = showFinancial ? ++_sn : 0;
    const secCompliance = showCompliance ? ++_sn : 0;
    const conclusionSecNum = ++_sn; // always shown

    const hasSiteVisit = isModuleSelected('filed_agent') && ((faFields && Object.values(faFields).some(v => v)) || faImages.length > 0);
    const hasResident = (rvAddress && Object.values(rvAddress).some(v => v)) || rvImages.length > 0;
    const hasFieldData = isModuleSelected('field_data') && fieldImages.length > 0;
    const hasUdyam = isModuleSelected('udyam') && (!!p.udyamPdfBase64 || !!(modules?.udyam?.udyam_number || modules?.udyam?.udyamRegistrationNumber || modules?.udyam?.nature_of_activity || modules?.udyam?.enterprise_type));

    // ITR data (entries array from itr module)
    const itrModuleData = modules?.itr || {};
    const itrEntries = (() => {
      if (Array.isArray(itrModuleData.entries)) return itrModuleData.entries.filter(e => e && e.assessment_year);
      if (Array.isArray(itrModuleData)) return itrModuleData.filter(e => e && e.assessment_year);
      // Walk the object to find entries array
      const walk = (obj, depth) => {
        if (!obj || depth > 3) return [];
        if (Array.isArray(obj)) return obj.filter(e => e && typeof e === 'object' && e.assessment_year);
        if (typeof obj === 'object') {
          for (const v of Object.values(obj)) {
            const found = walk(v, depth + 1);
            if (found.length) return found;
          }
        }
        return [];
      };
      return walk(itrModuleData, 0);
    })();
    const hasItr = isModuleSelected('itr') && itrEntries.length > 0;

    // Check if personal info block has meaningful data
    const hasPersonalInfo = (() => {
      const ap = piApplicant.primary || {};
      const pn = piPan.primary || {};
      const aa = piAadhaar.primary || {};
      return !!(ap.name || ap.mobile || ap.email || pn.pan_number || pn.name || aa.aadhaar_number || aa.name);
    })();

    const udyamSecNum = hasUdyam ? ++_sn : 0;
    const fieldDataSecNum = hasFieldData ? ++_sn : 0;
    const siteVisitSecNum = hasSiteVisit ? ++_sn : 0;
    const personalInfoSecNum = hasPersonalInfo ? ++_sn : 0;
    const residentSecNum = hasResident ? ++_sn : 0;
    const overallObsSecNum = overallObservation ? ++_sn : 0;


    // ── Build Personal Information HTML (separate page per section per person) ──
    // Personal module selection gate — only checked personal modules appear in report
    const selectedPersonalModules = Array.isArray(p?.reportConfig?.selectedPersonalModules)
      ? p.reportConfig.selectedPersonalModules.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const personalSelSet = new Set(selectedPersonalModules);
    const isPersonalModuleSelected = (key) => personalSelSet.has(key);

    const buildPersonalInfoHtml = () => {
      if (!hasPersonalInfo) return '';
      // If personal modules were explicitly configured but none selected, skip entirely
      if (personalSelSet.size === 0 && Array.isArray(p?.reportConfig?.selectedPersonalModules)) return '';
      const ap = piApplicant.primary || {};
      const pn = piPan.primary || {};
      const aa = piAadhaar.primary || {};
      const rv = piRV.primary || {};

      // Helper: get designated persons array from any module (with backward compat)
      const getDesignatedPersons = (moduleData) => {
        if (!moduleData || typeof moduleData !== 'object') return [];
        if (Array.isArray(moduleData.designatedPersons) && moduleData.designatedPersons.length) return moduleData.designatedPersons;
        const dp = [];
        if (Array.isArray(moduleData.coapplicants)) {
          moduleData.coapplicants.forEach(co => { if (co && typeof co === 'object') dp.push({ ...co, designation: co.designation || 'Co-Applicant' }); });
        }
        if (Array.isArray(moduleData.promoters)) {
          moduleData.promoters.forEach(pr => { if (pr && typeof pr === 'object') dp.push({ ...pr, designation: pr.designation || 'Promoter' }); });
        }
        return dp;
      };

      // Shared styles for person pages
      const pgBreak = 'page-break-before:always;break-before:page';
      const tblHead = 'background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px';
      const tdK = 'padding:8px 14px;font-weight:700;color:#475569;width:35%;border-bottom:1px solid #e2e8f0';
      const tdV = 'padding:8px 14px;border-bottom:1px solid #e2e8f0';
      const altBg = 'background:#fbfcfe';
      const secTitle = (text) => '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase">' + text + '</div>';
      const wrapTable = (headerText, bodyRows) => {
        if (!bodyRows) return '';
        return '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">'
          + '<table style="width:100%;border-collapse:collapse;font-size:11.5px">'
          + '<thead><tr><th colspan="2" style="' + tblHead + '">' + headerText + '</th></tr></thead>'
          + '<tbody>' + bodyRows + '</tbody></table></div>';
      };
      const mkRow = (label, value, alt) => value ? '<tr' + (alt ? ' style="' + altBg + '"' : '') + '><td style="' + tdK + '">' + label + '</td><td style="' + tdV + '">' + safe(value) + '</td></tr>' : '';
      const mkRowBold = (label, value, alt) => value ? '<tr' + (alt ? ' style="' + altBg + '"' : '') + '><td style="' + tdK + '">' + label + '</td><td style="' + tdV + ';font-weight:800;letter-spacing:0.5px">' + safe(value) + '</td></tr>' : '';
      const statusBadge = (status) => {
        const s = String(status || '').toUpperCase();
        const color = s === 'ACTIVE' ? 'background:#dcfce7;color:#166534' : s === 'INACTIVE' ? 'background:#fee2e2;color:#991b1b' : 'background:#f1f5f9;color:#475569';
        return '<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-weight:700;font-size:10.5px;' + color + '">' + safe(s) + '</span>';
      };

      // Helper: build resident verification rows for any rv object
      const buildRVRows = (rvObj) => {
        let rows = '';
        let alt = false;
        const addRow = (label, value) => { if (value) { rows += mkRow(label, value, alt); alt = !alt; } };
        addRow('Promoter Name', rvObj.promoter_name);
        addRow('Permanent Address', rvObj.permanent_address);
        addRow('Present Address', rvObj.present_address);
        addRow('Address', rvObj.address);
        addRow('Locality', rvObj.locality);
        addRow('City', rvObj.city);
        addRow('State', rvObj.state);
        addRow('Pincode', rvObj.pincode);
        addRow('Landmark', rvObj.landmark);
        addRow('Phone', rvObj.phone);
        addRow('Mobile', rvObj.mobile);
        addRow('Email', rvObj.email);
        addRow('Residing at Address?', rvObj.residing_at_address);
        addRow('Ownership', rvObj.ownership);
        addRow('Residing Since', rvObj.residing_since);
        addRow('Family Members', rvObj.family_members);
        addRow('Earning Members', rvObj.earning_members);
        addRow('Locality Type', rvObj.locality_type);
        addRow('Residence Type', rvObj.residence_type);
        addRow('Construction', rvObj.construction_type);
        addRow('External Appearance', rvObj.external_appearance);
        addRow('Internal Appearance', rvObj.internal_appearance);
        addRow('Area of Residence', rvObj.area_of_residence);
        addRow('No. of Storied', rvObj.no_of_storied);
        addRow('Lift', rvObj.lift);
        addRow('Society Board', rvObj.society_board);
        addRow('Name Plate Sighted', rvObj.name_plate_sighted);
        addRow('Confirmed with Society', rvObj.residence_confirmed_society);
        addRow('Residence Seen Internally?', rvObj.residence_seen_internally);
        // Assets Seen
        addRow('Television', rvObj.asset_television);
        addRow('Refrigerator', rvObj.asset_refrigerator);
        addRow('Air Conditioner', rvObj.asset_ac);
        addRow('Music System', rvObj.asset_music_system);
        // Vehicles
        addRow('4 Wheelers', rvObj.vehicle_4wheeler);
        addRow('Two Wheelers', rvObj.vehicle_2wheeler);
        addRow('Other Vehicles', rvObj.vehicle_others);
        addRow('Vehicle Make & Type', rvObj.vehicle_make_type);
        // Document Verified for Confirmation of Address (only show if 'Yes')
        const addDocRow = (label, val) => { if (val && val !== 'No') addRow('Address Verified via ' + label, val); };
        addDocRow('Telephone Bill', rvObj.doc_telephone_bill);
        addDocRow('Electricity Bill', rvObj.doc_electricity_bill);
        addDocRow('Society Bill', rvObj.doc_society_bill);
        addDocRow('Tax Receipt', rvObj.doc_tax_receipt);
        addDocRow('Aadhaar Card', rvObj.doc_aadhaar_card);
        addDocRow('Voter Card', rvObj.doc_voter_card);
        addDocRow('Title Deeds', rvObj.doc_title_deeds);
        addDocRow('Bank Passbook', rvObj.doc_bank_passbook);
        addRow('Address Verified via Other Document', rvObj.doc_other);
        // Property Details
        addRow('Approximate Rent', rvObj.approx_rent);
        addRow('Approximate Value', rvObj.approx_value);
        addRow('Tenant Residing?', rvObj.tenant_residing);
        addRow('Tenant Name', rvObj.tenant_name);
        addRow('Tenant Since', rvObj.tenant_since);
        addRow('Tenant Rent', rvObj.tenant_rent);
        addRow('Tenant Docs Verified', rvObj.tenant_docs_verified);
        addRow('Tenant Confirms Owner?', rvObj.tenant_confirms_owner);
        // Neighbour Feedback
        addRow('Neighbour [1] Name', rvObj.neighbour1_name);
        addRow('Neighbour [1] Phone', rvObj.neighbour1_phone);
        addRow('Neighbour [2] Name', rvObj.neighbour2_name);
        addRow('Neighbour [2] Phone', rvObj.neighbour2_phone);
        addRow('Neighbour Findings', rvObj.neighbour_findings);
        addRow('Special Remarks', rvObj.special_remarks);
        addRow('Remarks', rvObj.remarks);
        return rows;
      };

      // Helper: build a 2-column photo grid for RV images (mirrors buildPhotoGrid outside)
      const isFileNameStr = (s) => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(s);
      const buildRVPhotoGrid = (images) => {
        if (!images || !images.length) return '';
        const getLabel = (img) => {
          const lbl = img.label || '';
          if (!lbl || isFileNameStr(lbl)) return '';
          return lbl;
        };
        if (images.length === 1) {
          const img = images[0];
          const lbl = getLabel(img);
          return '<div class="photo-card">' + (lbl ? '<div class="photo-label">' + escapeHtml(lbl) + '</div>' : '') + '<img src="' + escapeHtml(img.dataUrl) + '" alt="' + escapeHtml(lbl || 'Residence Verification') + '" class="photo-img" /></div>';
        }
        let grid = '<div class="photo-grid">';
        images.forEach(function(img, idx) {
          const lbl = getLabel(img);
          grid += '<div class="photo-card">' + (lbl ? '<div class="photo-label">' + escapeHtml(lbl) + '</div>' : '') + '<img src="' + escapeHtml(img.dataUrl) + '" alt="' + escapeHtml(lbl || 'Residence Verification ' + (idx + 1)) + '" class="photo-img" /></div>';
        });
        grid += '</div>';
        return grid;
      };

      // Helper: build ITR table for any entries array
      const buildItrTable = (entries) => {
        if (!entries.length) return '';
        let html = '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
        html += '<thead><tr><th colspan="6" style="' + tblHead + '">INCOME TAX RETURN DETAILS</th></tr>';
        html += '<tr style="background:#f0f4f8;font-weight:700;font-size:10px"><th style="padding:6px 10px;text-align:left">AY</th><th style="padding:6px 10px;text-align:left">Ward</th><th style="padding:6px 10px;text-align:left">Filed On</th><th style="padding:6px 10px;text-align:right">Total Income</th><th style="padding:6px 10px;text-align:right">Tax Paid</th><th style="padding:6px 10px;text-align:left">Ack No.</th></tr></thead><tbody>';
        entries.forEach((e, i) => {
          const bg = i % 2 === 0 ? altBg : '';
          html += '<tr' + (bg ? ' style="' + bg + '"' : '') + '>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">' + safe(e.assessment_year) + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">' + safe(e.ward) + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">' + safe(e.return_filed_on) + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">' + safe(e.total_income) + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums">' + safe(e.tax_paid) + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">' + safe(e.acknowledgement_no) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
      };

      // Helper: extract PAN photos from pan data object (returns { img1, img2 })
      const extractPanPhotos = (panObj) => {
        let img1 = null, img2 = null;
        if (panObj.verified_photo_url && typeof panObj.verified_photo_url === 'string' && panObj.verified_photo_url.startsWith('data:')) img1 = panObj.verified_photo_url;
        else if (panObj.photo_url && typeof panObj.photo_url === 'string' && panObj.photo_url.startsWith('data:')) img1 = panObj.photo_url;
        else if (panObj.verified_document && typeof panObj.verified_document === 'object' && panObj.verified_document.data_url && typeof panObj.verified_document.data_url === 'string' && panObj.verified_document.data_url.startsWith('data:')) img1 = panObj.verified_document.data_url;
        // Second PAN image
        if (panObj.verified_photo_url_2 && typeof panObj.verified_photo_url_2 === 'string' && panObj.verified_photo_url_2.startsWith('data:')) img2 = panObj.verified_photo_url_2;
        else if (panObj.verified_photo_data_url_2 && typeof panObj.verified_photo_data_url_2 === 'string' && panObj.verified_photo_data_url_2.startsWith('data:')) img2 = panObj.verified_photo_data_url_2;
        else if (panObj.verified_document_2 && typeof panObj.verified_document_2 === 'object' && panObj.verified_document_2.data_url && typeof panObj.verified_document_2.data_url === 'string' && panObj.verified_document_2.data_url.startsWith('data:')) img2 = panObj.verified_document_2.data_url;
        return { img1, img2 };
      };

      // Helper: extract Aadhaar doc photo from aadhaar data object
      const extractAadhaarPhoto = (aaObj) => {
        if (aaObj.verified_document && typeof aaObj.verified_document === 'object' && aaObj.verified_document.data_url && typeof aaObj.verified_document.data_url === 'string' && aaObj.verified_document.data_url.startsWith('data:')) return aaObj.verified_document.data_url;
        return null;
      };

      // Helper: build all pages for one person (applicant details + RV + PAN + Aadhaar + ITR)
      // Each section is gated by isPersonalModuleSelected
      // Applicant + RV flow on the same page (no forced page break between them)
      const buildPersonPages = (personLabel, appData, panData, aadhaarData, rvData, itrEntries, isFirst, personRvImages) => {
        let html = '';
        const { img1: panImg1, img2: panImg2 } = extractPanPhotos(panData);
        const aadhaarPhoto = extractAadhaarPhoto(aadhaarData);

        // ─── Applicant Details + Residential Verification on same page ───
        const hasAppData = isPersonalModuleSelected('applicant') && (appData.name || appData.mobile || appData.email || appData.father_name || appData.date_of_birth || appData.address);
        const hasRV = isPersonalModuleSelected('resident_verification') && (rvData.address || rvData.city || rvData.state || rvData.pincode || rvData.promoter_name || rvData.permanent_address || rvData.present_address || rvData.mobile || rvData.locality || rvData.phone || rvData.email || rvData.residing_at_address || rvData.ownership || rvData.residing_since || rvData.residence_type || rvData.construction_type);

        if (hasAppData || hasRV) {
          html += '<div class="page sec" style="' + pgBreak + '">';
          html += '<h2>' + escapeHtml(personLabel) + ' — Personal Details</h2>';

          if (hasAppData) {
            html += '<div class="block">';
            let rows = '';
            rows += mkRow('Full Name', appData.name, false);
            rows += mkRow('Father\'s Name', appData.father_name, true);
            rows += mkRow('Mobile', appData.mobile, false);
            rows += mkRow('Email', appData.email, true);
            rows += mkRow('Date of Birth', appData.date_of_birth, false);
            rows += mkRow('Gender', appData.gender, true);
            rows += mkRow('Address', appData.address, false);
            if (appData.designation) rows += mkRow('Designation', appData.designation, true);
            html += wrapTable('APPLICANT INFORMATION', rows);
            html += '</div>';
          }

          if (hasRV) {
            html += '<div style="margin-top:14px">';
            const rvRows = buildRVRows(rvData);
            html += '<table class="pbt">';
            html += '<thead><tr><th colspan="2">RESIDENTIAL VERIFICATION DETAILS</th></tr></thead>';
            html += '<tbody>' + rvRows + '</tbody></table>';
            html += '</div>';
            // ── Residential Verification attached images ──
            const filteredRvImgs = Array.isArray(personRvImages) ? personRvImages.filter(img => img && img.dataUrl) : [];
            if (filteredRvImgs.length) {
              html += '<div class="block" style="margin-top:16px">';
              html += '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:10px;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid var(--navy);padding-bottom:6px">RESIDENTIAL VERIFICATION — ATTACHED IMAGES</div>';
              html += buildRVPhotoGrid(filteredRvImgs);
              html += '</div>';
            }
            if (rvData.manual_summary) {
              html += '<div class="block" style="margin-top:16px;break-inside:avoid;page-break-inside:avoid">';
              html += '<div style="padding:14px 16px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">';
              html += '<div style="font-weight:800;font-size:12px;color:#1a3c5e;margin-bottom:10px;letter-spacing:0.5px;border-bottom:2px solid #1a3c5e;padding-bottom:6px">RESIDENTIAL VERIFICATION SUMMARY</div>';
              html += '<div style="font-size:11.5px;line-height:1.65;white-space:pre-wrap">' + safe(rvData.manual_summary) + '</div>';
              if (rvData.rv_verified_by) html += '<div style="margin-top:10px;font-size:11.5px;font-weight:700;color:#1b2559">Verified By: ' + safe(rvData.rv_verified_by) + '</div>';
              html += '</div></div>';
            }
          }

          html += '</div>';
        }

        // ─── PAGE: PAN Verification (Business block style with 2 images) ───
        if (isPersonalModuleSelected('pan') && (panData.pan_number || panData.name)) {
          html += '<div class="page sec" style="' + pgBreak + '">';
          html += '<h2>' + escapeHtml(personLabel) + ' — PAN Verification</h2>';
          html += '<div class="block">';
          html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
          html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
          html += '<thead><tr><th colspan="2" style="' + tblHead + '">PAN CARD VERIFICATION</th></tr></thead>';
          html += '<tbody>';
          if (panData.pan_number) html += '<tr style="' + altBg + '"><td style="' + tdK + '">PAN Number</td><td style="' + tdV + ';font-weight:800;font-size:13px;letter-spacing:1px">' + safe(panData.pan_number) + '</td></tr>';
          if (panData.name) html += '<tr><td style="' + tdK + '">Name on PAN</td><td style="' + tdV + '">' + safe(panData.name) + '</td></tr>';
          if (panData.indian_citizen) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Indian Citizen</td><td style="' + tdV + '">' + safe(panData.indian_citizen) + '</td></tr>';
          if (panData.status) html += '<tr><td style="' + tdK + '">PAN Status</td><td style="' + tdV + '">' + statusBadge(panData.status) + '</td></tr>';
          if (panData.date_of_birth) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Date of Birth</td><td style="' + tdV + '">' + safe(panData.date_of_birth) + '</td></tr>';
          if (panData.mobile_number) html += '<tr><td style="' + tdK + '">Mobile Number</td><td style="' + tdV + '">' + safe(panData.mobile_number) + '</td></tr>';
          if (panData.address) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Address as per PAN</td><td style="' + tdV + '">' + safe(panData.address) + '</td></tr>';
          html += '</tbody></table></div>';
          if (panImg1 || panImg2) {
            const imgCount = (panImg1 ? 1 : 0) + (panImg2 ? 1 : 0);
            const perImgH = imgCount === 2 ? '360px' : '600px';
            html += '<div style="margin-top:10px">';
            html += '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:8px;letter-spacing:0.5px;text-align:center">PAN CARD IMAGES</div>';
            if (panImg1) {
              html += '<div style="text-align:center;margin-bottom:' + (panImg2 ? '12px' : '0') + '">';
              html += '<img src="' + escapeHtml(panImg1) + '" alt="PAN Image 1" style="display:block;max-width:100%;max-height:' + perImgH + ';margin:0 auto" />';
              html += '</div>';
            }
            if (panImg2) {
              html += '<div style="text-align:center">';
              html += '<img src="' + escapeHtml(panImg2) + '" alt="PAN Image 2" style="display:block;max-width:100%;max-height:' + perImgH + ';margin:0 auto" />';
              html += '</div>';
            }
            html += '</div>';
          }
          html += '</div></div>';
        }

        // ─── PAGE: Aadhaar Verification (same style as PAN) ───
        if (isPersonalModuleSelected('aadhaar') && (aadhaarData.aadhaar_number || aadhaarData.name)) {
          html += '<div class="page sec" style="' + pgBreak + '">';
          html += '<h2>' + escapeHtml(personLabel) + ' — Aadhaar Verification</h2>';
          html += '<div class="block">';
          html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
          html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
          html += '<thead><tr><th colspan="2" style="' + tblHead + '">AADHAAR CARD VERIFICATION</th></tr></thead>';
          html += '<tbody>';
          if (aadhaarData.name) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Name on Aadhaar</td><td style="' + tdV + '">' + safe(aadhaarData.name) + '</td></tr>';
          if (aadhaarData.aadhaar_number) html += '<tr><td style="' + tdK + '">Aadhaar Number</td><td style="' + tdV + ';font-weight:800;font-size:13px;letter-spacing:1px">' + safe(aadhaarData.aadhaar_number) + '</td></tr>';
          if (aadhaarData.status) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Status</td><td style="' + tdV + ';font-weight:700">' + safe(aadhaarData.status) + '</td></tr>';
          if (aadhaarData.date_of_birth) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Date of Birth</td><td style="' + tdV + '">' + safe(aadhaarData.date_of_birth) + '</td></tr>';
          if (aadhaarData.gender) html += '<tr><td style="' + tdK + '">Gender</td><td style="' + tdV + '">' + safe(aadhaarData.gender) + '</td></tr>';
          if (aadhaarData.address) html += '<tr style="' + altBg + '"><td style="' + tdK + '">Address</td><td style="' + tdV + '">' + safe(aadhaarData.address) + '</td></tr>';
          html += '</tbody></table></div></div>';
          if (aadhaarPhoto) {
            html += '<div style="margin-top:14px;page-break-inside:avoid;break-inside:avoid">';
            html += '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:8px;letter-spacing:0.5px;text-align:center">AADHAAR DOCUMENT IMAGE</div>';
            html += '<div style="max-width:70%;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fbfcfe;text-align:center">';
            html += '<img src="' + escapeHtml(aadhaarPhoto) + '" alt="Aadhaar Document" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:6px;display:block;margin:0 auto" />';
            html += '</div></div>';
          }
          // ─── ITR details on the same page, below Aadhaar image ───
          if (isPersonalModuleSelected('personal_itr') && itrEntries.length) {
            html += '<div class="block" style="margin-top:16px;break-inside:avoid;page-break-inside:avoid">';
            html += '<h3 style="font-size:13px;font-weight:800;color:var(--navy);margin:0 0 8px 0;letter-spacing:0.3px">' + escapeHtml(personLabel) + ' — Income Tax Returns</h3>';
            html += buildItrTable(itrEntries);
            html += '</div>';
          }
          html += '</div>';
        } else if (isPersonalModuleSelected('personal_itr') && itrEntries.length) {
          // If no Aadhaar data but ITR exists, show ITR on its own page
          html += '<div class="page sec" style="' + pgBreak + '">';
          html += '<h2>' + escapeHtml(personLabel) + ' — Income Tax Returns</h2>';
          html += '<div class="block">';
          html += buildItrTable(itrEntries);
          html += '</div></div>';
        }

        return html;
      };

      let html = '';

      // ═══ PRIMARY APPLICANT PAGES ═══
      const piPersonalItr = personalInfo.personal_itr || {};
      const piItrPrimary = piPersonalItr.primary || {};
      const primaryItrEntries = Array.isArray(piItrPrimary.itr_entries) ? piItrPrimary.itr_entries.filter(e => e && e.assessment_year) : [];

      const primaryLabel = (ap.primary_label || '').trim() || 'Primary Applicant';
      html += buildPersonPages(primaryLabel, ap, pn, aa, rv, primaryItrEntries, true, rvImages);

      // ═══ DESIGNATED PERSONS PAGES (same pattern for each) ═══
      const dpApplicant = getDesignatedPersons(piApplicant);
      const dpPan = getDesignatedPersons(piPan);
      const dpAadhaar = getDesignatedPersons(piAadhaar);
      const dpRV = getDesignatedPersons(piRV);
      const dpPersonalItr = getDesignatedPersons(piPersonalItr);

      const maxDP = Math.max(dpApplicant.length, dpPan.length, dpAadhaar.length, dpRV.length, dpPersonalItr.length);
      for (let i = 0; i < maxDP; i++) {
        const dpApp = dpApplicant[i] || {};
        const dpP = dpPan[i] || {};
        const dpA = dpAadhaar[i] || {};
        const dpR = dpRV[i] || {};
        const dpItr = dpPersonalItr[i] || {};
        const dpItrEntries = Array.isArray(dpItr.itr_entries) ? dpItr.itr_entries.filter(e => e && e.assessment_year) : [];
        const designation = dpApp.designation || dpP.designation || dpA.designation || dpR.designation || 'Designated Person';
        const personName = dpApp.name || dpP.name || dpA.name || '';
        const label = personName ? designation + ' — ' + personName : designation;

        // Extract designated person's verification images from their RV data
        const dpRvImages = Array.isArray(dpR.verification_images) ? dpR.verification_images.filter(img => img && img.dataUrl) : [];
        html += buildPersonPages(label, dpApp, dpP, dpA, dpR, dpItrEntries, false, dpRvImages);
      }

      return html;
    };
    const personalInfoHtml = buildPersonalInfoHtml();

    // ── Build image blocks as plain strings with professional photo grid layout ──

    // Helper: build a 2-column photo grid for multiple images
    const isFileNameStr = (s) => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(s);
    const buildPhotoGrid = (images, altPrefix) => {
      if (!images.length) return '';
      const getLabel = (img, idx) => {
        const lbl = img.label || '';
        if (!lbl || isFileNameStr(lbl)) return '';
        return lbl;
      };
      // If single image, full width; else 2-column grid
      if (images.length === 1) {
        const img = images[0];
        const lbl = getLabel(img, 0);
        return '<div class="photo-card">'
          + (lbl ? '<div class="photo-label">' + escapeHtml(lbl) + '</div>' : '')
          + '<img src="' + escapeHtml(img.dataUrl) + '" alt="' + escapeHtml(lbl || altPrefix) + '" class="photo-img" />'
          + '</div>';
      }
      let html = '<div class="photo-grid">';
      images.forEach(function(img, idx) {
        const lbl = getLabel(img, idx);
        html += '<div class="photo-card">'
          + (lbl ? '<div class="photo-label">' + escapeHtml(lbl) + '</div>' : '')
          + '<img src="' + escapeHtml(img.dataUrl) + '" alt="' + escapeHtml(lbl || altPrefix + ' ' + (idx + 1)) + '" class="photo-img" />'
          + '</div>';
      });
      html += '</div>';
      return html;
    };

    const rvImagesHtml = buildPhotoGrid(rvImages, 'Residence Verification');
    const fieldImagesHtml = buildPhotoGrid(fieldImages, 'Field Photo');
    const faImagesHtml = buildPhotoGrid(faImages, 'Site Visit Photo');

    const styles = `
      <style>
        :root{
          --ink:#0f172a; --muted:#475569; --border:#d9e1ea; --navy:#0b1f3a;
          --bg:#ffffff; --soft:#f5f7fa;
        }
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:'DejaVu Sans','Noto Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}
        .page{page-break-after:always}
        .page:last-child{page-break-after:auto}
        .cover{position:relative;min-height: 260mm;padding:18mm 14mm;background:var(--bg)}
        @page{margin:0}
        .watermark{position:absolute;inset:0;display:grid;place-items:center;opacity:0.06;pointer-events:none}
        .watermark span{font-size:72px;letter-spacing:6px;font-weight:800;color:var(--navy);transform:rotate(-18deg)}
        .cover-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12mm}
        .brand{font-weight:900;color:var(--navy);font-size:18px;letter-spacing:0.2px}
        .conf{font-size:11px;color:var(--muted);text-align:right}
        .title{margin-top:22mm;font-size:26px;font-weight:900;letter-spacing:0.2px;color:var(--navy)}
        .subtitle{margin-top:6px;font-size:13px;color:var(--muted);max-width: 140mm;line-height:1.45}
        .cover-table{margin-top:16mm;border:1px solid var(--border);border-radius:10px;overflow:hidden}
        .cover-row{display:grid;grid-template-columns: 50mm 1fr;border-top:1px solid var(--border)}
        .cover-row:first-child{border-top:0}
        .cover-k{padding:10px 12px;background:var(--soft);font-size:11px;color:var(--muted);font-weight:700}
        .cover-v{padding:10px 12px;font-size:12px;font-weight:700}
        h2{margin:0 0 10px 0;font-size:15px;color:var(--navy);letter-spacing:0.2px;border-bottom:2px solid var(--navy);padding-bottom:6px}
        .sec{padding:6mm 4mm}
        .block{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:#fff;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid}
        .muted{color:var(--muted);font-size:11px;line-height:1.45}
        .p{font-size:12px;line-height:1.55;margin:0 0 8px 0}
        .ul{margin:6px 0 0 18px;font-size:12px;line-height:1.55}
        .tbl{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
        .tbl th{background:var(--soft);text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:800;font-size:10.5px}
        .tbl td{padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top;word-wrap:break-word;overflow-wrap:break-word}
        .tbl tr:nth-child(even) td{background:#fbfcfe}
        .k{color:var(--muted);font-weight:700;width:38%;min-width:110px}
        .badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;color:var(--ink)}
        .badge.ok{border-color: rgba(15,118,110,.35);background: rgba(15,118,110,.06)}
        .badge.warn{border-color: rgba(180,83,9,.35);background: rgba(180,83,9,.06)}
        .badge.bad{border-color: rgba(185,28,28,.35);background: rgba(185,28,28,.06)}
        .doc-list{margin:6px 0 0 18px;font-size:11.5px;line-height:1.55}
        .doc-name{font-weight:800;color:var(--ink)}
        .doc-method{color:var(--muted)}
        .sign-row{display:grid;grid-template-columns: 1fr 1fr;gap:12px;margin-top:10px}
        .sign-box{border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff;min-height:70px}
        .sign-img{max-height:60px;max-width:100%;object-fit:contain;display:block}
        .sign-k{font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:6px}
        .sign-v{font-size:11.5px;font-weight:800}
        .src-tag{display:inline-block;font-size:9px;font-weight:700;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:2px 7px;margin-bottom:8px;letter-spacing:0.3px;text-transform:uppercase}
        .doc-photo{max-width:180px;max-height:220px;object-fit:contain;border:2px solid var(--border);border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
        .doc-photo-wide{max-width:420px;max-height:260px;object-fit:contain;border:2px solid var(--border);border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
        .photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .photo-card{border:1px solid var(--border);border-radius:8px;padding:8px;background:#fff;break-inside:avoid;page-break-inside:avoid}
        .photo-label{font-weight:700;font-size:11px;color:var(--navy);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px}
        .photo-img{width:100%;max-height:90mm;object-fit:contain;border-radius:4px;display:block}
        .doc-frame{border:2px solid var(--border);border-radius:10px;padding:12px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.07);display:inline-block;text-align:center}
        .doc-frame-img{max-width:100%;max-height:250mm;width:auto;height:auto;object-fit:contain;border-radius:6px;display:block;margin:0 auto}
        .dp-photo-frame{display:inline-block;border:2px solid var(--border);border-radius:8px;padding:6px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,0.06);text-align:center;max-width:160px}
        .dp-photo-frame img{max-width:140px;max-height:170px;object-fit:contain;border-radius:4px;display:block;margin:0 auto}
        /* Page-break safe tables */
        .pbt{width:100%;border-collapse:collapse;font-size:11.5px;border-left:2px solid var(--navy);border-right:2px solid var(--navy);border-bottom:2px solid var(--navy)}
        .pbt thead{display:table-header-group}
        .pbt thead tr th{background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px;border-bottom:2px solid var(--navy)}
        .pbt tbody tr{break-inside:avoid;page-break-inside:avoid}
        .pbt tbody tr td{padding:8px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top}
        .pbt tbody tr td.k{font-weight:700;color:#475569;width:35%}
        .pbt tbody tr:nth-child(even) td{background:#fbfcfe}
      </style>
    `;

    // ── Build Rich GST Verification Detail Section ──
    const buildGstDetailHtml = () => {
      // Merge top-level gstData with modules.gst for maximum field coverage
      const g = Object.assign({}, gst || {}, modules.gst || {});
      if (!g.gstin && !g.legalName && !g.tradeName) return '';

      // Helper: extract filing rows from raw data or selected rows
      const rawFilingStatus = (() => {
        const candidates = [
          g.filingStatus, g.filing_status, g.filedData,
          g.raw?.filingStatus, g.raw?.filing_status,
          p.reportConfig?.gstSelectedRows
        ];
        for (const c of candidates) {
          if (Array.isArray(c) && c.length) return c;
        }
        // Walk through g looking for arrays of filing-like objects
        const walk = (node, depth) => {
          if (!node || depth > 4) return null;
          if (Array.isArray(node)) {
            const hasFilingLike = node.some(item => item && typeof item === 'object' &&
              (item.rtntype || item.return_type || item.returnType || item.form || item.gstr || item.type));
            if (hasFilingLike && node.length) return node;
          }
          if (typeof node === 'object' && !Array.isArray(node)) {
            for (const v of Object.values(node)) {
              const found = walk(v, depth + 1);
              if (found) return found;
            }
          }
          return null;
        };
        return walk(g, 0) || [];
      })();

      const normalizeRow = (item) => {
        if (!item || typeof item !== 'object') return null;
        const rtntype = String(item.rtntype || item.return_type || item.returnType || item.form || item.gstr || item.type || '').trim();
        const taxp = String(item.taxp || item.tax_period || item.period || item.month || item.returnPeriod || '').trim();
        const dof = String(item.dof || item.filing_date || item.filedDate || item.filed_on || item.date || item.dateOfFiling || '').trim();
        const mof = String(item.mof || item.modeOfFiling || item.mode || item.mode_of_filing || '').trim();
        const status = String(item.status || item.filed_status || item.filing_status || item.filingStatus || '').trim();
        const fy = String(item.fy || item.financial_year || item.year || item.assessment_year || '').trim();
        if (!rtntype && !taxp && !dof && !status) return null;
        return { rtntype, taxp, dof, mof, status, fy };
      };

      const filingRows = rawFilingStatus.map(normalizeRow).filter(Boolean);
      const normalizeRtn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const gstr1Rows = filingRows.filter(r => { const t = normalizeRtn(r.rtntype); return t === 'GSTR1' || t === 'GSTR1IFF' || t === 'IFF'; });
      const gstr3bRows = filingRows.filter(r => normalizeRtn(r.rtntype) === 'GSTR3B');
      const otherRows = filingRows.filter(r => { const t = normalizeRtn(r.rtntype); return t !== 'GSTR1' && t !== 'GSTR1IFF' && t !== 'IFF' && t !== 'GSTR3B'; });

      const buildFilingTable = (rows, title, thColor) => {
        if (!rows.length) return '';
        const statusBadge = (s) => {
          const lower = String(s || '').toLowerCase();
          const cls = lower === 'filed' ? 'ok' : (lower.includes('not') ? 'bad' : 'warn');
          return '<span class="badge ' + cls + '" style="font-size:9px;padding:2px 6px">' + escapeHtml(s || '—') + '</span>';
        };
        // Split large tables into chunks of MAX_ROWS so each chunk fits on a page
        const MAX_ROWS = 14;
        const chunks = [];
        for (let i = 0; i < rows.length; i += MAX_ROWS) {
          chunks.push(rows.slice(i, i + MAX_ROWS));
        }
        return chunks.map((chunk, ci) => {
          const chunkTitle = chunks.length > 1 ? title + ' (' + (ci + 1) + '/' + chunks.length + ')' : title;
          return '<div style="margin-top:10px;break-inside:avoid;page-break-inside:avoid;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;background:#fff">'
            + '<h3 style="font-size:11px;color:#1a3c5e;margin-bottom:4px">' + escapeHtml(chunkTitle) + '</h3>'
            + '<table class="tbl" style="table-layout:fixed;font-size:10px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden"><thead><tr>'
            + '<th style="background:' + thColor + ';color:#fff;width:12%;padding:5px 6px;font-size:9.5px">FY</th>'
            + '<th style="background:' + thColor + ';color:#fff;width:22%;padding:5px 6px;font-size:9.5px">Tax Period</th>'
            + '<th style="background:' + thColor + ';color:#fff;width:16%;padding:5px 6px;font-size:9.5px">Mode</th>'
            + '<th style="background:' + thColor + ';color:#fff;width:28%;padding:5px 6px;font-size:9.5px">Date of Filing</th>'
            + '<th style="background:' + thColor + ';color:#fff;width:22%;padding:5px 6px;font-size:9.5px;text-align:center">Status</th>'
            + '</tr></thead><tbody>'
            + chunk.map((r, i) => {
              const bg = i % 2 === 0 ? '#fff' : '#fbfcfe';
              return '<tr style="background:' + bg + '">'
                + '<td style="padding:4px 6px;font-size:10px">' + safe(r.fy) + '</td>'
                + '<td style="padding:4px 6px;font-size:10px">' + safe(r.taxp) + '</td>'
                + '<td style="padding:4px 6px;font-size:10px">' + safe(r.mof) + '</td>'
                + '<td style="padding:4px 6px;font-size:10px">' + safe(r.dof) + '</td>'
                + '<td style="text-align:center;padding:4px 6px">' + statusBadge(r.status) + '</td>'
                + '</tr>';
            }).join('')
            + '</tbody></table></div>';
        }).join('');
      };

      // Nature of business activities
      const nbaRaw = g.natureOfBusinessActivities || g.nba || g.natureOfBusiness || g.businessActivities || [];
      const nbaItems = Array.isArray(nbaRaw) ? nbaRaw : (typeof nbaRaw === 'string' ? [nbaRaw] : []);
      const nbaDetails = g.natureOfBusinessDetails || [];

      // Jurisdiction
      const centerJ = g.centerJurisdiction || g.jurisdictionCenter || g.ctj || '';
      const stateJ = g.stateJurisdiction || g.jurisdictionState || g.stj || '';

      // Goods & Services
      const goodsAndServices = Array.isArray(g.goodsAndServices) ? g.goodsAndServices : [];

      // GST AI summary
      let gstAiSummary = moduleSummaries['gst'] ? String(moduleSummaries['gst']).trim() : '';

      let html = '<div class="page sec">';
      html += '<h2>GST Verification — Full Details</h2>';

      // Company details table
      html += '<div class="block">';
      html += '<h3 style="font-size:12px;margin-bottom:8px;color:#1a3c5e">Registration Details</h3>';
      html += '<table class="tbl"><tbody>';
      if (g.gstin) html += '<tr><td class="k">GSTIN</td><td><strong>' + safe(g.gstin) + '</strong></td></tr>';
      if (g.legalName || g.lgnm) html += '<tr><td class="k">Legal Name of Business</td><td>' + safe(g.legalName || g.lgnm) + '</td></tr>';
      if (g.tradeName || g.tradeNam) html += '<tr><td class="k">Trade Name</td><td>' + safe(g.tradeName || g.tradeNam) + '</td></tr>';
      if (g.registrationDate || g.rgdt || g.effectiveDate) html += '<tr><td class="k">Effective Date of Registration</td><td>' + safe(g.registrationDate || g.rgdt || g.effectiveDate) + '</td></tr>';
      if (g.constitutionOfBusiness || g.ctb) html += '<tr><td class="k">Constitution of Business</td><td>' + safe(g.constitutionOfBusiness || g.ctb) + '</td></tr>';
      if (g.taxpayerType || g.dty) html += '<tr><td class="k">Taxpayer Type</td><td>' + safe(g.taxpayerType || g.dty) + '</td></tr>';
      if (g.status || g.sts) html += '<tr><td class="k">GSTIN / UIN Status</td><td><span class="badge ' + (String(g.status || g.sts || '').toLowerCase() === 'active' ? 'ok' : 'warn') + '">' + safe(g.status || g.sts) + '</span></td></tr>';
      if (g.cancellationDate || g.cxdt) html += '<tr><td class="k">Cancellation Date</td><td>' + safe(g.cancellationDate || g.cxdt) + '</td></tr>';
      if (g.lastUpdated || g.lstupdt) html += '<tr><td class="k">Last Updated</td><td>' + safe(g.lastUpdated || g.lstupdt) + '</td></tr>';
      html += '</tbody></table>';
      html += '</div>';

      // Principal Place of Business
      const addressFull = g.principalAddress || (g.address && typeof g.address === 'object' ? g.address.fullAddress || '' : typeof g.address === 'string' ? g.address : '') || '';
      const additionalAddress = g.additionalPlaceOfBusiness || g.additionalAddress || '';
      if (addressFull || additionalAddress) {
        html += '<div class="block" style="margin-top:6px;padding:8px 10px;margin-bottom:6px">';
        html += '<h3 style="font-size:11px;margin-bottom:4px;color:#1a3c5e">Place of Business</h3>';
        html += '<table class="tbl"><tbody>';
        if (addressFull) html += '<tr><td class="k">Principal Place of Business</td><td>' + safe(addressFull) + '</td></tr>';
        if (additionalAddress) html += '<tr><td class="k">Additional Place of Business</td><td>' + safe(additionalAddress) + '</td></tr>';
        html += '</tbody></table>';
        html += '</div>';
      }

      // Nature of Business Activities
      if (nbaItems.length || nbaDetails.length) {
        html += '<div class="block" style="margin-top:6px;padding:8px 10px;margin-bottom:6px">';
        html += '<h3 style="font-size:11px;margin-bottom:4px;color:#1a3c5e">Nature of Business Activities</h3>';
        if (nbaItems.length) {
          html += '<ul class="ul" style="margin:4px 0 0 18px">';
          nbaItems.forEach(item => {
            const text = typeof item === 'string' ? item : (item && typeof item === 'object' ? (item.activity || item.name || item.nature || item.description || JSON.stringify(item)) : String(item));
            html += '<li>' + safe(text) + '</li>';
          });
          html += '</ul>';
        }
        if (nbaDetails.length) {
          html += '<table class="tbl" style="margin-top:6px"><tbody>';
          nbaDetails.forEach(d => {
            html += '<tr><td class="k">' + safe(d.label || '') + '</td><td>' + safe(d.value || '') + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        html += '</div>';
      }

      // Goods & Services (HSN/SAC)
      if (goodsAndServices.length) {
        html += '<div class="block" style="margin-top:6px;padding:8px 10px;margin-bottom:6px">';
        html += '<h3 style="font-size:11px;margin-bottom:4px;color:#1a3c5e">Goods &amp; Services (HSN / SAC)</h3>';
        html += '<table class="tbl"><thead><tr><th>HSN/SAC Code</th><th>Description</th><th>Type</th></tr></thead><tbody>';
        goodsAndServices.forEach((item, i) => {
          const bg = i % 2 === 0 ? '' : ' style="background:#fbfcfe"';
          html += '<tr' + bg + '><td>' + safe(item.hsnCode || item.hsn || '') + '</td><td>' + safe(item.description || item.desc || '') + '</td><td>' + safe(item.kind || item.type || 'Goods') + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '</div>';
      }

      // Jurisdiction
      if (centerJ || stateJ) {
        html += '<div class="block" style="margin-top:6px;padding:8px 10px;margin-bottom:6px">';
        html += '<h3 style="font-size:11px;margin-bottom:4px;color:#1a3c5e">Jurisdiction Details</h3>';
        html += '<table class="tbl"><tbody>';
        if (typeof centerJ === 'object' && centerJ !== null) {
          html += '<tr><td class="k" colspan="2" style="font-weight:800;background:var(--soft)">Center Jurisdiction</td></tr>';
          Object.entries(centerJ).forEach(([k, v]) => { if (v) html += '<tr><td class="k">' + safe(k) + '</td><td>' + safe(v) + '</td></tr>'; });
        } else if (centerJ) {
          html += '<tr><td class="k">Center Jurisdiction</td><td>' + safe(centerJ) + '</td></tr>';
        }
        if (typeof stateJ === 'object' && stateJ !== null) {
          html += '<tr><td class="k" colspan="2" style="font-weight:800;background:var(--soft)">State Jurisdiction</td></tr>';
          Object.entries(stateJ).forEach(([k, v]) => { if (v) html += '<tr><td class="k">' + safe(k) + '</td><td>' + safe(v) + '</td></tr>'; });
        } else if (stateJ) {
          html += '<tr><td class="k">State Jurisdiction</td><td>' + safe(stateJ) + '</td></tr>';
        }
        html += '</tbody></table>';
        html += '</div>';
      }

      // Filing Return Tables — each table in its own block so borders close per page
      if (gstr1Rows.length || gstr3bRows.length || otherRows.length) {
        html += '<div style="margin-top:8px;margin-bottom:4px"><h3 style="font-size:11px;margin-bottom:2px;color:#1a3c5e">Return Filing Status</h3>';
        html += '<div class="muted" style="margin-bottom:4px;font-size:9.5px">Filing details as retrieved from GST Portal for the selected financial year(s).</div></div>';
        if (gstr1Rows.length) html += buildFilingTable(gstr1Rows, 'GSTR-1 Returns (Outward Supplies)', '#2563eb');
        if (gstr3bRows.length) html += buildFilingTable(gstr3bRows, 'GSTR-3B Returns (Summary)', '#059669');
        if (otherRows.length) html += buildFilingTable(otherRows, 'Other Returns', '#64748b');
      }

      // GST AI Summary
      if (gstAiSummary) {
        html += '<div class="ai-section" style="margin-top:12px;padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">';
        html += '<div style="font-weight:800;font-size:11px;color:#1b2559;margin-bottom:6px;letter-spacing:0.5px">GST VERIFICATION SUMMARY</div>';
        html += '<div style="font-size:11.5px;line-height:1.55;white-space:pre-wrap">' + safe(gstAiSummary) + '</div>';
        html += '</div>';
      }

      html += '</div>';
      return html;
    };
    const gstDetailHtml = buildGstDetailHtml();

    const complianceTable = `
      <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
        <thead>
          <tr>
            <th style="width:45%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Category</th>
            <th style="width:20%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:center;letter-spacing:0.3px">Risk Flag</th>
            <th style="width:35%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${complianceRows.map((r, idx) => {
            const bg = idx % 2 === 0 ? '#fff' : 'rgba(15,118,110,0.04)';
            const flag = r.riskFlag || (r.adverse === true || String(r.adverse || '').toLowerCase() === 'yes' ? 'Adverse' : (r.adverse === false || String(r.adverse || '').toLowerCase() === 'no' ? 'Clear' : '-'));
            const flagColor = flag === 'Adverse' ? 'color:#dc2626;font-weight:700' : flag === 'Clear' ? 'color:#059669;font-weight:700' : 'color:var(--ink)';
            const remarks = (r.remarks && r.remarks.trim() && r.remarks.trim() !== '—') ? r.remarks.trim() : '-';
            return `
            <tr style="background:${bg}">
              <td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">${escapeHtml(r.label)}</td>
              <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;${flagColor}">${escapeHtml(flag)}</td>
              <td style="padding:7px 10px;border-bottom:1px solid var(--border)">${escapeHtml(remarks)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    `;

    const html = `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pre‑Sanction Due Diligence Report</title>
        ${styles}
      </head>
      <body>
        <!-- COVER PAGE -->
        <div class="page" style="position:relative;min-height:297mm;padding:0;margin:-10mm -10mm 0 -10mm;width:calc(100% + 20mm);background:#ffffff;overflow:hidden">
          <!-- Left accent bar -->
          <div style="position:absolute;top:0;left:0;width:8mm;height:100%;background:linear-gradient(180deg,#1b2559 0%,#1b2559 60%,#3366cc 80%,#6baed6 100%)"></div>
          <!-- Right subtle accent strip -->
          <div style="position:absolute;top:0;right:0;width:3mm;height:100%;background:linear-gradient(180deg,#6baed6 0%,#3366cc 40%,#1b2559 100%)"></div>
          <!-- Bottom accent line -->
          <div style="position:absolute;bottom:0;left:0;right:0;height:5px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6)"></div>

          <!-- Diamond pattern background -->
          <svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 600 850">
            <!-- Row 1 -->
            <polygon points="300,40 340,80 300,120 260,80" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <polygon points="380,40 420,80 380,120 340,80" fill="none" stroke="rgba(27,37,89,0.03)" stroke-width="1"/>
            <polygon points="460,40 500,80 460,120 420,80" fill="none" stroke="rgba(27,37,89,0.025)" stroke-width="1"/>
            <polygon points="220,40 260,80 220,120 180,80" fill="none" stroke="rgba(27,37,89,0.03)" stroke-width="1"/>
            <!-- Row 2 -->
            <polygon points="340,120 380,160 340,200 300,160" fill="none" stroke="rgba(51,102,204,0.04)" stroke-width="1"/>
            <polygon points="260,120 300,160 260,200 220,160" fill="none" stroke="rgba(51,102,204,0.035)" stroke-width="1"/>
            <polygon points="420,120 460,160 420,200 380,160" fill="none" stroke="rgba(51,102,204,0.03)" stroke-width="1"/>
            <polygon points="500,120 540,160 500,200 460,160" fill="none" stroke="rgba(27,37,89,0.02)" stroke-width="1"/>
            <!-- Row 3 -->
            <polygon points="300,200 340,240 300,280 260,240" fill="none" stroke="rgba(27,37,89,0.05)" stroke-width="1"/>
            <polygon points="380,200 420,240 380,280 340,240" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <polygon points="460,200 500,240 460,280 420,240" fill="none" stroke="rgba(51,102,204,0.035)" stroke-width="1"/>
            <polygon points="220,200 260,240 220,280 180,240" fill="none" stroke="rgba(51,102,204,0.03)" stroke-width="1"/>
            <polygon points="140,200 180,240 140,280 100,240" fill="none" stroke="rgba(27,37,89,0.02)" stroke-width="1"/>
            <!-- Row 4 -->
            <polygon points="340,280 380,320 340,360 300,320" fill="none" stroke="rgba(107,174,214,0.05)" stroke-width="1"/>
            <polygon points="260,280 300,320 260,360 220,320" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <polygon points="420,280 460,320 420,360 380,320" fill="none" stroke="rgba(27,37,89,0.035)" stroke-width="1"/>
            <polygon points="500,280 540,320 500,360 460,320" fill="none" stroke="rgba(51,102,204,0.025)" stroke-width="1"/>
            <!-- Row 5 - center area -->
            <polygon points="300,360 340,400 300,440 260,400" fill="none" stroke="rgba(51,102,204,0.05)" stroke-width="1"/>
            <polygon points="380,360 420,400 380,440 340,400" fill="none" stroke="rgba(27,37,89,0.045)" stroke-width="1"/>
            <polygon points="460,360 500,400 460,440 420,400" fill="none" stroke="rgba(107,174,214,0.04)" stroke-width="1"/>
            <polygon points="220,360 260,400 220,440 180,400" fill="none" stroke="rgba(27,37,89,0.035)" stroke-width="1"/>
            <!-- Row 6 -->
            <polygon points="340,440 380,480 340,520 300,480" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <polygon points="260,440 300,480 260,520 220,480" fill="none" stroke="rgba(51,102,204,0.045)" stroke-width="1"/>
            <polygon points="420,440 460,480 420,520 380,480" fill="none" stroke="rgba(51,102,204,0.035)" stroke-width="1"/>
            <polygon points="500,440 540,480 500,520 460,480" fill="none" stroke="rgba(27,37,89,0.025)" stroke-width="1"/>
            <!-- Row 7 -->
            <polygon points="300,520 340,560 300,600 260,560" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <polygon points="380,520 420,560 380,600 340,560" fill="none" stroke="rgba(107,174,214,0.04)" stroke-width="1"/>
            <polygon points="460,520 500,560 460,600 420,560" fill="none" stroke="rgba(27,37,89,0.03)" stroke-width="1"/>
            <polygon points="220,520 260,560 220,600 180,560" fill="none" stroke="rgba(51,102,204,0.03)" stroke-width="1"/>
            <!-- Row 8 -->
            <polygon points="340,600 380,640 340,680 300,640" fill="none" stroke="rgba(51,102,204,0.035)" stroke-width="1"/>
            <polygon points="260,600 300,640 260,680 220,640" fill="none" stroke="rgba(27,37,89,0.03)" stroke-width="1"/>
            <polygon points="420,600 460,640 420,680 380,640" fill="none" stroke="rgba(27,37,89,0.025)" stroke-width="1"/>
            <!-- Row 9 -->
            <polygon points="300,680 340,720 300,760 260,720" fill="none" stroke="rgba(27,37,89,0.03)" stroke-width="1"/>
            <polygon points="380,680 420,720 380,760 340,720" fill="none" stroke="rgba(51,102,204,0.025)" stroke-width="1"/>
            <!-- Filled accent diamonds (subtle) -->
            <polygon points="480,300 500,320 480,340 460,320" fill="rgba(27,37,89,0.025)" stroke="none"/>
            <polygon points="160,440 180,460 160,480 140,460" fill="rgba(51,102,204,0.02)" stroke="none"/>
            <polygon points="520,500 540,520 520,540 500,520" fill="rgba(107,174,214,0.025)" stroke="none"/>
          </svg>

          <!-- CRUX Logo PNG — Top Left -->
          <div style="padding:22mm 14mm 0 20mm;text-align:left;position:relative;z-index:1">
            <img src="${(() => { try { const lp = path.join(path.dirname(__dirname), '..', 'CRUXLOGO.png'); return 'data:image/png;base64,' + fs.readFileSync(lp).toString('base64'); } catch(e) { return ''; } })()}" alt="CRUX Logo" style="display:inline-block;max-width:200px;height:auto" />
          </div>

          <!-- Horizontal divider -->
          <div style="margin:8mm 14mm 0 20mm;height:2px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6,transparent);position:relative;z-index:1"></div>

          <!-- Report Title Block — Left aligned, vertically centered -->
          <div style="padding:20mm 20mm 0 20mm;text-align:left">
            <div style="font-size:10px;font-weight:700;color:#3366cc;letter-spacing:5px;text-transform:uppercase;margin-bottom:14px">Confidential Report</div>
            <div style="font-size:44px;font-weight:900;color:#1b2559;letter-spacing:0.5px;line-height:1.12;margin-bottom:6px">MSME</div>
            <div style="font-size:44px;font-weight:900;color:#1b2559;letter-spacing:0.5px;line-height:1.12;margin-bottom:6px">Pre&#8209;Sanction</div>
            <div style="font-size:44px;font-weight:900;color:#1b2559;letter-spacing:0.5px;line-height:1.12;margin-bottom:6px">Due Diligence</div>
            <div style="font-size:44px;font-weight:300;color:#3366cc;letter-spacing:0.5px;line-height:1.12;margin-bottom:20px">Report</div>
            <div style="width:70px;height:3px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6);border-radius:2px;margin-bottom:18px"></div>
            <div style="font-size:11.5px;color:#475569;line-height:1.85;max-width:400px;letter-spacing:0.15px">Comprehensive entity verification, statutory compliance check &amp; risk assessment prepared under standard due diligence framework.</div>
          </div>

          <!-- Blue Diamond Structure — center decorative element -->
          <div style="margin:12mm auto 0 auto;text-align:center;position:relative;z-index:1">
            <svg width="280" height="120" viewBox="0 0 280 120" xmlns="http://www.w3.org/2000/svg" style="display:inline-block">
              <!-- Large center diamond -->
              <polygon points="140,4 200,60 140,116 80,60" fill="none" stroke="#3366cc" stroke-width="2" opacity="0.6"/>
              <!-- Medium inner diamond -->
              <polygon points="140,18 186,60 140,102 94,60" fill="rgba(51,102,204,0.08)" stroke="#1b2559" stroke-width="1.5" opacity="0.7"/>
              <!-- Small inner diamond -->
              <polygon points="140,34 170,60 140,86 110,60" fill="rgba(27,37,89,0.12)" stroke="#1b2559" stroke-width="1" opacity="0.8"/>
              <!-- Tiny center diamond -->
              <polygon points="140,46 156,60 140,74 124,60" fill="rgba(51,102,204,0.25)" stroke="#3366cc" stroke-width="1"/>
              <!-- Left satellite diamond -->
              <polygon points="50,36 72,60 50,84 28,60" fill="none" stroke="#6baed6" stroke-width="1" opacity="0.4"/>
              <polygon points="50,46 62,60 50,74 38,60" fill="rgba(107,174,214,0.12)" stroke="none"/>
              <!-- Right satellite diamond -->
              <polygon points="230,36 252,60 230,84 208,60" fill="none" stroke="#6baed6" stroke-width="1" opacity="0.4"/>
              <polygon points="230,46 242,60 230,74 218,60" fill="rgba(107,174,214,0.12)" stroke="none"/>
              <!-- Top small accent -->
              <polygon points="140,0 148,10 140,20 132,10" fill="rgba(51,102,204,0.15)" stroke="none"/>
              <!-- Bottom small accent -->
              <polygon points="140,100 148,110 140,120 132,110" fill="rgba(51,102,204,0.15)" stroke="none"/>
              <!-- Connecting lines -->
              <line x1="72" y1="60" x2="80" y2="60" stroke="#6baed6" stroke-width="1" opacity="0.3"/>
              <line x1="200" y1="60" x2="208" y2="60" stroke="#6baed6" stroke-width="1" opacity="0.3"/>
            </svg>
          </div>

          <!-- Info Cards — Bottom area -->
          <div style="position:absolute;bottom:18mm;left:20mm;right:14mm">
            <!-- Two-column info row -->
            <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:12px">
              <div style="flex:1;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;padding:14px 18px;box-shadow:0 2px 8px rgba(27,37,89,0.10)">
                <div style="font-size:7.5px;color:#1b2559;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px">Report Date</div>
                <div style="font-size:14px;color:#1b2559;font-weight:800">${escapeHtml((() => { const rd = new Date(reportDate); return Number.isFinite(rd.getTime()) ? rd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : reportDate; })())}</div>
              </div>
              <div style="flex:1;background:#f0f7ff;border:2px solid #2563eb;border-radius:10px;padding:14px 18px;box-shadow:0 2px 8px rgba(37,99,235,0.10)">
                <div style="font-size:7.5px;color:#2563eb;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px">Case Reference</div>
                <div style="font-size:13px;color:#1b2559;font-weight:700;font-family:monospace;letter-spacing:0.5px">${escapeHtml(caseId)}</div>
              </div>
            </div>
            <!-- Bottom tagline -->
            <div style="text-align:center;padding-top:6px">
              <div style="font-size:7.5px;color:#94a3b8;letter-spacing:0.5px">Private &amp; Confidential</div>
            </div>
          </div>
        </div>

        <!-- CASE OVERVIEW TABLE — First page after cover -->
        ${(() => {
          const co = caseOverview;
          const hasData = co.entityName || co.businessActivity || co.operationStatus || co.unitLocation || co.pastYearTurnover || co.bankReference || co.incorporationDate || co.reportDate;
          if (!hasData) return '';
          const turnoverLabel = co.turnoverFY ? 'Past Year Turnover (F.Y. ' + escapeHtml(co.turnoverFY) + ')' : 'Past Year Turnover';
          return `
        <div class="page sec">
          <div style="border:2px solid var(--navy);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(11,31,58,0.06)">
            <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
              <thead>
                <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Particulars</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
              </thead>
              <tbody>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Name of the Entity</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-weight:700">${escapeHtml(co.entityName || '')}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Business Activity</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(co.businessActivity || '')}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Operation Status</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top"><span class="badge ${(co.operationStatus || '').toLowerCase() === 'active' ? 'ok' : 'warn'}">${escapeHtml(co.operationStatus || '')}</span></td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(co.unitLocationLabel || 'Unit Location')}</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(co.unitLocation || '')}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${turnoverLabel}</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-weight:700">${escapeHtml(co.pastYearTurnover || '')}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Branch Name (Br. Code)</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(co.bankReference || '')}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Incorporation Date</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml((() => { const d = new Date(co.incorporationDate); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (co.incorporationDate || ''); })())}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Report Date</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml((() => { const d = new Date(co.reportDate); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (co.reportDate || ''); })())}</td></tr>
              </tbody>
            </table>
          </div>
        </div>`;
        })()}

        <!-- DETAILS OF BUSINESS ENTITY — second page after cover -->
        ${(() => {
          const ad = additionalDetails;
          const co = caseOverview;
          // Determine each field from best available source
          const beEntityName = companyName || co.entityName || '—';
          const beYearOfIncorporation = (() => { const raw = (mca && (mca.dateOfIncorporation || mca.date_of_incorporation)) || co.incorporationDate || '—'; const d = new Date(raw); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : raw; })();
          const beConstitution = businessType || (gst && (gst.ctb || gst.constitutionOfBusiness)) || (mca && mca.companyType) || '—';
          const beNatureOfBusiness = (gst && (gst.nba || gst.natureOfBusinessActivity || gst.natureOfBusiness)) || (modules?.udyam?.nature_of_activity) || co.businessActivity || '—';
          const beEnterpriseCategory = (modules?.udyam?.enterprise_type) || (mca && (mca.companyCategory || mca.company_category)) || '—';
          const bePan = (() => {
            if (gst && gst.pan) return gst.pan;
            let _pm = modules?.pan || {};
            for (let _i = 0; _i < 5; _i++) {
              if (_pm.pan_number !== undefined || _pm.primary !== undefined) break;
              if (_pm.data && typeof _pm.data === 'object') { _pm = _pm.data; } else if (_pm.raw && typeof _pm.raw === 'object') { _pm = _pm.raw; } else break;
            }
            if (_pm.primary?.pan_number) return _pm.primary.pan_number;
            if (_pm.pan_number) return _pm.pan_number;
            const g = gstin || ''; if (g.length >= 12) return g.substring(2, 12);
            return '—';
          })();
          const beGstn = gstin || '—';
          const beLei = ad.leiCode || '—';
          const beUdyam = (modules?.udyam?.udyam_number || modules?.udyam?.udyamNumber || modules?.udyam?.registration_number) || '—';
          const beMsmeCategory = ad.msmeCategory || '—';
          const beNatureActivity = ad.natureOfActivity || (gst && (gst.nba || gst.natureOfBusinessActivity)) || (modules?.udyam?.nature_of_activity) || '—';
          const beInvestPM = ad.investmentPlantMachinery || '—';
          const beTurnoverBS = ad.turnoverAuditedBS || '—';
          const beIndustry = ad.industry || '—';
          const beUnitAddress = registeredOffice || co.unitLocation || '—';
          const beBranch = ad.branchOffices || '—';
          const beContact = ad.contactNo || '—';
          const beEmail = ad.emailId || '—';
          const beWebsite = ad.website || '—';
          // Only show if includeBusinessEntity is set or there is any additional data
          const hasAD = Object.values(ad).some(v => v);
          const shouldShow = (p.reportConfig && p.reportConfig.includeBusinessEntity) || hasAD;
          if (!shouldShow) return '';
          return `
        <div class="page sec">
          <div style="border:2px solid var(--navy);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(11,31,58,0.06)">
            <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
              <thead>
                <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Particulars</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
              </thead>
              <tbody>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Name of Entity</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-weight:700">${escapeHtml(beEntityName)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Year of Incorporation</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beYearOfIncorporation)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Constitution</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beConstitution)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Nature of Business / Activity</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beNatureOfBusiness)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Enterprise Category</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beEnterpriseCategory)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">PAN No.</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-family:monospace;font-weight:600">${escapeHtml(bePan)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">GSTN</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-family:monospace;font-weight:600">${escapeHtml(beGstn)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">LEI Code</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-family:monospace">${escapeHtml(beLei)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Udyam Registration No.</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-family:monospace">${escapeHtml(beUdyam)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">MSME Category based on UAM</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beMsmeCategory)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Nature of Activity</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beNatureActivity)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Investment in Plant &amp; Machinery (as per last year audited BS)</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beInvestPM)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Turnover (as per last year audited Balance Sheet)</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-weight:600">${escapeHtml(beTurnoverBS)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Industry</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beIndustry)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Unit Address</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beUnitAddress)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Branch Offices</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beBranch)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Contact No. (Landline &amp; Mobile No.)</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beContact)}</td></tr>
                <tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Email Id</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beEmail)}</td></tr>
                <tr><td style="font-weight:700;color:var(--navy);font-size:11px;width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Website</td><td style="font-size:11.5px;line-height:1.55;color:var(--ink);padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${escapeHtml(beWebsite)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>`;
        })()}

        <!-- COMPANY SNAPSHOT — Page 4 (table layout matching page 3) -->
        ${(() => {
          const shouldShowSnapshot = p.reportConfig?.includeBusinessEntity || csProjectDescription || csDirectorsList.length || csPromotersList.length || csKeyRegulatory || csMajorBrands || csAuditorName || csExistingBankers || csTotalEmployees || csWilfulDefaulter || csExternalRating || csEpfDefaulter;
          if (!shouldShowSnapshot) return '';

          // Build directors/promoters cell content
          let dpValue = '';
          if (csDirectorsList.length) {
            dpValue += '<div style="font-size:10px;font-weight:800;color:var(--navy);margin-bottom:2px">DIRECTOR</div>';
            dpValue += csDirectorsList.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br/>');
          }
          if (csPromotersList.length) {
            if (dpValue) dpValue += '<div style="margin-top:6px"></div>';
            dpValue += '<div style="font-size:10px;font-weight:800;color:var(--navy);margin-bottom:2px">PROMOTERS</div>';
            dpValue += csPromotersList.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br/>');
          }

          // Build key regulatory cell content (numbered list)
          let regValue = '';
          if (csKeyRegulatory) {
            const items = csKeyRegulatory.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
            regValue = items.map((item, i) => `${i + 1}. ${escapeHtml(item)}`).join('<br/>');
          }

          // Build existing bankers cell content (numbered list)
          let bankersValue = '';
          if (csExistingBankers) {
            const items = csExistingBankers.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
            bankersValue = items.length > 1 ? items.map((item, i) => `${i + 1}. ${escapeHtml(item)}`).join('<br/>') : escapeHtml(csExistingBankers);
          }

          // Color-coded row styles
          const rowOk = 'background:rgba(15,118,110,0.04)';
          const rowWarn = 'background:rgba(180,83,9,0.04)';
          const rowNeutral = '';
          const labelBold = 'font-weight:700;color:var(--navy);font-size:11px';
          const valStyle = 'font-size:11.5px;line-height:1.55;color:var(--ink)';

          // Determine row background based on content type
          const isPositive = (v) => v && (/does not reflect|not listed|no adverse|clean|clear/i.test(v));
          const isNegative = (v) => v && (/defaulter|adverse|negative|listed|reflect/i.test(v) && !isPositive(v));

          const makeStyledRow = (label, value, opts) => {
            if (!value && !opts?.alwaysShow) return '';
            const displayVal = value || '—';
            const bg = opts?.bg || rowNeutral;
            const icon = opts?.icon || '';
            const valExtra = opts?.valStyle || valStyle;
            return `<tr style="${bg}">`
              + `<td style="${labelBold};width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${icon ? '<span style="margin-right:4px">' + icon + '</span>' : ''}${escapeHtml(label)}</td>`
              + `<td style="${valExtra};padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">${displayVal}</td>`
              + '</tr>';
          };

          return `
        <div class="page sec">
          <div style="border:2px solid var(--navy);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(11,31,58,0.06)">
            <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
              <thead>
                <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Particulars</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
              </thead>
              <tbody>
                ${makeStyledRow('Project', safe(csProjectDescription), {})}
                ${makeStyledRow('Location of Project', safe(csProjectLocation) || '—', { alwaysShow: true })}
                ${dpValue ? '<tr><td style="' + labelBold + ';width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Promoters / Directors Name / Partner</td><td style="' + valStyle + ';padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">' + dpValue + '</td></tr>' : ''}
                ${regValue ? '<tr style="' + rowOk + '"><td style="' + labelBold + ';width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Key regulatory approvals, certifications and membership</td><td style="' + valStyle + ';padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">' + regValue + '</td></tr>' : ''}
                ${makeStyledRow('Major Brands', safe(csMajorBrands), {})}
                ${makeStyledRow('Name of the Auditor', safe(csAuditorName), {})}
                ${bankersValue ? '<tr><td style="' + labelBold + ';width:42%;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">Major Existing Bankers</td><td style="' + valStyle + ';padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top">' + bankersValue + '</td></tr>' : ''}
                ${makeStyledRow('Total number of employees', safe(csTotalEmployees), {})}
                ${makeStyledRow('Total income for last / Latest FY', safe(csTotalIncomeFY), {})}
                ${makeStyledRow('Wilful defaulter verification', safe(csWilfulDefaulter), { bg: isPositive(csWilfulDefaulter) ? rowOk : isNegative(csWilfulDefaulter) ? rowWarn : rowNeutral })}
                ${makeStyledRow('External Rating Details', safe(csExternalRating), {})}
                ${makeStyledRow("EPF (Employee Provident Fund) Defaulters' List Status", safe(csEpfDefaulter) || '—', { alwaysShow: true })}
              </tbody>
            </table>
          </div>
        </div>`;
        })()}

        <!-- ORGANIZATION, MANAGEMENT, BOD & OWNERSHIP — continuous flow -->
        ${(() => {
          const promoterDetails = Array.isArray(additionalDetails.promoterDetails) ? additionalDetails.promoterDetails : [];
          const managementDetails = Array.isArray(additionalDetails.managementDetails) ? additionalDetails.managementDetails : [];
          const promoterComments = (additionalDetails.promoterComments || '').trim();
          const businessEntitySummary = (additionalDetails.businessEntitySummary || '').trim();

          const bodDetails = Array.isArray(additionalDetails.bodDetails) ? additionalDetails.bodDetails : [];
          const bodComments = (additionalDetails.bodComments || '').trim();
          const ownershipDetails = Array.isArray(additionalDetails.ownershipDetails) ? additionalDetails.ownershipDetails : [];

          // Filter out rows where no meaningful data exists (all fields empty)
          const validPromoters = promoterDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));
          const validMgmt = managementDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));
          const validBOD = bodDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));
          const validOwnership = ownershipDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));

          if (!validPromoters.length && !validMgmt.length && !promoterComments && !businessEntitySummary && !validBOD.length && !validOwnership.length && !bodComments) return '';

          // Determine which promoter columns actually have data
          const promoterColDefs = [
            { key: 'name', label: 'Name' },
            { key: 'age', label: 'Age' },
            { key: 'designation', label: 'Designation' },
            { key: 'education', label: 'Education' },
            { key: 'experience', label: 'Experience' },
            { key: 'yearsWithCompany', label: 'Years with Company' },
            { key: 'panDin', label: 'PAN / DIN' },
            { key: 'role', label: 'Role' },
            { key: 'wilfulDefaulter', label: 'Wilful Defaulter Check' },
            { key: 'litigations', label: 'Litigations' }
          ];
          const mgmtColDefs = [
            { key: 'name', label: 'Name' },
            { key: 'age', label: 'Age' },
            { key: 'designation', label: 'Designation' },
            { key: 'pan', label: 'PAN' },
            { key: 'education', label: 'Education' },
            { key: 'experience', label: 'Experience' },
            { key: 'dateOfAppointment', label: 'Date of Appointment' }
          ];

          // Filter columns: only include columns that have at least one non-empty value across all rows
          const activePCols = promoterColDefs.filter(col => validPromoters.some(r => r[col.key] && String(r[col.key]).trim()));
          const activeMCols = mgmtColDefs.filter(col => validMgmt.some(r => r[col.key] && String(r[col.key]).trim()));

          const thStyle = 'background:var(--navy);color:#fff;font-weight:800;font-size:9.5px;padding:6px 8px;text-align:left;letter-spacing:0.3px;white-space:nowrap';
          const tdStyle = 'font-size:10.5px;line-height:1.45;color:var(--ink);padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top';
          const rowAlt = 'background:rgba(15,118,110,0.04)';

          let html = '<div class="page sec">';
          html += '<div style="margin-bottom:14px"><h2 style="font-size:15px;color:var(--navy);font-weight:800;margin:0 0 2px 0">Background of Business Entity</h2>';
          html += '<div style="font-size:11px;color:#64748b;font-weight:600;letter-spacing:0.3px">Write up on Promoters / Organization &amp; Management</div></div>';

          // ── Promoter Details Table ──
          if (validPromoters.length && activePCols.length) {
            html += '<div style="margin-bottom:16px;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="font-size:11.5px;font-weight:700;color:var(--navy);margin-bottom:6px;display:flex;align-items:center;gap:6px">Promoter Details</div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto">';
            html += '<thead><tr>';
            html += '<th style="' + thStyle + ';width:28px">S.No</th>';
            activePCols.forEach(col => { html += '<th style="' + thStyle + '">' + escapeHtml(col.label) + '</th>'; });
            html += '</tr></thead><tbody>';
            validPromoters.forEach((row, idx) => {
              const bg = idx % 2 === 1 ? ' style="' + rowAlt + '"' : '';
              html += '<tr' + bg + '>';
              html += '<td style="' + tdStyle + ';text-align:center;font-weight:600">' + (idx + 1) + '</td>';
              activePCols.forEach(col => {
                const val = (row[col.key] || '').toString().trim();
                html += '<td style="' + tdStyle + '">' + escapeHtml(val || '—') + '</td>';
              });
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          }

          // ── Promoter Comments ──
          if (promoterComments) {
            html += '<div style="margin-bottom:16px;padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08);font-size:11px;color:var(--ink);line-height:1.6;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="font-weight:700;color:#1b2559;font-size:10px;margin-bottom:3px;letter-spacing:0.3px">PROMOTER COMMENTS</div>';
            html += escapeHtml(promoterComments).replace(/\n/g, '<br/>');
            html += '</div>';
          }

          // ── Management Details Table ──
          if (validMgmt.length && activeMCols.length) {
            html += '<div style="margin-bottom:14px;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="font-size:11.5px;font-weight:700;color:var(--navy);margin-bottom:6px;display:flex;align-items:center;gap:6px">Organization &amp; Management</div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto">';
            html += '<thead><tr>';
            html += '<th style="' + thStyle + ';width:28px">S.No</th>';
            activeMCols.forEach(col => { html += '<th style="' + thStyle + '">' + escapeHtml(col.label) + '</th>'; });
            html += '</tr></thead><tbody>';
            validMgmt.forEach((row, idx) => {
              const bg = idx % 2 === 1 ? ' style="' + rowAlt + '"' : '';
              html += '<tr' + bg + '>';
              html += '<td style="' + tdStyle + ';text-align:center;font-weight:600">' + (idx + 1) + '</td>';
              activeMCols.forEach(col => {
                const val = (row[col.key] || '').toString().trim();
                html += '<td style="' + tdStyle + '">' + escapeHtml(val || '—') + '</td>';
              });
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          }

          // ── Business Entity Summary ──
          if (businessEntitySummary) {
            html += '<div style="margin-top:16px;padding:12px 16px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08);break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="font-size:11.5px;font-weight:700;color:#1b2559;margin-bottom:8px;display:flex;align-items:center;gap:6px">Summary</div>';
            html += '<div style="font-size:11px;line-height:1.7;color:var(--ink);white-space:pre-line">' + escapeHtml(businessEntitySummary).replace(/\n/g, '<br/>') + '</div>';
            html += '</div>';
          }

          // ── Now BOD + Ownership (continuous flow, same page wrapper) ──

          const bodColDefs = [
            { key: 'name', label: 'Name' },
            { key: 'age', label: 'Age' },
            { key: 'position', label: 'Position / Category' },
            { key: 'education', label: 'Educational Qualification' },
            { key: 'totalExperience', label: 'Total Years of Experience' },
            { key: 'appointmentYears', label: 'Date of Appointment / Years with Company' },
            { key: 'pastExperience', label: 'Details of Past Experience' },
            { key: 'otherDirectorships', label: 'Other Directorships / Association' }
          ];
          const ownColDefs = [
            { key: 'promoterName', label: 'Promoters' },
            { key: 'shareholding', label: 'Shareholding Pattern (as on)' }
          ];

          const activeBODCols = bodColDefs.filter(col => validBOD.some(r => r[col.key] && String(r[col.key]).trim()));
          const activeOwnCols = ownColDefs.filter(col => validOwnership.some(r => r[col.key] && String(r[col.key]).trim()));

          // ── BOD Section ──
          if (validBOD.length && activeBODCols.length) {
            html += '<div style="margin-top:18px;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="margin-bottom:10px"><h2 style="font-size:14px;color:var(--navy);font-weight:800;margin:0">Details of the Board of Directors</h2></div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto">';
            html += '<thead><tr>';
            html += '<th style="' + thStyle + ';width:28px">S.No</th>';
            activeBODCols.forEach(col => { html += '<th style="' + thStyle + '">' + escapeHtml(col.label) + '</th>'; });
            html += '</tr></thead><tbody>';
            validBOD.forEach((row, idx) => {
              const bg = idx % 2 === 1 ? ' style="' + rowAlt + '"' : '';
              html += '<tr' + bg + '>';
              html += '<td style="' + tdStyle + ';text-align:center;font-weight:600">' + (idx + 1) + '</td>';
              activeBODCols.forEach(col => {
                const val = (row[col.key] || '').toString().trim();
                html += '<td style="' + tdStyle + '">' + escapeHtml(val || '—') + '</td>';
              });
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          }

          // ── BOD Comments ──
          if (bodComments) {
            html += '<div style="margin-top:20px;margin-bottom:12px;padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08);font-size:11px;color:var(--ink);line-height:1.6;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="font-weight:700;color:#1b2559;font-size:10px;margin-bottom:3px;letter-spacing:0.3px">COMMENTS</div>';
            html += escapeHtml(bodComments).replace(/\n/g, '<br/>');
            html += '</div>';
          }

          // ── Ownership Structure Table + Donut Chart ──
          if (validOwnership.length && activeOwnCols.length) {
            html += '<div style="margin-top:18px;break-inside:avoid;page-break-inside:avoid">';
            html += '<div style="margin-bottom:10px"><h2 style="font-size:14px;color:var(--navy);font-weight:800;margin:0">Management &amp; Ownership Structure</h2>';
            html += '<div style="font-size:10px;color:#64748b;margin-top:2px">(Proprietorship / Partnership / LLP / Limited Company)</div></div>';
            html += '<div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:6px">Promoters Stake</div>';

            // Build shareholding data for donut chart
            // High-contrast color palette — works well in print & screen, distinct even with many slices
            const chartColors = ['#0b1f3a','#0f766e','#2563eb','#d97706','#dc2626','#7c3aed','#059669','#e11d48','#0891b2','#ca8a04','#4f46e5','#be185d','#15803d','#b91c1c','#1d4ed8','#a16207','#6d28d9','#0e7490','#c2410c','#4338ca'];
            let totalShareholding = 0;
            const slices = [];
            validOwnership.forEach((row, idx) => {
              const name = (row.promoterName || '').toString().trim() || ('Promoter ' + (idx + 1));
              const rawVal = (row.shareholding || '').toString().trim();
              const num = parseFloat(rawVal);
              const pct = !isNaN(num) ? num : 0;
              totalShareholding += pct;
              slices.push({ name: name, pct: pct, color: chartColors[idx % chartColors.length] });
            });

            // Universal SVG Donut Chart — handles any number of shareholders & any % split
            // Enforces a minimum visual angle so even tiny slices (e.g. 0.01%) remain visible
            const svgSize = 260;
            const cx = svgSize / 2;
            const cy = svgSize / 2;
            const outerR = 118;
            const innerR = 70;
            const total = totalShareholding > 0 ? totalShareholding : 100;
            const toRad = (deg) => (deg * Math.PI) / 180;
            const MIN_VISUAL_DEG = 8; // minimum degrees so tiny slices are always visible

            // Calculate raw angles, then redistribute to enforce minimum
            const activeSlices = slices.filter(s => s.pct > 0);
            let rawAngles = activeSlices.map(s => (s.pct / total) * 360);

            if (activeSlices.length > 1) {
              // Count how many slices need boosting
              const tinyCount = rawAngles.filter(a => a < MIN_VISUAL_DEG).length;
              if (tinyCount > 0) {
                const reservedDeg = tinyCount * MIN_VISUAL_DEG;
                const remainingDeg = 360 - reservedDeg;
                const bigTotal = rawAngles.reduce((sum, a) => sum + (a >= MIN_VISUAL_DEG ? a : 0), 0);
                rawAngles = rawAngles.map(a => {
                  if (a < MIN_VISUAL_DEG) return MIN_VISUAL_DEG;
                  return bigTotal > 0 ? (a / bigTotal) * remainingDeg : remainingDeg / (rawAngles.length - tinyCount);
                });
              }
            }

            let cumAngle = -90; // start from top
            let svgPaths = '';
            activeSlices.forEach((s, idx) => {
              const angle = rawAngles[idx];

              // SVG arc cannot draw a full 360° circle (start=end collapses) — split into two halves
              if (angle >= 359.99) {
                const midAngle = cumAngle + 180;
                const endAngle = cumAngle + 359.99;
                const x1o = cx + outerR * Math.cos(toRad(cumAngle));
                const y1o = cy + outerR * Math.sin(toRad(cumAngle));
                const xMo = cx + outerR * Math.cos(toRad(midAngle));
                const yMo = cy + outerR * Math.sin(toRad(midAngle));
                const x2o = cx + outerR * Math.cos(toRad(endAngle));
                const y2o = cy + outerR * Math.sin(toRad(endAngle));
                const x1i = cx + innerR * Math.cos(toRad(endAngle));
                const y1i = cy + innerR * Math.sin(toRad(endAngle));
                const xMi = cx + innerR * Math.cos(toRad(midAngle));
                const yMi = cy + innerR * Math.sin(toRad(midAngle));
                const x2i = cx + innerR * Math.cos(toRad(cumAngle));
                const y2i = cy + innerR * Math.sin(toRad(cumAngle));
                svgPaths += '<path d="M' + x1o + ',' + y1o + ' A' + outerR + ',' + outerR + ' 0 0 1 ' + xMo + ',' + yMo + ' A' + outerR + ',' + outerR + ' 0 0 1 ' + x2o + ',' + y2o + ' L' + x1i + ',' + y1i + ' A' + innerR + ',' + innerR + ' 0 0 0 ' + xMi + ',' + yMi + ' A' + innerR + ',' + innerR + ' 0 0 0 ' + x2i + ',' + y2i + ' Z" fill="' + s.color + '"/>';
                cumAngle += angle;
                return;
              }

              const startAngle = cumAngle;
              const endAngle = cumAngle + angle;
              const largeArc = angle > 180 ? 1 : 0;
              const x1o = cx + outerR * Math.cos(toRad(startAngle));
              const y1o = cy + outerR * Math.sin(toRad(startAngle));
              const x2o = cx + outerR * Math.cos(toRad(endAngle));
              const y2o = cy + outerR * Math.sin(toRad(endAngle));
              const x1i = cx + innerR * Math.cos(toRad(endAngle));
              const y1i = cy + innerR * Math.sin(toRad(endAngle));
              const x2i = cx + innerR * Math.cos(toRad(startAngle));
              const y2i = cy + innerR * Math.sin(toRad(startAngle));
              svgPaths += '<path d="M' + x1o + ',' + y1o + ' A' + outerR + ',' + outerR + ' 0 ' + largeArc + ' 1 ' + x2o + ',' + y2o + ' L' + x1i + ',' + y1i + ' A' + innerR + ',' + innerR + ' 0 ' + largeArc + ' 0 ' + x2i + ',' + y2i + ' Z" fill="' + s.color + '"/>';
              cumAngle = endAngle;
            });

            // Layout: chart on left, legend on right
            html += '<div style="display:flex;align-items:center;gap:32px;margin-bottom:18px;flex-wrap:wrap">';

            // Donut SVG
            html += '<div style="flex-shrink:0">';
            html += '<svg width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + svgSize + ' ' + svgSize + '" xmlns="http://www.w3.org/2000/svg">';
            html += svgPaths;
            // Center text
            html += '<text x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle" style="font-size:22px;font-weight:800;fill:var(--navy,#0b1f3a)">' + (totalShareholding > 0 ? totalShareholding.toFixed(1) : '100') + '%</text>';
            html += '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" style="font-size:11px;fill:#64748b;font-weight:600">TOTAL</text>';
            html += '</svg></div>';

            // Legend
            html += '<div style="flex:1;min-width:200px">';
            slices.forEach(s => {
              html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">';
              html += '<div style="width:16px;height:16px;border-radius:4px;background:' + s.color + ';flex-shrink:0"></div>';
              html += '<div style="font-size:12px;color:var(--ink,#1e293b);line-height:1.4"><span style="font-weight:700">' + escapeHtml(s.name) + '</span> <span style="color:#64748b;font-weight:600">(' + (s.pct > 0 ? s.pct.toFixed(2) + '%' : '—') + ')</span></div>';
              html += '</div>';
            });
            html += '</div>';

            html += '</div>'; // close flex container

            // Table (without percentage text, replaced with color bar)
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto">';
            html += '<thead><tr>';
            activeOwnCols.forEach(col => { html += '<th style="' + thStyle + '">' + escapeHtml(col.label) + '</th>'; });
            html += '</tr></thead><tbody>';

            validOwnership.forEach((row, idx) => {
              const bg = idx % 2 === 1 ? ' style="' + rowAlt + '"' : '';
              const sliceColor = chartColors[idx % chartColors.length];
              html += '<tr' + bg + '>';
              activeOwnCols.forEach(col => {
                let val = (row[col.key] || '').toString().trim();
                if (col.key === 'shareholding') {
                  const num = parseFloat(val);
                  const pctVal = !isNaN(num) ? num : 0;
                  // Colored bar instead of plain percentage
                  html += '<td style="' + tdStyle + '">';
                  html += '<div style="display:flex;align-items:center;gap:6px">';
                  html += '<div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden">';
                  html += '<div style="width:' + Math.min(pctVal, 100) + '%;height:100%;background:' + sliceColor + ';border-radius:5px"></div></div>';
                  html += '<span style="font-weight:700;font-size:9.5px;color:' + sliceColor + ';min-width:36px;text-align:right">' + (pctVal > 0 ? pctVal.toFixed(2) + '%' : '—') + '</span>';
                  html += '</div></td>';
                } else {
                  html += '<td style="' + tdStyle + '">' + escapeHtml(val || '—') + '</td>';
                }
              });
              html += '</tr>';
            });

            // Total row
            if (activeOwnCols.some(c => c.key === 'shareholding')) {
              html += '<tr style="background:var(--navy);color:#fff;font-weight:800">';
              if (activeOwnCols.some(c => c.key === 'promoterName')) html += '<td style="font-size:10.5px;padding:6px 8px;font-weight:800">Total</td>';
              html += '<td style="font-size:10.5px;padding:6px 8px;font-weight:800">' + (totalShareholding > 0 ? totalShareholding.toFixed(2) + '%' : '100.00%') + '</td>';
              html += '</tr>';
            }

            html += '</tbody></table></div></div>';
          }

          html += '</div>'; // close the single page wrapper
          return html;
        })()}

        <!-- GROUP COMPANY + ORG STRUCTURE + CERTIFICATIONS + STATUTORY TAX (single flowing page) -->
        ${(() => {
          const ownershipDetails = Array.isArray(additionalDetails.ownershipDetails) ? additionalDetails.ownershipDetails : [];
          const validOwn = ownershipDetails.filter(r => r && Object.entries(r).some(([k, v]) => k !== '_autoSource' && v && String(v).trim()));
          const hasGC = hasGroupCompanyData || gcComments;
          const hasCert = validCertifications.length > 0;
          const hasStat = validStatutoryTax.length > 0;
          if (!hasGC && !hasCert && !hasStat && !hasItr && cin === '—') return '';

          let parts = '';

          // ── Group Company & Sister Concern ──
          if (hasGC) {
            const hasAnyValues = gcName || gcDOI || gcRegOffice || gcNature || gcFY || gcTotalIncome || gcNetProfit || gcNetWorth || gcTotalDebt;
            parts += '<h2 style="margin-top:0">Group of Company and Sister Concern Details</h2>';
            parts += '<div class="block">';
            if (hasAnyValues) {
              parts += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05);margin-bottom:12px">'
                + '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">'
                + '<thead><tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Element</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr></thead>'
                + '<tbody>'
                + '<tr><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Name of the Group Company</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcName) + '</td></tr>'
                + '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Date of Incorporation</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcDOI) + '</td></tr>'
                + '<tr><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Registered Office</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcRegOffice) + '</td></tr>'
                + '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Nature of Business</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcNature) + '</td></tr>'
                + '<tr><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Financial Year</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcFY) + '</td></tr>'
                + '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Total Income</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcTotalIncome) + '</td></tr>'
                + '<tr><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Net Profit</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcNetProfit) + '</td></tr>'
                + '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Net Worth</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcNetWorth) + '</td></tr>'
                + '<tr><td style="font-weight:700;color:var(--navy);font-size:11px;padding:7px 10px;border-bottom:1px solid var(--border)">Total Debt</td><td style="font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--border)">' + safe(gcTotalDebt) + '</td></tr>'
                + '</tbody></table></div>';
            } else if (!gcComments) {
              parts += '<div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:8px">GROUP OF COMPANY AND SISTER CONCERN COMPANY NOT FOUND</div>';
            }
            if (gcComments) {
              parts += '<div style="padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08);font-size:11px;color:var(--ink);line-height:1.6;break-inside:avoid;page-break-inside:avoid">'
                + '<div style="font-weight:700;color:#1b2559;font-size:10px;margin-bottom:3px;letter-spacing:0.3px">COMMENTS</div>'
                + escapeHtml(gcComments).replace(/\n/g, '<br/>') + '</div>';
            }
            parts += '</div>';
          }

          // ── Certifications ──
          if (hasCert) {
            parts += '<h2>List of Certifications</h2>';
            parts += '<div class="block"><div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">'
              + '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:auto"><thead><tr>'
              + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:center;width:40px">Sr. No.</th>'
              + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Certificate Name</th>'
              + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Certificate Number</th>'
              + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Validity Period (From till date)</th>'
              + '</tr></thead><tbody>'
              + validCertifications.map(function(row, idx) {
                  var bg = idx % 2 === 1 ? ' style="background:#fbfcfe"' : '';
                  return '<tr' + bg + '>'
                    + '<td style="padding:6px 10px;border-bottom:1px solid var(--border);text-align:center;font-weight:600">' + (idx + 1) + '</td>'
                    + '<td style="padding:6px 10px;border-bottom:1px solid var(--border);font-weight:700">' + escapeHtml(row.certName || '') + '</td>'
                    + '<td style="padding:6px 10px;border-bottom:1px solid var(--border);font-family:monospace;font-weight:600">' + escapeHtml(row.certNumber || '') + '</td>'
                    + '<td style="padding:6px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(row.validityPeriod || '-') + '</td>'
                    + '</tr>';
                }).join('')
              + '</tbody></table></div></div>';
          }

          // ── Statutory Taxation ──
          if (hasStat || hasItr || cin !== '—') {
            parts += '<h2>Statutory Taxation &amp; Filing Verification Status</h2>';
            parts += '<div class="block"><div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">'
              + '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed"><thead><tr>'
              + '<th style="width:30%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Name</th>'
              + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Observation</th>'
              + '</tr></thead><tbody>';

            // Existing statutory tax rows
            if (hasStat) {
              parts += validStatutoryTax.map(function(row, idx) {
                  var bg = idx % 2 === 1 ? ' style="background:#fbfcfe"' : '';
                  return '<tr' + bg + '>'
                    + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-weight:700;color:var(--navy)">' + escapeHtml(row.name || '') + '</td>'
                    + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:11px;line-height:1.55;white-space:pre-line">' + escapeHtml(row.observation || '') + '</td>'
                    + '</tr>';
                }).join('');
            }

            // MCA / CIN row
            if (cin !== '—') {
              parts += '<tr style="background:rgba(15,118,110,0.04)">'
                + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-weight:700;color:var(--navy)">MCA (CIN)</td>'
                + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:11px;font-family:monospace;font-weight:600">' + escapeHtml(cin) + '</td>'
                + '</tr>';
            }

            // ITR detail table — full columns like the standalone section
            if (hasItr) {
              const fmtItrDate = function(raw) {
                var s = (raw || '').toString().trim();
                if (!s) return '—';
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                  var d = new Date(s + 'T00:00:00Z');
                  if (Number.isFinite(d.getTime())) {
                    return escapeHtml(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }));
                  }
                }
                return escapeHtml(s);
              };
              const fmtAmt = function(v) {
                if (v == null || String(v).trim() === '') return '—';
                var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
                if (Number.isFinite(n)) return '₹' + n.toLocaleString('en-IN');
                return escapeHtml(String(v));
              };
              const itrSorted = itrEntries.slice().sort(function(a, b) {
                var ya = Number(String(a.assessment_year || '').match(/^(\d{4})/)?.[1] || 0);
                var yb = Number(String(b.assessment_year || '').match(/^(\d{4})/)?.[1] || 0);
                return yb - ya;
              });

              parts += '</tbody></table></div></div>';   // close previous statutory table

              parts += '<h2 style="margin-top:16px">Income Tax Return (ITR) Verification</h2>';
              parts += '<div class="block"><div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">'
                + '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:auto"><thead><tr>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Assessment Year</th>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Ward</th>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Return Filed On</th>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:right">Total Income</th>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:right">Tax Paid</th>'
                + '<th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left">Acknowledgement No.</th>'
                + '</tr></thead><tbody>';

              itrSorted.forEach(function(e, idx) {
                var bg = idx % 2 === 0 ? '#fff' : '#fbfcfe';
                parts += '<tr style="background:' + bg + '">'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-weight:700">' + escapeHtml(e.assessment_year || '—') + '</td>'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(e.ward || '—') + '</td>'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + fmtItrDate(e.return_filed_on) + '</td>'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-weight:600">' + fmtAmt(e.total_income) + '</td>'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-weight:600">' + fmtAmt(e.tax_paid) + '</td>'
                  + '<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:10px">' + escapeHtml(e.acknowledgement_no || '—') + '</td>'
                  + '</tr>';
              });

              parts += '</tbody></table></div></div>';
            } else {
              parts += '</tbody></table></div></div>';   // close statutory table when no ITR
            }
          }

          return '<div class="page sec">' + parts + '</div>';
        })()}

        ${showGstDetail ? gstDetailHtml : ''}

        <!-- ═══ MSME / UDYAM DETAILS (from module data) ═══ -->
        ${(() => {
          const um = modules?.udyam || {};
          const umNumber = um.udyam_number || um.udyamRegistrationNumber || um.registration_number || '';
          const umEnterprise = um.enterprise_type || um.category || '';
          const umMajorActivity = um.major_activity || '';
          const umNatureActivity = um.nature_of_activity || '';
          const umNic = um.nic_2_digit || um.nic_code || '';
          const umSocialCategory = um.social_category || '';
          const umDateOfIncorporation = um.date_of_incorporation || um.doi || '';
          const umDateOfCommencement = um.date_of_commencement || um.doc || '';
          const umOwnerName = um.owner_name || um.name || '';
          const umAddress = um.address || um.registered_office || '';
          const umState = um.state || '';
          const umDistrict = um.district || '';
          const umInvestPM = um.investment_in_plant_machinery || um.investment_plant_machinery || '';
          const umTurnover = um.turnover || '';

          const hasData = umNumber || umEnterprise || umMajorActivity || umNatureActivity || umNic || p.udyamPdfBase64;
          if (!hasData) return '';

          const thS = 'background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px';
          const tdL = 'font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)';
          const tdV = 'padding:7px 10px;border-bottom:1px solid var(--border)';
          const rAlt = 'background:rgba(15,118,110,0.04)';
          const mkRow = (label, value, alt) => value ? '<tr' + (alt ? ' style="' + rAlt + '"' : '') + '><td style="' + tdL + ';width:42%">' + label + '</td><td style="' + tdV + '">' + escapeHtml(value) + '</td></tr>' : '';

          let html = '<div class="page sec">';
          html += '<h2>Attached Udyam Details</h2>';
          html += '<div class="block" style="margin-bottom:18px">';
          html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
          html += '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">';
          html += '<thead><tr><th style="width:42%;' + thS + '">Element</th><th style="' + thS + '">Details</th></tr></thead><tbody>';
          html += mkRow('Udyam Registration Number', umNumber, false);
          html += mkRow('Enterprise Type / Category', umEnterprise, true);
          html += mkRow('Major Activity', umMajorActivity, false);
          html += mkRow('Nature of Activity', umNatureActivity, true);
          html += mkRow('NIC Code', umNic, false);
          html += mkRow('Social Category', umSocialCategory, true);
          html += mkRow('Owner / Applicant Name', umOwnerName, false);
          html += mkRow('Date of Incorporation', umDateOfIncorporation, true);
          html += mkRow('Date of Commencement', umDateOfCommencement, false);
          html += mkRow('Registered Address', umAddress, true);
          html += mkRow('State', umState, false);
          html += mkRow('District', umDistrict, true);
          html += mkRow('Investment in Plant & Machinery', umInvestPM, false);
          html += mkRow('Turnover', umTurnover, true);
          html += '</tbody></table></div></div>';

          if (p.udyamPdfBase64) {
            html += '<p style="font-size:11px;color:var(--navy);margin-top:10px;font-weight:600">Udyam Registration Certificate attached on the next page.</p>';
          }

          html += '</div>';
          return html;
        })()}
        <!-- UDYAM_PDF_INSERT -->

        ${(() => {
          const bp = additionalDetails || {};
          const bpAge = bp.bpBusinessAge || '';
          const bpNature = bp.bpNatureOfBusinessActivity || '';
          const bpIndustry = bp.bpIndustrySegment || '';
          const bpProducts = bp.bpProductsServices || '';
          const bpOffice = bp.bpRegisteredOfficeLocation || '';
          const bpAreaUnit = bp.bpAreaOfOfficeUnit || 'SQ. FT';
          const bpArea = bp.bpAreaOfOffice ? (bp.bpAreaOfOffice + ' ' + bpAreaUnit) : '';
          const bpOwnership = bp.bpOwnershipOfOffice || '';
          const bpEmployees = bp.bpEmployeesAtLocation || '';
          const bpLocAdvantage = bp.bpLocationAdvantage || '';
          const bpMarketing = bp.bpMarketingSetup || '';
          const bpComments = bp.bpComments || '';
          if (!bpAge && !bpNature && !bpIndustry && !bpProducts && !bpOffice && !bpArea && !bpOwnership && !bpEmployees && !bpLocAdvantage && !bpMarketing && !bpComments) return '';
          return `
        <div class="page sec">
          <h2>Business Profile &mdash; Operations Details</h2>
          <div class="block">
            <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
              <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
                <thead>
                  <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Element</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
                </thead>
                <tbody>
                  ${bpAge ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Business Age</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpAge) + '</td></tr>' : ''}
                  ${bpNature ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Nature of Business Activity</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpNature) + '</td></tr>' : ''}
                  ${bpIndustry ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Industry Segment / Business Group</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpIndustry) + '</td></tr>' : ''}
                  ${bpProducts ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Products / Services Offered</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpProducts) + '</td></tr>' : ''}
                  ${bpOffice ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Registered Office Location</td><td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:pre-line">' + escapeHtml(bpOffice) + '</td></tr>' : ''}
                  ${bpArea ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Area of the Office</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpArea) + '</td></tr>' : ''}
                  ${bpOwnership ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Ownership of Office</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpOwnership) + '</td></tr>' : ''}
                  ${bpEmployees ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Employees at Location / Across</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpEmployees) + '</td></tr>' : ''}
                  ${bpLocAdvantage ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Location Advantage</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(bpLocAdvantage) + '</td></tr>' : ''}
                  ${bpMarketing ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Marketing Setup</td><td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:pre-line">' + escapeHtml(bpMarketing) + '</td></tr>' : ''}
                  ${bpComments ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Comments</td><td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:pre-line">' + escapeHtml(bpComments) + '</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>

          ${(() => {
            const baRaw = bp.baKeyRawMaterials || '';
            const baFluctuation = bp.baRawMaterialPriceFluctuation || '';
            const baCert = bp.baQualityCertification || '';
            const baValueAdd = bp.baLevelOfValueAddition || '';
            const baComment = bp.baComments || '';
            if (!baRaw && !baFluctuation && !baCert && !baValueAdd && !baComment) return '';
            return `
          <div class="block" style="margin-top:18px">
            <div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Business Activity Details</div>
            <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
              <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
                <thead>
                  <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Element</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
                </thead>
                <tbody>
                  ${baRaw ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Key Raw Materials</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(baRaw) + '</td></tr>' : ''}
                  ${baFluctuation ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Level of Raw Material Price Fluctuation Risk</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(baFluctuation) + '</td></tr>' : ''}
                  ${baCert ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Quality Certification</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(baCert) + '</td></tr>' : ''}
                  ${baValueAdd ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Level of Value Addition</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(baValueAdd) + '</td></tr>' : ''}
                  ${baComment ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Comment</td><td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:pre-line">' + escapeHtml(baComment) + '</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
          })()}

          ${(() => {
            const ssCreditor = bp.ssAvgCreditorDays || '';
            const ssAvailability = bp.ssRawMaterialAvailability || '';
            const ssImport = bp.ssImportAsPercentOfRM || '';
            if (!ssCreditor && !ssAvailability && !ssImport) return '';
            return `
          <div class="block" style="margin-top:18px">
            <div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Supply Side Analysis</div>
            <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
              <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
                <thead>
                  <tr><th style="width:42%;background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Element</th><th style="background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px">Details</th></tr>
                </thead>
                <tbody>
                  ${ssCreditor ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Average Creditor Days</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(ssCreditor) + '</td></tr>' : ''}
                  ${ssAvailability ? '<tr style="background:rgba(15,118,110,0.04)"><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Raw Material Availability</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(ssAvailability) + '</td></tr>' : ''}
                  ${ssImport ? '<tr><td style="font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)">Import as a % of Raw Material Purchase</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">' + escapeHtml(ssImport) + '</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
          })()}

        </div>`;
        })()}

        <!-- ═══ SITE VISIT REPORT (from Additional Details) ═══ -->
        ${(() => {
          const sv = additionalDetails || {};
          const svLoc = sv.svProjectLocation || '';
          const svVisited = sv.svSitesVisited || '';
          const svOpStatus = sv.svStatusOfOperation || '';
          const svArea = sv.svAreaOfUnit || '';
          const svEmp = sv.svEmployeesAtSite || '';
          const svPM = sv.svPlantMachinery || '';
          const svOwner = sv.svOwnershipOfPremises || '';
          const svOther = sv.svOtherFacilities || '';
          const svTransport = sv.svAccessibilityToTransport || '';
          const svLandExp = sv.svLandForExpansion || '';
          const svLayout = sv.svSiteLayout || '';
          const svInsurance = sv.svInsuranceCoverage || '';
          const svPower = sv.svSourceOfPower || '';
          const svPowerAdq = sv.svAdequacyOfPower || '';
          const svWater = sv.svSourceOfWater || '';
          const svFuel = sv.svTypeOfFuel || '';
          const svLabour = sv.svLabourUnion || '';
          const svIndRel = sv.svIndustrialRelations || '';
          const svSafety = sv.svWorkSafety || '';
          const svStorage = sv.svStorageFacilities || '';
          const svPlantStatus = sv.svOperationalStatusPlant || '';
          const svComment = sv.svSiteVisitComment || '';
          const svVendor = sv.svVendorName || '';
          const svVendorContact = sv.svVendorContactPerson || '';
          const svVendorDetails = sv.svVendorContactDetails || '';
          const svVendorComments = sv.svVendorComments || '';
          const machineryDetails = Array.isArray(sv.machineryDetails) ? sv.machineryDetails : [];
          const validMachinery = machineryDetails.filter(r => r && Object.values(r).some(v => v && String(v).trim()));

          const hasOpFacilities = svVisited || svOpStatus || svArea || svEmp || svPM || svOwner || svOther || svTransport;
          const hasAdequacy = svLandExp || svLayout || svInsurance || svPower || svPowerAdq || svWater || svFuel || svLabour || svIndRel || svSafety || svStorage || svPlantStatus || svComment;
          const hasVendor = svVendor || svVendorContact || svVendorDetails || svVendorComments;
          if (!svLoc && !hasOpFacilities && !hasAdequacy && !validMachinery.length) return '';

          const thStyle = 'background:var(--navy);color:#fff;font-weight:800;font-size:10.5px;padding:8px 10px;text-align:left;letter-spacing:0.3px';
          const tdLabel = 'font-weight:700;color:var(--navy);padding:7px 10px;border-bottom:1px solid var(--border)';
          const tdVal = 'padding:7px 10px;border-bottom:1px solid var(--border)';
          const rowAlt = 'background:rgba(15,118,110,0.04)';
          const makeRow = (label, value, alt) => value ? '<tr' + (alt ? ' style="' + rowAlt + '"' : '') + '><td style="' + tdLabel + ';width:42%">' + label + '</td><td style="' + tdVal + '">' + escapeHtml(value) + '</td></tr>' : '';

          let html = '<div class="page sec">';
          html += '<h2>Site Visit Report</h2>';
          if (svLoc) html += '<div style="margin-bottom:12px;font-size:11.5px;color:var(--ink)"><strong style="color:var(--navy)">Location of the Project:</strong> ' + escapeHtml(svLoc) + '</div>';

          // Information of Operational Facilities
          if (hasOpFacilities) {
            html += '<div class="block" style="margin-bottom:18px">';
            html += '<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Information of Operational Facilities</div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">';
            html += '<thead><tr><th style="width:42%;' + thStyle + '">Element</th><th style="' + thStyle + '">Details</th></tr></thead><tbody>';
            html += makeRow('Sites Visited', svVisited, false);
            html += makeRow('Status of Operation', svOpStatus, true);
            html += makeRow('Area of the Unit', svArea, false);
            html += makeRow('No. of Employees at Site', svEmp, true);
            html += makeRow('Plant &amp; Machinery', svPM, false);
            html += makeRow('Ownership of Premises', svOwner, true);
            html += makeRow('Other Facilities', svOther, false);
            html += makeRow('Accessibility to Transport', svTransport, true);
            html += '</tbody></table></div></div>';
          }

          // Adequacy of Facilities
          if (hasAdequacy) {
            html += '<div class="block" style="margin-bottom:18px">';
            html += '<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Adequacy of Facilities</div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">';
            html += '<thead><tr><th style="width:42%;' + thStyle + '">Element</th><th style="' + thStyle + '">Details</th></tr></thead><tbody>';
            html += makeRow('Availability of Land for Future Expansion', svLandExp, false);
            html += makeRow('Site Layout', svLayout, true);
            html += makeRow('Adequacy of Insurance Coverage', svInsurance, false);
            html += makeRow('Source of Power', svPower, true);
            html += makeRow('Adequacy of Power', svPowerAdq, false);
            html += makeRow('Source of Water', svWater, true);
            html += makeRow('Type of Fuel Used', svFuel, false);
            html += makeRow('Presence of Labour Union', svLabour, true);
            html += makeRow('Industrial Relations', svIndRel, false);
            html += makeRow('Level of Work Safety', svSafety, true);
            html += makeRow('Adequacy of Storage Facilities', svStorage, false);
            html += makeRow('Operational Status of Plant(s)', svPlantStatus, true);
            if (svComment) {
              html += '<tr><td style="' + tdLabel + ';width:42%">Comment</td><td style="' + tdVal + ';white-space:pre-line">' + escapeHtml(svComment) + '</td></tr>';
            }
            html += '</tbody></table></div></div>';
          }

          html += '</div>'; // close Site Visit page

          // ── Major Machineries + Interaction with Machinery Supplier (own page, together) ──
          if (validMachinery.length || hasVendor) {
            html += '<div class="page sec" style="page-break-inside:avoid;break-inside:avoid">';
            html += '<h2>Major Machineries &amp; Machinery Supplier</h2>';

            if (validMachinery.length) {
              html += '<div class="block" style="margin-bottom:18px">';
              html += '<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Major Machineries Used by the Company</div>';
              html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
              html += '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:auto">';
              html += '<thead><tr><th style="' + thStyle + ';width:28px">Sr. No.</th><th style="' + thStyle + '">Name of Machinery</th><th style="' + thStyle + '">Year of Purchase</th><th style="' + thStyle + '">Value as on Date (Rs. in Lakh)</th></tr></thead><tbody>';
              validMachinery.forEach((m, idx) => {
                const bg = idx % 2 === 1 ? ' style="' + rowAlt + '"' : '';
                html += '<tr' + bg + '><td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;font-weight:600">' + (idx + 1) + '</td>';
                html += '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + escapeHtml(m.machineryName || '—') + '</td>';
                html += '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + escapeHtml(m.yearOfPurchase || '—') + '</td>';
                html += '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + escapeHtml(m.valueAsOnDate || '—') + '</td></tr>';
              });
              html += '</tbody></table></div></div>';
            }

            if (hasVendor) {
              html += '<div class="block" style="margin-bottom:18px">';
              html += '<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px;letter-spacing:0.3px">Interaction with Machinery Supplier</div>';
              html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
              html += '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">';
              html += '<thead><tr><th style="width:42%;' + thStyle + '">Element</th><th style="' + thStyle + '">Details</th></tr></thead><tbody>';
              html += makeRow('Name of the Vendor', svVendor, false);
              html += makeRow('Contact Person', svVendorContact, true);
              html += makeRow('Contact Details', svVendorDetails, false);
              if (svVendorComments) {
                html += '<tr style="' + rowAlt + '"><td style="' + tdLabel + ';width:42%">Comments / Remarks</td><td style="' + tdVal + ';white-space:pre-line">' + escapeHtml(svVendorComments) + '</td></tr>';
              }
              html += '</tbody></table></div></div>';
            }

            html += '</div>'; // close machinery page
          }

          return html;
        })()}

        <!-- ═══ FINANCIAL MODULE ═══ -->
        ${(() => {
          if (!showFinancial) return '';
          const fSummary = moduleSummaries['financial'] ? String(moduleSummaries['financial']).trim() : '';
          if (!financialCalcHtml && !fSummary) return '';
          let fHtml = '<div class="sec">';
          fHtml += '<h2>Financial Analysis</h2>';
          // Financial currency/unit remark — shown before tables
          const financialRemark = (p.financialRemark || '').trim();
          if (financialRemark) {
            fHtml += '<div style="margin:8px 0 4px;padding:6px 12px;background:#fffbeb;border:1px solid #fbbf24;border-radius:6px;font-size:11px;font-weight:700;color:#92400e;letter-spacing:0.3px">';
            fHtml += escapeHtml(financialRemark);
            fHtml += '</div>';
          }
          if (financialCalcHtml) fHtml += financialCalcHtml;
          if (fSummary) {
            fHtml += '<div class="block" style="margin-top:12px">';
            fHtml += '<div class="ai-section" style="padding:12px 14px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">';
            fHtml += '<div style="font-weight:800;font-size:11px;color:#1b2559;margin-bottom:6px;letter-spacing:0.5px">FINANCIAL OBSERVATION</div>';
            fHtml += '<div style="font-size:11.5px;line-height:1.55;white-space:pre-wrap">' + safe(fSummary) + '</div>';
            fHtml += '</div></div>';
          }
          fHtml += '</div>';
          return fHtml;
        })()}

        <!-- ═══ COMPLIANCE & ADVERSE CHECKS (SEPARATE PAGE) ═══ -->
        ${showCompliance ? `
        <div class="page sec" style="page-break-before:always;break-before:page">
          <h2>Compliance Check</h2>
          ${complianceTable}
        </div>
        ` : ''}

        ${hasFieldData ? `
        <div class="sec">
          <h2>${fieldDataSecNum}. Business Field Data — Photographs</h2>
          <div class="src-tag">Source: Field Data Upload</div>
          <div class="muted" style="margin-bottom:12px">Site / field photos uploaded during the verification process.</div>
          ${fieldImagesHtml}
        </div>
        ` : ''}

        ${hasFieldData && moduleSummaries['field_data'] ? `
        <div class="page sec">
          <h2>Business Field Report — Summary</h2>
          <div class="block">
            <div class="ai-section" style="padding:14px 16px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">
              <div style="font-size:11.5px;line-height:1.65;white-space:pre-wrap">${safe(moduleSummaries['field_data'])}</div>
            </div>
          </div>
          ${fieldDataVerifiedBy ? `<div style="margin-top:14px;font-size:11.5px;font-weight:700;color:#1b2559">Verified By: ${safe(fieldDataVerifiedBy)}</div>` : ''}
        </div>
        ` : ''}

        ${businessSummary ? `
        <div class="page sec" style="page-break-before:always;break-before:page">
          <h2>Business Summary</h2>
          <div class="block">
            <div style="padding:14px 16px;background:#f0f4ff;border:2px solid #1b2559;border-radius:10px;box-shadow:0 2px 8px rgba(27,37,89,0.08)">
              <div style="font-size:11.5px;line-height:1.7;white-space:pre-wrap">${safe(businessSummary)}</div>
            </div>
          </div>
        </div>
        ` : ''}

        ${(() => {
          let panMod = modules?.pan || {};
          // Deep-unwrap: PAN data may arrive wrapped as { source, fetchedAt, data: { pan_number, ... } }
          for (let _i = 0; _i < 5; _i++) {
            if (panMod.pan_number !== undefined || panMod.name !== undefined || panMod.primary !== undefined) break;
            if (panMod.data && typeof panMod.data === 'object') { panMod = panMod.data; } else if (panMod.raw && typeof panMod.raw === 'object') { panMod = panMod.raw; } else break;
          }
          const panNum = panMod.pan_number || panMod.primary?.pan_number || '';
          const panName = panMod.name || panMod.primary?.name || '';
          const panCitizen = panMod.indian_citizen || panMod.primary?.indian_citizen || '';
          const panStatus = panMod.status || panMod.primary?.status || '';
          const panDob = panMod.date_of_birth || panMod.primary?.date_of_birth || '';
          const panAddress = panMod.address || panMod.primary?.address || '';
          const panMobile = panMod.mobile_number || panMod.primary?.mobile_number || '';
          const panImg1 = panMod.verified_photo_data_url || (() => {
            const url = panMod.verified_photo_url || '';
            return (url && typeof url === 'string' && url.startsWith('data:')) ? url : null;
          })();
          const panImg2 = panMod.verified_photo_data_url_2 || (() => {
            const url2 = panMod.verified_photo_url_2 || '';
            return (url2 && typeof url2 === 'string' && url2.startsWith('data:')) ? url2 : null;
          })();
          const hasPanData = panNum || panName;
          if (!hasPanData) return '';
          let html = '<div class="page sec" style="page-break-before:always;break-before:page">';
          html += '<h2>PAN Details</h2>';
          html += '<div class="block">';
          html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
          html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
          html += '<thead><tr><th colspan="2" style="background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px">BUSINESS PAN VERIFICATION</th></tr></thead>';
          html += '<tbody>';
          if (panNum) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;width:35%;border-bottom:1px solid #e2e8f0">PAN Number</td><td style="padding:8px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #e2e8f0;font-size:13px;letter-spacing:1px">' + safe(panNum) + '</td></tr>';
          if (panName) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Name</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(panName) + '</td></tr>';
          if (panCitizen) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Indian Citizen</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(panCitizen) + '</td></tr>';
          if (panStatus) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Status</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-weight:700;font-size:10.5px;' + (String(panStatus).toUpperCase() === 'ACTIVE' ? 'background:#dcfce7;color:#166534' : 'background:#fee2e2;color:#991b1b') + '">' + safe(panStatus) + '</span></td></tr>';
          if (panDob) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Date of Birth / Incorporation</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(panDob) + '</td></tr>';
          if (panAddress) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Address as per PAN</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(panAddress) + '</td></tr>';
          if (panMobile) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Mobile Number</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(panMobile) + '</td></tr>';
          html += '</tbody></table></div>';
          if (panImg1 || panImg2) {
            const imgCount = (panImg1 ? 1 : 0) + (panImg2 ? 1 : 0);
            const perImgH = imgCount === 2 ? '360px' : '600px';
            html += '<div style="margin-top:10px">';
            html += '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:8px;letter-spacing:0.5px;text-align:center">PAN CARD IMAGES</div>';
            if (panImg1) {
              html += '<div style="text-align:center;margin-bottom:' + (panImg2 ? '12px' : '0') + '">';
              html += '<img src="' + panImg1 + '" alt="PAN Image 1" style="display:block;max-width:100%;max-height:' + perImgH + ';margin:0 auto" />';
              html += '</div>';
            }
            if (panImg2) {
              html += '<div style="text-align:center">';
              html += '<img src="' + panImg2 + '" alt="PAN Image 2" style="display:block;max-width:100%;max-height:' + perImgH + ';margin:0 auto" />';
              html += '</div>';
            }
            html += '</div>';
          }
          html += '</div></div>';
          return html;
        })()}

        ${(() => {
          const bsMod = modules?.bank_statement || {};
          // Deep-unwrap if wrapped in { source, data: {...} } layers
          let bs = bsMod;
          for (let i = 0; i < 10; i++) {
            if (bs.applicant_name !== undefined || bs.bank_name !== undefined || bs.account_number !== undefined) break;
            if (bs.data && typeof bs.data === 'object') { bs = bs.data; } else break;
          }
          const applicantName = bs.applicant_name || '';
          const bankName = bs.bank_name || '';
          const branchAddress = bs.branch_address || '';
          const accountNumber = bs.account_number || '';
          const accountType = bs.account_type || '';
          const remark = bs.remark || '';
          const entries = Array.isArray(bs.status_entries) ? bs.status_entries.filter(e => e && (e.date || e.amount)) : [];
          const hasBsData = applicantName || bankName || accountNumber;
          if (!hasBsData) return '';

          let html = '<div class="page sec" style="page-break-before:always;break-before:page">';
          html += '<h2>Bank Statement Details</h2>';
          html += '<div class="block">';
          html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">';
          html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
          html += '<thead><tr><th colspan="2" style="background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px">BANK ACCOUNT INFORMATION</th></tr></thead>';
          html += '<tbody>';
          if (applicantName) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;width:35%;border-bottom:1px solid #e2e8f0">Applicant Name</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(applicantName) + '</td></tr>';
          if (bankName) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Bank Name</td><td style="padding:8px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #e2e8f0">' + safe(bankName) + '</td></tr>';
          if (branchAddress) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Branch / Address</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(branchAddress) + '</td></tr>';
          if (accountNumber) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Account Number</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-weight:800;letter-spacing:0.5px">' + safe(accountNumber) + '</td></tr>';
          if (accountType) html += '<tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Account Type</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">' + safe(accountType) + '</td></tr>';
          if (remark) html += '<tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Remark</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-style:italic">' + safe(remark) + '</td></tr>';
          html += '</tbody></table></div></div>';

          if (entries.length) {
            html += '<div style="margin-top:16px;page-break-inside:avoid;break-inside:avoid">';
            html += '<div style="font-weight:800;font-size:11px;color:var(--navy);margin-bottom:8px;letter-spacing:0.5px">BANK STATEMENT STATUS ENTRIES</div>';
            html += '<div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
            html += '<thead><tr>';
            html += '<th style="background:var(--navy);color:#fff;font-weight:700;font-size:10px;padding:8px 14px;text-align:left;letter-spacing:0.5px">DATE</th>';
            html += '<th style="background:var(--navy);color:#fff;font-weight:700;font-size:10px;padding:8px 14px;text-align:right;letter-spacing:0.5px">AMOUNT</th>';
            html += '<th style="background:var(--navy);color:#fff;font-weight:700;font-size:10px;padding:8px 14px;text-align:center;letter-spacing:0.5px">TYPE</th>';
            html += '</tr></thead><tbody>';
            entries.forEach((e, i) => {
              const bg = i % 2 === 0 ? '#fbfcfe' : '#fff';
              const typeColor = String(e.type || '').toUpperCase() === 'CREDIT' ? 'color:#166534;background:#dcfce7' : String(e.type || '').toUpperCase() === 'DEBIT' ? 'color:#991b1b;background:#fee2e2' : 'color:#475569;background:#f1f5f9';
              html += '<tr style="background:' + bg + '">';
              html += '<td style="padding:7px 14px;border-bottom:1px solid #e2e8f0">' + safe(e.date) + '</td>';
              html += '<td style="padding:7px 14px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">' + safe(e.amount) + '</td>';
              html += '<td style="padding:7px 14px;border-bottom:1px solid #e2e8f0;text-align:center"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-weight:700;font-size:9.5px;letter-spacing:0.5px;' + typeColor + '">' + safe(String(e.type || '').toUpperCase()) + '</span></td>';
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          }

          html += '</div>';
          return html;
        })()}

        <!-- ═══ PERSONAL INFORMATION — APPLICANT & KYC PAGES ═══ -->
        ${personalInfoHtml}

        <!-- ═══ OVERALL OBSERVATION / CONCLUSION (after all modules & personal block) ═══ -->
        ${overallObservation ? `
        <div class="page sec" style="page-break-before:always;break-before:page">
          <h2>Overall Observation / Conclusion</h2>
          <div class="block">
            <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
              <table style="width:100%;border-collapse:collapse;font-size:11.5px">
                <thead><tr><th style="background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px">OVERALL OBSERVATION / CONCLUSION</th></tr></thead>
                <tbody><tr><td style="padding:16px 18px;line-height:1.75;font-size:11.5px;white-space:pre-wrap;color:#1e293b">${safe(overallObservation)}</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- ═══ VERIFICATION & SIGNING PAGE (last page) ═══ -->
        <div class="page sec" style="page-break-before:always;break-before:page">
          <h2 style="text-align:center;margin-bottom:20px">Verification &amp; Authentication</h2>

          <!-- Legal Entity Table — TOP -->
          <div style="margin-bottom:22px">
            <div style="border:2px solid var(--navy);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(11,31,58,0.05)">
              <table style="width:100%;border-collapse:collapse;font-size:11.5px">
                <thead><tr><th colspan="2" style="background:var(--navy);color:#fff;font-weight:800;font-size:11px;padding:10px 14px;text-align:left;letter-spacing:0.5px">LEGAL ENTITY (VENDOR)</th></tr></thead>
                <tbody>
                  <tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;width:38%;border-bottom:1px solid #e2e8f0">Registered Company Name</td><td style="padding:8px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #e2e8f0">CRUX RISK MANAGEMENT PVT. LTD.</td></tr>
                  <tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">CIN</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;letter-spacing:0.5px">U74999MH2015PTC271164</td></tr>
                  <tr style="background:#fbfcfe"><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Registered Office Address</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">301, Surya Sadan, Ram Maruti Road, Naupada, Thane (W), Maharashtra - 400602, India</td></tr>
                  <tr><td style="padding:8px 14px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">Jurisdiction</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0">India</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Signature (left) & Stamp (right) -->
          <div style="display:flex;justify-content:space-between;gap:30px;margin-bottom:24px">
            <div style="flex:1;text-align:center">
              <div style="font-weight:800;font-size:10px;color:var(--navy);letter-spacing:0.5px;margin-bottom:8px;text-transform:uppercase">Authorized Signatory</div>
              <div style="border:2px solid #e2e8f0;border-radius:10px;padding:12px;background:#fbfcfe;min-height:100px;display:flex;align-items:center;justify-content:center">
                ${signatureDataUrl ? `<img src="${escapeHtml(signatureDataUrl)}" alt="Signature" style="max-width:200px;max-height:100px;object-fit:contain;display:block;margin:0 auto" />` : '<div style="color:#94a3b8;font-size:11px">—</div>'}
              </div>
            </div>
            <div style="flex:1;text-align:center">
              <div style="font-weight:800;font-size:10px;color:var(--navy);letter-spacing:0.5px;margin-bottom:8px;text-transform:uppercase">Company Stamp / Seal</div>
              <div style="border:2px solid #e2e8f0;border-radius:10px;padding:12px;background:#fbfcfe;min-height:100px;display:flex;align-items:center;justify-content:center">
                ${stampDataUrl ? `<img src="${escapeHtml(stampDataUrl)}" alt="Stamp" style="max-width:200px;max-height:100px;object-fit:contain;display:block;margin:0 auto" />` : '<div style="color:#94a3b8;font-size:11px">—</div>'}
              </div>
            </div>
          </div>

          <!-- Verified By (left) & Prepared By (right) -->
          <div style="display:flex;justify-content:space-between;gap:30px;margin-top:8px">
            <div style="flex:1">
              <div style="font-weight:800;font-size:10px;color:var(--navy);letter-spacing:0.5px;margin-bottom:6px;text-transform:uppercase">Authorized By</div>
              <div style="border:2px solid var(--navy);border-radius:10px;padding:14px 18px;background:#f0f4ff;min-height:48px">
                <div style="font-size:14px;font-weight:700;color:#0f172a;letter-spacing:0.3px">${safe('Aniket Chalke')}</div>
              </div>
            </div>
            <div style="flex:1">
              <div style="font-weight:800;font-size:10px;color:var(--navy);letter-spacing:0.5px;margin-bottom:6px;text-transform:uppercase">Prepared By</div>
              <div style="border:2px solid var(--navy);border-radius:10px;padding:14px 18px;background:#f0f4ff;min-height:48px">
                <div style="font-size:14px;font-weight:700;color:#0f172a;letter-spacing:0.3px">${preparedBy ? safe(preparedBy) : '<span style="color:#94a3b8">—</span>'}</div>
              </div>
            </div>
          </div>

        </div>

        <!-- ═══ DISCLAIMER PAGE ═══ -->
        <div class="page" style="page-break-before:always;break-before:page;position:relative;min-height:297mm;padding:0;margin:-10mm -10mm 0 -10mm;width:calc(100% + 20mm);background:#ffffff;overflow:hidden">
          <!-- Left accent bar -->
          <div style="position:absolute;top:0;left:0;width:6mm;height:100%;background:linear-gradient(180deg,#1b2559 0%,#1b2559 60%,#3366cc 80%,#6baed6 100%)"></div>
          <!-- Bottom accent line -->
          <div style="position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6)"></div>

          <div style="padding:24mm 18mm 16mm 22mm">
            <!-- Title -->
            <div style="text-align:center;margin-bottom:18mm">
              <div style="font-size:9px;font-weight:700;color:#1b2559;letter-spacing:4px;text-transform:uppercase;margin-bottom:6px;opacity:0.5">Legal Notice</div>
              <div style="font-size:28px;font-weight:900;color:#1b2559;letter-spacing:0.5px;line-height:1.2">Disclaimer &amp; Terms of Use</div>
              <div style="margin:10px auto 0 auto;width:60px;height:3px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6);border-radius:2px"></div>
            </div>

            <!-- Disclaimer Content -->
            <div style="font-size:10.5px;line-height:1.85;color:#334155;text-align:justify">
              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">1. CONFIDENTIALITY</div>
                <div>This report and all information contained herein are strictly confidential and proprietary. This document is prepared exclusively for the authorized recipient(s) named in the engagement and may not be disclosed, reproduced, distributed, or transmitted to any third party, in whole or in part, without the prior written consent of CRUX RISK MANAGEMENT PVT. LTD.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">2. PURPOSE &amp; SCOPE</div>
                <div>This Pre-Sanction Due Diligence Report has been prepared solely for the purpose of assisting the recipient in evaluating the creditworthiness and legitimacy of the subject entity. The scope of verification is limited to the data sources, modules, and parameters selected at the time of engagement. This report does not constitute legal advice, financial advice, or an audit opinion.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">3. DATA SOURCES &amp; ACCURACY</div>
                <div>Information presented in this report has been sourced from publicly available government databases (GST Portal, MCA, SEBI, Courts, etc.), data provided by the applicant entity, and field verification. While every reasonable effort has been made to ensure accuracy, CRUX RISK MANAGEMENT PVT. LTD. does not warrant or guarantee the completeness, accuracy, or reliability of third-party data. Findings are based on data available as of the report date and may not reflect subsequent changes.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">4. LIMITATION OF LIABILITY</div>
                <div>CRUX RISK MANAGEMENT PVT. LTD. shall not be liable for any direct, indirect, incidental, consequential, or special damages arising from the use of or reliance upon this report. The recipient assumes all risk associated with any decisions made based on this report. The maximum liability, if any, shall be limited to the fee charged for producing this report.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">5. NO GUARANTEE OF OUTCOME</div>
                <div>The observations, risk classifications, and recommendations contained in this report are indicative in nature and based on the information available at the time of preparation. They do not guarantee any specific credit outcome, regulatory compliance, or business performance of the subject entity.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">6. INTELLECTUAL PROPERTY</div>
                <div>All methodologies, scoring frameworks, templates, and proprietary algorithms used in the preparation of this report are the exclusive intellectual property of CRUX RISK MANAGEMENT PVT. LTD. Unauthorized reproduction or reverse-engineering of these systems is prohibited.</div>
              </div>

              <div style="margin-bottom:14px">
                <div style="font-weight:800;font-size:11px;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">7. GOVERNING LAW</div>
                <div>This report and any dispute arising out of or in connection with it shall be governed by and construed in accordance with the laws of India. The courts located in Thane, Maharashtra shall have exclusive jurisdiction over any disputes.</div>
              </div>
            </div>

            <!-- Footer note -->
            <div style="margin-top:12mm;padding:12px 16px;border-top:2px solid #1b2559;text-align:center">
              <div style="font-size:9.5px;color:#64748b;line-height:1.7">
                By accepting and reviewing this report, the recipient acknowledges and agrees to the terms and conditions stated above.<br/>
                <span style="font-weight:700;color:#1b2559">CRUX RISK MANAGEMENT PVT. LTD.</span> &nbsp;|&nbsp; CIN: U74999MH2015PTC271164
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ BACK COVER PAGE ═══ -->
        <div class="page" style="page-break-before:always;break-before:page;position:relative;min-height:297mm;padding:0;margin:-10mm -10mm 0 -10mm;width:calc(100% + 20mm);background:#ffffff;overflow:hidden">
          <!-- Left accent bar -->
          <div style="position:absolute;top:0;left:0;width:8mm;height:100%;background:linear-gradient(180deg,#1b2559 0%,#1b2559 60%,#3366cc 80%,#6baed6 100%)"></div>
          <!-- Bottom accent line -->
          <div style="position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(to right,#1b2559,#3366cc,#6baed6)"></div>

          <!-- Diamond pattern background -->
          <svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 600 850">
            <!-- Row 1 -->
            <polygon points="80,20 120,60 80,100 40,60" fill="none" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="180,20 220,60 180,100 140,60" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="280,20 320,60 280,100 240,60" fill="none" stroke="rgba(51,102,204,0.05)" stroke-width="1"/>
            <polygon points="380,20 420,60 380,100 340,60" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="480,20 520,60 480,100 440,60" fill="none" stroke="rgba(107,174,214,0.07)" stroke-width="1"/>
            <!-- Row 2 -->
            <polygon points="130,80 170,120 130,160 90,120" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="230,80 270,120 230,160 190,120" fill="rgba(51,102,204,0.03)" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="330,80 370,120 330,160 290,120" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="430,80 470,120 430,160 390,120" fill="none" stroke="rgba(51,102,204,0.05)" stroke-width="1"/>
            <polygon points="530,80 570,120 530,160 490,120" fill="none" stroke="rgba(27,37,89,0.04)" stroke-width="1"/>
            <!-- Row 3 -->
            <polygon points="80,140 120,180 80,220 40,180" fill="rgba(51,102,204,0.025)" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="180,140 220,180 180,220 140,180" fill="none" stroke="rgba(27,37,89,0.07)" stroke-width="1"/>
            <polygon points="280,140 320,180 280,220 240,180" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="380,140 420,180 380,220 340,180" fill="rgba(27,37,89,0.025)" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="480,140 520,180 480,220 440,180" fill="none" stroke="rgba(51,102,204,0.05)" stroke-width="1"/>
            <!-- Row 4 -->
            <polygon points="130,200 170,240 130,280 90,240" fill="none" stroke="rgba(107,174,214,0.07)" stroke-width="1"/>
            <polygon points="230,200 270,240 230,280 190,240" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="330,200 370,240 330,280 290,240" fill="rgba(51,102,204,0.03)" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="430,200 470,240 430,280 390,240" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="530,200 570,240 530,280 490,240" fill="none" stroke="rgba(27,37,89,0.05)" stroke-width="1"/>
            <!-- Row 5 -->
            <polygon points="80,260 120,300 80,340 40,300" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="180,260 220,300 180,340 140,300" fill="rgba(107,174,214,0.025)" stroke="rgba(107,174,214,0.07)" stroke-width="1"/>
            <polygon points="280,260 320,300 280,340 240,300" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="380,260 420,300 380,340 340,300" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="480,260 520,300 480,340 440,300" fill="rgba(51,102,204,0.025)" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <!-- Row 6 -->
            <polygon points="130,320 170,360 130,400 90,360" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="230,320 270,360 230,400 190,360" fill="none" stroke="rgba(107,174,214,0.07)" stroke-width="1"/>
            <polygon points="330,320 370,360 330,400 290,360" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="430,320 470,360 430,400 390,360" fill="rgba(27,37,89,0.025)" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <!-- Row 7 -->
            <polygon points="80,380 120,420 80,460 40,420" fill="rgba(51,102,204,0.02)" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="180,380 220,420 180,460 140,420" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="280,380 320,420 280,460 240,420" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="380,380 420,420 380,460 340,420" fill="none" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="480,380 520,420 480,460 440,420" fill="none" stroke="rgba(27,37,89,0.05)" stroke-width="1"/>
            <!-- Row 8 -->
            <polygon points="130,440 170,480 130,520 90,480" fill="none" stroke="rgba(27,37,89,0.07)" stroke-width="1"/>
            <polygon points="230,440 270,480 230,520 190,480" fill="rgba(27,37,89,0.025)" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="330,440 370,480 330,520 290,480" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="430,440 470,480 430,520 390,480" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="530,440 570,480 530,520 490,480" fill="none" stroke="rgba(51,102,204,0.05)" stroke-width="1"/>
            <!-- Row 9 -->
            <polygon points="80,500 120,540 80,580 40,540" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="180,500 220,540 180,580 140,540" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="280,500 320,540 280,580 240,540" fill="rgba(51,102,204,0.025)" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="380,500 420,540 380,580 340,540" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="480,500 520,540 480,580 440,540" fill="rgba(27,37,89,0.02)" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <!-- Row 10 -->
            <polygon points="130,560 170,600 130,640 90,600" fill="rgba(51,102,204,0.025)" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="230,560 270,600 230,640 190,600" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="330,560 370,600 330,640 290,600" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="430,560 470,600 430,640 390,600" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <!-- Row 11 -->
            <polygon points="80,620 120,660 80,700 40,660" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="180,620 220,660 180,700 140,660" fill="none" stroke="rgba(51,102,204,0.07)" stroke-width="1"/>
            <polygon points="280,620 320,660 280,700 240,660" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="380,620 420,660 380,700 340,660" fill="rgba(107,174,214,0.025)" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="480,620 520,660 480,700 440,660" fill="none" stroke="rgba(27,37,89,0.05)" stroke-width="1"/>
            <!-- Row 12 -->
            <polygon points="130,680 170,720 130,760 90,720" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="230,680 270,720 230,760 190,720" fill="rgba(27,37,89,0.02)" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="330,680 370,720 330,760 290,720" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="430,680 470,720 430,760 390,720" fill="none" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <!-- Row 13 -->
            <polygon points="80,740 120,780 80,820 40,780" fill="rgba(107,174,214,0.02)" stroke="rgba(107,174,214,0.06)" stroke-width="1"/>
            <polygon points="180,740 220,780 180,820 140,780" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="280,740 320,780 280,820 240,780" fill="none" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
            <polygon points="380,740 420,780 380,820 340,780" fill="none" stroke="rgba(27,37,89,0.06)" stroke-width="1"/>
            <polygon points="480,740 520,780 480,820 440,780" fill="rgba(51,102,204,0.02)" stroke="rgba(51,102,204,0.06)" stroke-width="1"/>
          </svg>

          <!-- Centered Logo -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:297mm;padding:40mm 20mm;position:relative;z-index:1">
            <!-- CRUX Logo PNG -->
            <div style="margin-bottom:14px">
              <img src="${(() => { try { const logoPath = path.join(path.dirname(__dirname), '..', 'CRUXLOGO.png'); const logoB64 = fs.readFileSync(logoPath).toString('base64'); return 'data:image/png;base64,' + logoB64; } catch(e) { return ''; } })()}" alt="CRUX Logo" style="display:block;max-width:320px;height:auto" />
            </div>

            <!-- Company Info -->
            <div style="text-align:center;max-width:360px">
              <div style="font-size:14px;font-weight:800;color:#1b2559;letter-spacing:0.5px;margin-bottom:6px">CRUX RISK MANAGEMENT PVT. LTD.</div>
              <div style="font-size:10px;color:#64748b;line-height:1.7;margin-bottom:4px">CIN: U74999MH2015PTC271164</div>
              <div style="font-size:10px;color:#64748b;line-height:1.7;margin-bottom:16px">301, Surya Sadan, Ram Maruti Road, Naupada,<br/>Thane (W), Maharashtra - 400602, India</div>
            </div>

            <!-- Horizontal rule -->
            <div style="width:200px;height:1px;background:linear-gradient(to right,transparent,#cbd5e1,transparent);margin-bottom:18px"></div>

            <!-- Report meta -->
            <div style="text-align:center">
              <div style="font-size:10px;font-weight:700;color:#1b2559;letter-spacing:0.5px;margin-bottom:4px">Pre-Sanction Due Diligence Report</div>
              <div style="font-size:9px;color:#94a3b8;letter-spacing:0.3px">Confidential &amp; Privileged Communication</div>
            </div>
          </div>
        </div>

      </body>
      </html>
    `;

    return html;
  }

  async generateComplianceFullReportPDF(payload) {
    const html = this.buildComplianceFullReportHTML(payload);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div style="font-size:8px;width:100%;padding:0 12mm;color:#64748b;"></div>',
        footerTemplate: `
          <div style="font-size:8px;width:100%;padding:0 12mm;color:#64748b;display:flex;justify-content:space-between;">
            <span>Compliance & Risk Report</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        `
      });

      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  buildComplianceFullReportHTML(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const findings = Array.isArray(p.findings) ? p.findings : [];
    const sections = p.sections && typeof p.sections === 'object' ? p.sections : {};
    const companyIdentity = p.companyIdentity && typeof p.companyIdentity === 'object' ? p.companyIdentity : {};
    const summary = p.summary && typeof p.summary === 'object' ? p.summary : {};

    const escapeHtml = (value) => {
      if (value == null) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const safe = (value, fallback = '—') => {
      const s = value == null ? '' : String(value).trim();
      return s ? escapeHtml(s) : escapeHtml(fallback);
    };

    const formatDate = (value) => {
      if (!value) return '—';
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return safe(value);
      return escapeHtml(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    };

    const riskBadgeClass = (flag) => {
      const v = String(flag || '').toLowerCase();
      if (v.includes('adverse')) return 'bad';
      if (v.includes('attention')) return 'warn';
      if (v.includes('clean')) return 'ok';
      if (v.includes('error')) return 'warn';
      return 'neutral';
    };

    const overallStatus = String(p.complianceStatus || summary.overall_status || 'Unknown').trim();
    const companyName = String(p.companyName || companyIdentity.legalName || 'Company').trim();
    const cin = String(p.cin || companyIdentity.cin || '').trim();
    const searchDate = p.searchDate || new Date().toISOString();

    const summaryRows = [
      { label: 'Total Checks', value: summary.total_checks ?? findings.length },
      { label: 'Adverse Records', value: summary.adverse_records ?? findings.filter((f) => f?.match_found === true).length },
      { label: 'Clean Records', value: summary.clean_records ?? findings.filter((f) => f?.match_found === false).length },
      { label: 'Verification Errors', value: summary.verification_errors ?? findings.filter((f) => f?.match_found == null).length }
    ];

    const findingsTableRows = findings.map((f) => {
      const category = f?.category || f?.source || 'Unknown';
      const risk = f?.risk_flag || 'Unknown';
      const status = f?.match_found === true
        ? 'Match Found'
        : f?.match_found === false
          ? 'No Match Found'
          : 'Not Verified';
      const details = f?.details || 'No details available';
      const checked = f?.checked_at ? formatDate(f.checked_at) : '—';
      return `
        <tr>
          <td>${safe(category)}</td>
          <td><span class="badge ${riskBadgeClass(risk)}">${safe(risk)}</span></td>
          <td>${safe(status)}</td>
          <td>${safe(details)}</td>
          <td>${checked}</td>
        </tr>
      `;
    }).join('');

    const sectionEntries = Object.entries(sections).filter(([, v]) => v && typeof v === 'object');
    const sectionHtml = sectionEntries.length
      ? sectionEntries.map(([key, section]) => {
        const sourceLinks = Array.isArray(section.sourceLinks) ? section.sourceLinks : [];
        const evidenceLinks = Array.isArray(section.evidenceLinks) ? section.evidenceLinks : [];
        const inputUsed = Array.isArray(section.inputUsed) ? section.inputUsed : [];

        const linksHtml = (arr) => arr.length
          ? `<ul class="ul">${arr.slice(0, 10).map((l) => {
              const title = safe(l?.title || 'Link');
              const url = safe(l?.url || '');
              const rawUrl = String(l?.url || '').trim();
              if (!/^https?:\/\//i.test(rawUrl)) return `<li>${title}</li>`;
              return `<li><a href="${escapeHtml(rawUrl)}" target="_blank">${title}</a></li>`;
            }).join('')}</ul>`
          : '<div class="muted">No links captured.</div>';

        const inputHtml = inputUsed.length
          ? `<ul class="ul">${inputUsed.slice(0, 8).map((i) => {
              const mode = safe(i?.type || 'unknown');
              const nm = safe(i?.company_name || '—');
              const icin = safe(i?.cin || '—');
              const note = safe(i?.note || '');
              return `<li><strong>Mode:</strong> ${mode}; <strong>Name:</strong> ${nm}; <strong>CIN:</strong> ${icin}${note !== '—' ? `; <strong>Note:</strong> ${note}` : ''}</li>`;
            }).join('')}</ul>`
          : '<div class="muted">Input metadata not available.</div>';

        return `
          <div class="card">
            <h3>${safe(section.title || key)}</h3>
            <p class="p"><strong>Adverse Present:</strong> ${section.adverse ? 'Yes' : 'No'}</p>
            <p class="p"><strong>Section Summary:</strong> ${safe(section.summary || '')}</p>
            <div class="split">
              <div>
                <div class="k">Input Used</div>
                ${inputHtml}
              </div>
              <div>
                <div class="k">Official Source Links</div>
                ${linksHtml(sourceLinks)}
              </div>
            </div>
            <div style="margin-top:8px">
              <div class="k">Evidence Links</div>
              ${linksHtml(evidenceLinks)}
            </div>
          </div>
        `;
      }).join('')
      : '<div class="muted">Sectioned findings were not available in payload.</div>';

    const moduleDetailCards = findings.length
      ? findings.map((f, index) => {
        const evidence = f?.evidence && typeof f.evidence === 'object' ? f.evidence : {};
        const inputUsed = f?.input_used && typeof f.input_used === 'object' ? f.input_used : {};
        const evidenceResults = Array.isArray(evidence.results) ? evidence.results : [];

        const resultLinks = evidenceResults.length
          ? `<ul class="ul">${evidenceResults.slice(0, 12).map((r) => {
              const title = safe(r?.title || r?.clientName || 'Evidence result');
              const url = String(r?.url || '').trim();
              return /^https?:\/\//i.test(url)
                ? `<li><a href="${escapeHtml(url)}" target="_blank">${title}</a></li>`
                : `<li>${title}</li>`;
            }).join('')}</ul>`
          : '<div class="muted">No evidence result items captured.</div>';

        return `
          <div class="card">
            <h3>${index + 1}. ${safe(f?.source || 'Module')} — ${safe(f?.category || 'Category')}</h3>
            <table class="tbl compact">
              <tbody>
                <tr><td class="k">Risk Flag</td><td><span class="badge ${riskBadgeClass(f?.risk_flag)}">${safe(f?.risk_flag || 'Unknown')}</span></td></tr>
                <tr><td class="k">Match Found</td><td>${f?.match_found === true ? 'Yes' : f?.match_found === false ? 'No' : 'Not verified'}</td></tr>
                <tr><td class="k">Details</td><td>${safe(f?.details || '')}</td></tr>
                <tr><td class="k">Checked At</td><td>${safe(formatDate(f?.checked_at))}</td></tr>
                <tr><td class="k">Input Type</td><td>${safe(inputUsed.type || '')}</td></tr>
                <tr><td class="k">Input Name</td><td>${safe(inputUsed.company_name || '')}</td></tr>
                <tr><td class="k">Input CIN</td><td>${safe(inputUsed.cin || '')}</td></tr>
                <tr><td class="k">Input Note</td><td>${safe(inputUsed.note || '')}</td></tr>
              </tbody>
            </table>
            <div style="margin-top:8px">
              <div class="k">Evidence Results</div>
              ${resultLinks}
            </div>
          </div>
        `;
      }).join('')
      : '<div class="muted">No module findings available.</div>';

    const reasoning = String(p.reasoning || '').trim();
    const narrative = String(p.generatedNarrative || '').trim();
    const identityConfidence = p.identityResolution && typeof p.identityResolution === 'object'
      ? p.identityResolution
      : {};

    return `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Compliance Full Report</title>
        <style>
          :root{--ink:#0f172a;--muted:#475569;--line:#dbe3ec;--soft:#f8fafc;--brand:#0b1f3a}
          *{box-sizing:border-box}
          body{margin:0;padding:0;font-family:'DejaVu Sans','Noto Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);background:#fff}
          .page{padding:10mm 0}
          h1{font-size:24px;color:var(--brand);margin:0 0 6px 0}
          h2{font-size:16px;color:var(--brand);margin:0 0 8px 0}
          h3{font-size:13px;color:var(--ink);margin:0 0 6px 0}
          .muted{color:var(--muted);font-size:11px;line-height:1.45}
          .p{margin:0 0 8px 0;font-size:12px;line-height:1.55}
          .section{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:12px;background:#fff}
          .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
          .card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px;background:var(--soft)}
          .split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
          .tbl{width:100%;border-collapse:collapse;font-size:11.5px}
          .tbl th{background:var(--soft);text-align:left;padding:7px;border-bottom:1px solid var(--line);color:var(--muted)}
          .tbl td{padding:7px;border-bottom:1px solid var(--line);vertical-align:top}
          .tbl.compact td{padding:5px 7px}
          .k{font-weight:700;color:var(--muted);font-size:11px}
          .ul{margin:6px 0 0 18px;padding:0;font-size:11.5px;line-height:1.5}
          .badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--line);font-size:10px;font-weight:800}
          .badge.ok{background:rgba(15,118,110,.08);border-color:rgba(15,118,110,.25)}
          .badge.warn{background:rgba(180,83,9,.08);border-color:rgba(180,83,9,.25)}
          .badge.bad{background:rgba(185,28,28,.08);border-color:rgba(185,28,28,.25)}
          .badge.neutral{background:#f1f5f9;border-color:#cbd5e1}
          .kv{display:grid;grid-template-columns:50mm 1fr;border:1px solid var(--line);border-radius:10px;overflow:hidden}
          .kv div{padding:8px 10px;border-top:1px solid var(--line);font-size:12px}
          .kv div:nth-child(-n+2){border-top:0}
          .kv .l{background:var(--soft);font-weight:700;color:var(--muted)}
          a{color:#0f4c81;text-decoration:none}
        </style>
      </head>
      <body>
        <div class="page">
          <h1>Compliance &amp; Risk Intelligence Report</h1>
          <div class="muted">Generated from publicly available records and configured verification modules.</div>

          <div class="section">
            <h2>Report Header</h2>
            <div class="kv">
              <div class="l">Company Name</div><div>${safe(companyName)}</div>
              <div class="l">CIN</div><div>${safe(cin)}</div>
              <div class="l">Search Date</div><div>${safe(formatDate(searchDate))}</div>
              <div class="l">Overall Status</div><div><span class="badge ${riskBadgeClass(overallStatus)}">${safe(overallStatus)}</span></div>
            </div>
          </div>

          <div class="section">
            <h2>Executive Summary</h2>
            <table class="tbl">
              <tbody>
                ${summaryRows.map((row) => `<tr><td class="k">${safe(row.label)}</td><td>${safe(String(row.value ?? '0'))}</td></tr>`).join('')}
              </tbody>
            </table>
            ${reasoning ? `<p class="p" style="margin-top:8px"><strong>Decision Reasoning:</strong> ${safe(reasoning)}</p>` : ''}
            ${narrative ? `<p class="p"><strong>Narrative:</strong> ${safe(narrative)}</p>` : ''}
          </div>

          <div class="section">
            <h2>Company Identity Snapshot</h2>
            <table class="tbl">
              <tbody>
                <tr><td class="k">Legal Name</td><td>${safe(companyIdentity.legalName || companyName)}</td></tr>
                <tr><td class="k">Normalized Name</td><td>${safe(companyIdentity.normalizedName || '')}</td></tr>
                <tr><td class="k">Status</td><td>${safe(companyIdentity.status || '')}</td></tr>
                <tr><td class="k">Charges Count</td><td>${safe(String(companyIdentity.chargesCount ?? '0'))}</td></tr>
                <tr><td class="k">Identity Source</td><td>${safe(companyIdentity.source || '')}</td></tr>
                <tr><td class="k">Directors</td><td>${safe(Array.isArray(companyIdentity.directors) ? companyIdentity.directors.join(', ') : '')}</td></tr>
                <tr><td class="k">Addresses</td><td>${safe(Array.isArray(companyIdentity.addresses) ? companyIdentity.addresses.join(' | ') : '')}</td></tr>
                <tr><td class="k">Resolution Confidence</td><td>${safe(identityConfidence.level || identityConfidence.label || identityConfidence.confidence || '')}</td></tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <h2>Module Findings Summary</h2>
            <table class="tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Risk Flag</th>
                  <th>Result</th>
                  <th>Remarks</th>
                  <th>Checked</th>
                </tr>
              </thead>
              <tbody>
                ${findingsTableRows || '<tr><td colspan="5" class="muted">No findings available.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="section">
            <h2>Sectioned Compliance Notes</h2>
            ${sectionHtml}
          </div>

          <div class="section">
            <h2>Detailed Module Pages</h2>
            ${moduleDetailCards}
          </div>

          <div class="section">
            <h2>Disclaimer</h2>
            <p class="p">${safe(p.disclaimer || 'This report is based on publicly available information as of search date. It does not constitute legal advice or certification.')}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export default new ReportService();
