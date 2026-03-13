const DIGITAL_MIN = 80;
const DIGITAL_MAX = 95;
const SCAN_MAX = 70;

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function avg(values = []) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function deriveDocumentQualityScore({ financialsEvidence = {}, extractionConfidence = {} } = {}) {
  const evidenceConf = Object.values(financialsEvidence || {})
    .map((item) => Number(item?.confidence_score))
    .filter((v) => Number.isFinite(v))
    .map((v) => v * 100);

  const fallbackConf = Object.values(extractionConfidence || {})
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => v * 100);

  const base = avg(evidenceConf.length ? evidenceConf : fallbackConf);
  return clamp(Math.round(base), 0, 100);
}

function deriveEvidenceCoverageScore({ financialsEvidence = {} } = {}) {
  const entries = Object.values(financialsEvidence || {});
  if (!entries.length) return 0;

  const provided = entries.filter((item) => item && item.value != null).length;
  return clamp(Math.round((provided / entries.length) * 100), 0, 100);
}

function normalizeReliabilityScore(dataReliability = {}) {
  const score = Number(dataReliability?.confidence_score);
  return clamp(Number.isFinite(score) ? score : 50, 0, 100);
}

function detectScanLikeDocument({ documentQualityScore, financialsEvidence = {} } = {}) {
  const sections = Object.values(financialsEvidence || {})
    .map((item) => String(item?.source_section || '').trim().toUpperCase())
    .filter(Boolean);

  const unspecifiedRatio = sections.length
    ? sections.filter((s) => s === 'UNSPECIFIED').length / sections.length
    : 0;

  return documentQualityScore < 75 || unspecifiedRatio > 0.5;
}

function buildConfidenceReason({ confidence, documentQualityScore, dataReliabilityScore, evidenceCoverageScore, pdfType, isCritical }) {
  if (isCritical) {
    return `Confidence capped at ${confidence} due to critical tampering signal, despite component scores (document quality ${documentQualityScore}, reliability ${dataReliabilityScore}, evidence coverage ${evidenceCoverageScore}).`;
  }

  return `Confidence is ${confidence} based on document quality ${documentQualityScore}, reliability ${dataReliabilityScore}, and evidence coverage ${evidenceCoverageScore}, adjusted for ${pdfType.replace('_', ' ')} trust profile.`;
}

export class ConfidenceService {
  compute({ authenticityCheck = {}, dataReliability = {}, financialsEvidence = {}, extractionConfidence = {} } = {}) {
    const documentQualityScore = deriveDocumentQualityScore({ financialsEvidence, extractionConfidence });
    const dataReliabilityScore = normalizeReliabilityScore(dataReliability);
    const evidenceCoverageScore = deriveEvidenceCoverageScore({ financialsEvidence });

    const base = avg([documentQualityScore, dataReliabilityScore, evidenceCoverageScore]);

    let confidence = clamp(Math.round(base), 0, 100);
    const status = String(authenticityCheck?.authenticity_status || '').toUpperCase();
    const isCritical = status === 'TAMPERED_CRITICAL';
    const scanLike = detectScanLikeDocument({ documentQualityScore, financialsEvidence });

    if (isCritical) {
      confidence = Math.min(confidence, 40);
    } else {
      if (scanLike) {
        confidence = Math.min(confidence, SCAN_MAX);
      } else {
        confidence = clamp(confidence, DIGITAL_MIN, DIGITAL_MAX);
      }
    }

    const pdfType = scanLike ? 'scan_pdf' : 'digital_pdf';
    const confidenceReason = buildConfidenceReason({
      confidence,
      documentQualityScore,
      dataReliabilityScore,
      evidenceCoverageScore,
      pdfType,
      isCritical
    });

    return {
      confidence_score: confidence,
      document_quality_score: documentQualityScore,
      data_reliability_score: dataReliabilityScore,
      evidence_coverage_score: evidenceCoverageScore,
      pdf_type: pdfType,
      confidence_reason: confidenceReason
    };
  }
}

export default ConfidenceService;
