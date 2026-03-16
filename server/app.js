import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import path from 'path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { callClaude, isBedrockConfigured } from '../src/services/bedrockClient.js';
import { fileURLToPath } from 'url';
import { GSTProxyService } from '../src/services/gstProxyService.js';
import zaubaService from '../src/services/zaubaService.js';
import searchService from '../src/services/searchService.js';
import mcaSearchService from '../src/services/mcaSearchService.js';
import reportService from '../src/services/reportService.js';
import complianceService from '../src/services/complianceService.js';
import financialModelRoutes from '../src/routes/financialModelRoutes.js';
import financialCalcRoutes from '../src/routes/financialCalcRoutes.js';
import { logger } from '../src/utils/logger.js';
import { fileTypeFromBuffer } from 'file-type';
import { PDFDocument } from 'pdf-lib';
import multer from 'multer';
import { connectDB } from '../src/config/database.js';
import {
  listCases, upsertCase, deleteCase as deleteCaseDb,
  saveSnapshot, getLatestSnapshot, getCaseMeta,
  readLatestModuleData, cleanupAllSnapshots
} from '../src/services/caseDbService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const CASES_DATA_DIR = path.join(__dirname, '..', 'document-intelligence-data', 'cases');

function sanitizeCaseId(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'default';
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'default';
}

function sanitizeModuleKey(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s.replace(/[^a-z0-9_-]/g, '_').slice(0, 40) || 'unknown';
}

async function readJsonFile(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

function pickReportPayloadFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.data && typeof snapshot.data === 'object') return snapshot.data;
  if (snapshot.raw && typeof snapshot.raw === 'object') {
    if (snapshot.raw.data && typeof snapshot.raw.data === 'object') return snapshot.raw.data;
    return snapshot.raw;
  }
  return snapshot;
}

function normalizeModuleSummaries(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      summaryKey: String(item.summaryKey || '').trim(),
      blockKey: String(item.blockKey || '').trim(),
      moduleKey: String(item.moduleKey || '').trim(),
      moduleLabel: String(item.moduleLabel || item.moduleKey || '').trim(),
      summary: String(item.summary || '').trim(),
      status: String(item.status || '').trim().toLowerCase(),
      generatedAt: item.generatedAt || null
    }))
    .filter((item) => item.summary && item.moduleLabel)
    .filter((item) => !item.status || item.status === 'completed');
}



function buildFallbackModuleSummary({ moduleLabel, moduleData }) {
  const data = moduleData && typeof moduleData === 'object' ? moduleData : {};
  const keys = Object.keys(data);
  if (!keys.length) return `${moduleLabel}: No structured data available yet.`;

  const top = keys.slice(0, 8).join(', ');
  return `${moduleLabel}: Key fields reviewed — ${top}. Please verify full snapshot for detailed values.`;
}

async function readLatestCaseModuleSnapshot(caseId, moduleKey) {
  try {
    const data = await readLatestModuleData(caseId, moduleKey);
    return pickReportPayloadFromSnapshot(data);
  } catch {
    return null;
  }
}

async function hydrateDueDiligencePayloadFromCase(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {};
  const rawCaseId = payload?.case?.caseId || payload?.caseId;
  if (!rawCaseId) return payload;

  const caseId = sanitizeCaseId(rawCaseId);
  const defaultModuleKeys = ['gst', 'mca', 'compliance', 'bank', 'pan', 'udyam', 'itr', 'bank_statement', 'financial'];
  const selectedFromReport = Array.isArray(payload?.reportConfig?.selectedModules)
    ? payload.reportConfig.selectedModules.map((k) => sanitizeModuleKey(k))
    : [];
  const moduleKeys = selectedFromReport.length
    ? defaultModuleKeys.filter((k) => selectedFromReport.includes(k))
    : defaultModuleKeys;

  const modules = payload.modules && typeof payload.modules === 'object' ? { ...payload.modules } : {};
  if (modules.financial == null && payload.financialData && typeof payload.financialData === 'object') {
    modules.financial = payload.financialData;
  }
  for (const key of moduleKeys) {
    if (modules[key] != null) continue;
    const data = await readLatestCaseModuleSnapshot(caseId, key);
    if (data != null) modules[key] = data;
  }

  // Always hydrate PAN data so Business Entity page can render PAN regardless of module selection
  if (modules.pan == null) {
    const panData = await readLatestCaseModuleSnapshot(caseId, 'pan');
    if (panData != null) modules.pan = panData;
  }

  // Deep-unwrap PAN data — it may be nested as { source, fetchedAt, data: { pan_number, ... } }
  if (modules.pan && typeof modules.pan === 'object') {
    let _pm = modules.pan;
    for (let _i = 0; _i < 5; _i++) {
      if (_pm.pan_number !== undefined || _pm.name !== undefined || _pm.primary !== undefined) break;
      if (_pm.data && typeof _pm.data === 'object') { _pm = _pm.data; } else if (_pm.raw && typeof _pm.raw === 'object') { _pm = _pm.raw; } else break;
    }
    if (_pm !== modules.pan) modules.pan = _pm;
  }

  payload.modules = modules;

  if (!payload.gstData && modules.gst) payload.gstData = modules.gst;
  if (!payload.mcaData && modules.mca) payload.mcaData = modules.mca;

  // Auto-run compliance checks if compliance module is selected but has no findings data
  const complianceSelected = moduleKeys.includes('compliance');
  const complianceHasFindings = modules.compliance && Array.isArray(modules.compliance.findings) && modules.compliance.findings.length > 0;
  if (complianceSelected && !complianceHasFindings) {
    try {
      const companyIdentifier =
        payload?.mcaData?.cin || payload?.mcaData?.CIN ||
        payload?.mcaData?.companyName || payload?.mcaData?.company ||
        payload?.gstData?.legalName || payload?.gstData?.tradeName ||
        payload?.case?.companyName || '';
      if (companyIdentifier) {
        logger.info(`Auto-running compliance checks for report: ${companyIdentifier}`);
        const complianceResult = await complianceService.checkCompliance(companyIdentifier);
        if (complianceResult) {
          modules.compliance = complianceResult;
          payload.modules = modules;
        }
      }
    } catch (compErr) {
      logger.warn('Auto-compliance check during report hydration failed:', compErr?.message || compErr);
    }
  }

  // Hydrate resident_verification_images from case snapshot (if not already in payload)
  if (!payload.residentVerificationData) {
    const rvImages = await readLatestCaseModuleSnapshot(caseId, 'resident_verification_images');
    const rvAddress = await readLatestCaseModuleSnapshot(caseId, 'resident_verification');
    if ((rvImages && typeof rvImages === 'object') || (rvAddress && typeof rvAddress === 'object')) {
      payload.residentVerificationData = {
        addressData: rvAddress && typeof rvAddress === 'object' ? (rvAddress.primary || rvAddress) : {},
        images: (rvImages && Array.isArray(rvImages.images)) ? rvImages.images : []
      };
    }
  }

  // Hydrate personal info (applicant, pan, aadhaar, resident_verification, personal_itr) from case snapshot
  if (!payload.personalInfo) {
    const piData = await readLatestCaseModuleSnapshot(caseId, 'personal_info');
    if (piData && typeof piData === 'object') {
      payload.personalInfo = piData;
    } else {
      // Fallback: try reading individual personal module snapshots
      const personalModuleKeys = ['applicant', 'pan', 'aadhaar', 'resident_verification', 'personal_itr'];
      const assembled = {};
      for (const pmk of personalModuleKeys) {
        const pmData = await readLatestCaseModuleSnapshot(caseId, 'personal_' + pmk);
        if (pmData && typeof pmData === 'object') assembled[pmk] = pmData;
      }
      if (Object.keys(assembled).length) payload.personalInfo = assembled;
    }
  }

  // Hydrate moduleSummaries from AI summary snapshot (if not already in payload)
  if (!payload.moduleSummaries || !Object.keys(payload.moduleSummaries).length) {
    const aiSummarySnap = await readLatestCaseModuleSnapshot(caseId, 'ai_summary');
    if (aiSummarySnap && typeof aiSummarySnap === 'object') {
      const summaries = {};
      // Prefer selected_for_report (executive summaries)
      const selected = Array.isArray(aiSummarySnap.selected_for_report) ? aiSummarySnap.selected_for_report : [];
      for (const item of selected) {
        if (item && item.moduleKey && item.summary) {
          summaries[item.moduleKey] = String(item.summary).trim();
        }
      }
      // If no executive selections, try all summaries
      if (!Object.keys(summaries).length && aiSummarySnap.all && typeof aiSummarySnap.all === 'object') {
        for (const [key, item] of Object.entries(aiSummarySnap.all)) {
          if (item && typeof item === 'object' && item.summary && item.moduleKey) {
            summaries[item.moduleKey] = String(item.summary).trim();
          }
        }
      }
      if (Object.keys(summaries).length) {
        payload.moduleSummaries = { ...(payload.moduleSummaries || {}), ...summaries };
      }
    }
  }

  // Hydrate fieldImages from field_data snapshot (if not already in payload)
  if (!payload.fieldImages || !payload.fieldImages.length) {
    const fdData = await readLatestCaseModuleSnapshot(caseId, 'field_data');
    if (fdData && typeof fdData === 'object' && Array.isArray(fdData.images)) {
      payload.fieldImages = fdData.images.filter(img => img && img.dataUrl);
    }
  }

  // Hydrate businessSummary from business_summary snapshot (if not already in payload)
  if (!payload.businessSummary) {
    const bsData = await readLatestCaseModuleSnapshot(caseId, 'business_summary');
    if (bsData && typeof bsData === 'object') {
      const summary = bsData.summary || bsData.data?.summary || '';
      if (summary) payload.businessSummary = summary;
    }
  }

  // Hydrate financialRemark from financial_remark snapshot (if not already in payload)
  if (!payload.financialRemark) {
    const frData = await readLatestCaseModuleSnapshot(caseId, 'financial_remark');
    if (frData && typeof frData === 'object') {
      const remark = frData.remark || '';
      if (remark) payload.financialRemark = remark;
    }
  }

  const derivedCase = payload.case && typeof payload.case === 'object' ? { ...payload.case } : {};
  if (!derivedCase.caseId) derivedCase.caseId = caseId;
  if (!derivedCase.companyName) {
    derivedCase.companyName =
      payload?.mcaData?.companyName ||
      payload?.gstData?.legalName ||
      payload?.gstData?.tradeName ||
      payload?.companyName ||
      null;
  }
  payload.case = derivedCase;

  // Hydrate case_overview (manually entered executive data) from case snapshot
  if (!payload.caseOverview) {
    const coData = await readLatestCaseModuleSnapshot(caseId, 'case_overview');
    if (coData && typeof coData === 'object') {
      payload.caseOverview = coData;
    }
  }

  // Hydrate additional_details from case snapshot
  if (!payload.additionalDetails) {
    const adData = await readLatestCaseModuleSnapshot(caseId, 'additional_details');
    if (adData && typeof adData === 'object') {
      payload.additionalDetails = adData;
    }
  }

  // Hydrate selected MCA directors for report (Company Snapshot page)
  // Format: { selectionMade: boolean, directors: [...] } or legacy array
  if (!payload.selectedMcaDirectors) {
    const smdData = await readLatestCaseModuleSnapshot(caseId, 'selected_mca_directors');
    if (smdData && typeof smdData === 'object' && !Array.isArray(smdData)) {
      // Wrapper format (new) — may have { data: { selectionMade, directors } } from snapshot storage
      const inner = smdData.data || smdData;
      if (inner && inner.selectionMade !== undefined) {
        payload.selectedMcaDirectors = { selectionMade: !!inner.selectionMade, directors: Array.isArray(inner.directors) ? inner.directors : [] };
      } else if (Array.isArray(inner)) {
        payload.selectedMcaDirectors = { selectionMade: inner.length > 0, directors: inner };
      }
    } else if (Array.isArray(smdData)) {
      // Legacy array format
      payload.selectedMcaDirectors = { selectionMade: smdData.length > 0, directors: smdData };
    }
  }

  // Hydrate custom signature/stamp from report_images snapshot (if not already in payload)
  if (!payload.officer?.signatureImage?.dataUrl || !payload.officer?.stampImage?.dataUrl) {
    const riData = await readLatestCaseModuleSnapshot(caseId, 'report_images');
    if (riData && typeof riData === 'object') {
      const officer = payload.officer && typeof payload.officer === 'object' ? { ...payload.officer } : {};
      if (!officer.signatureImage?.dataUrl && riData.signatureDataUrl) {
        officer.signatureImage = { dataUrl: riData.signatureDataUrl };
      }
      if (!officer.stampImage?.dataUrl && riData.stampDataUrl) {
        officer.stampImage = { dataUrl: riData.stampDataUrl };
      }
      if (officer.signatureImage?.dataUrl || officer.stampImage?.dataUrl) {
        payload.officer = officer;
      }
    }
  }

  // Hydrate Business Block PAN images (convert /case-data/ file URLs to data URLs)
  const panMod = payload.modules?.pan;
  if (panMod && typeof panMod === 'object') {
    const panPhotoUrl = panMod.verified_photo_url || panMod.data?.verified_photo_url || '';
    if (panPhotoUrl && typeof panPhotoUrl === 'string' && panPhotoUrl.includes('/case-data/') && !panPhotoUrl.startsWith('data:')) {
      try {
        const relPath = panPhotoUrl.replace(/^\/case-data\//, '');
        const imgPath = path.join(CASES_DATA_DIR, decodeURIComponent(relPath));
        const dataUrl = await loadImageAsDataUrl(imgPath);
        if (dataUrl) {
          panMod.verified_photo_data_url = dataUrl;
          logger.info('PAN image 1 loaded as data URL for report');
        }
      } catch (e) { logger.warn('Could not load PAN image 1:', e?.message); }
    }
    const panPhotoUrl2 = panMod.verified_photo_url_2 || panMod.data?.verified_photo_url_2 || '';
    if (panPhotoUrl2 && typeof panPhotoUrl2 === 'string' && panPhotoUrl2.includes('/case-data/') && !panPhotoUrl2.startsWith('data:')) {
      try {
        const relPath2 = panPhotoUrl2.replace(/^\/case-data\//, '');
        const imgPath2 = path.join(CASES_DATA_DIR, decodeURIComponent(relPath2));
        const dataUrl2 = await loadImageAsDataUrl(imgPath2);
        if (dataUrl2) {
          panMod.verified_photo_data_url_2 = dataUrl2;
          logger.info('PAN image 2 loaded as data URL for report');
        }
      } catch (e) { logger.warn('Could not load PAN image 2:', e?.message); }
    }
  }

  // Hydrate Personal Block PAN/Aadhaar images and RV verification_images —
  // if frontend sent stripped images (attached:true/stripped, no data_url/dataUrl),
  // try to recover them from the server personal_info snapshot
  if (payload.personalInfo && typeof payload.personalInfo === 'object') {
    const docModules = ['pan', 'aadhaar'];
    const docKeys = ['verified_document', 'verified_document_2'];
    let needsRecovery = false;

    // Check PAN/Aadhaar docs
    for (const mk of docModules) {
      const primary = payload.personalInfo[mk]?.primary;
      if (!primary) continue;
      for (const dk of docKeys) {
        const doc = primary[dk];
        if (doc && typeof doc === 'object' && (doc.attached || doc.stripped) && !doc.data_url) {
          needsRecovery = true;
          break;
        }
      }
      if (needsRecovery) break;
    }

    // Check resident_verification verification_images (primary + designated persons)
    const rvMod = payload.personalInfo.resident_verification;
    if (!needsRecovery && rvMod) {
      const checkImgs = (imgs) => Array.isArray(imgs) && imgs.length > 0 && imgs.every(i => !i?.dataUrl);
      if (checkImgs(rvMod.primary?.verification_images)) needsRecovery = true;
      if (!needsRecovery && Array.isArray(rvMod.designatedPersons)) {
        for (const dp of rvMod.designatedPersons) {
          if (checkImgs(dp?.verification_images)) { needsRecovery = true; break; }
        }
      }
    }

    if (needsRecovery) {
      try {
        const piSnap = await readLatestCaseModuleSnapshot(caseId, 'personal_info');
        if (piSnap && typeof piSnap === 'object') {
          // Recover PAN/Aadhaar document images
          for (const mk of docModules) {
            const primary = payload.personalInfo[mk]?.primary;
            const snapPrimary = piSnap[mk]?.primary;
            if (!primary || !snapPrimary) continue;
            for (const dk of docKeys) {
              const doc = primary[dk];
              const snapDoc = snapPrimary[dk];
              if (doc && typeof doc === 'object' && (doc.attached || doc.stripped) && !doc.data_url) {
                if (snapDoc && typeof snapDoc === 'object' && snapDoc.data_url && typeof snapDoc.data_url === 'string' && snapDoc.data_url.startsWith('data:')) {
                  primary[dk] = snapDoc;
                  logger.info(`Personal ${mk} ${dk} image recovered from snapshot`);
                }
              }
            }
          }
          // Recover resident_verification verification_images (primary + designated persons)
          const snapRv = piSnap.resident_verification;
          if (snapRv && rvMod) {
            const recoverImgs = (target, source) => {
              if (!target || !source) return;
              if (Array.isArray(target.verification_images) && target.verification_images.length && target.verification_images.every(i => !i?.dataUrl)) {
                if (Array.isArray(source.verification_images) && source.verification_images.some(i => i?.dataUrl)) {
                  target.verification_images = source.verification_images;
                  logger.info('Personal RV verification_images recovered from snapshot');
                }
              }
            };
            recoverImgs(rvMod.primary, snapRv.primary);
            if (Array.isArray(rvMod.designatedPersons) && Array.isArray(snapRv.designatedPersons)) {
              rvMod.designatedPersons.forEach((dp, idx) => {
                recoverImgs(dp, snapRv.designatedPersons[idx]);
              });
            }
          }
        }
      } catch (e) { logger.warn('Personal image recovery from snapshot failed:', e?.message); }
    }
  }

  return payload;
}

function guessMimeFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function loadImageAsDataUrl(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const mime = guessMimeFromPath(filePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function attachDefaultSignStamp(payload) {
  const out = payload && typeof payload === 'object' ? { ...payload } : {};
  const officer = out.officer && typeof out.officer === 'object' ? { ...out.officer } : {};
  const signatureExists = Boolean(officer?.signatureImage?.dataUrl);
  const stampExists = Boolean(officer?.stampImage?.dataUrl);

  if (!signatureExists) {
    const signPath = path.join(__dirname, '..', 'SIGN.jpeg');
    const signDataUrl = await loadImageAsDataUrl(signPath);
    if (signDataUrl) {
      officer.signatureImage = {
        fileName: 'SIGN.jpeg',
        mimeType: 'image/jpeg',
        dataUrl: signDataUrl
      };
    }
  }

  if (!stampExists) {
    const stampPath = path.join(__dirname, '..', 'stamp.png');
    const stampDataUrl = await loadImageAsDataUrl(stampPath);
    if (stampDataUrl) {
      officer.stampImage = {
        fileName: 'stamp.png',
        mimeType: 'image/png',
        dataUrl: stampDataUrl
      };
    }
  }

  out.officer = officer;
  return out;
}

// Initialize GST Proxy Service (simple HTTP, no automation)
const gstProxy = new GSTProxyService();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for demo
}));
app.use(cors());
// Increased payload limits to support optional base64-embedded images in report generation
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Trust proxy (Nginx) so express-rate-limit sees real client IPs
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3000, // limit each IP to 3000 requests per windowMs (page load fires 40+ parallel snapshot calls)
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);
app.use('/api/financial-model', financialModelRoutes);
app.use('/api/financial-calc', financialCalcRoutes);

app.get('/api/financial-model/report', async (req, res) => {
  try {
    const rawFile = String(req.query?.file || '').trim();
    const file = path.basename(rawFile);
    if (!file || !file.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Valid PDF file name is required' });
    }

    const reportsDir = path.resolve(process.cwd(), 'logs', 'financial-reports');
    const filePath = path.resolve(reportsDir, file);
    if (!filePath.startsWith(`${reportsDir}${path.sep}`)) {
      return res.status(400).json({ error: 'Invalid report path' });
    }

    await fs.access(filePath);
    return res.download(filePath, file);
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      return res.status(404).json({ error: 'Report file not found' });
    }
    logger.error('Financial model report download error:', error);
    return res.status(500).json({ error: 'Failed to download financial model report' });
  }
});

// Disable browser caching for HTML/JS/CSS so updates take effect immediately
app.use((req, res, next) => {
  if (/\.(html?|js|css)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
// Serve static files (disable automatic index.html so we can control '/')
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Silence default browser favicon.ico requests (optional)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve persisted case artifacts (snapshots/uploads) for internal viewing
app.use('/case-data', express.static(CASES_DATA_DIR, { index: false }));

// API Routes

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Get captcha image from GST portal
 * Simple HTTP proxy - maintains session for user-assisted verification
 */
app.get('/api/captcha', async (req, res) => {
  try {
    const { gstin } = req.query;
    
    if (!gstin) {
      return res.status(400).json({
        success: false,
        error: 'GSTIN is required'
      });
    }

    logger.info('Captcha requested for GSTIN: ' + gstin);
    
    const result = await gstProxy.getCaptcha(gstin);
    
    if (result.success) {
      res.json({
        success: true,
        captcha: result.captcha,
        sessionId: result.sessionId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Captcha error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get captcha'
    });
  }
});

/**
 * Verify GSTIN with user-provided captcha
 * User manually solves captcha, backend submits and parses response
 */
app.post('/api/gst/search', async (req, res) => {
  try {
    const { gstin, captcha, sessionId } = req.body;

    if (!gstin || !captcha || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'GSTIN, captcha, and sessionId are required'
      });
    }

    logger.info(`GST verification request for: ${gstin}`);

    const result = await gstProxy.verifyGST(gstin, captcha, sessionId);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to fetch GST data'
      });
    }
  } catch (error) {
    logger.error('GST search error', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get filing years dropdown for GSTIN
 */
app.get('/api/filing/years', async (req, res) => {
  try {
    const { gstin, sessionId } = req.query;
    
    if (!gstin || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'GSTIN and sessionId are required'
      });
    }

    logger.info('Filing years requested for GSTIN: ' + gstin);
    
    const result = await gstProxy.getFilingYears(gstin, sessionId);
    
    if (result.success) {
      res.json({
        success: true,
        years: result.years
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Filing years error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filing years'
    });
  }
});

/**
 * Get filing status for specific year
 */
app.post('/api/filing/status', async (req, res) => {
  try {
    const { gstin, financialYear, sessionId } = req.body;
    
    if (!gstin || !financialYear || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'GSTIN, financialYear and sessionId are required'
      });
    }

    logger.info(`Filing status requested for GSTIN: ${gstin}, FY: ${financialYear}`);
    
    const result = await gstProxy.getFilingStatus(gstin, financialYear, sessionId);
    
    if (result.success) {
      res.json({
        success: true,
        filingStatus: result.filingStatus
      });
    } else {
      if (result.errorCode === 'NO_FILING_DATA' || result.errorCode === 'GST_PORTAL_REJECTED') {
        return res.json({
          success: true,
          filingStatus: [],
          warning: result.error,
          warningCode: result.errorCode,
          retryable: !!result.retryable
        });
      }

      if (String(result.error || '').toLowerCase().includes('session expired')) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.status(502).json({
        success: false,
        error: result.error || 'Failed to get filing status from GST portal'
      });
    }
  } catch (error) {
    logger.error('Filing status error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filing status'
    });
  }
});

/**
 * Fetch GST details by GSTIN (Demo mode)
 */
app.get('/api/gst/:gstin', async (req, res) => {
  try {
    const { gstin } = req.params;
    const format = req.query.format || 'json';

    logger.info(`API request for GSTIN: ${gstin}`);

    const result = await gstModule.getGSTRecord(gstin, { 
      format: 'json',
      showRaw: true 
    });

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        metadata: result.metadata
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode
      });
    }
  } catch (error) {
    logger.error('API error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorCode: 'SERVER_ERROR'
    });
  }
});

/**
 * Batch fetch multiple GSTINs
 */
app.post('/api/gst/batch', async (req, res) => {
  try {
    const { gstins } = req.body;

    if (!Array.isArray(gstins) || gstins.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of GSTINs'
      });
    }

    if (gstins.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 GSTINs allowed per batch'
      });
    }

    logger.info(`Batch API request for ${gstins.length} GSTINs`);

    const result = await gstModule.getMultipleGSTRecords(gstins, { format: 'json' });

    res.json({
      success: true,
      summary: result.summary,
      results: result.results
    });
  } catch (error) {
    logger.error('Batch API error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Clear cache
 */
app.post('/api/cache/clear', (req, res) => {
  try {
    gstModule.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get queue status
 */
app.get('/api/queue/status', (req, res) => {
  try {
    const status = gstModule.getQueueStatus();
    res.json({
      success: true,
      queue: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Single landing page: CrediVerify 360 dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Back-compat: redirect legacy dashboard route to landing
app.get('/dashboard', (req, res) => {
  res.redirect('/');
});

// Case Workspace entry point (query params supported)
app.get('/case-workspace', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'case-workspace.html'));
});

// Report Builder page
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Financial Calculation Engine page
app.get('/financial-calc', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'financial-calc.html'));
});

/* ══════════════════════════════════════════════════════════════
   Case Registry — now backed by MongoDB (caseDbService)
   Legacy file: document-intelligence-data/cases_registry.json
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/cases — list all cases (with live progress from MongoDB)
 */
app.get('/api/cases', async (req, res) => {
  try {
    const cases = await listCases();

    // Enrich each case with server-side module statuses from snapshots
    const CaseSnapshot = (await import('../src/models/CaseSnapshot.js')).default;
    const statusSnaps = await CaseSnapshot.find(
      { moduleKey: 'module_statuses', isLatest: true },
      { caseId: 1, data: 1 }
    ).lean();
    const statusMap = new Map();
    for (const s of statusSnaps) {
      if (s.caseId && s.data && typeof s.data === 'object') statusMap.set(s.caseId, s.data);
    }
    const enriched = cases.map(c => {
      const ms = statusMap.get(c.id) || null;
      return ms ? { ...c, moduleStatuses: ms } : c;
    });
    res.json({ success: true, cases: enriched });
  } catch (err) {
    logger.error('List cases error:', err);
    res.status(500).json({ success: false, error: 'Failed to load cases' });
  }
});

/**
 * POST /api/cases — create or update a case in MongoDB
 */
app.post('/api/cases', async (req, res) => {
  try {
    const c = req.body;
    if (!c || !c.id) {
      return res.status(400).json({ success: false, error: 'Case id is required' });
    }
    const caseId = await upsertCase(c);

    // Also ensure the case directory exists on disk (for file uploads)
    const caseDir = path.join(CASES_DATA_DIR, c.id);
    await fs.mkdir(path.join(caseDir, 'snapshots'), { recursive: true });

    res.json({ success: true, caseId });
  } catch (err) {
    logger.error('Save case error:', err);
    res.status(500).json({ success: false, error: 'Failed to save case' });
  }
});

/**
 * DELETE /api/cases/:caseId — remove case from MongoDB
 */
app.delete('/api/cases/:caseId', async (req, res) => {
  try {
    const caseId = sanitizeCaseId(req.params.caseId);
    await deleteCaseDb(caseId);
    // Also remove case directory from filesystem
    const caseDir = path.join(CASES_DATA_DIR, caseId);
    try { await fs.rm(caseDir, { recursive: true, force: true }); } catch {}
    res.json({ success: true, deleted: caseId });
  } catch (err) {
    logger.error('Delete case error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete case' });
  }
});

/**
 * Persist module snapshot JSON to disk for audit + final report reuse.
 * Writes:
 * - document-intelligence-data/cases/<caseId>/snapshots/<moduleKey>.latest.json
 * - document-intelligence-data/cases/<caseId>/snapshots/<moduleKey>.<timestamp>.json
 */
app.post('/api/case/save-snapshot', async (req, res) => {
  try {
    const rawCaseId = String(req.body?.caseId || '').trim();
    if (!rawCaseId || rawCaseId.toLowerCase() === 'default') {
      return res.status(400).json({
        success: false,
        error: 'caseId is required to persist snapshots (testing without caseId is not saved)'
      });
    }

    const caseId = sanitizeCaseId(rawCaseId);
    const moduleKey = sanitizeModuleKey(req.body?.moduleKey);
    const data = req.body?.data;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ success: false, error: 'data (JSON object) is required' });
    }

    const result = await saveSnapshot(caseId, moduleKey, data);

    res.json({
      success: true,
      caseId: result.caseId,
      moduleKey: result.moduleKey,
      snapshotId: result.snapshotId,
      savedAt: result.savedAt
    });
  } catch (error) {
    logger.error('Save snapshot error', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to save snapshot' });
  }
});

/* ── Snapshot Retention Cleanup ── */
app.post('/api/case/cleanup-snapshots', async (req, res) => {
  try {
    const limit = req.body?.historyLimit;
    const result = await cleanupAllSnapshots(typeof limit === 'number' ? limit : undefined);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Snapshot cleanup error', error);
    res.status(500).json({ success: false, error: error.message || 'Cleanup failed' });
  }
});

// PAN photo upload (stored per case, returned as a /case-data URL)
const panUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

app.post('/api/case/:caseId/pan/photo', panUpload.single('photo'), async (req, res) => {
  try {
    const rawCaseId = String(req.params.caseId || '').trim();
    if (!rawCaseId || rawCaseId.toLowerCase() === 'default') {
      return res.status(400).json({ success: false, error: 'caseId is required' });
    }
    const caseId = sanitizeCaseId(rawCaseId);

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, error: 'photo file is required (field name: photo)' });
    }

    const kindRaw = String(req.body?.kind || 'pan_photo').trim().toLowerCase();
    const kind = ['pan_photo', 'pan_verified', 'pan_verified_2'].includes(kindRaw) ? kindRaw : 'pan_photo';

    const type = await fileTypeFromBuffer(file.buffer).catch(() => null);
    const mime = type?.mime || file.mimetype || '';
    const ext = type?.ext || null;
    const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMimes.has(String(mime).toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Unsupported image type. Use JPG/PNG/WEBP.' });
    }

    const safeExt = ext || (mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg');
    const uploadsDir = path.join(CASES_DATA_DIR, caseId, 'uploads', 'pan');
    await fs.mkdir(uploadsDir, { recursive: true });

    const filename = `${kind}_${crypto.randomUUID()}.${safeExt}`;
    const outPath = path.join(uploadsDir, filename);
    await fs.writeFile(outPath, file.buffer);

    const url = `/case-data/${encodeURIComponent(caseId)}/uploads/pan/${encodeURIComponent(filename)}`;
    res.json({ success: true, caseId, url, filename, mime });
  } catch (error) {
    logger.error('PAN photo upload error', error);
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

// Udyam PDF upload (stored per case, returned as a /case-data URL)
const udyamUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

app.post('/api/case/:caseId/udyam/pdf', udyamUpload.single('document'), async (req, res) => {
  try {
    const rawCaseId = String(req.params.caseId || '').trim();
    if (!rawCaseId || rawCaseId.toLowerCase() === 'default') {
      return res.status(400).json({ success: false, error: 'caseId is required' });
    }
    const caseId = sanitizeCaseId(rawCaseId);

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, error: 'document file is required (field name: document)' });
    }

    const type = await fileTypeFromBuffer(file.buffer).catch(() => null);
    const mime = type?.mime || file.mimetype || '';
    const ext = (type?.ext || '').toLowerCase();
    const isPdf = String(mime).toLowerCase() === 'application/pdf' || ext === 'pdf';
    if (!isPdf) {
      return res.status(400).json({ success: false, error: 'Unsupported file type. Upload a PDF.' });
    }

    const uploadsDir = path.join(CASES_DATA_DIR, caseId, 'uploads', 'udyam');
    await fs.mkdir(uploadsDir, { recursive: true });

    const filename = `udyam_${crypto.randomUUID()}.pdf`;
    const outPath = path.join(uploadsDir, filename);
    await fs.writeFile(outPath, file.buffer);

    const url = `/case-data/${encodeURIComponent(caseId)}/uploads/udyam/${encodeURIComponent(filename)}`;
    res.json({ success: true, caseId, url, filename, mime: 'application/pdf' });
  } catch (error) {
    logger.error('Udyam PDF upload error', error);
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

/**
 * Load latest snapshot JSON for a module.
 */
app.get('/api/case/:caseId/snapshot/:moduleKey', async (req, res) => {
  try {
    const caseId = sanitizeCaseId(req.params.caseId);
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);

    const snap = await getLatestSnapshot(caseId, moduleKey);
    if (snap) {
      res.json({ success: true, data: { savedAt: snap.savedAt, caseId: snap.caseId, moduleKey: snap.moduleKey, data: snap.data } });
    } else {
      res.json({ success: false, error: 'Snapshot not found' });
    }
  } catch (error) {
    res.json({ success: false, error: 'Snapshot not found' });
  }
});

/**
 * Get case metadata: module statuses + which modules have snapshot data.
 * Used by Report Builder to auto-select completed modules.
 */
app.get('/api/case/:caseId/meta', async (req, res) => {
  try {
    const caseId = sanitizeCaseId(req.params.caseId);
    const meta = await getCaseMeta(caseId);

    res.json({
      success: true,
      ...meta
    });
  } catch (error) {
    logger.error('Case meta error:', error);
    res.status(500).json({ success: false, error: 'Failed to load case metadata' });
  }
});

/**
 * Fetch MCA (Company) data by CIN
 */
app.post('/api/fetch-mca', async (req, res) => {
  try {
    const { cin } = req.body;
    
    if (!cin) {
      return res.status(400).json({
        success: false,
        error: 'CIN (Corporate Identification Number) is required'
      });
    }

    logger.info(`MCA data request for CIN: ${cin}`);

    const result = await zaubaService.fetchCompanyData(cin);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to fetch MCA data'
      });
    }
  } catch (error) {
    logger.error('MCA fetch error', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Search companies by name or CIN on ZaubaCorp
 */
app.post('/api/search-companies', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        results: []
      });
    }

    logger.info(`Searching companies for query: ${query}`);

    const result = await searchService.searchCompanies(query);

    res.json(result);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search temporarily unavailable',
      results: []
    });
  }
});

/**
 * MCA Official Company Search (NEW)
 * Returns list of companies with Name, CIN, State, Status
 */
app.post('/api/mca/search-companies', async (req, res) => {
  try {
    const { companyName } = req.body;

    if (!companyName || companyName.trim().length < 3) {
      return res.json({
        success: true,
        companies: []
      });
    }

    logger.info(`MCA search for company: ${companyName}`);

    const companies = await mcaSearchService.searchCompanies(companyName);

    res.json({
      success: true,
      companies: companies,
      count: companies.length
    });
  } catch (error) {
    logger.error('MCA search error:', error);
    res.status(500).json({
      success: false,
      error: 'MCA search temporarily unavailable',
      companies: []
    });
  }
});

/**
 * Fetch Director data by DIN
 */
app.post('/api/fetch-director', async (req, res) => {
  try {
    const { din } = req.body;
    
    if (!din) {
      return res.status(400).json({
        success: false,
        error: 'DIN (Director Identification Number) is required'
      });
    }

    logger.info(`Director data request for DIN: ${din}`);

    const result = await zaubaService.fetchDirectorData(din);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to fetch director data'
      });
    }
  } catch (error) {
    logger.error('Director fetch error', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Generate AI summary for a module snapshot
 */
app.post('/api/module-ai-summary', async (req, res) => {
  try {
    const blockKey = String(req.body?.blockKey || 'business').trim().toLowerCase() === 'personal' ? 'personal' : 'business';
    const moduleKey = sanitizeModuleKey(req.body?.moduleKey || 'module');
    const moduleLabel = String(req.body?.moduleLabel || moduleKey).trim() || moduleKey;
    const moduleData = req.body?.moduleData && typeof req.body.moduleData === 'object' ? req.body.moduleData : {};

    if (!Object.keys(moduleData).length) {
      return res.status(400).json({ success: false, error: 'moduleData is required' });
    }

    const payloadTextRaw = JSON.stringify(moduleData, null, 2);
    const payloadText = payloadTextRaw.length > 12000
      ? `${payloadTextRaw.slice(0, 12000)}\n... [truncated]`
      : payloadTextRaw;

    let summary = '';

    if (isBedrockConfigured()) {
      try {
        const prompt = [
          'You are a banking compliance analyst.',
          'You generate grounded module summaries for underwriting workflow. Use only provided module JSON; no hallucinations.',
          'Create a concise, neutral summary in 4-6 bullet points.',
          'Do not invent facts. Use only the provided JSON.',
          `Block: ${blockKey}`,
          `Module: ${moduleLabel}`,
          'JSON:',
          payloadText
        ].join('\n');

        summary = await callClaude(prompt);
      } catch (err) {
        logger.warn(`module-ai-summary bedrock fallback: ${err?.message || err}`);
      }
    }

    if (!summary) {
      summary = buildFallbackModuleSummary({ moduleLabel, moduleData });
    }

    return res.json({
      success: true,
      blockKey,
      moduleKey,
      moduleLabel,
      summary
    });
  } catch (error) {
    logger.error('Module AI summary error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to generate module summary' });
  }
});

/**
 * PDF page count helper (for UI progress)
 * Input: { fileBase64, mimeType? }
 */
app.post('/api/pdf/page-count', async (req, res) => {
  try {
    const fileBase64 = String(req.body?.fileBase64 || '').trim();
    if (!fileBase64) {
      return res.status(400).json({ success: false, error: 'fileBase64 is required' });
    }

    const providedMime = req.body?.mimeType ? String(req.body.mimeType) : '';
    const mimeType = providedMime || (await detectMimeTypeFromBase64(fileBase64));
    if (mimeType !== 'application/pdf') {
      return res.json({ success: true, mimeType, pageCount: null, note: 'Not a PDF' });
    }

    const pageCount = await withTimeout(getPdfPageCountFromBase64(fileBase64), 30000, 'pdf_page_count');
    return res.json({ success: true, mimeType, pageCount });
  } catch (error) {
    logger.error('PDF page-count error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to count pages' });
  }
});

function withTimeout(promise, ms, label) {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms${label ? ` (${label})` : ''}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHttpStatusCode(err) {
  const direct = err?.status ?? err?.statusCode;
  if (Number.isFinite(direct)) return Number(direct);
  const resp = err?.response?.status ?? err?.response?.statusCode;
  if (Number.isFinite(resp)) return Number(resp);
  const nested = err?.response?.data?.error?.code;
  if (Number.isFinite(nested)) return Number(nested);
  return null;
}

async function getPdfPageCountFromBase64(base64) {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function detectMimeTypeFromBase64(base64) {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  const ft = await fileTypeFromBuffer(buf);
  return ft?.mime || 'application/octet-stream';
}

// Integrated bank parsing / extract-data helpers removed.

/**
 * Generate AI verification summary for a single report module
 */
app.post('/api/report/module-verification-summary', async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.body?.moduleKey || 'module');
    const moduleLabel = String(req.body?.moduleLabel || moduleKey).trim() || moduleKey;
    const moduleData = req.body?.moduleData && typeof req.body.moduleData === 'object' ? req.body.moduleData : {};
    const companyName = String(req.body?.companyName || '').trim();
    const companyContext = req.body?.companyContext && typeof req.body.companyContext === 'object' ? req.body.companyContext : {};
    const allModuleData = req.body?.allModuleData && typeof req.body.allModuleData === 'object' ? req.body.allModuleData : {};
    const entityProfile = req.body?.entityProfile && typeof req.body.entityProfile === 'object' ? req.body.entityProfile : {};

    if (!Object.keys(moduleData).length) {
      return res.json({ success: true, moduleKey, summary: 'No data available for this module.' });
    }

    const payloadTextRaw = JSON.stringify(moduleData, null, 2);
    const isFinancialModule = moduleKey === 'financial';
    const maxPayloadSize = isFinancialModule ? 30000 : 14000;
    const payloadText = payloadTextRaw.length > maxPayloadSize
      ? `${payloadTextRaw.slice(0, maxPayloadSize)}\n... [truncated]`
      : payloadTextRaw;

    let summary = '';
    if (isBedrockConfigured()) {
      try {

        // Build company context string for enrichment
        const companyCtxLines = [];
        if (companyName) companyCtxLines.push(`Company Name: ${companyName}`);
        if (companyContext.cin) companyCtxLines.push(`CIN: ${companyContext.cin}`);
        if (companyContext.gstin) companyCtxLines.push(`GSTIN: ${companyContext.gstin}`);
        if (companyContext.constitution) companyCtxLines.push(`Constitution: ${companyContext.constitution}`);
        if (companyContext.status) companyCtxLines.push(`Status: ${companyContext.status}`);
        if (companyContext.incorporationDate) companyCtxLines.push(`Incorporation: ${companyContext.incorporationDate}`);
        if (companyContext.registeredOffice) companyCtxLines.push(`Registered Office: ${companyContext.registeredOffice}`);
        const companyCtxBlock = companyCtxLines.length
          ? `\nCompany Context:\n${companyCtxLines.join('\n')}\n`
          : '';

        // Special enhanced prompt for COMPLIANCE module
        const isCompliance = moduleKey === 'compliance';
        const isFinancial = moduleKey === 'financial';

        // Build cross-module context for financial analysis
        let allModuleDataBlock = '';
        if (isFinancial && Object.keys(allModuleData).length > 0) {
          const crossDataRaw = JSON.stringify(allModuleData, null, 2);
          // Allow generous size for cross-module data (truncate at 20k chars)
          allModuleDataBlock = crossDataRaw.length > 20000
            ? `${crossDataRaw.slice(0, 20000)}\n... [truncated]`
            : crossDataRaw;
        }

        let prompt;

        if (isFinancial) {
          // Build entity profile context from case_overview + additional_details
          const ep = entityProfile;
          const entityName = ep.entityName || companyName || 'N/A';
          const constitution = ep.constitution || companyContext.constitution || 'N/A';
          const msmeCategory = ep.msmeCategory || 'N/A';
          const industrySector = ep.industrySector || ep.industry || 'N/A';
          const natureOfActivity = ep.natureOfActivity || 'N/A';
          const businessAge = ep.businessAge || 'N/A';
          const location = ep.location || companyContext.registeredOffice || 'N/A';
          const employeeCount = ep.employeeCount || 'N/A';

          prompt = [
            `You are a senior financial analyst with deep expertise in Indian MSME lending, credit appraisal, and industry benchmarking.`,
            `You must analyze based on:`,
            `1. The COMPANY TYPE and its typical financial behavior`,
            `2. Current MARKET CONDITIONS in India (FY 2024-25)`,
            `3. INDUSTRY-SPECIFIC benchmarks — not generic standards`,
            `4. Actual FINANCIAL DATA provided`,
            ``,
            `═══════════════════════════════════════`,
            `COMPANY CONTEXT (Read this first)`,
            `═══════════════════════════════════════`,
            `- Entity Name        : ${entityName}`,
            `- Constitution       : ${constitution}`,
            `  (Pvt Ltd / LLP / Proprietorship / Partnership)`,
            `- Enterprise Category: ${msmeCategory}`,
            `  (Micro / Small / Medium / Large)`,
            `- Industry / Sector  : ${industrySector}`,
            `- Nature of Activity : ${natureOfActivity}`,
            `  (Manufacturing / Trading / Services)`,
            `- Business Age       : ${businessAge} years`,
            `- Location           : ${location}`,
            `- Total Employees    : ${employeeCount}`,
            ``,
            companyCtxBlock,
            ``,
            `═══════════════════════════════════════`,
            `FINANCIAL DATA (3 Years — Calculated by Engine)`,
            `═══════════════════════════════════════`,
            payloadText,
            ``,
            `═══════════════════════════════════════`,
            `OTHER MODULE DATA (GST, MCA, Compliance, PAN, ITR, Bank Statement, etc.):`,
            allModuleDataBlock || 'No cross-module data available.',
            ``,
            `═══════════════════════════════════════`,
            `YOUR ANALYSIS FRAMEWORK`,
            `═══════════════════════════════════════`,
            ``,
            `STEP 1 — UNDERSTAND THE ENTITY TYPE FIRST:`,
            `Before analyzing numbers, establish:`,
            `- What kind of company is this? (Early stage / Growth / Mature / Declining)`,
            `- What are TYPICAL financials for this industry + size + age combination?`,
            `- What does RBI / SIDBI / industry bodies say about this sector's current health?`,
            `- What external factors affect this industry right now? (Raw material prices, GST changes, export demand, govt schemes like PLI etc.)`,
            ``,
            `STEP 2 — BENCHMARK AGAINST INDUSTRY:`,
            `Do NOT use generic benchmarks. Use sector-specific standards:`,
            ``,
            `For MANUFACTURING MSME:`,
            `- Gross Margin benchmark: 25-45%`,
            `- Current Ratio healthy: 1.2 - 1.8`,
            `- Debt/Equity acceptable: upto 3:1`,
            `- Collection period normal: 45-90 days`,
            ``,
            `For TRADING COMPANY:`,
            `- Gross Margin benchmark: 8-20%`,
            `- Inventory turnover critical metric`,
            `- Working capital cycle most important`,
            `- Thin margins are NORMAL — do not penalize`,
            ``,
            `For SERVICE COMPANY:`,
            `- Asset-light model — low fixed assets NORMAL`,
            `- Employee cost as % of revenue key metric`,
            `- Receivables management critical`,
            `- High EBITDA margin expected: 20-40%`,
            ``,
            `For MICRO ENTERPRISE (Udyam):`,
            `- Informal revenue possible — be lenient`,
            `- Limited audit history is normal`,
            `- Focus on cash flow over accrual profits`,
            `- GST filing consistency more important`,
            ``,
            `STEP 3 — CONTEXTUALIZE WITH MARKET:`,
            `Consider current Indian market reality:`,
            `- Post-COVID recovery still ongoing in some sectors`,
            `- RBI repo rate impact on borrowing costs`,
            `- Input cost inflation in manufacturing`,
            `- Digital payment adoption changing working capital`,
            `- Government schemes benefiting MSMEs (ECLGS, CGTMSE, Mudra etc.)`,
            ``,
            `STEP 4 — WRITE THE SUMMARY:`,
            `Now write a balanced summary covering:`,
            ``,
            `A) **BUSINESS CONTEXT**`,
            `   - What this company does and where it stands in its industry lifecycle`,
            `   - Is the business model viable given current market conditions?`,
            ``,
            `B) **FINANCIAL PERFORMANCE**`,
            `   - Revenue trend vs industry growth rate`,
            `   - Profitability — is it inline with sector norms?`,
            `   - Are margins improving, stable, or declining?`,
            `   - Key ratio analysis vs industry benchmarks`,
            ``,
            `C) **BALANCE SHEET STRENGTH**`,
            `   - Asset quality and composition`,
            `   - Debt levels — acceptable for this company type?`,
            `   - Net worth trend`,
            `   - Working capital adequacy`,
            ``,
            `D) **RISK FACTORS** (Specific, not generic)`,
            `   - Risks specific to THIS company type`,
            `   - Risks specific to THIS industry right now`,
            `   - Risks from the financial data`,
            ``,
            `E) **POSITIVE INDICATORS**`,
            `   - Genuine strengths, not just absence of negatives`,
            `   - Growth trajectory assessment`,
            `   - Management's financial discipline indicators`,
            ``,
            `F) **OVERALL ASSESSMENT**`,
            `   - Is this company creditworthy FOR ITS TYPE?`,
            `   - Compare to peers in same sector/size/age`,
            `   - Clear stance: **STRONG / ADEQUATE / MARGINAL / WEAK**`,
            ``,
            `RULES:`,
            `- Use ONLY the provided data. Do NOT invent numbers or facts.`,
            `- Do NOT give generic/boilerplate responses. Every sentence must be specific to THIS company.`,
            `- Cite specific values, amounts (in Lakhs/Crores as appropriate), percentages, dates.`,
            `- If a data section is missing, note "Data not available" and move on.`,
            `- For cross-module observations, only comment on modules whose data is provided.`,
            `- Be analytical, not just descriptive — provide insights and flags, not just restatements.`,
            `- Keep it professional, structured, and banker-grade.`,
          ].join('\n');
        } else if (isCompliance) {
          prompt = [
            `You are a senior banking compliance analyst preparing the Compliance & Adverse Check section of a Pre-Sanction Due Diligence report.`,
            ``,
            `TASK:`,
            `1. Analyze the compliance check data provided below and produce a verification summary (4-6 bullet points).`,
            `2. If the company name "${companyName || 'N/A'}" is publicly well-known (e.g., a recognized brand, listed company, or major entity), ADD a "PUBLIC PROFILE" sub-section with:`,
            `   - Brief description of the company's public standing, industry, and reputation`,
            `   - Any widely known regulatory history, controversies, or accolades`,
            `   - Note: ONLY add this if you genuinely recognize the company. If the company is not publicly well-known or you are unsure, simply write "Public profile: Not a widely recognized public entity — relying solely on verification data."`,
            `3. Provide a one-line verdict: CLEAN / ATTENTION REQUIRED / ADVERSE FOUND / INCOMPLETE DATA.`,
            ``,
            `Rules:`,
            `- For the compliance verification summary, use ONLY the provided JSON data. Do not invent findings.`,
            `- For the PUBLIC PROFILE section, you may use your general knowledge of publicly known companies. Clearly label it as general knowledge.`,
            `- Be specific: cite actual values, sources (NCLT/SEBI/Court/Exchange), dates from the data.`,
            `- If any adverse flag is found in the data, highlight it prominently.`,
            `- Keep it professional, neutral, and concise.`,
            ``,
            companyCtxBlock,
            `Module: ${moduleLabel} (${moduleKey})`,
            `Compliance Check Data JSON:`,
            payloadText
          ].join('\n');
        } else {
          prompt = [
            `You are a senior banking credit analyst preparing a Pre-Sanction Due Diligence report.`,
            `Analyze the following "${moduleLabel}" module data and produce:`,
            `1. A crisp verification summary (3-5 bullet points) covering what was verified, key findings, and any red flags or concerns.`,
            `2. A one-line verification verdict: VERIFIED / ATTENTION REQUIRED / INCOMPLETE DATA.`,
            ``,
            `Rules:`,
            `- Use ONLY the provided JSON data. Do not invent facts.`,
            `- Be specific: cite actual values, dates, numbers from the data.`,
            `- Format as: SUMMARY bullet points, then VERDICT line.`,
            `- Keep it professional, neutral, and concise.`,
            ``,
            companyCtxBlock,
            `Module: ${moduleLabel} (${moduleKey})`,
            `Data JSON:`,
            payloadText
          ].join('\n');
        }

        summary = await callClaude(prompt);
      } catch (err) {
        logger.warn(`report module-verification-summary Bedrock error: ${err?.message || err}`);
      }
    }

    if (!summary) {
      const keys = Object.keys(moduleData);
      summary = `• Module "${moduleLabel}" contains ${keys.length} data field(s).\n• Key fields: ${keys.slice(0, 6).join(', ')}.\n• VERDICT: Manual review recommended (AI unavailable).`;
    }

    return res.json({ success: true, moduleKey, moduleLabel, summary });
  } catch (error) {
    logger.error('Report module verification summary error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to generate module summary' });
  }
});

/**
 * Generate overall AI observation for the entire report (all modules combined)
 */
app.post('/api/report/overall-observation', async (req, res) => {
  try {
    const caseId = String(req.body?.caseId || '').trim();
    const companyName = String(req.body?.companyName || 'Company').trim();
    const moduleSummaries = req.body?.moduleSummaries && typeof req.body.moduleSummaries === 'object'
      ? req.body.moduleSummaries : {};
    const modules = req.body?.modules && typeof req.body.modules === 'object'
      ? req.body.modules : {};

    const summaryEntries = Object.entries(moduleSummaries);
    if (!summaryEntries.length && !Object.keys(modules).length) {
      return res.json({ success: true, observation: 'No module data available for overall observation.' });
    }

    let observation = '';
    if (isBedrockConfigured()) {
      try {

        let dataBlock = '';
        if (summaryEntries.length) {
          dataBlock += 'MODULE-WISE VERIFICATION SUMMARIES:\n';
          for (const [key, sumText] of summaryEntries) {
            dataBlock += `\n--- ${key.toUpperCase()} ---\n${String(sumText).slice(0, 2000)}\n`;
          }
        }

        const modulesJson = JSON.stringify(modules, null, 2);
        const modulesText = modulesJson.length > 15000
          ? `${modulesJson.slice(0, 15000)}\n... [truncated]`
          : modulesJson;
        dataBlock += '\nRAW MODULE DATA (for cross-reference):\n' + modulesText;

        const prompt = [
          `You are a senior credit analyst at a scheduled commercial bank drafting a COMPREHENSIVE CREDIT APPRAISAL NOTE as part of a Pre-Sanction Due Diligence report.`,
          ``,
          `Company / Applicant: ${companyName}`,
          `Case Reference: ${caseId}`,
          ``,
          `Using ALL module verification summaries and raw data provided below, produce a structured credit appraisal note with the following 10 sections. Each section must cite specific data points from the modules. Do NOT invent any data not present in the input.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 1: ENTITY OVERVIEW & CONSTITUTION`,
          `═══════════════════════════════════════════`,
          `• Legal name, trade name, PAN, GSTIN, Udyam Registration (if available).`,
          `• Constitution of business (Proprietorship / Partnership / Pvt Ltd / LLP / etc.).`,
          `• Date of incorporation / registration, principal place of business, state.`,
          `• Nature of business activities and goods/services dealt in (from GST HSN/SAC data).`,
          `• Vintage of the entity (years since incorporation).`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 2: PROMOTER & DIRECTOR ASSESSMENT`,
          `═══════════════════════════════════════════`,
          `• Key promoters / directors — name, DIN, date of appointment, designation.`,
          `• Identify if directors are common across multiple entities (cross-directorship flags).`,
          `• Any director disqualification, struck-off company association, or DIN de-activation.`,
          `• Promoter's experience and background as inferable from available data.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 3: BUSINESS PROFILE & ACTIVITY ANALYSIS`,
          `═══════════════════════════════════════════`,
          `• Core business activity as declared in GST / MCA records.`,
          `• Consistency check: whether the declared business matches industry codes, HSN/SAC, and MCA objects.`,
          `• Any observable change in business activity, addition/removal of goods/services.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 4: GST REGISTRATION & FILING COMPLIANCE`,
          `═══════════════════════════════════════════`,
          `• GSTIN status (Active / Suspended / Cancelled), effective date of registration.`,
          `• Aadhaar authentication status, e-Invoice applicability, e-KYC status.`,
          `• GSTR-1 and GSTR-3B filing regularity — any delays, gaps, or non-filing periods.`,
          `• Cross-check: name consistency between GST legal name and MCA / PAN records.`,
          `• Overall GST compliance rating (Excellent / Good / Average / Poor).`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 5: FINANCIAL PERFORMANCE & RATIO ANALYSIS`,
          `═══════════════════════════════════════════`,
          `• Revenue trends (Net Sales YoY growth), profitability (PBILDT, PAT margins).`,
          `• Balance Sheet strength: Net Worth, Total Debt, Tangible Net Worth.`,
          `• Key ratios: Current Ratio, Debt-to-Equity, DSCR, Interest Coverage, ROCE.`,
          `• Cash flow position: Operating cash flow, cash accruals, working capital cycle.`,
          `• Turnover ratios: Debtor days, Creditor days, Inventory days.`,
          `• Highlight any deterioration or improvement trends across periods.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 6: MCA & REGULATORY COMPLIANCE`,
          `═══════════════════════════════════════════`,
          `• Company status on MCA (Active / Struck-off / Under liquidation).`,
          `• Annual return and financial statement filing status.`,
          `• Any charges registered, satisfaction pending, or modification history.`,
          `• ROC compliance observations (delayed filings, penalties).`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 7: ADVERSE & LITIGATION CHECK`,
          `═══════════════════════════════════════════`,
          `• CIBIL / credit bureau observations (if available).`,
          `• NCLT / IBC proceedings, SEBI debarment, RBI defaulter list checks.`,
          `• Court case search results — civil, criminal, tax tribunals.`,
          `• Wilful defaulter / fraud classification check.`,
          `• Summary: Clean / Adverse flag with specific details.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 8: SITE / FIELD VISIT & PHYSICAL VERIFICATION`,
          `═══════════════════════════════════════════`,
          `• Observations from field visit photos and verification data (if available).`,
          `• Physical verification of business premises, stock, plant & machinery.`,
          `• Neighbourhood / market enquiry findings.`,
          `• If no field data available, state "Field verification data not provided."`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 9: KEY STRENGTHS & RISK CONCERNS`,
          `═══════════════════════════════════════════`,
          `• STRENGTHS (3-5 bullet points): Positive indicators from all modules.`,
          `• CONCERNS / RED FLAGS (3-5 bullet points): Risk areas, discrepancies, adverse findings.`,
          `• MITIGANTS (if any): Factors that offset the identified concerns.`,
          ``,
          `═══════════════════════════════════════════`,
          `SECTION 10: OVERALL ASSESSMENT & RECOMMENDATION`,
          `═══════════════════════════════════════════`,
          `• Synthesize all findings into a cohesive 3-5 sentence summary paragraph.`,
          `• Cross-reference consistency across modules (entity name, address, business activity).`,
          `• Final recommendation — one of:`,
          `  ✅ PROCEED — All verifications satisfactory, no material adverse findings.`,
          `  ⚠️ PROCEED WITH CAUTION — Minor observations that need monitoring.`,
          `  🔍 REQUIRES FURTHER REVIEW — Material gaps or discrepancies needing additional due diligence.`,
          `  ❌ NOT RECOMMENDED — Significant adverse findings or integrity concerns.`,
          ``,
          `══════════════════════════════════════`,
          `FORMATTING & STYLE RULES:`,
          `══════════════════════════════════════`,
          `- Write in third person, formal bank credit language.`,
          `- Use exact figures, percentages, and dates from the data — do NOT round or approximate.`,
          `- Each section must have a heading line (e.g., "1. ENTITY OVERVIEW & CONSTITUTION").`,
          `- Use bullet points within sections for readability.`,
          `- If data for a section is not available, write: "Data not available in the current verification scope."`,
          `- Cross-reference across modules wherever possible (e.g., GST name vs MCA name, PAN vs ITR details).`,
          `- Do NOT fabricate or hallucinate any information. Only reference data from the input below.`,
          `- Keep total output between 800-1500 words.`,
          ``,
          dataBlock
        ].join('\n');

        observation = await callClaude(prompt);
      } catch (err) {
        logger.warn(`report overall-observation Bedrock error: ${err?.message || err}`);
      }
    }

    if (!observation) {
      const modList = summaryEntries.map(([k]) => k).join(', ') || Object.keys(modules).join(', ');
      observation = `Overall observation for ${companyName}: Modules reviewed — ${modList}. Manual review is recommended as AI analysis is unavailable.`;
    }

    return res.json({ success: true, observation, caseId, companyName });
  } catch (error) {
    logger.error('Report overall observation error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to generate overall observation' });
  }
});

/**
 * Generate Pre‑Sanction Due Diligence Report (PDF) — bank-grade fixed structure
 */
app.post('/api/generate-due-diligence-report', async (req, res) => {
  try {
    const hydratedPayload = await hydrateDueDiligencePayloadFromCase(req.body || {});
    const payload = await attachDefaultSignStamp(hydratedPayload);
    const caseId = payload?.case?.caseId || payload?.caseId || 'CASE';
    const companyName =
      payload?.case?.companyName ||
      payload?.case?.businessName ||
      payload?.mcaData?.companyName ||
      payload?.gstData?.legalName ||
      'Company';

    logger.info(`Generating due diligence report for case: ${caseId}`);

    // Read raw Udyam PDF buffer for direct page-merge into report (avoids broken image conversion)
    const udyamPdfUrl = payload?.modules?.udyam?.pdf_url || payload?.modules?.udyam?.data?.pdf_url || '';
    logger.info(`Udyam PDF URL resolved: "${udyamPdfUrl}" | modules.udyam keys: ${JSON.stringify(Object.keys(payload?.modules?.udyam || {}))}`);
    if (udyamPdfUrl && typeof udyamPdfUrl === 'string' && udyamPdfUrl.includes('/case-data/')) {
      try {
        const relPath = udyamPdfUrl.replace(/^\/case-data\//, '');
        const pdfFilePath = path.join(CASES_DATA_DIR, decodeURIComponent(relPath));
        const pdfBuf = await fs.readFile(pdfFilePath);
        payload.udyamPdfBase64 = pdfBuf.toString('base64');
        logger.info('Udyam PDF buffer loaded for direct merge into report');
      } catch (udyamErr) {
        logger.warn('Could not read Udyam PDF for merge:', udyamErr?.message || udyamErr);
      }
    }

    const pdfBuffer = await reportService.generatePreSanctionDueDiligencePDF(payload);

    const safeName = String(companyName).replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_PreSanction_DueDiligence.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Due diligence report generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate due diligence report'
    });
  }
});

/**
 * Compliance & Risk Intelligence Check
 * Searches across NCLT, Courts, SEBI, Stock Exchanges, SFIO, FIU
 */
app.post('/api/check-compliance', async (req, res) => {
  try {
    const { companyIdentifier } = req.body;

    if (!companyIdentifier) {
      return res.status(400).json({
        success: false,
        error: 'Company name or CIN is required'
      });
    }

    logger.info(`Compliance check request for: ${companyIdentifier}`);

    const complianceData = await complianceService.checkCompliance(companyIdentifier);

    res.json({
      success: true,
      data: complianceData
    });

  } catch (error) {
    logger.error('Compliance check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to complete compliance check'
    });
  }
});

/**
 * Generate full Compliance Report PDF (all module details + summary)
 * Accepts either precomputed complianceData or companyIdentifier to compute fresh data.
 */
app.post('/api/check-compliance/pdf', async (req, res) => {
  try {
    const { companyIdentifier, complianceData } = req.body || {};

    let reportPayload = null;

    if (complianceData && typeof complianceData === 'object') {
      reportPayload = complianceData;
    } else {
      if (!companyIdentifier) {
        return res.status(400).json({
          success: false,
          error: 'companyIdentifier or complianceData is required'
        });
      }

      logger.info(`Compliance PDF request for: ${companyIdentifier}`);
      reportPayload = await complianceService.checkCompliance(companyIdentifier);
    }

    const companyName =
      reportPayload?.companyName ||
      reportPayload?.companyIdentity?.legalName ||
      companyIdentifier ||
      'Company';

    const pdfBuffer = await reportService.generateComplianceFullReportPDF(reportPayload);

    const safeName = String(companyName).replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Compliance_Full_Report.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Compliance PDF generation error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to generate compliance PDF report'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server (connect MongoDB first)
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║    GST & MCA Record Fetcher - Web Server Started             ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
    console.log(`🍃 MongoDB: Connected`);
    console.log(`🤖 AI (Bedrock): ${isBedrockConfigured() ? 'Configured ✅' : 'NOT configured ❌'}`);
    console.log(`🌐 Frontend URL: http://localhost:${PORT}\n`);
    console.log('API Endpoints:');
    console.log(`  GET  /api/health`);
    console.log(`  GET  /api/captcha?gstin=XXX`);
    console.log(`  POST /api/gst/search`);
    console.log(`  GET  /api/filing/years`);
    console.log(`  POST /api/filing/status`);
    console.log(`  POST /api/fetch-mca (Company Data)`);
    console.log(`  POST /api/search-companies (Autocomplete Search)`);
    console.log(`  POST /api/mca/search-companies (MCA Official Search)`);
  console.log(`  POST /api/fetch-director (Director Details)`);
  console.log(`  POST /api/check-compliance (Compliance Risk Check - NEW)\n`);
  console.log(`  POST /api/check-compliance/pdf (Compliance Full PDF - NEW)\n`);
  console.log(`  POST /api/financial-model/analyze (Financial Analysis)\n`);
  console.log(`  GET  /api/financial-calc/schema (Financial Calc Schema)`);
  console.log(`  POST /api/financial-calc/calculate (Financial Calc Engine)`);
  console.log(`  POST /api/financial-calc/report (Financial Calc Report Section)\n`);
  
  logger.info(`Server started on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

export default app;
