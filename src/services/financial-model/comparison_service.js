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

const FILE_COMPARISON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overall_match: { type: 'string' },
        confidence: { type: 'string' },
        narrative: { type: 'string' }
      },
      required: ['overall_match', 'confidence', 'narrative']
    },
    risk_flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          flag: { type: 'string' },
          severity: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['flag', 'severity', 'rationale']
      }
    }
  },
  required: ['summary', 'risk_flags']
};

function parseJsonFromResponse(response) {
  const direct = String(response?.output_text || '').trim();
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // continue
    }
  }

  const blocks = Array.isArray(response?.output) ? response.output : [];
  const lines = [];
  for (const block of blocks) {
    const content = Array.isArray(block?.content) ? block.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part?.text === 'string') {
        lines.push(part.text);
      }
    }
  }

  const raw = lines.join('\n').trim();
  if (!raw) return {};

  const sanitized = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(sanitized);
}

function toNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/,/g, '')
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/[^0-9.-]/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function mismatchPercent(bankValue, vendorValue) {
  if (bankValue == null || vendorValue == null) return null;
  if (vendorValue === 0) return bankValue === 0 ? 0 : 100;

  return Math.abs((bankValue - vendorValue) / vendorValue) * 100;
}

function clampScore(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function classifyMismatchBand(mismatchPercentage, { hasStrongManipulationSignal = false, hasWeakManipulationSignal = false } = {}) {
  if (hasStrongManipulationSignal || mismatchPercentage > 10) {
    return {
      authenticity_status: 'TAMPERED_CRITICAL',
      severity: 'CRITICAL',
      message: `Critical tampering risk detected. Average mismatch is ${mismatchPercentage.toFixed(2)}%.`
    };
  }

  if (mismatchPercentage > 5 || (hasWeakManipulationSignal && mismatchPercentage > 2)) {
    return {
      authenticity_status: 'SUSPICIOUS',
      severity: 'HIGH',
      message: `High mismatch variance detected at ${mismatchPercentage.toFixed(2)}%; manual review is required.`
    };
  }

  if (mismatchPercentage > 2 || hasWeakManipulationSignal) {
    return {
      authenticity_status: 'REVIEW_REQUIRED',
      severity: 'MEDIUM',
      message: hasWeakManipulationSignal
        ? `Document structure irregularity detected; review required at mismatch ${mismatchPercentage.toFixed(2)}%.`
        : `Mismatch requires review at ${mismatchPercentage.toFixed(2)}%.`
    };
  }

  if (mismatchPercentage >= 0.5) {
    return {
      authenticity_status: 'ACCEPTABLE_VARIATION',
      severity: 'LOW',
      message: `Variation is acceptable at ${mismatchPercentage.toFixed(2)}%.`
    };
  }

  return {
    authenticity_status: 'MATCHED',
    severity: 'LOW',
    message: `Statements are aligned. Average mismatch is ${mismatchPercentage.toFixed(2)}%, below 0.50%.`
  };
}

export class ComparisonService {
  constructor({ openaiClient = null, model = process.env.OPENAI_FINANCIAL_MODEL || 'gpt-5-mini' } = {}) {
    this.openai = openaiClient;
    this.model = model;
  }

  async compareDocumentsByFileId({ bankFileId, vendorFileId }) {
    if (!this.openai) return null;
    if (!bankFileId || !vendorFileId) return null;

    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: bankFileId },
            { type: 'input_file', file_id: vendorFileId },
            {
              type: 'input_text',
              text:
                `Compare both financial PDFs for consistency and tampering signals. Return only strict JSON with summary and risk_flags. Schema: ${JSON.stringify(FILE_COMPARISON_SCHEMA)}`
            }
          ]
        }
      ]
    });

    return parseJsonFromResponse(response);
  }

  compareAuthenticity({ bankFinancials, vendorFinancials, tolerancePct = 0.5, tamperSignals = {} }) {
    const bank = bankFinancials && typeof bankFinancials === 'object' ? bankFinancials : {};
    const vendor = vendorFinancials && typeof vendorFinancials === 'object' ? vendorFinancials : {};

    const mismatchFields = [];
    const comparablePercentages = [];

    for (const field of FINANCIAL_FIELDS) {
      const bankValue = toNumber(bank[field]);
      const vendorValue = toNumber(vendor[field]);
      const pct = mismatchPercent(bankValue, vendorValue);

      if (pct == null) continue;

      comparablePercentages.push(pct);
      if (pct > tolerancePct) {
        mismatchFields.push({
          field,
          bank_value: bankValue,
          vendor_value: vendorValue,
          mismatch_pct: Number(pct.toFixed(4))
        });
      }
    }

    const mismatchPercentage = comparablePercentages.length
      ? comparablePercentages.reduce((sum, value) => sum + value, 0) / comparablePercentages.length
      : 0;

    const hasStrongManipulationSignal = Boolean(
      tamperSignals?.bank_manual_edit_indicator ||
      tamperSignals?.vendor_manual_edit_indicator
    );
    const hasWeakManipulationSignal = Boolean(
      tamperSignals?.bank_table_irregularity ||
      tamperSignals?.vendor_table_irregularity
    );

    const band = classifyMismatchBand(mismatchPercentage, {
      hasStrongManipulationSignal,
      hasWeakManipulationSignal
    });
    const statusRiskMap = {
      MATCHED: 0,
      ACCEPTABLE_VARIATION: 10,
      REVIEW_REQUIRED: 30,
      SUSPICIOUS: 60,
      TAMPERED_CRITICAL: 90
    };
    const riskScore = clampScore(statusRiskMap[band.authenticity_status] ?? 0);

    return {
      authenticity_status: band.authenticity_status,
      severity: band.severity,
      mismatch_fields: mismatchFields,
      risk_score: riskScore,
      message: band.message,
      mismatch_percentage: Number(mismatchPercentage.toFixed(4))
    };
  }
}

export default ComparisonService;