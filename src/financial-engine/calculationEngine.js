/**
 * Financial Calculation Engine
 * ============================
 * Exact reproduction of Excel formulas from FINANCIAL FINAL.xlsx
 *
 * Excel layout: Sheet1, A2:D157
 *   Rows 2-32   → Profitability Statement
 *   Rows 34-60  → Balance Sheet: Assets
 *   Rows 62-100 → Balance Sheet: Liabilities
 *   Rows 102-107→ Liquidity Ratios
 *   Rows 110-119→ Capital Structure / Financial Flexibility
 *   Rows 121-157→ Summary of Ratios (Growth, Profitability, Turnover, Solvency)
 *
 * Columns B,C,D → Year 1 (latest), Year 2, Year 3 (oldest)
 *
 * Each function below takes a year object (y) and optionally a previous year (py).
 * Variable names map to semantic financial terms.
 */

import { safeDivide, round, clamp } from './validation.js';

// ─── Helper: safe get ────────────────────────────────────────────────────────
function g(obj, key) {
  const v = obj?.[key];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
}

// ─── PROFITABILITY STATEMENT COMPUTED FIELDS ─────────────────────────────────

/**
 * Compute all derived P&L fields for a single year.
 * Mirrors Excel rows 9, 18, 24, 32
 */
export function computeProfitLoss(y) {
  const net_sales                     = g(y, 'net_sales');
  const other_income_operations       = g(y, 'other_income_operations');
  const handling_costs                = g(y, 'handling_costs');
  const cost_of_traded_goods          = g(y, 'cost_of_traded_goods');
  const consumable_stores             = g(y, 'consumable_stores');
  const power_and_fuel                = g(y, 'power_and_fuel');
  const employee_costs                = g(y, 'employee_costs');
  const other_expenses                = g(y, 'other_expenses');
  const selling_expenses              = g(y, 'selling_expenses');
  const other_related_expenses        = g(y, 'other_related_expenses');
  const pbildt                        = g(y, 'pbildt');
  const depreciation                  = g(y, 'depreciation');
  const pbit                          = g(y, 'pbit');
  const interest_and_finance_charges  = g(y, 'interest_and_finance_charges');
  const opbt                          = g(y, 'opbt');
  const non_operating_income_expense  = g(y, 'non_operating_income_expense');
  const pbt                           = g(y, 'pbt');
  const cash_adjustments              = g(y, 'cash_adjustments');
  const apbt                          = g(y, 'apbt');
  const tax                           = g(y, 'tax');
  const provision_deferred_tax        = g(y, 'provision_deferred_tax');
  const apat                          = g(y, 'apat');

  // Row 9: Total Operating Income = SUM(B7+B8) → net_sales + other_income_operations
  const total_operating_income = clamp(net_sales + other_income_operations);

  // Row 18: Cost of Sales = SUM(B11,B14,B15) → cost_of_traded_goods + employee_costs + other_expenses
  const cost_of_sales = clamp(cost_of_traded_goods + employee_costs + other_expenses);

  // Row 24: Operating Profit After Tax (OPAT) = B23 - B29 → opbt - tax
  const opat = clamp(opbt - tax);

  // Row 32: Gross Cash Accruals = SUM(B20,B30,B31) → depreciation + provision_deferred_tax + apat
  const gross_cash_accruals = clamp(depreciation + provision_deferred_tax + apat);

  return {
    // Pass-through inputs
    net_sales,
    other_income_operations,
    handling_costs,
    cost_of_traded_goods,
    consumable_stores,
    power_and_fuel,
    employee_costs,
    other_expenses,
    selling_expenses,
    other_related_expenses,
    pbildt,
    depreciation,
    pbit,
    interest_and_finance_charges,
    opbt,
    non_operating_income_expense,
    pbt,
    cash_adjustments,
    apbt,
    tax,
    provision_deferred_tax,
    apat,
    // Computed fields
    total_operating_income,
    cost_of_sales,
    opat,
    gross_cash_accruals,
  };
}

// ─── BALANCE SHEET COMPUTED FIELDS ───────────────────────────────────────────

/**
 * Compute all derived balance sheet fields for a single year.
 * Mirrors Excel rows 50, 87
 */
export function computeBalanceSheet(y) {
  // Assets
  const gross_block                   = g(y, 'gross_block');
  const accumulated_depreciation      = g(y, 'accumulated_depreciation');
  const net_block                     = g(y, 'net_block');
  const capital_work_in_progress      = g(y, 'capital_work_in_progress');
  const net_fixed_assets              = g(y, 'net_fixed_assets');
  const investments_affiliate         = g(y, 'investments_affiliate');
  const marketable_securities         = g(y, 'marketable_securities');
  const total_investments             = g(y, 'total_investments');
  const receivables_gt6m              = g(y, 'receivables_gt6m');
  const receivables_lt6m              = g(y, 'receivables_lt6m');
  const provision_doubtful_debts      = g(y, 'provision_doubtful_debts');
  const bills_receivable              = g(y, 'bills_receivable');
  const loans_advances_subsidiaries   = g(y, 'loans_advances_subsidiaries');
  const loans_advances_affiliates     = g(y, 'loans_advances_affiliates');
  const loans_advances_current_ops    = g(y, 'loans_advances_current_ops');
  const cash_and_bank                 = g(y, 'cash_and_bank');
  const total_inventories_non_ops     = g(y, 'total_inventories_non_ops');
  const loans_advances_non_ops        = g(y, 'loans_advances_non_ops');
  const advance_tax_paid              = g(y, 'advance_tax_paid');
  const total_other_assets            = g(y, 'total_other_assets');
  const total_current_assets_ops      = g(y, 'total_current_assets_ops');
  const total_assets                  = g(y, 'total_assets');

  // Liabilities
  const paid_up_equity_share_capital  = g(y, 'paid_up_equity_share_capital');
  const share_application_money       = g(y, 'share_application_money');
  const quasi_equity                  = g(y, 'quasi_equity');
  const gross_reserves                = g(y, 'gross_reserves');
  const intangible_assets             = g(y, 'intangible_assets');
  const misc_expenses_not_written_off = g(y, 'misc_expenses_not_written_off');
  const debit_balance_pnl             = g(y, 'debit_balance_pnl');
  const net_reserves                  = g(y, 'net_reserves');
  const tangible_net_worth            = g(y, 'tangible_net_worth');
  const deferred_payment_credit       = g(y, 'deferred_payment_credit');
  const rupee_term_loans              = g(y, 'rupee_term_loans');
  const total_long_term_debt          = g(y, 'total_long_term_debt');
  const current_portion_ltd           = g(y, 'current_portion_ltd');
  const net_long_term_debt            = g(y, 'net_long_term_debt');
  const current_portion_ltd_dup       = g(y, 'current_portion_ltd_dup');
  const working_capital_bank_borrowings = g(y, 'working_capital_bank_borrowings');
  const intercorporate_borrowings     = g(y, 'intercorporate_borrowings');
  const loans_advances_from_subsidiaries = g(y, 'loans_advances_from_subsidiaries');
  const loans_advances_from_promoters = g(y, 'loans_advances_from_promoters');
  const other_short_term_loans        = g(y, 'other_short_term_loans');
  const new_short_term_loans          = g(y, 'new_short_term_loans');
  const creditors_for_goods           = g(y, 'creditors_for_goods');
  const creditors_for_expenses        = g(y, 'creditors_for_expenses');
  const other_current_liabilities_ops = g(y, 'other_current_liabilities_ops');
  const current_liabilities_non_ops   = g(y, 'current_liabilities_non_ops');
  const total_other_liabilities       = g(y, 'total_other_liabilities');
  const provision_dividend            = g(y, 'provision_dividend');
  const provision_taxes               = g(y, 'provision_taxes');
  const other_provisions_regular      = g(y, 'other_provisions_regular');
  const total_provisions              = g(y, 'total_provisions');
  const total_current_liabilities_ops = g(y, 'total_current_liabilities_ops');
  const total_outside_liabilities     = g(y, 'total_outside_liabilities');
  const total_liabilities             = g(y, 'total_liabilities');

  // Row 50: TOTAL RECEIVABLES = SUM(B51:B57)
  const total_receivables = clamp(
    loans_advances_subsidiaries +
    loans_advances_affiliates +
    loans_advances_current_ops +
    cash_and_bank +
    total_inventories_non_ops +
    loans_advances_non_ops +
    advance_tax_paid
  );

  // Row 87: TOTAL SHORT TERM DEBT = SUM(B88:B91)
  const total_short_term_debt = clamp(
    creditors_for_goods +
    creditors_for_expenses +
    other_current_liabilities_ops +
    current_liabilities_non_ops
  );

  return {
    // Assets
    gross_block, accumulated_depreciation, net_block, capital_work_in_progress,
    net_fixed_assets, investments_affiliate, marketable_securities, total_investments,
    receivables_gt6m, receivables_lt6m, provision_doubtful_debts, bills_receivable,
    total_receivables,
    loans_advances_subsidiaries, loans_advances_affiliates, loans_advances_current_ops,
    cash_and_bank, total_inventories_non_ops, loans_advances_non_ops, advance_tax_paid,
    total_other_assets, total_current_assets_ops, total_assets,
    // Liabilities
    paid_up_equity_share_capital, share_application_money, quasi_equity,
    gross_reserves, intangible_assets, misc_expenses_not_written_off, debit_balance_pnl,
    net_reserves, tangible_net_worth, deferred_payment_credit, rupee_term_loans,
    total_long_term_debt, current_portion_ltd, net_long_term_debt, current_portion_ltd_dup,
    working_capital_bank_borrowings, intercorporate_borrowings,
    loans_advances_from_subsidiaries, loans_advances_from_promoters,
    other_short_term_loans, new_short_term_loans,
    total_short_term_debt,
    creditors_for_goods, creditors_for_expenses, other_current_liabilities_ops,
    current_liabilities_non_ops, total_other_liabilities,
    provision_dividend, provision_taxes, other_provisions_regular, total_provisions,
    total_current_liabilities_ops, total_outside_liabilities, total_liabilities,
  };
}

// ─── LIQUIDITY RATIOS (Rows 103-107) ────────────────────────────────────────

export function computeLiquidityRatios(pl, bs) {
  // Row 103: Current Ratio = IFERROR(B60/B100, 0)
  const current_ratio = round(safeDivide(bs.total_assets, bs.total_liabilities), 1);

  // Row 104: Working Capital Turnover = IFERROR(B7/(B59-B98), 0)
  const wc_denominator = bs.total_current_assets_ops - bs.total_current_liabilities_ops;
  const working_capital_turnover = round(safeDivide(pl.net_sales, wc_denominator), 1);

  // Row 105: Average Collection Period = IFERROR((B50/B7)*365, 0)
  const avg_collection_period = round(safeDivide(bs.total_receivables, pl.net_sales) * 365, 1);

  // Row 106: Average Creditors Period = IFERROR(((B88+B89)/B18)*365, 0)
  const creditors_sum = bs.creditors_for_goods + bs.creditors_for_expenses;
  const avg_creditors_period = round(safeDivide(creditors_sum, pl.cost_of_sales) * 365, 1);

  // Row 107: Working Capital Cycle = B105 - B106
  const working_capital_cycle = round(avg_collection_period - avg_creditors_period, 1);

  return {
    current_ratio,
    working_capital_turnover,
    avg_collection_period,
    avg_creditors_period,
    working_capital_cycle,
  };
}

// ─── CAPITAL STRUCTURE / FINANCIAL FLEXIBILITY (Rows 114-119) ────────────────

export function computeCapitalStructure(pl, bs) {
  const total_debt = bs.total_long_term_debt + bs.total_short_term_debt;
  const equity = bs.paid_up_equity_share_capital;

  // Row 114: Debt Equity Ratio = IFERROR((B77+B87)/B66, 0)
  const debt_equity_ratio = round(safeDivide(
    bs.total_long_term_debt + bs.total_short_term_debt,
    equity
  ), 2);

  // Row 115: Overall Gearing Ratio (Incl Acceptances) = IFERROR(((B77+B87)+(B88+B89))/B66, 0)
  const overall_gearing_incl = round(safeDivide(
    (bs.total_long_term_debt + bs.total_short_term_debt) + (bs.creditors_for_goods + bs.creditors_for_expenses),
    equity
  ), 2);

  // Row 116: Overall Gearing Ratio (Excl Acceptances) = IFERROR((B79+B89)/B68, 0)
  const overall_gearing_excl = round(safeDivide(
    bs.net_long_term_debt + bs.creditors_for_expenses,
    bs.quasi_equity
  ), 2);

  // Row 117: Adjusted Overall Gearing = B115
  const adjusted_overall_gearing = overall_gearing_incl;

  // Row 118: Average Cost of Borrowings = IFERROR(B22/(B77+B87), 0)
  const avg_cost_of_borrowings = round(safeDivide(
    pl.interest_and_finance_charges,
    bs.total_long_term_debt + bs.total_short_term_debt
  ), 2);

  // Row 119: Total Outside Liabilities to Net Worth = IFERROR(B99/B74, 0)
  const tol_to_tnw = round(safeDivide(
    bs.total_outside_liabilities,
    bs.tangible_net_worth
  ), 2);

  return {
    debt_equity_ratio,
    overall_gearing_incl,
    overall_gearing_excl,
    adjusted_overall_gearing,
    avg_cost_of_borrowings,
    tol_to_tnw,
  };
}

// ─── GROWTH RATIOS (Rows 126-129) ───────────────────────────────────────────

export function computeGrowthRatios(currentPL, previousPL) {
  if (!previousPL) {
    return {
      growth_net_sales: 0,
      growth_total_operating_income: 0,
      growth_pbildt: 0,
      growth_apat: 0,
    };
  }

  // Row 126: Growth in Net Sales = (B7-C7)/C7*100
  const growth_net_sales = round(safeDivide(
    currentPL.net_sales - previousPL.net_sales,
    previousPL.net_sales
  ) * 100, 1);

  // Row 127: Growth in Total Operating Income = (B9-C9)/C9*100
  const growth_total_operating_income = round(safeDivide(
    currentPL.total_operating_income - previousPL.total_operating_income,
    previousPL.total_operating_income
  ) * 100, 1);

  // Row 128: Growth in PBILDT = (B19-C19)/C19*100
  const growth_pbildt = round(safeDivide(
    currentPL.pbildt - previousPL.pbildt,
    previousPL.pbildt
  ) * 100, 1);

  // Row 129: Growth in APAT = (B31-C31)/C31*100
  const growth_apat = round(safeDivide(
    currentPL.apat - previousPL.apat,
    previousPL.apat
  ) * 100, 1);

  return {
    growth_net_sales,
    growth_total_operating_income,
    growth_pbildt,
    growth_apat,
  };
}

// ─── PROFITABILITY RATIOS (Rows 131-140) ─────────────────────────────────────

export function computeProfitabilityRatios(pl, bs) {
  // Row 131: Gross Margin = IFERROR(((B7-B11)/B7)*100, 0)
  const gross_margin = round(safeDivide(
    pl.net_sales - pl.cost_of_traded_goods,
    pl.net_sales
  ) * 100, 1);

  // Row 132: PBILDT Margin = IFERROR((B19/B9)*100, 0)
  const pbildt_margin = round(safeDivide(pl.pbildt, pl.total_operating_income) * 100, 1);

  // Row 133: PBIT Margin = IFERROR((B21/B9)*100, 0)
  const pbit_margin = round(safeDivide(pl.pbit, pl.total_operating_income) * 100, 1);

  // Row 134: OPBT Margin = IFERROR((B23/B9)*100, 0)
  const opbt_margin = round(safeDivide(pl.opbt, pl.total_operating_income) * 100, 1);

  // Row 135: OPAT Margin = IFERROR((B24/B9)*100, 0)
  const opat_margin = round(safeDivide(pl.opat, pl.total_operating_income) * 100, 1);

  // Row 136: APAT Margin = IFERROR((B31/B9)*100, 0)
  const apat_margin = round(safeDivide(pl.apat, pl.total_operating_income) * 100, 1);

  // Row 137: Operating ROCE = IFERROR((B21/(B42+(B60-B100))*100), 0)
  const op_roce_denom = bs.net_fixed_assets + (bs.total_assets - bs.total_liabilities);
  const operating_roce = round(safeDivide(pl.pbit, op_roce_denom) * 100, 1);

  // Row 138: ROCE (Total) = IFERROR((B21/B60)*100, 0)
  const roce_total = round(safeDivide(pl.pbit, bs.total_assets) * 100, 1);

  // Row 140: Average Cost of Borrowings = IFERROR((B22/(B77+B87))*100, 0)
  const avg_cost_borrowings_pct = round(safeDivide(
    pl.interest_and_finance_charges,
    bs.total_long_term_debt + bs.total_short_term_debt
  ) * 100, 1);

  return {
    gross_margin,
    pbildt_margin,
    pbit_margin,
    opbt_margin,
    opat_margin,
    apat_margin,
    operating_roce,
    roce_total,
    avg_cost_borrowings_pct,
  };
}

// ─── TURNOVER RATIOS (Rows 142-147) ─────────────────────────────────────────

export function computeTurnoverRatios(pl, bs) {
  // Row 142: Operating Capital Turnover = IFERROR(B7/(B60-B100), 0)
  const net_capital = bs.total_assets - bs.total_liabilities;
  const operating_capital_turnover = round(safeDivide(pl.net_sales, net_capital), 1);

  // Row 143: Fixed Assets Turnover = IFERROR(B7/B42, 0)
  const fixed_assets_turnover = round(safeDivide(pl.net_sales, bs.net_fixed_assets), 1);

  // Row 144: Working Capital Turnover = IFERROR(B7/(B60-B100), 0) / IFERROR(B7/(B59-B98),0)
  const wc_denom = bs.total_current_assets_ops - bs.total_current_liabilities_ops;
  const working_capital_turnover = round(safeDivide(pl.net_sales, wc_denom), 1);

  // Row 145: Avg Collection Period = IFERROR((B50/B7)*365, 0)
  const avg_collection_period = round(safeDivide(bs.total_receivables, pl.net_sales) * 365, 1);

  // Row 146: Avg Creditors Period = IFERROR((B88/B11)*365, 0)
  const avg_creditors_period = round(safeDivide(bs.creditors_for_goods, pl.cost_of_traded_goods) * 365, 1);

  // Row 147: Working Capital Cycle = B145 - B146
  const working_capital_cycle = round(avg_collection_period - avg_creditors_period, 1);

  return {
    operating_capital_turnover,
    fixed_assets_turnover,
    working_capital_turnover,
    avg_collection_period,
    avg_creditors_period,
    working_capital_cycle,
  };
}

// ─── SOLVENCY RATIOS (Rows 149-157) ─────────────────────────────────────────

export function computeSolvencyRatios(pl, bs, capitalStructure) {
  // Row 149: Debt Equity Ratio = B114 (pass-through)
  const debt_equity_ratio = capitalStructure.debt_equity_ratio;

  // Row 150: Overall Gearing (Incl) = B115
  const overall_gearing_incl = capitalStructure.overall_gearing_incl;

  // Row 151: Adjusted Debt Equity = B149 = B114
  const adjusted_debt_equity = debt_equity_ratio;

  // Row 152: Adjusted Overall Gearing = B117 = B115
  const adjusted_overall_gearing = capitalStructure.adjusted_overall_gearing;

  // Row 153: Term Debt (incl CPLTD) / GCA = IFERROR((B77+B87)/B32, 0)
  const term_debt_to_gca = round(safeDivide(
    bs.total_long_term_debt + bs.total_short_term_debt,
    pl.gross_cash_accruals
  ), 2);

  // Row 154: Total Debt / GCA = IFERROR((B77+B79+B87)/B32, 0)
  const total_debt_to_gca = round(safeDivide(
    bs.total_long_term_debt + bs.net_long_term_debt + bs.total_short_term_debt,
    pl.gross_cash_accruals
  ), 2);

  // Row 155: Interest Coverage (PBILDT/Interest) = IFERROR(B19/B22, 0)
  const interest_coverage_pbildt = round(safeDivide(pl.pbildt, pl.interest_and_finance_charges), 2);

  // Row 156: PBIT / Interest = IFERROR(B21/B22, 0)
  const pbit_to_interest = round(safeDivide(pl.pbit, pl.interest_and_finance_charges), 2);

  // Row 157: Adjusted Interest Coverage = B155
  const adjusted_interest_coverage = interest_coverage_pbildt;

  return {
    debt_equity_ratio,
    overall_gearing_incl,
    adjusted_debt_equity,
    adjusted_overall_gearing,
    term_debt_to_gca,
    total_debt_to_gca,
    interest_coverage_pbildt,
    pbit_to_interest,
    adjusted_interest_coverage,
  };
}

// ─── MASTER COMPUTATION — SINGLE YEAR ────────────────────────────────────────

export function computeYearFinancials(yearInput, previousYearPL = null) {
  const pl = computeProfitLoss(yearInput);
  const bs = computeBalanceSheet(yearInput);
  const liquidity = computeLiquidityRatios(pl, bs);
  const capitalStructure = computeCapitalStructure(pl, bs);
  const growth = computeGrowthRatios(pl, previousYearPL);
  const profitability = computeProfitabilityRatios(pl, bs);
  const turnover = computeTurnoverRatios(pl, bs);
  const solvency = computeSolvencyRatios(pl, bs, capitalStructure);

  return {
    profit_and_loss: pl,
    balance_sheet: bs,
    liquidity,
    capital_structure: capitalStructure,
    growth,
    profitability,
    turnover,
    solvency,
  };
}
