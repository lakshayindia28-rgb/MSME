function fmt(value) {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 6 });
}

function buildEntry({ ratio, formula, substitutedValues, result }) {
  const substituted = String(substitutedValues || '').trim();
  const finalResult = result == null || !Number.isFinite(result) ? null : Number(result.toFixed(6));
  return {
    ratio,
    formula,
    substituted_values: substituted,
    result: finalResult
  };
}

export class CalculationAuditService {
  build({ financials = {}, ratios = {} } = {}) {
    const currentAssets = financials.current_assets;
    const currentLiabilities = financials.current_liabilities;
    const inventory = financials.inventory;
    const revenue = financials.revenue;
    const netProfit = financials.net_profit;
    const totalAssets = financials.total_assets;
    const longTermDebt = financials.long_term_debt;
    const equity = financials.equity;
    const cogs = financials.cogs;
    const receivables = financials.receivables;

    return {
      gross_profit_margin: buildEntry({
        ratio: 'gross_profit_margin',
        formula: 'gross_profit / revenue',
        substitutedValues: `${fmt(financials.gross_profit)} / ${fmt(revenue)}`,
        result: ratios.gross_profit_margin
      }),
      net_profit_margin: buildEntry({
        ratio: 'net_profit_margin',
        formula: 'net_profit / revenue',
        substitutedValues: `${fmt(netProfit)} / ${fmt(revenue)}`,
        result: ratios.net_profit_margin
      }),
      roa: buildEntry({
        ratio: 'roa',
        formula: 'net_profit / total_assets',
        substitutedValues: `${fmt(netProfit)} / ${fmt(totalAssets)}`,
        result: ratios.roa
      }),
      current_ratio: buildEntry({
        ratio: 'current_ratio',
        formula: 'current_assets / current_liabilities',
        substitutedValues: `${fmt(currentAssets)} / ${fmt(currentLiabilities)}`,
        result: ratios.current_ratio
      }),
      quick_ratio: buildEntry({
        ratio: 'quick_ratio',
        formula: '(current_assets - inventory) / current_liabilities',
        substitutedValues: `(${fmt(currentAssets)} - ${fmt(inventory)}) / ${fmt(currentLiabilities)}`,
        result: ratios.quick_ratio
      }),
      working_capital: buildEntry({
        ratio: 'working_capital',
        formula: 'current_assets - current_liabilities',
        substitutedValues: `${fmt(currentAssets)} - ${fmt(currentLiabilities)}`,
        result: ratios.working_capital
      }),
      debt_equity: buildEntry({
        ratio: 'debt_equity',
        formula: 'long_term_debt / equity',
        substitutedValues: `${fmt(longTermDebt)} / ${fmt(equity)}`,
        result: ratios.debt_equity
      }),
      inventory_turnover: buildEntry({
        ratio: 'inventory_turnover',
        formula: 'cogs / inventory',
        substitutedValues: `${fmt(cogs)} / ${fmt(inventory)}`,
        result: ratios.inventory_turnover
      }),
      debtor_days: buildEntry({
        ratio: 'debtor_days',
        formula: '(receivables / revenue) * 365',
        substitutedValues: `(${fmt(receivables)} / ${fmt(revenue)}) * 365`,
        result: ratios.debtor_days
      })
    };
  }
}

export default CalculationAuditService;
