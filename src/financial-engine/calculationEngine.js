/**
 * Financial Calculation Engine — Matched to Financial Calc.xlsx
 * ==============================================================
 * All formulas exactly replicate the Excel sheet.
 *
 * Excel layout: Sheet1, A2:D165
 *   Rows 2-32    → Profitability Statement
 *   Rows 34-66   → Balance Sheet: Assets
 *   Rows 68-108  → Balance Sheet: Liabilities
 *   Rows 110-115 → Liquidity Ratios
 *   Rows 118-127 → Capital Structure
 *   Rows 129-165 → Summary of Ratios
 */

import { safeDivide } from './validation.js';

// ─── Helper: safe get ────────────────────────────────────────────────────────
function g(obj, key) {
  const v = obj?.[key];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFITABILITY STATEMENT (Rows 7-32)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeProfitLoss(y) {
  // ── Inputs ──
  const net_sales                    = g(y, 'net_sales');
  const other_income_operations      = g(y, 'other_income_operations');
  const handling_costs               = g(y, 'handling_costs');
  const cost_of_traded_goods         = g(y, 'cost_of_traded_goods');
  const consumable_stores            = g(y, 'consumable_stores');
  const power_and_fuel               = g(y, 'power_and_fuel');
  const employee_costs               = g(y, 'employee_costs');
  const other_expenses               = g(y, 'other_expenses');
  const selling_expenses             = g(y, 'selling_expenses');
  const other_related_expenses       = g(y, 'other_related_expenses');
  const depreciation                 = g(y, 'depreciation');
  const interest_and_finance_charges = g(y, 'interest_and_finance_charges');
  const non_operating_income_expense = g(y, 'non_operating_income_expense');
  const cash_adjustments             = g(y, 'cash_adjustments');
  const extraordinary_adjustments    = g(y, 'extraordinary_adjustments');
  const current_tax                  = g(y, 'current_tax');
  const provision_deferred_tax       = g(y, 'provision_deferred_tax');

  // ── Computed (Excel formulas) ──
  // Row 9: =SUM(B7:B8)
  const total_operating_income = net_sales + other_income_operations;

  // Row 18: =SUM(B10:B17)
  const cost_of_sales = handling_costs + cost_of_traded_goods + consumable_stores
    + power_and_fuel + employee_costs + other_expenses + selling_expenses + other_related_expenses;

  // Row 19: =B9-B18
  const pbildt = total_operating_income - cost_of_sales;

  // Row 21: =B19-B20
  const pbit = pbildt - depreciation;

  // Row 23: =B21-B22
  const opbt = pbit - interest_and_finance_charges;

  // Row 25: =B23-B24
  const pbt = opbt - non_operating_income_expense;

  // Row 27: =B25-B26
  const apbt = pbt - cash_adjustments;

  // Row 31: =B27-B28-B29-B30
  const pat = apbt - extraordinary_adjustments - current_tax - provision_deferred_tax;

  // Row 32: =SUM(B20,B30,B31)
  const gross_cash_accruals = depreciation + provision_deferred_tax + pat;

  return {
    net_sales, other_income_operations, total_operating_income,
    handling_costs, cost_of_traded_goods, consumable_stores, power_and_fuel,
    employee_costs, other_expenses, selling_expenses, other_related_expenses,
    cost_of_sales, pbildt, depreciation, pbit,
    interest_and_finance_charges, opbt,
    non_operating_income_expense, pbt,
    cash_adjustments, apbt,
    extraordinary_adjustments, current_tax, provision_deferred_tax,
    pat, gross_cash_accruals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BALANCE SHEET (Rows 39-108)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeBalanceSheet(y) {
  // ── Assets: Inputs ──
  const gross_block                     = g(y, 'gross_block');
  const accumulated_depreciation        = g(y, 'accumulated_depreciation');
  const capital_work_in_progress        = g(y, 'capital_work_in_progress');
  const investments_affiliate           = g(y, 'investments_affiliate');
  const non_current_investments         = g(y, 'non_current_investments');
  const non_current_loans_advances      = g(y, 'non_current_loans_advances');
  const deferred_tax_assets             = g(y, 'deferred_tax_assets');
  const other_non_current_assets        = g(y, 'other_non_current_assets');
  const receivables_gt6m                = g(y, 'receivables_gt6m');
  const receivables_lt6m                = g(y, 'receivables_lt6m');
  const provision_doubtful_debts        = g(y, 'provision_doubtful_debts');
  const bills_receivable                = g(y, 'bills_receivable');
  const investments_marketable_securities = g(y, 'investments_marketable_securities');
  const loans_advances_subsidiaries     = g(y, 'loans_advances_subsidiaries');
  const loans_advances_affiliates       = g(y, 'loans_advances_affiliates');
  const loans_advances_current_ops      = g(y, 'loans_advances_current_ops');
  const cash_and_bank                   = g(y, 'cash_and_bank');
  const total_inventories_non_ops       = g(y, 'total_inventories_non_ops');
  const loans_advances_non_ops          = g(y, 'loans_advances_non_ops');
  const advance_tax_paid                = g(y, 'advance_tax_paid');
  const total_other_assets              = g(y, 'total_other_assets');

  // ── Assets: Computed ──
  // Row 41: =B39-B40
  const net_block = gross_block - accumulated_depreciation;

  // Row 43: =B41+B42
  const net_fixed_assets = net_block + capital_work_in_progress;

  // Row 49: =SUM(B44:B48)
  const non_current_assets = investments_affiliate + non_current_investments
    + non_current_loans_advances + deferred_tax_assets + other_non_current_assets;

  // Row 54: =B50+B51-B52+B53
  const total_receivables = receivables_gt6m + receivables_lt6m - provision_doubtful_debts + bills_receivable;

  // Row 64: =SUM(B54:B63)
  const total_current_assets_ops = total_receivables + investments_marketable_securities
    + loans_advances_subsidiaries + loans_advances_affiliates + loans_advances_current_ops
    + cash_and_bank + total_inventories_non_ops + loans_advances_non_ops
    + advance_tax_paid + total_other_assets;

  // Row 65: =SUM(B54:B63)  (same as 64)
  const total_current_assets = total_current_assets_ops;

  // Row 66: =B43+B64+B49
  const total_assets = net_fixed_assets + total_current_assets_ops + non_current_assets;

  // ── Liabilities: Inputs ──
  const paid_up_equity_share_capital    = g(y, 'paid_up_equity_share_capital');
  const reserves_surplus                = g(y, 'reserves_surplus');
  const share_application_money         = g(y, 'share_application_money');
  const quasi_equity                    = g(y, 'quasi_equity');
  const intangible_assets               = g(y, 'intangible_assets');
  const misc_expenses_not_written_off   = g(y, 'misc_expenses_not_written_off');
  const debit_balance_pnl               = g(y, 'debit_balance_pnl');
  const deferred_payment_credit         = g(y, 'deferred_payment_credit');
  const rupee_term_loans                = g(y, 'rupee_term_loans');
  const long_term_provisions            = g(y, 'long_term_provisions');
  const other_long_term_liabilities     = g(y, 'other_long_term_liabilities');
  const current_portion_ltd             = g(y, 'current_portion_ltd');
  const working_capital_bank_borrowings = g(y, 'working_capital_bank_borrowings');
  const intercorporate_borrowings       = g(y, 'intercorporate_borrowings');
  const loans_advances_from_subsidiaries = g(y, 'loans_advances_from_subsidiaries');
  const loans_advances_from_promoters   = g(y, 'loans_advances_from_promoters');
  const other_short_term_loans          = g(y, 'other_short_term_loans');
  const new_short_term_loans            = g(y, 'new_short_term_loans');
  const creditors_for_goods             = g(y, 'creditors_for_goods');
  const creditors_for_expenses          = g(y, 'creditors_for_expenses');
  const other_current_liabilities_ops   = g(y, 'other_current_liabilities_ops');
  const current_liabilities_non_ops     = g(y, 'current_liabilities_non_ops');
  const provision_dividend              = g(y, 'provision_dividend');
  const provision_taxes                 = g(y, 'provision_taxes');
  const other_provisions_regular        = g(y, 'other_provisions_regular');

  // ── Liabilities: Computed ──
  // Row 77: =SUM(B73:B76)
  const gross_reserves = paid_up_equity_share_capital + reserves_surplus
    + share_application_money + quasi_equity;

  // Row 81: =B77-B78-B79-B80
  const net_reserves = gross_reserves - intangible_assets - misc_expenses_not_written_off - debit_balance_pnl;

  // Row 82: =+B81
  const tangible_net_worth = net_reserves;

  // Row 85: =SUM(B83:B84)
  const total_long_term_debt = deferred_payment_credit + rupee_term_loans;

  // Row 89: =+B85+B86+B87-B88
  const net_long_term_debt = total_long_term_debt + long_term_provisions + other_long_term_liabilities - current_portion_ltd;

  // Row 96: =SUM(B90:B95)
  const total_short_term_debt = working_capital_bank_borrowings + intercorporate_borrowings
    + loans_advances_from_subsidiaries + loans_advances_from_promoters
    + other_short_term_loans + new_short_term_loans;

  // Row 101: =SUM(B97:B100)
  const total_other_liabilities = creditors_for_goods + creditors_for_expenses
    + other_current_liabilities_ops + current_liabilities_non_ops;

  // Row 105: =SUM(B102:B104)
  const total_provisions = provision_dividend + provision_taxes + other_provisions_regular;

  // Row 106: =+B96+B101+B105
  const total_current_liabilities_ops = total_short_term_debt + total_other_liabilities + total_provisions;

  // Row 107: =B89+B96+B101+B105
  const total_outside_liabilities = net_long_term_debt + total_short_term_debt + total_other_liabilities + total_provisions;

  // Row 108: =+B82+B89+B96+B101+B105
  const total_liabilities = tangible_net_worth + net_long_term_debt + total_short_term_debt + total_other_liabilities + total_provisions;

  return {
    // Assets
    gross_block, accumulated_depreciation, net_block,
    capital_work_in_progress, net_fixed_assets,
    investments_affiliate, non_current_investments, non_current_loans_advances,
    deferred_tax_assets, other_non_current_assets, non_current_assets,
    receivables_gt6m, receivables_lt6m, provision_doubtful_debts, bills_receivable,
    total_receivables,
    investments_marketable_securities, loans_advances_subsidiaries, loans_advances_affiliates,
    loans_advances_current_ops, cash_and_bank, total_inventories_non_ops,
    loans_advances_non_ops, advance_tax_paid, total_other_assets,
    total_current_assets_ops, total_current_assets, total_assets,
    // Liabilities
    paid_up_equity_share_capital, reserves_surplus, share_application_money, quasi_equity,
    gross_reserves, intangible_assets, misc_expenses_not_written_off, debit_balance_pnl,
    net_reserves, tangible_net_worth,
    deferred_payment_credit, rupee_term_loans, total_long_term_debt,
    long_term_provisions, other_long_term_liabilities, current_portion_ltd, net_long_term_debt,
    working_capital_bank_borrowings, intercorporate_borrowings,
    loans_advances_from_subsidiaries, loans_advances_from_promoters,
    other_short_term_loans, new_short_term_loans, total_short_term_debt,
    creditors_for_goods, creditors_for_expenses, other_current_liabilities_ops,
    current_liabilities_non_ops, total_other_liabilities,
    provision_dividend, provision_taxes, other_provisions_regular, total_provisions,
    total_current_liabilities_ops, total_outside_liabilities, total_liabilities,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIQUIDITY RATIOS (Rows 111-115)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeLiquidityRatios(pl, bs, nextYearBs) {
  // Row 111: Current Ratio = IFERROR(B64/B106, 0)
  const current_ratio = safeDivide(bs.total_current_assets_ops, bs.total_current_liabilities_ops);

  // Row 112: Working Capital Turnover = IFERROR(B7/(B64-B106), 0)
  const wc = bs.total_current_assets_ops - bs.total_current_liabilities_ops;
  const working_capital_turnover = safeDivide(pl.net_sales, wc);

  // Row 113: Average Collection Period (days)
  // Latest years: =((B54+C54)*0.5)/B7*365    Oldest: =IFERROR((D54/D7)*365,0)
  let avg_collection_period;
  if (nextYearBs) {
    avg_collection_period = safeDivide((bs.total_receivables + nextYearBs.total_receivables) * 0.5, pl.net_sales) * 365;
  } else {
    avg_collection_period = safeDivide(bs.total_receivables, pl.net_sales) * 365;
  }

  // Row 114: Average Creditors Period = ((B98+C98)*0.5/B18*365) = cred_exp avg / COS
  // Oldest year (D): ((D97+D98)/D18)*365
  let avg_creditors_period;
  if (nextYearBs) {
    avg_creditors_period = safeDivide((bs.creditors_for_expenses + nextYearBs.creditors_for_expenses) * 0.5, pl.cost_of_sales) * 365;
  } else {
    avg_creditors_period = safeDivide(bs.creditors_for_goods + bs.creditors_for_expenses, pl.cost_of_sales) * 365;
  }

  // Row 115: Working Capital Cycle = B113 - B114
  const working_capital_cycle = avg_collection_period - avg_creditors_period;

  return { current_ratio, working_capital_turnover, avg_collection_period, avg_creditors_period, working_capital_cycle };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL STRUCTURE / FINANCIAL FLEXIBILITY (Rows 122-127)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeCapitalStructure(pl, bs) {
  // Row 122: Debt Equity Ratio = B96/B82 = STD/TNW
  const debt_equity_ratio = safeDivide(bs.total_short_term_debt, bs.tangible_net_worth);

  // Row 123: Overall Gearing (Including) = (B96+B98)/B82 = (STD+Cred_exp)/TNW
  const overall_gearing_incl = safeDivide(
    bs.total_short_term_debt + bs.creditors_for_expenses,
    bs.tangible_net_worth);

  // Row 124: Overall Gearing (Excluding) = (B96+B98)/B82 = same as Including
  const overall_gearing_excl = overall_gearing_incl;

  // Row 125: Adjusted Overall Gearing = B107/B82
  const adjusted_overall_gearing = safeDivide(bs.total_outside_liabilities, bs.tangible_net_worth);

  // Row 126: Average Cost of Borrowings = IFERROR(B22/(B85+B96), 0)
  const avg_cost_of_borrowings = safeDivide(pl.interest_and_finance_charges, bs.total_long_term_debt + bs.total_short_term_debt);

  // Row 127: Total Outside Liabilities to Networth = IFERROR(B107/B82, 0)
  const tol_to_tnw = safeDivide(bs.total_outside_liabilities, bs.tangible_net_worth);

  return { debt_equity_ratio, overall_gearing_incl, overall_gearing_excl, adjusted_overall_gearing, avg_cost_of_borrowings, tol_to_tnw };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROWTH RATIOS (Rows 134-137)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeGrowthRatios(currentPL, previousPL) {
  if (!previousPL) {
    return { growth_net_sales: 0, growth_total_operating_income: 0, growth_pbildt: 0, growth_apat: 0 };
  }
  // Row 134: =(B7-C7)/C7*100
  const growth_net_sales = safeDivide(currentPL.net_sales - previousPL.net_sales, previousPL.net_sales) * 100;
  // Row 135: =(B9-C9)/C9*100
  const growth_total_operating_income = safeDivide(currentPL.total_operating_income - previousPL.total_operating_income, previousPL.total_operating_income) * 100;
  // Row 136: =(B19-C19)/C19*100
  const growth_pbildt = safeDivide(currentPL.pbildt - previousPL.pbildt, previousPL.pbildt) * 100;
  // Row 137: =(B31-C31)/C31*100
  const growth_apat = safeDivide(currentPL.pat - previousPL.pat, previousPL.pat) * 100;

  return { growth_net_sales, growth_total_operating_income, growth_pbildt, growth_apat };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFITABILITY RATIOS (Rows 139-148)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeProfitabilityRatios(pl, bs) {
  // Row 139: Gross Margin = B19/B9*100 = PBILDT/TOI
  const gross_margin = safeDivide(pl.pbildt, pl.total_operating_income) * 100;

  // Row 140: PBILDT Margin = IFERROR((B19/B9)*100, 0)
  const pbildt_margin = safeDivide(pl.pbildt, pl.total_operating_income) * 100;

  // Row 141: PBIT Margin = IFERROR((B21/B9)*100, 0)
  const pbit_margin = safeDivide(pl.pbit, pl.total_operating_income) * 100;

  // Row 142: OPBT Margin = IFERROR((B23/B9)*100, 0)
  const opbt_margin = safeDivide(pl.opbt, pl.total_operating_income) * 100;

  // Row 143: OPAT Margin = B31/B9*100 = PAT/TOI
  const opat_margin = safeDivide(pl.pat, pl.total_operating_income) * 100;

  // Row 144: APAT Margin = IFERROR((B31/B9)*100, 0)
  const apat_margin = safeDivide(pl.pat, pl.total_operating_income) * 100;

  // Row 145: Operating ROCE = B21/B82*100 = PBIT/TNW
  const operating_roce = safeDivide(pl.pbit, bs.tangible_net_worth) * 100;

  // Row 146: ROCE (Total) = B21/B82*100 = PBIT/TNW
  const roce_total = safeDivide(pl.pbit, bs.tangible_net_worth) * 100;

  // Row 147: RONW = (PAT / Net Reserves) * 100
  const ronw = safeDivide(pl.pat, bs.net_reserves) * 100;

  // Row 148: Average Cost of Borrowings = IFERROR((B22/(B85+B96))*100, 0)
  const avg_cost_borrowings_pct = safeDivide(pl.interest_and_finance_charges, bs.total_long_term_debt + bs.total_short_term_debt) * 100;

  return { gross_margin, pbildt_margin, pbit_margin, opbt_margin, opat_margin, apat_margin, operating_roce, roce_total, ronw, avg_cost_borrowings_pct };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TURNOVER RATIOS (Rows 150-155)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeTurnoverRatios(pl, bs, nextYearBs) {
  // Row 150: Operating Capital Turnover = B7/(B54-B98)
  const operating_capital_turnover = safeDivide(pl.net_sales, bs.total_receivables - bs.creditors_for_expenses);

  // Row 151: Fixed Assets Turnover = IFERROR(B7/B43, 0)
  const fixed_assets_turnover = safeDivide(pl.net_sales, bs.net_fixed_assets);

  // Row 152: Working Capital Turnover = IFERROR(B7/(B65-B106), 0)
  const wc = bs.total_current_assets - bs.total_current_liabilities_ops;
  const working_capital_turnover = safeDivide(pl.net_sales, wc);

  // Row 153: Average Collection Period (days)
  let avg_collection_period;
  if (nextYearBs) {
    avg_collection_period = safeDivide((bs.total_receivables + nextYearBs.total_receivables) * 0.5, pl.net_sales) * 365;
  } else {
    avg_collection_period = safeDivide(bs.total_receivables, pl.net_sales) * 365;
  }

  // Row 154: Average Creditors Period = ((B98+C98)*0.5/B18*365) = cred_exp avg / COS
  // Oldest year (D): (D97/D11)*365
  let avg_creditors_period;
  if (nextYearBs) {
    avg_creditors_period = safeDivide((bs.creditors_for_expenses + nextYearBs.creditors_for_expenses) * 0.5, pl.cost_of_sales) * 365;
  } else {
    avg_creditors_period = safeDivide(bs.creditors_for_goods, pl.cost_of_traded_goods) * 365;
  }

  // Row 155: Working Capital Cycle = B153-B154
  const working_capital_cycle = avg_collection_period - avg_creditors_period;

  return { operating_capital_turnover, fixed_assets_turnover, working_capital_turnover, avg_collection_period, avg_creditors_period, working_capital_cycle };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOLVENCY RATIOS (Rows 157-165)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeSolvencyRatios(pl, bs, capitalStructure) {
  // Row 157: Debt Equity Ratio = B122
  const debt_equity_ratio = capitalStructure.debt_equity_ratio;

  // Row 158: Overall Gearing = B123
  const overall_gearing_incl = capitalStructure.overall_gearing_incl;

  // Row 159: Adjusted Debt Equity = B157
  const adjusted_debt_equity = debt_equity_ratio;

  // Row 160: Adjusted Overall Gearing = B125
  const adjusted_overall_gearing = capitalStructure.adjusted_overall_gearing;

  // Row 161: Term Debt (incl CPLTD) / GCA = IFERROR((B85+B96)/B32, 0)
  const term_debt_to_gca = safeDivide(bs.total_long_term_debt + bs.total_short_term_debt, pl.gross_cash_accruals);

  // Row 162: Total Debt / GCA = IFERROR((B85+B89+B96)/B32, 0)
  const total_debt_to_gca = safeDivide(bs.total_long_term_debt + bs.net_long_term_debt + bs.total_short_term_debt, pl.gross_cash_accruals);

  // Row 163: Interest Coverage (PBILDT / Interest) = IFERROR(B19/B22, 0)
  const interest_coverage_pbildt = safeDivide(pl.pbildt, pl.interest_and_finance_charges);

  // Row 164: PBIT / Interest = IFERROR(B21/B22, 0)
  const pbit_to_interest = safeDivide(pl.pbit, pl.interest_and_finance_charges);

  // Row 165: Adjusted Interest Coverage = B163
  const adjusted_interest_coverage = interest_coverage_pbildt;

  return { debt_equity_ratio, overall_gearing_incl, adjusted_debt_equity, adjusted_overall_gearing, term_debt_to_gca, total_debt_to_gca, interest_coverage_pbildt, pbit_to_interest, adjusted_interest_coverage };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a single year's full financials.
 * @param {object} yearInput     — raw input values
 * @param {object|null} prevPL   — previous year's profit_and_loss (for growth)
 * @param {object|null} nextBS   — next-in-array year's balance_sheet (older year, for averaging)
 */
export function computeYearFinancials(yearInput, prevPL = null, nextBS = null) {
  const pl = computeProfitLoss(yearInput);
  const bs = computeBalanceSheet(yearInput);
  const liquidity = computeLiquidityRatios(pl, bs, nextBS);
  const capitalStructure = computeCapitalStructure(pl, bs);
  const growth = computeGrowthRatios(pl, prevPL);
  const profitability = computeProfitabilityRatios(pl, bs);
  const turnover = computeTurnoverRatios(pl, bs, nextBS);
  const solvency = computeSolvencyRatios(pl, bs, capitalStructure);

  return { profit_and_loss: pl, balance_sheet: bs, liquidity, capital_structure: capitalStructure, growth, profitability, turnover, solvency };
}
