function fmtPct(value) {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value) {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return value.toLocaleString('en-IN');
}

function joinReasons(reasons = []) {
  if (!Array.isArray(reasons) || reasons.length === 0) return 'No major risk rule breaches identified.';
  return reasons.map((item, idx) => `${idx + 1}. ${item}`).join(' ');
}

export class AnalystFormatter {
  format({ decision, companyProfile, extractedFinancials, ratios, riskAssessment, explanationSummary, riskScoreLabel, confidenceReason }) {
    const weaknesses = Array.isArray(riskAssessment?.flags)
      ? riskAssessment.flags.filter((f) => f.severity === 'HIGH' || f.severity === 'MEDIUM').map((f) => f.reason)
      : [];

    const lines = [
      'Company Overview',
      `- Company Type: ${companyProfile?.company_type || 'UNKNOWN'}`,
      `- Revenue: ${fmtNum(extractedFinancials?.revenue)}`,
      `- Net Profit: ${fmtNum(extractedFinancials?.net_profit)}`,
      '',
      'Financial Strength',
      `- Current Ratio: ${ratios?.current_ratio ?? 'N/A'}`,
      `- Net Profit Margin: ${fmtPct(ratios?.net_profit_margin)}`,
      `- ROA: ${fmtPct(ratios?.roa)}`,
      '',
      'Weaknesses',
      `- ${joinReasons(weaknesses)}`,
      '',
      'Cash Flow Behavior',
      `- Debtor Days: ${ratios?.debtor_days ?? 'N/A'}`,
      `- Working Capital: ${fmtNum(ratios?.working_capital)}`,
      '',
      'Lending View',
      `- Decision: ${decision?.decision || 'REVIEW'}`,
      `- Grade: ${decision?.grade || 'N/A'}`,
      `- Risk Concern Level: ${riskScoreLabel || 'N/A'}`,
      `- Confidence Justification: ${String(confidenceReason || 'N/A').trim() || 'N/A'}`,
      `- Rationale: ${joinReasons(decision?.reasons)}`,
      '',
      'Explanation',
      `- ${Array.isArray(explanationSummary?.bullet_summary) ? explanationSummary.bullet_summary.join(' ') : 'N/A'}`,
      `- ${String(explanationSummary?.detailed_summary || '').trim() || 'N/A'}`
    ];

    return lines.join('\n');
  }
}

export default AnalystFormatter;
