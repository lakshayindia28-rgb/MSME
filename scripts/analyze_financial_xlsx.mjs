import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import OpenAI from 'openai';

const cwd = process.cwd();

function parseArgs(argv = []) {
  const out = {
    input: path.resolve(cwd, 'FINANCIAL FINAL.xlsx'),
    output: path.resolve(cwd, 'logs', 'financial-reports', `financial_final_ai_${Date.now()}.pdf`),
    sheet: null,
    model: process.env.OPENAI_FINANCIAL_MODEL || 'gpt-4.1-mini',
    companyName: null,
    companyDataPath: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) {
      out.input = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--output' && next) {
      out.output = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--sheet' && next) {
      out.sheet = String(next || '').trim() || null;
      i += 1;
      continue;
    }
    if (arg === '--model' && next) {
      out.model = String(next || '').trim() || out.model;
      i += 1;
      continue;
    }
    if (arg === '--company' && next) {
      out.companyName = String(next || '').trim() || null;
      i += 1;
      continue;
    }
    if (arg === '--company-data' && next) {
      out.companyDataPath = path.resolve(cwd, next);
      i += 1;
    }
  }

  return out;
}

async function loadCompanyData(companyDataPath) {
  if (!companyDataPath) return null;
  try {
    const raw = await fs.readFile(companyDataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumericText(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/%|#DIV|#N\/A|#VALUE|#REF/i.test(text)) return null;

  const parenNegative = /^\((.*)\)$/.test(text);
  const normalized = text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/[₹$]/g, '');

  if (!/^[-+]?\d*\.?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parenNegative ? -parsed : parsed;
}

function normalizeMixedUnitToLakhs(value) {
  const num = toNumber(value);
  if (num == null) return value;
  const converted = Math.abs(num) > 1000000 ? (num / 100000) : num;
  return Number(converted.toFixed(2));
}

function formatLakhs(value) {
  const num = toNumber(value);
  if (num == null) return String(value ?? '');
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function isNonMonetaryRow(row) {
  const label = normalizeLabel(row?.values?.[0] || '');
  const rowNo = Number(row?.rowNumber) || 0;
  if (!label) return false;

  const nonMonetaryKeywords = [
    'period ends on',
    'result type',
    'auditor qualification',
    'no of months',
    'particulars',
    'ratio',
    'margin',
    'days',
    'growth',
    'financial flexibility',
    'summary of ratios',
    'key financial ratios',
    'turnover ratios',
    'solvency ratios',
    'profitability ratios'
  ];

  if (rowNo >= 102) return true;
  return nonMonetaryKeywords.some((token) => label.includes(token));
}

function convertRowsToLakhs(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const monetaryRow = !isNonMonetaryRow(row);
    const nextValues = Array.isArray(row.values) ? [...row.values] : [];

    for (let index = 1; index <= 3; index += 1) {
      const cellText = String(nextValues[index] ?? '');
      const parsed = parseNumericText(cellText);
      if (!monetaryRow || parsed == null) continue;
      const lakhs = normalizeMixedUnitToLakhs(parsed);
      nextValues[index] = formatLakhs(lakhs);
    }

    return {
      ...row,
      values: nextValues
    };
  });
}

function cellDisplay(cell) {
  if (!cell) return '';
  const visible = cell.w ?? cell.v ?? '';
  return String(visible);
}

function buildSheetMatrix(ws) {
  const ref = ws['!ref'];
  if (!ref) return { rows: [], formulaCount: 0 };

  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  let formulaCount = 0;

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const rowValues = [];
    let hasContent = false;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address];
      const rendered = cellDisplay(cell);
      if (cell?.f) formulaCount += 1;
      if (String(rendered).trim()) hasContent = true;
      rowValues.push(rendered);
    }
    if (hasContent) {
      rows.push({ rowNumber: r + 1, values: rowValues });
    }
  }

  return { rows, formulaCount };
}

function extractMetrics(rows) {
  const valuesByLabel = new Map();
  for (const row of rows) {
    const label = normalizeLabel(row.values[0]);
    if (!label) continue;
    valuesByLabel.set(label, row);
  }

  const yearsRow = rows.find((row) => normalizeLabel(row.values[0]) === 'period ends on');
  const years = {
    current: yearsRow?.values?.[1] || 'N/A',
    previous: yearsRow?.values?.[2] || 'N/A',
    older: yearsRow?.values?.[3] || 'N/A'
  };

  const pick = (name) => {
    const row = valuesByLabel.get(normalizeLabel(name));
    if (!row) return null;
    return {
      current: toNumber(row.values[1]) ?? row.values[1] ?? null,
      previous: toNumber(row.values[2]) ?? row.values[2] ?? null,
      older: toNumber(row.values[3]) ?? row.values[3] ?? null
    };
  };

  const ratioRows = rows
    .filter((row) => row.rowNumber >= 102)
    .map((row) => ({
      metric: String(row.values[0] || '').trim(),
      current: String(row.values[1] || '').split('\n')[0],
      previous: String(row.values[2] || '').split('\n')[0],
      older: String(row.values[3] || '').split('\n')[0]
    }))
    .filter((entry) => entry.metric);

  return {
    years,
    totals: {
      net_sales: pick('Net Sales'),
      total_operating_income: pick('Total Operating Income'),
      cost_of_sales: pick('Cost of Sales'),
      operating_profit_before_tax: pick('Operating Profit Before Tax  (OPBT)'),
      adjusted_profit_after_tax: pick('Adjusted Profit After Tax  (APAT)'),
      gross_cash_accruals: pick('Gross Cash Accruals'),
      total_assets: pick('TOTAL ASSETS'),
      total_liabilities: pick('TOTAL LIABILITIES')
    },
    ratios: ratioRows.slice(0, 40)
  };
}

function inferCompanyName({ explicitName, companyData, inputPath }) {
  if (String(explicitName || '').trim()) return String(explicitName).trim();

  const fromData = [
    companyData?.company_name,
    companyData?.legal_name,
    companyData?.name,
    companyData?.company?.name,
    companyData?.profile?.company_name
  ].find((item) => String(item || '').trim());

  if (fromData) return String(fromData).trim();

  const base = path.basename(inputPath || '', path.extname(inputPath || ''));
  return String(base || 'Unknown Company').trim();
}

function buildSheetContextForAI(rows) {
  return rows.slice(0, 250).map((row) => ({
    row: row.rowNumber,
    particulars: String(row.values[0] || ''),
    col_b: String(row.values[1] || ''),
    col_c: String(row.values[2] || ''),
    col_d: String(row.values[3] || '')
  }));
}

async function generateAiNarrative({ companyName, companyData, metrics, sheetContext, model }) {
  if (!process.env.OPENAI_API_KEY) {
    return [
      'AI analysis skipped because OPENAI_API_KEY is not available.',
      'Sheet data and formulas are still preserved exactly in the PDF table section.'
    ].join('\n');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const payload = {
    instruction:
      'You are a senior financial analyst and underwriter. Use only provided sheet data and company context. All monetary values are already in INR Lakhs. Never output raw rupee values. Return concise banker-ready CMA style plain-text report (max 220 words) with headings: 1) Executive Interpretation 2) Performance 3) Liquidity & Leverage 4) Ratio Signals 5) Risks 6) Recommendation. Mention only critical formulas and data-quality limits.',
    company_name: companyName,
    company_data: {
      source: companyData?.source || null,
      generated_at: companyData?.generated_at || null
    },
    metrics,
    sheet_context: sheetContext
  };

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify(payload)
          }
        ]
      }
    ]
  });

  const text = String(response?.output_text || '').trim();
  return text || 'AI analysis did not return content.';
}

function ensurePage(doc, neededHeight = 24) {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > limit) doc.addPage();
}

function drawHeader(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9).text(subtitle, { align: 'center' });
  doc.moveDown(0.6);
}

function buildColumnHeaders(rows) {
  const periodRow = (Array.isArray(rows) ? rows : []).find((row) => normalizeLabel(row?.values?.[0]) === 'period ends on');
  const labels = [1, 2, 3]
    .map((idx) => ({ idx, label: String(periodRow?.values?.[idx] || '').trim() }))
    .filter((item) => item.label);

  const selectedCols = labels.length ? labels.map((item) => item.idx) : [1, 2, 3];
  const selectedLabels = labels.length
    ? labels.map((item) => item.label)
    : ['Year/Date 1', 'Year/Date 2', 'Year/Date 3'];

  return {
    selectedCols,
    headers: ['Row', 'Particulars', ...selectedLabels]
  };
}

function drawFooterNote(doc) {
  const note = 'All amounts are presented in INR Lakhs unless otherwise stated.';
  ensurePage(doc, 24);
  doc.moveDown(0.6);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#4B5563').text(note, {
    align: 'right'
  });
  doc.fillColor('#111827');
}

function drawSheetTable(doc, rows) {
  const x = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const { selectedCols, headers } = buildColumnHeaders(rows);
  const dynamicCols = Math.max(1, selectedCols.length);
  const rowWidth = 40;
  const particularsWidth = totalWidth * 0.40;
  const remaining = totalWidth - rowWidth - particularsWidth;
  const eachValueWidth = remaining / dynamicCols;
  const widths = [rowWidth, particularsWidth, ...selectedCols.map(() => eachValueWidth)];

  const drawRow = (cells, isHeader = false) => {
    const content = cells.map((value) => String(value ?? ''));
    const rowHeight = isHeader ? 18 : 16;
    ensurePage(doc, rowHeight + 2);

    let cursor = x;
    const y = doc.y;
    for (let i = 0; i < widths.length; i += 1) {
      const width = widths[i];
      doc.save();
      doc.rect(cursor, y, width, rowHeight).fillColor(isHeader ? '#F3F4F6' : '#FFFFFF').fill();
      doc.rect(cursor, y, width, rowHeight).strokeColor('#D1D5DB').stroke();
      doc.restore();
      doc
        .fillColor('#111827')
        .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(isHeader ? 9 : 8)
        .text(content[i], cursor + 3, y + (isHeader ? 3 : 2), {
          width: width - 6,
          height: rowHeight - 3,
          align: i === 0 ? 'center' : 'left',
          lineBreak: true,
          ellipsis: true
        });
      cursor += width;
    }
    doc.y = y + rowHeight;
  };

  drawRow(headers, true);
  for (const row of rows) {
    const dynamicValues = selectedCols.map((colIdx) => row.values[colIdx]);
    drawRow([row.rowNumber, row.values[0], ...dynamicValues], false);
  }
}

function drawAnalysis(doc, companyName, analysisText) {
  ensurePage(doc, 100);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(14).text('AI Financial Interpretation', { align: 'left' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(10).text(`Company: ${companyName}`);
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text(analysisText, {
    align: 'left',
    lineGap: 2
  });
}

async function writePdf({ outputPath, companyName, sheetName, formulaCount, rows, analysisText }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const doc = new PDFDocument({
    size: 'A3',
    layout: 'landscape',
    margin: 14
  });

  const stream = await fs.open(outputPath, 'w');
  const writeStream = stream.createWriteStream();
  doc.pipe(writeStream);

  const subtitle = `Company: ${companyName} | Sheet: ${sheetName} | Non-empty rows: ${rows.length} | Formula cells preserved: ${formulaCount} | Generated: ${new Date().toISOString()}`;
  drawHeader(doc, 'FINANCIAL SECTION (BANKER CMA VIEW - INR LAKHS)', subtitle);
  drawSheetTable(doc, rows);
  drawAnalysis(doc, companyName, analysisText);
  drawFooterNote(doc);

  doc.end();
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
  await stream.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.access(args.input);
  const companyData = await loadCompanyData(args.companyDataPath);

  const workbook = XLSX.readFile(args.input, {
    cellFormula: true,
    cellNF: true,
    cellStyles: true
  });

  const sheetName = args.sheet || workbook.SheetNames?.[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new Error(`Sheet not found: ${sheetName || '(none)'}`);
  }

  const ws = workbook.Sheets[sheetName];
  const { rows: rawRows, formulaCount } = buildSheetMatrix(ws);
  const rows = convertRowsToLakhs(rawRows);
  if (!rows.length) {
    throw new Error('No non-empty data found in selected sheet.');
  }

  const metrics = extractMetrics(rows);
  const companyName = inferCompanyName({
    explicitName: args.companyName,
    companyData,
    inputPath: args.input
  });
  const sheetContext = buildSheetContextForAI(rows);
  const analysisText = await generateAiNarrative({
    companyName,
    companyData,
    metrics,
    sheetContext,
    model: args.model
  });

  await writePdf({
    outputPath: args.output,
    companyName,
    sheetName,
    formulaCount,
    rows,
    analysisText
  });

  console.log(
    JSON.stringify(
      {
        input_xlsx: args.input,
        company_name: companyName,
        company_data_used: Boolean(companyData),
        sheet: sheetName,
        non_empty_rows: rows.length,
        formula_cells: formulaCount,
        output_pdf: args.output
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`analyze_financial_xlsx failed: ${error?.message || error}`);
  process.exit(1);
});
