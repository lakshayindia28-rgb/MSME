(function () {
  const MODULE_KEYS = ['gst', 'mca', 'compliance', 'pan', 'udyam', 'itr', 'bank_statement', 'financial', 'field_data', 'business_summary', 'additional_details'];
  const PERSONAL_MODULE_KEYS = ['applicant', 'pan', 'aadhaar', 'resident_verification', 'personal_itr'];
  const AI_SUMMARY_STORAGE = 'integration.moduleAISummaries';
  const REPORT_CONFIG_STORAGE = 'integration.reportConfig';
  const GST_REPORT_SELECTION_STORAGE = 'integration.gstReportSelection';
  // Custom signature/stamp data URLs (null = use server default)
  let customSignatureDataUrl = null;
  let customStampDataUrl = null;
  // Guard counter: suppress debounced auto-save while data is being restored from server
  // Uses a counter (not boolean) so concurrent async operations don't prematurely unblock.
  let _adLoadingCounter = 0;
  // Guard flag: prevent auto-save until AD data has been loaded at least once from server/storage
  let _adDataLoadedOnce = false;
  function _adBeginLoading() { _adLoadingCounter++; }
  function _adEndLoading() { _adLoadingCounter = Math.max(0, _adLoadingCounter - 1); }
  const STATUS = {
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed'
  };

  const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed'
  };

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatDurationMs(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function startRunEstimate({ containerSelector, textSelector, estimateMs }) {
    const container = qs(containerSelector);
    const textEl = qs(textSelector);
    const targetMs = Math.max(1000, Number(estimateMs) || 0);

    if (!container || !textEl) {
      return {
        stop() {}
      };
    }

    const startedAt = Date.now();
    container.removeAttribute('hidden');

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, targetMs - elapsed);

      if (remaining > 0) {
        textEl.textContent = `Estimated completion in ~${formatDurationMs(remaining)}`;
        return;
      }

      textEl.textContent = `Still processing… elapsed ${formatDurationMs(elapsed)}`;
    };

    tick();
    const intervalId = setInterval(tick, 1000);

    return {
      stop() {
        clearInterval(intervalId);
        container.setAttribute('hidden', 'hidden');
      }
    };
  }

  function estimateFinancialRunMs(fileA, fileB) {
    const sizeA = Number(fileA?.size) || 0;
    const sizeB = Number(fileB?.size) || 0;
    const totalMb = (sizeA + sizeB) / (1024 * 1024);
    const estimate = (90 + (totalMb * 8)) * 1000;
    return clampNumber(estimate, 60000, 480000);
  }

  function estimateFinancialYearwiseRunMs(files = []) {
    const totalBytes = (Array.isArray(files) ? files : []).reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    const totalMb = totalBytes / (1024 * 1024);
    const estimate = (120 + (totalMb * 10)) * 1000;
    return clampNumber(estimate, 90000, 600000);
  }

  function estimateReportRunMs(payload) {
    const selectedCount = Array.isArray(payload?.reportConfig?.selectedModules)
      ? payload.reportConfig.selectedModules.length
      : 0;
    const estimate = (25 + (selectedCount * 7)) * 1000;
    return clampNumber(estimate, 20000, 180000);
  }

  function safeJSONParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  function pathToParts(path) {
    return (path || '')
      .toString()
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^\d+$/.test(p)) return Number(p);
        return p;
      });
  }

  function getByParts(root, parts, fallback) {
    let cur = root;
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur == null ? fallback : cur;
  }

  function setByParts(root, parts, value) {
    if (!root || !parts || !parts.length) return;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      const nextKey = parts[i + 1];
      if (cur[key] == null) {
        cur[key] = typeof nextKey === 'number' ? [] : {};
      }
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function normalizeModuleStatus(value) {
    const v = (value || '').toString().trim();
    if (v === STATUS.pending || v === STATUS.in_progress || v === STATUS.completed) return v;
    return STATUS.pending;
  }

  function readQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const get = (k) => (params.get(k) || '').toString().trim();
    return {
      caseId: get('caseId'),
      businessName: get('businessName'),
      businessType: get('businessType'),
      assignedTo: get('assignedTo'),
      gstin: get('gstin'),
      cin: get('cin'),
      block: get('block'),
      view: get('view')
    };
  }

  const q = readQueryParams();

  function applyBlockView(blockKeyRaw) {
    const key = (blockKeyRaw || '').toString().trim().toLowerCase();
    const effectiveKey = key === 'personal' ? 'personal' : key === 'report' ? 'report' : key === 'case_overview' ? 'case_overview' : 'business';
    const caseOverview = qs('[data-block="case_overview"]');
    const business = qs('[data-block="business"]');
    const personal = qs('[data-block="personal"]');
    const report = qs('[data-block="report"]');
    const businessTracker = qs('[data-tracker="business"]');
    const personalTracker = qs('[data-tracker="personal"]');
    const overview = qs('section.overview');
    const main = qs('main.content') || qs('.content');

    if (!business || !personal || !report) return;

    if (main) main.setAttribute('data-active-block', effectiveKey);

    // Hide all blocks first
    if (caseOverview) caseOverview.setAttribute('hidden', '');
    business.setAttribute('hidden', '');
    personal.setAttribute('hidden', '');
    report.setAttribute('hidden', '');
    if (businessTracker) businessTracker.setAttribute('hidden', '');
    if (personalTracker) personalTracker.setAttribute('hidden', '');
    if (overview) overview.setAttribute('hidden', '');

    if (effectiveKey === 'case_overview') {
      if (caseOverview) caseOverview.removeAttribute('hidden');
      return;
    }

    if (effectiveKey === 'business') {
      business.removeAttribute('hidden');
      if (businessTracker) businessTracker.removeAttribute('hidden');
      if (overview) overview.removeAttribute('hidden');
      return;
    }

    if (effectiveKey === 'personal') {
      personal.removeAttribute('hidden');
      if (personalTracker) personalTracker.removeAttribute('hidden');
      return;
    }

    report.removeAttribute('hidden');
  }

  const RAW_CASE_ID = (q.caseId || '').toString().trim();
  const HAS_CASE_ID = Boolean(RAW_CASE_ID) && RAW_CASE_ID.toLowerCase() !== 'default';

  /* ── Gate: redirect to dashboard if no caseId ── */
  if (!HAS_CASE_ID) {
    window.location.replace('/cases');
    return;
  }

  const STORAGE = HAS_CASE_ID ? localStorage : sessionStorage;

  function purgeLegacyDefaultStorage() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cv360.caseWorkspace.default.')) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }

  // Ensure old "default" (no-case) data doesn't linger.
  purgeLegacyDefaultStorage();

  function caseWorkspacePrefix(caseId) {
    const safeId = (caseId || '').toString().trim();
    if (!safeId || safeId.toLowerCase() === 'default') return 'cv360.caseWorkspace.testing.';
    const normalized = safeId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    return `cv360.caseWorkspace.${normalized}.`;
  }

  const PREFIX = caseWorkspacePrefix(q.caseId);
  const storageKey = (suffix) => `${PREFIX}${suffix}`;

  const PERSONAL_INFO_STORAGE = 'integration.personalInfo';

  function defaultPersonalInfo() {
    return {
      applicant: {
        primary: { name: '', mobile: '', email: '', address: '', primary_label: '' },
        designatedPersons: []
      },
      pan: {
        primary: {
          name: '',
          pan_number: '',
          indian_citizen: '',
          status: '',
          date_of_birth: '',
          mobile_number: '',
          address: '',
          verified_document: null,
          verified_document_2: null
        },
        designatedPersons: []
      },
      aadhaar: {
        primary: { name: '', aadhaar_number: '', verified_document: null },
        designatedPersons: []
      },
      resident_verification: {
        primary: {
          promoter_name: '', permanent_address: '', present_address: '', phone: '', mobile: '', email: '',
          residing_at_address: '', ownership: '', present_address_verification: '', residing_since: '', family_members: '', earning_members: '', special_remarks: '',
          landmark: '', locality_type: '',
          society_board: '', name_plate_sighted: '', residence_type: '', no_of_storied: '', lift: '', external_appearance: '', construction_type: '', internal_appearance: '', residence_seen_internally: '', area_of_residence: '', residence_confirmed_society: '',
          asset_television: '', asset_refrigerator: '', asset_ac: '', asset_music_system: '',
          vehicle_4wheeler: '', vehicle_2wheeler: '', vehicle_others: '', vehicle_make_type: '',
          doc_telephone_bill: 'No', doc_electricity_bill: 'No', doc_society_bill: 'No', doc_tax_receipt: 'No', doc_aadhaar_card: 'No', doc_voter_card: 'No', doc_title_deeds: 'No', doc_bank_passbook: 'No', doc_other: '',
          approx_rent: '', approx_value: '', tenant_residing: '', tenant_name: '', tenant_since: '', tenant_rent: '', tenant_docs_verified: '', tenant_confirms_owner: '',
          neighbour1_name: '', neighbour1_phone: '', neighbour2_name: '', neighbour2_phone: '', neighbour_findings: '',
          manual_summary: '', rv_verified_by: '',
          verification_image: null
        },
        designatedPersons: []
      },
      personal_itr: {
        primary: { name: '', itr_entries: [] },
        designatedPersons: []
      }
    };
  }

  /** Migrate old coapplicants/promoters → designatedPersons for backward compat */
  function migrateToDesignatedPersons(moduleData) {
    if (!moduleData || typeof moduleData !== 'object') return moduleData;
    const dp = Array.isArray(moduleData.designatedPersons) ? [...moduleData.designatedPersons] : [];
    if (Array.isArray(moduleData.coapplicants) && moduleData.coapplicants.length) {
      moduleData.coapplicants.forEach(co => {
        if (co && typeof co === 'object') dp.push({ ...co, designation: co.designation || 'Co-Applicant' });
      });
    }
    if (Array.isArray(moduleData.promoters) && moduleData.promoters.length) {
      moduleData.promoters.forEach(pr => {
        if (pr && typeof pr === 'object') dp.push({ ...pr, designation: pr.designation || 'Promoter' });
      });
    }
    moduleData.designatedPersons = dp;
    delete moduleData.coapplicants;
    delete moduleData.promoters;
    return moduleData;
  }

  function readPersonalInfo() {
    const stored = safeJSONParse(STORAGE.getItem(storageKey(PERSONAL_INFO_STORAGE)), null);
    const base = defaultPersonalInfo();
    if (!stored || typeof stored !== 'object') return base;

    // Shallow-merge supported sections only.
    const out = deepClone(base);
    ['applicant', 'pan', 'aadhaar', 'resident_verification', 'personal_itr'].forEach((m) => {
      if (!stored[m] || typeof stored[m] !== 'object') return;
      out[m].primary = { ...out[m].primary, ...(stored[m].primary || {}) };
      out[m].designatedPersons = Array.isArray(stored[m].designatedPersons) ? stored[m].designatedPersons : [];
      // Migrate old coapplicants/promoters
      if ((!out[m].designatedPersons.length) && (Array.isArray(stored[m].coapplicants) || Array.isArray(stored[m].promoters))) {
        migrateToDesignatedPersons(out[m]);
        // Also migrate from stored
        const migrated = { designatedPersons: [], ...stored[m] };
        migrateToDesignatedPersons(migrated);
        out[m].designatedPersons = migrated.designatedPersons;
      }
    });
    return out;
  }

  let _piServerSaveTimer = null;

  /** Strip base64 image data from a personal info payload clone (for localStorage). */
  function _piStripBase64(obj) {
    ['applicant', 'pan', 'aadhaar', 'resident_verification', 'personal_itr'].forEach(function(mk) {
      if (!obj[mk]) return;
      if (Array.isArray(obj[mk].designatedPersons)) {
        obj[mk].designatedPersons.forEach(function(dp) {
          if (Array.isArray(dp.verification_images)) {
            dp.verification_images = dp.verification_images.map(function(img) {
              return { id: img.id, label: img.label, fileName: img.fileName, mimeType: img.mimeType };
            });
          }
          ['verified_document', 'verified_document_2'].forEach(function(docKey) {
            if (dp[docKey] && typeof dp[docKey] === 'object' && dp[docKey].data_url) {
              dp[docKey] = { file_name: dp[docKey].file_name, mime_type: dp[docKey].mime_type, stripped: true };
            }
          });
        });
      }
      if (obj[mk].primary && Array.isArray(obj[mk].primary.verification_images)) {
        obj[mk].primary.verification_images = obj[mk].primary.verification_images.map(function(img) {
          return { id: img.id, label: img.label, fileName: img.fileName, mimeType: img.mimeType };
        });
      }
      ['verified_document', 'verified_document_2'].forEach(function(docKey) {
        if (obj[mk].primary && obj[mk].primary[docKey] && typeof obj[mk].primary[docKey] === 'object' && obj[mk].primary[docKey].data_url) {
          obj[mk].primary[docKey] = { file_name: obj[mk].primary[docKey].file_name, mime_type: obj[mk].primary[docKey].mime_type, stripped: true };
        }
      });
    });
    return obj;
  }

  // Expose strip helper globally so loadSnapshots can use it
  window._piStripBase64ForLocalStorage = _piStripBase64;

  function writePersonalInfo(payload, opts) {
    // Strip large image data URLs before saving to localStorage to avoid QuotaExceededError.
    // The full data (with images) is still saved to the server.
    try {
      const lsPayload = _piStripBase64(JSON.parse(JSON.stringify(payload)));
      STORAGE.setItem(storageKey(PERSONAL_INFO_STORAGE), JSON.stringify(lsPayload));
    } catch (e) {
      console.warn('[writePersonalInfo] localStorage save failed:', e?.message || e);
    }
    setLastUpdatedNow();
    const immediate = opts && opts.immediate;
    // Persist to server — immediate for file uploads, debounced for keystrokes
    if (HAS_CASE_ID && payload && typeof payload === 'object') {
      const doSave = () => {
        PERSONAL_MODULE_KEYS.forEach((mk) => {
          if (payload[mk] && typeof payload[mk] === 'object') {
            saveSnapshotToServer('personal_' + mk, JSON.stringify(payload[mk])).catch(() => {});
          }
        });
        saveSnapshotToServer('personal_info', JSON.stringify(payload)).catch(() => {});
      };
      if (immediate) {
        if (_piServerSaveTimer) clearTimeout(_piServerSaveTimer);
        doSave();
      } else {
        if (_piServerSaveTimer) clearTimeout(_piServerSaveTimer);
        _piServerSaveTimer = setTimeout(doSave, 3000);
      }
    }
  }

  /* ── Personal Module Completion Tracking ── */
  const PERSONAL_COMPLETION_STORAGE = 'integration.personalModuleCompletion';

  function readPersonalModuleCompletion() {
    const parsed = safeJSONParse(STORAGE.getItem(storageKey(PERSONAL_COMPLETION_STORAGE)), null);
    const out = {};
    PERSONAL_MODULE_KEYS.forEach(function(k) {
      out[k] = !!(parsed && parsed[k]);
    });
    return out;
  }

  function writePersonalModuleCompletion(next) {
    const out = {};
    PERSONAL_MODULE_KEYS.forEach(function(k) {
      out[k] = !!(next && next[k]);
    });
    try {
      STORAGE.setItem(storageKey(PERSONAL_COMPLETION_STORAGE), JSON.stringify(out));
    } catch(e) { /* ignore */ }
    setLastUpdatedNow();
    if (HAS_CASE_ID) {
      saveSnapshotToServer('personal_module_completion', JSON.stringify(out)).catch(function() {});
    }
    return out;
  }

  function togglePersonalModuleCompletion(moduleKey) {
    var current = readPersonalModuleCompletion();
    current[moduleKey] = !current[moduleKey];
    var written = writePersonalModuleCompletion(current);
    updatePersonalCompletionUI(written);
    updateUIFromStatuses(readModuleStatuses());
    return written;
  }

  function updatePersonalCompletionUI(completionMap) {
    var cMap = completionMap || readPersonalModuleCompletion();
    PERSONAL_MODULE_KEYS.forEach(function(mk) {
      var isComplete = !!cMap[mk];
      // Update toggle checkbox
      var toggle = document.querySelector('[data-personal-complete-toggle="' + mk + '"]');
      if (toggle) toggle.checked = isComplete;
      // Update tracker dot + status text
      var trackerBtn = qs('.tracker-item[data-personal-module="' + CSS.escape(mk) + '"]');
      if (trackerBtn) {
        var dot = qs('.tracker-dot', trackerBtn);
        var text = qs('.tracker-status', trackerBtn);
        var st = isComplete ? STATUS.completed : (getPersonalModuleDataStatus(mk) ? STATUS.in_progress : STATUS.pending);
        if (dot) {
          dot.setAttribute('data-status', st);
          dot.style.background = 'var(--' + st + ')';
        }
        if (text) text.textContent = STATUS_LABEL[st] || STATUS_LABEL.pending;
      }
    });
  }

  /** Designation presets for the dropdown */
  const DESIGNATION_PRESETS = ['Promoter', 'Co-Applicant', 'Guarantor', 'Director', 'Partner', 'Proprietor', 'Authorized Signatory', 'Trustee'];
  const DESIGNATED_OWNER_MODULE = 'applicant';

  /** Shared reference to the personal info model (set by initPersonalInfoBlock) */
  let _personalInfoModel = null;

  /** Get the full field definitions for a designated person card for a given module */
  function getDesignatedFields(moduleKey) {
    const mk = (moduleKey || '').toString().trim();
    if (mk === 'applicant') {
      return [
        { key: 'name', label: 'Full Name', placeholder: 'e.g., Priya Verma', type: 'text' },
        { key: 'mobile', label: 'Mobile', placeholder: 'e.g., 9876543210', type: 'text' },
        { key: 'email', label: 'Email', placeholder: 'e.g., priya@email.com', type: 'text' },
        { key: 'address', label: 'Address', placeholder: 'Full address', type: 'textarea' }
      ];
    }
    if (mk === 'pan') {
      return [
        { key: 'name', label: 'Name', placeholder: 'e.g., Priya Verma', type: 'text' },
        { key: 'pan_number', label: 'PAN Number', placeholder: 'e.g., AVOPA4637N', type: 'text', transform: 'uppercase' },
        { key: 'indian_citizen', label: 'Indian Citizen', type: 'select', options: ['', 'YES', 'NO'] },
        { key: 'status', label: 'Status', type: 'select', options: ['', 'ACTIVE', 'INACTIVE'] },
        { key: 'date_of_birth', label: 'Date of Birth', placeholder: 'dd/mm/yyyy', type: 'date' },
        { key: 'mobile_number', label: 'Mobile Number', placeholder: 'e.g., 9876543210', type: 'text' },
        { key: 'address', label: 'Address', placeholder: 'Full address', type: 'textarea' },
        { key: 'verified_document', label: 'PAN Image 1', type: 'file', accept: 'image/*,application/pdf,.pdf', hint: 'Upload first PAN image (e.g., front side)' },
        { key: 'verified_document_2', label: 'PAN Image 2', type: 'file', accept: 'image/*,application/pdf,.pdf', hint: 'Upload second PAN image (e.g., back side)' }
      ];
    }
    if (mk === 'aadhaar') {
      return [
        { key: 'name', label: 'Name', placeholder: 'e.g., Priya Verma', type: 'text' },
        { key: 'aadhaar_number', label: 'Aadhaar Number', placeholder: 'e.g., 1234 5678 9012', type: 'text' },
        { key: 'verified_document', label: 'Verified Aadhaar Image', type: 'file', accept: 'image/*,application/pdf,.pdf', hint: 'Upload Aadhaar card image' }
      ];
    }
    if (mk === 'personal_itr') {
      return [
        { key: 'name', label: 'Name', placeholder: 'e.g., Priya Verma', type: 'text' }
      ];
    }
    if (mk === 'resident_verification') {
      return [
        // ── Personal Details (Loan Application) ──
        { type: 'heading', label: 'Personal Details (Loan Application)' },
        { key: 'promoter_name', label: 'Promoter / Applicant Name', placeholder: 'e.g., HARDIK HIMANSHU PANDYA', type: 'text', span: 2 },
        { key: 'permanent_address', label: 'Permanent Address', placeholder: 'Full permanent address', type: 'textarea' },
        { key: 'present_address', label: 'Present Address (If different)', placeholder: 'NA if same', type: 'textarea' },
        { key: 'phone', label: 'Phone', placeholder: 'e.g., NA', type: 'text' },
        { key: 'mobile', label: 'Mobile', placeholder: 'e.g., 9782362458', type: 'text' },
        { key: 'email', label: 'Email', placeholder: 'e.g., applicant@email.com or NA', type: 'text', span: 2 },
        // ── Applicant Verification ──
        { type: 'heading', label: 'Applicant Verification' },
        { key: 'residing_at_address', label: 'Residing at address given?', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'ownership', label: 'Ownership of present house', type: 'select', options: ['', 'Own', 'Rented', 'Ancestral'] },
        { key: 'present_address_verification', label: 'Present address (if other than application)', placeholder: 'NA', type: 'textarea' },
        { key: 'residing_since', label: 'Residing since', placeholder: 'e.g., SINCE BIRTH, 5 YEARS', type: 'text' },
        { key: 'family_members', label: 'Family Members / Persons staying', placeholder: 'e.g., 4 or NOT CONFIRM', type: 'text' },
        { key: 'earning_members', label: 'Number of Earning Members', placeholder: 'e.g., 2', type: 'text' },
        { key: 'special_remarks', label: 'Special Remarks / Findings', placeholder: 'NA', type: 'textarea' },
        // ── Locality ──
        { type: 'heading', label: 'Locality' },
        { key: 'landmark', label: 'Landmark', placeholder: 'e.g., Near Metro Station or NA', type: 'text' },
        { key: 'locality_type', label: 'Locality Type', type: 'select', options: ['', 'Residential', 'Trouble area', 'Chawl', 'Village area', 'Community dominated', 'Industrial area', 'Slum'] },
        // ── Residence Details ──
        { type: 'heading', label: 'Residence Details' },
        { key: 'society_board', label: 'Name of Society Board', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'name_plate_sighted', label: 'Name Plate sighted?', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'residence_type', label: 'Type of Residence', type: 'select', options: ['', 'House', 'Apartment', 'Flat', 'Other'] },
        { key: 'no_of_storied', label: 'No. of Storied', placeholder: 'e.g., G+4TH', type: 'text' },
        { key: 'lift', label: 'Lift', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'external_appearance', label: 'External Appearance', type: 'select', options: ['', 'Good', 'Average', 'Poor'] },
        { key: 'construction_type', label: 'Construction of House', type: 'select', options: ['', 'Pakka', 'Kaccha', 'Semi Pakka'] },
        { key: 'internal_appearance', label: 'Internal Appearance', type: 'select', options: ['', 'Well maintained', 'Painted', 'Poorly maintained', 'NOT CONFIRM'] },
        { key: 'residence_seen_internally', label: 'Residence seen internally?', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'area_of_residence', label: 'Area of Residence', type: 'select', options: ['', 'High Income', 'Middle Income', 'Low Income'] },
        { key: 'residence_confirmed_society', label: 'Confirmed with Society?', type: 'select', options: ['', 'Yes', 'No'], span: 2 },
        // ── Assets Seen ──
        { type: 'heading', label: 'Assets Seen' },
        { key: 'asset_television', label: 'Television', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'asset_refrigerator', label: 'Refrigerator', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'asset_ac', label: 'Air Conditioner', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'asset_music_system', label: 'Music System', type: 'select', options: ['', 'Yes', 'No'] },
        // ── Vehicles ──
        { type: 'heading', label: 'Vehicles' },
        { key: 'vehicle_4wheeler', label: '4 Wheelers', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'vehicle_2wheeler', label: 'Two Wheelers', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'vehicle_others', label: 'Others', type: 'select', options: ['', 'Yes', 'No'] },
        { key: 'vehicle_make_type', label: 'Make and Type', placeholder: 'e.g., Maruti Swift, Honda Activa or NA', type: 'text', span: 2 },
        // ── Document Verified for Address ──
        { type: 'heading', label: 'Document Verified for Address Confirmation' },
        { key: 'doc_telephone_bill', label: 'Telephone Bill', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_electricity_bill', label: 'Electricity Bill', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_society_bill', label: 'Society Bill', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_tax_receipt', label: 'Tax Receipt', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_aadhaar_card', label: 'Aadhaar Card', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_voter_card', label: 'Voter Card', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_title_deeds', label: 'Title Deeds', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_bank_passbook', label: 'Bank Passbook', type: 'select', options: ['No', 'Yes'] },
        { key: 'doc_other', label: 'Any Other (Specify)', placeholder: 'e.g., Passport, Driving Licence or NA', type: 'text', span: 2 },
        // ── Property Details ──
        { type: 'heading', label: 'Property Details' },
        { key: 'approx_rent', label: 'Approximate Rent', placeholder: 'e.g., ₹15,000 or NA', type: 'text' },
        { key: 'approx_value', label: 'Approximate Value', placeholder: 'e.g., ₹50,00,000 or NA', type: 'text' },
        { key: 'tenant_residing', label: 'Tenant Residing?', placeholder: 'NA', type: 'text', span: 2 },
        { key: 'tenant_name', label: 'Tenant Name', placeholder: 'NA', type: 'text' },
        { key: 'tenant_since', label: 'Tenant Since', placeholder: 'NA', type: 'text' },
        { key: 'tenant_rent', label: 'Rent', placeholder: 'NA', type: 'text' },
        { key: 'tenant_docs_verified', label: 'Documents Verified', type: 'select', options: ['', 'Lease agreement', 'Rent payment receipt', 'Any other', 'NA'] },
        { key: 'tenant_confirms_owner', label: 'Tenant confirms owner?', type: 'select', options: ['', 'Yes', 'No', 'NA'], span: 2 },
        // ── Neighbour Feedback ──
        { type: 'heading', label: 'Neighbour Feedback' },
        { key: 'neighbour1_name', label: 'Reference [1] Name', placeholder: 'NA', type: 'text' },
        { key: 'neighbour1_phone', label: 'Reference [1] Phone', placeholder: 'NA', type: 'text' },
        { key: 'neighbour2_name', label: 'Reference [2] Name', placeholder: 'NA', type: 'text' },
        { key: 'neighbour2_phone', label: 'Reference [2] Phone', placeholder: 'NA', type: 'text' },
        { key: 'neighbour_findings', label: 'Findings from Neighbours', placeholder: 'NA', type: 'textarea' },
        // ── Summary ──
        { type: 'heading', label: 'Summary' },
        { key: 'manual_summary', label: 'Manual Summary', placeholder: 'Enter resident verification summary...', type: 'textarea' },
        // ── Verification Images ──
        { type: 'heading', label: 'Verification Images' },
        { key: 'verification_images', label: 'Verification Images (Address Proof / House Photos)', type: 'images', accept: 'image/*', hint: 'Upload labelled photos. Drag & drop cards to reorder.', span: 2 }
      ];
    }
    return [
      { key: 'name', label: 'Name', placeholder: 'Name', type: 'text' },
      { key: 'value', label: 'Value', placeholder: 'value', type: 'text' }
    ];
  }

  /** Build a full designated person card with all module fields */
  function buildDesignatedPersonCard({ moduleKey, index, value }) {
    const fields = getDesignatedFields(moduleKey);
    const card = document.createElement('div');
    card.className = 'dp-card';
    card.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;background:var(--surface);position:relative';

    // Header row: designation + remove button (applicant-owned only)
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)';

    const desigWrap = document.createElement('div');
    desigWrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px';
    const desigLabel = document.createElement('label');
    desigLabel.textContent = 'Designation';
    desigLabel.style.cssText = 'font-size:12px;font-weight:700;color:var(--muted);white-space:nowrap';
    const desigInput = document.createElement('input');
    desigInput.className = 'input';
    desigInput.type = 'text';
    desigInput.placeholder = 'e.g., Promoter, Co-Applicant, Guarantor, Director';
    desigInput.setAttribute('list', 'dp-designation-options');
    desigInput.setAttribute('data-dp-field', `${moduleKey}.designatedPersons.${index}.designation`);
    desigInput.value = (value && value.designation) ? String(value.designation) : '';
    desigInput.style.cssText = 'flex:1;font-weight:600';
    desigWrap.appendChild(desigLabel);
    desigWrap.appendChild(desigInput);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-secondary';
    removeBtn.type = 'button';
    removeBtn.textContent = '✕ Remove';
    removeBtn.style.cssText = 'font-size:11px;padding:4px 10px;color:#dc2626';
    removeBtn.setAttribute('data-dp-remove', `${moduleKey}.${index}`);

    header.appendChild(desigWrap);
    header.appendChild(removeBtn);
    card.appendChild(header);

    // Form fields grid
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

    fields.forEach(f => {
      // Section heading support
      if (f.type === 'heading') {
        const headingEl = document.createElement('div');
        headingEl.style.cssText = 'grid-column:span 2;font-size:12px;font-weight:800;color:var(--accent);padding:8px 0 4px;border-bottom:1px solid var(--border);margin-top:6px;letter-spacing:0.3px;text-transform:uppercase';
        headingEl.textContent = f.label;
        grid.appendChild(headingEl);
        return;
      }

      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'field';
      if (f.type === 'textarea' || f.span === 2) fieldWrap.style.gridColumn = 'span 2';

      const label = document.createElement('label');
      label.textContent = f.label;
      label.style.cssText = 'font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px';
      fieldWrap.appendChild(label);

      const dataPath = `${moduleKey}.designatedPersons.${index}.${f.key}`;

      if (f.type === 'file') {
        fieldWrap.style.gridColumn = 'span 2';
        const existingDoc = (value && value[f.key] && typeof value[f.key] === 'object') ? value[f.key] : null;
        const previewWrap = document.createElement('div');
        previewWrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';

        const inp = document.createElement('input');
        inp.className = 'input';
        inp.type = 'file';
        inp.accept = f.accept || 'image/*';
        inp.setAttribute('data-dp-upload', dataPath);
        inp.setAttribute('data-dp-upload-module', moduleKey);
        inp.setAttribute('data-dp-upload-index', String(index));
        inp.style.cssText = 'flex:1;min-width:200px';
        previewWrap.appendChild(inp);

        // Show existing upload preview
        if (existingDoc && existingDoc.data_url) {
          const thumb = document.createElement('div');
          thumb.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:4px;background:#fff';
          const isImage = (existingDoc.mime_type || '').startsWith('image/') || (existingDoc.data_url || '').startsWith('data:image/');
          if (isImage) {
            const img = document.createElement('img');
            img.src = existingDoc.data_url;
            img.alt = f.label;
            img.style.cssText = 'max-width:80px;max-height:60px;object-fit:contain;border-radius:4px;display:block';
            thumb.appendChild(img);
          } else {
            const span = document.createElement('span');
            span.textContent = '📄 ' + (existingDoc.file_name || 'Uploaded');
            span.style.cssText = 'font-size:11px;color:var(--accent)';
            thumb.appendChild(span);
          }
          previewWrap.appendChild(thumb);
        }

        if (f.hint) {
          const hint = document.createElement('div');
          hint.textContent = f.hint;
          hint.style.cssText = 'font-size:10px;color:var(--muted);width:100%';
          previewWrap.appendChild(hint);
        }

        fieldWrap.appendChild(previewWrap);
      } else if (f.type === 'images') {
        // ── Multi-image upload with drag-and-drop reorder (like primary RV images) ──
        fieldWrap.style.gridColumn = 'span 2';
        const existingImages = (value && Array.isArray(value[f.key])) ? value[f.key] : [];
        let dpImages = [...existingImages];
        let dpDragSrcIdx = null;

        const container = document.createElement('div');

        // Upload row: label + file + add button
        const uploadRow = document.createElement('div');
        uploadRow.style.cssText = 'display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:8px';

        const lblWrap = document.createElement('label');
        lblWrap.style.cssText = 'flex:1;min-width:140px';
        const lblSpan = document.createElement('span');
        lblSpan.className = 'muted';
        lblSpan.style.cssText = 'font-size:11px;display:block;margin-bottom:3px';
        lblSpan.textContent = 'Image Label (optional)';
        const lblInput = document.createElement('input');
        lblInput.type = 'text';
        lblInput.placeholder = 'e.g. House Front, Name Plate…';
        lblInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--surface);color:var(--text)';
        lblWrap.appendChild(lblSpan);
        lblWrap.appendChild(lblInput);

        const fileWrap = document.createElement('label');
        fileWrap.style.cssText = 'flex:0 0 auto';
        const fileSpan = document.createElement('span');
        fileSpan.className = 'muted';
        fileSpan.style.cssText = 'font-size:11px;display:block;margin-bottom:3px';
        fileSpan.textContent = 'Images (multi-select)';
        const fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.accept = f.accept || 'image/*';
        fileInp.multiple = true;
        fileInp.style.cssText = 'font-size:12px';
        fileWrap.appendChild(fileSpan);
        fileWrap.appendChild(fileInp);

        const addImgBtn = document.createElement('button');
        addImgBtn.type = 'button';
        addImgBtn.className = 'btn btn-secondary';
        addImgBtn.style.cssText = 'height:32px;font-size:11px;padding:0 12px';
        addImgBtn.textContent = '+ Add';

        uploadRow.appendChild(lblWrap);
        uploadRow.appendChild(fileWrap);
        uploadRow.appendChild(addImgBtn);
        container.appendChild(uploadRow);

        // Drop zone
        const dropZone = document.createElement('div');
        dropZone.style.cssText = 'border:2px dashed var(--border);border-radius:8px;padding:18px 12px;text-align:center;color:var(--muted);font-size:12px;cursor:pointer;transition:border-color 0.2s,background 0.2s;margin-bottom:8px';
        dropZone.textContent = '📷 Drag & drop images here or click to browse';
        const dropFileInp = document.createElement('input');
        dropFileInp.type = 'file';
        dropFileInp.accept = f.accept || 'image/*';
        dropFileInp.multiple = true;
        dropFileInp.style.display = 'none';
        dropZone.appendChild(dropFileInp);
        container.appendChild(dropZone);

        // Tip
        const tip = document.createElement('div');
        tip.className = 'muted';
        tip.style.cssText = 'font-size:10px;margin-bottom:6px';
        tip.textContent = '💡 Select multiple images. Drag & drop cards to reorder.';
        container.appendChild(tip);

        // Image grid
        const imgGrid = document.createElement('div');
        imgGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px';
        container.appendChild(imgGrid);

        // Empty / count
        const emptyNote = document.createElement('div');
        emptyNote.className = 'muted';
        emptyNote.style.cssText = 'font-size:12px;margin-top:6px';
        emptyNote.textContent = 'No images uploaded yet.';
        container.appendChild(emptyNote);

        const countRow = document.createElement('div');
        countRow.style.cssText = 'margin-top:6px;font-size:11px;color:var(--muted)';
        container.appendChild(countRow);

        function saveImagesToModel() {
          if (!value) return;
          value[f.key] = dpImages;
          // Immediate server save for image uploads (don't lose on quick refresh)
          if (_personalInfoModel) {
            writePersonalInfo(_personalInfoModel, { immediate: true });
          }
        }

        function renderDPImages() {
          if (!dpImages.length) {
            imgGrid.innerHTML = '';
            emptyNote.hidden = false;
            countRow.textContent = '';
            return;
          }
          emptyNote.hidden = true;
          countRow.textContent = 'Total images: ' + dpImages.length;

          imgGrid.innerHTML = dpImages.map((img, idx) => `
            <div class="dp-rv-img-card" draggable="true" data-dp-img-idx="${idx}" style="border:1px solid var(--border);border-radius:7px;overflow:hidden;background:var(--surface);cursor:grab;transition:opacity 0.2s,transform 0.15s">
              <img src="${img.dataUrl}" alt="${img.label || img.fileName}" style="width:100%;height:110px;object-fit:cover;pointer-events:none" />
              <div style="padding:5px 7px;display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:11px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px" title="${img.label || img.fileName}">${img.label || img.fileName}</span>
                <button type="button" data-dp-rv-remove="${img.id}" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:13px;padding:1px 3px" title="Remove">&times;</button>
              </div>
            </div>
          `).join('');

          // Bind remove
          imgGrid.querySelectorAll('[data-dp-rv-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
              dpImages = dpImages.filter(i => i.id !== btn.getAttribute('data-dp-rv-remove'));
              renderDPImages();
              saveImagesToModel();
            });
          });

          // Bind drag-and-drop reorder
          imgGrid.querySelectorAll('.dp-rv-img-card').forEach(c => {
            c.addEventListener('dragstart', (e) => {
              dpDragSrcIdx = parseInt(c.dataset.dpImgIdx);
              c.style.opacity = '0.4';
              e.dataTransfer.effectAllowed = 'move';
            });
            c.addEventListener('dragend', () => {
              c.style.opacity = '1';
              imgGrid.querySelectorAll('.dp-rv-img-card').forEach(x => x.style.border = '1px solid var(--border)');
            });
            c.addEventListener('dragover', (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              c.style.border = '2px solid #3b82f6';
            });
            c.addEventListener('dragleave', () => {
              c.style.border = '1px solid var(--border)';
            });
            c.addEventListener('drop', (e) => {
              e.preventDefault();
              const dropI = parseInt(c.dataset.dpImgIdx);
              if (dpDragSrcIdx !== null && dpDragSrcIdx !== dropI) {
                const moved = dpImages.splice(dpDragSrcIdx, 1)[0];
                dpImages.splice(dropI, 0, moved);
                renderDPImages();
                saveImagesToModel();
              }
              dpDragSrcIdx = null;
            });
          });
        }

        function processDP_Files(files, baseLabel) {
          if (!files || !files.length) return;
          const fileList = Array.from(files).filter(fl => fl.type && fl.type.startsWith('image/'));
          if (!fileList.length) return alert('Please select valid image files.');
          let loaded = 0;
          fileList.forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = () => {
              const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
              const lbl = fileList.length === 1 ? (baseLabel || file.name) : (baseLabel ? `${baseLabel} ${i + 1}` : file.name);
              dpImages.push({ id, label: lbl, fileName: file.name, dataUrl: reader.result, mimeType: file.type || 'image/jpeg' });
              loaded++;
              if (loaded === fileList.length) {
                lblInput.value = '';
                fileInp.value = '';
                renderDPImages();
                saveImagesToModel();
              }
            };
            reader.readAsDataURL(file);
          });
        }

        // Add button
        addImgBtn.addEventListener('click', () => {
          if (!fileInp.files || !fileInp.files.length) return alert('Select image files first.');
          processDP_Files(fileInp.files, lblInput.value.trim());
        });

        // Drop zone events
        dropZone.addEventListener('click', (e) => { if (e.target !== dropFileInp) dropFileInp.click(); });
        dropZone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          dropZone.style.borderColor = '#3b82f6';
          dropZone.style.background = 'rgba(59,130,246,0.06)';
        });
        dropZone.addEventListener('dragleave', () => {
          dropZone.style.borderColor = '';
          dropZone.style.background = '';
        });
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.style.borderColor = '';
          dropZone.style.background = '';
          if (e.dataTransfer?.files?.length) processDP_Files(e.dataTransfer.files, lblInput.value.trim());
        });
        dropFileInp.addEventListener('change', () => {
          if (dropFileInp.files?.length) { processDP_Files(dropFileInp.files, lblInput.value.trim()); dropFileInp.value = ''; }
        });

        renderDPImages();
        fieldWrap.appendChild(container);
      } else if (f.type === 'select') {
        const sel = document.createElement('select');
        sel.className = 'input';
        sel.setAttribute('data-dp-field', dataPath);
        (f.options || []).forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt || 'Select';
          sel.appendChild(o);
        });
        sel.value = (value && value[f.key]) ? String(value[f.key]) : '';
        fieldWrap.appendChild(sel);
      } else if (f.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'notes';
        ta.rows = 2;
        ta.placeholder = f.placeholder || '';
        ta.style.cssText = 'width:100%';
        ta.setAttribute('data-dp-field', dataPath);
        ta.value = (value && value[f.key]) ? String(value[f.key]) : '';
        fieldWrap.appendChild(ta);
      } else {
        const inp = document.createElement('input');
        inp.className = 'input';
        inp.type = f.type || 'text';
        inp.placeholder = f.placeholder || '';
        inp.setAttribute('data-dp-field', dataPath);
        inp.value = (value && value[f.key]) ? String(value[f.key]) : '';
        fieldWrap.appendChild(inp);
      }

      grid.appendChild(fieldWrap);
    });

    card.appendChild(grid);

    // "Done" button — return to summary dashboard after filling this person
    const doneRow = document.createElement('div');
    doneRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)';
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn btn-primary';
    doneBtn.style.cssText = 'font-size:12px;padding:6px 18px';
    doneBtn.textContent = '💾 Save & Done';
    doneBtn.title = 'Save and return to persons dashboard';
    doneBtn.setAttribute('data-dp-done', moduleKey);
    doneRow.appendChild(doneBtn);
    card.appendChild(doneRow);

    return card;
  }

  /** Render all designated person lists across modules */
  function renderDesignatedPersonsLists(model) {
    qsa('[data-dp-list]').forEach((wrap) => {
      const moduleKey = (wrap.getAttribute('data-dp-list') || '').toString().trim();
      if (!moduleKey || !model[moduleKey]) return;
      const list = Array.isArray(model[moduleKey].designatedPersons) ? model[moduleKey].designatedPersons : [];

      wrap.innerHTML = '';
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-note';
        empty.textContent = 'No designated persons added yet. Click "+ Add Designated Person" to add promoters, co-applicants, guarantors, etc.';
        wrap.appendChild(empty);
        return;
      }

      list.forEach((person, idx) => {
        wrap.appendChild(buildDesignatedPersonCard({ moduleKey, index: idx, value: person }));
      });

      // In single-person editing mode, show only the card being edited
      const editSection = wrap.closest('[data-personal-section]');
      const editingAttr = editSection ? (editSection.getAttribute('data-editing-person') || '') : '';
      if (editingAttr.startsWith('dp-')) {
        const visibleIdx = parseInt(editingAttr.replace('dp-', ''), 10);
        const cards = qsa('.dp-card', wrap);
        cards.forEach((cardEl, idx) => {
          if (idx === visibleIdx) {
            cardEl.style.setProperty('display', 'block', 'important');
          } else {
            cardEl.style.setProperty('display', 'none', 'important');
          }
        });
      }
    });

    // Ensure datalist exists in DOM for designation presets
    if (!qs('#dp-designation-options')) {
      const dl = document.createElement('datalist');
      dl.id = 'dp-designation-options';
      DESIGNATION_PRESETS.forEach(p => {
        const o = document.createElement('option');
        o.value = p;
        dl.appendChild(o);
      });
      document.body.appendChild(dl);
    }
  }

  function addDesignatedPerson(model, moduleKey) {
    const mk = (moduleKey || '').toString().trim();
    if (!model[mk]) return;
    if (!Array.isArray(model[mk].designatedPersons)) model[mk].designatedPersons = [];

    // Build empty person with all fields for this module
    const fields = getDesignatedFields(mk);
    const person = { designation: '' };
    fields.forEach(f => { person[f.key] = ''; });
    model[mk].designatedPersons.push(person);
  }

  function findApplicantDraftIndex(model) {
    const list = Array.isArray(model?.applicant?.designatedPersons) ? model.applicant.designatedPersons : [];
    return list.findIndex((person) => Boolean(person && person._draft));
  }

  function ensureSingleApplicantDraft(model) {
    const existingDraft = findApplicantDraftIndex(model);
    if (existingDraft >= 0) return existingDraft;
    addDesignatedPerson(model, 'applicant');
    const list = Array.isArray(model?.applicant?.designatedPersons) ? model.applicant.designatedPersons : [];
    const idx = list.length - 1;
    if (idx >= 0 && list[idx] && typeof list[idx] === 'object') {
      list[idx]._draft = true;
    }
    return idx;
  }

  function clearApplicantDraftFlags(model) {
    const list = Array.isArray(model?.applicant?.designatedPersons) ? model.applicant.designatedPersons : [];
    list.forEach((person) => {
      if (person && typeof person === 'object' && person._draft) {
        delete person._draft;
      }
    });
  }

  function removeDesignatedPerson(model, moduleKey, index) {
    const mk = (moduleKey || '').toString().trim();
    if (!model[mk] || !Array.isArray(model[mk].designatedPersons)) return;
    const idx = typeof index === 'number' ? index : parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= model[mk].designatedPersons.length) return;
    model[mk].designatedPersons.splice(idx, 1);
  }

  function normalizePersonToken(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function applicantPersonKey(person, index) {
    const p = person && typeof person === 'object' ? person : {};
    const name = normalizePersonToken(p.name);
    const designation = normalizePersonToken(p.designation);
    const mobile = normalizePersonToken(p.mobile);
    return [designation, name, mobile, String(index)].join('|');
  }

  function mapApplicantPrimaryToModule(targetModuleKey, targetPrimary, applicantPrimary) {
    const target = targetPrimary && typeof targetPrimary === 'object' ? targetPrimary : {};
    const source = applicantPrimary && typeof applicantPrimary === 'object' ? applicantPrimary : {};

    if ((source.name || '').toString().trim()) {
      target.name = source.name;
    }

    if (targetModuleKey === 'pan') {
      if ((!target.mobile_number || !String(target.mobile_number).trim()) && (source.mobile || '').toString().trim()) {
        target.mobile_number = source.mobile;
      }
      if ((!target.address || !String(target.address).trim()) && (source.address || '').toString().trim()) {
        target.address = source.address;
      }
    }

    if (targetModuleKey === 'resident_verification') {
      if ((!target.promoter_name || !String(target.promoter_name).trim()) && (source.name || '').toString().trim()) {
        target.promoter_name = source.name;
      }
      if ((!target.mobile || !String(target.mobile).trim()) && (source.mobile || '').toString().trim()) {
        target.mobile = source.mobile;
      }
      if ((!target.email || !String(target.email).trim()) && (source.email || '').toString().trim()) {
        target.email = source.email;
      }
      if ((!target.permanent_address || !String(target.permanent_address).trim()) && (source.address || '').toString().trim()) {
        target.permanent_address = source.address;
      }
    }

    if (targetModuleKey === 'personal_itr') {
      if ((source.name || '').toString().trim()) {
        target.name = source.name;
      }
    }

    return target;
  }

  function mapApplicantDesignatedPersonToModule(targetModuleKey, existingTarget, applicantPerson) {
    const prev = existingTarget && typeof existingTarget === 'object' ? existingTarget : {};
    const source = applicantPerson && typeof applicantPerson === 'object' ? applicantPerson : {};
    const out = { ...prev };

    out.designation = source.designation || out.designation || '';
    out.name = source.name || out.name || '';

    if (targetModuleKey === 'pan') {
      out.mobile_number = source.mobile || out.mobile_number || '';
      out.address = source.address || out.address || '';
    }

    if (targetModuleKey === 'resident_verification') {
      out.promoter_name = source.name || out.promoter_name || '';
      out.mobile = source.mobile || out.mobile || '';
      out.email = source.email || out.email || '';
      out.permanent_address = source.address || out.permanent_address || '';
    }

    if (targetModuleKey === 'personal_itr') {
      // Only sync name; ITR entries are person-specific
    }

    return out;
  }

  // Keep linked personal modules aligned with Applicant while preserving module-specific uploads.
  function syncApplicantPeopleIntoPanAndAadhaar(model) {
    if (!model || typeof model !== 'object') return;
    if (!model.applicant || typeof model.applicant !== 'object') return;

    model.pan = model.pan && typeof model.pan === 'object' ? model.pan : { primary: {}, designatedPersons: [] };
    model.aadhaar = model.aadhaar && typeof model.aadhaar === 'object' ? model.aadhaar : { primary: {}, designatedPersons: [] };
    model.resident_verification = model.resident_verification && typeof model.resident_verification === 'object'
      ? model.resident_verification
      : { primary: {}, designatedPersons: [] };
    model.personal_itr = model.personal_itr && typeof model.personal_itr === 'object'
      ? model.personal_itr
      : { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
    model.pan.primary = model.pan.primary && typeof model.pan.primary === 'object' ? model.pan.primary : {};
    model.aadhaar.primary = model.aadhaar.primary && typeof model.aadhaar.primary === 'object' ? model.aadhaar.primary : {};
    model.resident_verification.primary = model.resident_verification.primary && typeof model.resident_verification.primary === 'object'
      ? model.resident_verification.primary
      : {};
    model.personal_itr.primary = model.personal_itr.primary && typeof model.personal_itr.primary === 'object' ? model.personal_itr.primary : { name: '', itr_entries: [] };

    const applicantPrimary = model.applicant.primary && typeof model.applicant.primary === 'object' ? model.applicant.primary : {};
    model.pan.primary = mapApplicantPrimaryToModule('pan', model.pan.primary, applicantPrimary);
    model.aadhaar.primary = mapApplicantPrimaryToModule('aadhaar', model.aadhaar.primary, applicantPrimary);
    model.resident_verification.primary = mapApplicantPrimaryToModule('resident_verification', model.resident_verification.primary, applicantPrimary);
    model.personal_itr.primary = mapApplicantPrimaryToModule('personal_itr', model.personal_itr.primary, applicantPrimary);

    const sourceList = Array.isArray(model.applicant.designatedPersons) ? model.applicant.designatedPersons : [];

    ['pan', 'aadhaar', 'resident_verification', 'personal_itr'].forEach((targetKey) => {
      const existingList = Array.isArray(model[targetKey].designatedPersons) ? model[targetKey].designatedPersons : [];
      const retainedManual = [];
      const linkedByKey = new Map();

      existingList.forEach((person, idx) => {
        const p = person && typeof person === 'object' ? person : {};
        const linkKey = (p._applicantKey || '').toString().trim();
        if (p._linkedFromApplicant && linkKey) {
          linkedByKey.set(linkKey, { ...p });
          return;
        }
        retainedManual.push({ ...p, _existingIndex: idx });
      });

      const usedManual = new Set();
      const linkedNext = sourceList.map((sourcePerson, sourceIdx) => {
        const key = applicantPersonKey(sourcePerson, sourceIdx);
        let existing = linkedByKey.get(key) || null;

        if (!existing) {
          const srcName = normalizePersonToken(sourcePerson?.name);
          const srcDesignation = normalizePersonToken(sourcePerson?.designation);
          const manualMatch = retainedManual.find((candidate) => {
            if (usedManual.has(candidate._existingIndex)) return false;
            const sameName = normalizePersonToken(candidate.name) === srcName;
            const sameDesignation = normalizePersonToken(candidate.designation) === srcDesignation;
            return sameName && sameDesignation;
          });
          if (manualMatch) {
            usedManual.add(manualMatch._existingIndex);
            existing = { ...manualMatch };
            delete existing._existingIndex;
          }
        }

        const mapped = mapApplicantDesignatedPersonToModule(targetKey, existing, sourcePerson);
        mapped._linkedFromApplicant = true;
        mapped._applicantKey = key;
        return mapped;
      });

      const manualNext = retainedManual
        .filter((candidate) => !usedManual.has(candidate._existingIndex))
        .map((candidate) => {
          const copy = { ...candidate };
          delete copy._existingIndex;
          return copy;
        });

      model[targetKey].designatedPersons = [...linkedNext, ...manualNext];
    });
  }

  /* ── Business Field Data Module ── */
  let lastPreviewBlobUrl = null; // ObjectURL of previewed PDF for download
  let fieldDataImages = []; // [{id, label, fileName, dataUrl, mimeType}]

  function initFieldDataModule() {
    const section = qs('#module-field_data');
    if (!section) return;

    const labelInput  = qs('[data-field-img-label]', section);
    const fileInput   = qs('[data-field-img-file]', section);
    const addBtn      = qs('[data-action="add-field-image"]', section);
    const listEl      = qs('[data-field-img-list]', section);
    const emptyEl     = qs('[data-field-img-empty]', section);
    const countEl     = qs('[data-field-img-count]', section);
    const saveBtn     = qs('[data-action="save-field-data"]', section);

    // ── Drag-and-drop reorder state ──
    let dragSrcIndex = null;

    function renderFieldImages() {
      if (!listEl) return;
      if (!fieldDataImages.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (countEl) countEl.textContent = '0';
        renderJSON('field_data', { images: [] });
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      if (countEl) countEl.textContent = String(fieldDataImages.length);

      listEl.innerHTML = fieldDataImages.map((img, idx) => `
        <div class="field-img-card" draggable="true" data-drag-idx="${idx}" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface);cursor:grab;transition:opacity 0.2s,transform 0.15s">
          <img src="${img.dataUrl}" alt="${img.label || img.fileName}" style="width:100%;height:130px;object-fit:cover;pointer-events:none" />
          <div style="padding:6px 8px;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${img.label || img.fileName}">${img.label || img.fileName}</span>
            <button type="button" data-remove-field-img="${img.id}" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:14px;padding:2px 4px" title="Remove">&times;</button>
          </div>
        </div>
      `).join('');

      // Bind remove buttons
      listEl.querySelectorAll('[data-remove-field-img]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-remove-field-img');
          fieldDataImages = fieldDataImages.filter((i) => i.id !== id);
          renderFieldImages();
        });
      });

      // Bind drag-and-drop reorder
      listEl.querySelectorAll('.field-img-card').forEach((card) => {
        card.addEventListener('dragstart', (e) => {
          dragSrcIndex = parseInt(card.dataset.dragIdx);
          card.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
          card.style.opacity = '1';
          listEl.querySelectorAll('.field-img-card').forEach(c => c.style.border = '1px solid var(--border)');
        });
        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.style.border = '2px solid #3b82f6';
        });
        card.addEventListener('dragleave', () => {
          card.style.border = '1px solid var(--border)';
        });
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          const dropIdx = parseInt(card.dataset.dragIdx);
          if (dragSrcIndex !== null && dragSrcIndex !== dropIdx) {
            const moved = fieldDataImages.splice(dragSrcIndex, 1)[0];
            fieldDataImages.splice(dropIdx, 0, moved);
            renderFieldImages();
          }
          dragSrcIndex = null;
        });
      });

      // Update raw JSON panel
      renderJSON('field_data', { images: fieldDataImages.map((i) => ({ id: i.id, label: i.label, fileName: i.fileName, mimeType: i.mimeType })) });
    }

    // Add image(s) handler — supports multiple files at once
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const files = fileInput?.files;
        if (!files || !files.length) return alert('Please select one or more image files first.');
        const baseLabel = (labelInput?.value || '').trim();
        const fileList = Array.from(files);
        let loaded = 0;

        fileList.forEach((file, i) => {
          const reader = new FileReader();
          reader.onload = () => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
            const label = fileList.length === 1
              ? (baseLabel || file.name)
              : (baseLabel ? `${baseLabel} ${i + 1}` : file.name);
            fieldDataImages.push({
              id,
              label,
              fileName: file.name,
              dataUrl: reader.result,
              mimeType: file.type || 'image/jpeg'
            });
            loaded++;
            if (loaded === fileList.length) {
              if (labelInput) labelInput.value = '';
              if (fileInput) fileInput.value = '';
              renderFieldImages();
            }
          };
          reader.readAsDataURL(file);
        });
      });
    }

    // Save to server handler
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          await saveSnapshotToServer('field_data', JSON.stringify({ images: fieldDataImages }));
          saveBtn.textContent = 'Saved ✓';
          setTimeout(() => { saveBtn.textContent = 'Save to Server'; saveBtn.disabled = false; }, 2000);
        } catch (err) {
          saveBtn.textContent = 'Save to Server';
          saveBtn.disabled = false;
          alert('Failed to save field data: ' + (err.message || err));
        }
      });
    }

    // Load existing data from server (MongoDB API)
    (async () => {
      try {
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId || caseId.toLowerCase() === 'default') return;
        const url = `/api/case/${encodeURIComponent(caseId)}/snapshot/field_data`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const payload = json?.data?.data || json?.data || json || {};
          const imgs = payload?.images || [];
          if (Array.isArray(imgs) && imgs.length) {
            fieldDataImages = imgs;
            renderFieldImages();
          }
        }
      } catch {
        // No saved field data
      }
    })();

    renderFieldImages();

    // ── Field Data Summary (manual textarea) ──
    const fdSummaryTextarea = qs('#fieldDataSummaryTextarea', section);
    const fdSummarySaveBtn = qs('#btnSaveFieldDataSummary', section);
    const fdSummaryStatus = qs('#fieldDataSummaryStatus', section);

    if (fdSummarySaveBtn && fdSummaryTextarea) {
      fdSummarySaveBtn.addEventListener('click', async () => {
        const text = fdSummaryTextarea.value.trim();
        try {
          fdSummarySaveBtn.disabled = true;
          fdSummarySaveBtn.textContent = 'Saving…';
          var vbEl = qs('#fieldDataVerifiedBy');
          var vbVal = vbEl ? vbEl.value.trim() : '';
          STORAGE.setItem(storageKey('integration.fieldDataSummary'), JSON.stringify({ summary: text, verified_by: vbVal }));
          await saveSnapshotToServer('field_data_summary', JSON.stringify({ summary: text, verified_by: vbVal }));
          if (fdSummaryStatus) fdSummaryStatus.textContent = 'Saved ✓';
          fdSummarySaveBtn.textContent = '💾 Save Summary';
          fdSummarySaveBtn.disabled = false;
          setTimeout(() => { if (fdSummaryStatus) fdSummaryStatus.textContent = ''; }, 3000);
        } catch (err) {
          fdSummarySaveBtn.textContent = '💾 Save Summary';
          fdSummarySaveBtn.disabled = false;
          if (fdSummaryStatus) fdSummaryStatus.textContent = 'Save failed: ' + (err.message || err);
        }
      });
    }

    // Auto-save on input (debounced)
    let _fdSummaryAutoTimer = null;
    if (fdSummaryTextarea) {
      fdSummaryTextarea.addEventListener('input', () => {
        clearTimeout(_fdSummaryAutoTimer);
        _fdSummaryAutoTimer = setTimeout(() => {
          const text = fdSummaryTextarea.value.trim();
          var vbEl2 = qs('#fieldDataVerifiedBy');
          var vbVal2 = vbEl2 ? vbEl2.value.trim() : '';
          try { STORAGE.setItem(storageKey('integration.fieldDataSummary'), JSON.stringify({ summary: text, verified_by: vbVal2 })); } catch(e) {}
          if (HAS_CASE_ID) saveSnapshotToServer('field_data_summary', JSON.stringify({ summary: text, verified_by: vbVal2 })).catch(() => {});
        }, 2000);
      });
    }

    // Load from server
    (async () => {
      try {
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId || caseId.toLowerCase() === 'default') return;
        const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/field_data_summary`);
        if (res.ok) {
          const json = await res.json();
          const payload = json?.data?.data || json?.data || {};
          const text = payload?.summary || '';
          const vbLoad = payload?.verified_by || '';
          if (text && fdSummaryTextarea) {
            fdSummaryTextarea.value = text;
          }
          if (text || vbLoad) {
            STORAGE.setItem(storageKey('integration.fieldDataSummary'), JSON.stringify({ summary: text, verified_by: vbLoad }));
          }
          if (vbLoad) { var vbInput = qs('#fieldDataVerifiedBy'); if (vbInput) vbInput.value = vbLoad; }
        }
      } catch {}
    })();

    // Auto-save when Verified By input changes
    const fdVerifiedByInput = qs('#fieldDataVerifiedBy', section);
    let _fdVBAutoTimer = null;
    function _saveFdVerifiedBy() {
      const text = fdSummaryTextarea ? fdSummaryTextarea.value.trim() : '';
      const vb = fdVerifiedByInput ? fdVerifiedByInput.value.trim() : '';
      try { STORAGE.setItem(storageKey('integration.fieldDataSummary'), JSON.stringify({ summary: text, verified_by: vb })); } catch(e) {}
      if (HAS_CASE_ID) saveSnapshotToServer('field_data_summary', JSON.stringify({ summary: text, verified_by: vb })).catch(() => {});
    }
    if (fdVerifiedByInput) {
      fdVerifiedByInput.addEventListener('input', () => {
        clearTimeout(_fdVBAutoTimer);
        _fdVBAutoTimer = setTimeout(_saveFdVerifiedBy, 1500);
      });
      fdVerifiedByInput.addEventListener('change', () => { clearTimeout(_fdVBAutoTimer); _saveFdVerifiedBy(); });
      fdVerifiedByInput.addEventListener('blur', () => { clearTimeout(_fdVBAutoTimer); _saveFdVerifiedBy(); });
    }

    // Also try localStorage fallback
    if (fdSummaryTextarea && !fdSummaryTextarea.value) {
      try {
        const stored = safeJSONParse(STORAGE.getItem(storageKey('integration.fieldDataSummary')), null);
        if (stored?.summary) fdSummaryTextarea.value = stored.summary;
        if (stored?.verified_by) { var vbFb = qs('#fieldDataVerifiedBy'); if (vbFb) vbFb.value = stored.verified_by; }
      } catch {}
    }
  }

  /* ── Business Summary Module ── */
  function initBusinessSummaryModule() {
    const section = qs('#module-business_summary');
    if (!section) return;

    const textarea  = qs('#businessSummaryTextarea', section);
    const saveBtn   = qs('#btnSaveBusinessSummary', section);
    const aiBtn     = qs('#btnGenerateBusinessSummaryAI', section);
    const statusEl  = qs('#businessSummaryStatus', section);

    // Save to server
    if (saveBtn && textarea) {
      saveBtn.addEventListener('click', async () => {
        const text = textarea.value.trim();
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          await saveSnapshotToServer('business_summary', JSON.stringify({ summary: text }));
          if (statusEl) statusEl.textContent = 'Saved ✓';
          saveBtn.textContent = '💾 Save to Server';
          saveBtn.disabled = false;
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        } catch (err) {
          saveBtn.textContent = '💾 Save to Server';
          saveBtn.disabled = false;
          if (statusEl) statusEl.textContent = 'Save failed: ' + (err.message || err);
        }
      });
    }

    // ── Auto-save Business Summary on input/change ──
    var _bsAutoSaveTimer = null;
    if (textarea) {
      textarea.addEventListener('input', function() {
        clearTimeout(_bsAutoSaveTimer);
        _bsAutoSaveTimer = setTimeout(function() {
          var text = textarea.value.trim();
          if (HAS_CASE_ID) saveSnapshotToServer('business_summary', JSON.stringify({ summary: text })).catch(function() {});
          try { STORAGE.setItem(storageKey('integration.businessSummary'), JSON.stringify({ summary: text })); } catch(e) {}
        }, 2000);
      });
    }

    // AI Generate
    if (aiBtn && textarea) {
      aiBtn.addEventListener('click', async () => {
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId) { alert('Load a case first.'); return; }

        // Gather context from available modules
        let gstData = {}, mcaData = {}, fieldData = {};
        try {
          const gstSnap = safeJSONParse(STORAGE.getItem(storageKey('integration.gstData')), null);
          if (gstSnap) gstData = gstSnap;
        } catch {}
        try {
          const mcaSnap = safeJSONParse(STORAGE.getItem(storageKey('integration.mcaData')), null);
          if (mcaSnap) mcaData = mcaSnap;
        } catch {}

        const companyName = mcaData.companyName || mcaData.company || gstData.legalName || gstData.tradeName || 'the company';

        aiBtn.disabled = true;
        aiBtn.textContent = '⏳ Generating…';
        if (statusEl) statusEl.textContent = 'Generating business summary…';

        try {
          const res = await fetch('/api/report/module-verification-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              moduleKey: 'business_summary',
              moduleLabel: 'Business Summary',
              moduleData: { existingSummary: textarea.value || '', companyName },
              companyName,
              companyContext: {
                cin: mcaData.cin || mcaData.CIN || '',
                gstin: gstData.gstin || gstData.GSTIN || '',
                constitution: gstData.constitutionOfBusiness || gstData.constitution || mcaData.classOfCompany || '',
                status: mcaData.status || gstData.status || ''
              }
            })
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.summary) {
              textarea.value = json.summary;
            }
          }
          if (statusEl) statusEl.textContent = 'Summary generated ✓';
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Generation failed: ' + (err.message || err);
        }
        aiBtn.disabled = false;
        aiBtn.textContent = '🤖 Generate Summary';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
      });
    }

    // Load existing data from server
    (async () => {
      try {
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId || caseId.toLowerCase() === 'default') return;
        const url = `/api/case/${encodeURIComponent(caseId)}/snapshot/business_summary`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const payload = json?.data?.data || json?.data || json || {};
          const summary = payload?.summary || '';
          if (summary && textarea) {
            textarea.value = summary;
          }
        }
      } catch {
        // No saved business summary
      }
    })();
  }

  /* ── Resident Verification — Multi-Image Upload with Drag & Drop Reorder ── */
  let residentVerificationImages = []; // [{id, label, fileName, dataUrl, mimeType}]

  function initResidentVerificationImages() {
    const section = qs('#module-person-resident_verification');
    if (!section) return;

    const labelInput  = qs('[data-rv-img-label]', section);
    const fileInput   = qs('[data-rv-img-file]', section);
    const addBtn      = qs('[data-action="add-rv-image"]', section);
    const listEl      = qs('[data-rv-img-list]', section);
    const emptyEl     = qs('[data-rv-img-empty]', section);
    const countEl     = qs('[data-rv-img-count]', section);
    const previewEl   = qs('[data-rv-preview-images]', section);
    const saveBtn     = qs('[data-action="save-rv-images"]', section);
    const dropzone    = qs('[data-rv-dropzone]', section);
    const dropInput   = qs('[data-rv-dropzone-input]', section);

    // ── Drag-and-drop reorder state ──
    let dragSrcIndex = null;

    function renderRVImages() {
      if (!listEl) return;
      if (!residentVerificationImages.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (countEl) countEl.textContent = '0';
        if (previewEl) previewEl.innerHTML = '<span class="muted">No images uploaded</span>';
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      if (countEl) countEl.textContent = String(residentVerificationImages.length);

      listEl.innerHTML = residentVerificationImages.map((img, idx) => `
        <div class="rv-img-card" draggable="true" data-drag-idx="${idx}" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface);cursor:grab;transition:opacity 0.2s,transform 0.15s">
          <img src="${img.dataUrl}" alt="${img.label || img.fileName}" style="width:100%;height:130px;object-fit:cover;pointer-events:none" />
          <div style="padding:6px 8px;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${img.label || img.fileName}">${img.label || img.fileName}</span>
            <button type="button" data-remove-rv-img="${img.id}" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:14px;padding:2px 4px" title="Remove">&times;</button>
          </div>
        </div>
      `).join('');

      // Bind remove buttons
      listEl.querySelectorAll('[data-remove-rv-img]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-remove-rv-img');
          residentVerificationImages = residentVerificationImages.filter((i) => i.id !== id);
          renderRVImages();
          saveRVImagesToServer();
        });
      });

      // Bind drag-and-drop reorder
      listEl.querySelectorAll('.rv-img-card').forEach((card) => {
        card.addEventListener('dragstart', (e) => {
          dragSrcIndex = parseInt(card.dataset.dragIdx);
          card.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
          card.style.opacity = '1';
          listEl.querySelectorAll('.rv-img-card').forEach(c => c.style.border = '1px solid var(--border)');
        });
        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.style.border = '2px solid #3b82f6';
        });
        card.addEventListener('dragleave', () => {
          card.style.border = '1px solid var(--border)';
        });
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          const dropIdx = parseInt(card.dataset.dragIdx);
          if (dragSrcIndex !== null && dragSrcIndex !== dropIdx) {
            const moved = residentVerificationImages.splice(dragSrcIndex, 1)[0];
            residentVerificationImages.splice(dropIdx, 0, moved);
            renderRVImages();
            saveRVImagesToServer();
          }
          dragSrcIndex = null;
        });
      });

      // Update preview table cell
      if (previewEl) {
        previewEl.innerHTML = residentVerificationImages.map((img) =>
          `<div style="display:inline-block;margin:4px">
            <img src="${img.dataUrl}" alt="${img.label}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" />
            <div style="font-size:10px;text-align:center;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${img.label || img.fileName}</div>
          </div>`
        ).join('');
      }
    }

    /** Process a FileList — used by button, dropzone, and file drop */
    function processFiles(files, baseLabel) {
      if (!files || !files.length) return;
      const fileList = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
      if (!fileList.length) return alert('Please select valid image files.');
      let loaded = 0;
      fileList.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = () => {
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
          const label = fileList.length === 1
            ? (baseLabel || file.name)
            : (baseLabel ? `${baseLabel} ${i + 1}` : file.name);
          residentVerificationImages.push({
            id,
            label,
            fileName: file.name,
            dataUrl: reader.result,
            mimeType: file.type || 'image/jpeg'
          });
          loaded++;
          if (loaded === fileList.length) {
            if (labelInput) labelInput.value = '';
            if (fileInput) fileInput.value = '';
            renderRVImages();
            saveRVImagesToServer();
          }
        };
        reader.readAsDataURL(file);
      });
    }

    // Add image(s) handler — supports multiple files at once
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const files = fileInput?.files;
        if (!files || !files.length) return alert('Please select one or more image files first.');
        processFiles(files, (labelInput?.value || '').trim());
      });
    }

    // ── Drag-and-drop zone for file upload ──
    if (dropzone) {
      dropzone.addEventListener('click', () => { if (dropInput) dropInput.click(); });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dropzone.style.borderColor = '#3b82f6';
        dropzone.style.background = 'rgba(59,130,246,0.06)';
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = '';
        dropzone.style.background = '';
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '';
        dropzone.style.background = '';
        const files = e.dataTransfer?.files;
        if (files && files.length) {
          processFiles(files, (labelInput?.value || '').trim());
        }
      });

      if (dropInput) {
        dropInput.addEventListener('change', () => {
          if (dropInput.files && dropInput.files.length) {
            processFiles(dropInput.files, (labelInput?.value || '').trim());
            dropInput.value = '';
          }
        });
      }
    }

    // Save to server handler
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          await saveSnapshotToServer('resident_verification_images', JSON.stringify({ images: residentVerificationImages }));
          saveBtn.textContent = 'Saved ✓';
          setTimeout(() => { saveBtn.textContent = 'Save to Server'; saveBtn.disabled = false; }, 2000);
        } catch (err) {
          saveBtn.textContent = 'Save to Server';
          saveBtn.disabled = false;
          alert('Failed to save: ' + (err.message || err));
        }
      });
    }

    async function saveRVImagesToServer() {
      try {
        await saveSnapshotToServer('resident_verification_images', JSON.stringify({ images: residentVerificationImages }));
      } catch {
        // silent
      }
    }

    // Load existing data from server (MongoDB API)
    (async () => {
      try {
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId || caseId.toLowerCase() === 'default') return;
        const url = `/api/case/${encodeURIComponent(caseId)}/snapshot/resident_verification_images`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const payload = json?.data?.data || json?.data || json || {};
          const imgs = payload?.images || [];
          if (Array.isArray(imgs) && imgs.length) {
            residentVerificationImages = imgs;
            renderRVImages();
          }
        }
      } catch {
        // No saved resident verification images
      }
    })();

    renderRVImages();

    // Expose so loadSnapshots can re-render after server data arrives
    window._rvRenderImages = renderRVImages;
  }

  function initPersonalInfoBlock() {
    const personalBlock = qs('[data-block="personal"]');
    if (!personalBlock) return;

    const grid = qs('[data-personal-grid]', personalBlock);
    if (!grid) return;

    let model = readPersonalInfo();
    _personalInfoModel = model;
    syncApplicantPeopleIntoPanAndAadhaar(model);

    // Merge external server data into the closure model and re-render
    /** Helper: pick the better doc object — prefer the one with data_url over stripped/null */
    function _pickBetterDoc(localDoc, serverDoc) {
      const localHas = localDoc && typeof localDoc === 'object' && localDoc.data_url;
      const serverHas = serverDoc && typeof serverDoc === 'object' && serverDoc.data_url;
      if (serverHas) return serverDoc;  // server has full image — use it
      if (localHas) return localDoc;    // local has full image — keep it
      if (serverDoc && typeof serverDoc === 'object' && !serverDoc.stripped) return serverDoc;
      if (localDoc && typeof localDoc === 'object' && !localDoc.stripped) return localDoc;
      return serverDoc ?? localDoc ?? null;
    }

    /** Merge doc fields (verified_document, verified_document_2) preserving data_url */
    function _mergeDocFields(target, source) {
      ['verified_document', 'verified_document_2'].forEach((dk) => {
        if (dk in source || dk in target) {
          target[dk] = _pickBetterDoc(target[dk], source[dk]);
        }
      });
    }

    function _mergeServerDataIntoModel(fromServer) {
      if (!fromServer || typeof fromServer !== 'object') return;
      const base = defaultPersonalInfo();
      PERSONAL_MODULE_KEYS.forEach((mk) => {
        if (!fromServer[mk] || typeof fromServer[mk] !== 'object') return;
        base[mk].primary = { ...base[mk].primary, ...(fromServer[mk].primary || {}) };
        migrateToDesignatedPersons(fromServer[mk]);
        base[mk].designatedPersons = Array.isArray(fromServer[mk].designatedPersons) ? fromServer[mk].designatedPersons : base[mk].designatedPersons;
      });

      // ── Phase 1: ALWAYS restore document/image fields from server ──
      // Server is the authoritative source for binary data (data_url / dataUrl).
      // localStorage strips these to save quota, so we must always merge images
      // from the server regardless of how many text fields differ.
      let docsUpdated = false;

      /** Pick the better verification_images array — prefer the one with dataUrl */
      function _pickBetterImages(localImgs, serverImgs) {
        if (!Array.isArray(serverImgs) || !serverImgs.length) return localImgs;
        if (!Array.isArray(localImgs) || !localImgs.length) return serverImgs;
        const serverHasData = serverImgs.some(i => i && i.dataUrl);
        const localHasData = localImgs.some(i => i && i.dataUrl);
        if (serverHasData) return serverImgs;
        if (localHasData) return localImgs;
        return serverImgs;
      }

      PERSONAL_MODULE_KEYS.forEach((mk) => {
        if (!base[mk]) return;
        if (!model[mk]) model[mk] = { primary: {}, designatedPersons: [] };
        if (!model[mk].primary) model[mk].primary = {};
        const sp = base[mk].primary || {};
        // Restore primary document fields
        ['verified_document', 'verified_document_2'].forEach((dk) => {
          if ((dk in sp) || (dk in model[mk].primary)) {
            const picked = _pickBetterDoc(model[mk].primary[dk], sp[dk]);
            if (picked !== model[mk].primary[dk]) { model[mk].primary[dk] = picked; docsUpdated = true; }
          }
        });
        // Restore primary verification_images (RV images stripped from localStorage)
        if (Array.isArray(sp.verification_images) || Array.isArray(model[mk].primary.verification_images)) {
          const picked = _pickBetterImages(model[mk].primary.verification_images, sp.verification_images);
          if (picked !== model[mk].primary.verification_images) { model[mk].primary.verification_images = picked; docsUpdated = true; }
        }
        // Restore designated person document fields AND verification_images
        if (Array.isArray(base[mk].designatedPersons) && base[mk].designatedPersons.length) {
          // Ensure model has the same slots so we can update them in place
          if (!Array.isArray(model[mk].designatedPersons)) model[mk].designatedPersons = [];
          while (model[mk].designatedPersons.length < base[mk].designatedPersons.length) {
            model[mk].designatedPersons.push({});
          }
          base[mk].designatedPersons.forEach((serverDP, di) => {
            const localDP = model[mk].designatedPersons[di];
            ['verified_document', 'verified_document_2'].forEach((dk) => {
              if ((dk in serverDP) || (dk in localDP)) {
                const picked = _pickBetterDoc(localDP[dk], serverDP[dk]);
                if (picked !== localDP[dk]) { localDP[dk] = picked; docsUpdated = true; }
              }
            });
            // Restore verification_images for this designated person
            if (Array.isArray(serverDP.verification_images) || Array.isArray(localDP.verification_images)) {
              const picked = _pickBetterImages(localDP.verification_images, serverDP.verification_images);
              if (picked !== localDP.verification_images) { localDP.verification_images = picked; docsUpdated = true; }
            }
          });
        }
      });

      // ── Phase 2: Merge text fields when server has sufficient data ──
      const localKeys = Object.keys(model).filter(k => {
        const p = model[k]?.primary || {};
        return Object.values(p).some(v => v && String(v).trim());
      });
      const serverKeys = Object.keys(base).filter(k => {
        const p = base[k]?.primary || {};
        return Object.values(p).some(v => v && String(v).trim());
      });
      if (serverKeys.length >= localKeys.length) {
        PERSONAL_MODULE_KEYS.forEach((mk) => {
          if (!base[mk]) return;
          const sp = base[mk].primary || {};
          const lp = model[mk]?.primary || {};
          model[mk] = model[mk] || { primary: {}, designatedPersons: [] };
          model[mk].primary = { ...lp, ...Object.fromEntries(Object.entries(sp).filter(([,v]) => v != null && String(v).trim() !== '')) };
          // Re-apply doc merge (idempotent) after text spread to ensure data_url wins
          _mergeDocFields(model[mk].primary, sp);
          // Re-apply verification_images merge for primary
          if (Array.isArray(sp.verification_images) && sp.verification_images.some(i => i && i.dataUrl)) {
            model[mk].primary.verification_images = _pickBetterImages(model[mk].primary.verification_images, sp.verification_images);
          }
          // Merge designated persons — preserve existing doc images and verification_images
          if (Array.isArray(base[mk].designatedPersons) && base[mk].designatedPersons.length) {
            const existingDPs = Array.isArray(model[mk].designatedPersons) ? model[mk].designatedPersons : [];
            model[mk].designatedPersons = base[mk].designatedPersons.map((serverDP, di) => {
              const localDP = existingDPs[di] || {};
              const merged = { ...localDP, ...serverDP };
              _mergeDocFields(merged, serverDP);
              ['verified_document', 'verified_document_2'].forEach((dk) => {
                merged[dk] = _pickBetterDoc(localDP[dk], serverDP[dk]);
              });
              // Preserve verification_images with dataUrl
              merged.verification_images = _pickBetterImages(localDP.verification_images, serverDP.verification_images);
              return merged;
            });
          }
        });
      }

      // ── Phase 3: Always persist and re-render if anything changed ──
      if (docsUpdated || serverKeys.length >= localKeys.length) {
        syncApplicantPeopleIntoPanAndAadhaar(model);
        writePersonalInfo(model);
        qsa('[data-pi-field]').forEach((el) => {
          const path = (el.getAttribute('data-pi-field') || '').toString().trim();
          if (!path) return;
          const parts = pathToParts(path);
          if (parts.length >= 4 && parts[1] === 'designatedPersons') return;
          const val = getByParts(model, parts, '');
          if (el && typeof el.value !== 'undefined') {
            if (path === 'pan.primary.date_of_birth') {
              el.value = normalizeDobForInput(val);
            } else {
              el.value = val == null ? '' : String(val);
            }
          }
        });
        renderDesignatedPersonsLists(model);
        renderPersonalPrimaryPreview();
        if (typeof renderAllModuleSummaries === 'function') renderAllModuleSummaries();
      }
    }

    // Expose so loadSnapshots can also update this model and re-render
    window._piRefreshModelFromServer = _mergeServerDataIntoModel;

    // Restore personal data from server (async — will re-populate form fields when done)
    (async () => {
      try {
        const fromServer = await loadPersonalInfoFromServerIfAvailable();
        _mergeServerDataIntoModel(fromServer);
      } catch (err) {
        console.warn('[initPersonalInfoBlock] Server restore failed:', err);
      }
    })();

    function setPersonalOut(key, value) {
      const v = value == null || String(value).trim() === '' ? '—' : String(value);
      qsa(`[data-pi-out="${CSS.escape(key)}"]`).forEach((el) => {
        el.textContent = v;
      });
    }

    /**
     * Show exactly one person's form in the applicant section.
     * type: 'primary' | 'designated' | 'summary'
     * dpIndex: required when type === 'designated'
     */
    // Track which module is currently being edited (prevents async re-collapse)
    let _editingModule = null;
    let _editingType = null;
    let _editingDpIndex = null;

    function showSinglePersonForm(moduleKey, type, dpIndex) {
      console.log('[showSinglePersonForm]', moduleKey, type, dpIndex);
      const section = qs(`[data-personal-section="${CSS.escape(moduleKey)}"]`);
      if (!section) { console.warn('[showSinglePersonForm] section not found for', moduleKey); return; }
      const body = qs('.module-body', section);
      if (!body) { console.warn('[showSinglePersonForm] body not found for', moduleKey); return; }

      // Find panels by iterating direct children of body
      const allPanels = Array.from(body.children).filter(el => el.classList && el.classList.contains('panel'));
      const dpListEl = qs(`[data-dp-list="${CSS.escape(moduleKey)}"]`, section);
      const dpPanel = dpListEl ? dpListEl.closest('.panel') : null;
      const primaryPanels = allPanels.filter(p => p !== dpPanel);
      const summaryWrap = qs('.pi-saved-list', body);

      console.log('[showSinglePersonForm] allPanels:', allPanels.length, 'dpPanel:', !!dpPanel, 'primaryPanels:', primaryPanels.length, 'summaryWrap:', !!summaryWrap);

      // Remove any dynamically injected done bar
      qsa('.pi-edit-done-bar', body).forEach(el => el.remove());

      if (type === 'summary') {
        // Collapse — show summary cards, hide all forms
        _editingModule = null;
        _editingType = null;
        _editingDpIndex = null;
        body.classList.add('pi-form-collapsed');
        allPanels.forEach(p => { p.style.removeProperty('display'); });
        if (summaryWrap) { summaryWrap.style.removeProperty('display'); }
        section.removeAttribute('data-focus-designated');
        section.removeAttribute('data-editing-person');
        if (dpListEl) qsa('.dp-card', dpListEl).forEach(c => { c.style.removeProperty('display'); });
        return;
      }

      // ── Un-collapse forms: remove CSS class and force show/hide with inline !important ──
      _editingModule = moduleKey;
      _editingType = type;
      _editingDpIndex = typeof dpIndex === 'number' ? dpIndex : null;
      body.classList.remove('pi-form-collapsed');
      section.removeAttribute('data-focus-designated');
      if (summaryWrap) summaryWrap.style.setProperty('display', 'none', 'important');

      if (type === 'primary') {
        section.setAttribute('data-editing-person', 'primary');
        // Force show primary panels, force hide DP panel
        console.log('[showSinglePersonForm] Setting primary panels to block, dpPanel to none');
        primaryPanels.forEach((p, i) => {
          p.style.setProperty('display', 'block', 'important');
          console.log('[showSinglePersonForm] primaryPanel', i, 'display after:', p.style.display, 'computed:', getComputedStyle(p).display);
        });
        if (dpPanel) dpPanel.style.setProperty('display', 'none', 'important');

        // Inject a Done bar at the bottom for returning to summary
        const doneBar = document.createElement('div');
        doneBar.className = 'pi-edit-done-bar';
        doneBar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid var(--border)';
        const doneBtn = document.createElement('button');
        doneBtn.className = 'btn btn-primary';
        doneBtn.type = 'button';
        doneBtn.style.cssText = 'font-size:12px;padding:6px 18px';
        doneBtn.textContent = '💾 Save & Done';
        doneBtn.setAttribute('data-primary-done', moduleKey);
        doneBar.appendChild(doneBtn);
        if (dpPanel) body.insertBefore(doneBar, dpPanel);
        else body.appendChild(doneBar);

        const firstPanel = primaryPanels[0];
        if (firstPanel) {
          firstPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const firstInput = firstPanel.querySelector('input, select, textarea');
          if (firstInput) firstInput.focus();
        }
      } else if (type === 'designated') {
        // ── personal_itr: reuse the primary ITR form panels, just switch the person selector ──
        if (moduleKey === 'personal_itr' && typeof dpIndex === 'number') {
          section.setAttribute('data-editing-person', 'dp-' + dpIndex);
          // Show primary panels (person selector + ITR form + preview table)
          primaryPanels.forEach(p => { p.style.setProperty('display', 'block', 'important'); });
          if (dpPanel) dpPanel.style.setProperty('display', 'none', 'important');
          // Auto-select the designated person in the person dropdown
          const personSelect = qs('[data-pitr-person-select]', section);
          if (personSelect) {
            const dpVal = 'dp_' + dpIndex;
            if ([...personSelect.options].some(o => o.value === dpVal)) {
              personSelect.value = dpVal;
            }
            personSelect.dispatchEvent(new Event('change'));
          }
          // Inject a Done bar at the bottom
          const doneBar = document.createElement('div');
          doneBar.className = 'pi-edit-done-bar';
          doneBar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid var(--border)';
          const doneBtn = document.createElement('button');
          doneBtn.className = 'btn btn-primary';
          doneBtn.type = 'button';
          doneBtn.style.cssText = 'font-size:12px;padding:6px 18px';
          doneBtn.textContent = '💾 Save & Done';
          doneBtn.setAttribute('data-primary-done', moduleKey);
          doneBar.appendChild(doneBtn);
          body.appendChild(doneBar);
          const firstPanel = primaryPanels[0];
          if (firstPanel) firstPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          section.setAttribute('data-focus-designated', '1');
          section.setAttribute('data-editing-person', 'dp-' + dpIndex);
          // Force hide primary panels, force show DP panel
          primaryPanels.forEach(p => { p.style.setProperty('display', 'none', 'important'); });
          if (dpPanel) dpPanel.style.setProperty('display', 'block', 'important');
          // Show only the target DP card
          if (dpListEl) {
            const cards = qsa('.dp-card', dpListEl);
            cards.forEach((cardEl, idx) => {
              if (idx === dpIndex) {
                cardEl.style.setProperty('display', 'block', 'important');
              } else {
                cardEl.style.setProperty('display', 'none', 'important');
              }
            });
            const targetCard = cards[dpIndex];
            if (targetCard) {
              targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const firstInput = targetCard.querySelector('input[data-dp-field], select[data-dp-field], textarea[data-dp-field]');
              if (firstInput) firstInput.focus();
            }
          }
        }
      }
    }

    // Legacy wrappers for backward compat with callers
    function setDesignatedFocusMode(moduleKey, enabled) {
      if (!enabled) {
        showSinglePersonForm(moduleKey, 'summary');
      }
      // When enabled, caller should use showSinglePersonForm directly with dpIndex
    }

    function focusLatestDesignatedCard(moduleKey) {
      const mk = moduleKey || DESIGNATED_OWNER_MODULE;
      const list = Array.isArray(model?.[mk]?.designatedPersons) ? model[mk].designatedPersons : [];
      const draftIdx = list.findIndex(p => Boolean(p && p._draft));
      const idx = draftIdx >= 0 ? draftIdx : (list.length - 1);
      if (idx >= 0) showSinglePersonForm(mk, 'designated', idx);
    }

    function enforceApplicantOnlyDesignatedUI() {
      qsa('[data-dp-add]').forEach((btn) => {
        const mk = (btn.getAttribute('data-dp-add') || '').toString().trim();
        if (mk && mk !== DESIGNATED_OWNER_MODULE) {
          btn.style.display = 'none';
        }
      });
    }

    function setPersonalDocPreview(moduleKey, doc) {
      const mk = (moduleKey || '').toString().trim();
      const img = qs(`[data-pi-doc-image="${CSS.escape(mk)}"]`);
      const frame = qs(`[data-pi-doc-pdf="${CSS.escape(mk)}"]`);
      const empty = qs(`[data-pi-doc-empty="${CSS.escape(mk)}"]`);
      const link = qs(`[data-pi-doc-link="${CSS.escape(mk)}"]`);
      if (!img || !frame || !empty) return;

      const dataUrl = doc && typeof doc === 'object' ? (doc.data_url || '') : '';
      const mime = doc && typeof doc === 'object' ? (doc.mime_type || '') : '';
      const hasDoc = Boolean(dataUrl);
      const isPdf = /pdf/i.test(mime) || /^data:application\/pdf/i.test(String(dataUrl));

      if (!hasDoc) {
        img.removeAttribute('src');
        frame.removeAttribute('src');
        img.style.display = 'none';
        frame.style.display = 'none';
        empty.style.display = 'block';
        if (link) {
          link.style.display = 'none';
          link.removeAttribute('href');
        }
        return;
      }

      if (isPdf) {
        img.removeAttribute('src');
        img.style.display = 'none';
        frame.setAttribute('src', dataUrl);
        frame.style.display = 'block';
      } else {
        frame.removeAttribute('src');
        frame.style.display = 'none';
        img.setAttribute('src', dataUrl);
        img.style.display = 'block';
      }

      empty.style.display = 'none';
      if (link) {
        link.setAttribute('href', dataUrl);
        link.style.display = 'inline-flex';
      }
    }

    function renderPersonalPrimaryPreview() {
      const panPrimary = model?.pan?.primary || {};
      setPersonalOut('pan.pan_number', panPrimary.pan_number || null);
      setPersonalOut('pan.name', panPrimary.name || null);
      setPersonalOut('pan.indian_citizen', panPrimary.indian_citizen || null);
      setPersonalOut('pan.status', panPrimary.status || null);
      setPersonalOut('pan.date_of_birth', formatDobForDisplay(panPrimary.date_of_birth) || null);
      setPersonalOut('pan.address', panPrimary.address || null);
      setPersonalOut('pan.mobile_number', panPrimary.mobile_number || null);
      setPersonalOut('pan.verified_document_label', panPrimary.verified_document?.data_url ? 'ATTACHED' : null);
      setPersonalOut('pan.verified_document_2_label', panPrimary.verified_document_2?.data_url ? 'ATTACHED' : null);
      setPersonalDocPreview('pan', panPrimary.verified_document || null);
      setPersonalDocPreview('pan_2', panPrimary.verified_document_2 || null);

      const aadhaarPrimary = model?.aadhaar?.primary || {};
      setPersonalOut('aadhaar.name', aadhaarPrimary.name || null);
      setPersonalOut('aadhaar.aadhaar_number', aadhaarPrimary.aadhaar_number || null);
      setPersonalOut('aadhaar.verified_document_label', aadhaarPrimary.verified_document?.data_url ? 'ATTACHED' : null);
      setPersonalDocPreview('aadhaar', aadhaarPrimary.verified_document || null);

      const rvPrimary = model?.resident_verification?.primary || {};
      setPersonalOut('resident_verification.promoter_name', rvPrimary.promoter_name || null);
      setPersonalOut('resident_verification.permanent_address', rvPrimary.permanent_address || null);
      setPersonalOut('resident_verification.present_address', rvPrimary.present_address || null);
      setPersonalOut('resident_verification.phone', rvPrimary.phone || null);
      setPersonalOut('resident_verification.mobile', rvPrimary.mobile || null);
      setPersonalOut('resident_verification.email', rvPrimary.email || null);
      setPersonalOut('resident_verification.residing_at_address', rvPrimary.residing_at_address || null);
      setPersonalOut('resident_verification.ownership', rvPrimary.ownership || null);
      setPersonalOut('resident_verification.residing_since', rvPrimary.residing_since || null);
      setPersonalOut('resident_verification.family_members', rvPrimary.family_members || null);
      setPersonalOut('resident_verification.earning_members', rvPrimary.earning_members || null);
      setPersonalOut('resident_verification.special_remarks', rvPrimary.special_remarks || null);
      setPersonalOut('resident_verification.landmark', rvPrimary.landmark || null);
      setPersonalOut('resident_verification.locality_type', rvPrimary.locality_type || null);
      setPersonalOut('resident_verification.residence_type', rvPrimary.residence_type || null);
      setPersonalOut('resident_verification.construction_type', rvPrimary.construction_type || null);
      setPersonalOut('resident_verification.external_appearance', rvPrimary.external_appearance || null);
      setPersonalOut('resident_verification.area_of_residence', rvPrimary.area_of_residence || null);
      setPersonalOut('resident_verification.neighbour1_name', rvPrimary.neighbour1_name || null);
      setPersonalOut('resident_verification.neighbour2_name', rvPrimary.neighbour2_name || null);
      setPersonalOut('resident_verification.neighbour_findings', rvPrimary.neighbour_findings || null);
      setPersonalOut('resident_verification.manual_summary', rvPrimary.manual_summary || null);
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        try {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result || '');
          fr.onerror = () => reject(new Error('Unable to read file'));
          fr.readAsDataURL(file);
        } catch (err) {
          reject(err);
        }
      });
    }

    // Populate primary fields from model.
    qsa('[data-pi-field]').forEach((el) => {
      const path = (el.getAttribute('data-pi-field') || '').toString().trim();
      if (!path) return;
      const parts = pathToParts(path);
      // Only fill non-list primary fields here; list items are rendered by renderDesignatedPersonsLists.
      if (parts.length >= 4 && parts[1] === 'designatedPersons') return;
      const val = getByParts(model, parts, '');
      if (el && typeof el.value !== 'undefined') {
        if (path === 'pan.primary.date_of_birth') {
          el.value = normalizeDobForInput(val);
        } else {
          el.value = val == null ? '' : String(val);
        }
      }
    });

    renderDesignatedPersonsLists(model);
    renderPersonalPrimaryPreview();

    // ══ Collapsible "Saved Entries" pattern (like ITR) ══
    // For each personal module, show primary + DPs as compact summary cards.
    // Forms are hidden when data exists; "Edit" expands them.

    /** Get a one-line summary string for a person in a module */
    function personSummaryText(moduleKey, data) {
      if (!data || typeof data !== 'object') return '';
      const mk = (moduleKey || '').toString().trim();
      const parts = [];
      if (mk === 'applicant') {
        if (data.name) parts.push(data.name);
        if (data.mobile) parts.push('📱 ' + data.mobile);
        if (data.email) parts.push('✉ ' + data.email);
      } else if (mk === 'pan') {
        if (data.name) parts.push(data.name);
        if (data.pan_number) parts.push('PAN: ' + data.pan_number);
        if (data.status) parts.push(data.status);
      } else if (mk === 'aadhaar') {
        if (data.name) parts.push(data.name);
        if (data.aadhaar_number) parts.push('Aadhaar: ' + data.aadhaar_number);
      } else if (mk === 'resident_verification') {
        if (data.promoter_name) parts.push(data.promoter_name);
        if (data.permanent_address) parts.push(data.permanent_address.substring(0, 50));
        if (data.ownership) parts.push(data.ownership);
        if (data.residing_at_address) parts.push('Residing: ' + data.residing_at_address);
      } else if (mk === 'personal_itr') {
        if (data.name) parts.push(data.name);
        const entries = Array.isArray(data.itr_entries) ? data.itr_entries : [];
        parts.push(entries.length + ' ITR ' + (entries.length === 1 ? 'entry' : 'entries'));
      }
      return parts.join('  •  ');
    }

    /** Check if a person object has meaningful data */
    function hasPersonData(data) {
      if (!data || typeof data !== 'object') return false;
      return Object.entries(data).some(([k, v]) => {
        if (k === 'designation' || k === 'verified_document' || k === 'verified_document_2') return false;
        if (k.startsWith('_')) return false;
        if (k === 'itr_entries') return Array.isArray(v) && v.length > 0;
        return v != null && String(v).trim() !== '';
      });
    }

    /** Get display name from person data */
    function getPersonName(moduleKey, data) {
      if (!data) return '';
      if (data.name) return data.name;
      if (moduleKey === 'pan' && data.pan_number) return data.pan_number;
      if (moduleKey === 'aadhaar' && data.aadhaar_number) return data.aadhaar_number;
      if (moduleKey === 'resident_verification' && data.promoter_name) return data.promoter_name;
      if (moduleKey === 'resident_verification' && data.permanent_address) return data.permanent_address.substring(0, 40);
      if (moduleKey === 'personal_itr' && data.name) return data.name;
      return '';
    }

    /** Render summary cards for a personal module and control form visibility */
    function renderModuleSummary(moduleKey) {
      const section = qs(`[data-personal-section="${CSS.escape(moduleKey)}"]`);
      if (!section) return;
      const body = qs('.module-body', section);
      if (!body) return;

      // Get or create summary container
      let summaryWrap = qs('.pi-saved-list', body);
      if (!summaryWrap) {
        summaryWrap = document.createElement('div');
        summaryWrap.className = 'pi-saved-list';
        body.insertBefore(summaryWrap, body.firstChild);
      }
      summaryWrap.innerHTML = '';

      const moduleData = model[moduleKey] || {};
      const primary = moduleData.primary || {};
      const dps = Array.isArray(moduleData.designatedPersons) ? moduleData.designatedPersons : [];
      const hasPrimary = hasPersonData(primary);

      summaryWrap.style.display = 'flex';

      // ── Primary card ──
      {
        const card = document.createElement('div');
        card.className = 'pi-saved-card';

        const badge = document.createElement('span');
        badge.className = 'pi-sc-badge';
        badge.textContent = 'Primary';
        card.appendChild(badge);

        const info = document.createElement('div');
        info.className = 'pi-sc-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'pi-sc-name';
        const _primaryLabel = (() => { try { const m = readPersonalInfo(); return (m?.applicant?.primary?.primary_label || '').trim() || 'Primary Applicant'; } catch(_e) { return 'Primary Applicant'; } })();
        nameEl.textContent = hasPrimary ? (getPersonName(moduleKey, primary) || _primaryLabel) : _primaryLabel;
        info.appendChild(nameEl);

        if (hasPrimary) {
          const detail = document.createElement('span');
          detail.className = 'pi-sc-detail';
          detail.textContent = personSummaryText(moduleKey, primary);
          info.appendChild(detail);

          const status = document.createElement('span');
          status.className = 'pi-sc-status';
          status.textContent = '✓ Filled';
          info.appendChild(status);
        } else {
          const status = document.createElement('span');
          status.className = 'pi-sc-status empty';
          status.textContent = 'Not filled';
          info.appendChild(status);
        }

        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'pi-sc-actions';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '✏️ Edit';
        editBtn.title = 'Edit primary details';
        editBtn.addEventListener('click', () => {
          showSinglePersonForm(moduleKey, 'primary');
        });
        actions.appendChild(editBtn);

        // Save button — explicitly persist to server
        if (hasPrimary) {
          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'save-btn';
          saveBtn.textContent = '💾 Save';
          saveBtn.title = 'Save to server';
          saveBtn.addEventListener('click', () => {
            writePersonalInfo(model);
            saveBtn.textContent = '✓ Saved';
            setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 1500);
          });
          actions.appendChild(saveBtn);
        }

        // Delete button for primary (clears primary data)
        if (hasPrimary) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'danger';
          delBtn.textContent = '🗑️';
          delBtn.title = 'Clear primary data';
          delBtn.addEventListener('click', () => {
            if (!window.confirm('Clear all primary data for this module?')) return;
            if (moduleKey === DESIGNATED_OWNER_MODULE) {
              model[moduleKey].primary = {};
            } else {
              // For non-applicant: clear module-specific fields, let sync restore applicant-linked fields
              const defaults = defaultPersonalInfo();
              model[moduleKey].primary = { ...(defaults[moduleKey]?.primary || {}) };
            }
            syncApplicantPeopleIntoPanAndAadhaar(model);
            // Re-populate form fields from updated model (sync may have restored some fields)
            qsa('[data-pi-field]').forEach((el) => {
              const path = (el.getAttribute('data-pi-field') || '').toString().trim();
              if (!path.startsWith(moduleKey + '.primary.')) return;
              const parts = pathToParts(path);
              const val = getByParts(model, parts, '');
              if (path === 'pan.primary.date_of_birth') {
                el.value = normalizeDobForInput(val);
              } else {
                el.value = val == null ? '' : String(val);
              }
            });
            renderPersonalPrimaryPreview();
            renderDesignatedPersonsLists(model);
            scheduleSave();
            PERSONAL_MODULE_KEYS.forEach(mk => renderModuleSummary(mk));
          });
          actions.appendChild(delBtn);
        }

        card.appendChild(actions);
        summaryWrap.appendChild(card);
      }

      // ── Designated person cards ──
      dps.forEach((dp, idx) => {
        if (!hasPersonData(dp)) return;
        const card = document.createElement('div');
        card.className = 'pi-saved-card';

        const badge = document.createElement('span');
        badge.className = 'pi-sc-badge pi-sc-dp';
        badge.textContent = (dp.designation || 'DP') + ' #' + (idx + 1);
        card.appendChild(badge);

        const info = document.createElement('div');
        info.className = 'pi-sc-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'pi-sc-name';
        nameEl.textContent = getPersonName(moduleKey, dp) || 'Person #' + (idx + 1);
        info.appendChild(nameEl);

        const detail = document.createElement('span');
        detail.className = 'pi-sc-detail';
        detail.textContent = personSummaryText(moduleKey, dp);
        info.appendChild(detail);

        const status = document.createElement('span');
        status.className = 'pi-sc-status';
        status.textContent = '✓ Filled';
        info.appendChild(status);

        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'pi-sc-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '✏️ Edit';
        editBtn.title = 'Edit this person';
        editBtn.addEventListener('click', () => {
          renderDesignatedPersonsLists(model);
          showSinglePersonForm(moduleKey, 'designated', idx);
        });
        actions.appendChild(editBtn);

        // Save button — explicitly persist to server
        const dpSaveBtn = document.createElement('button');
        dpSaveBtn.type = 'button';
        dpSaveBtn.className = 'save-btn';
        dpSaveBtn.textContent = '💾 Save';
        dpSaveBtn.title = 'Save to server';
        dpSaveBtn.addEventListener('click', () => {
          writePersonalInfo(model);
          dpSaveBtn.textContent = '✓ Saved';
          setTimeout(() => { dpSaveBtn.textContent = '💾 Save'; }, 1500);
        });
        actions.appendChild(dpSaveBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'danger';
        delBtn.textContent = '🗑️';
        delBtn.title = 'Delete this person';
        delBtn.addEventListener('click', () => {
          if (!window.confirm('Delete ' + (dp.designation || 'designated person') + ' #' + (idx + 1) + '?')) return;
          if (moduleKey === DESIGNATED_OWNER_MODULE) {
            removeDesignatedPerson(model, moduleKey, idx);
          } else if (dp._linkedFromApplicant && dp._applicantKey) {
            const appList = Array.isArray(model.applicant?.designatedPersons) ? model.applicant.designatedPersons : [];
            const appIdx = appList.findIndex((p, i) => applicantPersonKey(p, i) === dp._applicantKey);
            if (appIdx >= 0) removeDesignatedPerson(model, 'applicant', appIdx);
          } else {
            removeDesignatedPerson(model, moduleKey, idx);
          }
          syncApplicantPeopleIntoPanAndAadhaar(model);
          renderDesignatedPersonsLists(model);
          scheduleSave();
          PERSONAL_MODULE_KEYS.forEach(mk => renderModuleSummary(mk));
        });
        actions.appendChild(delBtn);

        card.appendChild(actions);
        summaryWrap.appendChild(card);
      });

      // ── Add "Add New" button at bottom of summary ──
      if (moduleKey === DESIGNATED_OWNER_MODULE) {
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:8px;margin-top:2px';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary';
        addBtn.style.cssText = 'font-size:12px;padding:6px 14px';
        addBtn.textContent = '+ Add Designated Person';
        addBtn.addEventListener('click', () => {
          ensureSingleApplicantDraft(model);
          syncApplicantPeopleIntoPanAndAadhaar(model);
          renderPersonalPrimaryPreview();
          renderDesignatedPersonsLists(model);
          renderSyncedModuleSummaries();
          scheduleSave();
          focusLatestDesignatedCard(moduleKey);
        });
        addRow.appendChild(addBtn);
        summaryWrap.appendChild(addRow);
      }

      // If this module is currently being edited, DON'T collapse — re-apply edit state
      if (_editingModule === moduleKey && _editingType) {
        console.log('[renderModuleSummary] Module', moduleKey, 'is being edited, re-applying edit state:', _editingType, _editingDpIndex);
        showSinglePersonForm(moduleKey, _editingType, _editingDpIndex);
        return;
      }

      console.log('[renderModuleSummary] Collapsing', moduleKey);
      // Collapse forms — show only summary cards
      body.classList.add('pi-form-collapsed');
      // Clear any leftover inline display:important styles so CSS collapse rule can work
      Array.from(body.children).forEach(el => {
        if (el.classList && el.classList.contains('panel')) el.style.removeProperty('display');
      });
      if (summaryWrap) { summaryWrap.style.removeProperty('display'); }
      section.removeAttribute('data-focus-designated');
      section.removeAttribute('data-editing-person');
      // Clean up any stale done bars
      qsa('.pi-edit-done-bar', body).forEach(el => el.remove());
    }

    /** Render all module summaries */
    function renderAllModuleSummaries() {
      PERSONAL_MODULE_KEYS.forEach(mk => renderModuleSummary(mk));
    }

    /** Re-render summaries for synced modules only (pan, aadhaar, resident_verification) without touching applicant */
    function renderSyncedModuleSummaries() {
      ['pan', 'aadhaar', 'resident_verification'].forEach(mk => renderModuleSummary(mk));
    }

    // Expose for external callers (save handler)
    window._piRenderAllSummaries = renderAllModuleSummaries;

    // Initial render of summaries
    renderAllModuleSummaries();
    enforceApplicantOnlyDesignatedUI();

    let saveTimer = null;
    function scheduleSave() {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        writePersonalInfo(model);
      }, 200);
    }

    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-dp-add],[data-dp-remove]') : null;
      if (!btn) return;

      const addModule = btn.getAttribute('data-dp-add');
      const removePath = btn.getAttribute('data-dp-remove');

      if (addModule) {
        e.preventDefault();
        if (addModule !== DESIGNATED_OWNER_MODULE) return;
        ensureSingleApplicantDraft(model);
        syncApplicantPeopleIntoPanAndAadhaar(model);
        renderDesignatedPersonsLists(model);
        renderPersonalPrimaryPreview();
        renderSyncedModuleSummaries();
        scheduleSave();
        // Open only the new designated person's card
        focusLatestDesignatedCard(addModule);
        return;
      }

      if (removePath) {
        e.preventDefault();
        const parts = removePath.split('.');
        const moduleKey = parts[0];
        const idx = parseInt(parts[1], 10);
        if (moduleKey === DESIGNATED_OWNER_MODULE) {
          removeDesignatedPerson(model, moduleKey, idx);
        } else {
          // For non-applicant modules, find and remove from applicant source
          const dpData = Array.isArray(model[moduleKey]?.designatedPersons) ? model[moduleKey].designatedPersons[idx] : null;
          if (dpData && dpData._linkedFromApplicant && dpData._applicantKey) {
            const appList = Array.isArray(model.applicant?.designatedPersons) ? model.applicant.designatedPersons : [];
            const appIdx = appList.findIndex((p, i) => applicantPersonKey(p, i) === dpData._applicantKey);
            if (appIdx >= 0) removeDesignatedPerson(model, 'applicant', appIdx);
          } else {
            removeDesignatedPerson(model, moduleKey, idx);
          }
        }
        syncApplicantPeopleIntoPanAndAadhaar(model);
        renderDesignatedPersonsLists(model);
        renderPersonalPrimaryPreview();
        scheduleSave();
        PERSONAL_MODULE_KEYS.forEach(mk => renderModuleSummary(mk));
        showSinglePersonForm(moduleKey, 'summary');
      }
    });

    // ── "Done" button handler — return to summary dashboard after editing ──
    document.addEventListener('click', (e) => {
      const doneBtn = e.target && e.target.closest ? e.target.closest('[data-dp-done],[data-primary-done]') : null;
      if (!doneBtn) return;
      e.preventDefault();
      const mk = doneBtn.getAttribute('data-dp-done') || doneBtn.getAttribute('data-primary-done') || '';
      if (!mk) return;
      // Clear editing state FIRST so renderModuleSummary won't re-open form
      _editingModule = null;
      _editingType = null;
      _editingDpIndex = null;
      // Clear draft flags for applicant
      clearApplicantDraftFlags(model);
      syncApplicantPeopleIntoPanAndAadhaar(model);
      renderPersonalPrimaryPreview();
      scheduleSave();
      PERSONAL_MODULE_KEYS.forEach(m => renderModuleSummary(m));
      showSinglePersonForm(mk, 'summary');
    });

    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el || !el.getAttribute) return;

      // Handle designated person fields (data-dp-field)
      const dpPath = (el.getAttribute('data-dp-field') || '').toString().trim();
      if (dpPath) {
        const parts = pathToParts(dpPath);
        let v = (el.value || '').toString();
        if (parts.includes('pan_number')) v = v.toUpperCase();
        setByParts(model, parts, v);
        if (parts[0] === 'applicant') {
          syncApplicantPeopleIntoPanAndAadhaar(model);
        }
        scheduleSave();
        return;
      }

      // Handle primary fields (data-pi-field)
      const path = (el.getAttribute('data-pi-field') || '').toString().trim();
      if (!path) return;

      const parts = pathToParts(path);
      let v = (el.value || '').toString();
      if (parts.includes('pan_number')) v = v.toUpperCase();
      setByParts(model, parts, v);
      if (parts[0] === 'applicant') {
        syncApplicantPeopleIntoPanAndAadhaar(model);
      }
      if (parts[0] === 'pan' || parts[0] === 'aadhaar' || parts[0] === 'resident_verification') renderPersonalPrimaryPreview();
      scheduleSave();
    });

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const dpPath = (el.getAttribute('data-dp-field') || '').toString().trim();
      const piPath = (el.getAttribute('data-pi-field') || '').toString().trim();

      // Save DP select/dropdown changes for all modules
      if (dpPath && !dpPath.startsWith('applicant.')) {
        const parts = pathToParts(dpPath);
        setByParts(model, parts, (el.value || '').toString());
        scheduleSave();
      }

      const isApplicantField = dpPath.startsWith('applicant.') || piPath.startsWith('applicant.');
      if (!isApplicantField) return;

      syncApplicantPeopleIntoPanAndAadhaar(model);
      renderDesignatedPersonsLists(model);
      renderPersonalPrimaryPreview();
      renderSyncedModuleSummaries();
      scheduleSave();
    });

    // ── Handle designated person file uploads (data-dp-upload) ──
    document.addEventListener('change', async (e) => {
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const dpUploadPath = (el.getAttribute('data-dp-upload') || '').toString().trim();
      if (!dpUploadPath) return;

      const file = el.files && el.files[0] ? el.files[0] : null;
      if (!file) {
        setByParts(model, pathToParts(dpUploadPath), null);
        scheduleSave();
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        setByParts(model, pathToParts(dpUploadPath), {
          file_name: file.name || null,
          mime_type: file.type || null,
          size: Number(file.size || 0),
          data_url: String(dataUrl || ''),
          uploaded_at: new Date().toISOString()
        });
        renderDesignatedPersonsLists(model);
        // Immediate server save for file uploads (don't lose images on quick refresh)
        writePersonalInfo(model, { immediate: true });
      } catch {
        window.alert('Unable to read selected file. Please try again.');
      }
    });

    qsa('[data-pi-upload]').forEach((input) => {
      input.addEventListener('change', async () => {
        const path = (input.getAttribute('data-pi-upload') || '').toString().trim();
        const moduleKey = (input.getAttribute('data-pi-upload-module') || '').toString().trim();
        if (!path || !moduleKey) return;

        const file = input.files && input.files[0] ? input.files[0] : null;
        if (!file) {
          setByParts(model, pathToParts(path), null);
          renderPersonalPrimaryPreview();
          scheduleSave();
          return;
        }

        try {
          const dataUrl = await readFileAsDataUrl(file);
          setByParts(model, pathToParts(path), {
            file_name: file.name || null,
            mime_type: file.type || null,
            size: Number(file.size || 0),
            data_url: String(dataUrl || ''),
            uploaded_at: new Date().toISOString()
          });
          renderPersonalPrimaryPreview();
          // Immediate server save for file uploads (don't lose images on quick refresh)
          writePersonalInfo(model, { immediate: true });
        } catch {
          window.alert('Unable to read selected file. Please try again.');
        }
      });
    });
  }

  function bindText(key, value, fallback = '—') {
    const v = value == null || String(value).trim() === '' ? fallback : String(value);
    qsa(`[data-bind="${CSS.escape(key)}"]`).forEach((el) => {
      el.textContent = v;
    });
  }

  function setLastUpdatedNow() {
    const iso = new Date().toISOString();
    try {
      STORAGE.setItem(storageKey('lastUpdated'), iso);
    } catch {
      // ignore
    }
    bindText('lastUpdated', new Date(iso).toLocaleString('en-IN'));
  }

  function setHidden(node, hidden) {
    if (!node) return;
    if (hidden) node.setAttribute('hidden', '');
    else node.removeAttribute('hidden');
  }

  function isBlockSelectionMode() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('view') || '').toString().trim().toLowerCase() === 'blocks';
  }

  function isAllModulesMode() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('view') || '').toString().trim().toLowerCase() === 'all';
  }

  function getUrlViewMode() {
    const params = new URLSearchParams(window.location.search);
    const v = (params.get('view') || '').toString().trim().toLowerCase();
    return v || '';
  }

  function getCurrentBlockKey() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('block') || '').toString().trim();
  }

  function setWorkspaceUrl(next, mode) {
    const m = (mode || 'replace').toString().trim().toLowerCase();
    try {
      const url = new URL(window.location.href);
      if (next && Object.prototype.hasOwnProperty.call(next, 'view')) {
        const v = (next.view || '').toString().trim();
        if (v) url.searchParams.set('view', v);
        else url.searchParams.delete('view');
      }
      if (next && Object.prototype.hasOwnProperty.call(next, 'block')) {
        const b = (next.block || '').toString().trim();
        if (b) url.searchParams.set('block', b);
        else url.searchParams.delete('block');
      }

      if (m === 'push') window.history.pushState({}, '', url.toString());
      else window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  }

  // Intentionally removed: we now keep view in the URL and use pushState so Back returns to block selection.

  function exitBlockSelection(chosenBlock) {
    const picker = qs('[data-ui="block-picker"]');
    const blocksWrap = qs('.blocks');
    const businessTracker = qs('[data-tracker="business"]');
    const personalTracker = qs('[data-tracker="personal"]');

    setHidden(picker, true);
    setHidden(blocksWrap, false);

    // Push a new history entry so Back returns to the selection screen.
    // Required flow: after block selection, show one module at a time (tab behavior).
    setWorkspaceUrl({ view: 'single', block: chosenBlock }, 'push');

    // Persist selected block so reopening the case restores directly.
    try {
      STORAGE.setItem(storageKey('selectedBlock'), chosenBlock || '');
    } catch { /* ignore */ }

    applyBlockView(chosenBlock);

    // Expand animation on the chosen block (mainly for Business).
    const chosenEl = chosenBlock ? qs(`[data-block="${CSS.escape(chosenBlock)}"]`) : null;
    if (chosenEl) {
      chosenEl.classList.add('cv-expand');
      window.setTimeout(() => chosenEl.classList.remove('cv-expand'), 240);
    }

    // Ensure selected block opens in single-module mode.
    const key = (chosenBlock || '').toString().trim().toLowerCase();
    if (businessTracker) setHidden(businessTracker, key === 'personal' || key === 'report' || key === 'case_overview');
    if (personalTracker) setHidden(personalTracker, key !== 'personal');
    if (key === 'case_overview') {
      // Case overview block: single form, ensure module visible
      const main = qs('main.content') || qs('.content');
      if (main) {
        main.setAttribute('data-view', 'single');
        main.removeAttribute('data-active-module');
        main.removeAttribute('data-active-personal-module');
      }
      loadCaseOverviewFromStorage();
      updateModuleNavigatorUI();
    } else if (key === 'personal') setActivePersonalModule(readActivePersonalModule());
    else if (key === 'report') {
      const main = qs('main.content') || qs('.content');
      if (main) {
        main.setAttribute('data-view', 'single');
        main.removeAttribute('data-active-module');
        main.removeAttribute('data-active-personal-module');
      }
      renderReportBuilderPreview();
      updateModuleNavigatorUI();
    } else setActiveModule(readActiveModule());
  }

  let blockPickerBound = false;
  function enterBlockSelection() {
    const picker = qs('[data-ui="block-picker"]');
    const blocksWrap = qs('.blocks');
    const businessTracker = qs('[data-tracker="business"]');
    const personalTracker = qs('[data-tracker="personal"]');
    const overview = qs('section.overview');
    const moduleNav = qs('[data-module-nav]');

    setHidden(picker, false);
    setHidden(blocksWrap, true);
    if (businessTracker) setHidden(businessTracker, true);
    if (personalTracker) setHidden(personalTracker, true);
    if (overview) setHidden(overview, true);
    if (moduleNav) setHidden(moduleNav, true);

    if (!blockPickerBound) {
      blockPickerBound = true;
      qsa('[data-block-choice]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const chosen = (btn.getAttribute('data-block-choice') || '').toString().trim().toLowerCase();
          exitBlockSelection(chosen || 'business');
        });
      });
    }
  }

  function setStatusPill(el, status) {
    if (!el) return;
    el.setAttribute('data-status', status);
    el.textContent = STATUS_LABEL[status] || STATUS_LABEL.pending;
  }

  function readModuleStatuses() {
    const parsed = safeJSONParse(STORAGE.getItem(storageKey('moduleStatuses')), null);
    const out = {};
    MODULE_KEYS.forEach((k) => {
      out[k] = normalizeModuleStatus(parsed?.[k]);
    });
    return out;
  }

  function writeModuleStatuses(next) {
    const out = {};
    MODULE_KEYS.forEach((k) => {
      out[k] = normalizeModuleStatus(next?.[k]);
    });
    STORAGE.setItem(storageKey('moduleStatuses'), JSON.stringify(out));
    setLastUpdatedNow();

    // Persist module statuses to server for Report Builder integration
    if (HAS_CASE_ID) {
      saveSnapshotToServer('module_statuses', JSON.stringify(out)).catch(() => {});
    }

    return out;
  }

  function computeProgress(statuses) {
    const weights = { pending: 0, in_progress: 0.5, completed: 1 };
    var pCompletion = readPersonalModuleCompletion();
    // Include both business and personal modules
    const businessDone = MODULE_KEYS.reduce((sum, k) => sum + (weights[normalizeModuleStatus(statuses?.[k])] ?? 0), 0);
    const personalDone = PERSONAL_MODULE_KEYS.reduce((sum, k) => {
      if (pCompletion[k]) return sum + 1;
      if (getPersonalModuleDataStatus(k)) return sum + 0.5;
      return sum;
    }, 0);
    const total = MODULE_KEYS.length + PERSONAL_MODULE_KEYS.length;
    return Math.round(((businessDone + personalDone) / Math.max(1, total)) * 100);
  }

  function deriveOverallStatus(statuses) {
    var pCompletion = readPersonalModuleCompletion();
    const businessValues = MODULE_KEYS.map((k) => normalizeModuleStatus(statuses?.[k]));
    const personalValues = PERSONAL_MODULE_KEYS.map((k) => {
      if (pCompletion[k]) return STATUS.completed;
      if (getPersonalModuleDataStatus(k)) return STATUS.in_progress;
      return STATUS.pending;
    });
    const allValues = [...businessValues, ...personalValues];
    if (allValues.every((s) => s === STATUS.completed)) return 'completed';
    if (allValues.some((s) => s === STATUS.completed || s === STATUS.in_progress)) return 'ongoing';
    return 'draft';
  }

  function setTrackerActive(moduleKey) {
    qsa('.tracker-item[data-module]').forEach((btn) => {
      btn.setAttribute('data-active', btn.getAttribute('data-module') === moduleKey ? 'true' : 'false');
    });
  }

  function setPersonalTrackerActive(moduleKey) {
    qsa('.tracker-item[data-personal-module]').forEach((btn) => {
      btn.setAttribute('data-active', btn.getAttribute('data-personal-module') === moduleKey ? 'true' : 'false');
    });
  }

  function scrollTrackerTabIntoView(moduleKey, { smooth = true } = {}) {
    const btn = qs(`.tracker-tabs .tracker-item[data-module="${CSS.escape(moduleKey)}"]`);
    if (!btn) return;
    const wrap = btn.closest('.tracker-tabs');
    if (!wrap) {
      try {
        btn.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
      } catch {
        // ignore
      }
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();

    // If already fully visible, do nothing.
    const fullyVisible = btnRect.left >= wrapRect.left + 8 && btnRect.right <= wrapRect.right - 8;
    if (fullyVisible) return;

    const targetLeft =
      wrap.scrollLeft +
      (btnRect.left - wrapRect.left) -
      (wrap.clientWidth / 2 - btnRect.width / 2);

    try {
      wrap.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? 'smooth' : 'auto' });
    } catch {
      wrap.scrollLeft = Math.max(0, targetLeft);
    }
  }

  function scrollPersonalTrackerTabIntoView(moduleKey, { smooth = true } = {}) {
    const btn = qs(`[data-tracker="personal"].tracker-tabs .tracker-item[data-personal-module="${CSS.escape(moduleKey)}"]`);
    if (!btn) return;
    const wrap = btn.closest('.tracker-tabs');
    if (!wrap) {
      try {
        btn.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
      } catch {
        // ignore
      }
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const fullyVisible = btnRect.left >= wrapRect.left + 8 && btnRect.right <= wrapRect.right - 8;
    if (fullyVisible) return;

    const targetLeft =
      wrap.scrollLeft +
      (btnRect.left - wrapRect.left) -
      (wrap.clientWidth / 2 - btnRect.width / 2);

    try {
      wrap.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? 'smooth' : 'auto' });
    } catch {
      wrap.scrollLeft = Math.max(0, targetLeft);
    }
  }

  function applyHeaderHeightVar() {
    const header = qs('header.app-header');
    if (!header) return;
    const h = Math.max(0, Math.floor(header.getBoundingClientRect().height || header.offsetHeight || 0));
    if (!h) return;
    document.documentElement.style.setProperty('--app-header-height', `${h}px`);
  }

  function setupHeaderCollapseOnScroll() {
    let raf = null;

    const compute = () => {
      raf = null;
      const header = qs('header.app-header');
      if (!header) return;

      const headerHeight = Math.max(0, Math.floor(header.getBoundingClientRect().height || header.offsetHeight || 0));
      const main = qs('main.content') || qs('.content');

      // Determine the correct module-head based on active block
      const activeBlock = (main?.getAttribute('data-active-block') || '').toString().trim().toLowerCase();
      let head = null;
      if (activeBlock === 'personal') {
        const personalKey = main?.getAttribute('data-active-personal-module') || readActivePersonalModule();
        head = qs(`[data-block="personal"] [data-personal-section="${CSS.escape(personalKey)}"] .module-head`);
      } else if (activeBlock === 'report') {
        head = qs(`[data-block="report"] .module-head`);
      } else {
        const active = main?.getAttribute('data-active-module') || readActiveModule();
        head = qs(`[data-module-section="${CSS.escape(active)}"] .module-head`);
      }

      if (!head || head.offsetParent === null) {
        document.body.classList.remove('header-collapsed');
        return;
      }

      const headRect = head.getBoundingClientRect();
      const scrolled = window.scrollY || document.documentElement.scrollTop || 0;

      // Collapse when the active module header reaches the top area.
      const shouldCollapse = scrolled > 10 && headRect.top <= headerHeight + 8;
      document.body.classList.toggle('header-collapsed', shouldCollapse);
    };

    const schedule = () => {
      if (raf != null) return;
      raf = window.requestAnimationFrame(compute);
    };

    // Listen to scroll on window (body is the scroll container)
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', () => {
      applyHeaderHeightVar();
      schedule();
    });

    applyHeaderHeightVar();
    compute();
  }

  function readActiveModule() {
    const raw = (STORAGE.getItem(storageKey('activeModule')) || '').toString().trim();
    return MODULE_KEYS.includes(raw) ? raw : MODULE_KEYS[0];
  }

  function readActivePersonalModule() {
    const raw = (STORAGE.getItem(storageKey('activePersonalModule')) || '').toString().trim();
    return PERSONAL_MODULE_KEYS.includes(raw) ? raw : PERSONAL_MODULE_KEYS[0];
  }

  function getActiveBlockFromView() {
    const main = qs('main.content') || qs('.content');
    const attr = (main?.getAttribute('data-active-block') || '').toString().trim().toLowerCase();
    if (attr === 'personal') return 'personal';
    if (attr === 'report') return 'report';
    if (attr === 'case_overview') return 'case_overview';
    return 'business';
  }

  function getModuleDisplayName(blockKey, moduleKey) {
    if (blockKey === 'personal') {
      const btn = qs(`[data-tracker="personal"] .tracker-item[data-personal-module="${CSS.escape(moduleKey)}"] .tracker-name`);
      return (btn?.textContent || moduleKey || '').toString().trim() || moduleKey;
    }
    const btn = qs(`[data-tracker="business"] .tracker-item[data-module="${CSS.escape(moduleKey)}"] .tracker-name`);
    return (btn?.textContent || moduleKey || '').toString().trim() || moduleKey;
  }

  function updateModuleNavigatorUI() {
    const wrap = qs('[data-module-nav]');
    if (!wrap) return;

    // Hide module-nav when block picker is visible
    if (isBlockSelectionMode()) {
      wrap.setAttribute('hidden', '');
      return;
    }

    const label = qs('[data-module-nav-label]', wrap);
    const prev = qs('[data-module-nav-btn="prev"]', wrap);
    const next = qs('[data-module-nav-btn="next"]', wrap);

    const blockKey = getActiveBlockFromView();
    if (blockKey === 'report') {
      // Show module-nav for report with only the block switcher
      if (wrap) wrap.removeAttribute('hidden');
      if (prev) prev.style.display = 'none';
      if (next) next.style.display = 'none';
      if (label) label.style.display = 'none';
      const blockSwitcher = qs('[data-block-switcher]', wrap);
      if (blockSwitcher) {
        blockSwitcher.selectedIndex = 0;
        Array.from(blockSwitcher.options).forEach((opt) => {
          opt.disabled = opt.value === 'report';
        });
      }
      return;
    }
    if (wrap) wrap.removeAttribute('hidden');
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
    if (label) label.style.display = '';

    // Case overview: hide module-nav entirely (block-head already has cross-block buttons)
    if (blockKey === 'case_overview') {
      if (wrap) wrap.setAttribute('hidden', '');
      return;
    }

    // Disable current block in the switcher dropdown
    const blockSwitcher = qs('[data-block-switcher]', wrap);
    if (blockSwitcher) {
      blockSwitcher.selectedIndex = 0;
      Array.from(blockSwitcher.options).forEach((opt) => {
        opt.disabled = opt.value === blockKey;
      });
    }

    const keys = blockKey === 'personal' ? PERSONAL_MODULE_KEYS : MODULE_KEYS;
    const activeKey = blockKey === 'personal' ? readActivePersonalModule() : readActiveModule();
    const idx = Math.max(0, keys.indexOf(activeKey));
    const total = Math.max(1, keys.length);
    const display = getModuleDisplayName(blockKey, keys[idx] || activeKey);

    if (label) label.textContent = `${blockKey === 'personal' ? 'Personal' : 'Business'}: ${display} (${idx + 1}/${total})`;
    if (prev) prev.disabled = total <= 1;
    if (next) next.disabled = total <= 1;
  }

  function switchToOtherBlock() {
    const blockKey = getActiveBlockFromView();
    const nextBlock = blockKey === 'case_overview' ? 'business' : blockKey === 'business' ? 'personal' : blockKey === 'personal' ? 'report' : 'business';

    setWorkspaceUrl({ view: 'single', block: nextBlock }, 'replace');
    applyBlockView(nextBlock);

    if (nextBlock === 'personal') {
      setActivePersonalModule(readActivePersonalModule());
      return;
    }

    if (nextBlock === 'report') {
      updateModuleNavigatorUI();
      return;
    }

    setActiveModule(readActiveModule());
  }

  function navigateActiveModule(step) {
    const delta = Number(step) < 0 ? -1 : 1;
    const blockKey = getActiveBlockFromView();
    if (blockKey === 'report') return;

    // From case_overview, next → first business module (GST), prev → stay
    if (blockKey === 'case_overview') {
      if (delta > 0) {
        setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
        applyBlockView('business');
        goToModule(MODULE_KEYS[0]);
      }
      return;
    }

    const keys = blockKey === 'personal' ? PERSONAL_MODULE_KEYS : MODULE_KEYS;
    if (!Array.isArray(keys) || keys.length === 0) return;

    const activeKey = blockKey === 'personal' ? readActivePersonalModule() : readActiveModule();
    const current = keys.indexOf(activeKey);
    const base = current >= 0 ? current : 0;
    const nextIndex = (base + delta + keys.length) % keys.length;
    const nextKey = keys[nextIndex] || keys[0];

    if (blockKey === 'personal') {
      setWorkspaceUrl({ view: 'single', block: 'personal' }, 'replace');
      applyBlockView('personal');
      setActivePersonalModule(nextKey);
      return;
    }

    setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
    applyBlockView('business');
    goToModule(nextKey);
  }

  function isTypingTarget(node) {
    if (!node || !node.closest) return false;
    return Boolean(node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hasAttribute('hidden')) return false;
    return el.getClientRects().length > 0;
  }

  function getModuleScrollOffset() {
    let offset = 0;

    const header = qs('header.app-header');
    if (header && !document.body.classList.contains('header-collapsed')) {
      offset += Math.max(0, Math.floor(header.getBoundingClientRect().height || 0));
    }

    const activeTracker = qsa('.tracker-tabs').find((el) => isVisible(el));
    if (activeTracker) {
      offset += Math.max(0, Math.floor(activeTracker.getBoundingClientRect().height || 0));
      offset += 8;
    }

    const moduleNav = qs('.module-nav');
    if (isVisible(moduleNav)) {
      offset += Math.max(0, Math.floor(moduleNav.getBoundingClientRect().height || 0));
      offset += 8;
    }

    return Math.max(80, offset);
  }

  function scrollElementToStart(target, behavior = 'auto') {
    if (!target) return;
    // Use natural page scrolling (body is the scroll container)
    const rect = target.getBoundingClientRect();
    const currentY = window.scrollY || document.documentElement.scrollTop || 0;
    const nextTop = Math.max(0, Math.floor(currentY + rect.top - getModuleScrollOffset()));
    try {
      window.scrollTo({ top: nextTop, behavior });
    } catch {
      window.scrollTo(0, nextTop);
    }
  }

  function scrollModuleIntoView(moduleKey, behavior = 'auto') {
    const key = MODULE_KEYS.includes(moduleKey) ? moduleKey : MODULE_KEYS[0];
    const head = qs(`[data-module-section="${CSS.escape(key)}"] .module-head`);
    const section = qs(`[data-module-section="${CSS.escape(key)}"]`);
    const target = head || section;
    scrollElementToStart(target, behavior);
  }

  function goToModule(moduleKey) {
    const key = MODULE_KEYS.includes(moduleKey) ? moduleKey : MODULE_KEYS[0];
    const main = qs('main.content') || qs('.content');

    // Always persist last module and keep tracker UI consistent.
    try {
      STORAGE.setItem(storageKey('activeModule'), key);
    } catch {
      // ignore
    }
    if (main) main.setAttribute('data-active-module', key);

    setTrackerActive(key);
    scrollTrackerTabIntoView(key);

    // Default behavior: one-module-per-page (single view).
    // Business module navigation always implies Business block.
    setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
    applyBlockView('business');
    setActiveModule(key);

    // Load Additional Details form data when navigating to that module
    if (key === 'additional_details') loadAdditionalDetailsFromStorage();
  }

  function setActiveModule(moduleKey) {
    const key = MODULE_KEYS.includes(moduleKey) ? moduleKey : MODULE_KEYS[0];
    const main = qs('main.content') || qs('.content');
    if (main) {
      main.setAttribute('data-view', 'single');
      main.setAttribute('data-active-module', key);
      main.removeAttribute('data-active-personal-module');
    }
    try {
      STORAGE.setItem(storageKey('activeModule'), key);
    } catch {
      // ignore
    }

    // Keep embedded tools collapsed when switching modules.
    // Prevents long blank iframe areas during module navigation.
    qsa('[data-embed]').forEach((wrap) => {
      wrap.setAttribute('hidden', '');
    });
    qsa('[data-action="toggle-embed"]').forEach((btn) => {
      btn.textContent = 'Show embedded tool';
    });
    qsa('[data-action="fetch-gst-record"], [data-action="fetch-mca-record"]').forEach((btn) => {
      btn.style.display = '';
    });

    setTrackerActive(key);
    scrollTrackerTabIntoView(key);

    // In addition to toggling view, jump to the module section.
    scrollModuleIntoView(key);

    // Re-evaluate header overlap behavior for the newly active module.
    try {
      const ev = new Event('scroll');
      window.dispatchEvent(ev);
    } catch {
      // ignore
    }

    updateModuleNavigatorUI();
  }

  function scrollPersonalModuleIntoView(moduleKey, behavior = 'auto') {
    const key = PERSONAL_MODULE_KEYS.includes(moduleKey) ? moduleKey : PERSONAL_MODULE_KEYS[0];
    const head = qs(`[data-block="personal"] [data-personal-section="${CSS.escape(key)}"] .module-head`);
    const section = qs(`[data-block="personal"] [data-personal-section="${CSS.escape(key)}"]`);
    const target = head || section;
    scrollElementToStart(target, behavior);
  }

  function setActivePersonalModule(moduleKey) {
    const key = PERSONAL_MODULE_KEYS.includes(moduleKey) ? moduleKey : PERSONAL_MODULE_KEYS[0];
    const main = qs('main.content') || qs('.content');
    if (main) {
      main.setAttribute('data-view', 'single');
      main.setAttribute('data-active-personal-module', key);
      main.removeAttribute('data-active-module');
    }
    try {
      STORAGE.setItem(storageKey('activePersonalModule'), key);
    } catch {
      // ignore
    }

    setPersonalTrackerActive(key);
    scrollPersonalTrackerTabIntoView(key);
    scrollPersonalModuleIntoView(key);
    updateModuleNavigatorUI();
  }

  function showAllModules() {
    const main = qs('main.content') || qs('.content');
    if (!main) return;
    main.setAttribute('data-view', 'all');
    main.removeAttribute('data-active-module');
    main.removeAttribute('data-active-personal-module');
  }

  function bindBlockHeaderClicks() {
    const businessHead = qs('[data-block="business"] .block-head');
    const personalHead = qs('[data-block="personal"] .block-head');
    const reportHead = qs('[data-block="report"] .block-head');
    const businessTracker = qs('[data-tracker="business"]');
    const personalTracker = qs('[data-tracker="personal"]');

    if (businessHead) {
      businessHead.addEventListener('click', (event) => {
        const trigger = event?.target?.closest?.('button, select, input, textarea, a, label');
        if (trigger) return;
        if (isBlockSelectionMode()) return;
        applyBlockView('business');
        setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
        if (businessTracker) businessTracker.removeAttribute('hidden');
        if (personalTracker) personalTracker.setAttribute('hidden', '');
        setActiveModule(readActiveModule());

        // Bring module tabs into view after switching.
        try {
          businessTracker?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch {
          // ignore
        }
      });
    }

    if (personalHead) {
      personalHead.addEventListener('click', (event) => {
        const trigger = event?.target?.closest?.('button, select, input, textarea, a, label');
        if (trigger) return;
        if (isBlockSelectionMode()) return;
        applyBlockView('personal');
        setWorkspaceUrl({ view: 'single', block: 'personal' }, 'replace');
        if (businessTracker) businessTracker.setAttribute('hidden', '');
        if (personalTracker) personalTracker.removeAttribute('hidden');
        setActivePersonalModule(readActivePersonalModule());
        try {
          personalHead.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch {
          // ignore
        }
      });
    }

    if (reportHead) {
      reportHead.addEventListener('click', (event) => {
        const trigger = event?.target?.closest?.('button, select, input, textarea, a, label');
        if (trigger) return;
        if (isBlockSelectionMode()) return;
        applyBlockView('report');
        setWorkspaceUrl({ view: 'single', block: 'report' }, 'replace');
        if (businessTracker) businessTracker.setAttribute('hidden', '');
        if (personalTracker) personalTracker.setAttribute('hidden', '');
        updateModuleNavigatorUI();
        try {
          reportHead.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch {
          // ignore
        }
      });
    }
  }

  function showAllModulesForPrint() {
    const main = qs('main.content') || qs('.content');
    if (!main) {
      window.print();
      return;
    }

    const prevView = main.getAttribute('data-view');
    const prevActive = main.getAttribute('data-active-module');

    main.setAttribute('data-view', 'all');
    main.removeAttribute('data-active-module');

    const onAfter = () => {
      window.removeEventListener('afterprint', onAfter);
      if (prevView != null) main.setAttribute('data-view', prevView);
      else main.removeAttribute('data-view');
      if (prevActive != null) main.setAttribute('data-active-module', prevActive);
      else main.removeAttribute('data-active-module');
    };

    window.addEventListener('afterprint', onAfter);
    window.print();
  }

  function updateUIFromStatuses(statuses) {
    MODULE_KEYS.forEach((key) => {
      const st = normalizeModuleStatus(statuses?.[key]);
      const pill = qs(`[data-module-status="${CSS.escape(key)}"]`);
      setStatusPill(pill, st);

      const select = qs(`[data-status-select="${CSS.escape(key)}"]`);
      if (select) select.value = st;

      const trackerBtn = qs(`.tracker-item[data-module="${CSS.escape(key)}"]`);
      if (trackerBtn) {
        const dot = qs('[data-status-dot]', trackerBtn);
        const text = qs('[data-status-text]', trackerBtn);
        if (dot) {
          dot.setAttribute('data-status', st);
          dot.style.background = `var(--${st})`;
        }
        if (text) text.textContent = STATUS_LABEL[st] || STATUS_LABEL.pending;
      }
    });

    // Update personal module tracker dots based on completion toggle + data presence
    var pCompletion = readPersonalModuleCompletion();
    PERSONAL_MODULE_KEYS.forEach((key) => {
      const isComplete = !!pCompletion[key];
      const hasData = getPersonalModuleDataStatus(key);
      const st = isComplete ? STATUS.completed : (hasData ? STATUS.in_progress : STATUS.pending);
      const trackerBtn = qs(`.tracker-item[data-personal-module="${CSS.escape(key)}"]`);
      if (trackerBtn) {
        const dot = qs('.tracker-dot', trackerBtn);
        const text = qs('.tracker-status', trackerBtn);
        if (dot) {
          dot.setAttribute('data-status', st);
          dot.style.background = `var(--${st})`;
        }
        if (text) text.textContent = STATUS_LABEL[st] || STATUS_LABEL.pending;
      }
      // Update toggle checkbox
      var toggle = document.querySelector('[data-personal-complete-toggle="' + key + '"]');
      if (toggle) toggle.checked = isComplete;
    });

    const progress = computeProgress(statuses);
    const overall = deriveOverallStatus(statuses);

    const overallPills = qsa('[data-bind="overallStatus"]');
    overallPills.forEach((overallPill) => {
      overallPill.setAttribute('data-status', overall);
      overallPill.textContent = overall === 'completed' ? 'Completed' : overall === 'ongoing' ? 'Ongoing' : 'Draft';
    });

    const progressValues = qsa('[data-bind="overallProgress"]');
    progressValues.forEach((progressValue) => {
      progressValue.textContent = `${progress}%`;
    });

    const fill = qs('[data-bind-style="progressWidth"]');
    if (fill) fill.style.width = `${progress}%`;

    const bar = qs('.progress[role="progressbar"]');
    if (bar) bar.setAttribute('aria-valuenow', String(progress));
  }

  function prettyJSON(value) {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }

  function getDeep(obj, path) {
    if (!obj) return null;
    const parts = String(path).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[p];
    }
    return cur;
  }

  function firstNonEmpty(obj, paths) {
    for (const p of paths) {
      const v = getDeep(obj, p);
      if (v == null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
    return null;
  }

  function renderJSON(moduleKey, rawValue) {
    const pre = qs(`[data-json="${CSS.escape(moduleKey)}"]`);
    if (!pre) return;
    pre.textContent = prettyJSON(rawValue);
  }

  function readIntegrationObject(key) {
    return safeJSONParse(STORAGE.getItem(storageKey(`integration.${key}`)), null);
  }

  function readPanFromStorage() {
    return readIntegrationObject('panData');
  }

  function readUdyamFromStorage() {
    return readIntegrationObject('udyamData');
  }

  function readItrFromStorage() {
    return readIntegrationObject('itrData');
  }

  function readBankStatementFromStorage() {
    return readIntegrationObject('bankStatementData');
  }

  function readFinancialFromStorage() {
    return readIntegrationObject('financialData');
  }

  function writeFinancialIntegration(payload) {
    STORAGE.setItem(storageKey('integration.financialData'), JSON.stringify(payload));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('financial', JSON.stringify(payload)).catch(() => {});
  }

  /* ════════════════════════════════════════════════════════════
     Financial Calculation Engine — Embedded Module Logic
     ════════════════════════════════════════════════════════════ */

  const FC_API = '/api/financial-calc';
  let fcSchema = null;
  let fcYearCount = 3;
  let fcActiveYear = 0;
  let fcLastResult = null;

  function fcQs(sel) { return document.querySelector(sel); }
  function fcQsa(sel) { return document.querySelectorAll(sel); }

  function fcSetStatus(text) {
    const el = fcQs('[data-fc-status]');
    if (el) el.textContent = String(text || '').trim() || 'Ready';
  }

  function fcToast(msg, type) {
    type = type || 'success';
    const el = document.createElement('div');
    el.className = 'fc-toast fc-toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  function fcFmt(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fcEsc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ── Build Forms from Schema ─── */
  function fcBuildForms() {
    var formsEl = fcQs('[data-fc-year-forms]');
    if (!formsEl || !fcSchema) return;
    formsEl.innerHTML = '';

    // Hide year tabs — we show all years in one view now
    var tabsEl = fcQs('[data-fc-year-tabs]');
    if (tabsEl) tabsEl.style.display = 'none';

    // Single unified form
    var form = document.createElement('div');
    form.className = 'fc-year-form active';
    form.setAttribute('data-fc-year-form', '0');

    // ── Year column headers ──
    var yearHeaders = '<div class="fc-field-row fc-field-row-header"><div class="fc-field-label" style="font-weight:700">Parameter</div>';
    for (var h = 0; h < fcYearCount; h++) {
      yearHeaders += '<div class="fc-year-col-head">Year ' + (h + 1) + (h === 0 ? ' (Latest)' : '') + '</div>';
    }
    yearHeaders += '</div>';

    // ── Metadata section — all years side by side ──
    var metaFields = fcSchema.metadata_fields || [];
    var metaHtml = '<div class="fc-form-section"><div class="fc-form-section-head">Year Metadata</div><div class="fc-form-section-body">';
    metaHtml += yearHeaders;
    metaFields.forEach(function (f) {
      metaHtml += '<div class="fc-field-row">';
      metaHtml += '<div class="fc-field-label">' + fcEsc(f.label) + '</div>';
      for (var yi = 0; yi < fcYearCount; yi++) {
        metaHtml += '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" class="fc-field-input" id="fcy' + yi + '_' + f.key + '" data-fc-y="' + yi + '" data-fc-field="' + f.key + '" placeholder="' + fcEsc(f.default || '') + '" value="' + fcEsc(f.default || '') + '" />';
      }
      metaHtml += '</div>';
    });
    metaHtml += '</div></div>';

    // ── Financial field sections — all years side by side ──
    var sectionDefs = [
      { label: 'Profitability Statement (Row 7–32)', start: 'net_sales', end: 'gross_cash_accruals' },
      { label: 'Balance Sheet: Assets (Row 39–66)', start: 'gross_block', end: 'total_assets' },
      { label: 'Balance Sheet: Liabilities (Row 73–108)', start: 'paid_up_equity_share_capital', end: 'total_liabilities' }
    ];

    var sectionsHtml = '';
    sectionDefs.forEach(function (sec) {
      var fields = fcGetFieldsForSection(sec.start, sec.end);
      sectionsHtml += '<div class="fc-form-section"><div class="fc-form-section-head" onclick="this.parentElement.classList.toggle(\'collapsed\')">' + fcEsc(sec.label) + '</div><div class="fc-form-section-body">';
      sectionsHtml += yearHeaders;
      fields.forEach(function (f) {
        if (f.computed) return;          // skip formula fields — they are not inputs
        sectionsHtml += '<div class="fc-field-row">';
        sectionsHtml += '<div class="fc-field-label">' + fcEsc(f.label) + ' <span class="fc-field-hint">(Row ' + f.row + ')</span></div>';
        for (var yi = 0; yi < fcYearCount; yi++) {
          sectionsHtml += '<input type="number" step="any" class="fc-field-input" id="fcy' + yi + '_' + f.key + '" data-fc-y="' + yi + '" data-fc-field="' + f.key + '" placeholder="0.00" />';
        }
        sectionsHtml += '</div>';
      });
      sectionsHtml += '</div></div>';
    });

    form.innerHTML = metaHtml + sectionsHtml;
    formsEl.appendChild(form);
  }

  function fcGetFieldsForSection(startKey, endKey) {
    var fields = fcSchema.financial_fields || [];
    var collecting = false;
    var result = [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].key === startKey) collecting = true;
      if (collecting) result.push(fields[i]);
      if (fields[i].key === endKey) break;
    }
    return result;
  }

  /* ── Tab Management ─── */
  function fcSetActiveYear(yi) {
    fcActiveYear = yi;
    fcQsa('.fc-year-tab').forEach(function (t) { t.classList.toggle('active', parseInt(t.getAttribute('data-fc-year'), 10) === yi); });
    fcQsa('.fc-year-form').forEach(function (f) { f.classList.toggle('active', parseInt(f.getAttribute('data-fc-year-form'), 10) === yi); });
  }

  function fcRenderTabs() {
    var tabsEl = fcQs('[data-fc-year-tabs]');
    if (!tabsEl) return;
    var tabsHtml = '';
    for (var i = 0; i < fcYearCount; i++) {
      tabsHtml += '<button class="fc-year-tab' + (i === fcActiveYear ? ' active' : '') + '" type="button" data-fc-year="' + i + '">Year ' + (i + 1) + (i === 0 ? ' (Latest)' : '') + '</button>';
    }
    tabsHtml += '<button class="btn btn-sm btn-secondary" type="button" data-fc-add-year title="Add Year (max 5)">+ Add Year</button>';
    tabsEl.innerHTML = tabsHtml;
  }

  function fcAddYear() {
    if (fcYearCount >= 5) { fcToast('Maximum 5 years supported', 'warn'); return; }
    fcYearCount++;
    fcBuildForms();
    // Re-restore saved data if available
    var lsKey = 'fcAutoSave_' + (window._caseId || '');
    try { var saved = JSON.parse(localStorage.getItem(lsKey)); if (saved && saved.input) fcRestoreFormInputs(saved.input); } catch(e) {}
  }

  /* ── Collect Form Data ─── */
  function fcCollectInput() {
    var years = [];
    var formsEl = fcQs('[data-fc-year-forms]');
    for (var yi = 0; yi < fcYearCount; yi++) {
      var yearData = {};
      var inputs = formsEl ? formsEl.querySelectorAll('[data-fc-y="' + yi + '"]') : [];
      inputs.forEach(function (inp) {
        var key = inp.getAttribute('data-fc-field');
        var val = inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value;
        yearData[key] = val;
      });
      years.push(yearData);
    }

    var companyNameEl = qs('[data-bind="businessName"]');
    var caseIdEl = qs('[data-bind="caseId"]');

    return {
      company_name: companyNameEl ? companyNameEl.textContent.trim() : '',
      case_id: caseIdEl ? caseIdEl.textContent.trim() : '',
      years: years
    };
  }

  /* ── Restore Form Inputs from saved data ─── */
  function fcRestoreFormInputs(savedInput) {
    if (!savedInput || !Array.isArray(savedInput.years)) return;
    var formsEl = fcQs('[data-fc-year-forms]');
    if (!formsEl) return;
    // Ensure we have enough year columns
    var needed = Math.min(savedInput.years.length, 5);
    if (needed > fcYearCount) {
      fcYearCount = needed;
      fcBuildForms();
    }
    savedInput.years.forEach(function(yearData, yi) {
      if (!yearData || typeof yearData !== 'object') return;
      Object.keys(yearData).forEach(function(key) {
        var inp = formsEl.querySelector('[data-fc-y="' + yi + '"][data-fc-field="' + key + '"]');
        if (!inp) return;
        var val = yearData[key];
        // Only fill non-zero numeric values; leave empty fields blank
        if (inp.type === 'number') {
          inp.value = (val !== 0 && val !== '0' && val !== '' && val != null) ? val : '';
        } else {
          inp.value = (val != null && val !== '') ? val : '';
        }
      });
    });
  }

  /* ── Run Calculation ─── */
  async function fcRunCalculation() {
    var input = fcCollectInput();

    // Show overlay
    var overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.id = 'fcCalcOverlay';
    overlay.innerHTML = '<div class="fc-overlay-box"><div class="fc-spinner"></div><div class="fc-overlay-text">Computing Financial Ratios...</div></div>';
    document.body.appendChild(overlay);

    try {
      fcSetStatus('Calculating…');
      var res = await fetch(FC_API + '/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      var json = await res.json();
      overlay.remove();

      if (json.success) {
        fcLastResult = json.data;
        fcRenderResults(json.data, json.warnings);

        // Store for integration
        var payload = {
          source: 'financial-calc-engine',
          calculatedAt: new Date().toISOString(),
          input: input,
          output: json.data,
          raw: json.data
        };
        writeFinancialIntegration(payload);
        renderJSON('financial', json.data);

        // Save to server
        if (HAS_CASE_ID) saveSnapshotToServer('financial', JSON.stringify(payload)).catch(() => {});

        fcSetStatus('Done');
        fcToast('Calculation complete!', 'success');
      } else {
        fcSetStatus('Failed');
        fcToast((json.errors || []).join(', ') || 'Calculation failed', 'error');
      }
    } catch (e) {
      overlay.remove();
      fcSetStatus('Failed');
      fcToast('Calculation request failed', 'error');
      console.error(e);
    }
  }

  /* ── Render Results ─── */
  function fcRenderResults(data, warnings) {
    var resultsEl = fcQs('[data-fc-results]');
    if (resultsEl) resultsEl.removeAttribute('hidden');

    // Eligibility cards
    var elig = data.eligibility || {};
    var flags = elig.flags || {};
    var cardsHtml = '';
    cardsHtml += fcCardHtml('Grade', elig.grade || 'N/A', 'Score: ' + (elig.score || 0) + '/' + (elig.max_score || 6), 'grade-' + (elig.grade || 'poor').toLowerCase());
    cardsHtml += fcCardHtml('Net Worth', fcFmt(elig.net_worth), 'Tangible Net Worth', elig.net_worth > 0 ? 'pass' : 'fail');
    cardsHtml += fcCardHtml('Total Debt', fcFmt(elig.total_debt), '', '');
    cardsHtml += fcCardHtml('Max Term Loan (Ind.)', fcFmt(elig.max_term_loan_indicative), 'Indicative', '');
    cardsHtml += fcCardHtml('Max WC (Ind.)', fcFmt(elig.max_working_capital_indicative), 'Indicative', '');
    Object.keys(flags).forEach(function (k) {
      cardsHtml += fcCardHtml(k.replace(/_/g, ' '), flags[k] ? '✓ PASS' : '✗ FAIL', '', flags[k] ? 'pass' : 'fail');
    });
    var cardsEl = fcQs('[data-fc-eligibility-cards]');
    if (cardsEl) cardsEl.innerHTML = cardsHtml;

    // Ratio tables
    fcRenderRatioTable('[data-fc-ratio="profitability"]', data.profitability, '%');
    fcRenderRatioTable('[data-fc-ratio="liquidity"]', data.liquidity);
    fcRenderRatioTable('[data-fc-ratio="leverage"]', data.leverage);
    fcRenderRatioTable('[data-fc-ratio="growth"]', data.growth, '%');
    var turnover = (data.years && data.years[0] && data.years[0].computed) ? data.years[0].computed.turnover : {};
    fcRenderRatioTable('[data-fc-ratio="turnover"]', turnover || {});
    fcRenderRatioTable('[data-fc-ratio="derived"]', data.derived_metrics);

    // Yearwise detail table
    fcRenderYearwiseTable(data.years || []);

    // JSON output
    var jsonStr = JSON.stringify(data, null, 2);
    var jsonEl = fcQs('[data-fc-json]');
    if (jsonEl) jsonEl.textContent = jsonStr;

    // Scroll to results
    if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fcCardHtml(label, value, sub, cls) {
    return '<div class="fc-summary-card ' + (cls || '') + '">' +
      '<div class="fc-card-label">' + fcEsc(label) + '</div>' +
      '<div class="fc-card-value">' + fcEsc(String(value)) + '</div>' +
      (sub ? '<div class="fc-card-sub">' + fcEsc(sub) + '</div>' : '') +
      '</div>';
  }

  function fcRenderRatioTable(selector, obj, suffix) {
    suffix = suffix || '';
    var el = document.querySelector(selector);
    if (!el || !obj) return;
    el.innerHTML = Object.keys(obj).map(function (k) {
      var v = obj[k];
      var num = typeof v === 'number' ? v : 0;
      var cls = num > 0 ? 'positive' : num < 0 ? 'negative' : 'neutral';
      return '<div class="fc-ratio-row"><div class="fc-ratio-label">' +
        k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) +
        '</div><div class="fc-ratio-value ' + cls + '">' + fcFmt(num) + suffix + '</div></div>';
    }).join('');
  }

  function fcRenderYearwiseTable(years) {
    var el = fcQs('[data-fc-yearwise]');
    if (!el || !years.length) return;

    var headers = ['Metric'];
    years.forEach(function (y) { headers.push(y.period || 'Year'); });

    var sections = [
      { title: 'Profitability Statement', key: 'profit_and_loss' },
      { title: 'Balance Sheet', key: 'balance_sheet' },
      { title: 'Liquidity', key: 'liquidity' },
      { title: 'Capital Structure', key: 'capital_structure' },
      { title: 'Profitability Ratios', key: 'profitability' },
      { title: 'Growth', key: 'growth' },
      { title: 'Turnover', key: 'turnover' },
      { title: 'Solvency', key: 'solvency' }
    ];

    var html = '<table class="fc-yearwise-table"><thead><tr>';
    headers.forEach(function (h) { html += '<th>' + fcEsc(h) + '</th>'; });
    html += '</tr></thead><tbody>';

    sections.forEach(function (sec) {
      html += '<tr class="fc-section-header"><td colspan="' + headers.length + '">' + fcEsc(sec.title) + '</td></tr>';
      var allKeys = [];
      years.forEach(function (y) {
        var obj = y.computed ? y.computed[sec.key] : null;
        if (obj) Object.keys(obj).forEach(function (k) { if (allKeys.indexOf(k) === -1) allKeys.push(k); });
      });
      allKeys.forEach(function (k) {
        html += '<tr><td>' + k.replace(/_/g, ' ') + '</td>';
        years.forEach(function (y) {
          var v = (y.computed && y.computed[sec.key]) ? y.computed[sec.key][k] : undefined;
          html += '<td>' + (typeof v === 'number' ? fcFmt(v) : fcEsc(String(v != null ? v : ''))) + '</td>';
        });
        html += '</tr>';
      });
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  /* ── Utilities ─── */
  function fcClearAll() {
    fcQsa('.fc-field-input').forEach(function (inp) { inp.value = ''; });
    var resultsEl = fcQs('[data-fc-results]');
    if (resultsEl) resultsEl.setAttribute('hidden', '');
    fcLastResult = null;
    fcToast('All fields cleared', 'success');
    fcSetStatus('Ready');
  }

  function fcExportJson() {
    if (!fcLastResult) { fcToast('Run calculation first', 'warn'); return; }
    var blob = new Blob([JSON.stringify(fcLastResult, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'financial_calc_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function fcCopyJson() {
    if (!fcLastResult) { fcToast('Run calculation first', 'warn'); return; }
    navigator.clipboard.writeText(JSON.stringify(fcLastResult, null, 2))
      .then(function () { fcToast('JSON copied!', 'success'); })
      .catch(function () { fcToast('Copy failed', 'error'); });
  }

  /* ── Sample Data ─── */
  function fcLoadSample() {
    var sample = {
      y0: {
        period_ends_on: '3/31/2025', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 5000000, other_income_operations: 100000, handling_costs: 50000,
        cost_of_traded_goods: 2500000, consumable_stores: 100000, power_and_fuel: 80000,
        employee_costs: 500000, other_expenses: 200000, selling_expenses: 50000,
        other_related_expenses: 30000, pbildt: 1690000, depreciation: 200000,
        pbit: 1490000, interest_and_finance_charges: 300000, opbt: 1190000,
        non_operating_income_expense: 50000, pbt: 1240000, cash_adjustments: 0,
        apbt: 1240000, tax: 310000, provision_deferred_tax: 20000, apat: 910000,
        gross_block: 3000000, accumulated_depreciation: 800000, net_block: 2200000,
        capital_work_in_progress: 100000, net_fixed_assets: 2300000,
        investments_affiliate: 0, marketable_securities: 50000, total_investments: 50000,
        receivables_gt6m: 100000, receivables_lt6m: 400000,
        provision_doubtful_debts: 10000, bills_receivable: 50000,
        loans_advances_subsidiaries: 0, loans_advances_affiliates: 0,
        loans_advances_current_ops: 200000, cash_and_bank: 500000,
        total_inventories_non_ops: 100000, loans_advances_non_ops: 50000,
        advance_tax_paid: 80000, total_other_assets: 50000,
        total_current_assets_ops: 1430000, total_assets: 3830000,
        paid_up_equity_share_capital: 1000000, share_application_money: 0,
        quasi_equity: 0, gross_reserves: 1500000, intangible_assets: 50000,
        misc_expenses_not_written_off: 0, debit_balance_pnl: 0,
        net_reserves: 1450000, tangible_net_worth: 2400000,
        deferred_payment_credit: 0, rupee_term_loans: 500000,
        total_long_term_debt: 500000, current_portion_ltd: 100000,
        net_long_term_debt: 400000, current_portion_ltd_dup: 100000,
        working_capital_bank_borrowings: 300000, intercorporate_borrowings: 0,
        loans_advances_from_subsidiaries: 0, loans_advances_from_promoters: 0,
        other_short_term_loans: 0, new_short_term_loans: 0,
        creditors_for_goods: 200000, creditors_for_expenses: 80000,
        other_current_liabilities_ops: 150000, current_liabilities_non_ops: 0,
        total_other_liabilities: 0, provision_dividend: 50000,
        provision_taxes: 50000, other_provisions_regular: 0,
        total_provisions: 100000, total_current_liabilities_ops: 530000,
        total_outside_liabilities: 1430000, total_liabilities: 3830000
      },
      y1: {
        period_ends_on: '3/31/2024', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 4200000, other_income_operations: 80000,
        cost_of_traded_goods: 2100000, employee_costs: 450000, other_expenses: 180000,
        pbildt: 1370000, depreciation: 180000, pbit: 1190000,
        interest_and_finance_charges: 280000, opbt: 910000,
        pbt: 960000, tax: 240000, provision_deferred_tax: 15000, apat: 705000,
        total_assets: 3400000, total_current_assets_ops: 1200000,
        total_current_liabilities_ops: 470000, total_liabilities: 3400000,
        paid_up_equity_share_capital: 1000000, tangible_net_worth: 2100000,
        total_long_term_debt: 600000,
        creditors_for_goods: 180000, creditors_for_expenses: 70000,
        total_outside_liabilities: 1300000, net_fixed_assets: 2150000,
        net_long_term_debt: 500000, quasi_equity: 0,
        total_investments: 40000
      },
      y2: {
        period_ends_on: '3/31/2023', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 3800000, other_income_operations: 60000,
        cost_of_traded_goods: 1900000, employee_costs: 400000, other_expenses: 170000,
        pbildt: 1210000, depreciation: 160000, pbit: 1050000,
        interest_and_finance_charges: 260000, opbt: 790000,
        pbt: 840000, tax: 210000, provision_deferred_tax: 10000, apat: 620000,
        total_assets: 3100000, total_current_assets_ops: 1050000,
        total_current_liabilities_ops: 420000, total_liabilities: 3100000,
        paid_up_equity_share_capital: 1000000, tangible_net_worth: 1900000,
        total_long_term_debt: 700000,
        creditors_for_goods: 160000, creditors_for_expenses: 60000,
        total_outside_liabilities: 1200000, net_fixed_assets: 2000000,
        net_long_term_debt: 600000, quasi_equity: 0
      }
    };

    var yearMap = [sample.y0, sample.y1, sample.y2];
    yearMap.forEach(function (data, yi) {
      Object.keys(data).forEach(function (key) {
        var inp = document.getElementById('fcy' + yi + '_' + key);
        if (inp) inp.value = data[key];
      });
    });

    fcToast('Sample data loaded — click Calculate', 'success');
  }

  /* ── Init Financial Module ─── */
  function initFinancialModule() {
    // Fetch schema from API
    fetch(FC_API + '/schema')
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.success) {
          fcSchema = json.data;
          fcBuildForms();
          fcSetStatus('Ready');
          // Schema loaded & forms built — now restore saved data into form inputs
          _fcRestoreAndBindAutoSave();
        } else {
          fcSetStatus('Schema load failed');
        }
      })
      .catch(function (e) {
        console.error('Financial calc schema load error:', e);
        fcSetStatus('Cannot load schema');
      });

    // Tab clicks
    var tabsEl = fcQs('[data-fc-year-tabs]');
    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        var tab = e.target.closest('.fc-year-tab');
        if (tab) {
          fcSetActiveYear(parseInt(tab.getAttribute('data-fc-year'), 10));
          return;
        }
        var addBtn = e.target.closest('[data-fc-add-year]');
        if (addBtn) {
          fcAddYear();
        }
      });
    }

    // Action buttons
    var clearBtn = fcQs('[data-fc-clear]');
    if (clearBtn) clearBtn.addEventListener('click', fcClearAll);

    var sampleBtn = fcQs('[data-fc-sample]');
    if (sampleBtn) sampleBtn.addEventListener('click', fcLoadSample);

    var exportBtn = fcQs('[data-fc-export]');
    if (exportBtn) exportBtn.addEventListener('click', fcExportJson);

    var copyBtn = fcQs('[data-fc-copy-json]');
    if (copyBtn) copyBtn.addEventListener('click', fcCopyJson);

    // Include in report toggle
    var includeToggle = qs('[data-fin-include-report]');
    if (includeToggle) {
      var current = readReportConfig();
      includeToggle.checked = Array.isArray(current?.selectedModules) && current.selectedModules.includes('financial');
      includeToggle.addEventListener('change', function () {
        var next = readReportConfig();
        var selected = new Set(next.selectedModules || []);
        if (includeToggle.checked) selected.add('financial');
        else selected.delete('financial');
        writeReportConfig({ selectedModules: [...selected] });
        renderReportBuilderPreview();
      });
    }

    // Financial Remark (currency/unit note)
    var fcRemarkSelect = qs('#fcRemarkSelect');
    var fcRemarkCustom = qs('#fcRemarkCustom');
    function _fcSaveRemark() {
      var val = '';
      if (fcRemarkSelect && fcRemarkSelect.value === 'custom') {
        val = fcRemarkCustom ? fcRemarkCustom.value.trim() : '';
      } else if (fcRemarkSelect) {
        val = fcRemarkSelect.value;
      }
      try { STORAGE.setItem(storageKey('integration.financialRemark'), val); } catch(e) {}
      setLastUpdatedNow();
      if (HAS_CASE_ID) saveSnapshotToServer('financial_remark', JSON.stringify({ remark: val })).catch(function() {});
    }
    if (fcRemarkSelect) {
      // Restore from localStorage
      var savedRemark = '';
      try { savedRemark = STORAGE.getItem(storageKey('integration.financialRemark')) || ''; } catch(e) {}
      if (savedRemark) {
        var isPreset = Array.from(fcRemarkSelect.options).some(function(o) { return o.value === savedRemark; });
        if (isPreset) {
          fcRemarkSelect.value = savedRemark;
        } else {
          fcRemarkSelect.value = 'custom';
          if (fcRemarkCustom) { fcRemarkCustom.style.display = ''; fcRemarkCustom.value = savedRemark; }
        }
        // Ensure the remark is persisted to server (may have failed before)
        if (HAS_CASE_ID) {
          saveSnapshotToServer('financial_remark', JSON.stringify({ remark: savedRemark })).catch(function() {});
        }
      }
      fcRemarkSelect.addEventListener('change', function() {
        if (fcRemarkSelect.value === 'custom') {
          if (fcRemarkCustom) { fcRemarkCustom.style.display = ''; fcRemarkCustom.focus(); }
        } else {
          if (fcRemarkCustom) fcRemarkCustom.style.display = 'none';
        }
        _fcSaveRemark();
      });
    }
    if (fcRemarkCustom) {
      fcRemarkCustom.addEventListener('input', function() { _fcSaveRemark(); });
    }
    // Restore from server
    if (HAS_CASE_ID) {
      var rmCaseId = (q.caseId || '').toString().trim();
      if (rmCaseId && rmCaseId.toLowerCase() !== 'default') {
        fetch('/api/case/' + encodeURIComponent(rmCaseId) + '/snapshot/financial_remark', { method: 'GET' })
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j && j.success && j.data) {
              var d = j.data.data && typeof j.data.data === 'object' ? j.data.data : j.data;
              var rm = d.remark || '';
              if (rm) {
                try { STORAGE.setItem(storageKey('integration.financialRemark'), rm); } catch(e) {}
                if (fcRemarkSelect) {
                  var isPre = Array.from(fcRemarkSelect.options).some(function(o) { return o.value === rm; });
                  if (isPre) { fcRemarkSelect.value = rm; if (fcRemarkCustom) fcRemarkCustom.style.display = 'none'; }
                  else { fcRemarkSelect.value = 'custom'; if (fcRemarkCustom) { fcRemarkCustom.style.display = ''; fcRemarkCustom.value = rm; } }
                }
              }
            }
          })
          .catch(function() {});
      }
    }

    renderJSON('financial', {});
    fcSetStatus('Ready');
  }

  /* ── Restore saved financial data & bind auto-save (called AFTER schema+forms are ready) ─── */
  function _fcRestoreAndBindAutoSave() {
    // 1. Restore from localStorage first
    var existing = readFinancialFromStorage();
    if (existing?.output || existing?.input) {
      if (existing.output) {
        fcLastResult = existing.output;
        try { fcRenderResults(existing.output); } catch(e) {}
        renderJSON('financial', existing.output);
      }
      if (existing.input) fcRestoreFormInputs(existing.input);
      fcSetStatus('Loaded');
    }

    // 2. Then try server (source of truth) — overwrite if newer
    if (HAS_CASE_ID) {
      var caseId = (q.caseId || '').toString().trim();
      if (caseId && caseId.toLowerCase() !== 'default') {
        fetch('/api/case/' + encodeURIComponent(caseId) + '/snapshot/financial', { method: 'GET' })
          .then(function(res) { return res.json(); })
          .then(function(json) {
            if (json && json.success && json.data) {
              var d = json.data.data && typeof json.data.data === 'object' ? json.data.data : json.data;
              if (d && typeof d === 'object' && Object.keys(d).length) {
                writeFinancialIntegration(d);
                if (d.input) fcRestoreFormInputs(d.input);
                var output = d.output || d.raw || d;
                if (output && typeof output === 'object') {
                  fcLastResult = output;
                  try { fcRenderResults(output); } catch(e) {}
                  renderJSON('financial', output);
                }
                fcSetStatus('Loaded');
              }
            }
          })
          .catch(function() { /* ignore */ });
      }
    }

    // 3. Bind auto-save on any input/change in the financial forms
    var _fcAutoSaveTimer = null;
    var fcFormsEl = fcQs('[data-fc-year-forms]');
    if (fcFormsEl) {
      fcFormsEl.addEventListener('input', function() {
        clearTimeout(_fcAutoSaveTimer);
        _fcAutoSaveTimer = setTimeout(function() {
          var input = fcCollectInput();
          var payload = {
            source: 'financial-calc-engine',
            savedAt: new Date().toISOString(),
            input: input,
            output: fcLastResult || null,
            raw: fcLastResult || null
          };
          writeFinancialIntegration(payload);
        }, 2000);
      });
      fcFormsEl.addEventListener('change', function() {
        clearTimeout(_fcAutoSaveTimer);
        _fcAutoSaveTimer = setTimeout(function() {
          var input = fcCollectInput();
          var payload = {
            source: 'financial-calc-engine',
            savedAt: new Date().toISOString(),
            input: input,
            output: fcLastResult || null,
            raw: fcLastResult || null
          };
          writeFinancialIntegration(payload);
        }, 1000);
      });
    }
  }

  let panVerifiedLocalObjectUrl = null;
  let panVerifiedLocalObjectUrl2 = null;

  let udyamLocalPdfObjectUrl = null;

  function computeCurrentAssessmentYearStart() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    // FY starts in April; AY is FY+1.
    const fyStart = month >= 3 ? year : (year - 1);
    return fyStart + 1;
  }

  function formatAssessmentYear(startYear) {
    const y = Number(startYear);
    if (!Number.isFinite(y)) return '';
    const next = String((y + 1) % 100).padStart(2, '0');
    return `${y}-${next}`;
  }

  function buildAssessmentYearOptions({ count = 6 } = {}) {
    const start = computeCurrentAssessmentYearStart();
    const out = [];
    for (let i = 0; i < Math.max(1, Number(count) || 1); i += 1) {
      out.push(formatAssessmentYear(start - i));
    }
    return out.filter(Boolean);
  }

  function setItrDateInputValue(inputEl, raw) {
    if (!inputEl) return;
    const s = (raw || '').toString().trim();
    if (!s) {
      inputEl.value = '';
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      inputEl.value = s;
      return;
    }
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = String(m[1]).padStart(2, '0');
      const mm = String(m[2]).padStart(2, '0');
      const yyyy = String(m[3]);
      inputEl.value = `${yyyy}-${mm}-${dd}`;
      return;
    }
    inputEl.value = '';
  }

  function formatItrDateForDisplay(raw) {
    const s = (raw || '').toString().trim();
    if (!s) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isFinite(d.getTime())) {
        const parts = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).split(' ');
        // "21 Oct 2022" -> "21-Oct-2022"
        if (parts.length === 3) return `${parts[0]}-${parts[1]}-${parts[2]}`;
      }
    }
    return s;
  }

  function normalizeDobForInput(raw) {
    const s = (raw || '').toString().trim();
    if (!s) return '';
    // Already ISO date (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // DD/MM/YYYY -> YYYY-MM-DD
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = String(m[1]).padStart(2, '0');
      const mm = String(m[2]).padStart(2, '0');
      const yyyy = String(m[3]);
      return `${yyyy}-${mm}-${dd}`;
    }
    return '';
  }

  function formatDobForDisplay(raw) {
    const s = (raw || '').toString().trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [yyyy, mm, dd] = s.split('-');
      return `${dd}/${mm}/${yyyy}`;
    }
    return s;
  }

  function setImagePreview({ imgSel, emptySel, src }) {
    const img = qs(imgSel);
    const empty = qs(emptySel);
    if (!img || !empty) return;
    if (!src) {
      img.removeAttribute('src');
      img.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    img.setAttribute('src', src);
    img.style.display = 'block';
    empty.style.display = 'none';
  }

  function setPanVerifiedPhotoPreview(src) {
    setImagePreview({ imgSel: '[data-pan-verified-photo-preview]', emptySel: '[data-pan-verified-photo-empty]', src });
  }

  function setPanVerifiedPhotoPreview2(src) {
    setImagePreview({ imgSel: '[data-pan-verified-photo-2-preview]', emptySel: '[data-pan-verified-photo-2-empty]', src });
  }

  function setPanOut(key, value) {
    qsa(`[data-pan-out="${CSS.escape(key)}"]`).forEach((el) => {
      const v = value == null || String(value).trim() === '' ? '—' : String(value);
      el.textContent = v;
    });
  }

  function setUdyamOut(key, value) {
    qsa(`[data-udyam-out="${CSS.escape(key)}"]`).forEach((el) => {
      const v = value == null || String(value).trim() === '' ? '—' : String(value);
      el.textContent = v;
    });
  }

  function clearItrRows() {
    const tbody = qs('[data-itr-rows]');
    if (!tbody) return;
    qsa('tr[data-itr-row]', tbody).forEach((tr) => tr.remove());
  }

  function setItrEmptyVisible(visible) {
    const empty = qs('tr[data-itr-empty]');
    if (!empty) return;
    empty.style.display = visible ? '' : 'none';
  }

  function sortItrEntries(entries) {
    const arr = Array.isArray(entries) ? entries.slice() : [];
    const startYear = (ay) => {
      const m = String(ay || '').match(/^(\d{4})\-/);
      return m ? Number(m[1]) : -1;
    };
    arr.sort((a, b) => startYear(b?.assessment_year) - startYear(a?.assessment_year));
    return arr;
  }

  function renderItrPreview(entries) {
    const tbody = qs('[data-itr-rows]');
    if (!tbody) return;
    clearItrRows();

    const list = sortItrEntries(entries).filter((x) => x && typeof x === 'object' && x.assessment_year);
    if (!list.length) {
      setItrEmptyVisible(true);
      return;
    }
    setItrEmptyVisible(false);

    list.forEach((e) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-itr-row', '');

      const tdAy = document.createElement('td');
      tdAy.textContent = String(e.assessment_year || '—');

      const tdWard = document.createElement('td');
      tdWard.textContent = String(e.ward || '—');

      const tdFiled = document.createElement('td');
      tdFiled.textContent = formatItrDateForDisplay(e.return_filed_on);

      const tdIncome = document.createElement('td');
      tdIncome.textContent = e.total_income == null || String(e.total_income).trim() === '' ? '—' : String(e.total_income);

      const tdTax = document.createElement('td');
      tdTax.textContent = e.tax_paid == null || String(e.tax_paid).trim() === '' ? '—' : String(e.tax_paid);

      const tdAck = document.createElement('td');
      tdAck.textContent = e.acknowledgement_no == null || String(e.acknowledgement_no).trim() === '' ? '—' : String(e.acknowledgement_no);

      const tdAction = document.createElement('td');
      tdAction.style.textAlign = 'center';
      tdAction.style.whiteSpace = 'nowrap';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit this entry';
      editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;';
      editBtn.addEventListener('click', () => {
        setItrFormValues(e);
      });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete this entry';
      delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;';
      delBtn.addEventListener('click', () => {
        if (!window.confirm('Delete ITR entry for ' + String(e.assessment_year) + '?')) return;
        const existing = readItrFromStorage();
        const existingEntries = extractItrEntries(existing);
        const nextEntries = existingEntries.filter((x) => String(x?.assessment_year || '') !== String(e.assessment_year));
        const payload = { entries: sortItrEntries(nextEntries), saved_by: 'executive', saved_at: new Date().toISOString() };
        writeItrIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload });
        renderItrPreview(payload.entries);
      });
      tdAction.appendChild(editBtn);
      tdAction.appendChild(delBtn);

      tr.appendChild(tdAy);
      tr.appendChild(tdWard);
      tr.appendChild(tdFiled);
      tr.appendChild(tdIncome);
      tr.appendChild(tdTax);
      tr.appendChild(tdAck);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });
  }

  function readItrFormValues() {
    const ay = (qs('[data-itr-input="assessment_year"]')?.value || '').toString().trim();
    const ward = (qs('[data-itr-input="ward"]')?.value || '').toString().trim();
    const filed = (qs('[data-itr-input="return_filed_on"]')?.value || '').toString().trim();
    const income = (qs('[data-itr-input="total_income"]')?.value || '').toString().trim();
    const tax = (qs('[data-itr-input="tax_paid"]')?.value || '').toString().trim();
    const ack = (qs('[data-itr-input="acknowledgement_no"]')?.value || '').toString().trim();

    return {
      assessment_year: ay || null,
      ward: ward || null,
      return_filed_on: filed || null,
      total_income: income || null,
      tax_paid: tax || null,
      acknowledgement_no: ack || null
    };
  }

  function setItrFormValues(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const aySel = qs('[data-itr-input="assessment_year"]');
    if (aySel && e.assessment_year) aySel.value = String(e.assessment_year);
    const wardEl = qs('[data-itr-input="ward"]');
    if (wardEl) wardEl.value = e.ward != null ? String(e.ward) : '';
    const filedEl = qs('[data-itr-input="return_filed_on"]');
    setItrDateInputValue(filedEl, e.return_filed_on);
    const incomeEl = qs('[data-itr-input="total_income"]');
    if (incomeEl) incomeEl.value = e.total_income != null ? String(e.total_income) : '';
    const taxEl = qs('[data-itr-input="tax_paid"]');
    if (taxEl) taxEl.value = e.tax_paid != null ? String(e.tax_paid) : '';
    const ackEl = qs('[data-itr-input="acknowledgement_no"]');
    if (ackEl) ackEl.value = e.acknowledgement_no != null ? String(e.acknowledgement_no) : '';
  }

  function clearItrForm() {
    const aySel = qs('[data-itr-input="assessment_year"]');
    if (aySel) aySel.value = '';
    const wardEl = qs('[data-itr-input="ward"]');
    if (wardEl) wardEl.value = '';
    const filedEl = qs('[data-itr-input="return_filed_on"]');
    if (filedEl) filedEl.value = '';
    const incomeEl = qs('[data-itr-input="total_income"]');
    if (incomeEl) incomeEl.value = '';
    const taxEl = qs('[data-itr-input="tax_paid"]');
    if (taxEl) taxEl.value = '';
    const ackEl2 = qs('[data-itr-input="acknowledgement_no"]');
    if (ackEl2) ackEl2.value = '';
  }

  async function loadItrFromServerIfAvailable() {
    if (!HAS_CASE_ID) return null;
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') return null;
    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/itr`, { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    if (!json?.success || !json?.data) return null;
    const payload = json.data;
    const rawData = payload?.data && typeof payload.data === 'object' ? payload.data : null;
    if (!rawData) return null;
    // Deeply unwrap to flat { entries: [...] } to fix any previously nested data
    const flat = deepUnwrapItrEntries(rawData);
    return { raw: payload, data: flat };
  }

  function writeItrIntegration(payload, skipServerSave) {
    STORAGE.setItem(storageKey('integration.itrData'), JSON.stringify(payload));
    setLastUpdatedNow();
    // Deeply unwrap to get only the flat entries payload { entries: [...], saved_by, saved_at }
    if (!skipServerSave && HAS_CASE_ID) {
      const flat = deepUnwrapItrEntries(payload);
      saveSnapshotToServer('itr', JSON.stringify(flat)).catch(() => {});
    }
  }

  /** Deeply unwrap ITR data to get the flat { entries: [...] } object, stripping any wrappers */
  function deepUnwrapItrEntries(obj) {
    let cur = obj;
    for (let i = 0; i < 20; i++) {
      if (!cur || typeof cur !== 'object') break;
      if (Array.isArray(cur.entries)) return { entries: cur.entries, saved_by: cur.saved_by, saved_at: cur.saved_at };
      if (cur.data && typeof cur.data === 'object') { cur = cur.data; continue; }
      if (cur.raw && typeof cur.raw === 'object') { cur = cur.raw; continue; }
      break;
    }
    return cur || {};
  }

  /** Robustly extract ITR entries from any shape of stored ITR data */
  function extractItrEntries(stored) {
    if (!stored || typeof stored !== 'object') return [];
    // Direct .entries
    if (Array.isArray(stored.entries)) return stored.entries;
    // .data.entries
    if (stored.data && typeof stored.data === 'object') {
      if (Array.isArray(stored.data.entries)) return stored.data.entries;
      // .data.data.entries (double-wrapped)
      if (stored.data.data && typeof stored.data.data === 'object' && Array.isArray(stored.data.data.entries)) return stored.data.data.entries;
    }
    return [];
  }

  async function loadBankStatementFromServerIfAvailable() {
    if (!HAS_CASE_ID) return null;
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') return null;
    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/bank_statement`, { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    if (!json?.success || !json?.data) return null;
    const payload = json.data;
    let data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
    if (!data) return null;
    // Deep-unwrap nested wrapper layers from previous re-save bug
    for (let i = 0; i < 10; i++) {
      if (data.applicant_name !== undefined || data.bank_name !== undefined || data.account_number !== undefined || data.status_entries !== undefined) break;
      if (data.data && typeof data.data === 'object') { data = data.data; } else break;
    }
    return { raw: payload, data };
  }

  function writeBankStatementIntegration(payload) {
    STORAGE.setItem(storageKey('integration.bankStatementData'), JSON.stringify(payload));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('bank_statement', JSON.stringify(payload)).catch(() => {});
  }

  function setBankOut(key, value) {
    qsa(`[data-bank-out="${CSS.escape(key)}"]`).forEach((el) => {
      const v = value == null || String(value).trim() === '' ? '—' : String(value);
      el.textContent = v;
    });
  }

  const BANK_STATUS_MIN_ROWS = 3;

  function normalizeBankStatusType(raw) {
    const s = (raw || '').toString().trim().toUpperCase();
    return s === 'DR' ? 'DR' : 'CR';
  }

  function normalizeBankStatusEntry(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const date = e.date != null ? String(e.date).trim() : '';
    const amount = e.amount != null ? String(e.amount).trim() : '';
    const type = normalizeBankStatusType(e.type);
    return { date, amount, type };
  }

  function ensureMinBankStatusRows(entries) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    while (list.length < BANK_STATUS_MIN_ROWS) list.push({ date: '', amount: '', type: 'CR' });
    return list;
  }

  function createBankStatusEditorRow(entry) {
    const e = normalizeBankStatusEntry(entry);

    const row = document.createElement('div');
    row.className = 'bank-status-row';
    row.setAttribute('data-bank-status-editor-row', '');

    const inDate = document.createElement('input');
    inDate.className = 'input';
    inDate.type = 'text';
    inDate.placeholder = 'DATE (e.g., 18/04/25)';
    inDate.setAttribute('data-bank-status-field', 'date');
    inDate.value = e.date;

    const inAmt = document.createElement('input');
    inAmt.className = 'input';
    inAmt.type = 'text';
    inAmt.placeholder = 'Amount (e.g., 339529)';
    inAmt.setAttribute('data-bank-status-field', 'amount');
    inAmt.value = e.amount;

    const selType = document.createElement('select');
    selType.className = 'input';
    selType.setAttribute('data-bank-status-field', 'type');
    const optCr = document.createElement('option');
    optCr.value = 'CR';
    optCr.textContent = 'CR';
    const optDr = document.createElement('option');
    optDr.value = 'DR';
    optDr.textContent = 'DR';
    selType.appendChild(optCr);
    selType.appendChild(optDr);
    selType.value = e.type;

    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn btn-secondary';
    btnRemove.type = 'button';
    btnRemove.textContent = 'Remove';
    btnRemove.setAttribute('data-bank-status-remove', '');

    row.appendChild(inDate);
    row.appendChild(inAmt);
    row.appendChild(selType);
    row.appendChild(btnRemove);
    return row;
  }

  function getBankStatusEditorContainer() {
    return qs('[data-bank-status-editor]');
  }

  function renderBankStatusEditor(entries) {
    const host = getBankStatusEditorContainer();
    if (!host) return;
    host.innerHTML = '';
    const list = ensureMinBankStatusRows((Array.isArray(entries) ? entries : []).map(normalizeBankStatusEntry));
    list.forEach((e) => host.appendChild(createBankStatusEditorRow(e)));
  }

  function readBankStatusEntriesFromForm() {
    const host = getBankStatusEditorContainer();
    const rows = host ? qsa('[data-bank-status-editor-row]', host) : [];
    const out = rows.map((row) => {
      const pick = (field) => (qs(`[data-bank-status-field="${CSS.escape(field)}"]`, row)?.value || '').toString().trim();
      const date = pick('date');
      const amount = pick('amount');
      const type = normalizeBankStatusType(pick('type'));
      return {
        date: date || null,
        amount: amount || null,
        type
      };
    });
    return out.filter((r) => r.date || r.amount);
  }

  function setBankStatusEntriesToForm(entries) {
    renderBankStatusEditor(entries);
  }

  function readBankStatementFormValues() {
    const pick = (k) => (qs(`[data-bank-field="${CSS.escape(k)}"]`)?.value || '').toString().trim();
    return {
      applicant_name: pick('applicant_name') || null,
      bank_name: pick('bank_name') || null,
      branch_address: pick('branch_address') || null,
      account_number: pick('account_number') || null,
      account_type: pick('account_type') || null,
      status_entries: readBankStatusEntriesFromForm(),
      remark: pick('remark') || null
    };
  }

  function setBankStatementFormValues(data) {
    const d = data && typeof data === 'object' ? data : {};
    qsa('[data-bank-field]').forEach((el) => {
      const k = el.getAttribute('data-bank-field');
      if (!k) return;
      el.value = d[k] != null ? String(d[k]) : '';
    });
    setBankStatusEntriesToForm(d.status_entries);
  }

  function clearBankStatusRows() {
    const tbody = qs('[data-bank-status-rows]');
    if (!tbody) return;
    qsa('tr[data-bank-status-row]', tbody).forEach((tr) => tr.remove());
  }

  function setBankStatusEmptyVisible(visible) {
    const empty = qs('tr[data-bank-status-empty]');
    if (!empty) return;
    empty.style.display = visible ? '' : 'none';
  }

  function renderBankStatusPreview(entries) {
    const tbody = qs('[data-bank-status-rows]');
    if (!tbody) return;
    clearBankStatusRows();

    const list = Array.isArray(entries) ? entries.filter((e) => e && (e.date || e.amount)) : [];
    if (!list.length) {
      setBankStatusEmptyVisible(true);
      return;
    }
    setBankStatusEmptyVisible(false);

    list.forEach((e) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-bank-status-row', '');

      const tdDate = document.createElement('td');
      tdDate.textContent = e.date != null && String(e.date).trim() !== '' ? String(e.date) : '—';

      const tdAmt = document.createElement('td');
      tdAmt.textContent = e.amount != null && String(e.amount).trim() !== '' ? String(e.amount) : '—';

      const tdType = document.createElement('td');
      tdType.textContent = e.type != null && String(e.type).trim() !== '' ? String(e.type).toUpperCase() : '—';

      tr.appendChild(tdDate);
      tr.appendChild(tdAmt);
      tr.appendChild(tdType);
      tbody.appendChild(tr);
    });
  }

  function renderBankStatementPreview(data) {
    const d = data && typeof data === 'object' ? data : {};
    setBankOut('applicant_name', d.applicant_name);
    setBankOut('bank_name', d.bank_name);
    setBankOut('branch_address', d.branch_address);
    setBankOut('account_number', d.account_number);
    setBankOut('account_type', d.account_type);
    setBankOut('remark', d.remark);
    renderBankStatusPreview(d.status_entries);
  }

  function renderPanPreview(data) {
    const d = data && typeof data === 'object' ? data : {};
    setPanOut('pan_number', d.pan_number);
    setPanOut('name', d.name);
    setPanOut('indian_citizen', d.indian_citizen);
    setPanOut('status', d.status);
    setPanOut('date_of_birth', formatDobForDisplay(d.date_of_birth));
    setPanOut('address', d.address);
    setPanOut('mobile_number', d.mobile_number);
    setPanOut('verified_photograph_label', d.verified_photo_url ? 'ATTACHED' : '—');
    setPanOut('verified_photograph_2_label', d.verified_photo_url_2 ? 'ATTACHED' : '—');

    if (d.verified_photo_url) {
      setPanVerifiedPhotoPreview(d.verified_photo_url);
    } else {
      if (!panVerifiedLocalObjectUrl) setPanVerifiedPhotoPreview(null);
    }
    if (d.verified_photo_url_2) {
      setPanVerifiedPhotoPreview2(d.verified_photo_url_2);
    } else {
      if (!panVerifiedLocalObjectUrl2) setPanVerifiedPhotoPreview2(null);
    }
  }

  function setUdyamPdfPreview(src) {
    const frame = qs('[data-udyam-pdf-preview]');
    const empty = qs('[data-udyam-pdf-empty]');
    const link = qs('[data-udyam-pdf-link]');
    if (!frame || !empty) return;

    const url = src ? String(src) : '';
    if (!url) {
      frame.removeAttribute('src');
      frame.style.display = 'none';
      empty.style.display = 'block';
      if (link) {
        link.style.display = 'none';
        link.removeAttribute('href');
      }
      return;
    }

    frame.setAttribute('src', url);
    frame.style.display = 'block';
    empty.style.display = 'none';
    if (link) {
      link.setAttribute('href', url);
      link.style.display = 'inline-flex';
    }
  }

  function renderUdyamPreview(data) {
    const d = data && typeof data === 'object' ? data : {};
    setUdyamOut('udyam_number', d.udyam_number);
    setUdyamOut('enterprise_type', d.enterprise_type);
    setUdyamOut('major_activity', d.major_activity);
    setUdyamOut('nature_of_activity', d.nature_of_activity);
    setUdyamOut('nic_2_digit', d.nic_2_digit);
    setUdyamOut('pdf_label', d.pdf_url ? 'ATTACHED' : '—');

    if (d.pdf_url) {
      setUdyamPdfPreview(d.pdf_url);
    } else {
      if (!udyamLocalPdfObjectUrl) setUdyamPdfPreview(null);
    }
  }

  function setUdyamFormValues(data) {
    const d = data && typeof data === 'object' ? data : {};
    qsa('[data-udyam-field]').forEach((el) => {
      const k = el.getAttribute('data-udyam-field');
      if (!k) return;
      el.value = d[k] != null ? String(d[k]) : '';
    });
  }

  function readUdyamFormValues() {
    const out = {};
    qsa('[data-udyam-field]').forEach((el) => {
      const k = el.getAttribute('data-udyam-field');
      if (!k) return;
      out[k] = (el.value || '').toString().trim();
    });

    const raw = (out.udyam_number || '').toString().trim().toUpperCase();
    return {
      udyam_number: raw || null,
      enterprise_type: out.enterprise_type || null,
      major_activity: out.major_activity || null,
      nature_of_activity: out.nature_of_activity || null,
      nic_2_digit: out.nic_2_digit || null,
      category: out.category || null
    };
  }

  async function loadUdyamFromServerIfAvailable() {
    if (!HAS_CASE_ID) return null;
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') return null;
    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/udyam`, { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    if (!json?.success || !json?.data) return null;
    const payload = json.data;
    let data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
    if (!data) return null;
    // Unwrap if server had a nested wrapper { source, data: { udyam_number, ... } }
    if (data.data && typeof data.data === 'object' && data.data.udyam_number) {
      data = data.data;
    }
    return { raw: payload, data };
  }

  function writeUdyamIntegration(payload) {
    STORAGE.setItem(storageKey('integration.udyamData'), JSON.stringify(payload));
    setLastUpdatedNow();
    // Save the actual udyam data (not the wrapper) to server
    const dataToSave = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    if (HAS_CASE_ID) saveSnapshotToServer('udyam', JSON.stringify(dataToSave)).catch(() => {});
  }

  async function uploadUdyamPdfIfAny(file) {
    if (!file) return null;
    if (!HAS_CASE_ID) throw new Error('caseId is required to upload PDF.');
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') throw new Error('caseId is required to upload PDF.');

    const fd = new FormData();
    fd.append('document', file);

    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/udyam/pdf`, {
      method: 'POST',
      body: fd
    });
    const json = await res.json().catch(() => ({}));
    if (!json?.success) throw new Error(json?.error || 'PDF upload failed');
    return json?.url || null;
  }

  function setPanFormValues(data) {
    const d = data && typeof data === 'object' ? data : {};
    qsa('[data-pan-field]').forEach((el) => {
      const k = el.getAttribute('data-pan-field');
      if (!k) return;
      if (k === 'address') {
        el.value = d.address != null ? String(d.address) : '';
        return;
      }
      if (k === 'date_of_birth') {
        el.value = normalizeDobForInput(d.date_of_birth);
        return;
      }
      el.value = d[k] != null ? String(d[k]) : '';
    });
  }

  function readPanFormValues() {
    const out = {};
    qsa('[data-pan-field]').forEach((el) => {
      const k = el.getAttribute('data-pan-field');
      if (!k) return;
      out[k] = (el.value || '').toString().trim();
    });
    // normalize keys
    return {
      pan_number: out.pan_number || null,
      name: out.name || null,
      indian_citizen: out.indian_citizen || null,
      status: out.status || null,
      date_of_birth: out.date_of_birth || null,
      address: out.address || null,
      mobile_number: out.mobile_number || null
    };
  }

  async function loadPanFromServerIfAvailable() {
    if (!HAS_CASE_ID) return null;
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') return null;
    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/pan`, { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    if (!json?.success || !json?.data) return null;
    const payload = json.data;
    let data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
    if (!data) return null;
    // Deep-unwrap: previously saved data may have been wrapped in { source, fetchedAt, data: {...} } layers.
    // Unwrap until we reach the flat PAN object (has pan_number or name at top level).
    const MAX_DEPTH = 10;
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (data.pan_number !== undefined || data.name !== undefined || data.date_of_birth !== undefined) break;
      if (data.data && typeof data.data === 'object') { data = data.data; } else break;
    }
    return { raw: payload, data };
  }

  async function loadPersonalInfoFromServerIfAvailable() {
    if (!HAS_CASE_ID) return null;
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') return null;
    try {
      // Try loading full personal_info blob first
      const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/personal_info`, { method: 'GET' });
      const json = await res.json().catch(() => ({}));
      if (json?.success && json?.data) {
        const payload = json.data;
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (data && typeof data === 'object' && Object.keys(data).length) return data;
      }
      // Fallback: assemble from individual personal module snapshots
      const assembled = {};
      for (const mk of PERSONAL_MODULE_KEYS) {
        try {
          const r = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/personal_${mk}`, { method: 'GET' });
          const j = await r.json().catch(() => ({}));
          if (j?.success && j?.data) {
            const d = j.data?.data && typeof j.data.data === 'object' ? j.data.data : j.data;
            if (d && typeof d === 'object') assembled[mk] = d;
          }
        } catch { /* ignore individual module failure */ }
      }
      if (Object.keys(assembled).length) return assembled;
      return null;
    } catch {
      return null;
    }
  }

  function writePanIntegration(payload) {
    STORAGE.setItem(storageKey('integration.panData'), JSON.stringify(payload));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('pan', JSON.stringify(payload)).catch(() => {});
  }

  async function uploadPanImageIfAny(file, kind) {
    if (!file) return null;
    if (!HAS_CASE_ID) throw new Error('caseId is required to upload photo.');
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') throw new Error('caseId is required to upload photo.');

    const fd = new FormData();
    fd.append('photo', file);
    fd.append('kind', (kind || 'pan_photo').toString());

    const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/pan/photo`, {
      method: 'POST',
      body: fd
    });
    const json = await res.json().catch(() => ({}));
    if (!json?.success) throw new Error(json?.error || 'Photo upload failed');
    return json?.url || null;
  }

  function loadSnapshots() {
    function renderGstFromIntegration() {
      const gstIntegration = readIntegrationObject('gstData');
      const gstRaw = gstIntegration?.raw || null;
      const gstData = firstNonEmpty(gstIntegration, ['data']) || firstNonEmpty(gstRaw, ['data']) || gstIntegration || gstRaw || {};
      const gstin = (gstIntegration?.gstin || q.gstin || firstNonEmpty(gstData, ['gstin', 'gstIn', 'gstinNo', 'gstin_number']) || '').toString().trim();
      bindText('gstin', gstin || '—');
      bindText('gstLegalName', (gstIntegration?.legalName || firstNonEmpty(gstData, ['legalName', 'legal_name', 'lgnm', 'legalNameOfBusiness', 'tradeName', 'trade_name'])) || '—');
      bindText('gstConstitution', (gstIntegration?.constitutionOfBusiness || firstNonEmpty(gstData, ['constitutionOfBusiness', 'constitution_of_business', 'ctb', 'constitution'])) || '—');
      bindText('gstStatus', (gstIntegration?.status || firstNonEmpty(gstData, ['status', 'sts', 'gstStatus'])) || '—');
      renderJSON('gst', gstRaw || {});
      renderGstFilingSelectionPanel();
    }

    function renderMcaFromIntegration() {
      const mcaIntegration = readIntegrationObject('mcaData');
      const mcaRaw = mcaIntegration?.raw || null;
      const mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRaw, ['data']) || mcaIntegration || mcaRaw || {};
      bindText('mcaCompanyName', (mcaIntegration?.companyName || firstNonEmpty(mcaData, ['companyName', 'company_name', 'name', 'CompanyName'])) || '—');
      bindText('mcaCIN', (mcaIntegration?.cin || q.cin || firstNonEmpty(mcaData, ['cin', 'CIN', 'Cin']) || '').toString().trim() || '—');
      bindText('mcaIncorp', (mcaIntegration?.dateOfIncorporation || firstNonEmpty(mcaData, ['dateOfIncorporation', 'incorporationDate', 'incorporation_date', 'incorporation', 'IncorporationDate'])) || '—');
      bindText('mcaStatus', (mcaIntegration?.status || firstNonEmpty(mcaData, ['status', 'companyStatus', 'company_status', 'CompanyStatus'])) || '—');
      renderJSON('mca', mcaRaw || {});
      // Render director picker after MCA data is available
      renderMcaDirectorPicker();
    }

    // Render from localStorage first (instant)
    renderGstFromIntegration();
    renderMcaFromIntegration();
    renderReportBuilderPreview();

    // Always restore from server — server is the source of truth, localStorage is just a cache.
    if (HAS_CASE_ID) {
      const caseId = (q.caseId || '').toString().trim();
      (async () => {
        // Helper: extract data payload from server snapshot response
        const extractData = (json) => {
          if (!json?.success || !json?.data) return null;
          return json.data?.data && typeof json.data.data === 'object' ? json.data.data : json.data;
        };
        const snap = (key) => fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/${key}`, { method: 'GET' }).then(r => r.json()).catch(() => ({}));

        try {
          // ── Phase 1: Fetch ALL snapshots in parallel for speed ──
          const [
            gstR, mcaR, compR, finR, statusR, aiR, rcR, gstSelR,
            adR, coR, smdR, piR, itrR, bsR, udyamR, panR, fdR, rvR, riR,
            bsumR, pitrR, pmcR, ooR, fdsR
          ] = await Promise.allSettled([
            snap('gst'), snap('mca'), snap('compliance'), snap('financial'),
            snap('module_statuses'), snap('ai_summary'), snap('report_config'), snap('gst_report_selection'),
            snap('additional_details'), snap('case_overview'), snap('selected_mca_directors'), snap('personal_info'),
            snap('itr'), snap('bank_statement'), snap('udyam'), snap('pan'),
            snap('field_data'), snap('resident_verification_images'), snap('report_images'),
            snap('business_summary'), snap('personal_personal_itr'), snap('personal_module_completion'),
            snap('overall_observation'), snap('field_data_summary')
          ]);

          // ── Phase 2: Write all results into localStorage and re-render UI ──
          const val = (r) => r.status === 'fulfilled' ? r.value : {};

          // GST
          const gstD = extractData(val(gstR));
          if (gstD && typeof gstD === 'object' && Object.keys(gstD).length) {
            STORAGE.setItem(storageKey('integration.gstData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: gstD, data: gstD }));
            renderGstFromIntegration();
          }

          // MCA
          const mcaD = extractData(val(mcaR));
          if (mcaD && typeof mcaD === 'object' && Object.keys(mcaD).length) {
            STORAGE.setItem(storageKey('integration.mcaData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: mcaD, data: mcaD }));
            renderMcaFromIntegration();
          }

          // Compliance
          const compD = extractData(val(compR));
          if (compD && typeof compD === 'object' && Object.keys(compD).length) {
            // compD = { source, fetchedAt, companyIdentifier, raw, normalized } — store as-is (same format as original save)
            STORAGE.setItem(storageKey('integration.complianceData'), JSON.stringify(compD));
            // Show results using the already-normalized data, or fall back to raw API data
            try { showComplianceResults(compD.normalized || compD.raw || compD); } catch { /* UI may not be ready */ }
          }

          // Financial
          const finD = extractData(val(finR));
          if (finD && typeof finD === 'object' && Object.keys(finD).length) {
            STORAGE.setItem(storageKey('integration.financialData'), JSON.stringify(finD));
            const output = finD.output || finD.raw || finD;
            if (output && typeof output === 'object') {
              fcLastResult = output;
              try { fcRenderResults(output); } catch { /* UI may not be ready */ }
              renderJSON('financial', output);
            }
          }

          // Module Statuses
          const statusD = extractData(val(statusR));
          if (statusD && typeof statusD === 'object' && Object.keys(statusD).length) {
            STORAGE.setItem(storageKey('moduleStatuses'), JSON.stringify(statusD));
            updateUIFromStatuses(statusD);
          }

          // AI Summaries
          const aiD = extractData(val(aiR));
          if (aiD && typeof aiD === 'object' && Object.keys(aiD).length) {
            STORAGE.setItem(storageKey(AI_SUMMARY_STORAGE), JSON.stringify(aiD));
            Object.entries(aiD).forEach(([summaryKey, item]) => {
              if (!item?.summary) return;
              const outEl = qs(`[data-ai-summary-text="${CSS.escape(summaryKey)}"]`);
              if (outEl) outEl.value = item.summary;
              if (item.generatedAt) {
                const dt = new Date(item.generatedAt);
                const statusEl = qs(`[data-ai-summary-status="${CSS.escape(summaryKey)}"]`);
                if (statusEl) statusEl.textContent = `Generated ${dt.toLocaleString('en-IN')}`;
              }
            });
          }

          // Report Config
          const rcD = extractData(val(rcR));
          if (rcD && typeof rcD === 'object' && Object.keys(rcD).length) {
            STORAGE.setItem(storageKey(REPORT_CONFIG_STORAGE), JSON.stringify(rcD));
          }

          // GST Report Selection
          const gstSelD = extractData(val(gstSelR));
          if (gstSelD && typeof gstSelD === 'object' && Object.keys(gstSelD).length) {
            STORAGE.setItem(storageKey(GST_REPORT_SELECTION_STORAGE), JSON.stringify(gstSelD));
          }

          // Additional Details
          const adD = extractData(val(adR));
          if (adD && typeof adD === 'object' && Object.keys(adD).length) {
            STORAGE.setItem(storageKey('additional_details'), JSON.stringify(adD));
            try { _adBeginLoading(); setAdditionalDetailsData(adD); _adDataLoadedOnce = true; _adEndLoading(); } catch { _adEndLoading(); }
          }

          // Case Overview
          const coD = extractData(val(coR));
          if (coD && typeof coD === 'object' && Object.keys(coD).length) {
            STORAGE.setItem(storageKey('case_overview'), JSON.stringify(coD));
            try { setCaseOverviewData(coD); } catch { /* form may not be visible */ }
          }

          // Selected MCA Directors
          const smdD = extractData(val(smdR));
          if (smdD && typeof smdD === 'object' && Object.keys(smdD).length) {
            STORAGE.setItem(storageKey('selectedMcaDirectors'), JSON.stringify(smdD));
          }

          // Personal Info
          const piD = extractData(val(piR));
          if (piD && typeof piD === 'object' && Object.keys(piD).length) {
            // Strip base64 images before localStorage write to prevent QuotaExceededError
            try {
              const lsPiD = typeof window._piStripBase64ForLocalStorage === 'function'
                ? window._piStripBase64ForLocalStorage(JSON.parse(JSON.stringify(piD)))
                : piD;
              STORAGE.setItem(storageKey(PERSONAL_INFO_STORAGE), JSON.stringify(lsPiD));
            } catch (lsErr) {
              console.warn('[loadSnapshots] personal_info localStorage write failed (likely too large):', lsErr?.message);
            }
            // Update the in-memory model with full server data (including images) and re-render
            try {
              if (typeof window._piRefreshModelFromServer === 'function') {
                window._piRefreshModelFromServer(piD);
              } else {
                // Fallback: at least repopulate form fields from localStorage
                const piModel = readPersonalInfo();
                qsa('[data-pi-field]').forEach((el) => {
                  const path = (el.getAttribute('data-pi-field') || '').toString().trim();
                  if (!path) return;
                  const parts = pathToParts(path);
                  if (parts.length >= 4 && parts[1] === 'designatedPersons') return;
                  const val2 = getByParts(piModel, parts, '');
                  if (el && typeof el.value !== 'undefined') {
                    if (path === 'pan.primary.date_of_birth') {
                      el.value = normalizeDobForInput(val2);
                    } else {
                      el.value = val2 == null ? '' : String(val2);
                    }
                  }
                });
                if (typeof window._piRenderAllSummaries === 'function') window._piRenderAllSummaries();
              }
            } catch { /* UI may not be ready */ }
          }

          // ITR
          const itrD = extractData(val(itrR));
          if (itrD && typeof itrD === 'object' && Object.keys(itrD).length) {
            // Deeply unwrap to flat entries before storing, to avoid ever-growing nesting
            const flatItr = typeof deepUnwrapItrEntries === 'function' ? deepUnwrapItrEntries(itrD) : itrD;
            STORAGE.setItem(storageKey('integration.itrData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: flatItr, data: flatItr }));
            // Re-render ITR preview from stored data (robustly unwrap nested structures)
            try {
              const itrEntries = extractItrEntries(flatItr);
              renderItrPreview(itrEntries);
            } catch { /* UI may not be ready */ }
          }

          // Bank Statement
          const bsD = extractData(val(bsR));
          if (bsD && typeof bsD === 'object' && Object.keys(bsD).length) {
            STORAGE.setItem(storageKey('integration.bankStatementData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: bsD, data: bsD }));
            // Re-render bank statement form and preview
            try {
              let bsData = bsD?.data && typeof bsD.data === 'object' ? bsD.data : bsD;
              for (let i = 0; i < 10; i++) {
                if (bsData.applicant_name !== undefined || bsData.bank_name !== undefined || bsData.account_number !== undefined || bsData.status_entries !== undefined) break;
                if (bsData.data && typeof bsData.data === 'object') { bsData = bsData.data; } else break;
              }
              setBankStatementFormValues(bsData);
              renderBankStatementPreview(bsData);
            } catch { /* UI may not be ready */ }
          }

          // Udyam — handle both flat and wrapper formats from server
          const udyamRaw = extractData(val(udyamR));
          if (udyamRaw && typeof udyamRaw === 'object' && Object.keys(udyamRaw).length) {
            // If server saved a wrapper { source, data: {...} }, unwrap to get actual udyam fields
            const udyamD = (udyamRaw.data && typeof udyamRaw.data === 'object' && udyamRaw.data.udyam_number) ? udyamRaw.data : udyamRaw;
            STORAGE.setItem(storageKey('integration.udyamData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: udyamD, data: udyamD }));
            try { setUdyamFormValues(udyamD); renderUdyamPreview(udyamD); } catch { /* UI may not be ready */ }
          }

          // PAN
          let panD = extractData(val(panR));
          if (panD && typeof panD === 'object' && Object.keys(panD).length) {
            // Deep-unwrap: saved data may be wrapped in { source, fetchedAt, data: {...} } layers
            for (let i = 0; i < 10; i++) {
              if (panD.pan_number !== undefined || panD.name !== undefined || panD.date_of_birth !== undefined) break;
              if (panD.data && typeof panD.data === 'object') { panD = panD.data; } else break;
            }
            STORAGE.setItem(storageKey('integration.panData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: panD, data: panD }));
            try { setPanFormValues(panD); renderPanPreview(panD); } catch { /* UI may not be ready */ }
          }

          // Field Data — also populate in-memory array so UI renders
          const fdD = extractData(val(fdR));
          if (fdD && typeof fdD === 'object' && Object.keys(fdD).length) {
            STORAGE.setItem(storageKey('integration.fieldData'), JSON.stringify(fdD));
            const fdImgs = fdD?.images || [];
            if (Array.isArray(fdImgs) && fdImgs.length) {
              fieldDataImages = fdImgs;
            }
          }

          // Resident Verification Images — also populate in-memory array so UI renders
          const rvD = extractData(val(rvR));
          if (rvD && typeof rvD === 'object' && Object.keys(rvD).length) {
            STORAGE.setItem(storageKey('integration.residentVerificationImages'), JSON.stringify(rvD));
            const rvImgs = rvD?.images || [];
            if (Array.isArray(rvImgs) && rvImgs.length) {
              residentVerificationImages = rvImgs;
              try { if (typeof window._rvRenderImages === 'function') window._rvRenderImages(); } catch {}
            }
          }

          // Report Images (custom signature/stamp)
          const riD = extractData(val(riR));
          if (riD && typeof riD === 'object' && Object.keys(riD).length) {
            STORAGE.setItem(storageKey('integration.reportImages'), JSON.stringify(riD));
            if (riD.signatureDataUrl) {
              customSignatureDataUrl = riD.signatureDataUrl;
              const img = qs('#reportSignatureImg');
              if (img) img.src = riD.signatureDataUrl;
            }
            if (riD.stampDataUrl) {
              customStampDataUrl = riD.stampDataUrl;
              const img = qs('#reportStampImg');
              if (img) img.src = riD.stampDataUrl;
            }
          }

          // Business Summary
          const bsumD = extractData(val(bsumR));
          if (bsumD && typeof bsumD === 'object') {
            const bsumText = bsumD.summary || '';
            if (bsumText) {
              const bsumEl = qs('#businessSummaryTextarea');
              if (bsumEl) bsumEl.value = bsumText;
            }
          }

          // Field Data Summary
          const fdsD = extractData(val(fdsR));
          if (fdsD && typeof fdsD === 'object') {
            const fdsText = fdsD.summary || '';
            if (fdsText) {
              STORAGE.setItem(storageKey('integration.fieldDataSummary'), JSON.stringify({ summary: fdsText }));
              const fdsEl = qs('#fieldDataSummaryTextarea');
              if (fdsEl) fdsEl.value = fdsText;
            }
          }

          // Personal ITR (per-person ITR entries)
          const pitrD = extractData(val(pitrR));
          if (pitrD && typeof pitrD === 'object' && Object.keys(pitrD).length) {
            // Merge personal_itr entries into personal info model
            try {
              const piModel = readPersonalInfo();
              if (!piModel.personal_itr) piModel.personal_itr = { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
              if (pitrD.primary?.itr_entries) {
                if (!piModel.personal_itr.primary) piModel.personal_itr.primary = {};
                piModel.personal_itr.primary.itr_entries = pitrD.primary.itr_entries;
              }
              if (Array.isArray(pitrD.designatedPersons)) {
                pitrD.designatedPersons.forEach((sdp, idx) => {
                  if (sdp?.itr_entries && piModel.personal_itr.designatedPersons?.[idx]) {
                    piModel.personal_itr.designatedPersons[idx].itr_entries = sdp.itr_entries;
                  }
                });
              }
              STORAGE.setItem(storageKey(PERSONAL_INFO_STORAGE), JSON.stringify(piModel));
              // Also sync ITR entries into the in-memory model so report builder picks them up
              if (_personalInfoModel && typeof _personalInfoModel === 'object') {
                if (!_personalInfoModel.personal_itr) _personalInfoModel.personal_itr = { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
                if (pitrD.primary?.itr_entries) {
                  if (!_personalInfoModel.personal_itr.primary) _personalInfoModel.personal_itr.primary = {};
                  _personalInfoModel.personal_itr.primary.itr_entries = pitrD.primary.itr_entries;
                }
                if (Array.isArray(pitrD.designatedPersons)) {
                  pitrD.designatedPersons.forEach((sdp, idx) => {
                    if (sdp?.itr_entries && _personalInfoModel.personal_itr.designatedPersons?.[idx]) {
                      _personalInfoModel.personal_itr.designatedPersons[idx].itr_entries = sdp.itr_entries;
                    }
                  });
                }
              }
              if (typeof window._pitrRebuildPersons === 'function') window._pitrRebuildPersons();
            } catch { /* ignore */ }
          }

          // Personal Module Completion
          const pmcD = extractData(val(pmcR));
          if (pmcD && typeof pmcD === 'object' && Object.keys(pmcD).length) {
            try {
              STORAGE.setItem(storageKey(PERSONAL_COMPLETION_STORAGE), JSON.stringify(pmcD));
              updatePersonalCompletionUI(pmcD);
            } catch { /* ignore */ }
          }

          // Overall Observation
          const ooD = extractData(val(ooR));
          if (ooD && typeof ooD === 'object') {
            const ooText = typeof ooD.text === 'string' ? ooD.text : (typeof ooD === 'string' ? ooD : '');
            if (ooText) {
              STORAGE.setItem(storageKey('overall_observation'), ooText);
              try {
                const obsEl = qs('[data-report-overall-observation]');
                if (obsEl) obsEl.value = ooText;
              } catch { /* ignore */ }
            }
          }

        } catch (err) {
          console.warn('[loadSnapshots] Server restore failed:', err);
        } finally {
          // Always re-render report builder after server data is loaded
          renderReportBuilderPreview();
          renderGstFromIntegration();
          renderMcaFromIntegration();
          // Re-render personal ITR person list
          try { if (typeof window._pitrRebuildPersons === 'function') window._pitrRebuildPersons(); } catch {}
          // Re-render resident verification images
          try { if (typeof window._rvRenderImages === 'function') window._rvRenderImages(); } catch {}
          // Re-render personal info summaries
          try { if (typeof window._piRenderAllSummaries === 'function') window._piRenderAllSummaries(); } catch {}
        }
      })();
    }
  }

  function initPanModule() {
    const verifiedPhotoInput = qs('[data-pan-verified-photo]');
    const verifiedPhotoInput2 = qs('[data-pan-verified-photo-2]');

    const applyFromIntegration = () => {
      const stored = readPanFromStorage();
      let data = stored?.data && typeof stored.data === 'object' ? stored.data : (stored && typeof stored === 'object' ? stored : null);
      // Deep-unwrap any nested wrapper layers in localStorage too.
      if (data) {
        const MAX_DEPTH = 10;
        for (let i = 0; i < MAX_DEPTH; i++) {
          if (data.pan_number !== undefined || data.name !== undefined || data.date_of_birth !== undefined) break;
          if (data.data && typeof data.data === 'object') { data = data.data; } else break;
        }
        setPanFormValues(data);
        renderPanPreview(data);
      } else {
        renderPanPreview({});
      }
    };

    // Load from server if possible; else from local storage.
    // Only update localStorage cache — don't re-save to server on load (prevents nested wrapping).
    (async () => {
      try {
        const fromServer = await loadPanFromServerIfAvailable();
        if (fromServer?.data) {
          STORAGE.setItem(storageKey('integration.panData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: fromServer.raw, data: fromServer.data }));
          markCompleted('pan');
        }
      } catch {
        // ignore
      } finally {
        applyFromIntegration();
      }
    })();

    // Debounced auto-save helper for PAN fields
    let _panAutoSaveTimer = null;
    function _panAutoSave() {
      const data = { ...readPanFormValues() };
      const stored = readPanFromStorage();
      const verifiedPhotoUrl = stored?.data?.verified_photo_url || stored?.verified_photo_url || null;
      const verifiedPhotoUrl2 = stored?.data?.verified_photo_url_2 || stored?.verified_photo_url_2 || null;
      if (verifiedPhotoUrl) data.verified_photo_url = verifiedPhotoUrl;
      if (verifiedPhotoUrl2) data.verified_photo_url_2 = verifiedPhotoUrl2;
      data.saved_by = 'executive';
      data.saved_at = new Date().toISOString();
      renderPanPreview(data);
      writePanIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: data });
      // Auto-mark PAN module as completed when meaningful data exists (fixes PAN not appearing in PDF)
      if (data.pan_number || data.name) {
        markCompleted('pan');
      }
    }

    // Live preview + auto-save as user types.
    qsa('[data-pan-field]').forEach((el) => {
      el.addEventListener('input', () => {
        const data = { ...readPanFormValues() };
        const stored = readPanFromStorage();
        const verifiedPhotoUrl = stored?.data?.verified_photo_url || stored?.verified_photo_url || null;
        const verifiedPhotoUrl2 = stored?.data?.verified_photo_url_2 || stored?.verified_photo_url_2 || null;
        if (verifiedPhotoUrl) data.verified_photo_url = verifiedPhotoUrl;
        if (verifiedPhotoUrl2) data.verified_photo_url_2 = verifiedPhotoUrl2;
        renderPanPreview(data);
        // Debounced auto-save (800ms after last keystroke)
        if (_panAutoSaveTimer) clearTimeout(_panAutoSaveTimer);
        _panAutoSaveTimer = setTimeout(_panAutoSave, 800);
      });
      el.addEventListener('change', () => {
        // Immediate save on dropdown/date change
        if (_panAutoSaveTimer) clearTimeout(_panAutoSaveTimer);
        _panAutoSave();
      });
    });

    if (verifiedPhotoInput) {
      verifiedPhotoInput.addEventListener('change', () => {
        const file = verifiedPhotoInput.files && verifiedPhotoInput.files[0] ? verifiedPhotoInput.files[0] : null;
        if (panVerifiedLocalObjectUrl) {
          try { URL.revokeObjectURL(panVerifiedLocalObjectUrl); } catch { /* ignore */ }
          panVerifiedLocalObjectUrl = null;
        }
        if (file) {
          panVerifiedLocalObjectUrl = URL.createObjectURL(file);
          setPanVerifiedPhotoPreview(panVerifiedLocalObjectUrl);
          setPanOut('verified_photograph_label', 'ATTACHED');
        } else {
          panVerifiedLocalObjectUrl = null;
          const stored = readPanFromStorage();
          const existing = stored?.data?.verified_photo_url || stored?.verified_photo_url || null;
          if (existing) setPanVerifiedPhotoPreview(existing);
          else setPanVerifiedPhotoPreview(null);
          setPanOut('verified_photograph_label', existing ? 'ATTACHED' : '—');
        }
      });
    }

    if (verifiedPhotoInput2) {
      verifiedPhotoInput2.addEventListener('change', () => {
        const file = verifiedPhotoInput2.files && verifiedPhotoInput2.files[0] ? verifiedPhotoInput2.files[0] : null;
        if (panVerifiedLocalObjectUrl2) {
          try { URL.revokeObjectURL(panVerifiedLocalObjectUrl2); } catch { /* ignore */ }
          panVerifiedLocalObjectUrl2 = null;
        }
        if (file) {
          panVerifiedLocalObjectUrl2 = URL.createObjectURL(file);
          setPanVerifiedPhotoPreview2(panVerifiedLocalObjectUrl2);
          setPanOut('verified_photograph_2_label', 'ATTACHED');
        } else {
          panVerifiedLocalObjectUrl2 = null;
          const stored = readPanFromStorage();
          const existing = stored?.data?.verified_photo_url_2 || stored?.verified_photo_url_2 || null;
          if (existing) setPanVerifiedPhotoPreview2(existing);
          else setPanVerifiedPhotoPreview2(null);
          setPanOut('verified_photograph_2_label', existing ? 'ATTACHED' : '—');
        }
      });
    }
  }

  function initUdyamModule() {
    const pdfInput = qs('[data-udyam-pdf]');

    const applyFromIntegration = () => {
      const stored = readUdyamFromStorage();
      const data = stored?.data && typeof stored.data === 'object' ? stored.data : (stored && typeof stored === 'object' ? stored : null);
      if (data) {
        setUdyamFormValues(data);
        renderUdyamPreview(data);
      } else {
        renderUdyamPreview({});
      }
    };

    (async () => {
      try {
        const fromServer = await loadUdyamFromServerIfAvailable();
        if (fromServer?.data) {
          // Only update localStorage cache — don't re-save to server on load
          // Use fromServer.data (flat fields) as raw so getAISummaryPayloadFromIntegration returns correct data
          STORAGE.setItem(storageKey('integration.udyamData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: fromServer.data, data: fromServer.data }));
          // Auto-mark completed when server has meaningful data
          const d = fromServer.data;
          if (d.udyam_number || d.enterprise_type || d.major_activity) {
            markCompleted('udyam');
          }
        }
      } catch {
        // ignore
      } finally {
        applyFromIntegration();
      }
    })();

    // Auto-persist udyam form changes to localStorage (debounced to avoid excessive writes)
    let _udyamAutoSaveTimer = null;
    const autoSaveUdyamToStorage = () => {
      clearTimeout(_udyamAutoSaveTimer);
      _udyamAutoSaveTimer = setTimeout(() => {
        const data = { ...readUdyamFormValues() };
        const stored = readUdyamFromStorage();
        const pdfUrl = stored?.data?.pdf_url || stored?.pdf_url || null;
        if (pdfUrl) data.pdf_url = pdfUrl;
        // Preserve existing metadata
        const prev = stored || {};
        STORAGE.setItem(storageKey('integration.udyamData'), JSON.stringify({
          source: prev.source || 'form-autosave',
          fetchedAt: prev.fetchedAt || new Date().toISOString(),
          raw: data,
          data: data
        }));
      }, 400);
    };

    qsa('[data-udyam-field]').forEach((el) => {
      el.addEventListener('input', () => {
        const data = { ...readUdyamFormValues() };
        const stored = readUdyamFromStorage();
        const pdfUrl = stored?.data?.pdf_url || stored?.pdf_url || null;
        if (pdfUrl) data.pdf_url = pdfUrl;
        renderUdyamPreview(data);
        autoSaveUdyamToStorage();
      });
      el.addEventListener('change', () => {
        const data = { ...readUdyamFormValues() };
        const stored = readUdyamFromStorage();
        const pdfUrl = stored?.data?.pdf_url || stored?.pdf_url || null;
        if (pdfUrl) data.pdf_url = pdfUrl;
        renderUdyamPreview(data);
        autoSaveUdyamToStorage();
      });
    });

    if (pdfInput) {
      pdfInput.addEventListener('change', () => {
        const file = pdfInput.files && pdfInput.files[0] ? pdfInput.files[0] : null;
        if (udyamLocalPdfObjectUrl) {
          try { URL.revokeObjectURL(udyamLocalPdfObjectUrl); } catch { /* ignore */ }
          udyamLocalPdfObjectUrl = null;
        }
        if (file) {
          udyamLocalPdfObjectUrl = URL.createObjectURL(file);
          setUdyamPdfPreview(udyamLocalPdfObjectUrl);
          setUdyamOut('pdf_label', 'ATTACHED');
        } else {
          udyamLocalPdfObjectUrl = null;
          const stored = readUdyamFromStorage();
          const existing = stored?.data?.pdf_url || stored?.pdf_url || null;
          if (existing) setUdyamPdfPreview(existing);
          else setUdyamPdfPreview(null);
          setUdyamOut('pdf_label', existing ? 'ATTACHED' : '—');
        }
      });
    }
  }

  function initItrModule() {
    const aySelect = qs('[data-itr-input="assessment_year"]');
    if (aySelect) {
      const existing = new Set(qsa('option', aySelect).map((o) => (o.value || '').toString()));
      buildAssessmentYearOptions({ count: 6 }).forEach((ay) => {
        if (!ay || existing.has(ay)) return;
        const opt = document.createElement('option');
        opt.value = ay;
        opt.textContent = ay;
        aySelect.appendChild(opt);
      });
    }

    function getStoredEntries() {
      const stored = readItrFromStorage();
      const data = stored?.data && typeof stored.data === 'object' ? stored.data : (stored && typeof stored === 'object' ? stored : null);
      return Array.isArray(data?.entries) ? data.entries : [];
    }

    function renderLivePreview() {
      const storedEntries = getStoredEntries();
      const draft = readItrFormValues();
      const ay = (draft.assessment_year || '').toString().trim();

      // If AY selected, show draft row in preview (upsert by AY).
      if (ay) {
        const next = storedEntries.filter((e) => String(e?.assessment_year || '') !== ay);
        next.push(draft);
        renderItrPreview(next);
        return;
      }

      // Otherwise, show saved rows only.
      renderItrPreview(storedEntries);
    }

    const applyFromIntegration = () => {
      const entries = getStoredEntries();
      renderItrPreview(entries);

      // Best-effort: prefill form for selected AY if already saved.
      const selectedAy = (aySelect?.value || '').toString().trim();
      if (selectedAy) {
        const hit = entries.find((e) => String(e?.assessment_year || '') === selectedAy);
        if (hit) setItrFormValues(hit);
      }

      // Ensure preview reflects current form values too.
      renderLivePreview();
    };

    (async () => {
      try {
        const fromServer = await loadItrFromServerIfAvailable();
        if (fromServer?.data) {
          // Store locally without re-saving to server
          writeItrIntegration({ source: 'server', fetchedAt: new Date().toISOString(), raw: fromServer.raw, data: fromServer.data }, true);
          // Fix: re-save clean flat data to server to repair any previously nested data
          if (HAS_CASE_ID) {
            const flat = deepUnwrapItrEntries(fromServer.data);
            if (flat && Array.isArray(flat.entries) && flat.entries.length) {
              saveSnapshotToServer('itr', JSON.stringify(flat)).catch(() => {});
            }
          }
        }
      } catch {
        // ignore
      } finally {
        applyFromIntegration();
      }
    })();

    if (aySelect) {
      aySelect.addEventListener('change', () => {
        const entries = getStoredEntries();
        const ay = (aySelect.value || '').toString().trim();
        const hit = entries.find((e) => String(e?.assessment_year || '') === ay);
        if (hit) setItrFormValues(hit);
        renderLivePreview();
      });
    }

    // Live preview as user types/changes any ITR input.
    qsa('[data-itr-input]').forEach((el) => {
      el.addEventListener('input', renderLivePreview);
      el.addEventListener('change', renderLivePreview);
    });
  }

  /* ════════════════════════════════════════════════════════════
     Personal ITR Module — Per-Person ITR Entry Management
     ════════════════════════════════════════════════════════════ */

  function initPersonalItrModule() {
    const section = qs('#module-person-personal_itr');
    if (!section) return;

    const personSelect = qs('[data-pitr-person-select]', section);
    const formPanel = qs('[data-pitr-form-panel]', section);
    const previewPanel = qs('[data-pitr-preview-panel]', section);

    function getPersonalItrModel() {
      const model = readPersonalInfo();
      return model.personal_itr || { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
    }

    function getAllPersons() {
      const pitrModel = getPersonalItrModel();
      const persons = [];
      const primaryName = (pitrModel.primary?.name || '').toString().trim();
      const _piLabel = (() => { try { const m = readPersonalInfo(); return (m?.applicant?.primary?.primary_label || '').trim() || 'Primary Applicant'; } catch(_e) { return 'Primary Applicant'; } })();
      persons.push({ type: 'primary', index: -1, name: primaryName || _piLabel, data: pitrModel.primary || {} });
      const dps = Array.isArray(pitrModel.designatedPersons) ? pitrModel.designatedPersons : [];
      dps.forEach((dp, idx) => {
        const dpName = (dp?.name || dp?.promoter_name || '').toString().trim();
        const desig = (dp?.designation || '').toString().trim();
        const label = dpName ? (desig ? `${dpName} (${desig})` : dpName) : `Designated Person #${idx + 1}`;
        persons.push({ type: 'dp', index: idx, name: label, data: dp || {} });
      });
      return persons;
    }

    function buildPersonOptions() {
      if (!personSelect) return;
      const persons = getAllPersons();
      const prevVal = personSelect.value;
      personSelect.innerHTML = '';
      persons.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.type === 'primary' ? 'primary' : `dp_${p.index}`;
        opt.textContent = p.name;
        personSelect.appendChild(opt);
      });
      // Restore previous selection if still valid
      if (prevVal && [...personSelect.options].some(o => o.value === prevVal)) {
        personSelect.value = prevVal;
      }
    }

    function getSelectedPersonKey() {
      return (personSelect?.value || 'primary').toString().trim();
    }

    function getPersonItrEntries(personKey) {
      const pitrModel = getPersonalItrModel();
      if (personKey === 'primary') {
        return Array.isArray(pitrModel.primary?.itr_entries) ? pitrModel.primary.itr_entries : [];
      }
      const m = personKey.match(/^dp_(\d+)$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        const dps = Array.isArray(pitrModel.designatedPersons) ? pitrModel.designatedPersons : [];
        const dp = dps[idx];
        return dp ? (Array.isArray(dp.itr_entries) ? dp.itr_entries : []) : [];
      }
      return [];
    }

    function savePersonItrEntries(personKey, entries) {
      // Use in-memory model (_personalInfoModel) to preserve PAN/Aadhaar images.
      // readPersonalInfo() reads from localStorage where images are stripped.
      const model = (_personalInfoModel && typeof _personalInfoModel === 'object')
        ? _personalInfoModel
        : readPersonalInfo();
      if (!model.personal_itr) model.personal_itr = { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
      if (personKey === 'primary') {
        if (!model.personal_itr.primary) model.personal_itr.primary = {};
        model.personal_itr.primary.itr_entries = entries;
      } else {
        const m = personKey.match(/^dp_(\d+)$/);
        if (m) {
          const idx = parseInt(m[1], 10);
          if (!Array.isArray(model.personal_itr.designatedPersons)) model.personal_itr.designatedPersons = [];
          if (model.personal_itr.designatedPersons[idx]) {
            model.personal_itr.designatedPersons[idx].itr_entries = entries;
          }
        }
      }
      writePersonalInfo(model);
    }

    function readPitrFormValues() {
      const ay = (qs('[data-pitr-input="assessment_year"]', section)?.value || '').toString().trim();
      const ward = (qs('[data-pitr-input="ward"]', section)?.value || '').toString().trim();
      const filed = (qs('[data-pitr-input="return_filed_on"]', section)?.value || '').toString().trim();
      const income = (qs('[data-pitr-input="total_income"]', section)?.value || '').toString().trim();
      const tax = (qs('[data-pitr-input="tax_paid"]', section)?.value || '').toString().trim();
      const ack = (qs('[data-pitr-input="acknowledgement_no"]', section)?.value || '').toString().trim();
      return {
        assessment_year: ay || null,
        ward: ward || null,
        return_filed_on: filed || null,
        total_income: income || null,
        tax_paid: tax || null,
        acknowledgement_no: ack || null
      };
    }

    function setPitrFormValues(entry) {
      const e = entry && typeof entry === 'object' ? entry : {};
      const aySel = qs('[data-pitr-input="assessment_year"]', section);
      if (aySel && e.assessment_year) aySel.value = String(e.assessment_year);
      const wardEl = qs('[data-pitr-input="ward"]', section);
      if (wardEl) wardEl.value = e.ward != null ? String(e.ward) : '';
      const filedEl = qs('[data-pitr-input="return_filed_on"]', section);
      if (filedEl) setItrDateInputValue(filedEl, e.return_filed_on);
      const incomeEl = qs('[data-pitr-input="total_income"]', section);
      if (incomeEl) incomeEl.value = e.total_income != null ? String(e.total_income) : '';
      const taxEl = qs('[data-pitr-input="tax_paid"]', section);
      if (taxEl) taxEl.value = e.tax_paid != null ? String(e.tax_paid) : '';
      const ackEl = qs('[data-pitr-input="acknowledgement_no"]', section);
      if (ackEl) ackEl.value = e.acknowledgement_no != null ? String(e.acknowledgement_no) : '';
    }

    function clearPitrForm() {
      const aySel = qs('[data-pitr-input="assessment_year"]', section);
      if (aySel) aySel.value = '';
      const wardEl = qs('[data-pitr-input="ward"]', section);
      if (wardEl) wardEl.value = '';
      const filedEl = qs('[data-pitr-input="return_filed_on"]', section);
      if (filedEl) filedEl.value = '';
      const incomeEl = qs('[data-pitr-input="total_income"]', section);
      if (incomeEl) incomeEl.value = '';
      const taxEl = qs('[data-pitr-input="tax_paid"]', section);
      if (taxEl) taxEl.value = '';
      const ackEl = qs('[data-pitr-input="acknowledgement_no"]', section);
      if (ackEl) ackEl.value = '';
    }

    function renderPitrPreview() {
      const personKey = getSelectedPersonKey();
      const entries = getPersonItrEntries(personKey);
      const tbody = qs('[data-pitr-rows]', section);
      if (!tbody) return;
      // Clear existing rows
      qsa('tr[data-pitr-row]', tbody).forEach(tr => tr.remove());
      const emptyRow = qs('tr[data-pitr-empty]', tbody);

      const sorted = sortItrEntries(entries).filter(x => x && typeof x === 'object' && x.assessment_year);
      if (!sorted.length) {
        if (emptyRow) emptyRow.style.display = '';
        return;
      }
      if (emptyRow) emptyRow.style.display = 'none';

      sorted.forEach(e => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-pitr-row', '');

        const tdAy = document.createElement('td'); tdAy.textContent = String(e.assessment_year || '—');
        const tdWard = document.createElement('td'); tdWard.textContent = String(e.ward || '—');
        const tdFiled = document.createElement('td'); tdFiled.textContent = formatItrDateForDisplay(e.return_filed_on);
        const tdIncome = document.createElement('td'); tdIncome.textContent = e.total_income == null || String(e.total_income).trim() === '' ? '—' : String(e.total_income);
        const tdTax = document.createElement('td'); tdTax.textContent = e.tax_paid == null || String(e.tax_paid).trim() === '' ? '—' : String(e.tax_paid);
        const tdAck = document.createElement('td'); tdAck.textContent = e.acknowledgement_no == null || String(e.acknowledgement_no).trim() === '' ? '—' : String(e.acknowledgement_no);

        const tdAction = document.createElement('td');
        tdAction.style.textAlign = 'center';
        tdAction.style.whiteSpace = 'nowrap';
        const editBtn = document.createElement('button');
        editBtn.type = 'button'; editBtn.textContent = '✏️'; editBtn.title = 'Edit';
        editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;';
        editBtn.addEventListener('click', () => setPitrFormValues(e));
        const delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.textContent = '🗑️'; delBtn.title = 'Delete';
        delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;';
        delBtn.addEventListener('click', () => {
          if (!window.confirm('Delete ITR entry for ' + String(e.assessment_year) + '?')) return;
          const current = getPersonItrEntries(personKey);
          const next = current.filter(x => String(x?.assessment_year || '') !== String(e.assessment_year));
          savePersonItrEntries(personKey, next);
          renderPitrPreview();
          if (HAS_CASE_ID) saveSnapshotToServer('personal_personal_itr', JSON.stringify(getPersonalItrModel())).catch(() => {});
        });
        tdAction.appendChild(editBtn);
        tdAction.appendChild(delBtn);

        tr.appendChild(tdAy); tr.appendChild(tdWard); tr.appendChild(tdFiled);
        tr.appendChild(tdIncome); tr.appendChild(tdTax); tr.appendChild(tdAck); tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
    }

    function savePitrEntry() {
      const draft = readPitrFormValues();
      if (!draft.assessment_year) { window.alert('Please select an Assessment Year'); return; }
      const personKey = getSelectedPersonKey();
      const current = getPersonItrEntries(personKey);
      const next = current.filter(x => String(x?.assessment_year || '') !== String(draft.assessment_year));
      next.push(draft);
      savePersonItrEntries(personKey, sortItrEntries(next));
      renderPitrPreview();
      if (HAS_CASE_ID) saveSnapshotToServer('personal_personal_itr', JSON.stringify(getPersonalItrModel())).catch(() => {});
    }

    // Populate AY dropdown
    const aySelect = qs('[data-pitr-input="assessment_year"]', section);
    if (aySelect) {
      const existing = new Set(qsa('option', aySelect).map(o => (o.value || '').toString()));
      buildAssessmentYearOptions({ count: 6 }).forEach(ay => {
        if (!ay || existing.has(ay)) return;
        const opt = document.createElement('option');
        opt.value = ay; opt.textContent = ay;
        aySelect.appendChild(opt);
      });
    }

    // Build person selector
    buildPersonOptions();

    // Events
    if (personSelect) {
      personSelect.addEventListener('change', () => {
        clearPitrForm();
        renderPitrPreview();
      });
    }

    // Save button
    const saveBtn = qs('[data-action="save-pitr"]', section);
    if (saveBtn) saveBtn.addEventListener('click', () => savePitrEntry());

    // Add & Next Year button
    const addNextBtn = qs('[data-action="add-pitr-year"]', section);
    if (addNextBtn) {
      addNextBtn.addEventListener('click', () => {
        savePitrEntry();
        // Auto-select next AY
        if (aySelect) {
          const currentIdx = aySelect.selectedIndex;
          if (currentIdx < aySelect.options.length - 1) {
            aySelect.selectedIndex = currentIdx + 1;
          }
        }
        clearPitrForm();
      });
    }

    // Load from server
    (async () => {
      try {
        if (!HAS_CASE_ID) return;
        const caseId = (q.caseId || '').toString().trim();
        if (!caseId || caseId.toLowerCase() === 'default') return;
        const res = await fetch(`/api/case/${encodeURIComponent(caseId)}/snapshot/personal_personal_itr`, { method: 'GET' });
        const json = await res.json().catch(() => ({}));
        if (json?.success && json?.data?.data) {
          const serverData = json.data.data;
          // Use in-memory model to preserve PAN/Aadhaar images
          const model = (_personalInfoModel && typeof _personalInfoModel === 'object')
            ? _personalInfoModel
            : readPersonalInfo();
          if (!model.personal_itr) model.personal_itr = { primary: { name: '', itr_entries: [] }, designatedPersons: [] };
          // Merge server itr_entries into model
          if (serverData.primary?.itr_entries) {
            if (!model.personal_itr.primary) model.personal_itr.primary = {};
            model.personal_itr.primary.itr_entries = serverData.primary.itr_entries;
          }
          if (Array.isArray(serverData.designatedPersons)) {
            serverData.designatedPersons.forEach((sdp, idx) => {
              if (sdp?.itr_entries && model.personal_itr.designatedPersons?.[idx]) {
                model.personal_itr.designatedPersons[idx].itr_entries = sdp.itr_entries;
              }
            });
          }
          writePersonalInfo(model);
          buildPersonOptions();
        }
      } catch { /* ignore */ }
      renderPitrPreview();
    })();

    // Re-build person list when applicant data changes
    const observer = new MutationObserver(() => {
      buildPersonOptions();
      renderPitrPreview();
    });
    const dpList = qs('[data-dp-list="applicant"]');
    if (dpList) observer.observe(dpList, { childList: true, subtree: true });

    // Expose rebuild for external callers
    window._pitrRebuildPersons = () => {
      buildPersonOptions();
      renderPitrPreview();
    };
  }

  function initBankStatementModule() {
    const applyFromIntegration = () => {
      const stored = readBankStatementFromStorage();
      let data = stored?.data && typeof stored.data === 'object'
        ? stored.data
        : (stored && typeof stored === 'object' ? stored : null);
      // Deep-unwrap nested wrapper layers in localStorage
      if (data) {
        for (let i = 0; i < 10; i++) {
          if (data.applicant_name !== undefined || data.bank_name !== undefined || data.account_number !== undefined || data.status_entries !== undefined) break;
          if (data.data && typeof data.data === 'object') { data = data.data; } else break;
        }
      }
      const initial = data || { status_entries: [] };
      setBankStatementFormValues(initial);
      renderBankStatementPreview(initial);
    };

    // Load from server if possible; only update localStorage cache — don't re-save to server on load.
    (async () => {
      try {
        const fromServer = await loadBankStatementFromServerIfAvailable();
        if (fromServer?.data) {
          STORAGE.setItem(storageKey('integration.bankStatementData'), JSON.stringify({ source: 'server', fetchedAt: new Date().toISOString(), raw: fromServer.raw, data: fromServer.data }));
        }
      } catch {
        // ignore
      } finally {
        applyFromIntegration();
      }
    })();

    const live = () => {
      const data = readBankStatementFormValues();
      renderBankStatementPreview(data);
    };

    qsa('[data-bank-field]').forEach((el) => {
      el.addEventListener('input', live);
      el.addEventListener('change', live);
    });

    const statusHost = getBankStatusEditorContainer();
    if (statusHost) {
      statusHost.addEventListener('input', live);
      statusHost.addEventListener('change', live);
      statusHost.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-bank-status-remove]') : null;
        if (!btn) return;
        const row = btn.closest('[data-bank-status-editor-row]');
        if (!row) return;
        const rows = qsa('[data-bank-status-editor-row]', statusHost);
        if (rows.length <= BANK_STATUS_MIN_ROWS) {
          window.alert('Minimum 3 rows required.');
          return;
        }
        row.remove();
        live();
      });
    }

    const addBtn = qs('[data-action="bank-status-add"]');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const host = getBankStatusEditorContainer();
        if (!host) return;
        host.appendChild(createBankStatusEditorRow({ date: '', amount: '', type: 'CR' }));
        live();
      });
    }
  }

  async function fetchGstRecord() {
    const gstin = (q.gstin || '').toString().trim();
    if (!gstin) {
      window.alert('GSTIN is required (open workspace with ?gstin=...).');
      return;
    }

    const btn = qs('[data-action="fetch-gst-record"]');
    const prev = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Fetching…';
    }

    try {
      const res = await fetch(`/api/gst/${encodeURIComponent(gstin)}`, { method: 'GET' });
      const json = await res.json().catch(() => ({}));
      if (!json?.success) throw new Error(json?.error || 'GST fetch failed');

      const payload = {
        source: 'case-workspace',
        fetchedAt: new Date().toISOString(),
        gstin,
        // store full response (includes metadata) for Save JSON
        raw: json
      };
      STORAGE.setItem(storageKey('integration.gstData'), JSON.stringify(payload));
      setLastUpdatedNow();
      if (HAS_CASE_ID) saveSnapshotToServer('gst', JSON.stringify(payload)).catch(() => {});
      loadSnapshots();
      setActiveModule('gst');
    } catch (e) {
      window.alert(e?.message || 'GST fetch failed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Fetch Record';
      }
    }
  }

  async function fetchMcaRecord() {
    const cin = (q.cin || '').toString().trim();
    if (!cin) {
      window.alert('CIN is required (open workspace with ?cin=...).');
      return;
    }

    const btn = qs('[data-action="fetch-mca-record"]');
    const prev = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Fetching…';
    }

    try {
      const res = await fetch('/api/fetch-mca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cin })
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.success) throw new Error(json?.error || 'MCA fetch failed');

      const payload = {
        source: 'case-workspace',
        fetchedAt: new Date().toISOString(),
        cin,
        raw: json
      };
      STORAGE.setItem(storageKey('integration.mcaData'), JSON.stringify(payload));
      setLastUpdatedNow();
      if (HAS_CASE_ID) saveSnapshotToServer('mca', JSON.stringify(payload)).catch(() => {});
      loadSnapshots();
      setActiveModule('mca');
    } catch (e) {
      window.alert(e?.message || 'MCA fetch failed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Fetch Record';
      }
    }
  }

  function setPrimaryIdentifier() {
    const parts = [];
    if (q.gstin) parts.push(`GSTIN: ${q.gstin}`);
    if (q.cin) parts.push(`CIN: ${q.cin}`);
    bindText('primaryIdentifier', parts.length ? parts.join(' • ') : '—');
  }

  function bindCaseMeta() {
    bindText('caseId', q.caseId || '—');
    bindText('businessName', q.businessName || '—');
    bindText('businessType', q.businessType || '—');
    bindText('assignedTo', q.assignedTo || '—');

    const last = STORAGE.getItem(storageKey('lastUpdated'));
    if (last) {
      const d = new Date(last);
      bindText('lastUpdated', Number.isFinite(d.getTime()) ? d.toLocaleString('en-IN') : last);
    } else {
      bindText('lastUpdated', '—');
    }

    bindText('riskSummary', '—');
    setPrimaryIdentifier();
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // Snapshot keys that map to a module status key (for auto-reset on re-save)
  const SNAPSHOT_TO_MODULE = {
    gst: 'gst', mca: 'mca', compliance: 'compliance', pan: 'pan', udyam: 'udyam',
    itr: 'itr', bank_statement: 'bank_statement', financial: 'financial',
    field_data: 'field_data', business_summary: 'business_summary',
    additional_details: 'additional_details'
  };

  async function saveSnapshotToServer(moduleKey, jsonText) {
    const caseId = (q.caseId || '').toString().trim();
    if (!caseId || caseId.toLowerCase() === 'default') {
      throw new Error('caseId is required to save snapshots. (Testing mode without caseId does not persist.)');
    }
    let data = null;
    try {
      data = JSON.parse(String(jsonText || '').trim() || '{}');
    } catch {
      data = { raw_text: String(jsonText || '') };
    }

    const res = await fetch('/api/case/save-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId, moduleKey, data })
    });
    const out = await res.json().catch(() => ({}));
    if (!out?.success) throw new Error(out?.error || 'Save failed');

    // If this module was marked completed, reset it to pending (user re-saved data)
    const statusKey = SNAPSHOT_TO_MODULE[moduleKey];
    if (statusKey && moduleKey !== 'module_statuses' && moduleKey !== 'personal_module_completion') {
      const current = readModuleStatuses();
      if (current[statusKey] === STATUS.completed) {
        const next = { ...current, [statusKey]: STATUS.pending };
        writeModuleStatuses(next);
        updateUIFromStatuses(next);
      }
    }

    return out;
  }

  function readModuleAISummaries() {
    const parsed = safeJSONParse(STORAGE.getItem(storageKey(AI_SUMMARY_STORAGE)), null);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  }

  function writeModuleAISummaries(next) {
    STORAGE.setItem(storageKey(AI_SUMMARY_STORAGE), JSON.stringify(next || {}));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('ai_summary', JSON.stringify(next || {})).catch(() => {});
  }

  function parseSummaryKey(summaryKey) {
    const raw = String(summaryKey || '').trim();
    const split = raw.split(':');
    if (split.length !== 2) return null;
    const blockKey = split[0] === 'personal' ? 'personal' : 'business';
    const moduleKey = split[1] || '';
    if (!moduleKey) return null;
    return { blockKey, moduleKey, summaryKey: `${blockKey}:${moduleKey}` };
  }

  function getModuleLabelFromSection(section, moduleKey) {
    const title = qs('.module-title', section);
    const text = (title?.textContent || '').toString().trim();
    if (text) return text;
    return String(moduleKey || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function getAISummaryPayloadFromIntegration(raw) {
    if (!raw || typeof raw !== 'object') return {};
    if (raw.raw && typeof raw.raw === 'object') return raw.raw;
    if (raw.data && typeof raw.data === 'object') return raw.data;
    return raw;
  }

  function readGstReportSelection() {
    const parsed = safeJSONParse(STORAGE.getItem(storageKey(GST_REPORT_SELECTION_STORAGE)), null);
    if (!parsed || typeof parsed !== 'object') return { selectedKeys: [] };
    const selectedKeys = Array.isArray(parsed.selectedKeys)
      ? parsed.selectedKeys.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    return { selectedKeys: [...new Set(selectedKeys)] };
  }

  function writeGstReportSelection(next) {
    const selectedKeys = Array.isArray(next?.selectedKeys)
      ? next.selectedKeys.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    const out = { selectedKeys: [...new Set(selectedKeys)] };
    STORAGE.setItem(storageKey(GST_REPORT_SELECTION_STORAGE), JSON.stringify(out));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('gst_report_selection', JSON.stringify(out)).catch(() => {});
    return out;
  }

  function stringifyMaybe(v) {
    if (v == null) return '';
    return String(v).trim();
  }

  function buildGstFiledKey(entry) {
    const year = stringifyMaybe(entry.year || entry.financial_year || entry.fy);
    const month = stringifyMaybe(entry.month || entry.tax_period || entry.period);
    const returnType = stringifyMaybe(entry.return_type || entry.form || entry.gstr || entry.type);
    const status = stringifyMaybe(entry.status || entry.filed_status || entry.filing_status);
    const filedOn = stringifyMaybe(entry.filed_on || entry.filing_date || entry.date);
    return [year, month, returnType, status, filedOn].join('|');
  }

  function normalizeGstFiledEntry(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const year = stringifyMaybe(item.year || item.financial_year || item.fy || item.assessment_year) || null;
    const month = stringifyMaybe(item.month || item.tax_period || item.period || item.returnPeriod) || null;
    const returnType = stringifyMaybe(item.return_type || item.returnType || item.form || item.gstr || item.type) || null;
    const status = stringifyMaybe(item.status || item.filed_status || item.filing_status || item.filingStatus) || null;
    const filedOn = stringifyMaybe(item.filed_on || item.filing_date || item.filedDate || item.date) || null;
    const key = buildGstFiledKey({ year, month, return_type: returnType, status, filed_on: filedOn });

    return {
      key,
      year,
      month,
      return_type: returnType,
      status,
      filed_on: filedOn
    };
  }

  function extractGstFiledEntriesFromPayload(gstPayload) {
    const entries = [];
    const seen = new Set();

    const pushIfCandidate = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      const hasYear = ['year', 'financial_year', 'fy', 'assessment_year'].some((k) => obj[k] != null);
      const hasMonth = ['month', 'tax_period', 'period', 'returnPeriod'].some((k) => obj[k] != null);
      const hasStatus = ['status', 'filed_status', 'filing_status', 'filingStatus'].some((k) => obj[k] != null);
      const hasReturn = ['return_type', 'returnType', 'form', 'gstr', 'type'].some((k) => obj[k] != null);
      if (!(hasYear || hasMonth) || !(hasStatus || hasReturn)) return;

      const normalized = normalizeGstFiledEntry(obj);
      if (!normalized.key || seen.has(normalized.key)) return;
      seen.add(normalized.key);
      entries.push(normalized);
    };

    const walk = (node, depth = 0) => {
      if (node == null || depth > 8) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;
      pushIfCandidate(node);
      Object.values(node).forEach((value) => walk(value, depth + 1));
    };

    walk(gstPayload, 0);
    return entries;
  }

  function readSelectedGstFiledEntries() {
    const gstPayload = getAISummaryPayloadFromIntegration(readIntegrationObject('gstData')) || {};
    const all = extractGstFiledEntriesFromPayload(gstPayload);
    const selected = new Set(readGstReportSelection().selectedKeys || []);
    return all.filter((item) => selected.has(item.key));
  }

  function renderGstFilingSelectionPanel() {
    const host = qs('[data-gst-filing-list]');
    if (!host) return;

    const gstPayload = getAISummaryPayloadFromIntegration(readIntegrationObject('gstData')) || {};
    const rows = extractGstFiledEntriesFromPayload(gstPayload);

    if (!rows.length) {
      host.innerHTML = '<div class="muted">Fetch GST record first to load filing rows.</div>';
      return;
    }

    const selected = new Set(readGstReportSelection().selectedKeys || []);
    host.innerHTML = rows.map((row) => {
      const title = [row.return_type || 'Return', row.month || 'Period', row.year || 'FY'].filter(Boolean).join(' • ');
      const sub = [row.status || 'Status N/A', row.filed_on ? `Filed: ${row.filed_on}` : null].filter(Boolean).join(' • ');
      return `
        <div class="gst-filing-row">
          <label>
            <input type="checkbox" data-gst-filing-check="${row.key}" ${selected.has(row.key) ? 'checked' : ''} />
            <span>
              <strong>${title || 'GST Filing Row'}</strong>
              <div class="report-included-meta">${sub || 'No additional details'}</div>
            </span>
          </label>
          <span class="status-pill" data-status="completed">Eligible</span>
        </div>
      `;
    }).join('');
  }

  function getModuleDataForAISummary(blockKey, moduleKey) {
    if (blockKey === 'personal') {
      const personal = readPersonalInfo();
      return personal?.[moduleKey] || {};
    }

    if (moduleKey === 'gst') {
      const gst = getAISummaryPayloadFromIntegration(readIntegrationObject('gstData')) || {};
      const selectedFilings = readSelectedGstFiledEntries();
      if (!selectedFilings.length) return gst;
      return {
        ...gst,
        selected_filed_rows: selectedFilings
      };
    }
    if (moduleKey === 'mca') return getAISummaryPayloadFromIntegration(readIntegrationObject('mcaData'));
    if (moduleKey === 'compliance') return getAISummaryPayloadFromIntegration(readIntegrationObject('complianceData'));
    if (moduleKey === 'pan') return getAISummaryPayloadFromIntegration(readPanFromStorage());
    if (moduleKey === 'udyam') return getAISummaryPayloadFromIntegration(readUdyamFromStorage());
    if (moduleKey === 'itr') return getAISummaryPayloadFromIntegration(readItrFromStorage());
    if (moduleKey === 'bank_statement') return getAISummaryPayloadFromIntegration(readBankStatementFromStorage());
    if (moduleKey === 'financial') {
      const financial = readFinancialFromStorage();
      if (financial?.model_analysis && typeof financial.model_analysis === 'object') {
        return financial.model_analysis;
      }
      if (financial?.analysis && typeof financial.analysis === 'object') {
        return financial.analysis;
      }
      return getAISummaryPayloadFromIntegration(financial);
    }
    return {};
  }

  function hasMeaningfulReportData(value) {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulReportData(item));
    if (typeof value === 'object') {
      const excluded = new Set(['fetchedAt', 'source', 'saved_at', 'saved_by', 'generated_at', 'raw']);
      return Object.entries(value).some(([k, v]) => {
        if (excluded.has(k)) return false;
        return hasMeaningfulReportData(v);
      });
    }
    return false;
  }

  const PERSONAL_MODULE_LABELS = {
    applicant: 'Applicant Details',
    pan: 'PAN Verification',
    aadhaar: 'Aadhaar Verification',
    resident_verification: 'Residential Verification',
    personal_itr: 'Personal ITR'
  };

  function getPersonalModuleDataStatus(mk) {
    const pi = readPersonalInfo();
    const mod = pi?.[mk];
    if (!mod || typeof mod !== 'object') return false;
    const primary = mod.primary || {};
    const dp = Array.isArray(mod.designatedPersons) ? mod.designatedPersons : [];
    const hasPrimary = Object.entries(primary).some(([k, v]) => k !== 'verified_document' && v && String(v).trim());
    return hasPrimary || dp.length > 0;
  }

  function defaultReportConfig() {
    const statuses = readModuleStatuses();
    return {
      selectedModules: MODULE_KEYS.filter((key) => normalizeModuleStatus(statuses?.[key]) === STATUS.completed),
      selectedPersonalModules: PERSONAL_MODULE_KEYS.filter((mk) => getPersonalModuleDataStatus(mk))
    };
  }

  function readReportConfig() {
    const parsed = safeJSONParse(STORAGE.getItem(storageKey(REPORT_CONFIG_STORAGE)), null);
    const base = defaultReportConfig();
    // If no saved config, use auto-detected defaults (first time)
    if (!parsed) {
      return { selectedModules: [...base.selectedModules], selectedPersonalModules: [...base.selectedPersonalModules], includeCaseOverview: false, includeBusinessEntity: false };
    }
    // Use saved selection exactly as-is (respect user's untick choices)
    const selected = Array.isArray(parsed.selectedModules)
      ? parsed.selectedModules.map((k) => String(k || '').trim()).filter((k) => MODULE_KEYS.includes(k))
      : base.selectedModules;
    const selectedPersonal = Array.isArray(parsed.selectedPersonalModules)
      ? parsed.selectedPersonalModules.map((k) => String(k || '').trim()).filter((k) => PERSONAL_MODULE_KEYS.includes(k))
      : base.selectedPersonalModules;
    const includeCaseOverview = parsed?.includeCaseOverview === true;
    const includeBusinessEntity = parsed?.includeBusinessEntity === true;
    return { selectedModules: [...new Set(selected)], selectedPersonalModules: [...new Set(selectedPersonal)], includeCaseOverview, includeBusinessEntity };
  }

  function writeReportConfig(next) {
    const selected = Array.isArray(next?.selectedModules)
      ? next.selectedModules.map((k) => String(k || '').trim()).filter((k) => MODULE_KEYS.includes(k))
      : [];
    const selectedPersonal = Array.isArray(next?.selectedPersonalModules)
      ? next.selectedPersonalModules.map((k) => String(k || '').trim()).filter((k) => PERSONAL_MODULE_KEYS.includes(k))
      : [];
    const includeCaseOverview = next?.includeCaseOverview === true;
    const includeBusinessEntity = next?.includeBusinessEntity === true;
    const out = { selectedModules: [...new Set(selected)], selectedPersonalModules: [...new Set(selectedPersonal)], includeCaseOverview, includeBusinessEntity };
    STORAGE.setItem(storageKey(REPORT_CONFIG_STORAGE), JSON.stringify(out));
    setLastUpdatedNow();
    if (HAS_CASE_ID) saveSnapshotToServer('report_config', JSON.stringify(out)).catch(() => {});
    return out;
  }

  function getBusinessModuleLabel(moduleKey) {
    const el = qs(`.tracker-item[data-module="${CSS.escape(moduleKey)}"] .tracker-name`);
    const label = (el?.textContent || '').toString().trim();
    if (label) return label;
    return moduleKey.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function buildSelectedReportModules(selectedModules) {
    const out = {};
    for (const moduleKey of selectedModules) {
      out[moduleKey] = getModuleDataForAISummary('business', moduleKey);
    }
    // Always include PAN data so Business Entity page and PAN verification page
    // can render even if the PAN module is not explicitly selected in the report config
    if (!out.pan) {
      const panData = getAISummaryPayloadFromIntegration(readPanFromStorage());
      if (panData && typeof panData === 'object' && (panData.pan_number || panData.name)) {
        out.pan = panData;
      }
    }
    return out;
  }

  function buildDueDiligencePayloadForReport() {
    const config = readReportConfig();
    const selectedModules = Array.isArray(config.selectedModules) ? config.selectedModules : [];
    const moduleData = buildSelectedReportModules(selectedModules);
    const selectedGstFiledRows = selectedModules.includes('gst') ? readSelectedGstFiledEntries() : [];

    const gstData = getAISummaryPayloadFromIntegration(readIntegrationObject('gstData')) || null;
    const mcaData = getAISummaryPayloadFromIntegration(readIntegrationObject('mcaData')) || null;

    const casePayload = {
      caseId: q.caseId || null,
      companyName:
        q.businessName ||
        mcaData?.companyName ||
        gstData?.legalName ||
        gstData?.tradeName ||
        null,
      businessName: q.businessName || null,
      businessType: q.businessType || null,
      gstin: q.gstin || gstData?.gstin || null,
      cin: q.cin || mcaData?.cin || null,
      reportDate: new Date().toISOString()
    };

    // Collect personal info for report (preserve PAN/Aadhaar doc photos for PDF embedding)
    // Use in-memory model (_personalInfoModel) which retains full image dataUrls
    // (readPersonalInfo reads from localStorage where dataUrls are stripped for quota reasons)
    const personalInfo = (_personalInfoModel && typeof _personalInfoModel === 'object')
      ? JSON.parse(JSON.stringify(_personalInfoModel))
      : readPersonalInfo();
    const personalInfoForReport = {};
    PERSONAL_MODULE_KEYS.forEach((mk) => {
      if (!personalInfo[mk]) return;
      const mod = JSON.parse(JSON.stringify(personalInfo[mk]));
      // Keep data_url for PAN and Aadhaar so server can embed photos in report PDF
      // Only strip data_url for other modules to reduce payload size
      if (mk !== 'pan' && mk !== 'aadhaar') {
        if (mod.primary && mod.primary.verified_document && mod.primary.verified_document.data_url) {
          mod.primary.verified_document = { file_name: mod.primary.verified_document.file_name, attached: true };
        }
      }
      personalInfoForReport[mk] = mod;
    });

    // ── Collect AI module summaries (fallback to manual text from textarea) ──
    const allAISummaries = readModuleAISummaries();
    const moduleSummaries = {};
    for (const moduleKey of selectedModules) {
      if (moduleKey === 'field_data') {
        // Field data summary comes from dedicated textarea, not AI summary
        const fdSumEl = qs('#fieldDataSummaryTextarea');
        const fdSumText = fdSumEl ? String(fdSumEl.value || '').trim() : '';
        if (!fdSumText) {
          try {
            const stored = safeJSONParse(STORAGE.getItem(storageKey('integration.fieldDataSummary')), null);
            if (stored?.summary) moduleSummaries['field_data'] = stored.summary;
          } catch {}
        } else {
          moduleSummaries['field_data'] = fdSumText;
        }
        continue;
      }
      // First check stored AI summary
      const summaryKey = `business:${moduleKey}`;
      const item = allAISummaries[summaryKey];
      if (item && typeof item === 'object' && String(item.summary || '').trim()) {
        moduleSummaries[moduleKey] = String(item.summary).trim();
      } else {
        // Fallback: try reading from summary textarea in DOM
        const textareaEl = qs(`[data-ai-summary-text="${CSS.escape(summaryKey)}"]`);
        const manualText = textareaEl ? String(textareaEl.value || '').trim() : '';
        if (manualText) {
          moduleSummaries[moduleKey] = manualText;
        }
        // If still empty — leave it out; server will generate fallback
      }
    }
    // Also include personal block summaries
    for (const mk of PERSONAL_MODULE_KEYS) {
      const summaryKey = `personal:${mk}`;
      const item = allAISummaries[summaryKey];
      if (item && typeof item === 'object' && String(item.summary || '').trim()) {
        moduleSummaries[`personal_${mk}`] = String(item.summary).trim();
      }
    }

    // ── Prepared By ──
    const preparedByEl = qs('[data-report-prepared-by]');
    const preparedBy = preparedByEl ? String(preparedByEl.value || '').trim() : '';

    // ── Overall observation: read from stored text or DOM ──
    const overallObsEl = qs('[data-report-overall-observation]');
    const overallObservation = overallObsEl ? String(overallObsEl.value || '').trim() : '';

    // ── Field images ──
    const reportFieldImages = fieldDataImages.map((img) => ({
      id: img.id,
      label: img.label,
      fileName: img.fileName,
      mimeType: img.mimeType,
      dataUrl: img.dataUrl
    }));

    // ── Resident Verification data ──
    const rvAddressData = personalInfo?.resident_verification?.primary || {};
    const reportResidentVerificationData = (Object.values(rvAddressData).some(v => v) || residentVerificationImages.length)
      ? {
          addressData: rvAddressData,
          images: residentVerificationImages.map((img) => ({
            id: img.id, label: img.label, fileName: img.fileName, mimeType: img.mimeType, dataUrl: img.dataUrl
          }))
        }
      : null;

    // Case overview data (manually entered in Case Overview block)
    const caseOverviewForReport = (() => {
      const config = readReportConfig();
      if (!config.includeCaseOverview) return null;
      const raw = STORAGE.getItem(storageKey('case_overview'));
      const parsed = safeJSONParse(raw, null);
      if (parsed && typeof parsed === 'object' && Object.values(parsed).some(v => v)) return parsed;
      return null;
    })();

    // Additional Details data (for Details of Business Entity page)
    const additionalDetailsForReport = (() => {
      const config = readReportConfig();
      if (!config.includeBusinessEntity) return null;
      // Always save latest before building payload so server snapshot is up-to-date
      saveAdditionalDetailsToStorage();
      const raw = STORAGE.getItem(storageKey('additional_details'));
      const parsed = safeJSONParse(raw, null);
      if (parsed && typeof parsed === 'object' && Object.values(parsed).some(v => v)) return parsed;
      return null;
    })();

    return {
      case: casePayload,
      caseId: q.caseId || null,
      gstData,
      mcaData,
      modules: moduleData,
      personalInfo: personalInfoForReport,
      moduleSummaries,
      overallObservation,
      fieldImages: reportFieldImages,
      residentVerificationData: reportResidentVerificationData,
      caseOverview: caseOverviewForReport,
      additionalDetails: additionalDetailsForReport,
      assignedTo: q.assignedTo || '',
      preparedBy: preparedBy || '',
      fieldDataVerifiedBy: (() => { var el = qs('#fieldDataVerifiedBy'); return el ? String(el.value || '').trim() : ''; })(),
      officer: (customSignatureDataUrl || customStampDataUrl) ? {
        signatureImage: customSignatureDataUrl ? { dataUrl: customSignatureDataUrl } : undefined,
        stampImage: customStampDataUrl ? { dataUrl: customStampDataUrl } : undefined
      } : undefined,
      reportConfig: {
        selectedModules,
        selectedPersonalModules: Array.isArray(config.selectedPersonalModules) ? config.selectedPersonalModules : [],
        includeCaseOverview: !!caseOverviewForReport,
        includeBusinessEntity: !!additionalDetailsForReport,
        gstSelectedRows: selectedGstFiledRows
      }
    };
  }

  function renderReportBuilderPreview() {
    const listRoot = qs('[data-report-module-list]');
    const includedRoot = qs('[data-report-included-list]');
    const previewEl = qs('[data-report-preview-json]');
    const countEl = qs('[data-report-selected-count]');
    if (!listRoot || !includedRoot || !previewEl || !countEl) return;

    const statuses = readModuleStatuses();
    const config = readReportConfig();
    const selectedSet = new Set(config.selectedModules || []);

    // ── Case Overview data status ──
    const coRaw = STORAGE.getItem(storageKey('case_overview'));
    const coData = safeJSONParse(coRaw, null);
    const coHasData = coData && typeof coData === 'object' && Object.values(coData).some(v => v);
    const coStatusLabel = coHasData ? 'Data Filled' : 'No Data';
    const coStatusKey = coHasData ? 'completed' : 'pending';

    // ── Business Entity data status ──
    const adRaw = STORAGE.getItem(storageKey('additional_details'));
    const adData = safeJSONParse(adRaw, null);
    const adHasData = adData && typeof adData === 'object' && Object.values(adData).some(v => v);
    const beStatusLabel = adHasData ? 'Data Filled' : 'No Data';
    const beStatusKey = adHasData ? 'completed' : 'pending';

    // ── Build Case Overview + Business Entity rows at top ──
    const topRows = `
      <div class="report-module-item" style="border-bottom:2px solid var(--border,#e5e7eb);padding-bottom:10px;margin-bottom:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="chkIncludeCaseOverview" data-report-case-overview-pick ${config.includeCaseOverview ? 'checked' : ''} />
          <span>
            <strong>Case Overview (First Page After Cover)</strong>
            <div class="report-module-meta">Name, Activity, Status, Location, Turnover, Bank Ref, Dates</div>
          </span>
        </label>
        <span class="status-pill" id="caseOverviewDataStatus" data-status="${coStatusKey}">${coStatusLabel}</span>
      </div>
      <div class="report-module-item" style="border-bottom:2px solid var(--border,#e5e7eb);padding-bottom:10px;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="chkIncludeBusinessEntity" data-report-business-entity-pick ${config.includeBusinessEntity ? 'checked' : ''} />
          <span>
            <strong>Details of Business Entity (Page After Case Overview)</strong>
            <div class="report-module-meta">Entity name, Constitution, PAN, GSTN, LEI, Udyam, MSME, Contact, etc.</div>
          </span>
        </label>
        <span class="status-pill" id="businessEntityDataStatus" data-status="${beStatusKey}">${beStatusLabel}</span>
      </div>
    `;

    const moduleRows = MODULE_KEYS.map((moduleKey) => {
      const status = normalizeModuleStatus(statuses?.[moduleKey]);
      const checked = selectedSet.has(moduleKey);
      const label = getBusinessModuleLabel(moduleKey);
      return `
        <div class="report-module-item">
          <label>
            <input type="checkbox" data-report-module-pick="${moduleKey}" ${checked ? 'checked' : ''} />
            <span>
              <strong>${label}</strong>
              <div class="report-module-meta">Status: ${STATUS_LABEL[status] || STATUS_LABEL.pending}</div>
            </span>
          </label>
          <span class="status-pill" data-status="${status}">${STATUS_LABEL[status] || STATUS_LABEL.pending}</span>
        </div>
      `;
    }).join('');

    // ── Personal Block Module rows ──
    const personalSelectedSet = new Set(config.selectedPersonalModules || []);
    const personalModuleRows = PERSONAL_MODULE_KEYS.map((mk) => {
      const hasData = getPersonalModuleDataStatus(mk);
      const checked = personalSelectedSet.has(mk);
      const label = PERSONAL_MODULE_LABELS[mk] || mk.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      const statusKey = hasData ? 'completed' : 'pending';
      const statusLabel = hasData ? 'Data Filled' : 'No Data';
      return `
        <div class="report-module-item">
          <label>
            <input type="checkbox" data-report-personal-pick="${mk}" ${checked ? 'checked' : ''} />
            <span>
              <strong>${label}</strong>
              <div class="report-module-meta">Personal Block${hasData ? ' — Data Available' : ''}</div>
            </span>
          </label>
          <span class="status-pill" data-status="${statusKey}">${statusLabel}</span>
        </div>
      `;
    }).join('');

    const personalSectionHeader = `
      <div style="margin-top:12px;padding:8px 0 6px;border-top:2px solid var(--border,#e5e7eb)">
        <strong style="font-size:13px;color:var(--navy,#1b2559)">Personal Block Modules</strong>
        <div style="font-size:11px;color:#64748b;margin-top:2px">Applicant KYC, PAN, Aadhaar, Residential Verification, ITR</div>
      </div>
    `;

    listRoot.innerHTML = topRows + moduleRows + personalSectionHeader + personalModuleRows;

    // Total count includes Case Overview + Business Entity + personal modules if checked
    let totalSelected = selectedSet.size + personalSelectedSet.size;
    if (config.includeCaseOverview) totalSelected++;
    if (config.includeBusinessEntity) totalSelected++;
    countEl.textContent = `${totalSelected} selected`;

    const financialToggle = qs('[data-fin-include-report]');
    if (financialToggle) {
      financialToggle.checked = selectedSet.has('financial');
    }

    const payload = buildDueDiligencePayloadForReport();
    previewEl.textContent = prettyJSON(payload);
  }

  async function generateDueDiligenceReportFromBuilder(triggerButton) {
    const payload = buildDueDiligencePayloadForReport();
    const estimateTimer = startRunEstimate({
      containerSelector: '[data-report-estimate]',
      textSelector: '[data-report-estimate-text]',
      estimateMs: estimateReportRunMs(payload)
    });

    const btn = triggerButton;
    const prevText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating PDF…';
    }

    try {
      const res = await fetch('/api/generate-due-diligence-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let message = 'Failed to generate report';
        try {
          const json = await res.json();
          message = json?.error || message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const fileName = `${(q.businessName || q.caseId || 'Case').replace(/[^a-z0-9]/gi, '_')}_PreSanction_DueDiligence.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (HAS_CASE_ID) {
        try {
          await saveSnapshotToServer('report_config', JSON.stringify(payload.reportConfig || {}, null, 2));
        } catch {
          // ignore
        }
      }
    } finally {
      estimateTimer.stop();
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || 'Generate Final Report PDF';
      }
    }
  }

  function initReportBlock() {
    const listRoot = qs('[data-report-module-list]');
    if (!listRoot) return;



    listRoot.addEventListener('change', (event) => {
      // Business module checkboxes
      const input = event.target?.closest?.('[data-report-module-pick]');
      if (input) {
        const moduleKey = input.getAttribute('data-report-module-pick') || '';
        if (!MODULE_KEYS.includes(moduleKey)) return;
        const current = readReportConfig();
        const set = new Set(current.selectedModules || []);
        if (input.checked) set.add(moduleKey);
        else set.delete(moduleKey);
        writeReportConfig({ selectedModules: [...set], selectedPersonalModules: current.selectedPersonalModules, includeCaseOverview: current.includeCaseOverview, includeBusinessEntity: current.includeBusinessEntity });
        renderReportBuilderPreview();
        return;
      }

      // Personal module checkboxes
      const pInput = event.target?.closest?.('[data-report-personal-pick]');
      if (pInput) {
        const mk = pInput.getAttribute('data-report-personal-pick') || '';
        if (!PERSONAL_MODULE_KEYS.includes(mk)) return;
        const current = readReportConfig();
        const pSet = new Set(current.selectedPersonalModules || []);
        if (pInput.checked) pSet.add(mk);
        else pSet.delete(mk);
        writeReportConfig({ selectedModules: current.selectedModules, selectedPersonalModules: [...pSet], includeCaseOverview: current.includeCaseOverview, includeBusinessEntity: current.includeBusinessEntity });
        renderReportBuilderPreview();
        return;
      }

      // Case Overview checkbox (inside module list)
      const coChk = event.target?.closest?.('[data-report-case-overview-pick]');
      if (coChk) {
        const current = readReportConfig();
        writeReportConfig({ selectedModules: current.selectedModules, selectedPersonalModules: current.selectedPersonalModules, includeCaseOverview: coChk.checked, includeBusinessEntity: current.includeBusinessEntity });
        renderReportBuilderPreview();
        return;
      }

      // Business Entity checkbox (inside module list)
      const beChk = event.target?.closest?.('[data-report-business-entity-pick]');
      if (beChk) {
        const current = readReportConfig();
        writeReportConfig({ selectedModules: current.selectedModules, selectedPersonalModules: current.selectedPersonalModules, includeCaseOverview: current.includeCaseOverview, includeBusinessEntity: beChk.checked });
        renderReportBuilderPreview();
        return;
      }
    });

    // ── Helper: persist custom report images to localStorage + server ──
    function persistReportImages() {
      const data = {};
      if (customSignatureDataUrl) data.signatureDataUrl = customSignatureDataUrl;
      if (customStampDataUrl) data.stampDataUrl = customStampDataUrl;
      try { STORAGE.setItem(storageKey('integration.reportImages'), JSON.stringify(data)); } catch {}
      if (HAS_CASE_ID) saveSnapshotToServer('report_images', JSON.stringify(data)).catch(() => {});
    }

    // ── Restore custom report images from localStorage (instant) ──
    try {
      const stored = safeJSONParse(STORAGE.getItem(storageKey('integration.reportImages')), null);
      if (stored && typeof stored === 'object') {
        if (stored.signatureDataUrl) {
          customSignatureDataUrl = stored.signatureDataUrl;
          const img = qs('#reportSignatureImg');
          if (img) img.src = stored.signatureDataUrl;
        }
        if (stored.stampDataUrl) {
          customStampDataUrl = stored.stampDataUrl;
          const img = qs('#reportStampImg');
          if (img) img.src = stored.stampDataUrl;
        }
      }
    } catch {}

    // ── Signature & Stamp upload handlers ──
    const sigInput = qs('[data-action="upload-signature"]');
    if (sigInput) {
      sigInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
          customSignatureDataUrl = reader.result;
          const img = qs('#reportSignatureImg');
          if (img) img.src = reader.result;
          persistReportImages();
        };
        reader.readAsDataURL(file);
      });
    }
    const stampInput = qs('[data-action="upload-stamp"]');
    if (stampInput) {
      stampInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
          customStampDataUrl = reader.result;
          const img = qs('#reportStampImg');
          if (img) img.src = reader.result;
          persistReportImages();
        };
        reader.readAsDataURL(file);
      });
    }

    // Restore saved preparedBy from localStorage
    const savedPreparedBy = STORAGE.getItem(storageKey('prepared_by'));
    if (savedPreparedBy) {
      const pbEl = qs('[data-report-prepared-by]');
      if (pbEl) pbEl.value = savedPreparedBy;
    }
    // Auto-save preparedBy on input
    const pbInput = qs('[data-report-prepared-by]');
    if (pbInput) {
      pbInput.addEventListener('input', () => {
        STORAGE.setItem(storageKey('prepared_by'), pbInput.value || '');
      });
    }

    // Restore saved overall observation from localStorage
    const savedObs = STORAGE.getItem(storageKey('overall_observation'));
    if (savedObs) {
      const obsEl = qs('[data-report-overall-observation]');
      if (obsEl) obsEl.value = savedObs;
    }

    renderReportBuilderPreview();
  }

  function getExecutiveModuleSummaries() {
    const moduleStatuses = readModuleStatuses();
    const state = readModuleAISummaries();
    return Object.values(state || {})
      .filter((item) => item && typeof item === 'object')
      .filter((item) => String(item.selection || '').trim().toLowerCase() === 'executive')
      .filter((item) => String(item.summary || '').trim())
      .filter((item) => String(item.blockKey || '').trim().toLowerCase() === 'business')
      .filter((item) => {
        const moduleKey = String(item.moduleKey || '').trim();
        if (!moduleKey || !MODULE_KEYS.includes(moduleKey)) return false;
        return normalizeModuleStatus(moduleStatuses?.[moduleKey]) === STATUS.completed;
      })
      .map((item) => ({
        summaryKey: String(item.summaryKey || '').trim(),
        blockKey: String(item.blockKey || '').trim(),
        moduleKey: String(item.moduleKey || '').trim(),
        moduleLabel: String(item.moduleLabel || '').trim(),
        summary: String(item.summary || '').trim(),
        status: STATUS.completed,
        generatedAt: item.generatedAt || null
      }));
  }

  async function persistModuleAISummariesSnapshot() {
    if (!HAS_CASE_ID) return;
    const payload = {
      generated_at: new Date().toISOString(),
      selected_for_report: getExecutiveModuleSummaries(),
      all: readModuleAISummaries()
    };
    try {
      await saveSnapshotToServer('ai_summary', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function updateAISummaryStatus(summaryKey, text) {
    const statusEl = qs(`[data-ai-summary-status="${CSS.escape(summaryKey)}"]`);
    if (!statusEl) return;
    statusEl.textContent = String(text || '').trim() || 'Ready';
  }

  function upsertModuleAISummaryState(summaryKey, patch = {}) {
    const parsed = parseSummaryKey(summaryKey);
    if (!parsed) return;
    const state = readModuleAISummaries();
    const prev = state[parsed.summaryKey] || {};
    state[parsed.summaryKey] = {
      summaryKey: parsed.summaryKey,
      blockKey: parsed.blockKey,
      moduleKey: parsed.moduleKey,
      moduleLabel: patch.moduleLabel || prev.moduleLabel || '',
      selection: patch.selection != null ? String(patch.selection) : (prev.selection || ''),
      summary: patch.summary != null ? String(patch.summary) : (prev.summary || ''),
      generatedAt: patch.generatedAt != null ? patch.generatedAt : (prev.generatedAt || null)
    };
    writeModuleAISummaries(state);
  }

  function injectModuleAISummaryControls() {
    const state = readModuleAISummaries();

    qsa('.module').forEach((section) => {
      const parentBlock = section.closest('[data-block]');
      const blockKey = parentBlock?.getAttribute('data-block') === 'personal' ? 'personal' : 'business';
      const moduleKey = blockKey === 'personal'
        ? (section.getAttribute('data-personal-section') || '').toString().trim()
        : (section.getAttribute('data-module-section') || '').toString().trim();

      if (!moduleKey) return;

      const summaryKey = `${blockKey}:${moduleKey}`;
      const moduleLabel = getModuleLabelFromSection(section, moduleKey);
      const body = qs('.module-body', section);
      if (!body) return;
      if (qs(`[data-ai-summary-panel="${CSS.escape(summaryKey)}"]`, body)) return;

      const saved = state[summaryKey] || {};
      const panel = document.createElement('div');
      panel.className = 'panel ai-summary-panel';
      panel.setAttribute('data-ai-summary-panel', summaryKey);
      panel.innerHTML = `
        <div class="panel-title">Summary</div>
        <div class="panel-subtitle">Generate module summary, then pick Executive to include in report.</div>
        <textarea class="notes ai-summary-text" rows="3" data-ai-summary-text="${summaryKey}" placeholder="Type summary manually or click Generate Summary"></textarea>
        <div class="panel-actions ai-summary-actions">
          <button class="btn btn-secondary" type="button" data-action="generate-module-summary" data-summary-key="${summaryKey}">Generate Summary</button>
          <label class="select ai-summary-picker">
            <span class="sr-only">Include summary in report</span>
            <select data-ai-summary-picker="${summaryKey}">
              <option value="">Do not add to report</option>
              <option value="executive">Executive (add to report)</option>
            </select>
          </label>
          <span class="muted" data-ai-summary-status="${summaryKey}" style="margin-left:auto;">Ready</span>
        </div>
      `;

      body.appendChild(panel);

      const textEl = qs(`[data-ai-summary-text="${CSS.escape(summaryKey)}"]`, panel);
      if (textEl) {
        textEl.value = String(saved.summary || '');
        // Save manual edits on blur
        textEl.addEventListener('blur', () => {
          const val = textEl.value.trim();
          if (val !== (state[summaryKey]?.summary || '').trim()) {
            upsertModuleAISummaryState(summaryKey, { summary: val, generatedAt: val ? new Date().toISOString() : null });
            updateAISummaryStatus(summaryKey, val ? 'Saved (manual)' : 'Ready');
            persistModuleAISummariesSnapshot();
          }
        });
      }

      const picker = qs(`[data-ai-summary-picker="${CSS.escape(summaryKey)}"]`, panel);
      if (picker) picker.value = String(saved.selection || '');

      const generatedAt = String(saved.generatedAt || '').trim();
      if (generatedAt) {
        const d = new Date(generatedAt);
        updateAISummaryStatus(summaryKey, Number.isFinite(d.getTime()) ? `Generated ${d.toLocaleString('en-IN')}` : 'Generated');
      } else if (String(saved.selection || '').trim().toLowerCase() === 'executive' && String(saved.summary || '').trim()) {
        updateAISummaryStatus(summaryKey, 'Selected for report');
      }

      upsertModuleAISummaryState(summaryKey, {
        moduleLabel,
        selection: saved.selection || '',
        summary: saved.summary || '',
        generatedAt: saved.generatedAt || null
      });
    });
  }

  async function generateModuleAISummary(summaryKey, triggerBtn) {
    const parsed = parseSummaryKey(summaryKey);
    if (!parsed) {
      window.alert('Invalid module summary key.');
      return;
    }

    const sectionSel = parsed.blockKey === 'personal'
      ? `[data-personal-section="${CSS.escape(parsed.moduleKey)}"]`
      : `[data-module-section="${CSS.escape(parsed.moduleKey)}"]`;
    const section = qs(sectionSel);
    const moduleLabel = getModuleLabelFromSection(section, parsed.moduleKey);
    const payload = getModuleDataForAISummary(parsed.blockKey, parsed.moduleKey);

    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      window.alert('Is module ka data abhi available nahi hai. Pehle module data save/fetch karein.');
      return;
    }

    const btn = triggerBtn || qs(`[data-action="generate-module-summary"][data-summary-key="${CSS.escape(parsed.summaryKey)}"]`);
    const outEl = qs(`[data-ai-summary-text="${CSS.escape(parsed.summaryKey)}"]`);
    const prevLabel = btn?.textContent || 'Generate Summary';

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating…';
      }
      updateAISummaryStatus(parsed.summaryKey, 'Generating summary…');

      const res = await fetch('/api/module-ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockKey: parsed.blockKey,
          moduleKey: parsed.moduleKey,
          moduleLabel,
          moduleData: payload
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!json?.success) throw new Error(json?.error || 'Summary generation failed');

      const summary = String(json?.summary || '').trim();
      if (!summary) throw new Error('Empty summary returned.');
      if (outEl) outEl.value = summary;

      const generatedAt = new Date().toISOString();
      upsertModuleAISummaryState(parsed.summaryKey, {
        moduleLabel,
        summary,
        generatedAt
      });

      const d = new Date(generatedAt);
      updateAISummaryStatus(parsed.summaryKey, `Generated ${d.toLocaleString('en-IN')}`);
      await persistModuleAISummariesSnapshot();
    } catch (error) {
      updateAISummaryStatus(parsed.summaryKey, 'Generation failed');
      window.alert(error?.message || 'Summary generation failed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel;
      }
    }
  }

  function setComplianceSummary(data) {
    const rows = [
      { key: 'nclt' },
      { key: 'sebi' },
      { key: 'court' },
      { key: 'exchange' }
    ];

    const values = rows
      .map((r) => (data && typeof data === 'object' ? data[r.key] : null))
      .filter(Boolean);

    const total = values.length;
    const adverse = values.some((v) => String(v?.adverse || v?.isAdverse || '').toLowerCase() === 'yes' || v?.adverse === true);

    const totalEl = qs('[data-summary="compliance.total"]');
    const advEl = qs('[data-summary="compliance.adverse"]');
    if (totalEl) totalEl.textContent = String(total);
    if (advEl) advEl.textContent = adverse ? 'Yes' : 'No';
  }

  function safeText(v) {
    return String(v == null ? '' : v);
  }

  function sourceToComplianceKey(source) {
    const s = safeText(source).trim().toLowerCase();
    if (s.includes('nclt')) return 'nclt';
    if (s.includes('sebi')) return 'sebi';
    if (s.includes('court')) return 'court';
    if (s.includes('nse') || s.includes('bse') || s.includes('exchange')) return 'exchange';
    return '';
  }

  function toResultLine(item) {
    if (!item) return '';
    const rf = safeText(item.risk_flag || '').trim();
    const details = safeText(item.details || item.message || item.result || '').trim();
    const verdict = item.match_found === true ? 'Adverse/Attention' : item.match_found === false ? 'No adverse public record found' : 'Verification error/unknown';
    const parts = [];
    if (rf) parts.push(`Risk: ${rf}`);
    parts.push(`Result: ${verdict}`);
    if (details) parts.push(`Details: ${details}`);
    return parts.join(' • ');
  }

  function normalizeComplianceData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};

    if (data.sections && typeof data.sections === 'object') {
      return data.sections;
    }

    // Already in UI-native format
    if (data.nclt || data.sebi || data.court || data.exchange) return data;

    const findings = Array.isArray(data.findings) ? data.findings : [];
    const grouped = {
      nclt: [],
      sebi: [],
      court: [],
      exchange: []
    };

    findings.forEach((f) => {
      const k = sourceToComplianceKey(f?.source || f?.category || '');
      if (!k) return;
      grouped[k].push(f);
    });

    const makePayload = (arr, title) => {
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const adverse = arr.some((r) => r?.match_found === true);
      const summaryLines = arr.map((r) => toResultLine(r)).filter(Boolean);
      const evidenceLinks = arr
        .flatMap((r) => Array.isArray(r?.evidence?.results) ? r.evidence.results : [])
        .map((ev) => ({ title: safeText(ev?.title || 'Evidence link').trim(), url: safeText(ev?.url || '').trim() }))
        .filter((ev) => /^https?:\/\//i.test(ev.url));

      return {
        title,
        adverse,
        summary: summaryLines.join('\n') || (adverse ? 'Adverse records found' : 'No adverse public record found'),
        evidenceLinks
      };
    };

    const exchangeMerged = [...grouped.exchange];

    const normalized = {
      nclt: makePayload(grouped.nclt, 'NCLT Check'),
      sebi: makePayload(grouped.sebi, 'SEBI Check'),
      court: makePayload(grouped.court, 'Court/Litigation Check'),
      exchange: makePayload(exchangeMerged, 'NSE/BSE Exchange Check')
    };

    if (data?.summary && typeof data.summary === 'object') {
      const total = Number(data.summary.total_checks || 0);
      const adverseCount = Number(data.summary.adverse_records || 0);
      if (!normalized.exchange) {
        normalized.exchange = {
          title: 'NSE/BSE Exchange Check',
          adverse: adverseCount > 0,
          summary: `Checks: ${total}, Adverse records: ${adverseCount}`,
          evidenceLinks: []
        };
      }
    }

    return normalized;
  }

  function renderComplianceEvidence(txt, payload) {
    if (!txt) return;
    txt.textContent = safeText(payload?.summary || '');

    const prev = txt.parentElement ? qs('.compliance-evidence-links', txt.parentElement) : null;
    if (prev) prev.remove();

    const links = Array.isArray(payload?.evidenceLinks) ? payload.evidenceLinks : [];
    const sourceLinks = Array.isArray(payload?.sourceLinks) ? payload.sourceLinks : [];
    const inputUsed = Array.isArray(payload?.inputUsed) ? payload.inputUsed : [];
    if ((!links.length && !sourceLinks.length && !inputUsed.length) || !txt.parentElement) return;

    const wrap = document.createElement('div');
    wrap.className = 'compliance-evidence-links';
    wrap.style.marginTop = '8px';
    wrap.style.display = 'grid';
    wrap.style.gap = '6px';

    if (inputUsed.length) {
      const label = document.createElement('div');
      label.textContent = 'Input Used:';
      label.style.fontWeight = '700';
      label.style.color = '#334155';
      wrap.appendChild(label);

      inputUsed.slice(0, 3).forEach((item) => {
        const row = document.createElement('div');
        const type = safeText(item?.type || 'unknown');
        const cin = safeText(item?.cin || '').trim();
        const name = safeText(item?.company_name || '').trim();
        const note = safeText(item?.note || '').trim();

        const chunks = [`Type: ${type}`];
        if (cin) chunks.push(`CIN: ${cin}`);
        if (name) chunks.push(`Company Name: ${name}`);
        if (note) chunks.push(note);

        row.textContent = chunks.join(' • ');
        row.style.color = '#475569';
        row.style.fontSize = '12px';
        row.style.lineHeight = '1.35';
        wrap.appendChild(row);
      });
    }

    links.slice(0, 5).forEach((ev) => {
      const a = document.createElement('a');
      a.href = ev.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = ev.title || ev.url;
      a.style.color = '#2563eb';
      a.style.textDecoration = 'underline';
      a.style.wordBreak = 'break-word';
      wrap.appendChild(a);
    });

    if (sourceLinks.length) {
      const label = document.createElement('div');
      label.textContent = 'Real Official Sources Used:';
      label.style.marginTop = '4px';
      label.style.fontWeight = '700';
      label.style.color = '#334155';
      wrap.appendChild(label);

      sourceLinks.slice(0, 4).forEach((ev) => {
        const a = document.createElement('a');
        a.href = ev.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ev.title || ev.url;
        a.style.color = '#0f766e';
        a.style.textDecoration = 'underline';
        a.style.wordBreak = 'break-word';
        wrap.appendChild(a);
      });
    }

    txt.parentElement.appendChild(wrap);
  }

  function getComplianceIdentifier() {
    const mcaStored = safeJSONParse(STORAGE.getItem(storageKey('integration.mcaData')), null);
    const mcaRaw = mcaStored?.raw || {};

    // Also read GST integration storage (critical for proprietors who have no MCA)
    const gstStored = safeJSONParse(STORAGE.getItem(storageKey('integration.gstData')), null);
    const gstRaw = gstStored?.raw || {};
    const gstData = gstStored?.data || gstRaw?.data || gstStored || gstRaw || {};
    const gstGstin = (gstStored?.gstin || gstData?.gstin || gstData?.gstIn || gstData?.gstinNo || gstData?.gstin_number || '').toString().trim();
    const gstLegalName = (gstData?.lgnm || gstData?.legal_name || gstData?.legalName || gstStored?.legalName || '').toString().trim();
    const gstTradeName = (gstData?.tradeNam || gstData?.trade_name || gstData?.tradeName || gstStored?.tradeName || '').toString().trim();

    const candidates = [
      mcaRaw?.cin,
      mcaStored?.cin,
      q.cin,
      mcaRaw?.companyName,
      mcaStored?.companyName,
      gstLegalName,
      gstTradeName,
      gstGstin,
      q.gstin,
      q.businessName
    ]
      .map((v) => safeText(v).trim())
      .filter(Boolean);

    return candidates[0] || '';
  }

  function showComplianceResults(data) {
    const container = qs('#complianceResults');
    if (!container) return;
    container.style.display = 'block';

    const normalized = normalizeComplianceData(data);

    const show = (id, key) => {
      const box = qs(id);
      const txt = qs(`[data-result="${key}"]`);
      const payload = normalized?.[key];
      if (!box || !txt) return;
      if (!payload) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      renderComplianceEvidence(txt, payload);
    };

    show('#ncltResult', 'nclt');
    show('#sebiResult', 'sebi');
    show('#courtResult', 'court');
    show('#exchangeResult', 'exchange');

    setComplianceSummary(normalized);
  }

  async function runComplianceCheck() {
    const identifier = getComplianceIdentifier();
    if (!identifier) {
      window.alert('Company name / CIN / GSTIN is required.');
      return;
    }

    const btn = qs('[data-action="run-compliance"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Running…';
    }

    try {
      const res = await fetch('/api/check-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIdentifier: identifier })
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error || 'Compliance check failed');

      const data = json.data || {};
      const normalized = normalizeComplianceData(data);
      STORAGE.setItem(
        storageKey('integration.complianceData'),
        JSON.stringify({
          source: 'case-workspace',
          fetchedAt: new Date().toISOString(),
          companyIdentifier: identifier,
          raw: data,
          normalized
        })
      );
      setLastUpdatedNow();
      if (HAS_CASE_ID) saveSnapshotToServer('compliance', JSON.stringify({ source: 'case-workspace', fetchedAt: new Date().toISOString(), companyIdentifier: identifier, raw: data, normalized })).catch(() => {});
      showComplianceResults(normalized);
    } catch (e) {
      window.alert(e?.message || 'Compliance check failed');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Run Automated Compliance Check';
      }
    }
  }

  function markCompleted(moduleKey) {
    const current = readModuleStatuses();
    const next = { ...current, [moduleKey]: STATUS.completed };
    const written = writeModuleStatuses(next);
    updateUIFromStatuses(written);
    renderReportBuilderPreview();
  }

  /* ════════════════════════════════════════════════════════════════
     CASE OVERVIEW BLOCK — Save / Load
     ════════════════════════════════════════════════════════════════ */
  const CO_FIELDS = [
    'entityName', 'businessActivity', 'operationStatus', 'unitLocationLabel', 'unitLocation',
    'pastYearTurnover', 'turnoverFY', 'bankReference', 'incorporationDate', 'reportDate'
  ];

  // ─── Additional Details Module (Business Block) ───
  const AD_FIELDS = [
    'leiCode', 'natureOfActivity', 'msmeCategory', 'investmentPlantMachinery', 'turnoverAuditedBS',
    'industry', 'branchOffices', 'contactNo', 'emailId', 'website',
    'projectDescription', 'projectLocation', 'keyRegulatoryApprovals',
    'majorBrands', 'auditorName', 'existingBankers', 'totalEmployees',
    'totalIncomeFY', 'promoters', 'wilfulDefaulterStatus', 'externalRatingDetails',
    'epfDefaulterStatus',
    'groupCompanyName', 'groupCompanyDOI', 'groupCompanyRegOffice',
    'groupCompanyNature', 'groupCompanyFY', 'groupCompanyTotalIncome',
    'groupCompanyNetProfit', 'groupCompanyNetWorth', 'groupCompanyTotalDebt',
    'groupCompanyComments', 'organizationStructure',
    'bpBusinessAge', 'bpNatureOfBusinessActivity', 'bpIndustrySegment',
    'bpProductsServices', 'bpRegisteredOfficeLocation', 'bpAreaOfOffice', 'bpAreaOfOfficeUnit', 'bpOwnershipOfOffice',
    'bpEmployeesAtLocation', 'bpLocationAdvantage', 'bpMarketingSetup', 'bpComments',
    'baKeyRawMaterials', 'baRawMaterialPriceFluctuation', 'baQualityCertification', 'baLevelOfValueAddition', 'baComments',
    'ssAvgCreditorDays', 'ssRawMaterialAvailability', 'ssImportAsPercentOfRM',
    'svProjectLocation', 'svSitesVisited', 'svStatusOfOperation', 'svAreaOfUnit', 'svEmployeesAtSite',
    'svPlantMachinery', 'svOwnershipOfPremises', 'svOtherFacilities', 'svAccessibilityToTransport',
    'svLandForExpansion', 'svSiteLayout', 'svInsuranceCoverage', 'svSourceOfPower', 'svAdequacyOfPower',
    'svSourceOfWater', 'svTypeOfFuel', 'svLabourUnion', 'svIndustrialRelations', 'svWorkSafety',
    'svStorageFacilities', 'svOperationalStatusPlant', 'svSiteVisitComment',
    'svVendorName', 'svVendorContactPerson', 'svVendorContactDetails', 'svVendorComments'
  ];

  function getAdditionalDetailsData() {
    const data = {};
    AD_FIELDS.forEach(function(name) {
      const el = document.getElementById('ad_' + name);
      if (el) {
        const val = (el.value || '').trim();
        if (name === 'promoters') {
          data[name] = val ? val.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
        } else {
          data[name] = val;
        }
      }
    });
    // Promoter details table
    data.promoterDetails = getPromoterTableData();
    // Promoter comments
    const pcEl = document.getElementById('ad_promoterComments');
    if (pcEl) data.promoterComments = (pcEl.value || '').trim();
    // Management details table
    data.managementDetails = getManagementTableData();
    // Business entity summary
    const besEl = document.getElementById('ad_businessEntitySummary');
    if (besEl) data.businessEntitySummary = (besEl.value || '').trim();
    // Board of Directors table
    data.bodDetails = getBODTableData();
    // BOD comments
    const bodCEl = document.getElementById('ad_bodComments');
    if (bodCEl) data.bodComments = (bodCEl.value || '').trim();
    // Ownership structure table
    data.ownershipDetails = getOwnershipTableData();
    // Certification details table
    data.certificationDetails = getCertificationTableData();
    // Statutory taxation & filing table
    data.statutoryTaxDetails = getStatutoryTaxTableData();
    // Machinery details table
    data.machineryDetails = getMachineryTableData();
    return data;
  }

  function setAdditionalDetailsData(data) {
    if (!data || typeof data !== 'object') return;
    AD_FIELDS.forEach(function(name) {
      const el = document.getElementById('ad_' + name);
      if (el && data[name] != null) {
        if (name === 'promoters' && Array.isArray(data[name])) {
          el.value = data[name].join(', ');
        } else {
          el.value = data[name];
        }
      }
    });
    // Restore promoter details table
    if (Array.isArray(data.promoterDetails) && data.promoterDetails.length) {
      setPromoterTableData(data.promoterDetails);
    }
    // Restore promoter comments
    const pcEl = document.getElementById('ad_promoterComments');
    if (pcEl && data.promoterComments) pcEl.value = data.promoterComments;
    // Restore management details table
    if (Array.isArray(data.managementDetails) && data.managementDetails.length) {
      setManagementTableData(data.managementDetails);
    }
    // Restore business entity summary
    const besEl = document.getElementById('ad_businessEntitySummary');
    if (besEl && data.businessEntitySummary) besEl.value = data.businessEntitySummary;
    // Restore BOD table
    if (Array.isArray(data.bodDetails) && data.bodDetails.length) {
      setBODTableData(data.bodDetails);
    }
    // Restore BOD comments
    const bodCEl = document.getElementById('ad_bodComments');
    if (bodCEl && data.bodComments) bodCEl.value = data.bodComments;
    // Restore ownership table
    if (Array.isArray(data.ownershipDetails) && data.ownershipDetails.length) {
      setOwnershipTableData(data.ownershipDetails);
    }
    // Restore certification table
    if (Array.isArray(data.certificationDetails) && data.certificationDetails.length) {
      setCertificationTableData(data.certificationDetails);
    }
    // Restore statutory tax table
    if (Array.isArray(data.statutoryTaxDetails) && data.statutoryTaxDetails.length) {
      setStatutoryTaxTableData(data.statutoryTaxDetails);
    }
    // Restore machinery table
    if (Array.isArray(data.machineryDetails) && data.machineryDetails.length) {
      setMachineryTableData(data.machineryDetails);
    }
  }

  // ─── Promoter & Management Dynamic Table Helpers ───
  const PROMOTER_COLS = ['name', 'age', 'designation', 'education', 'experience', 'yearsWithCompany', 'panDin', 'role', 'wilfulDefaulter', 'litigations'];
  const MGMT_COLS = ['name', 'age', 'designation', 'pan', 'education', 'experience', 'dateOfAppointment'];
  const BOD_COLS = ['name', 'age', 'position', 'education', 'totalExperience', 'appointmentYears', 'pastExperience', 'otherDirectorships'];
  const OWNERSHIP_COLS = ['promoterName', 'shareholding'];
  const CERTIFICATION_COLS = ['certName', 'certNumber', 'validityPeriod'];
  const STATUTORY_TAX_COLS = ['name', 'observation'];
  const MACHINERY_COLS = ['machineryName', 'yearOfPurchase', 'valueAsOnDate'];

  function createPromoterRow(vals) {
    vals = vals || {};
    const tr = document.createElement('tr');
    PROMOTER_COLS.forEach(function(col) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'promoter_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function createManagementRow(vals) {
    vals = vals || {};
    const tr = document.createElement('tr');
    MGMT_COLS.forEach(function(col) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'mgmt_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function getPromoterTableData() {
    const tbody = document.getElementById('promoterTableBody');
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      const row = {};
      let hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        const col = inp.dataset.col;
        const val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function getManagementTableData() {
    const tbody = document.getElementById('managementTableBody');
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      const row = {};
      let hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        const col = inp.dataset.col;
        const val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setPromoterTableData(arr) {
    const tbody = document.getElementById('promoterTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createPromoterRow(item)); });
  }

  function setManagementTableData(arr) {
    const tbody = document.getElementById('managementTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createManagementRow(item)); });
  }

  // ─── Board of Directors (BOD) table helpers ───
  function createBODRow(vals) {
    vals = vals || {};
    const tr = document.createElement('tr');
    BOD_COLS.forEach(function(col) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'bod_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function getBODTableData() {
    const tbody = document.getElementById('bodTableBody');
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      const row = {};
      let hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        const col = inp.dataset.col;
        const val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setBODTableData(arr) {
    const tbody = document.getElementById('bodTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createBODRow(item)); });
  }

  // ─── Ownership Structure table helpers ───
  function createOwnershipRow(vals) {
    vals = vals || {};
    const tr = document.createElement('tr');
    OWNERSHIP_COLS.forEach(function(col) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'own_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '✕';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function getOwnershipTableData() {
    const tbody = document.getElementById('ownershipTableBody');
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      const row = {};
      let hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        const col = inp.dataset.col;
        const val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setOwnershipTableData(arr) {
    const tbody = document.getElementById('ownershipTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createOwnershipRow(item)); });
  }

  function extractShareholdersFromMca() {
    const mcaIntegration = readIntegrationObject('mcaData');
    const mcaRaw = mcaIntegration?.raw || null;
    const mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRaw, ['data']) || mcaIntegration || mcaRaw || {};
    const findShareholders = (obj, depth) => {
      if (!obj || depth > 4) return [];
      if (Array.isArray(obj)) {
        const hasSh = obj.some(item => item && typeof item === 'object' && (item.shareholding || item.stake || item.percentage || item.sharePercentage));
        if (hasSh) return obj;
      }
      if (typeof obj === 'object' && !Array.isArray(obj)) {
        for (const key of ['shareholders', 'shareholding', 'promoters', 'ownership', 'shareholdingPattern', 'charges']) {
          if (Array.isArray(obj[key]) && obj[key].length) {
            const hasSh = obj[key].some(item => item && typeof item === 'object' && (item.shareholding || item.stake || item.percentage || item.sharePercentage || item.name));
            if (hasSh) return obj[key];
          }
        }
        for (const v of Object.values(obj)) {
          const found = findShareholders(v, depth + 1);
          if (found.length) return found;
        }
      }
      return [];
    };
    return findShareholders(mcaData, 0).map(function(s) {
      const name = (s.name || s.shareholderName || s.promoterName || '').toString().trim();
      const pct = (s.shareholding || s.stake || s.percentage || s.sharePercentage || '').toString().trim();
      if (!name) return null;
      return { promoterName: name, shareholding: pct };
    }).filter(Boolean);
  }

  function autoFillBODTable() {
    const tbody = document.getElementById('bodTableBody');
    if (!tbody) return;
    const dirs = extractFullDirectorsFromMca();
    const existingRows = getBODTableData();
    if (existingRows.length) return;

    if (dirs.length === 0) {
      tbody.appendChild(createBODRow());
      return;
    }
    dirs.forEach(function(d) {
      const row = { name: d.name, _autoSource: { name: true } };
      if (d.designation) { row.position = d.designation; row._autoSource.position = true; }
      if (d.dateOfAppointment) { row.appointmentYears = d.dateOfAppointment; row._autoSource.appointmentYears = true; }
      tbody.appendChild(createBODRow(row));
    });
  }

  function autoFillOwnershipTable() {
    const tbody = document.getElementById('ownershipTableBody');
    if (!tbody) return;
    const existingRows = getOwnershipTableData();
    if (existingRows.length) return;

    const shareholders = extractShareholdersFromMca();
    if (shareholders.length === 0) {
      // Fallback: use promoter names from personalInfo
      const piRaw = STORAGE.getItem(storageKey('personalInfo'));
      const personalInfo = safeJSONParse(piRaw, {});
      const promoterNames = Array.isArray(personalInfo?.promoters)
        ? personalInfo.promoters.map(pr => (typeof pr === 'string' ? pr : (pr?.name || '')).trim()).filter(Boolean)
        : [];
      if (promoterNames.length) {
        promoterNames.forEach(function(n) {
          tbody.appendChild(createOwnershipRow({ promoterName: n, _autoSource: { promoterName: true } }));
        });
      } else {
        tbody.appendChild(createOwnershipRow());
      }
      return;
    }
    shareholders.forEach(function(s) {
      const row = { promoterName: s.promoterName, shareholding: s.shareholding, _autoSource: { promoterName: true } };
      if (s.shareholding) row._autoSource.shareholding = true;
      tbody.appendChild(createOwnershipRow(row));
    });
  }

  function extractFullDirectorsFromMca() {
    const mcaIntegration = readIntegrationObject('mcaData');
    const mcaRaw = mcaIntegration?.raw || null;
    const mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRaw, ['data']) || mcaIntegration || mcaRaw || {};
    const findDirectors = (obj, depth) => {
      if (!obj || depth > 4) return [];
      if (Array.isArray(obj)) {
        const hasDir = obj.some(item => item && typeof item === 'object' && (item.name || item.directorName || item.director_name));
        if (hasDir) return obj;
      }
      if (typeof obj === 'object' && !Array.isArray(obj)) {
        for (const key of ['directors', 'Directors', 'directorList', 'director_list']) {
          if (Array.isArray(obj[key]) && obj[key].length) return obj[key];
        }
        for (const v of Object.values(obj)) {
          const found = findDirectors(v, depth + 1);
          if (found.length) return found;
        }
      }
      return [];
    };
    return findDirectors(mcaData, 0).map(function(d) {
      const name = (d.name || d.directorName || d.director_name || '').toString().trim();
      const din = (d.din || d.DIN || d.dinNumber || d.din_number || '').toString().trim();
      const designation = (d.designation || d.role || d.type || '').toString().trim();
      const dateOfAppointment = (d.dateOfAppointment || d.date_of_appointment || d.appointmentDate || d.appointment_date || '').toString().trim();
      if (!name) return null;
      return { name: name, din: din, designation: designation, dateOfAppointment: dateOfAppointment };
    }).filter(Boolean);
  }

  function autoFillPromoterTable() {
    const tbody = document.getElementById('promoterTableBody');
    if (!tbody) return;
    const dirs = extractFullDirectorsFromMca();
    // Get promoter names from personalInfo
    const piRaw = STORAGE.getItem(storageKey('personalInfo'));
    const personalInfo = safeJSONParse(piRaw, {});
    const promoterNames = Array.isArray(personalInfo?.promoters)
      ? personalInfo.promoters.map(pr => (typeof pr === 'string' ? pr : (pr?.name || '')).trim()).filter(Boolean)
      : [];
    // Also get from the promoters textarea
    const adPromoterEl = document.getElementById('ad_promoters');
    const adPromoterNames = adPromoterEl ? (adPromoterEl.value || '').split(',').map(s => s.trim()).filter(Boolean) : [];

    // Combine names (unique)
    const allNames = [...new Set([...promoterNames, ...adPromoterNames])];

    // Map promoters: match against MCA directors for additional data
    const existingRows = getPromoterTableData();
    if (existingRows.length) return; // Don't overwrite existing data

    const rows = [];
    allNames.forEach(function(pName) {
      const matchDir = dirs.find(d => d.name.toUpperCase() === pName.toUpperCase());
      const row = { name: pName, _autoSource: { name: true } };
      if (matchDir) {
        if (matchDir.din) { row.panDin = 'DIN: ' + matchDir.din; row._autoSource.panDin = true; }
        if (matchDir.designation) { row.designation = matchDir.designation; row._autoSource.designation = true; }
      }
      rows.push(row);
    });
    // Add any directors not already in promoter names
    dirs.forEach(function(d) {
      const alreadyAdded = rows.some(r => r.name.toUpperCase() === d.name.toUpperCase());
      if (!alreadyAdded) {
        const row = { name: d.name, _autoSource: { name: true } };
        if (d.din) { row.panDin = 'DIN: ' + d.din; row._autoSource.panDin = true; }
        if (d.designation) { row.designation = d.designation; row._autoSource.designation = true; }
        rows.push(row);
      }
    });

    if (rows.length === 0) {
      // Add one empty row
      tbody.appendChild(createPromoterRow());
    } else {
      rows.forEach(function(r) { tbody.appendChild(createPromoterRow(r)); });
    }
  }

  function autoFillManagementTable() {
    const tbody = document.getElementById('managementTableBody');
    if (!tbody) return;
    const dirs = extractFullDirectorsFromMca();
    const existingRows = getManagementTableData();
    if (existingRows.length) return; // Don't overwrite existing data

    if (dirs.length === 0) {
      tbody.appendChild(createManagementRow());
      return;
    }
    dirs.forEach(function(d) {
      const row = { name: d.name, _autoSource: { name: true } };
      if (d.designation) { row.designation = d.designation; row._autoSource.designation = true; }
      if (d.din) { row.pan = 'DIN: ' + d.din; row._autoSource.pan = true; }
      if (d.dateOfAppointment) { row.dateOfAppointment = d.dateOfAppointment; row._autoSource.dateOfAppointment = true; }
      tbody.appendChild(createManagementRow(row));
    });
  }

  // ─── Certification Table Helpers ───
  function createCertificationRow(vals) {
    vals = vals || {};
    const tr = document.createElement('tr');
    CERTIFICATION_COLS.forEach(function(col) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'cert_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '\u2715';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  // ─── Machinery Table Helpers ───
  function createMachineryRow(vals) {
    vals = vals || {};
    var tr = document.createElement('tr');
    MACHINERY_COLS.forEach(function(col) {
      var td = document.createElement('td');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.name = 'machinery_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      inp.style.width = '100%';
      inp.style.fontSize = '11px';
      inp.style.padding = '4px 6px';
      inp.style.border = '1px solid var(--border,#e5e7eb)';
      inp.style.borderRadius = '4px';
      td.style.padding = '4px 6px';
      td.appendChild(inp);
      tr.appendChild(td);
    });
    var tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    var btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '\u2715';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function getMachineryTableData() {
    var tbody = document.getElementById('machineryTableBody');
    if (!tbody) return [];
    var rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var row = {};
      var hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        var col = inp.dataset.col;
        var val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setMachineryTableData(arr) {
    var tbody = document.getElementById('machineryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createMachineryRow(item)); });
  }

  function getCertificationTableData() {
    var tbody = document.getElementById('certificationTableBody');
    if (!tbody) return [];
    var rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var row = {};
      var hasData = false;
      tr.querySelectorAll('input').forEach(function(inp) {
        var col = inp.dataset.col;
        var val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setCertificationTableData(arr) {
    var tbody = document.getElementById('certificationTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createCertificationRow(item)); });
  }

  function autoFillCertifications() {
    var tbody = document.getElementById('certificationTableBody');
    if (!tbody) return;
    var existingRows = getCertificationTableData();
    if (existingRows.length) return; // don't overwrite

    var certs = [];
    // From Udyam
    var udyamIntegration = readIntegrationObject('udyamData');
    var udyamRaw = udyamIntegration && udyamIntegration.raw ? udyamIntegration.raw : null;
    var udyamData = firstNonEmpty(udyamIntegration, ['data']) || firstNonEmpty(udyamRaw, ['data']) || udyamIntegration || udyamRaw || {};
    var udyamNum = udyamData.udyam_number || udyamData.udyamRegistrationNumber || udyamData.registration_number || '';
    if (udyamNum) certs.push({ certName: 'UDYAM ADHAR', certNumber: udyamNum, validityPeriod: '-', _autoSource: { certName: true, certNumber: true } });

    // From GST
    var gstIntegration = readIntegrationObject('gstData');
    var gstRaw = gstIntegration && gstIntegration.raw ? gstIntegration.raw : null;
    var gstData = firstNonEmpty(gstIntegration, ['data']) || firstNonEmpty(gstRaw, ['data']) || gstIntegration || gstRaw || {};
    var gstNum = gstData.gstin || gstData.GSTIN || '';
    if (gstNum) certs.push({ certName: 'GST CERTIFICATE', certNumber: gstNum, validityPeriod: '-', _autoSource: { certName: true, certNumber: true } });

    // From MCA (Incorporation Certificate)
    var mcaIntegration = readIntegrationObject('mcaData');
    var mcaRawC = mcaIntegration && mcaIntegration.raw ? mcaIntegration.raw : null;
    var mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRawC, ['data']) || mcaIntegration || mcaRawC || {};
    var cinNum = mcaData.cin || mcaData.CIN || mcaData.llpin || '';
    if (cinNum) certs.push({ certName: 'INCORPORATION CERTIFICATE', certNumber: cinNum, validityPeriod: '-', _autoSource: { certName: true, certNumber: true } });

    if (certs.length === 0) {
      tbody.appendChild(createCertificationRow());
      return;
    }
    certs.forEach(function(c) { tbody.appendChild(createCertificationRow(c)); });
  }

  // ─── Statutory Taxation & Filing Verification Table Helpers ───
  function createStatutoryTaxRow(vals) {
    vals = vals || {};
    var tr = document.createElement('tr');
    STATUTORY_TAX_COLS.forEach(function(col) {
      var td = document.createElement('td');
      var inp = col === 'observation' ? document.createElement('textarea') : document.createElement('input');
      if (col === 'observation') {
        inp.rows = 2;
        inp.style.width = '100%';
        inp.style.resize = 'vertical';
        inp.style.fontSize = '11px';
      } else {
        inp.type = 'text';
      }
      inp.name = 'stax_' + col;
      inp.dataset.col = col;
      inp.value = vals[col] || '';
      inp.autocomplete = 'off';
      if (vals[col] && vals._autoSource && vals._autoSource[col]) inp.classList.add('autofilled');
      td.appendChild(inp);
      tr.appendChild(td);
    });
    var tdDel = document.createElement('td');
    tdDel.style.textAlign = 'center';
    var btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-remove-row';
    btnDel.textContent = '\u2715';
    btnDel.title = 'Remove row';
    btnDel.addEventListener('click', function() { tr.remove(); });
    tdDel.appendChild(btnDel);
    tr.appendChild(tdDel);
    return tr;
  }

  function getStatutoryTaxTableData() {
    var tbody = document.getElementById('statutoryTaxTableBody');
    if (!tbody) return [];
    var rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var row = {};
      var hasData = false;
      tr.querySelectorAll('input, textarea').forEach(function(inp) {
        var col = inp.dataset.col;
        var val = (inp.value || '').trim();
        if (col) { row[col] = val; if (val) hasData = true; }
      });
      if (hasData) rows.push(row);
    });
    return rows;
  }

  function setStatutoryTaxTableData(arr) {
    var tbody = document.getElementById('statutoryTaxTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    arr.forEach(function(item) { tbody.appendChild(createStatutoryTaxRow(item)); });
  }

  function autoFillStatutoryTax() {
    var tbody = document.getElementById('statutoryTaxTableBody');
    if (!tbody) return;
    var existingRows = getStatutoryTaxTableData();
    if (existingRows.length) return; // don't overwrite

    var taxRows = [];

    // EPFO row (manual — always show as placeholder)
    taxRows.push({ name: 'EPFO', observation: 'OBSERVED', _autoSource: { name: true } });

    // GST filing status from gstData
    var gstInteg = readIntegrationObject('gstData');
    var gstRawD = gstInteg && gstInteg.raw ? gstInteg.raw : null;
    var gstD = firstNonEmpty(gstInteg, ['data']) || firstNonEmpty(gstRawD, ['data']) || gstInteg || gstRawD || {};
    // Try to extract latest GSTR3B filing info
    var filingRows = gstD.filingStatus || gstD.filing_status || gstD.filings || [];
    if (Array.isArray(filingRows) && filingRows.length) {
      var gstr3bFilings = filingRows.filter(function(f) { return (f.rtntype || f.return_type || f.returnType || '').toString().toUpperCase().includes('GSTR3B'); });
      if (gstr3bFilings.length) {
        var latest = gstr3bFilings[0];
        var period = latest.taxp || latest.tax_period || latest.period || latest.month || '';
        var fy = latest.fy || latest.financial_year || '';
        var dof = latest.dof || latest.filed_on || latest.date_of_filing || '';
        var status = latest.status || 'Filed';
        var obs = 'GSTR3B' + (fy ? '-' + fy : '') + (period ? '-' + period : '') + (dof ? '-' + dof : '') + '-' + status;
        taxRows.push({ name: 'GST', observation: obs, _autoSource: { name: true, observation: true } });
      } else {
        taxRows.push({ name: 'GST', observation: '', _autoSource: { name: true } });
      }
    } else {
      taxRows.push({ name: 'GST', observation: '', _autoSource: { name: true } });
    }

    taxRows.forEach(function(r) { tbody.appendChild(createStatutoryTaxRow(r)); });
  }

  function saveAdditionalDetailsToStorage() {
    // Block save if still loading from server — prevents saving blank/stale form
    if (_adLoadingCounter > 0 || !_adDataLoadedOnce) return;
    const data = getAdditionalDetailsData();
    _adDataLoadedOnce = true; // user or system confirmed form state — safe to persist
    try {
      STORAGE.setItem(storageKey('additional_details'), JSON.stringify(data));
    } catch (e) { /* ignore */ }
    saveAdditionalDetailsToServer(data);
  }

  function loadAdditionalDetailsFromStorage() {
    _adBeginLoading();
    // First try localStorage (instant — already populated by loadSnapshots if coming from refresh)
    const cachedRaw = STORAGE.getItem(storageKey('additional_details'));
    const cachedData = safeJSONParse(cachedRaw, null);
    if (cachedData && typeof cachedData === 'object' && Object.keys(cachedData).length) {
      setAdditionalDetailsData(cachedData);
      _adDataLoadedOnce = true;
    }
    // Then fetch from server (source of truth) — will overwrite localStorage cache if newer
    loadAdditionalDetailsFromServer().then(function(serverData) {
      if (serverData && typeof serverData === 'object' && Object.keys(serverData).length) {
        setAdditionalDetailsData(serverData);
        _adDataLoadedOnce = true;
        try { STORAGE.setItem(storageKey('additional_details'), JSON.stringify(serverData)); } catch(e) {}
      } else if (!cachedData) {
        // No server data AND no cached data — nothing to restore
      }
    }).catch(function() {
      // Server fetch failed — cached data (if any) is already applied above
    }).finally(function() {
      // Loading complete — allow saves even if no prior data was found on server/cache
      _adDataLoadedOnce = true;
      _adEndLoading();
    });
  }

  function saveAdditionalDetailsToServer(data) {
    if (!RAW_CASE_ID) return Promise.resolve();
    return saveSnapshotToServer('additional_details', JSON.stringify(data)).catch(function() {});
  }

  function loadAdditionalDetailsFromServer() {
    if (!RAW_CASE_ID) return Promise.resolve(null);
    return fetch('/api/case/' + encodeURIComponent(RAW_CASE_ID) + '/snapshot/additional_details')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(json) {
        if (!json || !json.success) return null;
        var d = json.data;
        if (d && typeof d === 'object' && d.data && typeof d.data === 'object') return d.data;
        if (d && typeof d === 'object') return d;
        return null;
      })
      .catch(function() { return null; });
  }

  // ─── Auto-fill Company Snapshot fields from MCA/GST/Compliance data ───
  function autoFillSnapshotFromModules() {
    const mcaIntegration = readIntegrationObject('mcaData');
    const mcaRaw = mcaIntegration?.raw || null;
    const mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRaw, ['data']) || mcaIntegration || mcaRaw || {};

    const gstIntegration = readIntegrationObject('gstData');
    const gstRaw = gstIntegration?.raw || null;
    const gstData = firstNonEmpty(gstIntegration, ['data']) || firstNonEmpty(gstRaw, ['data']) || gstIntegration || gstRaw || {};

    const compIntegration = readIntegrationObject('complianceData');
    const compData = compIntegration?.raw || compIntegration?.normalized || compIntegration || {};

    // Extract directors from MCA
    const findDirs = (obj, depth) => {
      if (!obj || depth > 4) return [];
      if (Array.isArray(obj)) {
        const hasDir = obj.some(item => item && typeof item === 'object' && (item.name || item.directorName || item.director_name));
        if (hasDir) return obj;
      }
      if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          if (/director/i.test(key)) {
            const result = findDirs(obj[key], depth + 1);
            if (result.length) return result;
          }
        }
        for (const key of Object.keys(obj)) {
          if (!(/director/i.test(key))) {
            const result = findDirs(obj[key], depth + 1);
            if (result.length) return result;
          }
        }
      }
      return [];
    };
    const dirs = findDirs(mcaData, 0);
    const dirNames = dirs.map(d => (d.name || d.directorName || d.director_name || '').trim()).filter(Boolean);

    // Extract listing status from MCA
    const listedStatus = mcaData.listedOnStockExchange || mcaData.listed_on_stock_exchange || mcaData.listingStatus || '';
    const ncltFromMca = listedStatus ? (listedStatus.toLowerCase().includes('not') ? 'NOT LISTED' : listedStatus) : '';

    // Extract revenue / total income from MCA
    const mcaRevenue = mcaData.revenue || mcaData.totalRevenue || mcaData.total_revenue || '';

    // Extract registered address as project location
    const mcaAddress = mcaData.registeredAddress || mcaData.registered_address || mcaData.address || gstData.registeredAddress || gstData.pradr || '';
    const resolvedAddress = typeof mcaAddress === 'object' ? (mcaAddress.addr || mcaAddress.full || JSON.stringify(mcaAddress)) : (mcaAddress || '');

    // Extract number of members as approx employees
    const mcaMembers = mcaData.numberOfMembers || mcaData.number_of_members || '';

    // Build auto-fill map: { fieldName: { value, source } }
    const autoMap = {};

    if (resolvedAddress && resolvedAddress !== 'N/A') autoMap.projectLocation = { value: resolvedAddress, source: 'MCA' };
    if (mcaRevenue && mcaRevenue !== 'N/A') autoMap.totalIncomeFY = { value: mcaRevenue, source: 'MCA' };
    if (mcaMembers && mcaMembers !== 'N/A') autoMap.totalEmployees = { value: String(mcaMembers), source: 'MCA' };

    // Auto-build key regulatory approvals from available modules
    const regItems = [];
    if (gstData.gstin || gstData.gstIn || gstIntegration?.gstin) regItems.push('GST CERTIFICATE');
    const udyamIntegration = readIntegrationObject('udyamData');
    const udyamData = udyamIntegration?.data || udyamIntegration || {};
    if (udyamData.udyam_number || udyamData.udyamNumber) regItems.push('UDYAM REGISTRATION');
    if (mcaData.cin || mcaData.CIN || mcaIntegration?.cin) regItems.push('INCORPORATION CERTIFICATE');
    if (regItems.length) autoMap.keyRegulatoryApprovals = { value: regItems.join(', '), source: 'AUTO' };

    // Apply auto-fill — only if the field is currently empty
    const autoFillSources = {}; // track which fields were auto-filled
    Object.entries(autoMap).forEach(([fieldName, info]) => {
      const el = document.getElementById('ad_' + fieldName);
      if (el && !(el.value || '').trim()) {
        el.value = info.value;
        el.classList.add('autofilled');
        autoFillSources[fieldName] = info.source;
      } else if (el && (el.value || '').trim()) {
        // Already has data (manual or previously saved)
        autoFillSources[fieldName] = 'SAVED';
      }
    });

    // Store auto-fill sources for UI
    window._adAutoFillSources = autoFillSources;
    return autoMap;
  }

  // Update tick indicators based on field values
  function updateSnapshotTickIndicators() {
    const SNAPSHOT_FIELDS = [
      'projectDescription', 'projectLocation', 'keyRegulatoryApprovals',
      'majorBrands', 'auditorName', 'existingBankers', 'totalEmployees',
      'totalIncomeFY', 'promoters', 'wilfulDefaulterStatus', 'externalRatingDetails',
      'epfDefaulterStatus'
    ];

    let filled = 0;
    let total = SNAPSHOT_FIELDS.length;
    const sources = window._adAutoFillSources || {};

    SNAPSHOT_FIELDS.forEach(function(name) {
      const el = document.getElementById('ad_' + name);
      const tick = document.querySelector('[data-tick="' + name + '"]');
      const hasValue = el && (el.value || '').trim();

      if (tick) {
        if (hasValue) {
          tick.classList.remove('empty');
          tick.textContent = '\u2713';
          filled++;
          // Show source tag in label row
          const existingTag = tick.parentElement?.querySelector('.field-source-tag, .field-manual-tag');
          if (existingTag) existingTag.remove();
          const src = sources[name];
          if (src && src !== 'SAVED') {
            const tag = document.createElement('span');
            tag.className = 'field-source-tag';
            tag.textContent = src;
            tick.parentElement.insertBefore(tag, tick);
          } else if (hasValue) {
            const tag = document.createElement('span');
            tag.className = 'field-manual-tag';
            tag.textContent = 'EXECUTIVE';
            tick.parentElement.insertBefore(tag, tick);
          }
        } else {
          tick.classList.add('empty');
          tick.textContent = '—';
          const existingTag = tick.parentElement?.querySelector('.field-source-tag, .field-manual-tag');
          if (existingTag) existingTag.remove();
        }
      }
    });

    // Update summary
    const summaryEl = document.getElementById('adAutoFillSummary');
    if (summaryEl) {
      const autoCount = Object.values(sources).filter(s => s && s !== 'SAVED').length;
      summaryEl.innerHTML = '<span style="color:var(--completed)">' + filled + '/' + total + ' filled</span>' +
        (autoCount ? ' &nbsp;·&nbsp; <span style="color:var(--completed)">' + autoCount + ' auto-filled from MCA/GST</span>' : '') +
        (filled < total ? ' &nbsp;·&nbsp; <span style="color:var(--warn)">' + (total - filled) + ' remaining</span>' : '');
    }
  }

  function bindAdditionalDetailsEvents() {
    const btn = document.getElementById('btnSaveAdditionalDetails');
    if (btn) {
      btn.addEventListener('click', function() {
        saveAdditionalDetailsToStorage();
        const statusEl = document.getElementById('adSaveStatus');
        btn.textContent = 'Saved ✓';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        if (statusEl) statusEl.textContent = 'Saved to server';
        updateSnapshotTickIndicators();
        setTimeout(function() {
          btn.textContent = 'Save';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
          if (statusEl) statusEl.textContent = '';
        }, 1800);
      });
    }

    // Auto-fill button
    const autoBtn = document.getElementById('btnAutoFillFromMCA');
    if (autoBtn) {
      autoBtn.addEventListener('click', function() {
        autoFillSnapshotFromModules();
        updateSnapshotTickIndicators();
      });
    }

    // Live tick update on input
    const SNAPSHOT_FIELDS = [
      'projectDescription', 'projectLocation', 'keyRegulatoryApprovals',
      'majorBrands', 'auditorName', 'existingBankers', 'totalEmployees',
      'totalIncomeFY', 'promoters', 'wilfulDefaulterStatus', 'externalRatingDetails',
      'epfDefaulterStatus'
    ];
    SNAPSHOT_FIELDS.forEach(function(name) {
      const el = document.getElementById('ad_' + name);
      if (el) {
        el.addEventListener('input', function() {
          updateSnapshotTickIndicators();
        });
      }
    });

    // Run auto-fill on load after a short delay to let MCA data settle
    // FIRST load saved data, THEN auto-fill only empty sections
    loadAdditionalDetailsFromStorage();
    // Wait for server data to load, then auto-fill only empty fields
    function _runAdAutoFillWhenReady(retries) {
      if (_adLoadingCounter > 0 && retries > 0) {
        setTimeout(function() { _runAdAutoFillWhenReady(retries - 1); }, 500);
        return;
      }
      _adBeginLoading();
      autoFillSnapshotFromModules();
      updateSnapshotTickIndicators();
      // Auto-fill promoter & management tables ONLY if empty
      var pTbody = document.getElementById('promoterTableBody');
      if (pTbody && !pTbody.children.length) autoFillPromoterTable();
      var mTbody = document.getElementById('managementTableBody');
      if (mTbody && !mTbody.children.length) autoFillManagementTable();
      _adEndLoading();
    }
    setTimeout(function() { _runAdAutoFillWhenReady(10); }, 3000);

    // Bind add-row and auto-fill buttons for promoter/management tables
    const btnAddPromoter = document.getElementById('btnAddPromoterRow');
    if (btnAddPromoter) {
      btnAddPromoter.addEventListener('click', function() {
        const tbody = document.getElementById('promoterTableBody');
        if (tbody) tbody.appendChild(createPromoterRow());
      });
    }
    const btnAddMgmt = document.getElementById('btnAddManagementRow');
    if (btnAddMgmt) {
      btnAddMgmt.addEventListener('click', function() {
        const tbody = document.getElementById('managementTableBody');
        if (tbody) tbody.appendChild(createManagementRow());
      });
    }
    const btnAutoPromoter = document.getElementById('btnAutoFillPromoters');
    if (btnAutoPromoter) {
      btnAutoPromoter.addEventListener('click', function() {
        const tbody = document.getElementById('promoterTableBody');
        if (tbody) tbody.innerHTML = ''; // Clear existing to re-fill
        autoFillPromoterTable();
      });
    }
    const btnAutoMgmt = document.getElementById('btnAutoFillManagement');
    if (btnAutoMgmt) {
      btnAutoMgmt.addEventListener('click', function() {
        const tbody = document.getElementById('managementTableBody');
        if (tbody) tbody.innerHTML = ''; // Clear existing to re-fill
        autoFillManagementTable();
      });
    }

    // Business Entity Summary — AI Generation
    const btnGenEntitySummary = document.getElementById('btnGenerateEntitySummary');
    if (btnGenEntitySummary) {
      btnGenEntitySummary.addEventListener('click', async function() {
        const statusEl = document.getElementById('entitySummaryStatus');
        const summaryEl = document.getElementById('ad_businessEntitySummary');
        const prevLabel = btnGenEntitySummary.textContent;

        // Gather all available data for AI context
        const mcaPayload = getAISummaryPayloadFromIntegration(readIntegrationObject('mcaData')) || {};
        const gstPayload = getAISummaryPayloadFromIntegration(readIntegrationObject('gstData')) || {};
        const promoterData = getPromoterTableData();
        const mgmtData = getManagementTableData();
        const adData = getAdditionalDetailsData();
        const personalInfo = safeJSONParse(STORAGE.getItem(storageKey('personalInfo')), {});

        const contextPayload = {
          mca: mcaPayload,
          gst: gstPayload,
          promoterDetails: promoterData,
          managementDetails: mgmtData,
          additionalDetails: adData,
          personalInfo: personalInfo
        };

        if (!Object.keys(mcaPayload).length && !Object.keys(gstPayload).length && !promoterData.length) {
          window.alert('Pehle MCA/GST data fetch karein ya promoter details bharein.');
          return;
        }

        try {
          btnGenEntitySummary.disabled = true;
          btnGenEntitySummary.textContent = 'Generating…';
          if (statusEl) statusEl.textContent = 'Generating summary…';

          const res = await fetch('/api/module-ai-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              blockKey: 'business',
              moduleKey: 'entity_background',
              moduleLabel: 'Background of Business Entity & Promoters / Organization & Management',
              moduleData: contextPayload
            })
          });

          const json = await res.json().catch(() => ({}));
          if (!json?.success) throw new Error(json?.error || 'Summary generation failed');

          const summary = String(json?.summary || '').trim();
          if (!summary) throw new Error('Empty summary returned.');
          if (summaryEl) summaryEl.value = summary;

          // Auto-save so it persists immediately without needing separate Save click
          saveAdditionalDetailsToStorage();

          if (statusEl) {
            const d = new Date();
            statusEl.textContent = 'Summary generated at ' + d.toLocaleString('en-IN');
          }
        } catch (error) {
          if (statusEl) statusEl.textContent = 'Generation failed';
          window.alert(error?.message || 'Summary generation failed');
        } finally {
          btnGenEntitySummary.disabled = false;
          btnGenEntitySummary.textContent = prevLabel;
        }
      });
    }

    // ── Board of Directors (BOD) table buttons ──
    const btnAddBOD = document.getElementById('btnAddBODRow');
    if (btnAddBOD) {
      btnAddBOD.addEventListener('click', function() {
        const tbody = document.getElementById('bodTableBody');
        if (tbody) tbody.appendChild(createBODRow());
      });
    }
    const btnAutoBOD = document.getElementById('btnAutoFillBOD');
    if (btnAutoBOD) {
      btnAutoBOD.addEventListener('click', function() {
        const tbody = document.getElementById('bodTableBody');
        if (tbody) tbody.innerHTML = '';
        autoFillBODTable();
      });
    }

    // ── Ownership Structure table buttons ──
    const btnAddOwn = document.getElementById('btnAddOwnershipRow');
    if (btnAddOwn) {
      btnAddOwn.addEventListener('click', function() {
        const tbody = document.getElementById('ownershipTableBody');
        if (tbody) tbody.appendChild(createOwnershipRow());
      });
    }
    const btnAutoOwn = document.getElementById('btnAutoFillOwnership');
    if (btnAutoOwn) {
      btnAutoOwn.addEventListener('click', function() {
        const tbody = document.getElementById('ownershipTableBody');
        if (tbody) tbody.innerHTML = '';
        autoFillOwnershipTable();
      });
    }

    // Auto-fill BOD & Ownership on load (ONLY if tables are empty — don't overwrite saved data)
    // Wait for all server loads to finish before auto-filling tables
    function _runTableAutoFillWhenReady(retries) {
      if (_adLoadingCounter > 0 && retries > 0) {
        setTimeout(function() { _runTableAutoFillWhenReady(retries - 1); }, 500);
        return;
      }
      _adBeginLoading();
      var bodTb = document.getElementById('bodTableBody');
      if (bodTb && !bodTb.children.length) autoFillBODTable();
      var ownTb = document.getElementById('ownershipTableBody');
      if (ownTb && !ownTb.children.length) autoFillOwnershipTable();
      var certTb = document.getElementById('certificationTableBody');
      if (certTb && !certTb.children.length) autoFillCertifications();
      var staxTb = document.getElementById('statutoryTaxTableBody');
      if (staxTb && !staxTb.children.length) autoFillStatutoryTax();
      _adEndLoading();
    }
    setTimeout(function() { _runTableAutoFillWhenReady(10); }, 3500);

    // ── Certification table buttons ──
    const btnAddCert = document.getElementById('btnAddCertificationRow');
    if (btnAddCert) {
      btnAddCert.addEventListener('click', function() {
        const tbody = document.getElementById('certificationTableBody');
        if (tbody) tbody.appendChild(createCertificationRow());
      });
    }
    const btnAutoCert = document.getElementById('btnAutoFillCertifications');
    if (btnAutoCert) {
      btnAutoCert.addEventListener('click', function() {
        const tbody = document.getElementById('certificationTableBody');
        if (tbody) tbody.innerHTML = '';
        autoFillCertifications();
      });
    }

    // ── Statutory Tax & Filing table buttons ──
    const btnAddStax = document.getElementById('btnAddStatutoryTaxRow');
    if (btnAddStax) {
      btnAddStax.addEventListener('click', function() {
        const tbody = document.getElementById('statutoryTaxTableBody');
        if (tbody) tbody.appendChild(createStatutoryTaxRow());
      });
    }
    const btnAutoStax = document.getElementById('btnAutoFillStatutoryTax');
    if (btnAutoStax) {
      btnAutoStax.addEventListener('click', function() {
        const tbody = document.getElementById('statutoryTaxTableBody');
        if (tbody) tbody.innerHTML = '';
        autoFillStatutoryTax();
      });
    }

    // ── Machinery table buttons ──
    const btnAddMach = document.getElementById('btnAddMachineryRow');
    if (btnAddMach) {
      btnAddMach.addEventListener('click', function() {
        const tbody = document.getElementById('machineryTableBody');
        if (tbody) tbody.appendChild(createMachineryRow());
      });
    }

    // ── Section Save buttons (all .btn-save-ad-section) ──
    document.querySelectorAll('.btn-save-ad-section').forEach(function(sBtn) {
      sBtn.addEventListener('click', function() {
        saveAdditionalDetailsToStorage();
        var statusEl = sBtn.nextElementSibling;
        sBtn.textContent = 'Saved \u2713';
        sBtn.classList.remove('btn-primary');
        sBtn.classList.add('btn-secondary');
        if (statusEl) statusEl.textContent = 'Saved to server';
        updateSnapshotTickIndicators();
        setTimeout(function() {
          sBtn.textContent = 'Save Details';
          sBtn.classList.remove('btn-secondary');
          sBtn.classList.add('btn-primary');
          if (statusEl) statusEl.textContent = '';
        }, 1800);
      });
    });

    // ── Debounced auto-save: save after 2s of inactivity on any input inside AD module ──
    // CRITICAL: auto-save is blocked until server data has loaded at least once (_adDataLoadedOnce)
    // to prevent saving an empty form to server on page refresh.
    var _adAutoSaveTimer = null;
    var adModule = document.getElementById('module-additional_details');
    if (adModule) {
      adModule.addEventListener('input', function() {
        if (_adLoadingCounter > 0 || !_adDataLoadedOnce) return;
        clearTimeout(_adAutoSaveTimer);
        _adAutoSaveTimer = setTimeout(function() {
          saveAdditionalDetailsToStorage();
        }, 2000);
      });
      adModule.addEventListener('change', function() {
        if (_adLoadingCounter > 0 || !_adDataLoadedOnce) return;
        clearTimeout(_adAutoSaveTimer);
        _adAutoSaveTimer = setTimeout(function() {
          saveAdditionalDetailsToStorage();
        }, 1000);
      });
    }
  }

  // ─── MCA Director/Promoter Picker for Report (Company Snapshot Page 4) ───

  function extractDirectorsFromMca() {
    const mcaIntegration = readIntegrationObject('mcaData');
    const mcaRaw = mcaIntegration?.raw || null;
    const mcaData = firstNonEmpty(mcaIntegration, ['data']) || firstNonEmpty(mcaRaw, ['data']) || mcaIntegration || mcaRaw || {};
    // Walk through MCA data to find directors array
    const findDirectors = (obj, depth) => {
      if (!obj || depth > 4) return [];
      if (Array.isArray(obj)) {
        const hasDir = obj.some(item => item && typeof item === 'object' && (item.name || item.directorName || item.director_name));
        if (hasDir) return obj;
      }
      if (typeof obj === 'object' && !Array.isArray(obj)) {
        // Check common keys first
        for (const key of ['directors', 'Directors', 'directorList', 'director_list']) {
          if (Array.isArray(obj[key]) && obj[key].length) return obj[key];
        }
        for (const v of Object.values(obj)) {
          const found = findDirectors(v, depth + 1);
          if (found.length) return found;
        }
      }
      return [];
    };
    const rawDirs = findDirectors(mcaData, 0);
    return rawDirs.map(function(d) {
      const name = (d.name || d.directorName || d.director_name || '').toString().trim();
      const din = (d.din || d.DIN || d.dinNumber || d.din_number || '').toString().trim();
      const designation = (d.designation || d.role || d.type || '').toString().trim();
      if (!name) return null;
      return { name: name, din: din, designation: designation };
    }).filter(Boolean);
  }

  function getSelectedMcaDirectors() {
    const raw = STORAGE.getItem(storageKey('selectedMcaDirectors'));
    const parsed = safeJSONParse(raw, null);
    // Support wrapper format { selectionMade, directors } and legacy array format
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.selectionMade !== undefined) {
      return { selectionMade: !!parsed.selectionMade, directors: Array.isArray(parsed.directors) ? parsed.directors : [] };
    }
    if (Array.isArray(parsed) && parsed.length) {
      return { selectionMade: true, directors: parsed }; // legacy: treat non-empty array as saved
    }
    return { selectionMade: false, directors: [] }; // never saved
  }

  function saveSelectedMcaDirectors(selected) {
    const wrapper = { selectionMade: true, directors: Array.isArray(selected) ? selected : [] };
    try {
      STORAGE.setItem(storageKey('selectedMcaDirectors'), JSON.stringify(wrapper));
    } catch (e) { /* ignore */ }
    // Also save to server as a snapshot
    if (RAW_CASE_ID) {
      saveSnapshotToServer('selected_mca_directors', JSON.stringify(wrapper)).catch(function() {});
    }
  }

  function loadSelectedMcaDirectorsFromServer() {
    if (!RAW_CASE_ID) return Promise.resolve(null);
    return fetch('/api/case/' + encodeURIComponent(RAW_CASE_ID) + '/snapshot/selected_mca_directors')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(json) {
        if (!json || !json.success) return null;
        var d = json.data;
        if (d && typeof d === 'object' && d.data && Array.isArray(d.data)) return d.data;
        if (Array.isArray(d)) return d;
        return null;
      })
      .catch(function() { return null; });
  }

  function renderMcaDirectorPicker() {
    const panel = document.getElementById('mcaDirectorPickerPanel');
    const listEl = document.getElementById('mcaDirectorCheckboxList');
    if (!panel || !listEl) return;

    const directors = extractDirectorsFromMca();
    if (!directors.length) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';
    const savedObj = getSelectedMcaDirectors();
    // Build a Set of saved DIN/name keys for quick lookup
    const savedKeys = new Set(savedObj.directors.map(function(s) { return (s.din || s.name || '').toUpperCase(); }));
    const hasExplicitSave = savedObj.selectionMade;

    listEl.innerHTML = '';
    directors.forEach(function(dir, idx) {
      const key = (dir.din || dir.name).toUpperCase();
      const isChecked = !hasExplicitSave ? true : savedKeys.has(key); // default: all checked if no prior save

      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;cursor:pointer;background:#fff;transition:background 0.15s';
      row.onmouseenter = function() { row.style.background = '#f8fafc'; };
      row.onmouseleave = function() { row.style.background = '#fff'; };

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.dataset.dirIdx = idx;
      cb.dataset.dirName = dir.name;
      cb.dataset.dirDin = dir.din;
      cb.dataset.dirDesignation = dir.designation;
      cb.style.cssText = 'width:16px;height:16px;accent-color:#2563eb;flex-shrink:0';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1';
      info.innerHTML = '<div style="font-weight:700;font-size:12px;color:#0f172a">' + escapeHtmlSimple(dir.name) + '</div>'
        + (dir.din ? '<div style="font-size:10.5px;color:#64748b">DIN: ' + escapeHtmlSimple(dir.din) + '</div>' : '')
        + (dir.designation ? '<div style="font-size:10px;color:#94a3b8">' + escapeHtmlSimple(dir.designation) + '</div>' : '');

      row.appendChild(cb);
      row.appendChild(info);
      listEl.appendChild(row);
    });
  }

  function escapeHtmlSimple(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function collectSelectedMcaDirectors() {
    const listEl = document.getElementById('mcaDirectorCheckboxList');
    if (!listEl) return [];
    const selected = [];
    listEl.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      if (cb.checked) {
        selected.push({
          name: cb.dataset.dirName || '',
          din: cb.dataset.dirDin || '',
          designation: cb.dataset.dirDesignation || ''
        });
      }
    });
    return selected;
  }

  function bindMcaDirectorPickerEvents() {
    const btn = document.getElementById('btnSaveMcaDirectorSelection');
    if (btn) {
      btn.addEventListener('click', function() {
        const selected = collectSelectedMcaDirectors();
        saveSelectedMcaDirectors(selected);
        const statusEl = document.getElementById('mcaDirSaveStatus');
        btn.textContent = 'Saved ✓';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        if (statusEl) statusEl.textContent = selected.length + ' director(s) selected for report';
        setTimeout(function() {
          btn.textContent = 'Save Selection';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
          if (statusEl) statusEl.textContent = '';
        }, 2000);
      });
    }
  }

  function initMcaDirectorPicker() {
    // Try loading saved selection from server first
    loadSelectedMcaDirectorsFromServer().then(function(serverData) {
      if (serverData) {
        // Handle both wrapper and legacy array formats from server
        var toStore = serverData;
        if (Array.isArray(serverData)) {
          toStore = { selectionMade: serverData.length > 0, directors: serverData };
        }
        try { STORAGE.setItem(storageKey('selectedMcaDirectors'), JSON.stringify(toStore)); } catch(e) {}
      }
      renderMcaDirectorPicker();
    }).catch(function() {
      renderMcaDirectorPicker();
    });
    bindMcaDirectorPickerEvents();
  }

  function getCaseOverviewData() {
    const data = {};
    CO_FIELDS.forEach(function(name) {
      const el = document.getElementById('co_' + name);
      if (el) data[name] = (el.value || '').trim();
    });
    return data;
  }

  function setCaseOverviewData(data) {
    if (!data || typeof data !== 'object') return;
    CO_FIELDS.forEach(function(name) {
      const el = document.getElementById('co_' + name);
      if (el && data[name] != null) el.value = data[name];
    });
  }

  function saveCaseOverviewToStorage() {
    const data = getCaseOverviewData();
    try {
      STORAGE.setItem(storageKey('case_overview'), JSON.stringify(data));
    } catch (e) { /* ignore */ }
    // Also persist to server snapshot
    saveCaseOverviewToServer(data);
  }

  function loadCaseOverviewFromStorage() {
    // Try server first, then fall back to localStorage
    loadCaseOverviewFromServer().then(function(serverData) {
      if (serverData && typeof serverData === 'object' && Object.keys(serverData).length) {
        setCaseOverviewData(serverData);
        // Sync to local
        try { STORAGE.setItem(storageKey('case_overview'), JSON.stringify(serverData)); } catch(e) {}
      } else {
        const raw = STORAGE.getItem(storageKey('case_overview'));
        const parsed = safeJSONParse(raw, null);
        if (parsed) setCaseOverviewData(parsed);
      }
    }).catch(function() {
      const raw = STORAGE.getItem(storageKey('case_overview'));
      const parsed = safeJSONParse(raw, null);
      if (parsed) setCaseOverviewData(parsed);
    });
  }

  function saveCaseOverviewToServer(data) {
    if (!RAW_CASE_ID) return Promise.resolve();
    return saveSnapshotToServer('case_overview', JSON.stringify(data)).catch(function() {});
  }

  function loadCaseOverviewFromServer() {
    if (!RAW_CASE_ID) return Promise.resolve(null);
    return fetch('/api/case/' + encodeURIComponent(RAW_CASE_ID) + '/snapshot/case_overview')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(json) {
        if (!json || !json.success) return null;
        var d = json.data;
        if (d && typeof d === 'object' && d.data && typeof d.data === 'object') return d.data;
        if (d && typeof d === 'object') return d;
        return null;
      })
      .catch(function() { return null; });
  }

  function bindCaseOverviewEvents() {
    const btn = document.getElementById('btnSaveCaseOverview');
    if (btn) {
      btn.addEventListener('click', function() {
        saveCaseOverviewToStorage();
        btn.textContent = 'Saved ✓';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        setTimeout(function() {
          btn.textContent = 'Save';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
        }, 1800);
      });
    }

    // ── Auto-save Case Overview on any input/change ──
    var _coAutoSaveTimer = null;
    var coForm = document.getElementById('caseOverviewForm');
    if (coForm) {
      coForm.addEventListener('input', function() {
        clearTimeout(_coAutoSaveTimer);
        _coAutoSaveTimer = setTimeout(function() {
          saveCaseOverviewToStorage();
        }, 2000);
      });
      coForm.addEventListener('change', function() {
        clearTimeout(_coAutoSaveTimer);
        _coAutoSaveTimer = setTimeout(function() {
          saveCaseOverviewToStorage();
        }, 1000);
      });
    }
  }

  function bindEvents() {
    qsa('.tracker-item[data-module]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-module');
        goToModule(key);
      });
    });

    qsa('.tracker-item[data-personal-module]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-personal-module');
        setWorkspaceUrl({ view: 'single', block: 'personal' }, 'replace');
        applyBlockView('personal');
        setActivePersonalModule(key);
      });
    });

    // ── Personal module completion toggles ──
    document.querySelectorAll('[data-personal-complete-toggle]').forEach(function(toggle) {
      toggle.addEventListener('change', function() {
        var mk = toggle.getAttribute('data-personal-complete-toggle');
        if (!mk || !PERSONAL_MODULE_KEYS.includes(mk)) return;
        var current = readPersonalModuleCompletion();
        current[mk] = toggle.checked;
        writePersonalModuleCompletion(current);
        updatePersonalCompletionUI(current);
        updateUIFromStatuses(readModuleStatuses());
        renderReportBuilderPreview();
      });
    });

    qsa('[data-module-nav-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = (btn.getAttribute('data-module-nav-btn') || '').toString().trim().toLowerCase();
        navigateActiveModule(dir === 'prev' ? -1 : 1);
      });
    });

    qsa('[data-block-switcher]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const target = (sel.value || '').toString().trim().toLowerCase();
        if (!target) return;
        sel.selectedIndex = 0; // reset to placeholder

        if (target === 'case_overview') {
          setWorkspaceUrl({ view: 'single', block: 'case_overview' }, 'replace');
          applyBlockView('case_overview');
          loadCaseOverviewFromStorage();
          updateModuleNavigatorUI();
          return;
        }
        if (target === 'personal') {
          setWorkspaceUrl({ view: 'single', block: 'personal' }, 'replace');
          applyBlockView('personal');
          setActivePersonalModule(readActivePersonalModule());
          return;
        }
        if (target === 'report') {
          setWorkspaceUrl({ view: 'single', block: 'report' }, 'replace');
          applyBlockView('report');
          renderReportBuilderPreview();
          updateModuleNavigatorUI();
          return;
        }
        // default: business
        setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
        applyBlockView('business');
        setActiveModule(readActiveModule());
      });
    });

    qsa('[data-cross-switch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetBlock = (btn.getAttribute('data-cross-switch') || '').toString().trim().toLowerCase();

        if (targetBlock === 'personal') {
          const targetSel = qs('[data-cross-target="personal"]');
          const targetModule = (targetSel?.value || '').toString().trim();
          setWorkspaceUrl({ view: 'single', block: 'personal' }, 'replace');
          applyBlockView('personal');
          setActivePersonalModule(targetModule || readActivePersonalModule());
          return;
        }

        if (targetBlock === 'business') {
          const targetSel = qs('[data-cross-target="business"]');
          const targetModule = (targetSel?.value || '').toString().trim();

          if (targetModule === 'report') {
            setWorkspaceUrl({ view: 'single', block: 'report' }, 'replace');
            applyBlockView('report');
            updateModuleNavigatorUI();
            return;
          }

          setWorkspaceUrl({ view: 'single', block: 'business' }, 'replace');
          applyBlockView('business');
          setActiveModule(targetModule || readActiveModule());
          return;
        }

        if (targetBlock === 'case_overview') {
          setWorkspaceUrl({ view: 'single', block: 'case_overview' }, 'replace');
          applyBlockView('case_overview');
          return;
        }

        if (targetBlock === 'report') {
          setWorkspaceUrl({ view: 'single', block: 'report' }, 'replace');
          applyBlockView('report');
          renderReportBuilderPreview();
          updateModuleNavigatorUI();
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (isBlockSelectionMode()) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        navigateActiveModule(e.shiftKey ? -1 : 1);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        navigateActiveModule(e.shiftKey ? -1 : 1);
      }
    });

    qsa('[data-status-select]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const key = sel.getAttribute('data-status-select');
        const st = normalizeModuleStatus(sel.value);
        const current = readModuleStatuses();
        const next = writeModuleStatuses({ ...current, [key]: st });
        updateUIFromStatuses(next);
        renderReportBuilderPreview();
      });
    });

    document.addEventListener('change', async (e) => {
      const gstCheck = e.target?.closest?.('[data-gst-filing-check]');
      if (gstCheck) {
        const key = String(gstCheck.getAttribute('data-gst-filing-check') || '').trim();
        if (!key) return;
        const current = readGstReportSelection();
        const selected = new Set(current.selectedKeys || []);
        if (gstCheck.checked) selected.add(key);
        else selected.delete(key);
        writeGstReportSelection({ selectedKeys: Array.from(selected) });
        renderReportBuilderPreview();
        return;
      }

      const picker = e.target?.closest?.('[data-ai-summary-picker]');
      if (!picker) return;

      const summaryKey = picker.getAttribute('data-ai-summary-picker') || '';
      const parsed = parseSummaryKey(summaryKey);
      if (!parsed) return;

      const sectionSel = parsed.blockKey === 'personal'
        ? `[data-personal-section="${CSS.escape(parsed.moduleKey)}"]`
        : `[data-module-section="${CSS.escape(parsed.moduleKey)}"]`;
      const section = qs(sectionSel);
      const moduleLabel = getModuleLabelFromSection(section, parsed.moduleKey);

      upsertModuleAISummaryState(parsed.summaryKey, {
        moduleLabel,
        selection: picker.value || ''
      });

      const item = readModuleAISummaries()[parsed.summaryKey] || {};
      const hasSummary = String(item.summary || '').trim().length > 0;
      if (String(picker.value || '').trim().toLowerCase() === 'executive' && hasSummary) {
        updateAISummaryStatus(parsed.summaryKey, 'Selected for report');
      } else {
        updateAISummaryStatus(parsed.summaryKey, hasSummary ? 'Ready' : 'Generate summary first');
      }

      await persistModuleAISummariesSnapshot();
    });

    document.addEventListener('click', async (e) => {
      const target = e.target?.closest?.('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');

      if (action === 'generate-module-summary') {
        const summaryKey = target.getAttribute('data-summary-key') || '';
        await generateModuleAISummary(summaryKey, target);
        return;
      }

      if (action === 'save-udyam') {
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const data = readUdyamFormValues();
          const udyamNo = (data.udyam_number || '').toString().trim();
          const re = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
          if (!udyamNo || !re.test(udyamNo)) {
            throw new Error('Enter valid Udyam number in format: UDYAM-XX-00-0000000');
          }

          const pdfInput = qs('[data-udyam-pdf]');
          const file = pdfInput?.files?.[0] || null;

          const existing = readUdyamFromStorage();
          let pdfUrl = existing?.data?.pdf_url || existing?.pdf_url || null;
          if (file) {
            btn.textContent = 'Uploading PDF…';
            pdfUrl = await uploadUdyamPdfIfAny(file);
          }

          const payload = {
            ...data,
            pdf_url: pdfUrl,
            saved_by: 'executive',
            saved_at: new Date().toISOString()
          };

          writeUdyamIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload });
          renderUdyamPreview(payload);

          markCompleted('udyam');
          window.alert('Udyam Details saved.');
        } catch (err) {
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev || 'Save Udyam Details';
        }
        return;
      }

      if (action === 'save-itr') {
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const entry = readItrFormValues();
          if (!entry.assessment_year) throw new Error('Assessment Year is required.');

          const existing = readItrFromStorage();
          const existingEntries = extractItrEntries(existing);
          const nextEntries = existingEntries.filter((e) => String(e?.assessment_year || '') !== String(entry.assessment_year));
          nextEntries.push(entry);

          const payload = {
            entries: sortItrEntries(nextEntries),
            saved_by: 'executive',
            saved_at: new Date().toISOString()
          };

          writeItrIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload });
          renderItrPreview(payload.entries);

          markCompleted('itr');
          clearItrForm();
          window.alert('ITR entry saved for ' + entry.assessment_year + '. Select next year to add more.');
        } catch (err) {
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev || 'Save ITR Report';
        }
        return;
      }

      if (action === 'add-itr-year') {
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const entry = readItrFormValues();
          if (!entry.assessment_year) throw new Error('Assessment Year is required.');

          const existing = readItrFromStorage();
          const existingEntries = extractItrEntries(existing);
          const nextEntries = existingEntries.filter((e) => String(e?.assessment_year || '') !== String(entry.assessment_year));
          nextEntries.push(entry);

          const payload = {
            entries: sortItrEntries(nextEntries),
            saved_by: 'executive',
            saved_at: new Date().toISOString()
          };

          writeItrIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload });
          renderItrPreview(payload.entries);

          markCompleted('itr');
          // Clear form and auto-select next assessment year
          clearItrForm();
          const aySelect = qs('[data-itr-input="assessment_year"]');
          if (aySelect) {
            const usedYears = new Set(nextEntries.map((e) => String(e.assessment_year || '')));
            const opts = Array.from(aySelect.options).filter((o) => o.value && !usedYears.has(o.value));
            if (opts.length) {
              aySelect.value = opts[0].value;
            }
          }
          window.alert('ITR entry added for ' + entry.assessment_year + '. Form ready for next year.');
        } catch (err) {
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev || '+ Add & Next Year';
        }
        return;
      }

      if (action === 'save-bank-statement') {
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const data = readBankStatementFormValues();
          const payload = {
            ...data,
            saved_by: 'executive',
            saved_at: new Date().toISOString()
          };

          writeBankStatementIntegration({ source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload });
          renderBankStatementPreview(payload);

          if (HAS_CASE_ID) {
            btn.textContent = 'Saving snapshot…';
            await saveSnapshotToServer('bank_statement', JSON.stringify(payload));
          }

          markCompleted('bank_statement');
          window.alert('Bank Statement saved.');
        } catch (err) {
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev || 'Save Bank Statement';
        }
        return;
      }

      if (action === 'save-pan') {
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const data = readPanFormValues();
          const verifiedPhotoInput = qs('[data-pan-verified-photo]');
          const verifiedFile = verifiedPhotoInput?.files?.[0] || null;
          const verifiedPhotoInput2 = qs('[data-pan-verified-photo-2]');
          const verifiedFile2 = verifiedPhotoInput2?.files?.[0] || null;

          const existing = readPanFromStorage();
          let verifiedPhotoUrl = existing?.data?.verified_photo_url || existing?.verified_photo_url || null;
          let verifiedPhotoUrl2 = existing?.data?.verified_photo_url_2 || existing?.verified_photo_url_2 || null;
          if (verifiedFile) {
            btn.textContent = 'Uploading PAN image 1…';
            verifiedPhotoUrl = await uploadPanImageIfAny(verifiedFile, 'pan_verified');
          }
          if (verifiedFile2) {
            btn.textContent = 'Uploading PAN image 2…';
            verifiedPhotoUrl2 = await uploadPanImageIfAny(verifiedFile2, 'pan_verified_2');
          }

          const payload = {
            ...data,
            verified_photo_url: verifiedPhotoUrl,
            verified_photo_url_2: verifiedPhotoUrl2,
            saved_by: 'executive',
            saved_at: new Date().toISOString()
          };

          const wrappedPayload = { source: 'case-workspace', fetchedAt: new Date().toISOString(), data: payload };
          // Save to localStorage
          STORAGE.setItem(storageKey('integration.panData'), JSON.stringify(wrappedPayload));
          setLastUpdatedNow();
          renderPanPreview(payload);

          if (HAS_CASE_ID) {
            btn.textContent = 'Saving snapshot…';
            await saveSnapshotToServer('pan', JSON.stringify(wrappedPayload));
          }

          markCompleted('pan');
          window.alert('PAN Details saved.');
        } catch (err) {
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev || 'Save PAN Details';
        }
        return;
      }

      // ── Save individual personal module ──
      if (action === 'save-personal-module') {
        const moduleKey = target.getAttribute('data-personal-save') || '';
        if (!moduleKey || !PERSONAL_MODULE_KEYS.includes(moduleKey)) return;
        const btn = target;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          // Use in-memory model (_personalInfoModel) which has full image data_urls.
          // readPersonalInfo() reads from localStorage where images are stripped for quota.
          const personalInfo = (_personalInfoModel && typeof _personalInfoModel === 'object')
            ? _personalInfoModel
            : readPersonalInfo();
          if (moduleKey === 'applicant') {
            clearApplicantDraftFlags(personalInfo);
            syncApplicantPeopleIntoPanAndAadhaar(personalInfo);
            if (typeof window._pitrRebuildPersons === 'function') window._pitrRebuildPersons();
          }

          // Always persist the FULL personal_info (with images) to server.
          // This ensures PAN/Aadhaar images are never lost from the personal_info snapshot.
          writePersonalInfo(personalInfo, { immediate: true });

          STORAGE.setItem(storageKey('lastUpdated'), new Date().toISOString());
          // Re-render summary cards and collapse form
          if (typeof window._piRenderAllSummaries === 'function') window._piRenderAllSummaries();
          // Scroll to the module top after form collapses to summary cards
          scrollPersonalModuleIntoView(moduleKey);
          window.alert(moduleKey.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) + ' saved successfully.');
        } catch (err) {
          console.error('[save-personal-module]', moduleKey, err);
          window.alert(err?.message || 'Save failed');
        } finally {
          btn.disabled = false;
          btn.textContent = prev;
        }
        return;
      }

      if (action === 'print') {
        showAllModulesForPrint();
        return;
      }

      if (action === 'toggle-embed') {
        const key = target.getAttribute('data-target');
        const wrap = qs(`[data-embed="${CSS.escape(key)}"]`);
        if (!wrap) return;
        const isHidden = wrap.hasAttribute('hidden');
        if (isHidden) {
          wrap.removeAttribute('hidden');
          target.textContent = 'Hide embedded tool';

          // Only show one fetch option at a time.
          if (key === 'gst') {
            const btn = qs('[data-action="fetch-gst-record"]');
            if (btn) btn.style.display = 'none';
          }
          if (key === 'mca') {
            const btn = qs('[data-action="fetch-mca-record"]');
            if (btn) btn.style.display = 'none';
          }
        } else {
          wrap.setAttribute('hidden', '');
          target.textContent = 'Show embedded tool';

          if (key === 'gst') {
            const btn = qs('[data-action="fetch-gst-record"]');
            if (btn) btn.style.display = '';
          }
          if (key === 'mca') {
            const btn = qs('[data-action="fetch-mca-record"]');
            if (btn) btn.style.display = '';
          }
        }
        return;
      }

      if (action === 'toggle-json') {
        const key = String(target.getAttribute('data-target') || '').trim();
        if (!key) return;
        const panel = qs(`[data-json-panel="${CSS.escape(key)}"]`);
        if (!panel) return;
        const isHidden = panel.hasAttribute('hidden');
        if (isHidden) {
          panel.removeAttribute('hidden');
          target.textContent = 'Hide JSON Data';
        } else {
          panel.setAttribute('hidden', '');
          target.textContent = 'Show JSON Data';
        }
        return;
      }

      if (action === 'copy-json' || action === 'download-json') {
        const key = target.getAttribute('data-target');
        const pre = qs(`[data-json="${CSS.escape(key)}"]`);
        const text = pre ? pre.textContent || '{}' : '{}';
        if (action === 'copy-json') {
          const ok = await copyToClipboard(text);
          if (!ok) window.alert('Copy failed.');
        } else {
          const prev = target.textContent;
          target.disabled = true;

          // Without case creation (testing mode), we still keep auto-filled Raw JSON,
          // but "Save JSON" should just download the snapshot locally.
          if (!HAS_CASE_ID) {
            try {
              target.textContent = 'Downloading…';
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              downloadText(`${key}_snapshot_${ts}.json`, text);
            } finally {
              target.textContent = prev;
              target.disabled = false;
            }
            return;
          }

          try {
            target.textContent = 'Saving…';
            const saved = await saveSnapshotToServer(key, text);
            window.alert(`Saved to server:\n${saved?.files?.latest || ''}`);
          } catch (e) {
            window.alert(e?.message || 'Save failed');
          } finally {
            target.textContent = prev;
            target.disabled = false;
          }
        }
        return;
      }

      if (action === 'refresh-report-preview') {
        loadSnapshots();
        return;
      }

      /* ── Report Done: save everything and redirect to cases ── */
      if (action === 'report-done') {
        const btn = target.closest('[data-action="report-done"]') || target;
        const origHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Saving…';
        try {
          // Save report config
          const rc = readReportConfig();
          await saveSnapshotToServer('report_config', JSON.stringify(rc));
          // Save module statuses
          const ms = readModuleStatuses();
          await saveSnapshotToServer('module_statuses', JSON.stringify(ms));
          // Save AI summaries
          await persistModuleAISummariesSnapshot();
          // Save report images
          const riRaw = STORAGE.getItem(storageKey('integration.reportImages'));
          const riData = (riRaw && riRaw !== 'null') ? safeJSONParse(riRaw, null) : null;
          if (riData && typeof riData === 'object' && Object.keys(riData).length) {
            await saveSnapshotToServer('report_images', JSON.stringify(riData));
          }
          // Mark case as completed on server
          if (HAS_CASE_ID) {
            try {
              await fetch('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: q.caseId, status: 'completed' })
              });
            } catch {}
          }
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Done!';
          setTimeout(() => { window.location.href = '/cases'; }, 400);
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = origHTML;
          window.alert('Save failed: ' + (err?.message || 'Unknown error'));
        }
        return;
      }

      if (action === 'reset-signature') {
        customSignatureDataUrl = null;
        const img = qs('#reportSignatureImg');
        if (img) img.src = 'assets/SIGN.jpeg';
        // Persist reset
        const riData = safeJSONParse(STORAGE.getItem(storageKey('integration.reportImages')), {});
        delete riData.signatureDataUrl;
        try { STORAGE.setItem(storageKey('integration.reportImages'), JSON.stringify(riData)); } catch {}
        if (HAS_CASE_ID) saveSnapshotToServer('report_images', JSON.stringify(riData)).catch(() => {});
        return;
      }
      if (action === 'reset-stamp') {
        customStampDataUrl = null;
        const img = qs('#reportStampImg');
        if (img) img.src = 'assets/stamp.png';
        // Persist reset
        const riData = safeJSONParse(STORAGE.getItem(storageKey('integration.reportImages')), {});
        delete riData.stampDataUrl;
        try { STORAGE.setItem(storageKey('integration.reportImages'), JSON.stringify(riData)); } catch {}
        if (HAS_CASE_ID) saveSnapshotToServer('report_images', JSON.stringify(riData)).catch(() => {});
        return;
      }

      if (action === 'generate-due-diligence-report') {
        try {
          await generateDueDiligenceReportFromBuilder(target);
        } catch (err) {
          window.alert(err?.message || 'Failed to generate report');
        }
        return;
      }

      /* ── Preview Report PDF (in-browser iframe) ── */
      if (action === 'preview-report-pdf') {
        const previewWrap = qs('[data-report-pdf-preview-wrap]');
        const iframe = qs('[data-report-pdf-iframe]');
        const statusEl = qs('[data-report-final-status]');
        const prevText = target.textContent;
        target.disabled = true;
        target.textContent = 'Generating preview…';
        if (statusEl) statusEl.textContent = 'Generating preview…';

        try {
          const payload = buildDueDiligencePayloadForReport();
          const estimateTimer = startRunEstimate({
            containerSelector: '[data-report-estimate-bottom]',
            textSelector: '[data-report-estimate-text-bottom]',
            estimateMs: estimateReportRunMs(payload)
          });

          const res = await fetch('/api/generate-due-diligence-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          estimateTimer.stop();

          if (!res.ok) {
            let message = 'Failed to generate report';
            try { const j = await res.json(); message = j?.error || message; } catch {}
            throw new Error(message);
          }

          const blob = await res.blob();

          // Revoke previous blob if any
          if (lastPreviewBlobUrl) { try { URL.revokeObjectURL(lastPreviewBlobUrl); } catch {} }
          lastPreviewBlobUrl = URL.createObjectURL(blob);

          if (iframe) iframe.src = lastPreviewBlobUrl;
          if (previewWrap) previewWrap.style.display = '';
          if (statusEl) statusEl.textContent = 'Preview ready — ' + new Date().toLocaleString('en-IN');

          if (HAS_CASE_ID) {
            try { await saveSnapshotToServer('report_config', JSON.stringify(payload.reportConfig || {}, null, 2)); } catch {}
          }
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Preview failed';
          window.alert(err?.message || 'Failed to generate preview');
        } finally {
          target.disabled = false;
          target.textContent = prevText || '🔍 Preview Report PDF';
        }
        return;
      }

      /* ── Download the currently previewed PDF ── */
      if (action === 'download-previewed-pdf') {
        if (!lastPreviewBlobUrl) {
          window.alert('No preview available. Click "Preview Report PDF" first.');
          return;
        }
        const fileName = `${(q.businessName || q.caseId || 'Case').replace(/[^a-z0-9]/gi, '_')}_PreSanction_DueDiligence.pdf`;
        const a = document.createElement('a');
        a.href = lastPreviewBlobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      /* ── Close the preview iframe ── */
      if (action === 'close-report-preview') {
        const previewWrap = qs('[data-report-pdf-preview-wrap]');
        const iframe = qs('[data-report-pdf-iframe]');
        if (previewWrap) previewWrap.style.display = 'none';
        if (iframe) iframe.src = 'about:blank';
        if (lastPreviewBlobUrl) { try { URL.revokeObjectURL(lastPreviewBlobUrl); } catch {} lastPreviewBlobUrl = null; }
        return;
      }

      /* ── Print Report PDF ── */
      if (action === 'print-report-pdf') {
        const statusEl = qs('[data-report-final-status]');
        const prevText = target.textContent;
        target.disabled = true;
        target.textContent = 'Generating for print…';
        if (statusEl) statusEl.textContent = 'Generating PDF for print…';

        try {
          // If preview already exists, use it directly
          if (lastPreviewBlobUrl) {
            const printWin = window.open(lastPreviewBlobUrl, '_blank');
            if (printWin) {
              printWin.addEventListener('load', () => { try { printWin.print(); } catch {} });
            }
            if (statusEl) statusEl.textContent = 'Print dialog opened — ' + new Date().toLocaleString('en-IN');
          } else {
            // Generate fresh PDF first
            const payload = buildDueDiligencePayloadForReport();
            const estimateTimer = startRunEstimate({
              containerSelector: '[data-report-estimate-bottom]',
              textSelector: '[data-report-estimate-text-bottom]',
              estimateMs: estimateReportRunMs(payload)
            });

            const res = await fetch('/api/generate-due-diligence-report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            estimateTimer.stop();

            if (!res.ok) {
              let message = 'Failed to generate report';
              try { const j = await res.json(); message = j?.error || message; } catch {}
              throw new Error(message);
            }

            const blob = await res.blob();
            if (lastPreviewBlobUrl) { try { URL.revokeObjectURL(lastPreviewBlobUrl); } catch {} }
            lastPreviewBlobUrl = URL.createObjectURL(blob);

            const printWin = window.open(lastPreviewBlobUrl, '_blank');
            if (printWin) {
              printWin.addEventListener('load', () => { try { printWin.print(); } catch {} });
            }
            if (statusEl) statusEl.textContent = 'Print dialog opened — ' + new Date().toLocaleString('en-IN');
          }
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Print failed';
          window.alert(err?.message || 'Failed to generate PDF for print');
        } finally {
          target.disabled = false;
          target.textContent = prevText || '🖨 Print Report PDF';
        }
        return;
      }

      if (action === 'save-overall-observation') {
        const obsEl = qs('[data-report-overall-observation]');
        const statusEl = qs('[data-overall-obs-status]');
        const text = obsEl ? String(obsEl.value || '').trim() : '';
        if (!text) {
          if (statusEl) statusEl.textContent = '⚠ Nothing to save — enter observation text first.';
          return;
        }
        try {
          STORAGE.setItem(storageKey('overall_observation'), text);
          if (HAS_CASE_ID) saveSnapshotToServer('overall_observation', JSON.stringify({ text })).catch(() => {});
          if (statusEl) statusEl.textContent = '✅ Saved — will appear as a dedicated page after all modules in the report.';
          renderReportBuilderPreview();
        } catch (e) {
          if (statusEl) statusEl.textContent = '❌ Save failed';
        }
        return;
      }

      if (action === 'generate-overall-observation') {
        const statusEl = qs('[data-overall-obs-status]');
        const obsEl = qs('[data-report-overall-observation]');
        const prevText = target.textContent;
        try {
          target.disabled = true;
          target.textContent = 'Generating…';
          if (statusEl) statusEl.textContent = 'Generating overall observation…';

          const payload = buildDueDiligencePayloadForReport();
          const res = await fetch('/api/report/overall-observation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caseId: payload.caseId || '',
              companyName: payload.case?.companyName || '',
              moduleSummaries: payload.moduleSummaries || {},
              modules: payload.modules || {}
            })
          });
          const json = await res.json().catch(() => ({}));
          if (!json.success) throw new Error(json.error || 'Failed to generate observation');
          const observation = String(json.observation || '').trim();
          if (obsEl) obsEl.value = observation;
          STORAGE.setItem(storageKey('overall_observation'), observation);
          if (HAS_CASE_ID) saveSnapshotToServer('overall_observation', JSON.stringify({ text: observation })).catch(() => {});
          if (statusEl) statusEl.textContent = 'Generated ' + new Date().toLocaleString('en-IN');
          renderReportBuilderPreview();
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Failed';
          window.alert(err?.message || 'Failed to generate overall observation');
        } finally {
          target.disabled = false;
          target.textContent = prevText;
        }
        return;
      }

      if (action === 'run-compliance') {
        runComplianceCheck();
        return;
      }

      if (action === 'run-financial-calc') {
        fcRunCalculation();
        return;
      }

      if (action === 'fetch-gst-record') {
        fetchGstRecord();
        return;
      }

      if (action === 'fetch-mca-record') {
        fetchMcaRecord();
        return;
      }

      if (action === 'save-compliance') {
        const stored = safeJSONParse(STORAGE.getItem(storageKey('integration.complianceData')), null);
        if (!stored?.raw) {
          window.alert('No compliance results to save. Run the check first.');
          return;
        }
        if (HAS_CASE_ID) {
          try { await saveSnapshotToServer('compliance', JSON.stringify(stored)); } catch {}
        }
        markCompleted('compliance');
        window.alert('Compliance data saved.');
        return;
      }

      if (action === 'mark-completed') {
        const keys = (target.getAttribute('data-modules') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        keys.forEach((k) => markCompleted(k));
      }
    });

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data || {};
      if (msg.type === 'cv360.gst.sync' && msg.payload) {
        STORAGE.setItem(storageKey('integration.gstData'), JSON.stringify(msg.payload));
        setLastUpdatedNow();
        if (HAS_CASE_ID) saveSnapshotToServer('gst', JSON.stringify(msg.payload)).catch(() => {});
        loadSnapshots();
      }
      if (msg.type === 'cv360.mca.sync' && msg.payload) {
        STORAGE.setItem(storageKey('integration.mcaData'), JSON.stringify(msg.payload));
        setLastUpdatedNow();
        if (HAS_CASE_ID) saveSnapshotToServer('mca', JSON.stringify(msg.payload)).catch(() => {});
        loadSnapshots();
      }
    });
  }

  function init() {
    bindCaseMeta();

    const statuses = readModuleStatuses();
    updateUIFromStatuses(statuses);
    updatePersonalCompletionUI();

    loadSnapshots();

    initPanModule();

    initUdyamModule();

    initItrModule();

    initBankStatementModule();

    initFinancialModule();

    initFieldDataModule();

    initBusinessSummaryModule();

    initResidentVerificationImages();

    initPersonalItrModule();

    initPersonalInfoBlock();

    initReportBlock();

    injectModuleAISummaryControls();

    const storedCompliance = safeJSONParse(STORAGE.getItem(storageKey('integration.complianceData')), null);
    if (storedCompliance) {
      // Handle both formats: { normalized, raw } (correct) and legacy double-wrapped
      const compToShow = storedCompliance.normalized || storedCompliance.raw || storedCompliance;
      try { showComplianceResults(compToShow); } catch { /* not ready */ }
    }

    const viewMode = getUrlViewMode();
    const hasExplicitView = viewMode === 'blocks' || viewMode === 'all' || viewMode === 'single';

    if (!hasExplicitView || viewMode === 'blocks') {
      // Always show block picker first when opening a case.
      setWorkspaceUrl({ view: 'blocks', block: '' }, 'replace');
      enterBlockSelection();
    } else {
      const picker = qs('[data-ui="block-picker"]');
      const blocksWrap = qs('.blocks');
      setHidden(picker, true);
      setHidden(blocksWrap, false);

      const initialBlock = (getCurrentBlockKey() || '').toString().trim().toLowerCase() || 'business';
      applyBlockView(initialBlock);

      // Workspace model: block = page, module = sub-page.
      // Enforce single-module mode even if old URLs contain view=all.
      setWorkspaceUrl({ view: 'single', block: initialBlock }, 'replace');
      if (initialBlock === 'personal') {
        setActivePersonalModule(readActivePersonalModule());
      } else if (initialBlock === 'report') {
        updateModuleNavigatorUI();
      } else {
        setActiveModule(readActiveModule());
      }
    }

    updateModuleNavigatorUI();

    bindBlockHeaderClicks();

    // Ensure browser Back/Forward keeps the user inside workspace flow.
    window.addEventListener('popstate', () => {
      const picker = qs('[data-ui="block-picker"]');
      const blocksWrap = qs('.blocks');
      const businessTracker = qs('[data-tracker="business"]');
      const personalTracker = qs('[data-tracker="personal"]');

      const popViewMode = getUrlViewMode();
      const popHasExplicitView = popViewMode === 'blocks' || popViewMode === 'all' || popViewMode === 'single';

      if (!popHasExplicitView || popViewMode === 'blocks') {
        setWorkspaceUrl({ view: 'blocks', block: '' }, 'replace');
        enterBlockSelection();
        return;
      }

      setHidden(picker, true);
      setHidden(blocksWrap, false);

      const b = (getCurrentBlockKey() || '').toString().trim().toLowerCase() || 'business';
      applyBlockView(b);

      const normalizedBlock = b;
      if (businessTracker) setHidden(businessTracker, normalizedBlock === 'personal' || normalizedBlock === 'report' || normalizedBlock === 'case_overview');
      if (personalTracker) setHidden(personalTracker, normalizedBlock !== 'personal');

      // Keep single-module behavior on history navigation as well.
      setWorkspaceUrl({ view: 'single', block: normalizedBlock }, 'replace');
      if (normalizedBlock === 'case_overview') {
        loadCaseOverviewFromStorage();
      } else if (normalizedBlock === 'personal') {
        setActivePersonalModule(readActivePersonalModule());
      } else if (normalizedBlock === 'report') {
        updateModuleNavigatorUI();
      } else {
        setActiveModule(readActiveModule());
        if (readActiveModule() === 'additional_details') loadAdditionalDetailsFromStorage();
      }

      updateModuleNavigatorUI();
    });

    setupHeaderCollapseOnScroll();

    bindCaseOverviewEvents();
    bindAdditionalDetailsEvents();
    initMcaDirectorPicker();

    bindEvents();

    // ── Multi-user real-time sync via polling ──
    if (HAS_CASE_ID) {
      const SYNC_INTERVAL = 10000; // 10 seconds
      let _lastKnownTimestamps = {};
      let _syncRunning = false;

      // Remember our own save timestamps so we don't reload our own changes
      const _ownSaveTimestamps = {};
      const _origSaveSnapshotToServer = saveSnapshotToServer;

      // Wrap saveSnapshotToServer to track our own writes
      saveSnapshotToServer = async function(moduleKey, jsonText) {
        const result = await _origSaveSnapshotToServer(moduleKey, jsonText);
        if (result?.savedAt) {
          _ownSaveTimestamps[moduleKey] = new Date(result.savedAt).getTime();
        }
        return result;
      };

      async function syncCheck() {
        if (_syncRunning) return;
        _syncRunning = true;
        try {
          const caseId = encodeURIComponent(RAW_CASE_ID);
          const res = await fetch(`/api/case/${caseId}/sync-check`);
          const json = await res.json();
          if (!json?.success || !json?.timestamps) return;

          const serverTs = json.timestamps;
          const changedModules = [];

          for (const [mk, ts] of Object.entries(serverTs)) {
            const lastKnown = _lastKnownTimestamps[mk] || 0;
            const ownTs = _ownSaveTimestamps[mk] || 0;
            // Server has newer data AND it wasn't our own recent save
            if (ts > lastKnown && ts > ownTs) {
              changedModules.push(mk);
            }
          }

          _lastKnownTimestamps = serverTs;

          if (changedModules.length > 0) {
            // Reload all snapshots from server to get latest data
            loadSnapshots();
          }
        } catch {
          // Network error — skip this cycle
        } finally {
          _syncRunning = false;
        }
      }

      // Initial timestamp capture (after first loadSnapshots completes)
      setTimeout(async () => {
        try {
          const caseId = encodeURIComponent(RAW_CASE_ID);
          const res = await fetch(`/api/case/${caseId}/sync-check`);
          const json = await res.json();
          if (json?.success && json?.timestamps) {
            _lastKnownTimestamps = json.timestamps;
          }
        } catch {}
      }, 3000);

      setInterval(syncCheck, SYNC_INTERVAL);
    }
  }

  init();
})();
