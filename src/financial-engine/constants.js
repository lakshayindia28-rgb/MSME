/**
 * Financial Engine Constants
 * =========================
 * Semantic variable names mapped from Excel cell references.
 * Excel has 3 year-columns: B (Year 1 / Latest), C (Year 2), D (Year 3 / Oldest)
 * Each year gets its own object key suffix: _y1, _y2, _y3
 */

// ─── PROFITABILITY STATEMENT INPUT FIELDS (rows 7-32) ───────────────────────
export const PROFIT_LOSS_INPUTS = [
  { key: 'net_sales',                           row: 7,  label: 'Net Sales' },
  { key: 'other_income_operations',              row: 8,  label: 'Other Income (related to operations)' },
  { key: 'handling_costs',                       row: 10, label: 'Handling Costs' },
  { key: 'cost_of_traded_goods',                 row: 11, label: 'Cost of Traded Goods Sale' },
  { key: 'consumable_stores',                    row: 12, label: 'Consumable Stores' },
  { key: 'power_and_fuel',                       row: 13, label: 'Power and Fuel' },
  { key: 'employee_costs',                       row: 14, label: 'Employee Costs' },
  { key: 'other_expenses',                       row: 15, label: 'Other Expenses' },
  { key: 'selling_expenses',                     row: 16, label: 'Selling Expenses' },
  { key: 'other_related_expenses',               row: 17, label: 'Other related Expenses' },
  { key: 'pbildt',                               row: 19, label: 'PBILDT' },
  { key: 'depreciation',                         row: 20, label: 'Depreciation' },
  { key: 'pbit',                                 row: 21, label: 'PBIT' },
  { key: 'interest_and_finance_charges',         row: 22, label: 'Interest and Finance Charges' },
  { key: 'opbt',                                 row: 23, label: 'Operating Profit Before Tax (OPBT)' },
  { key: 'non_operating_income_expense',         row: 25, label: 'Non-Operating Income / (Expense)' },
  { key: 'pbt',                                  row: 26, label: 'Profit Before Tax (PBT)' },
  { key: 'cash_adjustments',                     row: 27, label: 'Cash Adjustments' },
  { key: 'apbt',                                 row: 28, label: 'Adjusted Profit Before Tax (APBT)' },
  { key: 'tax',                                  row: 29, label: 'Tax' },
  { key: 'provision_deferred_tax',               row: 30, label: 'Provision for Deferred Tax' },
  { key: 'apat',                                 row: 31, label: 'Adjusted Profit After Tax (APAT)' },
];

// ─── BALANCE SHEET: ASSETS INPUT FIELDS (rows 38-60) ────────────────────────
export const BALANCE_SHEET_ASSETS_INPUTS = [
  { key: 'gross_block',                          row: 38, label: 'Gross Block' },
  { key: 'accumulated_depreciation',             row: 39, label: 'Accumulated Depreciation' },
  { key: 'net_block',                            row: 40, label: 'Net Block' },
  { key: 'capital_work_in_progress',             row: 41, label: 'Capital Work in Progress' },
  { key: 'net_fixed_assets',                     row: 42, label: 'NET FIXED ASSETS' },
  { key: 'investments_affiliate',                row: 43, label: 'Investments in Affiliate Companies' },
  { key: 'marketable_securities',                row: 44, label: 'Marketable Securities' },
  { key: 'total_investments',                    row: 45, label: 'TOTAL INVESTMENTS: net of provision' },
  { key: 'receivables_gt6m',                     row: 46, label: 'Receivables: More than 6 months' },
  { key: 'receivables_lt6m',                     row: 47, label: 'Receivables: Less than 6 months' },
  { key: 'provision_doubtful_debts',             row: 48, label: 'Less: Provision for doubtful debts' },
  { key: 'bills_receivable',                     row: 49, label: 'Bills Receivable' },
  { key: 'loans_advances_subsidiaries',          row: 51, label: 'Loans & Advances to Subsidiaries' },
  { key: 'loans_advances_affiliates',            row: 52, label: 'Loans & Advances to Affiliate Companies' },
  { key: 'loans_advances_current_ops',           row: 53, label: 'Loans; Advances; current assets related to operations' },
  { key: 'cash_and_bank',                        row: 54, label: 'Cash and Bank Balances' },
  { key: 'total_inventories_non_ops',            row: 55, label: 'Total Inventories Non-operational Assets' },
  { key: 'loans_advances_non_ops',               row: 56, label: 'Loans; Advances; current assets not related to operations' },
  { key: 'advance_tax_paid',                     row: 57, label: 'Advance Tax Paid' },
  { key: 'total_other_assets',                   row: 58, label: 'TOTAL OTHER ASSETS' },
  { key: 'total_current_assets_ops',             row: 59, label: 'TOTAL CURRENT ASSETS related to operations' },
  { key: 'total_assets',                         row: 60, label: 'TOTAL ASSETS' },
];

// ─── BALANCE SHEET: LIABILITIES INPUT FIELDS (rows 66-100) ──────────────────
export const BALANCE_SHEET_LIABILITIES_INPUTS = [
  { key: 'paid_up_equity_share_capital',         row: 66, label: 'Total Paid Up Equity Share Capital' },
  { key: 'share_application_money',              row: 67, label: 'Share Application Money pending allotment' },
  { key: 'quasi_equity',                         row: 68, label: 'Quasi Equity: FCD; CCPS etc.' },
  { key: 'gross_reserves',                       row: 69, label: 'GROSS RESERVES' },
  { key: 'intangible_assets',                    row: 70, label: 'Intangible Assets' },
  { key: 'misc_expenses_not_written_off',        row: 71, label: 'Miscellaneous expenses not written off' },
  { key: 'debit_balance_pnl',                    row: 72, label: 'Debit Balance in Profit and Loss Account' },
  { key: 'net_reserves',                         row: 73, label: 'NET RESERVES' },
  { key: 'tangible_net_worth',                   row: 74, label: 'TANGIBLE NET WORTH' },
  { key: 'deferred_payment_credit',              row: 75, label: 'Deferred Payment Credit' },
  { key: 'rupee_term_loans',                     row: 76, label: 'Rupee Term Loans' },
  { key: 'total_long_term_debt',                 row: 77, label: 'TOTAL LONG TERM DEBT' },
  { key: 'current_portion_ltd',                  row: 78, label: 'Current Portion of Long Term Debt and Fixed Deposits' },
  { key: 'net_long_term_debt',                   row: 79, label: 'NET LONG TERM DEBT' },
  { key: 'current_portion_ltd_dup',              row: 80, label: 'Current Portion of Long Term Debt and Fixed Deposits (dup)' },
  { key: 'working_capital_bank_borrowings',      row: 81, label: 'Working Capital Bank Borrowings' },
  { key: 'intercorporate_borrowings',            row: 82, label: 'Intercorporate Borrowings' },
  { key: 'loans_advances_from_subsidiaries',     row: 83, label: 'Loans & Advances from Subsidiaries' },
  { key: 'loans_advances_from_promoters',        row: 84, label: 'Loans & Advances from promoters; other affiliated cos.' },
  { key: 'other_short_term_loans',               row: 85, label: 'Other Short Term Loans & Advances' },
  { key: 'new_short_term_loans',                 row: 86, label: 'New Short Term Loans' },
  { key: 'creditors_for_goods',                  row: 88, label: 'Creditors for goods' },
  { key: 'creditors_for_expenses',               row: 89, label: 'Creditors for Expenses' },
  { key: 'other_current_liabilities_ops',        row: 90, label: 'Other Current Liabilities: related to ops.' },
  { key: 'current_liabilities_non_ops',          row: 91, label: 'Current Liabilities: not related to operations' },
  { key: 'total_other_liabilities',              row: 92, label: 'TOTAL OTHER LIABILITIES' },
  { key: 'provision_dividend',                   row: 93, label: 'Provision for Dividend' },
  { key: 'provision_taxes',                      row: 94, label: 'Provision for Taxes' },
  { key: 'other_provisions_regular',             row: 95, label: 'Other Provisions; regular' },
  { key: 'total_provisions',                     row: 97, label: 'Total Provisions' },
  { key: 'total_current_liabilities_ops',        row: 98, label: 'Total Current Liabilities and Provisions; related to operations' },
  { key: 'total_outside_liabilities',            row: 99, label: 'TOTAL OUTSIDE LIABILITIES' },
  { key: 'total_liabilities',                    row: 100, label: 'TOTAL LIABILITIES' },
];

// ─── METADATA INPUT FIELDS ──────────────────────────────────────────────────
export const METADATA_INPUTS = [
  { key: 'period_ends_on',                       label: 'Period Ends On (date string)' },
  { key: 'result_type',                          label: 'Result Type (AUDITED / PROVISIONAL)' },
  { key: 'auditor_qualification',                label: 'Auditor Qualification' },
  { key: 'no_of_months',                         label: 'No. of months in current financial year' },
];

// All input field definitions combined
export const ALL_INPUT_FIELDS = [
  ...PROFIT_LOSS_INPUTS,
  ...BALANCE_SHEET_ASSETS_INPUTS,
  ...BALANCE_SHEET_LIABILITIES_INPUTS,
];

// Year suffixes
export const YEAR_KEYS = ['y1', 'y2', 'y3'];

// Validation limits
export const MAX_SAFE_VALUE = 1e15;  // 1 quadrillion — reasonable upper limit for INR values
export const MIN_SAFE_VALUE = -1e15;
