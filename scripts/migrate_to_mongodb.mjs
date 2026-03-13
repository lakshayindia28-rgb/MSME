/**
 * Migration Script: File System → MongoDB
 * 
 * Migrates existing case data from disk (JSON files) to MongoDB.
 * Run once: node scripts/migrate_to_mongodb.mjs
 * 
 * Safe to re-run — uses upsert logic, won't create duplicates.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, mongoose } from '../src/config/database.js';
import Case from '../src/models/Case.js';
import CaseSnapshot from '../src/models/CaseSnapshot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES_DATA_DIR = path.join(__dirname, '..', 'document-intelligence-data', 'cases');
const REGISTRY_PATH = path.join(__dirname, '..', 'document-intelligence-data', 'cases_registry.json');

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

async function migrateRegistry() {
  console.log('\n📋 Migrating cases_registry.json...');
  let cases = [];
  try {
    cases = await readJson(REGISTRY_PATH);
    if (!Array.isArray(cases)) cases = [];
  } catch {
    console.log('  ⚠ No cases_registry.json found, skipping.');
    return [];
  }

  let migrated = 0;
  for (const c of cases) {
    if (!c.id) continue;
    await Case.findOneAndUpdate(
      { caseId: c.id },
      {
        $set: {
          caseId: c.id,
          businessName: c.businessName || '',
          businessType: c.businessType || '',
          purpose: c.purpose || '',
          gstin: c.gstin || '',
          cin: c.cin || '',
          assignedTo: c.assignedTo || '',
          status: c.status || 'pending',
          risk: c.risk || 'medium',
          progress: c.progress || 0,
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date()
        }
      },
      { upsert: true }
    );
    migrated++;
  }
  console.log(`  ✅ ${migrated} cases migrated to MongoDB.`);
  return cases;
}

async function migrateSnapshots(cases) {
  console.log('\n📸 Migrating snapshots...');
  let total = 0;

  // Get all case directories (both from registry and on disk)
  const registryCaseIds = cases.map(c => c.id).filter(Boolean);
  let diskCaseIds = [];
  try {
    const entries = await fs.readdir(CASES_DATA_DIR, { withFileTypes: true });
    diskCaseIds = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    console.log('  ⚠ No cases directory found.');
    return;
  }

  const allCaseIds = [...new Set([...registryCaseIds, ...diskCaseIds])];
  console.log(`  Found ${allCaseIds.length} case directories to scan.`);

  for (const caseId of allCaseIds) {
    const snapDir = path.join(CASES_DATA_DIR, caseId, 'snapshots');
    let files;
    try {
      files = await fs.readdir(snapDir);
    } catch {
      continue; // no snapshots dir
    }

    // Only migrate .latest.json files (they represent current state)
    const latestFiles = files.filter(f => f.endsWith('.latest.json') && f !== 'index.json');

    for (const file of latestFiles) {
      try {
        const moduleKey = file.replace('.latest.json', '');
        const snap = await readJson(path.join(snapDir, file));
        const data = snap?.data || snap;

        // Check if already exists in DB
        const existing = await CaseSnapshot.findOne({
          caseId, moduleKey, isLatest: true
        });

        if (existing) {
          // Update existing
          existing.data = data;
          existing.savedAt = snap?.savedAt ? new Date(snap.savedAt) : new Date();
          await existing.save();
        } else {
          await CaseSnapshot.create({
            caseId,
            moduleKey,
            data,
            isLatest: true,
            savedAt: snap?.savedAt ? new Date(snap.savedAt) : new Date()
          });
        }
        total++;
      } catch (err) {
        console.log(`  ⚠ Failed to migrate ${caseId}/${file}: ${err.message}`);
      }
    }

    // Also migrate versioned snapshots (history)
    const historyFiles = files.filter(f => {
      return f.endsWith('.json') &&
        !f.endsWith('.latest.json') &&
        f !== 'index.json' &&
        f.includes('.');
    });

    for (const file of historyFiles) {
      try {
        // Extract moduleKey from filename like "gst.2026-03-05T07-28-33-469Z.json"
        const parts = file.replace('.json', '').split('.');
        if (parts.length < 2) continue;
        const moduleKey = parts[0];
        const snap = await readJson(path.join(snapDir, file));
        const data = snap?.data || snap;

        await CaseSnapshot.create({
          caseId,
          moduleKey,
          data,
          isLatest: false,
          savedAt: snap?.savedAt ? new Date(snap.savedAt) : new Date()
        });
        total++;
      } catch (err) {
        // Skip duplicates or errors silently for history
      }
    }

    process.stdout.write(`  📦 ${caseId}: migrated\n`);
  }

  console.log(`\n  ✅ ${total} total snapshots migrated to MongoDB.`);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Migration: File System → MongoDB                    ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  await connectDB();

  const cases = await migrateRegistry();
  await migrateSnapshots(cases);

  // Summary
  const caseCount = await Case.countDocuments();
  const snapCount = await CaseSnapshot.countDocuments();
  console.log('\n═══════════════════════════════════════════');
  console.log(`  Cases in MongoDB:    ${caseCount}`);
  console.log(`  Snapshots in MongoDB: ${snapCount}`);
  console.log('═══════════════════════════════════════════');
  console.log('\n✅ Migration complete! Your data is now in MongoDB.');
  console.log('   Old files on disk are preserved (not deleted).\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
