export const DECISION_DICTIONARY = {
  LIQ_LOW: 'Weak liquidity position',
  REC_HIGH: 'Slow debtor realization',
  PROF_LOW: 'Low profitability',
  REL_DERIVED: 'Data derived from financial statement not tax return',
  REL_DECLARED: 'Data is primarily declared and not fully tax-verified',
  AUTH_CRITICAL: 'Critical document authenticity concern',
  LEV_HIGH: 'Leverage is elevated versus policy thresholds',
  DECLARED_DATA_WITH_WEAK_LIQUIDITY: 'Declared-only reliability with weak liquidity requires manual review',
  MULTI_YEAR_DECLINE: 'Multi-year decline pattern indicates elevated underwriting risk',
  STABLE_GROWTH_POSITIVE_NETWORTH: 'Stable growth and positive net worth support decision confidence'
};

export function explainDecisionCodes(codes = []) {
  if (!Array.isArray(codes)) return [];
  return [...new Set(codes.map((code) => String(code || '').trim()).filter(Boolean))].map((code) => ({
    code,
    explanation: DECISION_DICTIONARY[code] || 'No dictionary description available for this decision code.'
  }));
}

export default DECISION_DICTIONARY;
