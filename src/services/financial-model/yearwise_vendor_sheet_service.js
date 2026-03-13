import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import OpenAI from 'openai';
import XLSX from 'xlsx';

import { ExtractionService } from './extraction_service.js';
import { OpenAIDocumentService } from './openai_document_service.js';

const execFileAsync = promisify(execFile);

const COLS = ['B', 'C', 'D'];
const MATCH_FIELDS = [
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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const hasAssessmentYearMarker = /\bassessment\s*year\b|\bay\b/i.test(s);
  const hasFinancialYearMarker = /\bfinancial\s*year\b|\bfy\b/i.test(s);
  const treatAsAssessmentYear = hasAssessmentYearMarker && !hasFinancialYearMarker;

  const range4Digit = s.match(/(20\d{2}|19\d{2})\s*[-/]\s*(20\d{2}|19\d{2})/);
  if (range4Digit) {
    const startYear = Number(range4Digit[1]);
    const endYear = Number(range4Digit[2]);
    if (!(Number.isFinite(startYear) && Number.isFinite(endYear))) return null;
    return treatAsAssessmentYear ? startYear : Math.max(startYear, endYear);
  }

  const range2Digit = s.match(/(20\d{2}|19\d{2})\s*[-/]\s*(\d{2})/);
  if (range2Digit) {
    const startYear = Number(range2Digit[1]);
    const endYY = Number(range2Digit[2]);
    if (Number.isFinite(startYear) && Number.isFinite(endYY)) {
      const century = Math.floor(startYear / 100) * 100;
      const candidate = century + endYY;
      const endYear = candidate < startYear ? candidate + 100 : candidate;
      return treatAsAssessmentYear ? startYear : endYear;
    }
  }

  const single = s.match(/(20\d{2}|19\d{2})/);
  if (!single) return null;
  return Number(single[1]);
}

function formatPeriodEndCell(endYear) {
  const y = Number(endYear);
  if (!Number.isFinite(y)) return '';
  return `03/31/${String(Math.trunc(y))}`;
}

const PERIOD_ROWS = [3, 35, 63, 102, 113, 122];
const VALUE_ROWS_TO_CLEAR = [
  7, 8, 9, 11, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  50, 54, 55, 59, 60, 66, 77, 87, 98, 100
];
const TEMPLATE_ROW_NUMBERS = [...VALUE_ROWS_TO_CLEAR];
const EXTRACT_FIELD_TO_CELL_ROW = {
  revenue: 7,
  cogs: 11,
  employee_expenses: 14,
  other_expenses: 15,
  net_profit: 31,
  receivables: 50,
  cash: 54,
  inventory: 55,
  current_assets: 59,
  total_assets: 60,
  equity: 66,
  long_term_debt: 77,
  current_liabilities: 98,
  total_liabilities: 100
};

const STANDARD_DERIVED_RULES = [
  { row: 9, refs: [7, 8], op: 'sum' },
  { row: 18, refs: [11, 14, 15], op: 'sum' },
  { row: 19, refs: [9, 18], op: 'sub' },
  { row: 21, refs: [19, 20], op: 'sub' },
  { row: 23, refs: [21, 22], op: 'sub' },
  { row: 24, refs: [23, 29], op: 'sub' },
  { row: 26, refs: [23, 25], op: 'sum' },
  { row: 28, refs: [26, 27], op: 'sum' },
  { row: 32, refs: [20, 30, 31], op: 'sum' }
];

function clearCell(ws, address) {
  if (!ws || !address) return;
  delete ws[address];
}

function hasCell(ws, address) {
  return Boolean(ws && ws[address] && (ws[address].v != null || ws[address].w != null));
}

function setNumericCell(ws, address, value) {
  if (!ws || !address) return;
  const n = toNumber(value);
  if (n == null) {
    clearCell(ws, address);
    return;
  }
  ws[address] = { t: 'n', v: n };
}

function setTextCell(ws, address, value) {
  if (!ws || !address) return;
  const text = String(value || '').trim();
  if (!text) {
    clearCell(ws, address);
    return;
  }
  ws[address] = { t: 's', v: text };
}

function clearYearColumn(ws, column) {
  for (const row of PERIOD_ROWS) clearCell(ws, `${column}${row}`);
  for (const row of VALUE_ROWS_TO_CLEAR) clearCell(ws, `${column}${row}`);
}

function getNumericCell(ws, address) {
  const cell = ws?.[address];
  if (!cell) return null;
  return toNumber(cell.v ?? cell.w ?? null);
}

function computeFromRule({ op, values }) {
  if (!Array.isArray(values) || !values.length) return null;
  if (values.some((v) => v == null)) return null;
  if (op === 'sum') return values.reduce((sum, v) => sum + v, 0);
  if (op === 'sub' && values.length === 2) return values[0] - values[1];
  return null;
}

function applyStandardDerivedRows(ws, column) {
  for (const rule of STANDARD_DERIVED_RULES) {
    const refs = Array.isArray(rule.refs) ? rule.refs : [];
    const values = refs.map((rowNo) => getNumericCell(ws, `${column}${rowNo}`));
    const computed = computeFromRule({ op: rule.op, values });
    setNumericCell(ws, `${column}${rule.row}`, computed);
  }
}

function fillYearColumn(ws, column, fin, year, templateRowValues = {}) {
  clearYearColumn(ws, column);
  const periodLabel = formatPeriodEndCell(year);
  const periodText = periodLabel || `${year || ''}`;

  for (const row of PERIOD_ROWS) setTextCell(ws, `${column}${row}`, periodText);

  const templateValues = templateRowValues && typeof templateRowValues === 'object' ? templateRowValues : {};
  for (const rowNo of TEMPLATE_ROW_NUMBERS) {
    const key = String(rowNo);
    if (!(key in templateValues)) continue;
    setNumericCell(ws, `${column}${rowNo}`, templateValues[key]);
  }

  const source = fin && typeof fin === 'object' ? fin : {};
  for (const [field, row] of Object.entries(EXTRACT_FIELD_TO_CELL_ROW)) {
    const address = `${column}${row}`;
    if (hasCell(ws, address)) continue;
    setNumericCell(ws, address, source[field]);
  }

  applyStandardDerivedRows(ws, column);
}

function parseSummaryJson(raw) {
  if (!raw) return null;
  try {
    const text = String(raw)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeTemplateRowValues(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const rowNo of TEMPLATE_ROW_NUMBERS) {
    const key = String(rowNo);
    const n = toNumber(input[key]);
    if (n == null) continue;
    out[key] = n;
  }
  return out;
}

function percentDiff(baseValue, compareValue) {
  const a = toNumber(baseValue);
  const b = toNumber(compareValue);
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return 0;
  if (a === 0) return 100;
  return Math.abs(((b - a) / a) * 100);
}

function buildMatchSummary({ bankFinancials = {}, vendorFinancials = {}, tolerancePct = 5 }) {
  const tol = Math.max(0, Number.isFinite(Number(tolerancePct)) ? Number(tolerancePct) : 5);
  const rows = MATCH_FIELDS.map((field) => {
    const bankValue = toNumber(bankFinancials?.[field]);
    const vendorValue = toNumber(vendorFinancials?.[field]);
    const diffPct = percentDiff(bankValue, vendorValue);

    let status = 'match';
    if (bankValue == null && vendorValue == null) status = 'missing_both';
    else if (bankValue == null) status = 'missing_bank';
    else if (vendorValue == null) status = 'missing_vendor';
    else if ((diffPct ?? 0) > tol) status = 'mismatch';

    return {
      field,
      bank_value: bankValue,
      vendor_value: vendorValue,
      diff_pct: diffPct,
      tolerance_pct: tol,
      status
    };
  });

  const mismatches = rows.filter((row) => row.status === 'mismatch');
  const missing = rows.filter((row) => row.status.startsWith('missing'));
  const matches = rows.filter((row) => row.status === 'match');

  return {
    tolerance_pct: tol,
    status: mismatches.length ? 'mismatch_found' : 'matched',
    matched_count: matches.length,
    mismatch_count: mismatches.length,
    missing_count: missing.length,
    rows
  };
}

export class YearwiseVendorSheetService {
  constructor({
    openaiClient,
    model = process.env.OPENAI_FINANCIAL_MODEL || 'gpt-4.1-mini',
    templatePath = path.resolve(process.cwd(), 'FINANCIAL FINAL.xlsx'),
    outputDir = path.resolve(process.cwd(), 'logs', 'financial-reports')
  } = {}) {
    this.openai = openaiClient || (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null);
    this.model = model;
    this.templatePath = templatePath;
    this.outputDir = outputDir;

    this.extractionService = new ExtractionService({ openaiClient: this.openai, model: this.model });
    this.documentService = new OpenAIDocumentService({ openaiClient: this.openai });
  }

  async analyzeAndFill({ bankFile, vendorYearlyFiles, years = [], companyName = null, generatePdf = true, tolerancePct = 5 }) {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not configured. OpenAI API is required for year-wise vendor analysis.');
    }
    if (!bankFile?.buffer) {
      throw new Error('Bank financial PDF is required for matching in year-wise flow.');
    }
    if (!Array.isArray(vendorYearlyFiles) || !vendorYearlyFiles.length) {
      throw new Error('At least one vendor year-wise PDF is required.');
    }

    const files = vendorYearlyFiles.slice(0, 3);
    const tempPaths = [];
    const fileIds = [];

    try {
      const bankTempPath = path.join(os.tmpdir(), `bank_anchor_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
      await fs.writeFile(bankTempPath, bankFile.buffer);
      tempPaths.push(bankTempPath);
      const bankFileId = await this.documentService.uploadAndGetFileId(bankTempPath);
      fileIds.push(bankFileId);
      const bankExtraction = await this.extractionService.extractFinancialsFromFileId({
        fileId: bankFileId,
        sourceLabel: 'bank_submitted_anchor'
      });

      for (const file of files) {
        const tempPath = path.join(os.tmpdir(), `vendor_year_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
        await fs.writeFile(tempPath, file.buffer);
        tempPaths.push(tempPath);
        const fileId = await this.documentService.uploadAndGetFileId(tempPath);
        fileIds.push(fileId);
      }

      const extractedList = [];
      let vendorIndex = 0;
      for (let i = 0; i < fileIds.length; i += 1) {
        const fileId = fileIds[i];
        if (fileId === bankFileId) continue;
        const sourceLabel = `vendor_verified_year_${vendorIndex + 1}`;
        const [extracted, templateRows] = await Promise.all([
          this.extractionService.extractFinancialsFromFileId({ fileId, sourceLabel }),
          this.extractTemplateRowsFromFileId({ fileId, sourceLabel })
        ]);
        const yearFromInput = parseYear(years[vendorIndex]);
        const yearFromName = parseYear(files[vendorIndex]?.originalname);
        const resolvedYear = yearFromInput || yearFromName;
        if (!resolvedYear) {
          throw new Error(`Financial year is required for vendor file: ${files[vendorIndex]?.originalname || `vendor_${vendorIndex + 1}.pdf`}`);
        }
        extractedList.push({
          upload_index: vendorIndex + 1,
          source_file: files[vendorIndex]?.originalname || `vendor_${vendorIndex + 1}.pdf`,
          year: resolvedYear,
          extracted,
          template_rows: templateRows
        });
        vendorIndex += 1;
      }

      extractedList.sort((a, b) => {
        if (a.year == null && b.year == null) return a.upload_index - b.upload_index;
        if (a.year == null) return 1;
        if (b.year == null) return -1;
        return b.year - a.year;
      });

      const latestVendorFinancials = extractedList?.[0]?.extracted?.financials || {};
      const bankFinancials = bankExtraction?.financials || {};
      const matchSummary = buildMatchSummary({
        bankFinancials,
        vendorFinancials: latestVendorFinancials,
        tolerancePct
      });

      const workbook = XLSX.readFile(this.templatePath, { cellFormula: true, cellNF: true, cellStyles: true });
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName) throw new Error('Template workbook does not have any sheet.');
      const ws = workbook.Sheets[sheetName];

      const usedCols = new Set();
      for (let i = 0; i < extractedList.length && i < COLS.length; i += 1) {
        const col = COLS[i];
        const item = extractedList[i];
        usedCols.add(col);
        fillYearColumn(ws, col, item.extracted?.financials || {}, item.year, item.template_rows || {});
      }

      for (const col of COLS) {
        if (!usedCols.has(col)) clearYearColumn(ws, col);
      }

      await fs.mkdir(this.outputDir, { recursive: true });
      const runId = `yearwise_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const filledSheetPath = path.join(this.outputDir, `${runId}_financial_filled.xlsx`);
      XLSX.writeFile(workbook, filledSheetPath);

      const companyData = {
        source: 'vendor_verified_yearwise_pdf',
        generated_at: new Date().toISOString(),
        bank_anchor: {
          source_file: bankFile?.originalname || 'bank_financial.pdf',
          company_identifiers: bankExtraction?.company_identifiers || null,
          financials: bankFinancials,
          confidence: bankExtraction?.confidence || {}
        },
        extracted_by_year: extractedList.map((item) => ({
          year: item.year,
          source_file: item.source_file,
          company_identifiers: item.extracted?.company_identifiers || null,
          financials: item.extracted?.financials || {},
          confidence: item.extracted?.confidence || {},
          template_row_values: item.template_rows || {}
        })),
        bank_vendor_match_summary: matchSummary
      };
      const companyDataPath = path.join(this.outputDir, `${runId}_company_data.json`);
      await fs.writeFile(companyDataPath, JSON.stringify(companyData, null, 2), 'utf8');

      const resolvedCompanyName = String(
        companyName
        || bankExtraction?.company_identifiers?.company_name
        || extractedList?.[0]?.extracted?.company_identifiers?.company_name
        || 'Unknown Company'
      ).trim();

      const summary = await this.generateSummary({
        companyName: resolvedCompanyName,
        extractedByYear: companyData.extracted_by_year,
        bankMatchSummary: matchSummary
      });

      let reportPdfPath = null;
      if (generatePdf) {
        const scriptPath = path.resolve(process.cwd(), 'scripts', 'analyze_financial_xlsx.mjs');
        const args = [
          scriptPath,
          '--input',
          filledSheetPath,
          '--company',
          resolvedCompanyName,
          '--company-data',
          companyDataPath
        ];

        const { stdout } = await execFileAsync(process.execPath, args, {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024
        });
        const jsonMatch = String(stdout || '').match(/\{[\s\S]*\}\s*$/);
        const parsed = parseSummaryJson(jsonMatch?.[0]);
        reportPdfPath = parsed?.output_pdf || null;
      }

      return {
        company_name: resolvedCompanyName,
        years_filled: extractedList.map((item) => item.year),
        extracted_by_year: companyData.extracted_by_year,
        bank_vendor_match_summary: matchSummary,
        ai_summary: summary,
        filled_sheet_path: filledSheetPath,
        company_data_path: companyDataPath,
        report_pdf_path: reportPdfPath
      };
    } finally {
      await Promise.all(tempPaths.map((p) => fs.rm(p, { force: true }).catch(() => {})));
      await Promise.all(fileIds.map((id) => this.documentService.deleteFile(id)));
    }
  }

  async generateSummary({ companyName, extractedByYear, bankMatchSummary }) {
    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                instruction:
                  'You are a credit analyst. Use only provided year-wise extracted financial data and bank-vs-vendor match summary. Do not assume or infer missing year/field values. If a year is missing, explicitly say data not provided. Do not mention Excel/template formulas; rely on provided standard arithmetic outputs only. Return concise plain text with sections: Match Check, Overall Trend, Strengths, Concerns, Recommendation.',
                company_name: companyName,
                years: extractedByYear,
                bank_vendor_match_summary: bankMatchSummary
              })
            }
          ]
        }
      ]
    });

    return String(response?.output_text || '').trim() || 'Summary unavailable.';
  }

  async extractTemplateRowsFromFileId({ fileId, sourceLabel }) {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(TEMPLATE_ROW_NUMBERS.map((row) => [String(row), { type: ['number', 'null'] }]))
    };

    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            {
              type: 'input_text',
              text: [
                'Read this financial PDF and extract only row-wise numeric values matching the target template rows.',
                'Use null when row value is not clearly present. Do not infer or calculate missing rows.',
                `Source label: ${sourceLabel}`,
                'Return strict JSON object using this schema only:',
                JSON.stringify(schema)
              ].join('\n')
            }
          ]
        }
      ]
    });

    const parsed = parseSummaryJson(String(response?.output_text || '').trim()) || {};
    return sanitizeTemplateRowValues(parsed);
  }
}

export default YearwiseVendorSheetService;
