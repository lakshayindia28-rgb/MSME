/**
 * Financial Engine — Report Mapper
 * =================================
 * Maps calculateFinancials() output → MSME Report Section
 */

import { round } from './validation.js';

export function mapFinancialsToReport(financialOutput) {
  if (!financialOutput) return null;

  const meta  = financialOutput.meta  || {};
  const years = financialOutput.years || [];

  return {
    section: 'financial_analysis',
    generated_at: meta.computed_at,
    engine_version: meta.engine_version,
    company: { name: meta.company_name, gstin: meta.gstin },

    // ─── INCOME STATEMENT SUMMARY ──────────────────────────────────────
    income_statement: years.map(y => {
      const pl = y.computed?.profit_and_loss || {};
      return {
        period: y.period,
        result_type: y.result_type,
        net_sales:               round(pl.net_sales || 0, 2),
        total_operating_income:  round(pl.total_operating_income || 0, 2),
        cost_of_sales:           round(pl.cost_of_sales || 0, 2),
        pbildt:                  round(pl.pbildt || 0, 2),
        depreciation:            round(pl.depreciation || 0, 2),
        pbit:                    round(pl.pbit || 0, 2),
        interest_charges:        round(pl.interest_and_finance_charges || 0, 2),
        opbt:                    round(pl.opbt || 0, 2),
        tax:                     round(pl.current_tax || 0, 2),
        pat:                     round(pl.pat || 0, 2),
        gross_cash_accruals:     round(pl.gross_cash_accruals || 0, 2),
      };
    }),

    // ─── BALANCE SHEET SUMMARY ─────────────────────────────────────────
    balance_sheet: years.map(y => {
      const bs = y.computed?.balance_sheet || {};
      return {
        period: y.period,
        net_fixed_assets:         round(bs.net_fixed_assets || 0, 2),
        non_current_assets:       round(bs.non_current_assets || 0, 2),
        total_receivables:        round(bs.total_receivables || 0, 2),
        total_current_assets:     round(bs.total_current_assets_ops || 0, 2),
        total_assets:             round(bs.total_assets || 0, 2),
        equity_capital:           round(bs.paid_up_equity_share_capital || 0, 2),
        tangible_net_worth:       round(bs.tangible_net_worth || 0, 2),
        total_long_term_debt:     round(bs.total_long_term_debt || 0, 2),
        total_short_term_debt:    round(bs.total_short_term_debt || 0, 2),
        total_outside_liabilities: round(bs.total_outside_liabilities || 0, 2),
        total_liabilities:        round(bs.total_liabilities || 0, 2),
      };
    }),

    // ─── KEY RATIOS ────────────────────────────────────────────────────
    key_ratios: {
      current:       financialOutput.ratios || {},
      profitability: financialOutput.profitability || {},
      liquidity:     financialOutput.liquidity || {},
      leverage:      financialOutput.leverage || {},
      growth:        financialOutput.growth || {},
      turnover: years.map(y => ({ period: y.period, ...y.computed?.turnover || {} })),
      solvency: years.map(y => ({ period: y.period, ...y.computed?.solvency || {} })),
    },

    // ─── CREDIT ELIGIBILITY ────────────────────────────────────────────
    eligibility: financialOutput.eligibility || {},

    // ─── DERIVED METRICS ───────────────────────────────────────────────
    derived_metrics: financialOutput.derived_metrics || {},

    // ─── TREND DATA (for charts) ──────────────────────────────────────
    trends: {
      net_sales:         years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.net_sales || 0 })),
      pbildt:            years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.pbildt || 0 })),
      pat:               years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.pat || 0 })),
      current_ratio:     years.map(y => ({ period: y.period, value: y.computed?.liquidity?.current_ratio || 0 })),
      de_ratio:          years.map(y => ({ period: y.period, value: y.computed?.capital_structure?.debt_equity_ratio || 0 })),
      interest_coverage: years.map(y => ({ period: y.period, value: y.computed?.solvency?.interest_coverage_pbildt || 0 })),
    },
  };
}
