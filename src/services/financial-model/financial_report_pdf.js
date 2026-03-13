import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';

const BORDER = '#D1D5DB';
const HEADER_FILL = '#F3F4F6';
const SUBHEADER_FILL = '#EEF2FF';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#4B5563';

function toSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value) {
  const num = toSafeNumber(value);
  if (num == null) return 'N/A';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatRatio(value, { percent = false } = {}) {
  const num = toSafeNumber(value);
  if (num == null) return 'N/A';
  if (percent) return `${(num * 100).toFixed(2)}%`;
  return Number.isInteger(num) ? String(num) : num.toFixed(4);
}

function ensurePageSpace(doc, requiredHeight = 40) {
  const usableBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + requiredHeight > usableBottom) {
    doc.addPage();
  }
}

function drawHeader(doc, { companyName, auditId }) {
  doc.fillColor(TEXT_DARK);
  doc.font('Helvetica-Bold').fontSize(18).text('FINANCIAL UNDERWRITING REPORT', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).text(`Company: ${String(companyName || 'UNKNOWN COMPANY').trim() || 'UNKNOWN COMPANY'}`, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(`Audit ID: ${auditId}`, { align: 'center' });
  doc.moveDown(0.4);

  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  doc.strokeColor(BORDER).lineWidth(1).moveTo(x, y).lineTo(x + width, y).stroke();
  doc.restore();
  doc.moveDown(0.8);
}

function addSectionTitle(doc, title, subtitle = '') {
  ensurePageSpace(doc, 36);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.rect(x, y, width, 24).fillColor(SUBHEADER_FILL).fill();
  doc.restore();

  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(11).text(title, x + 8, y + 7, {
    width: width - 16,
    align: 'left'
  });
  doc.y = y + 28;

  if (subtitle) {
    doc.fillColor(TEXT_MUTED).font('Helvetica').fontSize(9).text(subtitle);
    doc.moveDown(0.25);
  }
}

function drawKeyValueTable(doc, rows = []) {
  const validRows = Array.isArray(rows) ? rows.filter((row) => Array.isArray(row) && row.length >= 2) : [];
  if (!validRows.length) return;

  const x = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const keyWidth = Math.round(totalWidth * 0.36);
  const valueWidth = totalWidth - keyWidth;

  for (const [key, value] of validRows) {
    ensurePageSpace(doc, 24);
    const y = doc.y;
    const keyText = String(key || '');
    const valueText = String(value ?? 'N/A');

    const keyHeight = doc.heightOfString(keyText, { width: keyWidth - 12, align: 'left' });
    const valueHeight = doc.heightOfString(valueText, { width: valueWidth - 12, align: 'left' });
    const rowHeight = Math.max(24, keyHeight + 10, valueHeight + 10);

    doc.save();
    doc.rect(x, y, keyWidth, rowHeight).fillColor(HEADER_FILL).fill().strokeColor(BORDER).stroke();
    doc.rect(x + keyWidth, y, valueWidth, rowHeight).fillColor('#FFFFFF').fill().strokeColor(BORDER).stroke();
    doc.restore();

    doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(9).text(keyText, x + 6, y + 6, { width: keyWidth - 12 });
    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(9).text(valueText, x + keyWidth + 6, y + 6, { width: valueWidth - 12 });

    doc.y = y + rowHeight;
  }

  doc.moveDown(0.5);
}

function drawBulletBox(doc, lines = []) {
  const entries = Array.isArray(lines)
    ? lines.map((line) => String(line || '').trim()).filter(Boolean)
    : [];

  if (!entries.length) return;

  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bulletLines = entries.map((line) => `• ${line}`);
  const text = bulletLines.join('\n');
  const textHeight = doc.heightOfString(text, { width: width - 16, align: 'left' });
  const boxHeight = textHeight + 16;

  ensurePageSpace(doc, boxHeight + 8);
  const y = doc.y;
  doc.save();
  doc.rect(x, y, width, boxHeight).fillColor('#FFFFFF').fill().strokeColor(BORDER).stroke();
  doc.restore();

  doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(9).text(text, x + 8, y + 8, {
    width: width - 16,
    align: 'left'
  });
  doc.y = y + boxHeight + 6;
}

function isNumericLike(text) {
  return /^[-+]?\d[\d,.%]*$/.test(String(text || '').trim());
}

function drawDataTable(doc, { headers = [], rows = [], columnRatios = [] } = {}) {
  const safeHeaders = Array.isArray(headers) ? headers.map((item) => String(item || '').trim()) : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeHeaders.length || !safeRows.length) {
    drawBulletBox(doc, ['No data available for this section.']);
    return;
  }

  const x = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const normalizedRatios = safeHeaders.map((_, index) => Number(columnRatios[index]) || 1);
  const ratioSum = normalizedRatios.reduce((sum, value) => sum + value, 0) || safeHeaders.length;
  const colWidths = normalizedRatios.map((value) => (value / ratioSum) * totalWidth);

  const drawRow = (cells, { header = false } = {}) => {
    const normalized = safeHeaders.map((_, index) => String(cells?.[index] ?? ''));
    const heights = normalized.map((cell, index) => doc.heightOfString(cell, { width: colWidths[index] - 10, align: 'left' }));
    const rowHeight = Math.max(24, ...heights.map((height) => height + 10));

    ensurePageSpace(doc, rowHeight + 2);
    const y = doc.y;
    let cursorX = x;
    for (let index = 0; index < safeHeaders.length; index += 1) {
      const width = colWidths[index];
      doc.save();
      doc.rect(cursorX, y, width, rowHeight).fillColor(header ? HEADER_FILL : '#FFFFFF').fill().strokeColor(BORDER).stroke();
      doc.restore();

      const text = normalized[index];
      const align = header ? 'left' : (isNumericLike(text) ? 'right' : 'left');
      doc.fillColor(TEXT_DARK)
        .font(header ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .text(text, cursorX + 5, y + 5, { width: width - 10, align });

      cursorX += width;
    }
    doc.y = y + rowHeight;
  };

  drawRow(safeHeaders, { header: true });
  for (const row of safeRows) drawRow(row, { header: false });
  doc.moveDown(0.4);
}

function evidenceRows(financialsEvidence = {}) {
  const entries = Object.entries(financialsEvidence || {});
  if (!entries.length) return [];
  return entries.map(([field, evidence]) => {
    const value = formatAmount(evidence?.value);
    const source = String(evidence?.source_section || 'UNSPECIFIED').replace(/\s+/g, ' ').trim();
    const confidence = toSafeNumber(evidence?.confidence_score);
    return [
      field,
      value,
      source,
      confidence == null ? 'N/A' : `${(confidence * 100).toFixed(0)}%`
    ];
  });
}

function calculationRows(calculationAudit = {}) {
  const entries = Object.values(calculationAudit || {});
  if (!entries.length) return [];

  return entries.map((item) => [
    item?.ratio || 'N/A',
    item?.formula || 'N/A',
    item?.substituted_values || 'N/A',
    item?.result ?? 'N/A'
  ]);
}

function decisionExplanationRows(items = []) {
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((entry) => [entry?.code || 'CODE', entry?.explanation || 'N/A']);
}

function buildProfitLossRows({ extractedFinancials = {}, previousYearFinancials = null }) {
  return [
    ['Net Sales / Revenue', formatAmount(extractedFinancials?.revenue), formatAmount(previousYearFinancials?.revenue)],
    ['Cost of Goods Sold', formatAmount(extractedFinancials?.cogs), formatAmount(previousYearFinancials?.cogs)],
    ['Gross Profit', formatAmount(extractedFinancials?.gross_profit), formatAmount(previousYearFinancials?.gross_profit)],
    ['Employee Costs', formatAmount(extractedFinancials?.employee_expenses), formatAmount(previousYearFinancials?.employee_expenses)],
    ['Other Expenses', formatAmount(extractedFinancials?.other_expenses), formatAmount(previousYearFinancials?.other_expenses)],
    ['Profit After Tax', formatAmount(extractedFinancials?.net_profit), formatAmount(previousYearFinancials?.net_profit)]
  ];
}

function buildBalanceAssetRows({ extractedFinancials = {}, previousYearFinancials = null }) {
  const currentNonCurrent = toSafeNumber(extractedFinancials?.total_assets) != null && toSafeNumber(extractedFinancials?.current_assets) != null
    ? toSafeNumber(extractedFinancials?.total_assets) - toSafeNumber(extractedFinancials?.current_assets)
    : null;
  const previousNonCurrent = toSafeNumber(previousYearFinancials?.total_assets) != null && toSafeNumber(previousYearFinancials?.current_assets) != null
    ? toSafeNumber(previousYearFinancials?.total_assets) - toSafeNumber(previousYearFinancials?.current_assets)
    : null;

  return [
    ['Current Assets', formatAmount(extractedFinancials?.current_assets), formatAmount(previousYearFinancials?.current_assets)],
    ['Inventory', formatAmount(extractedFinancials?.inventory), formatAmount(previousYearFinancials?.inventory)],
    ['Receivables', formatAmount(extractedFinancials?.receivables), formatAmount(previousYearFinancials?.receivables)],
    ['Cash & Bank', formatAmount(extractedFinancials?.cash), formatAmount(previousYearFinancials?.cash)],
    ['Non-Current Assets (derived)', formatAmount(currentNonCurrent), formatAmount(previousNonCurrent)],
    ['Total Assets', formatAmount(extractedFinancials?.total_assets), formatAmount(previousYearFinancials?.total_assets)]
  ];
}

function buildBalanceLiabilityRows({ extractedFinancials = {}, previousYearFinancials = null }) {
  const currentLiabilitiesTotal = toSafeNumber(extractedFinancials?.current_liabilities) != null && toSafeNumber(extractedFinancials?.long_term_debt) != null
    ? toSafeNumber(extractedFinancials?.current_liabilities) + toSafeNumber(extractedFinancials?.long_term_debt)
    : null;
  const previousLiabilitiesTotal = toSafeNumber(previousYearFinancials?.current_liabilities) != null && toSafeNumber(previousYearFinancials?.long_term_debt) != null
    ? toSafeNumber(previousYearFinancials?.current_liabilities) + toSafeNumber(previousYearFinancials?.long_term_debt)
    : null;
  const currentLplusE = currentLiabilitiesTotal != null && toSafeNumber(extractedFinancials?.equity) != null
    ? currentLiabilitiesTotal + toSafeNumber(extractedFinancials?.equity)
    : null;
  const previousLplusE = previousLiabilitiesTotal != null && toSafeNumber(previousYearFinancials?.equity) != null
    ? previousLiabilitiesTotal + toSafeNumber(previousYearFinancials?.equity)
    : null;

  return [
    ['Current Liabilities', formatAmount(extractedFinancials?.current_liabilities), formatAmount(previousYearFinancials?.current_liabilities)],
    ['Long Term Debt', formatAmount(extractedFinancials?.long_term_debt), formatAmount(previousYearFinancials?.long_term_debt)],
    ['Total Liabilities (derived)', formatAmount(currentLiabilitiesTotal), formatAmount(previousLiabilitiesTotal)],
    ['Equity', formatAmount(extractedFinancials?.equity), formatAmount(previousYearFinancials?.equity)],
    ['Liabilities + Equity (derived)', formatAmount(currentLplusE), formatAmount(previousLplusE)]
  ];
}

function buildRatioRows({ ratios = {}, previousRatios = null }) {
  return [
    ['Current Ratio', formatRatio(ratios?.current_ratio), formatRatio(previousRatios?.current_ratio)],
    ['Quick Ratio', formatRatio(ratios?.quick_ratio), formatRatio(previousRatios?.quick_ratio)],
    ['Debt Equity Ratio', formatRatio(ratios?.debt_equity), formatRatio(previousRatios?.debt_equity)],
    ['Net Profit Margin', formatRatio(ratios?.net_profit_margin, { percent: true }), formatRatio(previousRatios?.net_profit_margin, { percent: true })],
    ['ROA', formatRatio(ratios?.roa, { percent: true }), formatRatio(previousRatios?.roa, { percent: true })],
    ['Debtor Days', formatRatio(ratios?.debtor_days), formatRatio(previousRatios?.debtor_days)],
    ['Working Capital', formatAmount(ratios?.working_capital), formatAmount(previousRatios?.working_capital)]
  ];
}

function buildCAObservations({ extractedFinancials = {}, ratios = {}, authenticityCheck = {}, decision = {} }) {
  const totalAssets = toSafeNumber(extractedFinancials?.total_assets);
  const currentAssets = toSafeNumber(extractedFinancials?.current_assets);
  const currentLiabilities = toSafeNumber(extractedFinancials?.current_liabilities);
  const longTermDebt = toSafeNumber(extractedFinancials?.long_term_debt);
  const equity = toSafeNumber(extractedFinancials?.equity);
  const liabilitiesPlusEquity =
    currentLiabilities != null && longTermDebt != null && equity != null
      ? currentLiabilities + longTermDebt + equity
      : null;
  const gap = totalAssets != null && liabilitiesPlusEquity != null
    ? totalAssets - liabilitiesPlusEquity
    : null;

  return [
    `Authenticity gate status is ${authenticityCheck?.authenticity_status || 'UNKNOWN'} with risk score ${authenticityCheck?.risk_score ?? 'N/A'}.`,
    `Current ratio stands at ${formatRatio(ratios?.current_ratio)} against ideal benchmark >= 1.00.`,
    `Working capital is ${formatAmount(ratios?.working_capital)} indicating ${toSafeNumber(ratios?.working_capital) != null && ratios.working_capital < 0 ? 'stress in short-term liquidity.' : 'acceptable short-term liquidity.'}`,
    `Net profit margin is ${formatRatio(ratios?.net_profit_margin, { percent: true })} and debtor days are ${formatRatio(ratios?.debtor_days)}.`,
    `Balance sheet equation variance (Assets - Liabilities - Equity) is ${formatAmount(gap)}.`,
    `Final underwriting decision is ${decision?.decision || 'REVIEW'} with grade ${decision?.grade || 'N/A'} and score ${decision?.score ?? 'N/A'}.`
  ];
}

function buildAnalystLineRows(analystSummary = '') {
  const lines = String(analystSummary || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  return lines.map((line, index) => [String(index + 1), line]);
}

export class FinancialReportPdfService {
  constructor({ outputDir = path.resolve(process.cwd(), 'logs', 'financial-reports') } = {}) {
    this.outputDir = outputDir;
  }

  async generate({
    auditId,
    companyName,
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
    confidenceReason,
    improvementSuggestions,
    financialsEvidence,
    calculationAudit,
    decisionCodeExplanations,
    accountingObservations
  }) {
    await fs.mkdir(this.outputDir, { recursive: true });
    const fileName = `${auditId}_financial_underwriting_report.pdf`;
    const filePath = path.join(this.outputDir, fileName);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 44, left: 42, right: 42 }
      });

      const stream = doc.pipe(createWriteStream(filePath));
      stream.on('finish', resolve);
      stream.on('error', reject);
      doc.on('error', reject);

      drawHeader(doc, { companyName, auditId });

      addSectionTitle(doc, '1. EXECUTIVE DECISION SNAPSHOT', 'Underwriting-grade summary for immediate decisioning.');
      drawKeyValueTable(doc, [
        ['Final Decision', decision?.decision || 'REVIEW'],
        ['Assessment Criteria', 'Unified criteria for CA and Bank review'],
        ['Decision Grade', decision?.grade || 'N/A'],
        ['Decision Score (Risk Engine)', decision?.score ?? 'N/A'],
        ['Authenticity Status', authenticityCheck?.authenticity_status || 'UNKNOWN'],
        ['Authenticity Risk Score', authenticityCheck?.risk_score ?? 'N/A'],
        ['Risk Concern Label', riskScoreLabel || 'N/A'],
        ['Overall Confidence Score', confidence?.confidence_score ?? 'N/A'],
        ['Data Reliability Score', dataReliability?.confidence_score ?? 'N/A'],
        ['Reliability Level', dataReliability?.reliability_level || 'DECLARED']
      ]);

      addSectionTitle(doc, '2. MODEL OUTPUT VS RULE ENGINE', 'What model extracted from documents and what deterministic rules decided.');
      drawKeyValueTable(doc, [
        ['Model-Extracted Company Name', String(companyName || 'N/A')],
        ['Model Evidence Coverage', `${Object.values(financialsEvidence || {}).filter((item) => item?.value != null).length}/${Object.keys(financialsEvidence || {}).length || 0} fields`],
        ['Rule Engine Final Decision', `${decision?.decision || 'REVIEW'} (Grade ${decision?.grade || 'N/A'})`],
        ['Primary Override Reason', decision?.decision_priority_reason || 'N/A'],
        ['Confidence Justification', String(confidenceReason || 'N/A')],
        ['Accounting Observation', String(accountingObservations || 'N/A')]
      ]);

      addSectionTitle(doc, '3. FINANCIAL STATEMENTS (ALIGNED TABLES)');
      drawDataTable(doc, {
        headers: ['Profit & Loss Particulars', 'Current Year', 'Previous Year'],
        rows: buildProfitLossRows({ extractedFinancials, previousYearFinancials }),
        columnRatios: [3.3, 1.4, 1.4]
      });
      drawDataTable(doc, {
        headers: ['Balance Sheet - Assets', 'Current Year', 'Previous Year'],
        rows: buildBalanceAssetRows({ extractedFinancials, previousYearFinancials }),
        columnRatios: [3.3, 1.4, 1.4]
      });
      drawDataTable(doc, {
        headers: ['Balance Sheet - Liabilities & Equity', 'Current Year', 'Previous Year'],
        rows: buildBalanceLiabilityRows({ extractedFinancials, previousYearFinancials }),
        columnRatios: [3.3, 1.4, 1.4]
      });
      drawDataTable(doc, {
        headers: ['Ratio', 'Current', 'Previous'],
        rows: buildRatioRows({ ratios, previousRatios }),
        columnRatios: [2.8, 1.6, 1.6]
      });

      addSectionTitle(doc, '4. EVIDENCE TRACEABILITY (MODEL EXTRACTION)', 'Field-level source mapping from uploaded document.');
      drawDataTable(doc, {
        headers: ['Field', 'Value', 'Source Section', 'Confidence'],
        rows: evidenceRows(financialsEvidence),
        columnRatios: [1.3, 1.2, 3.7, 1.0]
      });

      addSectionTitle(doc, '5. RATIO WORKINGS (AUDIT TRAIL)', 'Deterministic formulas and substituted values.');
      drawDataTable(doc, {
        headers: ['Ratio', 'Formula', 'Substituted Values', 'Result'],
        rows: calculationRows(calculationAudit),
        columnRatios: [1.4, 1.8, 3.5, 1.0]
      });

      addSectionTitle(doc, '6. DECISION CODE EXPLANATIONS');
      drawDataTable(doc, {
        headers: ['Code', 'Meaning'],
        rows: decisionExplanationRows(decisionCodeExplanations),
        columnRatios: [1.7, 5.3]
      });

      addSectionTitle(doc, '7. DETAILED CA OBSERVATIONS', 'Professional credit-review commentary based on extracted statements and rules.');
      drawBulletBox(doc, buildCAObservations({ extractedFinancials, ratios, authenticityCheck, decision }));

      addSectionTitle(doc, '8. ANALYST VIEW (LINE BY LINE)', 'Structured analyst narrative for review committee.');
      drawDataTable(doc, {
        headers: ['Line', 'Analyst Statement'],
        rows: buildAnalystLineRows(analystSummary),
        columnRatios: [0.8, 6.2]
      });

      addSectionTitle(doc, '9. CREDIT ACTION PLAN');
      drawBulletBox(doc, Array.isArray(improvementSuggestions?.mandatory_conditions) && improvementSuggestions.mandatory_conditions.length
        ? improvementSuggestions.mandatory_conditions
        : ['No critical action identified.']);
      drawBulletBox(doc, Array.isArray(improvementSuggestions?.risk_mitigation) && improvementSuggestions.risk_mitigation.length
        ? improvementSuggestions.risk_mitigation
        : ['No risk mitigation action identified.']);
      drawBulletBox(doc, Array.isArray(improvementSuggestions?.advisory_recommendations) && improvementSuggestions.advisory_recommendations.length
        ? improvementSuggestions.advisory_recommendations
        : ['No advisory recommendation identified.']);

      doc.end();
    });

    return filePath;
  }
}

export default FinancialReportPdfService;
