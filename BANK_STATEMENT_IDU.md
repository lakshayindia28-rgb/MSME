# Bank Statement OCR + Understanding (IDU)

## Architecture (textual diagram)

```
INPUT (PDF/Image)
  |
  |-- Stage 0: File Decode + Type Detect
  |-- Stage 1: Page Rasterization (PDF -> page images)
  |-- Stage 2: Layout Detection (zones per page)
  |     - header
  |     - customer_identity
  |     - account_metadata
  |     - statement_period
  |     - transaction_table
  |     - footer
  |-- Stage 3: OCR (word-level bboxes) + Zone Text Assembly
  |-- Stage 4: Bank-Aware Parser
  |     - Header/account fields: IFSC/MICR/CIF/Account No/Name/Period
  |     - Transaction table: row reconstruction + debit/credit separation + closing balance
  |     - Transaction type classification: UPI/IMPS/NEFT/ACH/ATM/INTEREST/OTHER
  |-- Stage 5: Validation Engine
  |     - IFSC format
  |     - date format
  |     - closing balance flow consistency
  |
OUTPUT (STRICT JSON)
  { bank_details, account_holder, statement_period, transactions, summary }
```

## Tech stack selection

- Server: Node.js (ESM) + Express
- PDF rasterization: `pdfjs-dist` + `@napi-rs/canvas`
- Image preprocessing: `sharp`
- OCR: `tesseract.js` (word bboxes)
- Optional AI Parser:
  - OpenAI via `openai` (schema-locked JSON output)

## AI parser prompt (Stage 4)

Defined in: `src/core/bankIdu/aiPrompt.js` (`BANK_STATEMENT_AI_PARSER_PROMPT`).

Enable:
- `BANK_IDU_AI_PARSER=off|openai`
- `OPENAI_API_KEY=...` (for OpenAI)

## Example output JSON

```json
{
  "bank_details": {
    "bank_name": {"value":"HDFC BANK","status":"ok","inferred":false,"confidence":"high"},
    "branch_name": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "branch_address": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "ifsc": {"value":"HDFC0000123","status":"ok","inferred":false,"confidence":"high"},
    "micr": {"value":"","status":"missing","inferred":false,"confidence":"low"}
  },
  "account_holder": {
    "name": {"value":"RAHUL SHARMA","status":"ok","inferred":false,"confidence":"medium"},
    "address": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "email": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "customer_id": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "account_number": {"value":"123456789012","status":"ok","inferred":false,"confidence":"medium"},
    "account_type": {"value":"SAVINGS","status":"ok","inferred":false,"confidence":"medium"},
    "account_status": {"value":"","status":"missing","inferred":false,"confidence":"low"},
    "account_open_date": {"value":"","status":"missing","inferred":false,"confidence":"low"}
  },
  "statement_period": {
    "from": {"value":"01/01/2025","status":"ok","inferred":false,"confidence":"high"},
    "to": {"value":"31/01/2025","status":"ok","inferred":false,"confidence":"high"}
  },
  "transactions": [
    {
      "date":"02/01/2025",
      "narration":"UPI/XYZ STORE/12345",
      "reference_number":"12345",
      "value_date":"",
      "debit":"500.00",
      "credit":"",
      "closing_balance":"10500.00",
      "transaction_type":"UPI"
    }
  ],
  "summary": {
    "total_debits":"500",
    "total_credits":"0",
    "largest_credit":"",
    "largest_debit":"500",
    "transaction_count":"1"
  }
}
```

## Error handling logic (implemented)

- Multi-page supported: up to 10 pages processed by default
- Zone/table failure handling:
  - Per page tries 2 preprocessing passes (`useThreshold=false` then `true`)
  - Picks best pass by score: `transactions_count*2 + ocr_confidence`
- Missing fields:
  - Outputs `{ value:'', status:'missing', inferred:false, confidence:'low' }`
- IFSC/date validity:
  - If a value exists but fails format checks, status becomes `inferred` and confidence downgraded

## API

- `POST /api/bank/statement/parse`
  - Body: `{ "caseId": "CASE123", "fileBase64": "..." }`
  - Returns: strict structured JSON only
