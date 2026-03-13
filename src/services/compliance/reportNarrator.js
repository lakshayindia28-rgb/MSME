function buildNarratorPrompt(payload) {
  return [
    'You are a compliance report narrator.',
    'Use ONLY provided structured JSON. Do not invent cases. Do not change status.',
    'Write concise narrative suitable for due-diligence memo.',
    'Input JSON:',
    JSON.stringify(payload, null, 2)
  ].join('\n');
}

function deterministicNarrative(payload) {
  const company = payload?.companyIdentity?.legalName || payload?.companyIdentity?.cin || 'Company';
  const status = payload?.complianceStatus || 'UNKNOWN';
  const reason = payload?.reasoning || '';
  return `${company}: compliance status is ${status}. ${reason}`.trim();
}

export async function generateNarrative(payload) {
  return deterministicNarrative(payload);
}

export { buildNarratorPrompt };
