export class RiskEngine {
  evaluate({
    ratios = {},
    extractedFinancials = {},
    companyProfile = {},
    authenticityCheck = {},
    trendAnalysis = {},
    dataReliability = {}
  } = {}) {
    const flags = [];
    const ruleEvaluations = [];
    const decisionReasonCodes = [];
    let score = 100;

    const mark = ({ passed, code, severity = 'LOW', reason, decisionCode = null }) => {
      ruleEvaluations.push({ code, passed, severity, reason });
      if (passed) return;
      flags.push({ code, severity, reason });
      if (decisionCode) decisionReasonCodes.push(decisionCode);
      score -= severity === 'HIGH' ? 22 : severity === 'MEDIUM' ? 12 : 6;
    };

    const authenticityStatus = String(authenticityCheck?.authenticity_status || 'UNKNOWN').toUpperCase();
    const isCriticalAuthenticity = authenticityStatus === 'TAMPERED_CRITICAL';

    mark({
      code: 'AUTHENTICITY_GATE',
      passed: !isCriticalAuthenticity,
      severity: 'HIGH',
      reason: `Authenticity status is ${authenticityStatus}.`,
      decisionCode: 'AUTHENTICITY_CRITICAL'
    });

    mark({
      code: 'LIQUIDITY_CHECK',
      passed: ratios.current_ratio == null || ratios.current_ratio >= 1,
      severity: 'HIGH',
      reason: `Current ratio ${ratios.current_ratio ?? 'N/A'} should be at least 1.00.`,
      decisionCode: 'LIQUIDITY_WEAK'
    });

    mark({
      code: 'WORKING_CAPITAL_CHECK',
      passed: ratios.working_capital == null || ratios.working_capital >= 0,
      severity: 'HIGH',
      reason: `Working capital is ${ratios.working_capital ?? 'N/A'} and should be non-negative.`,
      decisionCode: 'WORKING_CAPITAL_STRESS'
    });

    mark({
      code: 'PROFITABILITY_CHECK',
      passed: ratios.net_profit_margin == null || ratios.net_profit_margin >= 0.02,
      severity: 'MEDIUM',
      reason: `Net profit margin ${(ratios.net_profit_margin != null ? (ratios.net_profit_margin * 100).toFixed(2) : 'N/A')}% is below 2.00% threshold.`,
      decisionCode: 'PROFITABILITY_WEAK'
    });

    mark({
      code: 'COLLECTION_CHECK',
      passed: ratios.debtor_days == null || ratios.debtor_days <= 90,
      severity: 'MEDIUM',
      reason: `Debtor days ${ratios.debtor_days ?? 'N/A'} exceed 90 days threshold.`,
      decisionCode: 'COLLECTION_DELAY'
    });

    const companyType = companyProfile?.company_type || 'TRADING_COMPANY';

    if (companyType === 'SERVICE_COMPANY') {
      const inventoryShare = companyProfile?.inventory_to_revenue_ratio;
      mark({
        code: 'SERVICE_INVENTORY_DISCIPLINE',
        passed: inventoryShare == null || inventoryShare < 0.15,
        severity: 'MEDIUM',
        reason: `Service companies should maintain low inventory share; observed ratio ${inventoryShare ?? 'N/A'}.`,
        decisionCode: 'SERVICE_PROFILE_MISMATCH'
      });
    } else {
      mark({
        code: 'TRADING_INVENTORY_TURNOVER',
        passed: ratios.inventory_turnover == null || ratios.inventory_turnover >= 2,
        severity: 'MEDIUM',
        reason: `Trading companies should maintain inventory turnover >= 2.00; observed ${ratios.inventory_turnover ?? 'N/A'}.`,
        decisionCode: 'TURNOVER_EFFICIENCY_WEAK'
      });

      const grossMargin = ratios.gross_profit_margin;
      mark({
        code: 'TRADING_GROSS_MARGIN',
        passed: grossMargin == null || grossMargin >= 0.08,
        severity: 'MEDIUM',
        reason: `Trading gross margin ${(grossMargin != null ? (grossMargin * 100).toFixed(2) : 'N/A')}% is below 8.00%.`,
        decisionCode: 'TRADING_MARGIN_WEAK'
      });
    }

    mark({
      code: 'LEVERAGE_CHECK',
      passed: ratios.debt_equity == null || ratios.debt_equity <= 2,
      severity: 'MEDIUM',
      reason: `Debt-equity ratio ${ratios.debt_equity ?? 'N/A'} exceeds 2.00 threshold.`,
      decisionCode: 'LEVERAGE_HIGH'
    });

    const reliabilityLevel = String(dataReliability?.reliability_level || 'DECLARED').toUpperCase();
    const liquidityWeak = (ratios.current_ratio != null && ratios.current_ratio < 1) ||
      (ratios.working_capital != null && ratios.working_capital < 0);
    const networthNegative = extractedFinancials?.equity != null && extractedFinancials.equity < 0;
    const lossMaking = extractedFinancials?.net_profit != null && extractedFinancials.net_profit < 0;

    if (reliabilityLevel === 'DECLARED') score = Math.min(score, 68);
    else if (reliabilityLevel === 'DERIVED') score = Math.min(score, 78);
    score += reliabilityLevel === 'VERIFIED' ? 6 : reliabilityLevel === 'DERIVED' ? 0 : -4;
    if (networthNegative) score = Math.min(score, 35);
    if (lossMaking) score = Math.min(score, 35);

    score = Math.max(0, Math.min(100, Math.round(score)));

    let finalDecision = 'APPROVE';
    let decisionPriorityReason = 'Default approval path: no high-priority adverse condition triggered.';

    if (isCriticalAuthenticity) {
      finalDecision = 'MANUAL_REVIEW';
      decisionPriorityReason = 'Priority-1 override: critical authenticity signal requires manual review.';
      decisionReasonCodes.push('AUTHENTICITY_CRITICAL');
    } else if (reliabilityLevel === 'DECLARED' && liquidityWeak) {
      finalDecision = 'MANUAL_REVIEW';
      decisionPriorityReason = 'Priority-2 override: declared reliability with weak liquidity requires manual review.';
      decisionReasonCodes.push('DECLARED_DATA_WITH_WEAK_LIQUIDITY');
    } else if (networthNegative) {
      finalDecision = 'REJECT';
      decisionPriorityReason = 'Priority-3 override: negative net worth results in rejection.';
      decisionReasonCodes.push('NEGATIVE_NETWORTH');
    } else if (lossMaking) {
      finalDecision = 'REJECT';
      decisionPriorityReason = 'Priority-4 override: loss-making financials result in rejection.';
      decisionReasonCodes.push('LOSS_MAKING');
    } else if (liquidityWeak) {
      finalDecision = 'APPROVE_WITH_CONDITIONS';
      decisionPriorityReason = 'Priority-5 override: weak liquidity allows approval only with conditions.';
      decisionReasonCodes.push('LIQUIDITY_WEAK');
    }

    const grade = finalDecision === 'APPROVE'
      ? 'A'
      : finalDecision === 'APPROVE_WITH_CONDITIONS'
        ? 'B'
        : finalDecision === 'MANUAL_REVIEW'
          ? 'C'
          : 'D';

    const decisionExplanation = finalDecision === 'MANUAL_REVIEW'
      ? 'Manual review required due to high-priority authenticity or reliability-liquidity concerns.'
      : finalDecision === 'REJECT'
        ? 'Rejected due to negative net worth or loss-making financial performance.'
        : finalDecision === 'APPROVE_WITH_CONDITIONS'
          ? 'Approved with conditions due to weak liquidity but acceptable core financial stability.'
          : 'Approved as no higher-priority adverse condition was triggered.';

    return {
      company_type: companyType,
      reliability_level: reliabilityLevel,
      score,
      grade,
      decision: finalDecision,
      final_decision: finalDecision,
      decision_priority_reason: decisionPriorityReason,
      decision_explanation: decisionExplanation,
      reasons: flags.map((item) => item.reason),
      decision_reason_codes: [...new Set(decisionReasonCodes)],
      flags,
      rule_evaluations: ruleEvaluations
    };
  }
}

export default RiskEngine;