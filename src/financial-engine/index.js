/**
 * Financial Engine — Main API
 * ============================
 * Entry point function: calculateFinancials(inputData) → FinancialOutput
 *
 * Input shape:
 * {
 *   company_name?: string,
 *   gstin?: string,
 *   case_id?: string,
 *   years: [
 *     { period_ends_on, result_type, auditor_qualification, no_of_months,
 *       net_sales, other_income_operations, ... (all input fields) },
 *     { ... year 2 ... },
 *     { ... year 3 ... }
 *   ]
 * }
 *
 * Output shape:
 * {
 *   meta: { ... },
 *   years: [
 *     { period, computed: { profit_and_loss, balance_sheet, liquidity, capital_structure, ... } }
 *   ],
 *   ratios: { ... },
 *   profitability: { ... },
 *   liquidity: { ... },
 *   leverage: { ... },
 *   eligibility: { ... },
 *   derived_metrics: { ... }
 * }
 */

import { validateInput, sanitiseOutput, round, safeDivide } from './validation.js';
import { computeYearFinancials, computeProfitLoss } from './calculationEngine.js';
import { ALL_INPUT_FIELDS } from './constants.js';

/**
 * Primary API function — takes raw input, validates, computes, returns structured JSON.
 * @param {object} inputData
 * @returns {{ success: boolean, data?: object, errors?: string[] }}
 */
export function calculateFinancials(inputData) {
  // 1. Validate & sanitise input
  const { valid, errors, sanitised } = validateInput(inputData);
  if (!valid && !sanitised.years?.length) {
    return { success: false, errors };
  }

  const years = sanitised.years;
  const computedYears = [];

  // 2. Compute each year (oldest → newest to build previous-year references)
  //    Input order is newest-first (B=y1, C=y2, D=y3), so reverse for computation
  const reversed = [...years].reverse();
  const reversedResults = [];

  for (let i = 0; i < reversed.length; i++) {
    const yearInput = reversed[i];
    const prevPL = i > 0 ? reversedResults[i - 1].profit_and_loss : null;
    const computed = computeYearFinancials(yearInput, prevPL);
    reversedResults.push(computed);
  }

  // Re-reverse to get newest-first order back
  const finalResults = reversedResults.reverse();

  for (let i = 0; i < years.length; i++) {
    computedYears.push({
      period: years[i].period_ends_on || `Year ${i + 1}`,
      result_type: years[i].result_type || 'AUDITED',
      auditor_qualification: years[i].auditor_qualification || '',
      no_of_months: years[i].no_of_months || 12,
      input: years[i],
      computed: finalResults[i],
    });
  }

  // 3. Build aggregated output sections (latest year = index 0)
  const latest = finalResults[0] || {};
  const latestPL = latest.profit_and_loss || {};
  const latestBS = latest.balance_sheet || {};

  // Ratios summary (latest year)
  const ratios = {
    current_ratio: latest.liquidity?.current_ratio || 0,
    debt_equity_ratio: latest.capital_structure?.debt_equity_ratio || 0,
    overall_gearing_incl: latest.capital_structure?.overall_gearing_incl || 0,
    overall_gearing_excl: latest.capital_structure?.overall_gearing_excl || 0,
    interest_coverage: latest.solvency?.interest_coverage_pbildt || 0,
    pbit_to_interest: latest.solvency?.pbit_to_interest || 0,
    tol_to_tnw: latest.capital_structure?.tol_to_tnw || 0,
    working_capital_turnover: latest.liquidity?.working_capital_turnover || 0,
    fixed_assets_turnover: latest.turnover?.fixed_assets_turnover || 0,
  };

  // Profitability summary
  const profitability = {
    gross_margin: latest.profitability?.gross_margin || 0,
    pbildt_margin: latest.profitability?.pbildt_margin || 0,
    pbit_margin: latest.profitability?.pbit_margin || 0,
    opbt_margin: latest.profitability?.opbt_margin || 0,
    opat_margin: latest.profitability?.opat_margin || 0,
    apat_margin: latest.profitability?.apat_margin || 0,
    operating_roce: latest.profitability?.operating_roce || 0,
    roce_total: latest.profitability?.roce_total || 0,
  };

  // Liquidity summary
  const liquidity = {
    current_ratio: latest.liquidity?.current_ratio || 0,
    working_capital_turnover: latest.liquidity?.working_capital_turnover || 0,
    avg_collection_period: latest.liquidity?.avg_collection_period || 0,
    avg_creditors_period: latest.liquidity?.avg_creditors_period || 0,
    working_capital_cycle: latest.liquidity?.working_capital_cycle || 0,
  };

  // Leverage summary
  const leverage = {
    debt_equity_ratio: latest.capital_structure?.debt_equity_ratio || 0,
    overall_gearing_incl: latest.capital_structure?.overall_gearing_incl || 0,
    overall_gearing_excl: latest.capital_structure?.overall_gearing_excl || 0,
    adjusted_overall_gearing: latest.capital_structure?.adjusted_overall_gearing || 0,
    avg_cost_of_borrowings: latest.capital_structure?.avg_cost_of_borrowings || 0,
    tol_to_tnw: latest.capital_structure?.tol_to_tnw || 0,
    term_debt_to_gca: latest.solvency?.term_debt_to_gca || 0,
    total_debt_to_gca: latest.solvency?.total_debt_to_gca || 0,
    interest_coverage: latest.solvency?.interest_coverage_pbildt || 0,
  };

  // Eligibility indicators
  const eligibility = computeEligibility(latestPL, latestBS, latest);

  // Derived metrics
  const derived_metrics = {
    net_working_capital: round(latestBS.total_current_assets_ops - latestBS.total_current_liabilities_ops, 2),
    total_debt: round(latestBS.total_long_term_debt + latestBS.total_short_term_debt, 2),
    gross_cash_accruals: round(latestPL.gross_cash_accruals, 2),
    total_operating_income: round(latestPL.total_operating_income, 2),
    cost_of_sales: round(latestPL.cost_of_sales, 2),
    opat: round(latestPL.opat, 2),
    total_receivables: round(latestBS.total_receivables, 2),
    total_short_term_debt: round(latestBS.total_short_term_debt, 2),
  };

  // Growth (latest vs previous)
  const growth = latest.growth || {
    growth_net_sales: 0,
    growth_total_operating_income: 0,
    growth_pbildt: 0,
    growth_apat: 0,
  };

  // 4. Final structured output
  const output = sanitiseOutput({
    meta: {
      company_name: sanitised.company_name || null,
      gstin: sanitised.gstin || null,
      case_id: sanitised.case_id || null,
      computed_at: new Date().toISOString(),
      engine_version: '1.0.0',
      years_count: computedYears.length,
    },
    years: computedYears,
    ratios,
    profitability,
    liquidity,
    leverage,
    eligibility,
    growth,
    derived_metrics,
  });

  return {
    success: true,
    data: output,
    warnings: errors.length > 0 ? errors : undefined,
  };
}

// ─── ELIGIBILITY COMPUTATIONS ────────────────────────────────────────────────

function computeEligibility(pl, bs, computed) {
  const netWorth = bs.tangible_net_worth;
  const totalDebt = bs.total_long_term_debt + bs.total_short_term_debt;
  const gca = pl.gross_cash_accruals;
  const interestCoverage = computed.solvency?.interest_coverage_pbildt || 0;
  const deRatio = computed.capital_structure?.debt_equity_ratio || 0;
  const currentRatio = computed.liquidity?.current_ratio || 0;

  // MSME Credit eligibility benchmarks
  const flags = {
    positive_net_worth: netWorth > 0,
    de_ratio_within_limit: deRatio <= 4,
    interest_coverage_adequate: interestCoverage >= 1.25,
    current_ratio_adequate: currentRatio >= 1.0,
    positive_cash_accruals: gca > 0,
    profitable: pl.apat > 0,
  };

  const score = Object.values(flags).filter(Boolean).length;
  const max_score = Object.keys(flags).length;

  let grade = 'POOR';
  if (score >= 6) grade = 'EXCELLENT';
  else if (score >= 5) grade = 'GOOD';
  else if (score >= 4) grade = 'SATISFACTORY';
  else if (score >= 3) grade = 'MARGINAL';

  // Max eligible term loan (heuristic: 4x GCA if profitable, else 2x)
  const max_term_loan = round(gca * (pl.apat > 0 ? 4 : 2), 2);

  // Max eligible working capital (heuristic: 25% of net sales)
  const max_working_capital = round(pl.net_sales * 0.25, 2);

  return {
    flags,
    score,
    max_score,
    grade,
    max_term_loan_indicative: max_term_loan,
    max_working_capital_indicative: max_working_capital,
    net_worth: round(netWorth, 2),
    total_debt: round(totalDebt, 2),
  };
}

/**
 * Get the schema of expected input fields.
 * Useful for dashboard to know what fields to render.
 */
export function getInputSchema() {
  return {
    metadata_fields: [
      { key: 'period_ends_on', type: 'string', label: 'Period Ends On', required: true },
      { key: 'result_type', type: 'string', label: 'Result Type', default: 'AUDITED' },
      { key: 'auditor_qualification', type: 'string', label: 'Auditor Qualification', default: '' },
      { key: 'no_of_months', type: 'number', label: 'No. of Months in FY', default: 12 },
    ],
    financial_fields: ALL_INPUT_FIELDS.map(f => ({
      key: f.key,
      label: f.label,
      type: 'number',
      default: 0,
      row: f.row,
    })),
    sections: {
      profitability_statement: { start_key: 'net_sales', end_key: 'apat', label: 'Profitability Statement' },
      balance_sheet_assets: { start_key: 'gross_block', end_key: 'total_assets', label: 'Balance Sheet: Assets' },
      balance_sheet_liabilities: { start_key: 'paid_up_equity_share_capital', end_key: 'total_liabilities', label: 'Balance Sheet: Liabilities' },
    },
  };
}
