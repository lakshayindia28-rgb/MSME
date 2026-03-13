function safeNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeDivide(num, den) {
  if (num == null || den == null || den === 0) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den)) return null;
  return num / den;
}

function classifyGrowth(revenueGrowth, profitGrowth) {
  const rg = revenueGrowth ?? 0;
  const pg = profitGrowth ?? 0;
  if (rg > 0.05 && pg > 0.05) return 'GROWING';
  if (rg < -0.05 || pg < -0.05) return 'DECLINING';
  return 'STABLE';
}

function classifyEarningsConsistency(revenueGrowth, profitGrowth) {
  if (revenueGrowth == null || profitGrowth == null) return 'CONSISTENT';
  const spread = Math.abs(revenueGrowth - profitGrowth);
  return spread > 0.2 ? 'VOLATILE' : 'CONSISTENT';
}

function classifyCollectionBehavior(receivableChange) {
  if (receivableChange == null) return 'IMPROVING';
  return receivableChange <= 0 ? 'IMPROVING' : 'DETERIORATING';
}

export class TrendAnalysisService {
  analyze({ currentFinancials = {}, previousFinancials = null, currentRatios = {}, previousRatios = null } = {}) {
    const currentRevenue = safeNumber(currentFinancials?.revenue);
    const previousRevenue = safeNumber(previousFinancials?.revenue);
    const currentProfit = safeNumber(currentFinancials?.net_profit);
    const previousProfit = safeNumber(previousFinancials?.net_profit);

    const revenueGrowth = safeDivide(
      currentRevenue != null && previousRevenue != null ? currentRevenue - previousRevenue : null,
      previousRevenue
    );
    const profitGrowth = safeDivide(
      currentProfit != null && previousProfit != null ? currentProfit - previousProfit : null,
      previousProfit
    );

    const currentDebtorDays = safeNumber(currentRatios?.debtor_days);
    const previousDebtorDays = safeNumber(previousRatios?.debtor_days);
    const receivableChange =
      currentDebtorDays != null && previousDebtorDays != null
        ? Number((currentDebtorDays - previousDebtorDays).toFixed(6))
        : null;

    const growthStatus = classifyGrowth(revenueGrowth, profitGrowth);
    const earningsConsistency = classifyEarningsConsistency(revenueGrowth, profitGrowth);
    const collectionBehavior = classifyCollectionBehavior(receivableChange);

    const bothDeclining = (revenueGrowth ?? 0) < -0.05 && (profitGrowth ?? 0) < -0.05;
    const declineStreakYears = bothDeclining ? 2 : growthStatus === 'DECLINING' ? 1 : 0;

    return {
      growth_status: growthStatus,
      earnings_consistency: earningsConsistency,
      collection_behavior: collectionBehavior,
      revenue_growth: revenueGrowth != null ? Number(revenueGrowth.toFixed(6)) : null,
      profit_growth: profitGrowth != null ? Number(profitGrowth.toFixed(6)) : null,
      receivable_change: receivableChange,
      decline_streak_years: declineStreakYears
    };
  }
}

export default TrendAnalysisService;
