/**
 * Financial Engine — Report Mapper
 * =================================
 * Maps calculateFinancials() output → MSME Report Section
 * For insertion into the existing report JSON pipeline.
 */

import { round } from './validation.js';

/**
 * Convert financial engine output into a structured MSME report section.
 * @param {object} financialOutput  — the .data property from calculateFinancials()
 * @returns {object} MSME report section
 */
export function mapFinancialsToReport(financialOutput) {
  if (!financialOutput) return null;

  const meta = financialOutput.meta || {};
  const years = financialOutput.years || [];
  const latest = years[0]?.computed || {};
  const latestPL = latest.profit_and_loss || {};
  const latestBS = latest.balance_sheet || {};

  return {
    section: 'financial_analysis',
    generated_at: meta.computed_at,
    engine_version: meta.engine_version,
    company: {
      name: meta.company_name,
      gstin: meta.gstin,
    },

    // ─── INCOME STATEMENT SUMMARY ──────────────────────────────────────
    income_statement: years.map(y => ({
      period: y.period,
      result_type: y.result_type,
      net_sales: round(y.computed?.profit_and_loss?.net_sales || 0, 2),
      total_operating_income: round(y.computed?.profit_and_loss?.total_operating_income || 0, 2),
      cost_of_sales: round(y.computed?.profit_and_loss?.cost_of_sales || 0, 2),
      pbildt: round(y.computed?.profit_and_loss?.pbildt || 0, 2),
      depreciation: round(y.computed?.profit_and_loss?.depreciation || 0, 2),
      pbit: round(y.computed?.profit_and_loss?.pbit || 0, 2),
      interest_charges: round(y.computed?.profit_and_loss?.interest_and_finance_charges || 0, 2),
      opbt: round(y.computed?.profit_and_loss?.opbt || 0, 2),
      tax: round(y.computed?.profit_and_loss?.tax || 0, 2),
      apat: round(y.computed?.profit_and_loss?.apat || 0, 2),
      gross_cash_accruals: round(y.computed?.profit_and_loss?.gross_cash_accruals || 0, 2),
    })),

    // ─── BALANCE SHEET SUMMARY ─────────────────────────────────────────
    balance_sheet: years.map(y => ({
      period: y.period,
      net_fixed_assets: round(y.computed?.balance_sheet?.net_fixed_assets || 0, 2),
      total_investments: round(y.computed?.balance_sheet?.total_investments || 0, 2),
      total_receivables: round(y.computed?.balance_sheet?.total_receivables || 0, 2),
      total_current_assets: round(y.computed?.balance_sheet?.total_current_assets_ops || 0, 2),
      total_assets: round(y.computed?.balance_sheet?.total_assets || 0, 2),
      equity_capital: round(y.computed?.balance_sheet?.paid_up_equity_share_capital || 0, 2),
      tangible_net_worth: round(y.computed?.balance_sheet?.tangible_net_worth || 0, 2),
      total_long_term_debt: round(y.computed?.balance_sheet?.total_long_term_debt || 0, 2),
      total_short_term_debt: round(y.computed?.balance_sheet?.total_short_term_debt || 0, 2),
      total_outside_liabilities: round(y.computed?.balance_sheet?.total_outside_liabilities || 0, 2),
      total_liabilities: round(y.computed?.balance_sheet?.total_liabilities || 0, 2),
    })),

    // ─── KEY RATIOS ────────────────────────────────────────────────────
    key_ratios: {
      current: financialOutput.ratios || {},
      profitability: financialOutput.profitability || {},
      liquidity: financialOutput.liquidity || {},
      leverage: financialOutput.leverage || {},
      growth: financialOutput.growth || {},
      turnover: years.map(y => ({
        period: y.period,
        ...y.computed?.turnover || {},
      })),
      solvency: years.map(y => ({
        period: y.period,
        ...y.computed?.solvency || {},
      })),
    },

    // ─── CREDIT ELIGIBILITY ────────────────────────────────────────────
    eligibility: financialOutput.eligibility || {},

    // ─── DERIVED METRICS ───────────────────────────────────────────────
    derived_metrics: financialOutput.derived_metrics || {},

    // ─── TREND DATA (year-over-year for charts) ────────────────────────
    trends: {
      net_sales: years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.net_sales || 0 })),
      pbildt: years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.pbildt || 0 })),
      apat: years.map(y => ({ period: y.period, value: y.computed?.profit_and_loss?.apat || 0 })),
      current_ratio: years.map(y => ({ period: y.period, value: y.computed?.liquidity?.current_ratio || 0 })),
      de_ratio: years.map(y => ({ period: y.period, value: y.computed?.capital_structure?.debt_equity_ratio || 0 })),
      interest_coverage: years.map(y => ({ period: y.period, value: y.computed?.solvency?.interest_coverage_pbildt || 0 })),
    },
  };
}
