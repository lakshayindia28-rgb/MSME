function toSentence(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const out = raw.endsWith('.') ? raw : `${raw}.`;
  return out[0].toUpperCase() + out.slice(1);
}

function addUnique(list, text) {
  const sentence = toSentence(text);
  if (!sentence) return;
  if (!list.includes(sentence)) list.push(sentence);
}

export class CreditAdvisoryService {
  build({ ratios = {}, extractedFinancials = {}, decision = {}, riskAssessment = {}, dataReliability = {} } = {}) {
    const mandatoryConditions = [];
    const riskMitigation = [];
    const advisoryRecommendations = [];

    const liquidityWeak = (ratios?.current_ratio != null && ratios.current_ratio < 1) ||
      (ratios?.working_capital != null && ratios.working_capital < 0);
    const negativeNetworth = extractedFinancials?.equity != null && extractedFinancials.equity < 0;
    const receivableHigh = ratios?.debtor_days != null && ratios.debtor_days > 90;
    const lowProfitability = ratios?.net_profit_margin != null && ratios.net_profit_margin < 0.02;

    if (liquidityWeak) {
      addUnique(mandatoryConditions, 'Improve working capital buffer and maintain current ratio above 1.00 before full credit limit utilization');
    }

    if (negativeNetworth) {
      addUnique(mandatoryConditions, 'Restore positive net worth through equity infusion or debt restructuring before disbursement expansion');
    }

    if (receivableHigh) {
      addUnique(mandatoryConditions, 'Reduce receivable collection period below 90 days with stricter debtor follow-up and credit controls');
    }

    if (liquidityWeak || negativeNetworth || String(decision?.decision || '').toUpperCase() === 'MANUAL_REVIEW') {
      addUnique(riskMitigation, 'Obtain enforceable collateral coverage and periodic valuation to mitigate repayment risk');
    }

    if (String(dataReliability?.reliability_level || '').toUpperCase() === 'DECLARED') {
      addUnique(riskMitigation, 'Obtain additional document validation and bank statement cross-check before final sanction');
    }

    if (lowProfitability) {
      addUnique(advisoryRecommendations, 'Increase operating margin above 2.00% through pricing discipline and cost optimization');
    }

    addUnique(advisoryRecommendations, 'Improve operational efficiency by reducing process leakages and tightening expense controls');

    if (!mandatoryConditions.length) {
      addUnique(mandatoryConditions, 'Maintain current financial discipline and provide quarterly financial disclosures as a sanction condition');
    }

    return {
      mandatory_conditions: mandatoryConditions,
      risk_mitigation: riskMitigation,
      advisory_recommendations: advisoryRecommendations
    };
  }
}

export default CreditAdvisoryService;
