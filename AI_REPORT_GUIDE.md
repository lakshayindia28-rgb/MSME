# Financial Reconciliation Engine Guide

## Product Description
The system compares financial information across two submitted documents and produces a structured reconciliation dataset for MSME credit appraisal workflows.

## Scope
- Input documents:
  - `bank_statement_pdf`
  - `vendor_statement_pdf`
- Output format: structured datasets only
- No explanatory prose in output
- Credit outcome is emitted as a dataset label only

## Output Datasets
The reconciliation engine returns exactly four datasets:

1. `EXTRACTED_VALUES`
2. `RECONCILIATION_TABLE`
3. `RISK_CLASSIFICATION`
4. `CREDIT_DECISION`

## Reconciliation Rules
- `EXTRACTED_VALUES`: `field | bank_value | vendor_value`
- `RECONCILIATION_TABLE`: `difference% | tolerance_status`
- Tolerance mapping:
  - `< 0.5` → `match`
  - `0.5–2` → `acceptable`
  - `2–5` → `review`
  - `> 5` → `suspicious`
- `RISK_CLASSIFICATION`:
  - `liquidity`: `weak | normal`
  - `profitability`: `low | normal`
  - `authenticity`: `verified | review | tampered`
- `CREDIT_DECISION`: `manual_review | approve | reject`

## API
- Primary endpoint: `POST /api/financial-reconciliation`
- Deprecated endpoint: `POST /api/generate-report`

## Clarification
This system provides verified comparable financial evidence. Final interpretation and lending decision remains with the credit analyst or chartered accountant.
