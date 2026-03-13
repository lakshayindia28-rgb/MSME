import Case from '../models/Case.js';
import CaseSnapshot from '../models/CaseSnapshot.js';
import { logger } from '../utils/logger.js';

const MODULE_KEYS = [
  'gst', 'mca', 'compliance', 'pan', 'udyam',
  'itr', 'bank_statement', 'financial', 'field_data'
];

// Snapshot retention: keep the latest + this many historical snapshots per (caseId, moduleKey)
const SNAPSHOT_HISTORY_LIMIT = 5;

/* ── Case Registry CRUD ── */

export async function listCases() {
  const cases = await Case.find().sort({ createdAt: -1 }).lean();

  // Enrich with live progress from module_statuses snapshot
  const enriched = await Promise.all(cases.map(async (c) => {
    try {
      const statusSnap = await CaseSnapshot.findOne(
        { caseId: c.caseId, moduleKey: 'module_statuses', isLatest: true }
      ).lean();

      const statuses = statusSnap?.data || {};
      const weights = { pending: 0, in_progress: 0.5, completed: 1 };
      const total = MODULE_KEYS.length;
      const done = MODULE_KEYS.reduce((sum, k) => {
        const st = (statuses[k] || 'pending').toString().trim();
        return sum + (weights[st] ?? 0);
      }, 0);
      const progress = Math.round((done / Math.max(1, total)) * 100);

      let status = 'pending';
      const vals = MODULE_KEYS.map(k => (statuses[k] || 'pending').toString().trim());
      if (vals.every(s => s === 'completed')) status = 'completed';
      else if (vals.some(s => s === 'completed' || s === 'in_progress')) status = 'ongoing';

      return { ...c, id: c.caseId, progress, status, moduleStatuses: statuses };
    } catch {
      return { ...c, id: c.caseId };
    }
  }));

  return enriched;
}

export async function upsertCase(caseData) {
  const { id, ...rest } = caseData;
  if (!id) throw new Error('Case id is required');

  const existing = await Case.findOne({ caseId: id });
  if (existing) {
    Object.assign(existing, rest, { updatedAt: new Date() });
    await existing.save();
  } else {
    await Case.create({
      caseId: id,
      ...rest,
      createdAt: caseData.createdAt || new Date()
    });
  }
  return id;
}

export async function deleteCase(caseId) {
  await Case.deleteOne({ caseId });
  // Also remove all snapshots for this case
  await CaseSnapshot.deleteMany({ caseId });
  return caseId;
}

/* ── Snapshot CRUD ── */

const ALLOWED_MODULES = new Set([
  'gst', 'mca', 'compliance', 'bank', 'pan', 'udyam', 'itr',
  'bank_statement', 'financial', 'resident_verification',
  'resident_verification_images', 'field_data', 'business_summary', 'additional_details',
  'module_statuses', 'personal_applicant', 'personal_pan',
  'personal_aadhaar', 'personal_resident_verification', 'personal_personal_itr', 'personal_info',
  'report_config', 'ai_summary', 'gst_report_selection', 'case_overview',
  'selected_mca_directors', 'report_images', 'personal_module_completion',
  'financial_remark', 'overall_observation', 'field_data_summary'
]);

export async function saveSnapshot(caseId, moduleKey, data) {
  if (!ALLOWED_MODULES.has(moduleKey)) {
    throw new Error(`Unsupported moduleKey: ${moduleKey}`);
  }

  const now = new Date();

  // Mark old latest as non-latest (becomes history)
  await CaseSnapshot.updateMany(
    { caseId, moduleKey, isLatest: true },
    { $set: { isLatest: false } }
  );

  // Insert new snapshot as latest
  const snap = await CaseSnapshot.create({
    caseId,
    moduleKey,
    data,
    isLatest: true,
    savedAt: now
  });

  // Async cleanup — don't block the save response
  _pruneOldSnapshots(caseId, moduleKey).catch(err =>
    logger.warn('Snapshot cleanup failed', { caseId, moduleKey, error: err.message })
  );

  return {
    caseId,
    moduleKey,
    snapshotId: snap._id,
    savedAt: now.toISOString()
  };
}

/**
 * Prune old historical snapshots, keeping:
 *  - The current isLatest:true snapshot (always kept)
 *  - The most recent SNAPSHOT_HISTORY_LIMIT non-latest snapshots
 *  - All others are deleted
 */
async function _pruneOldSnapshots(caseId, moduleKey) {
  // Find non-latest snapshots sorted newest-first (only _id needed)
  const oldSnaps = await CaseSnapshot.find(
    { caseId, moduleKey, isLatest: false }
  ).sort({ savedAt: -1 }).select('_id savedAt').lean();

  if (oldSnaps.length <= SNAPSHOT_HISTORY_LIMIT) return; // nothing to prune

  const idsToDelete = oldSnaps.slice(SNAPSHOT_HISTORY_LIMIT).map(s => s._id);
  const result = await CaseSnapshot.deleteMany({ _id: { $in: idsToDelete } });
  logger.info(`Pruned ${result.deletedCount} old snapshots for ${caseId}/${moduleKey}`);
}

/**
 * Bulk cleanup: prune ALL (caseId, moduleKey) pairs in the database.
 * Useful for one-time cleanup of accumulated historical snapshots.
 * Returns { prunedTotal, pairsProcessed }.
 */
export async function cleanupAllSnapshots(historyLimit) {
  const limit = typeof historyLimit === 'number' && historyLimit >= 0 ? historyLimit : SNAPSHOT_HISTORY_LIMIT;

  // Get distinct (caseId, moduleKey) pairs
  const pairs = await CaseSnapshot.aggregate([
    { $group: { _id: { caseId: '$caseId', moduleKey: '$moduleKey' } } }
  ]).allowDiskUse(true);

  let prunedTotal = 0;
  for (const pair of pairs) {
    const { caseId, moduleKey } = pair._id;
    const oldSnaps = await CaseSnapshot.find(
      { caseId, moduleKey, isLatest: false }
    ).sort({ savedAt: -1 }).select('_id savedAt').lean();

    if (oldSnaps.length <= limit) continue;

    const idsToDelete = oldSnaps.slice(limit).map(s => s._id);
    const result = await CaseSnapshot.deleteMany({ _id: { $in: idsToDelete } });
    prunedTotal += result.deletedCount;
  }

  logger.info(`Bulk snapshot cleanup: pruned ${prunedTotal} snapshots across ${pairs.length} pairs`);
  return { prunedTotal, pairsProcessed: pairs.length };
}

export async function getLatestSnapshot(caseId, moduleKey) {
  const snap = await CaseSnapshot.findOne(
    { caseId, moduleKey, isLatest: true }
  ).lean();
  return snap || null;
}

export async function getSnapshotHistory(caseId, moduleKey, limit = 20) {
  return CaseSnapshot.find({ caseId, moduleKey })
    .sort({ savedAt: -1 })
    .limit(limit)
    .lean();
}

/* ── Case Meta ── */

export async function getCaseMeta(caseId) {
  const defaultModuleKeys = [
    'gst', 'mca', 'compliance', 'pan', 'udyam',
    'itr', 'bank_statement', 'financial', 'field_data'
  ];

  // Read module statuses from latest snapshot
  let moduleStatuses = {};
  const statusSnap = await CaseSnapshot.findOne(
    { caseId, moduleKey: 'module_statuses', isLatest: true }
  ).lean();
  if (statusSnap?.data && typeof statusSnap.data === 'object') {
    moduleStatuses = statusSnap.data;
  }

  // Check which modules have snapshot data in DB
  const existingModules = await CaseSnapshot.distinct('moduleKey', {
    caseId,
    isLatest: true,
    moduleKey: { $in: defaultModuleKeys }
  });

  return {
    caseId,
    moduleStatuses,
    modulesWithData: existingModules,
    completedModules: defaultModuleKeys.filter(k => {
      const status = String(moduleStatuses[k] || '').toLowerCase();
      return status === 'completed';
    }),
    modulesWithoutStatus: existingModules.filter(k => !moduleStatuses[k] || moduleStatuses[k] === 'pending')
  };
}

/* ── Hydrate payload from DB (for report generation) ── */

export async function readLatestModuleData(caseId, moduleKey) {
  const snap = await getLatestSnapshot(caseId, moduleKey);
  if (!snap) return null;
  const payload = snap.data;
  if (payload && typeof payload === 'object' && payload.data) return payload.data;
  return payload;
}
