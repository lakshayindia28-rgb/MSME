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

export class DataReliabilityService {
  assess({ itrFinancials = null, extractedFinancials = {} } = {}) {
    const itr = itrFinancials && typeof itrFinancials === 'object' ? itrFinancials : {};
    const fsRevenue = safeNumber(extractedFinancials?.revenue);
    const fsProfit = safeNumber(extractedFinancials?.net_profit);

    const itrRevenue = safeNumber(itr?.revenue ?? itr?.turnover ?? itr?.declared_turnover ?? null);
    const itrProfit = safeNumber(itr?.net_profit ?? itr?.profit ?? null);

    const revenueDifferencePct = pctDiff(fsRevenue, itrRevenue);

    if (revenueDifferencePct != null && revenueDifferencePct < 5) {
      return {
        reliability_level: 'VERIFIED',
        confidence_score: 90,
        warning_message: 'ITR and financial statement revenue are aligned within 5% variance.'
      };
    }

    if (itrProfit == null && fsProfit != null) {
      return {
        reliability_level: 'DERIVED',
        confidence_score: 72,
        warning_message: 'Profit is not available in ITR and has been derived from financial statements.'
      };
    }

    if (itrRevenue != null) {
      return {
        reliability_level: 'DECLARED',
        confidence_score: 58,
        warning_message: 'Only declared turnover is available from ITR; deeper verification is recommended.'
      };
    }

    return {
      reliability_level: 'DECLARED',
      confidence_score: 50,
      warning_message: 'ITR financial data is unavailable; assessment uses declared or statement-level values only.'
    };
  }
}

export default DataReliabilityService;
