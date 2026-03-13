export const COMPLIANCE_STATUS = {
  CONFIRMED_NON_COMPLIANT: 'CONFIRMED_NON_COMPLIANT',
  UNVERIFIED_RISK: 'UNVERIFIED_RISK',
  NO_ADVERSE_RECORD: 'NO_ADVERSE_RECORD'
};

function hasOfficialAdverse(evidence = {}) {
  const ncltConfirmed = Boolean(evidence?.nclt?.confirmedCase && evidence?.nclt?.source === 'official_record');
  const sebiConfirmed = Boolean(evidence?.sebi?.confirmedAction && evidence?.sebi?.source === 'official_record');
  const exchangeConfirmed = Boolean(evidence?.exchange?.confirmedDefaulter && evidence?.exchange?.source === 'official_record');
  return ncltConfirmed || sebiConfirmed || exchangeConfirmed;
}

function hasProbableRisk(evidence = {}) {
  const ncltProbable = Boolean(evidence?.nclt?.evidence?.results?.length);
  const sebiProbable = Boolean(evidence?.sebi?.evidence?.results?.length);
  const exchangeProbable = Boolean(evidence?.exchange?.confidence >= 70 && evidence?.exchange?.matches?.length);
  const courtProbable = Boolean(evidence?.court?.probableCase);
  return ncltProbable || sebiProbable || exchangeProbable || courtProbable;
}

export function decideComplianceStatus({ companyIdentity, evidence } = {}) {
  if (hasOfficialAdverse(evidence)) {
    return {
      companyIdentity,
      complianceStatus: COMPLIANCE_STATUS.CONFIRMED_NON_COMPLIANT,
      reasoning: 'Official record evidence confirms adverse compliance event.'
    };
  }

  if (hasProbableRisk(evidence)) {
    return {
      companyIdentity,
      complianceStatus: COMPLIANCE_STATUS.UNVERIFIED_RISK,
      reasoning: 'Only probabilistic/supporting signals found; no official adverse confirmation.'
    };
  }

  return {
    companyIdentity,
    complianceStatus: COMPLIANCE_STATUS.NO_ADVERSE_RECORD,
    reasoning: 'No adverse records found from official datasets and fallback checks.'
  };
}
