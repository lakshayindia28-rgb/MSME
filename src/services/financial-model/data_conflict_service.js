function safeNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pctDiff(a, b) {
  if (a == null || b == null || b === 0) return null;
  return Math.abs((a - b) / b) * 100;
}

export class DataConflictService {
  analyze({ itrFinancials = null, extractedFinancials = {} } = {}) {
    const itr = itrFinancials && typeof itrFinancials === 'object' ? itrFinancials : {};

    const itrRevenue = safeNumber(itr?.revenue ?? itr?.turnover ?? itr?.declared_turnover ?? null);
    const itrProfit = safeNumber(itr?.net_profit ?? itr?.profit ?? null);
    const itrTaxPaid = safeNumber(itr?.tax_paid ?? itr?.income_tax_paid ?? null);

    const fsRevenue = safeNumber(extractedFinancials?.revenue);
    const fsProfit = safeNumber(extractedFinancials?.net_profit);

    const revenueDiff = pctDiff(fsRevenue, itrRevenue);
    const profitDiff = pctDiff(fsProfit, itrProfit);

    const observations = [];

    if (profitDiff != null && profitDiff > 5) {
      observations.push(`Profit mismatch observed between ITR and P&L at ${profitDiff.toFixed(2)}%.`);
    }

    if (revenueDiff != null && revenueDiff > 5) {
      observations.push(`Revenue mismatch exceeds 5% (observed ${revenueDiff.toFixed(2)}%).`);
    }

    if (itrTaxPaid != null && fsProfit != null && fsProfit > 0) {
      const impliedTaxRate = (itrTaxPaid / fsProfit) * 100;
      if (impliedTaxRate < 10 || impliedTaxRate > 45) {
        observations.push(`Tax paid appears inconsistent with reported profit (implied tax rate ${impliedTaxRate.toFixed(2)}%).`);
      }
    }

    const paragraph = observations.length
      ? `Accounting observations: ${observations.join(' ')}`
      : 'Accounting observations: No material conflicts detected between available ITR values and financial statements.';

    return {
      observations,
      paragraph,
      revenue_difference_pct: revenueDiff != null ? Number(revenueDiff.toFixed(6)) : null,
      profit_difference_pct: profitDiff != null ? Number(profitDiff.toFixed(6)) : null
    };
  }
}

export default DataConflictService;
