function safeText(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeName(name) {
  return safeText(name)
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/\b(pvt|private)\b/g, ' private ')
    .replace(/\b(ltd|limited)\b/g, ' limited ')
    .replace(/\b(co|company)\b/g, ' company ')
    .replace(/[^a-z0-9\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(name) {
  const n = normalizeName(name);
  return n ? n.split(' ').filter(Boolean) : [];
}

function tokenSortRatio(a, b) {
  const ta = tokenize(a).sort();
  const tb = tokenize(b).sort();
  if (!ta.length || !tb.length) return 0;

  const sa = ta.join(' ');
  const sb = tb.join(' ');
  if (sa === sb) return 100;

  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  const precision = overlap / ta.length;
  const recall = overlap / tb.length;
  return Math.round((2 * precision * recall) / Math.max(1e-9, precision + recall) * 100);
}

function abbreviationExpansion(name) {
  return normalizeName(name)
    .replace(/\bpvt\b/g, 'private')
    .replace(/\bltd\b/g, 'limited')
    .replace(/\bintl\b/g, 'international')
    .replace(/\btech\b/g, 'technologies')
    .trim();
}

function directorCrossMatch(directorsA = [], directorsB = []) {
  const a = directorsA.map((d) => normalizeName(d?.name || d)).filter(Boolean);
  const b = directorsB.map((d) => normalizeName(d?.name || d)).filter(Boolean);
  if (!a.length || !b.length) return 0;

  const setB = new Set(b);
  const overlap = a.filter((x) => setB.has(x)).length;
  return Math.round((overlap / Math.max(a.length, b.length)) * 100);
}

function addressSimilarity(addressesA = [], addressesB = []) {
  const a = addressesA.map((x) => normalizeName(x)).filter(Boolean);
  const b = addressesB.map((x) => normalizeName(x)).filter(Boolean);
  if (!a.length || !b.length) return 0;

  let best = 0;
  for (const aa of a) {
    for (const bb of b) {
      best = Math.max(best, tokenSortRatio(aa, bb));
    }
  }
  return best;
}

function resolveIdentityConfidence({
  inputName,
  canonicalName,
  mcaName,
  directorsInput = [],
  directorsMca = [],
  addressesInput = [],
  addressesMca = []
} = {}) {
  const nameScore = Math.max(
    tokenSortRatio(inputName, canonicalName),
    tokenSortRatio(abbreviationExpansion(inputName), abbreviationExpansion(canonicalName)),
    tokenSortRatio(inputName, mcaName)
  );
  const directorScore = directorCrossMatch(directorsInput, directorsMca);
  const addrScore = addressSimilarity(addressesInput, addressesMca);

  const weighted = Math.round(nameScore * 0.65 + directorScore * 0.2 + addrScore * 0.15);

  return {
    nameScore,
    directorScore,
    addressScore: addrScore,
    identityConfidenceScore: weighted
  };
}

export {
  normalizeName,
  tokenize,
  tokenSortRatio,
  abbreviationExpansion,
  directorCrossMatch,
  addressSimilarity,
  resolveIdentityConfidence
};
