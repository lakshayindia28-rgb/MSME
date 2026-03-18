/**
 * Financial Engine — Main API
 * ============================
 * Entry point: calculateFinancials(inputData) → FinancialOutput
 *
 * Input shape:
 * {
 *   company_name?: string, gstin?: string, case_id?: string,
 *   years: [ { period_ends_on, result_type, auditor_qualification, no_of_months, ...fields }, ... ]
 * }
 *
 * Two-pass computation:
 *   Pass 1 — P&L and Balance Sheet for every year (independent)
 *   Pass 2 — Ratios that need cross-year references (liquidity / turnover averaging)
 */

import { validateInput, sanitiseOutput, round, safeDivide } from './validation.js';
import {
  computeProfitLoss,
  computeBalanceSheet,
  computeLiquidityRatios,
  computeCapitalStructure,
  computeGrowthRatios,
  computeProfitabilityRatios,
  computeTurnoverRatios,
  computeSolvencyRatios,
} from './calculationEngine.js';
import { ALL_FIELDS, ALL_INPUT_FIELDS, METADATA_INPUTS } from './constants.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PRIMARY API
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateFinancials(inputData) {
  // 1. Validate & sanitise
  const { valid, errors, sanitised } = validateInput(inputData);
  if (!valid && !sanitised.years?.length) {
    return { success: false, errors };
  }

  const years = sanitised.years;   // newest-first: [Y1, Y2, Y3]

  // 2. Two-pass computation
  //    Reverse to oldest-first for natural prev→next ordering
  const reversed = [...years].reverse();          // [Y3, Y2, Y1]

  // Pass 1: P&L + BS (independent per year)
  const allPL = reversed.map(y => computeProfitLoss(y));
  const allBS = reversed.map(y => computeBalanceSheet(y));

  // Pass 2: Ratios (need cross-year refs)
  const reversedResults = reversed.map((_yearInput, i) => {
    const pl = allPL[i];
    const bs = allBS[i];

    // Growth: compare to previous (older) year = i-1
    const prevPL = i > 0 ? allPL[i - 1] : null;

    // Averaging formulas: use the older year's BS = i-1
    const nextBS = i > 0 ? allBS[i - 1] : null;

    const liquidity        = computeLiquidityRatios(pl, bs, nextBS);
    const capitalStructure = computeCapitalStructure(pl, bs);
    const growth           = computeGrowthRatios(pl, prevPL);
    const profitability    = computeProfitabilityRatios(pl, bs);
    const turnover         = computeTurnoverRatios(pl, bs, nextBS);
    const solvency         = computeSolvencyRatios(pl, bs, capitalStructure);

    return { profit_and_loss: pl, balance_sheet: bs, liquidity, capital_structure: capitalStructure, growth, profitability, turnover, solvency };
  });

  // Re-reverse to newest-first
  const finalResults = reversedResults.reverse();

  // 3. Build structured year array
  const computedYears = years.map((y, i) => ({
    period: y.period_ends_on || `Year ${i + 1}`,
    result_type: y.result_type || 'AUDITED',
    auditor_qualification: y.auditor_qualification || '',
    no_of_months: y.no_of_months || 12,
    input: y,
    computed: finalResults[i],
  }));

  // 4. Aggregated summaries (latest year = index 0)
  const latest   = finalResults[0] || {};
  const latestPL = latest.profit_and_loss || {};
  const latestBS = latest.balance_sheet   || {};

  const ratios = {
    current_ratio:            latest.liquidity?.current_ratio || 0,
    debt_equity_ratio:        latest.capital_structure?.debt_equity_ratio || 0,
    overall_gearing_incl:     latest.capital_structure?.overall_gearing_incl || 0,
    overall_gearing_excl:     latest.capital_structure?.overall_gearing_excl || 0,
    interest_coverage:        latest.solvency?.interest_coverage_pbildt || 0,
    pbit_to_interest:         latest.solvency?.pbit_to_interest || 0,
    tol_to_tnw:               latest.capital_structure?.tol_to_tnw || 0,
    working_capital_turnover:  latest.liquidity?.working_capital_turnover || 0,
    fixed_assets_turnover:     latest.turnover?.fixed_assets_turnover || 0,
  };

  const profitability = {
    gross_margin:    latest.profitability?.gross_margin || 0,
    pbildt_margin:   latest.profitability?.pbildt_margin || 0,
    pbit_margin:     latest.profitability?.pbit_margin || 0,
    opbt_margin:     latest.profitability?.opbt_margin || 0,
    opat_margin:     latest.profitability?.opat_margin || 0,
    apat_margin:     latest.profitability?.apat_margin || 0,
    operating_roce:  latest.profitability?.operating_roce || 0,
    roce_total:      latest.profitability?.roce_total || 0,
  };

  const liquidity = {
    current_ratio:            latest.liquidity?.current_ratio || 0,
    working_capital_turnover: latest.liquidity?.working_capital_turnover || 0,
    avg_collection_period:    latest.liquidity?.avg_collection_period || 0,
    avg_creditors_period:     latest.liquidity?.avg_creditors_period || 0,
    working_capital_cycle:    latest.liquidity?.working_capital_cycle || 0,
  };

  const leverage = {
    debt_equity_ratio:        latest.capital_structure?.debt_equity_ratio || 0,
    overall_gearing_incl:     latest.capital_structure?.overall_gearing_incl || 0,
    overall_gearing_excl:     latest.capital_structure?.overall_gearing_excl || 0,
    adjusted_overall_gearing: latest.capital_structure?.adjusted_overall_gearing || 0,
    avg_cost_of_borrowings:   latest.capital_structure?.avg_cost_of_borrowings || 0,
    tol_to_tnw:               latest.capital_structure?.tol_to_tnw || 0,
    term_debt_to_gca:         latest.solvency?.term_debt_to_gca || 0,
    total_debt_to_gca:        latest.solvency?.total_debt_to_gca || 0,
    interest_coverage:        latest.solvency?.interest_coverage_pbildt || 0,
  };

  const eligibility = computeEligibility(latestPL, latestBS, latest);

  const derived_metrics = {
    net_working_capital:      round(latestBS.total_current_assets_ops - latestBS.total_current_liabilities_ops, 2),
    total_debt:               round(latestBS.total_long_term_debt + latestBS.total_short_term_debt, 2),
    gross_cash_accruals:      round(latestPL.gross_cash_accruals, 2),
    total_operating_income:   round(latestPL.total_operating_income, 2),
    cost_of_sales:            round(latestPL.cost_of_sales, 2),
    pat:                      round(latestPL.pat, 2),
    total_receivables:        round(latestBS.total_receivables, 2),
    total_short_term_debt:    round(latestBS.total_short_term_debt, 2),
  };

  const growth = latest.growth || { growth_net_sales: 0, growth_total_operating_income: 0, growth_pbildt: 0, growth_apat: 0 };

  const output = sanitiseOutput({
    meta: {
      company_name: sanitised.company_name || null,
      gstin: sanitised.gstin || null,
      case_id: sanitised.case_id || null,
      computed_at: new Date().toISOString(),
      engine_version: '2.0.0',
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

  return { success: true, data: output, warnings: errors.length > 0 ? errors : undefined };
}

// ─── ELIGIBILITY ─────────────────────────────────────────────────────────────

function computeEligibility(pl, bs, computed) {
  const netWorth        = bs.tangible_net_worth || 0;
  const totalDebt       = (bs.total_long_term_debt || 0) + (bs.total_short_term_debt || 0);
  const gca             = pl.gross_cash_accruals || 0;
  const interestCoverage = computed.solvency?.interest_coverage_pbildt || 0;
  const deRatio         = computed.capital_structure?.debt_equity_ratio || 0;
  const currentRatio    = computed.liquidity?.current_ratio || 0;

  const flags = {
    positive_net_worth:        netWorth > 0,
    de_ratio_within_limit:     deRatio <= 4,
    interest_coverage_adequate: interestCoverage >= 1.25,
    current_ratio_adequate:    currentRatio >= 1.0,
    positive_cash_accruals:    gca > 0,
    profitable:                (pl.pat || 0) > 0,
  };

  const score     = Object.values(flags).filter(Boolean).length;
  const max_score = Object.keys(flags).length;

  let grade = 'POOR';
  if (score >= 6)      grade = 'EXCELLENT';
  else if (score >= 5) grade = 'GOOD';
  else if (score >= 4) grade = 'SATISFACTORY';
  else if (score >= 3) grade = 'MARGINAL';

  return {
    flags, score, max_score, grade,
    max_term_loan_indicative:       round(gca * ((pl.pat || 0) > 0 ? 4 : 2), 2),
    max_working_capital_indicative: round((pl.net_sales || 0) * 0.25, 2),
    net_worth:  round(netWorth, 2),
    total_debt: round(totalDebt, 2),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

export function getInputSchema() {
  return {
    metadata_fields: METADATA_INPUTS.map(f => ({
      key: f.key, label: f.label, type: f.type || 'string', default: f.default || '',
    })),
    financial_fields: ALL_FIELDS.map(f => ({
      key: f.key,
      label: f.label,
      type: 'number',
      default: 0,
      row: f.row,
      computed: !!f.computed,
    })),
    sections: {
      profitability_statement:    { start_key: 'net_sales',                    end_key: 'gross_cash_accruals',  label: 'Profitability Statement' },
      balance_sheet_assets:       { start_key: 'gross_block',                  end_key: 'total_assets',         label: 'Balance Sheet: Assets' },
      balance_sheet_liabilities:  { start_key: 'paid_up_equity_share_capital', end_key: 'total_liabilities',    label: 'Balance Sheet: Liabilities' },
    },
  };
}
