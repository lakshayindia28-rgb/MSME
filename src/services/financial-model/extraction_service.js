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

const EXTRACTION_SCHEMA = {
  name: 'financial_document_extraction',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      financials_evidence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revenue: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          cogs: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          gross_profit: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          net_profit: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          total_assets: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          current_assets: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          inventory: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          receivables: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          cash: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          current_liabilities: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          long_term_debt: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          equity: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          employee_expenses: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          },
          other_expenses: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              source_section: { type: 'string' },
              page_number: { type: ['number', 'null'] },
              confidence_score: { type: 'number' }
            },
            required: ['value', 'source_section', 'page_number', 'confidence_score']
          }
        },
        required: FINANCIAL_FIELDS
      },
      financials: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revenue: { type: ['number', 'null'] },
          cogs: { type: ['number', 'null'] },
          gross_profit: { type: ['number', 'null'] },
          net_profit: { type: ['number', 'null'] },
          total_assets: { type: ['number', 'null'] },
          current_assets: { type: ['number', 'null'] },
          inventory: { type: ['number', 'null'] },
          receivables: { type: ['number', 'null'] },
          cash: { type: ['number', 'null'] },
          current_liabilities: { type: ['number', 'null'] },
          long_term_debt: { type: ['number', 'null'] },
          equity: { type: ['number', 'null'] },
          employee_expenses: { type: ['number', 'null'] },
          other_expenses: { type: ['number', 'null'] }
        },
        required: FINANCIAL_FIELDS
      },
      field_confidence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revenue: { type: 'number' },
          cogs: { type: 'number' },
          gross_profit: { type: 'number' },
          net_profit: { type: 'number' },
          total_assets: { type: 'number' },
          current_assets: { type: 'number' },
          inventory: { type: 'number' },
          receivables: { type: 'number' },
          cash: { type: 'number' },
          current_liabilities: { type: 'number' },
          long_term_debt: { type: 'number' },
          equity: { type: 'number' },
          employee_expenses: { type: 'number' },
          other_expenses: { type: 'number' }
        },
        required: FINANCIAL_FIELDS
      },
      tamper_signals: {
        type: 'object',
        additionalProperties: false,
        properties: {
          table_irregularity: { type: 'boolean' },
          manual_edit_indicator: { type: 'boolean' },
          notes: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['table_irregularity', 'manual_edit_indicator', 'notes']
      },
      company_identifiers: {
        type: 'object',
        additionalProperties: false,
        properties: {
          company_name: { type: ['string', 'null'] },
          pan: { type: ['string', 'null'] },
          cin: { type: ['string', 'null'] },
          source_section: { type: 'string' },
          page_number: { type: ['number', 'null'] },
          confidence_score: { type: 'number' }
        },
        required: ['company_name', 'pan', 'cin', 'source_section', 'page_number', 'confidence_score']
      }
    },
    required: ['financials_evidence', 'tamper_signals', 'company_identifiers']
  }
};

const EXTRACTION_PROMPT = [
  'Extract ONLY structured financial values from this uploaded PDF document.',
  'Document structure can vary (ITR schedules, audited financial statements, MCA-style tables, scanned statements).',
  'Do not hallucinate values.',
  'If a value is absent or ambiguous, return null.',
  'Use most recent visible financial year in the document.',
  'Use ONLY the uploaded document content. Do not use external assumptions or prior responses.',
  'Map equivalent labels to target fields using nearest exact meaning:',
  'revenue <= Net Sales | Revenue from operations | Turnover | Total Operating Income.',
  'cogs <= Cost of goods sold | Purchases | Cost of traded goods sold | Cost of Sales.',
  'gross_profit <= Gross Profit | Trading Gross Profit | Revenue minus COGS when explicitly shown.',
  'net_profit <= Profit After Tax | PAT | Net profit after tax.',
  'current_assets <= Total Current Assets.',
  'inventory <= Inventories | Stock-in-trade | Closing Stock.',
  'receivables <= Trade receivables | Sundry debtors | Debtors.',
  'cash <= Cash and cash equivalents | Cash and bank balances.',
  'current_liabilities <= Total Current Liabilities | Current Liabilities and Provisions.',
  'long_term_debt <= Long term borrowings | Term loans | Non-current liabilities debt portion.',
  'equity <= Shareholder funds | Net worth | Capital + Reserves/Surplus.',
  'total_assets <= Total Assets.',
  'Return numeric values only for financial fields (no commas/currency symbols).',
  'Set field_confidence between 0 and 1 for each field.',
  'For each financial field, include source section, page number, and confidence score in financials_evidence.',
  'Set tamper_signals based on visual/content inconsistencies found in the document.',
  'Extract company_identifiers from the same uploaded PDF. company_name must be the exact legal name text as shown in document (do not return "Unknown Company"). If not present, return null.',
  'Return strict JSON matching the requested schema only.'
].join(' ');

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function ensureNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

export class ExtractionService {
  constructor({ openaiClient, model = process.env.OPENAI_FINANCIAL_MODEL || 'gpt-5-mini' } = {}) {
    this.openai = openaiClient;
    this.model = model;
  }

  async extractFinancialsFromFileId({ fileId, sourceLabel }) {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not configured. OpenAI API is required for this flow.');
    }
    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            {
              type: 'input_text',
              text: `${EXTRACTION_PROMPT} Source label: ${sourceLabel}. Return ONLY strict JSON matching this schema:\n${JSON.stringify(EXTRACTION_SCHEMA.schema)}`
            }
          ]
        }
      ]
    });

    const parsed = parseJsonFromResponse(response);
    const financialsEvidence = Object.fromEntries(
      FINANCIAL_FIELDS.map((field) => {
        const fromEvidence = parsed?.financials_evidence?.[field];
        const fallbackValue = parsed?.financials?.[field];
        const fallbackConfidence = parsed?.field_confidence?.[field];

        const value = ensureNumber(fromEvidence?.value ?? fallbackValue);
        const confidenceScore = Math.max(0, Math.min(1, ensureNumber(fromEvidence?.confidence_score ?? fallbackConfidence) ?? 0));

        return [
          field,
          {
            value,
            source_section: String(fromEvidence?.source_section || 'UNSPECIFIED').trim() || 'UNSPECIFIED',
            page_number: ensureNumber(fromEvidence?.page_number),
            confidence_score: confidenceScore
          }
        ];
      })
    );

    const financials = Object.fromEntries(
      FINANCIAL_FIELDS.map((field) => [field, ensureNumber(financialsEvidence?.[field]?.value)])
    );
    const confidence = Object.fromEntries(
      FINANCIAL_FIELDS.map((field) => [field, Math.max(0, Math.min(1, ensureNumber(financialsEvidence?.[field]?.confidence_score) ?? 0))])
    );

    const tamperSignals = {
      table_irregularity: Boolean(parsed?.tamper_signals?.table_irregularity),
      manual_edit_indicator: Boolean(parsed?.tamper_signals?.manual_edit_indicator),
      notes: Array.isArray(parsed?.tamper_signals?.notes)
        ? [...new Set(parsed.tamper_signals.notes.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 20)
        : []
    };

    const companyIdentifiers = {
      company_name: normalizeText(parsed?.company_identifiers?.company_name),
      pan: normalizeText(parsed?.company_identifiers?.pan),
      cin: normalizeText(parsed?.company_identifiers?.cin),
      source_section: String(parsed?.company_identifiers?.source_section || 'UNSPECIFIED').trim() || 'UNSPECIFIED',
      page_number: ensureNumber(parsed?.company_identifiers?.page_number),
      confidence_score: Math.max(0, Math.min(1, ensureNumber(parsed?.company_identifiers?.confidence_score) ?? 0))
    };

    return {
      financials,
      financials_evidence: financialsEvidence,
      confidence,
      tamperSignals,
      company_identifiers: companyIdentifiers,
      file_id: fileId,
      raw: parsed
    };
  }
}

export default ExtractionService;