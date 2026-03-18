/**
 * Financial Engine Constants — Matched to Financial Calc.xlsx
 * ============================================================
 * Excel layout: Sheet1, A2:D165
 *   Rows 2-32    → Profitability Statement
 *   Rows 34-66   → Balance Sheet: Assets
 *   Rows 68-108  → Balance Sheet: Liabilities
 *   Rows 110-115 → Liquidity Ratios
 *   Rows 118-127 → Capital Structure / Financial Flexibility
 *   Rows 129-165 → Summary of Ratios
 *
 * Fields marked computed:true are auto-calculated from formulas.
 * Fields without computed flag are user inputs.
 */

// ─── PROFITABILITY STATEMENT (Rows 7-32) ─────────────────────────────────────
export const PROFITABILITY_FIELDS = [
  { key: 'net_sales',                      row: 7,  label: 'Net Sales' },
  { key: 'other_income_operations',        row: 8,  label: 'Other Income (related to operations)' },
  { key: 'total_operating_income',         row: 9,  label: 'Total Operating Income', computed: true },
  { key: 'handling_costs',                 row: 10, label: 'Handling Costs' },
  { key: 'cost_of_traded_goods',           row: 11, label: 'Cost of Traded Goods Sale' },
  { key: 'consumable_stores',              row: 12, label: 'Consumable Stores' },
  { key: 'power_and_fuel',                 row: 13, label: 'Power and Fuel' },
  { key: 'employee_costs',                 row: 14, label: 'Employee Costs' },
  { key: 'other_expenses',                 row: 15, label: 'Other Expenses' },
  { key: 'selling_expenses',               row: 16, label: 'Selling Expenses' },
  { key: 'other_related_expenses',         row: 17, label: 'Other related Expenses' },
  { key: 'cost_of_sales',                  row: 18, label: 'Cost of Sales', computed: true },
  { key: 'pbildt',                         row: 19, label: 'PBILDT', computed: true },
  { key: 'depreciation',                   row: 20, label: 'Depreciation' },
  { key: 'pbit',                           row: 21, label: 'PBIT', computed: true },
  { key: 'interest_and_finance_charges',   row: 22, label: 'Interest and Finance Charges' },
  { key: 'opbt',                           row: 23, label: 'Operating Profit Before Tax (OPBT)', computed: true },
  { key: 'non_operating_income_expense',   row: 24, label: 'Non-Operating Income / (Expense)' },
  { key: 'pbt',                            row: 25, label: 'Profit Before Tax (PBT)', computed: true },
  { key: 'cash_adjustments',               row: 26, label: 'Cash Adjustments' },
  { key: 'apbt',                           row: 27, label: 'Adjusted Profit Before Tax (APBT)', computed: true },
  { key: 'extraordinary_adjustments',      row: 28, label: 'Extraordinary Adjustments' },
  { key: 'current_tax',                    row: 29, label: 'Current Tax' },
  { key: 'provision_deferred_tax',         row: 30, label: 'Provision for Deferred Tax' },
  { key: 'pat',                            row: 31, label: 'Profit After Tax', computed: true },
  { key: 'gross_cash_accruals',            row: 32, label: 'Gross Cash Accruals', computed: true },
];

// ─── BALANCE SHEET: ASSETS (Rows 39-66) ──────────────────────────────────────
export const BALANCE_SHEET_ASSETS_FIELDS = [
  { key: 'gross_block',                    row: 39, label: 'Gross Block' },
  { key: 'accumulated_depreciation',       row: 40, label: 'Accumulated Depreciation' },
  { key: 'net_block',                      row: 41, label: 'Net Block', computed: true },
  { key: 'capital_work_in_progress',       row: 42, label: 'Capital Work in Progress' },
  { key: 'net_fixed_assets',               row: 43, label: 'NET FIXED ASSETS', computed: true },
  { key: 'investments_affiliate',          row: 44, label: 'Investments in Affiliate Companies' },
  { key: 'non_current_investments',        row: 45, label: 'Non Current Investments (net of provisions)' },
  { key: 'non_current_loans_advances',     row: 46, label: 'Non-Current Loans & Advances' },
  { key: 'deferred_tax_assets',            row: 47, label: 'Deferred tax assets (net)' },
  { key: 'other_non_current_assets',       row: 48, label: 'Other Non Current Assets' },
  { key: 'non_current_assets',             row: 49, label: 'NON CURRENT ASSETS', computed: true },
  { key: 'receivables_gt6m',               row: 50, label: 'Receivables: More than 6 months' },
  { key: 'receivables_lt6m',               row: 51, label: 'Receivables: Less than 6 months' },
  { key: 'provision_doubtful_debts',       row: 52, label: 'Less: Provision for doubtful debts' },
  { key: 'bills_receivable',               row: 53, label: 'Bills Receivable' },
  { key: 'total_receivables',              row: 54, label: 'TOTAL RECEIVABLES', computed: true },
  { key: 'investments_marketable_securities', row: 55, label: 'Investments in Marketable Securities' },
  { key: 'loans_advances_subsidiaries',    row: 56, label: 'Loans & Advances to Subsidiaries' },
  { key: 'loans_advances_affiliates',      row: 57, label: 'Loans & Advances to Affiliate Companies' },
  { key: 'loans_advances_current_ops',     row: 58, label: 'Loans; Advances; current assets related to operations' },
  { key: 'cash_and_bank',                  row: 59, label: 'Cash and Bank Balances' },
  { key: 'total_inventories_non_ops',      row: 60, label: 'Total Inventories Non-operational Assets' },
  { key: 'loans_advances_non_ops',         row: 61, label: 'Loans; Advances; current assets not related to operations' },
  { key: 'advance_tax_paid',               row: 62, label: 'Advance Tax Paid' },
  { key: 'total_other_assets',             row: 63, label: 'Total Other Assets' },
  { key: 'total_current_assets_ops',       row: 64, label: 'Total Current Assets related to Operations', computed: true },
  { key: 'total_current_assets',           row: 65, label: 'Total Current Assets', computed: true },
  { key: 'total_assets',                   row: 66, label: 'TOTAL ASSETS', computed: true },
];

// ─── BALANCE SHEET: LIABILITIES (Rows 73-108) ───────────────────────────────
export const BALANCE_SHEET_LIABILITIES_FIELDS = [
  { key: 'paid_up_equity_share_capital',   row: 73, label: 'Total Paid Up Equity Share Capital' },
  { key: 'reserves_surplus',               row: 74, label: 'Reserves & Surplus' },
  { key: 'share_application_money',        row: 75, label: 'Share Application Money pending allotment' },
  { key: 'quasi_equity',                   row: 76, label: 'Quasi Equity: FCD; CCPS etc.' },
  { key: 'gross_reserves',                 row: 77, label: 'GROSS RESERVES', computed: true },
  { key: 'intangible_assets',              row: 78, label: 'Intangible Assets' },
  { key: 'misc_expenses_not_written_off',  row: 79, label: 'Miscellaneous expenses not written off' },
  { key: 'debit_balance_pnl',              row: 80, label: 'Debit Balance in Profit and loss Account' },
  { key: 'net_reserves',                   row: 81, label: 'NET RESERVES', computed: true },
  { key: 'tangible_net_worth',             row: 82, label: 'TANGIBLE NET WORTH', computed: true },
  { key: 'deferred_payment_credit',        row: 83, label: 'Deferred Payment Credit' },
  { key: 'rupee_term_loans',               row: 84, label: 'Rupee Term Loans' },
  { key: 'total_long_term_debt',           row: 85, label: 'TOTAL LONG TERM DEBT', computed: true },
  { key: 'long_term_provisions',           row: 86, label: 'Long Term Provisions' },
  { key: 'other_long_term_liabilities',    row: 87, label: 'Other Long Term Liabilities' },
  { key: 'current_portion_ltd',            row: 88, label: 'Less: Current Portion of Long Term Debt and Fixed Deposits' },
  { key: 'net_long_term_debt',             row: 89, label: 'NET LONG TERM DEBT', computed: true },
  { key: 'working_capital_bank_borrowings', row: 90, label: 'Working capital Bank Borrowings' },
  { key: 'intercorporate_borrowings',      row: 91, label: 'Intercorporate Borrowings' },
  { key: 'loans_advances_from_subsidiaries', row: 92, label: 'Loans & Advances from Subsidiaries' },
  { key: 'loans_advances_from_promoters',  row: 93, label: 'Loans & Advances from promoters; other affiliated cos.' },
  { key: 'other_short_term_loans',         row: 94, label: 'Other Short Term Loans & Advances' },
  { key: 'new_short_term_loans',           row: 95, label: 'New Short Term Loans' },
  { key: 'total_short_term_debt',          row: 96, label: 'TOTAL SHORT TERM DEBT', computed: true },
  { key: 'creditors_for_goods',            row: 97, label: 'Creditors for goods' },
  { key: 'creditors_for_expenses',         row: 98, label: 'Creditors for Expenses' },
  { key: 'other_current_liabilities_ops',  row: 99, label: 'Other Current Liabilities: related to ops.' },
  { key: 'current_liabilities_non_ops',    row: 100, label: 'Current Liabilities: not related to operations' },
  { key: 'total_other_liabilities',        row: 101, label: 'TOTAL OTHER LIABILITIES', computed: true },
  { key: 'provision_dividend',             row: 102, label: 'Provision for Dividend' },
  { key: 'provision_taxes',                row: 103, label: 'Provision for Taxes' },
  { key: 'other_provisions_regular',       row: 104, label: 'Other Provisions; regular' },
  { key: 'total_provisions',               row: 105, label: 'Total Provisions', computed: true },
  { key: 'total_current_liabilities_ops',  row: 106, label: 'Total Current Liabilities and Provisions', computed: true },
  { key: 'total_outside_liabilities',      row: 107, label: 'TOTAL OUTSIDE LIABILITIES', computed: true },
  { key: 'total_liabilities',              row: 108, label: 'TOTAL LIABILITIES', computed: true },
];

// ─── METADATA INPUT FIELDS ──────────────────────────────────────────────────
export const METADATA_INPUTS = [
  { key: 'period_ends_on',                label: 'Period Ends On', type: 'string' },
  { key: 'result_type',                   label: 'Result Type', type: 'string', default: 'AUDITED' },
  { key: 'auditor_qualification',         label: 'Auditor Qualification', type: 'string', default: 'CA' },
  { key: 'no_of_months',                  label: 'No. of months in FY', type: 'number', default: 12 },
];

// ─── Combined ────────────────────────────────────────────────────────────────
export const ALL_FIELDS = [
  ...PROFITABILITY_FIELDS,
  ...BALANCE_SHEET_ASSETS_FIELDS,
  ...BALANCE_SHEET_LIABILITIES_FIELDS,
];

export const ALL_INPUT_FIELDS = ALL_FIELDS.filter(f => !f.computed);

export const MAX_SAFE_VALUE = 1e15;
export const MIN_SAFE_VALUE = -1e15;
