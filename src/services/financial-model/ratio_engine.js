function safeDivide(numerator, denominator) {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function rounded(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

export class RatioEngine {
  compute(financials = {}) {
    const revenue = financials.revenue ?? null;
    const cogs = financials.cogs ?? null;
    const grossProfit = financials.gross_profit ?? null;
    const netProfit = financials.net_profit ?? null;
    const totalAssets = financials.total_assets ?? null;
    const currentAssets = financials.current_assets ?? null;
    const inventory = financials.inventory ?? null;
    const receivables = financials.receivables ?? null;
    const currentLiabilities = financials.current_liabilities ?? null;
    const longTermDebt = financials.long_term_debt ?? null;
    const equity = financials.equity ?? null;

    const currentRatio = safeDivide(currentAssets, currentLiabilities);
    const quickRatio = safeDivide(
      currentAssets == null || inventory == null ? null : currentAssets - inventory,
      currentLiabilities
    );

    return {
      gross_profit_margin: rounded(safeDivide(grossProfit, revenue)),
      net_profit_margin: rounded(safeDivide(netProfit, revenue)),
      roa: rounded(safeDivide(netProfit, totalAssets)),
      current_ratio: rounded(currentRatio),
      quick_ratio: rounded(quickRatio),
      working_capital: currentAssets == null || currentLiabilities == null
        ? null
        : rounded(currentAssets - currentLiabilities),
      debt_equity: rounded(safeDivide(longTermDebt, equity)),
      inventory_turnover: rounded(safeDivide(cogs, inventory)),
      debtor_days: rounded(safeDivide(receivables, revenue) == null ? null : safeDivide(receivables, revenue) * 365)
    };
  }
}

export default RatioEngine;