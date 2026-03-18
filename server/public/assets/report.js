/* ═══════════════════════════════════════════════════════════════
   Report Builder — Client JS  (AI-Integrated)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Module Registry ───
  const MODULES = [
    { key: 'gst', label: 'GST Verification', desc: 'GSTIN, registration, filing data' },
    { key: 'mca', label: 'MCA Verification', desc: 'CIN, company master, directors' },
    { key: 'compliance', label: 'Compliance Check', desc: 'NCLT, SEBI, Court, Exchange checks' },
    { key: 'pan', label: 'PAN Details', desc: 'PAN card verification data' },
    { key: 'udyam', label: 'Udyam Details', desc: 'MSME / Udyam registration' },
    { key: 'itr', label: 'ITR', desc: 'Income Tax Return data' },
    { key: 'bank_statement', label: 'Bank Statement', desc: 'Bank statement extraction' },
    { key: 'financial', label: 'Financial', desc: 'Financial analysis & reconciliation' },
    { key: 'field_data', label: 'Business Field Data', desc: 'Site photos, shop images, field images' },
    { key: 'quotation_verification', label: 'Quotation Verification', desc: 'Dealer quotation verification details' },
    { key: 'resident_verification', label: 'Resident Verification', desc: 'Applicant address & residence verification photos' }
  ];

  // ─── State ───
  const state = {
    caseId: '',
    selectedModules: new Set(),
    moduleData: {},          // moduleKey -> { ... data ... }
    moduleStatuses: {},      // moduleKey -> 'completed' | 'in_progress' | 'pending'
    moduleSummaries: {},     // moduleKey -> AI verification summary text
    overallObservation: '',  // Final AI overall observation
    fieldImages: [],         // [{ id, label, fileName, dataUrl, mimeType }]
    residentVerificationImages: [], // [{ id, label, fileName, dataUrl, mimeType }]
    officerPhoto: null,        // { dataUrl, fileName, mimeType } or null
    officerSignature: null,    // { dataUrl, fileName, mimeType } or null
    personalInfo: {},          // { applicant, pan, aadhaar, resident_verification, personal_itr } from personal block
    businessSummary: '',       // user-entered business summary text
    financialRemark: '',       // currency/unit remark for financial tables (loaded from case data)
    moduleFieldSelections: {},  // { moduleKey: { fieldPath: boolean } } — per-field include/exclude
    hiddenModules: new Set(),   // modules auto-hidden (e.g., MCA for proprietors)
    caseLoaded: false,
    loading: false,
    aiGenerating: false
  };

  // ─── Helpers ───
  const escapeHtml = (s) => {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  const safe = (val, fb = '—') => {
    const s = val == null ? '' : String(val).trim();
    return s || fb;
  };
  const prettyJSON = (obj) => {
    try { return JSON.stringify(obj, null, 2); } catch { return '{}'; }
  };
  const markdownToHtml = (md) => {
    if (!md) return '';
    let html = escapeHtml(md);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    html = html.replace(/^[•\-\*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`);
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n/g, '<br/>');
    html = html.replace(/<br\/>\s*<ul>/g, '<ul>');
    html = html.replace(/<\/ul>\s*<br\/>/g, '</ul>');
    return html;
  };
  let _imgId = 0;
  const nextImageId = () => `img_${++_imgId}_${Date.now()}`;
  const qs = (sel) => document.querySelector(sel);

  // ─── Field Selection Helpers ───
  function initModuleFieldSelections(moduleKey, data) {
    if (!data || typeof data !== 'object') return;
    const sel = {};
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        sel[k] = true;
        v.forEach((_, i) => { sel[`${k}__${i}`] = true; });
      } else {
        sel[k] = true;
      }
    }
    state.moduleFieldSelections[moduleKey] = sel;
  }

  function getFilteredModuleData(moduleKey) {
    const data = state.moduleData[moduleKey];
    if (!data || typeof data !== 'object') return data;
    const sel = state.moduleFieldSelections[moduleKey];
    if (!sel) return data;
    const filtered = {};
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        if (sel[k] === false) continue;
        const arr = v.filter((_, i) => sel[`${k}__${i}`] !== false);
        if (arr.length > 0) filtered[k] = arr;
      } else {
        if (sel[k] !== false) filtered[k] = v;
      }
    }
    return filtered;
  }

  function buildArrayItemLabel(item, parentKey) {
    if (!item || typeof item !== 'object') return String(item || '');
    if (item.rtntype || item.return_type || item.returnType) {
      return [item.rtntype || item.return_type || item.returnType, item.fy || item.financial_year || '', item.taxp || item.tax_period || item.period || item.month || '', item.status || '', item.dof || item.filed_on || ''].filter(Boolean).join(' \u2022 ') || 'Filing Entry';
    }
    if (item.name || item.directorName || item.director_name) {
      const n = item.name || item.directorName || item.director_name;
      const d = item.din || item.DIN || '';
      return d ? `${n} (DIN: ${d})` : n;
    }
    return Object.entries(item).filter(([_, v]) => v != null && v !== '' && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(' \u2022 ') || 'Item';
  }

  function detectConstitution() {
    const gstD = state.moduleData.gst || {};
    const c = (gstD.constitutionOfBusiness || gstD.constitution || gstD.ctb || gstD.constitution_of_business || '').toString().toLowerCase();
    return c;
  }

  function isProprietorship() {
    const c = detectConstitution();
    return c.includes('proprietor') || c.includes('individual');
  }

  // ─── Render Module Grid ───
  function renderModuleGrid() {
    const grid = qs('#moduleGrid');
    if (!grid) return;

    const visibleModules = MODULES.filter((m) => !state.hiddenModules.has(m.key));

    grid.innerHTML = visibleModules.map((mod) => {
      const checked = state.selectedModules.has(mod.key);
      const hasData = mod.key === 'field_data'
        ? state.fieldImages.length > 0
        : mod.key === 'resident_verification'
        ? (!!state.moduleData[mod.key] && Object.keys(state.moduleData[mod.key]).length > 0) || state.residentVerificationImages.length > 0
        : !!state.moduleData[mod.key] && Object.keys(state.moduleData[mod.key]).length > 0;
      const hasSummary = !!state.moduleSummaries[mod.key];
      const imageModules = ['field_data'];
      const status = imageModules.includes(mod.key) ? '' : (state.moduleStatuses[mod.key] || '');
      const statusLabel = status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In Progress' : hasData ? 'Has Data' : 'Empty';
      const statusClass = status === 'completed' ? 'has-data' : status === 'in_progress' ? 'in-progress' : hasData ? 'has-data' : 'no-data';
      const isGst = mod.key === 'gst';
      return `
        <div class="module-card ${checked ? 'selected' : ''}${isGst ? ' gst-start-card' : ''}" data-module-key="${mod.key}">
          <input type="checkbox" ${checked ? 'checked' : ''} data-module-check="${mod.key}" />
          <div class="module-card-info">
            <div class="module-card-name">${escapeHtml(mod.label)}${isGst ? ' <span class="starting-badge">START</span>' : ''}</div>
            <div class="module-card-desc">${escapeHtml(mod.desc)}</div>
          </div>
          <div class="module-card-badges">
            <span class="module-card-status ${statusClass}">${statusLabel}</span>
            ${hasSummary ? '<span class="module-card-status ai-badge">✓</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    // Note for hidden modules (e.g., MCA for proprietors)
    if (state.hiddenModules.size > 0) {
      const names = [...state.hiddenModules].map((k) => {
        const m = MODULES.find((mod) => mod.key === k);
        return m ? m.label : k;
      }).join(', ');
      grid.innerHTML += `<div class="hidden-module-note" style="grid-column:1/-1">\u26A0\uFE0F <strong>${escapeHtml(names)}</strong> auto-hidden — Not applicable for Proprietorship / Individual constitution.</div>`;
    }
  }

  // ─── Render Module Structures (selected modules) with field-level selection ───
  function renderModuleStructures() {
    const container = qs('#moduleStructures');
    if (!container) return;

    const imageOnlyModules = ['field_data'];
    let selectedKeys = [...state.selectedModules].filter((k) => !imageOnlyModules.includes(k) && !state.hiddenModules.has(k));

    // GST is the starting point — always first
    selectedKeys.sort((a, b) => a === 'gst' ? -1 : b === 'gst' ? 1 : 0);

    if (!selectedKeys.length && !state.selectedModules.has('field_data')) {
      container.innerHTML = '<div class="empty-state">Select modules above to see their data structures here.</div>';
      return;
    }

    let html = '';

    for (const key of selectedKeys) {
      const mod = MODULES.find((m) => m.key === key);
      const data = state.moduleData[key] || null;
      const label = mod ? mod.label : key.toUpperCase();
      const summary = state.moduleSummaries[key] || '';
      const sel = state.moduleFieldSelections[key] || {};

      html += `<div class="module-structure-card${key === 'gst' ? ' gst-starting-point' : ''}">`;      html += `<div class="module-structure-head">`;
      html += `<span>${escapeHtml(label)}${key === 'gst' ? ' <span class="starting-badge">STARTING POINT</span>' : ''}</span>`;
      html += `<button class="btn btn-danger" data-remove-module="${key}">\u2715 Remove</button>`;
      html += `</div>`;

      // AI Summary section — editable
      html += `<div class="module-ai-summary-section">`;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">`;
      html += `<div class="ai-summary-badge" style="margin-bottom:0">📝 Verification Summary</div>`;
      if (summary) {
        html += `<div style="display:flex;gap:4px">`;
        html += `<button class="btn btn-secondary" style="font-size:10px;padding:2px 8px" data-edit-summary="${key}">\u270F Edit</button>`;
        html += `<button class="btn btn-danger" style="font-size:10px;padding:2px 8px" data-delete-summary="${key}">\u2715 Delete</button>`;
        html += `</div>`;
      }
      html += `</div>`;
      if (summary) {
        html += `<div class="ai-summary-content" data-summary-display="${key}">${markdownToHtml(summary)}</div>`;
        html += `<textarea class="ai-summary-edit" data-summary-textarea="${key}" style="display:none;width:100%;min-height:120px;font-size:12px;line-height:1.6;padding:10px;border:1px solid #cbd5e1;border-radius:6px;resize:vertical;font-family:inherit">${escapeHtml(summary)}</textarea>`;
        html += `<div data-summary-edit-actions="${key}" style="display:none;margin-top:6px;gap:6px">`;
        html += `<button class="btn btn-primary" style="font-size:10px;padding:3px 10px" data-save-summary="${key}">Save</button>`;
        html += `<button class="btn btn-secondary" style="font-size:10px;padding:3px 10px" data-cancel-summary="${key}">Cancel</button>`;
        html += `</div>`;
      } else {
        html += `<textarea class="ai-summary-edit" data-summary-textarea="${key}" style="width:100%;min-height:80px;font-size:12px;line-height:1.6;padding:10px;border:1px solid #cbd5e1;border-radius:6px;resize:vertical;font-family:inherit" placeholder="Enter summary manually or click 'Generate Summaries' above\u2026"></textarea>`;
        html += `<div style="margin-top:6px;display:flex;gap:6px">`;
        html += `<button class="btn btn-primary" style="font-size:10px;padding:3px 10px" data-save-summary="${key}">Save</button>`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `<div class="module-structure-body">`;

      if (data && typeof data === 'object' && Object.keys(data).length) {
        // Field selection toolbar
        const allFieldKeys = Object.keys(sel);
        const selectedCount = allFieldKeys.filter((fk) => sel[fk] !== false).length;

        html += `<div class="field-selection-toolbar">`;
        html += `<span class="field-count">${selectedCount}/${allFieldKeys.length} fields selected for report</span>`;
        html += `<div class="field-toolbar-actions">`;
        html += `<button class="btn-link" data-select-all-fields="${key}">Select All</button>`;
        html += `<button class="btn-link" data-deselect-all-fields="${key}">Deselect All</button>`;
        html += `</div></div>`;

        html += `<div class="field-selection-list">`;

        for (const [fieldKey, fieldVal] of Object.entries(data)) {
          if (Array.isArray(fieldVal) && fieldVal.length > 0 && fieldVal.some((it) => it && typeof it === 'object')) {
            // Array of objects — expandable section with per-item checkboxes
            const parentChecked = sel[fieldKey] !== false;
            const itemCount = fieldVal.length;
            const selectedItems = fieldVal.filter((_, i) => sel[`${fieldKey}__${i}`] !== false).length;

            html += `<div class="field-array-group${parentChecked ? '' : ' deselected'}">`;
            html += `<div class="field-array-header">`;
            html += `<label class="field-array-toggle">`;
            html += `<input type="checkbox" ${parentChecked ? 'checked' : ''} data-field-check="${key}||${fieldKey}" />`;
            html += `<span class="field-key">\uD83D\uDCCB ${escapeHtml(fieldKey)}</span>`;
            html += `<span class="field-array-count">${selectedItems}/${itemCount} items</span>`;
            html += `</label>`;
            html += `<div class="field-array-actions">`;
            html += `<button class="btn-link btn-xs" data-array-all="${key}||${fieldKey}">All</button>`;
            html += `<button class="btn-link btn-xs" data-array-none="${key}||${fieldKey}">None</button>`;
            html += `<button class="btn-link btn-xs" data-toggle-expand="${key}||${fieldKey}">\u25BC</button>`;
            html += `</div></div>`;

            html += `<div class="field-array-items" data-array-body="${key}||${fieldKey}">`;
            fieldVal.forEach((item, i) => {
              const itemKey = `${fieldKey}__${i}`;
              const checked = sel[itemKey] !== false;
              const itemLabel = buildArrayItemLabel(item, fieldKey);
              html += `<label class="field-array-item${checked ? '' : ' deselected'}">`;
              html += `<input type="checkbox" ${checked ? 'checked' : ''} data-field-check="${key}||${itemKey}" />`;
              html += `<span>${escapeHtml(itemLabel)}</span>`;
              html += `</label>`;
            });
            html += `</div></div>`;

          } else {
            // Simple field
            const checked = sel[fieldKey] !== false;
            let display;
            if (fieldVal != null && typeof fieldVal === 'object') {
              const s = JSON.stringify(fieldVal);
              display = s.length > 120 ? s.slice(0, 120) + '\u2026' : s;
            } else {
              display = safe(fieldVal);
            }
            html += `<label class="field-item-row${checked ? '' : ' deselected'}">`;
            html += `<input type="checkbox" ${checked ? 'checked' : ''} data-field-check="${key}||${fieldKey}" />`;
            html += `<span class="field-key">${escapeHtml(fieldKey)}</span>`;
            html += `<span class="field-value">${escapeHtml(display)}</span>`;
            html += `</label>`;
          }
        }

        html += `</div>`; // field-selection-list
      } else {
        html += `<div class="empty-state" style="padding:16px">No data loaded for this module. Load a case or the module has no saved data.</div>`;
      }

      html += `</div></div>`; // module-structure-body + card
    }

    container.innerHTML = html || '<div class="empty-state">Select modules above to see their data structures here.</div>';
  }

  // ─── Render Live Preview ───
  function renderPreview() {
    const body = qs('#previewBody');
    const statModulEl = qs('#statModules');
    const statImgEl = qs('#statImages');
    const statStatusEl = qs('#statStatus');
    const jsonEl = qs('#jsonPreview');

    const selectedKeys = [...state.selectedModules];

    // Sort: GST first (starting point), then rest
    selectedKeys.sort((a, b) => a === 'gst' ? -1 : b === 'gst' ? 1 : 0);

    if (statModulEl) statModulEl.textContent = selectedKeys.length;
    if (statImgEl) statImgEl.textContent = state.fieldImages.length;
    if (statStatusEl) {
      const aiCount = Object.keys(state.moduleSummaries).length;
      statStatusEl.textContent = selectedKeys.length > 0
        ? `Ready — ${aiCount} summaries`
        : 'No modules selected';
    }

    if (!body) return;

    if (!selectedKeys.length) {
      body.innerHTML = '<div class="preview-placeholder">Select modules and add data to see live preview</div>';
      if (jsonEl) jsonEl.textContent = '{}';
      return;
    }

    let html = '';

    for (const key of selectedKeys) {
      if (key === 'field_data') continue; // handled below
      const mod = MODULES.find((m) => m.key === key);
      const data = getFilteredModuleData(key) || {};
      const hasData = Object.keys(data).length > 0;
      const label = mod ? mod.label : key.toUpperCase();
      const summary = state.moduleSummaries[key] || '';

      html += `<div class="preview-module">`;
      html += `<div class="preview-module-title"><span class="dot ${hasData ? '' : 'empty'}"></span>${escapeHtml(label)}</div>`;

      // AI Summary in preview
      if (summary) {
        html += `<div class="preview-ai-summary">`;
        html += `<div class="preview-ai-label">📝 Verification Summary</div>`;
        html += `<div class="preview-ai-text">${markdownToHtml(summary)}</div>`;
        html += `</div>`;
      }

      if (hasData) {
        html += `<div class="preview-kv">`;
        const entries = Object.entries(data).slice(0, 12);
        for (const [k, v] of entries) {
          const display = v != null && typeof v === 'object' ? JSON.stringify(v).slice(0, 80) + '…' : safe(v);
          html += `<div class="pk">${escapeHtml(k)}</div><div class="pv">${escapeHtml(display)}</div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--muted);padding:4px 0;">Module selected but no data loaded.</div>`;
      }

      html += `</div>`;
    }

    // Field Data (Business images)
    if (state.selectedModules.has('field_data')) {
      html += `<div class="preview-module">`;
      html += `<div class="preview-module-title"><span class="dot ${state.fieldImages.length ? '' : 'empty'}"></span>Business Field Data</div>`;

      if (state.fieldImages.length) {
        html += `<div class="preview-images">`;
        for (const img of state.fieldImages) {
          const isFileNameLabel = /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(img.label);
          const displayLabel = isFileNameLabel ? '' : img.label;
          html += `<div><img src="${img.dataUrl}" alt="${escapeHtml(displayLabel || 'Photo')}" />${displayLabel ? `<div class="img-label">${escapeHtml(displayLabel)}</div>` : ''}</div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--muted);padding:4px 0;">No images uploaded yet.</div>`;
      }

      html += `</div>`;
    }

    // Resident Verification (Personal block address + images)
    if (state.selectedModules.has('resident_verification')) {
      const rvData = state.moduleData.resident_verification || {};
      const hasRvData = Object.keys(rvData).length > 0 || state.residentVerificationImages.length > 0;

      html += `<div class="preview-module">`;
      html += `<div class="preview-module-title"><span class="dot ${hasRvData ? '' : 'empty'}"></span>Resident Verification</div>`;

      if (Object.keys(rvData).length > 0) {
        html += `<div class="preview-kv">`;
        for (const [k, v] of Object.entries(rvData)) {
          if (v && typeof v !== 'object') html += `<div class="pk">${escapeHtml(k.replace(/_/g, ' '))}</div><div class="pv">${escapeHtml(String(v))}</div>`;
        }
        html += `</div>`;
      }

      if (state.residentVerificationImages.length) {
        html += `<div class="preview-images">`;
        for (const img of state.residentVerificationImages) {
          html += `<div><img src="${img.dataUrl}" alt="${escapeHtml(img.label)}" /><div class="img-label">${escapeHtml(img.label)}</div></div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--muted);padding:4px 0;">No verification images uploaded.</div>`;
      }

      html += `</div>`;
    }

    // Overall Observation
    if (state.overallObservation) {
      html += `<div class="preview-module preview-overall">`;
      html += `<div class="preview-module-title"><span class="dot"></span>🤖 Final Overall Observation</div>`;
      html += `<div class="preview-ai-text overall-text">${markdownToHtml(state.overallObservation)}</div>`;
      html += `</div>`;
    }

    body.innerHTML = html;

    // JSON preview
    if (jsonEl) {
      jsonEl.textContent = prettyJSON(buildReportPayload());
    }
  }

  // ─── Render Overall Observation Panel ───
  function renderOverallObservation() {
    const container = qs('#overallObservationContent');
    if (!container) return;

    if (state.overallObservation) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div class="ai-summary-badge overall-badge" style="margin-bottom:0">🤖 Final Overall Observation</div>
          <button class="btn btn-secondary" style="font-size:10px;padding:2px 8px" id="editOverallObsBtn">✏ Edit</button>
        </div>
        <div class="ai-summary-content overall-content" id="overallObsDisplay">${markdownToHtml(state.overallObservation)}</div>
        <textarea id="overallObsTextarea" style="display:none;width:100%;min-height:200px;font-size:12px;line-height:1.6;padding:10px;border:1px solid #cbd5e1;border-radius:6px;resize:vertical;font-family:inherit">${escapeHtml(state.overallObservation)}</textarea>
        <div id="overallObsEditActions" style="display:none;margin-top:6px;gap:6px">
          <button class="btn btn-primary" style="font-size:10px;padding:3px 10px" id="saveOverallObsBtn">Save</button>
          <button class="btn btn-secondary" style="font-size:10px;padding:3px 10px" id="cancelOverallObsBtn">Cancel</button>
        </div>
      `;

      qs('#editOverallObsBtn')?.addEventListener('click', () => {
        const d = qs('#overallObsDisplay'); const t = qs('#overallObsTextarea'); const a = qs('#overallObsEditActions');
        if (d) d.style.display = 'none';
        if (t) { t.style.display = 'block'; t.focus(); }
        if (a) a.style.display = 'flex';
      });
      qs('#saveOverallObsBtn')?.addEventListener('click', () => {
        state.overallObservation = qs('#overallObsTextarea')?.value || '';
        renderOverallObservation();
        renderPreview();
      });
      qs('#cancelOverallObsBtn')?.addEventListener('click', () => {
        const d = qs('#overallObsDisplay'); const t = qs('#overallObsTextarea'); const a = qs('#overallObsEditActions');
        if (d) d.style.display = '';
        if (t) { t.style.display = 'none'; t.value = state.overallObservation; }
        if (a) a.style.display = 'none';
      });
    } else {
      container.innerHTML = `
        <textarea id="overallObsManualTextarea" style="width:100%;min-height:120px;font-size:12px;line-height:1.6;padding:10px;border:1px solid #cbd5e1;border-radius:6px;resize:vertical;font-family:inherit" placeholder="Enter overall observation manually or click 'Generate Summaries' above…"></textarea>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="btn btn-primary" style="font-size:10px;padding:3px 10px" id="saveManualOverallObsBtn">Save</button>
        </div>
      `;
      qs('#saveManualOverallObsBtn')?.addEventListener('click', () => {
        const val = qs('#overallObsManualTextarea')?.value || '';
        if (val.trim()) { state.overallObservation = val; renderOverallObservation(); renderPreview(); }
      });
    }
  }

  // ─── Render Field Images ───
  function renderFieldImages() {
    const list = qs('#imageUploadList');
    if (!list) return;

    if (!state.fieldImages.length) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = state.fieldImages.map((img) => {
      const isFileNameLabel = /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(img.label);
      const displayLabel = isFileNameLabel ? '' : img.label;
      return `
      <div class="image-item" data-image-id="${img.id}">
        <img class="image-item-thumb" src="${img.dataUrl}" alt="${escapeHtml(displayLabel || 'Photo')}" />
        <div class="image-item-info">
          ${displayLabel ? `<div class="image-item-label">${escapeHtml(displayLabel)}</div>` : ''}
        </div>
        <button class="btn btn-danger" data-remove-image="${img.id}">✕ Remove</button>
      </div>
    `;
    }).join('');
  }

  // ─── Build Report Payload ───
  function buildReportPayload() {
    const selectedModules = [...state.selectedModules];
    const modules = {};

    for (const key of selectedModules) {
      if (key === 'field_data') continue;
      modules[key] = getFilteredModuleData(key) || {};
    }


    const fieldImages = state.selectedModules.has('field_data')
      ? state.fieldImages.map((img) => ({
          id: img.id,
          label: img.label,
          fileName: img.fileName,
          mimeType: img.mimeType,
          dataUrl: img.dataUrl
        }))
      : [];

    // Resident Verification data (address from module data + labelled images)
    const residentVerificationData = state.selectedModules.has('resident_verification')
      ? {
          addressData: state.moduleData.resident_verification || {},
          images: state.residentVerificationImages.map((img) => ({
            id: img.id,
            label: img.label,
            fileName: img.fileName,
            mimeType: img.mimeType,
            dataUrl: img.dataUrl
          }))
        }
      : null;

    // Extract top-level GST / MCA data for the cover page
    const gstData = modules.gst || null;
    const mcaData = modules.mca || null;

    return {
      case: {
        caseId: state.caseId || `REPORT-${Date.now()}`,
        companyName:
          mcaData?.companyName ||
          mcaData?.company ||
          gstData?.legalName ||
          gstData?.tradeName ||
          '',
        businessType:
          gstData?.constitutionOfBusiness ||
          gstData?.constitution ||
          mcaData?.classOfCompany ||
          ''
      },
      gstData,
      mcaData,
      modules,
      reportConfig: {
        selectedModules: selectedModules.filter((k) => k !== 'field_data')
      },
      fieldImages,
      businessSummary: state.businessSummary || '',
      financialRemark: state.financialRemark || '',
      residentVerificationData,
      // Personal Information Block (applicant, PAN, Aadhaar, resident verification, ITR)
      personalInfo: state.personalInfo && Object.keys(state.personalInfo).length ? state.personalInfo : null,
      // Additional Details (certifications, promoters, statutory taxation, etc.)
      additionalDetails: state._additionalDetails && Object.keys(state._additionalDetails).length ? state._additionalDetails : null,
      // Case Overview
      caseOverview: state._caseOverview && Object.keys(state._caseOverview).length ? state._caseOverview : null,
      // Officer signature & photo
      officer: {
        signatureImage: state.officerSignature ? { dataUrl: state.officerSignature.dataUrl } : null,
        photoImage: state.officerPhoto ? { dataUrl: state.officerPhoto.dataUrl } : null
      },
      // AI-generated content
      moduleSummaries: { ...state.moduleSummaries },
      overallObservation: state.overallObservation || ''
    };
  }

  // ─── Load Case from Server ───
  async function loadCase(caseId) {
    if (!caseId) return;
    state.caseId = caseId.trim();
    state.loading = true;
    state.selectedModules.clear();
    state.moduleData = {};
    state.moduleStatuses = {};
    state.moduleSummaries = {};
    state.overallObservation = '';
    state.moduleFieldSelections = {};
    state.hiddenModules.clear();
    state._caseOverview = {};
    state._additionalDetails = {};
    state.personalInfo = {};

    // Show loading state
    const statusEl = qs('#statStatus');
    if (statusEl) statusEl.textContent = 'Loading case…';
    refreshAll();

    // 1. Fetch case metadata (statuses + which modules have data)
    let completedModules = [];
    let modulesWithData = [];
    try {
      const metaRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/meta`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.success) {
          state.moduleStatuses = meta.moduleStatuses || {};
          completedModules = meta.completedModules || [];
          modulesWithData = meta.modulesWithData || [];
        }
      }
    } catch {
      // meta not available, will try loading all
    }

    // 2. Load snapshot data for all modules that have data on disk
    const moduleKeys = MODULES.filter((m) => m.key !== 'field_data').map((m) => m.key);
    const keysToLoad = modulesWithData.length ? modulesWithData : moduleKeys;

    const loadPromises = keysToLoad.map(async (key) => {
      try {
        const url = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/${key}.latest.json`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const data = json?.data?.data || json?.data?.raw?.data || json?.data?.raw || json?.data || json;
          if (data && typeof data === 'object') {
            state.moduleData[key] = data;
          }
        }
        // Fallback: if static file not found, try API (reads from MongoDB)
        if (!state.moduleData[key]) {
          const apiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/${key}`);
          if (apiRes.ok) {
            const apiJson = await apiRes.json();
            const apiData = apiJson?.data?.data || apiJson?.data || null;
            if (apiData && typeof apiData === 'object' && Object.keys(apiData).length) {
              state.moduleData[key] = apiData;
            }
          }
        }
      } catch {
        // Module data not available
      }
    });

    // Also load case_overview + additional_details for entity context (used for AI enrichment)
    loadPromises.push((async () => {
      try {
        const coUrl = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/case_overview.latest.json`;
        const coRes = await fetch(coUrl);
        if (coRes.ok) {
          const coJson = await coRes.json();
          state._caseOverview = coJson?.data || coJson || {};
        }
        // Fallback: MongoDB API
        if (!state._caseOverview || !Object.keys(state._caseOverview).length) {
          const coApiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/case_overview`);
          if (coApiRes.ok) {
            const coApiJson = await coApiRes.json();
            if (coApiJson?.success && coApiJson?.data?.data) state._caseOverview = coApiJson.data.data;
          }
        }
      } catch { /* not available */ }
    })());
    loadPromises.push((async () => {
      try {
        const adUrl = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/additional_details.latest.json`;
        const adRes = await fetch(adUrl);
        if (adRes.ok) {
          const adJson = await adRes.json();
          state._additionalDetails = adJson?.data || adJson || {};
        }
        // Fallback: MongoDB API
        if (!state._additionalDetails || !Object.keys(state._additionalDetails).length) {
          const adApiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/additional_details`);
          if (adApiRes.ok) {
            const adApiJson = await adApiRes.json();
            if (adApiJson?.success && adApiJson?.data?.data) state._additionalDetails = adApiJson.data.data;
          }
        }
      } catch { /* not available */ }
    })());

    await Promise.all(loadPromises);

    // 2b. Load field_data images from server snapshot
    try {
      const fdUrl = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/field_data.latest.json`;
      const fdRes = await fetch(fdUrl);
      if (fdRes.ok) {
        const fdJson = await fdRes.json();
        const imgs = fdJson?.data?.images || fdJson?.images || [];
        if (Array.isArray(imgs) && imgs.length) {
          state.fieldImages = imgs;
          // Auto-select field_data module if images exist
          state.selectedModules.add('field_data');
        }
      }
    } catch {
      // field_data not available
    }

    // 2d. Load resident_verification_images from server snapshot
    try {
      const rvUrl = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/resident_verification_images.latest.json`;
      const rvRes = await fetch(rvUrl);
      if (rvRes.ok) {
        const rvJson = await rvRes.json();
        const imgs = rvJson?.data?.images || rvJson?.images || [];
        if (Array.isArray(imgs) && imgs.length) {
          state.residentVerificationImages = imgs;
        }
      }
      // Fallback: try MongoDB API
      if (!state.residentVerificationImages.length) {
        const rvApiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/resident_verification_images`);
        if (rvApiRes.ok) {
          const rvApiJson = await rvApiRes.json();
          if (rvApiJson?.success && rvApiJson?.data?.data) {
            const d = rvApiJson.data.data;
            const imgs = d?.images || [];
            if (Array.isArray(imgs) && imgs.length) state.residentVerificationImages = imgs;
          }
        }
      }
    } catch {
      // resident_verification_images not available
    }

    // 2f. Load personal_info (applicant, pan, aadhaar, resident_verification, personal_itr) from MongoDB API + file fallback
    try {
      let piLoaded = false;
      // Try MongoDB API first (source of truth for newer saves)
      const piApiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/personal_info`);
      if (piApiRes.ok) {
        const piApiJson = await piApiRes.json();
        if (piApiJson?.success && piApiJson?.data?.data && typeof piApiJson.data.data === 'object') {
          state.personalInfo = piApiJson.data.data;
          piLoaded = true;
        }
      }
      // Fallback: try file-based snapshot
      if (!piLoaded) {
        const piFileRes = await fetch(`/case-data/${encodeURIComponent(state.caseId)}/snapshots/personal_info.latest.json`);
        if (piFileRes.ok) {
          const piFileJson = await piFileRes.json();
          const piData = piFileJson?.data || piFileJson;
          if (piData && typeof piData === 'object') {
            state.personalInfo = piData;
          }
        }
      }
    } catch {
      // personal_info not available
    }

    // 2e. Load business_summary from server snapshot
    try {
      const bsUrl = `/case-data/${encodeURIComponent(state.caseId)}/snapshots/business_summary.latest.json`;
      const bsRes = await fetch(bsUrl);
      if (bsRes.ok) {
        const bsJson = await bsRes.json();
        const summary = bsJson?.data?.summary || bsJson?.summary || '';
        if (summary) {
          state.businessSummary = summary;
          const bsInput = qs('#businessSummaryInput');
          if (bsInput) bsInput.value = summary;
        }
      }
    } catch {
      // business_summary not available
    }

    // 2g. Load financial_remark from server snapshot
    try {
      const frApiRes = await fetch(`/api/case/${encodeURIComponent(state.caseId)}/snapshot/financial_remark`);
      if (frApiRes.ok) {
        const frJson = await frApiRes.json();
        if (frJson?.success && frJson?.data) {
          const d = frJson.data.data && typeof frJson.data.data === 'object' ? frJson.data.data : frJson.data;
          if (d.remark) state.financialRemark = d.remark;
        }
      }
    } catch {
      // financial_remark not available
    }

    // 3. Initialize field selections for every loaded module (all fields selected by default)
    for (const [mk, md] of Object.entries(state.moduleData)) {
      initModuleFieldSelections(mk, md);
    }

    // 4. Auto-hide MCA for Proprietorship / Individual constitution
    state.hiddenModules.clear();
    if (isProprietorship()) {
      state.hiddenModules.add('mca');
      state.selectedModules.delete('mca');
    }

    // 5. Auto-select only COMPLETED modules (they will appear in report)
    //    If no statuses are saved, fall back to modules that have data
    if (completedModules.length) {
      for (const key of completedModules) {
        state.selectedModules.add(key);
      }
    } else {
      // Fallback: select modules that have actual data
      for (const key of moduleKeys) {
        if (state.moduleData[key] && Object.keys(state.moduleData[key]).length > 0) {
          state.selectedModules.add(key);
        }
      }
    }

    // Always auto-select quotation_verification if it has data (even if not marked completed)
    if (state.moduleData.quotation_verification && Object.keys(state.moduleData.quotation_verification).length > 0) {
      state.selectedModules.add('quotation_verification');
    }

    state.caseLoaded = true;
    state.loading = false;
    if (statusEl) statusEl.textContent = `Loaded — ${state.selectedModules.size} completed modules selected`;

    // Show status banner
    const banner = qs('#caseStatusBanner');
    const bannerText = qs('#caseStatusText');
    if (banner && bannerText) {
      const completedCount = completedModules.length;
      const dataCount = Object.keys(state.moduleData).length;
      bannerText.textContent = `Case "${state.caseId}" loaded — ${completedCount} completed module${completedCount !== 1 ? 's' : ''} auto-selected, ${dataCount} module${dataCount !== 1 ? 's' : ''} with data on server.`;
      banner.hidden = false;
    }

    refreshAll();
  }

  // ─── AI Summary Generation ───
  async function generateAISummaries() {
    const selectedKeys = [...state.selectedModules].filter((k) => k !== 'field_data');
    const modulesWithData = selectedKeys.filter((k) => state.moduleData[k] && Object.keys(state.moduleData[k]).length > 0);

    if (!modulesWithData.length) {
      alert('No modules with data selected. Load a case first or select modules with data.');
      return;
    }

    state.aiGenerating = true;
    state.moduleSummaries = {};
    state.overallObservation = '';

    const overlay = qs('#aiOverlay');
    const aiStatus = qs('#aiOverlayStatus');
    const aiProgress = qs('#aiProgressBar');
    const btn = qs('#generateAiBtn');

    if (overlay) overlay.hidden = false;
    if (btn) btn.disabled = true;

    const total = modulesWithData.length + 1; // +1 for overall observation
    let done = 0;

    const updateProgress = (msg) => {
      if (aiStatus) aiStatus.textContent = msg;
      if (aiProgress) aiProgress.style.width = `${Math.round((done / total) * 100)}%`;
    };

    // Phase 1: Per-module verification summaries
    for (const key of modulesWithData) {
      const mod = MODULES.find((m) => m.key === key);
      const label = mod ? mod.label : key.toUpperCase();
      updateProgress(`Analyzing ${label}... (${done + 1}/${total})`);

      try {
        // Build request body — for compliance, include company context for AI enrichment
        const summaryBody = {
          moduleKey: key,
          moduleLabel: label,
          moduleData: state.moduleData[key]
        };
        // Always pass company name and basic context so AI can enrich compliance with public knowledge
        const gstD = state.moduleData.gst || {};
        const mcaD = state.moduleData.mca || {};
        summaryBody.companyName = mcaD.companyName || mcaD.company || gstD.legalName || gstD.tradeName || '';
        summaryBody.companyContext = {
          cin: mcaD.cin || mcaD.CIN || '',
          gstin: gstD.gstin || gstD.GSTIN || '',
          constitution: gstD.constitutionOfBusiness || gstD.constitution || mcaD.classOfCompany || '',
          status: mcaD.status || gstD.status || '',
          incorporationDate: mcaD.dateOfIncorporation || mcaD.incorporationDate || '',
          registeredOffice: mcaD.registeredOffice || gstD.address || ''
        };

        // For FINANCIAL module — send ALL other module data + entity context for industry-specific AI analysis
        if (key === 'financial') {
          summaryBody.allModuleData = {};
          for (const [mk, md] of Object.entries(state.moduleData)) {
            if (mk !== 'financial' && md && typeof md === 'object' && Object.keys(md).length > 0) {
              summaryBody.allModuleData[mk] = md;
            }
          }
          // Build entity profile from case_overview + additional_details + udyam for rich context
          const co = state._caseOverview || {};
          const ad = state._additionalDetails || {};
          const udyamD = state.moduleData.udyam || {};
          summaryBody.entityProfile = {
            entityName: co.entityName || mcaD.companyName || mcaD.company || gstD.legalName || gstD.tradeName || '',
            constitution: gstD.constitutionOfBusiness || gstD.constitution || mcaD.classOfCompany || '',
            msmeCategory: ad.msmeCategory || udyamD.enterprise_type || udyamD.enterpriseType || udyamD.major_activity || '',
            industrySector: ad.bpIndustrySegment || ad.industry || udyamD.nic_2_digit || udyamD.major_activity || '',
            natureOfActivity: ad.bpNatureOfBusinessActivity || gstD.businessActivities || gstD.natureOfBusiness || udyamD.major_activity || '',
            businessAge: ad.bpBusinessAge || '',
            location: ad.bpRegisteredOfficeLocation || co.unitLocation || mcaD.registeredOffice || gstD.address || '',
            employeeCount: ad.totalEmployees || ad.bpEmployeesAtLocation || ''
          };
        }

        const res = await fetch('/api/report/module-verification-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summaryBody)
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.summary) {
            state.moduleSummaries[key] = json.summary;
          }
        }
      } catch (err) {
        console.warn(`AI summary failed for ${key}:`, err);
        state.moduleSummaries[key] = `Summary generation failed: ${err.message}`;
      }

      done++;
      refreshAll();
    }

    // Phase 2: Overall observation
    updateProgress(`Generating final overall observation... (${done + 1}/${total})`);

    try {
      const payload = buildReportPayload();
      const res = await fetch('/api/report/overall-observation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: state.caseId,
          companyName: payload.case?.companyName || 'Company',
          moduleSummaries: state.moduleSummaries,
          modules: payload.modules
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.observation) {
          state.overallObservation = json.observation;
        }
      }
    } catch (err) {
      console.warn('Overall observation failed:', err);
      state.overallObservation = `Overall observation generation failed: ${err.message}`;
    }

    done++;
    updateProgress('Analysis complete!');

    state.aiGenerating = false;
    if (overlay) setTimeout(() => { overlay.hidden = true; }, 800);
    if (btn) btn.disabled = false;

    refreshAll();
  }

  // ─── File to DataURL ───
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  // ─── Add Image ───
  async function addImage() {
    const labelInput = qs('#imageLabel');
    const fileInput = qs('#imageFile');
    if (!fileInput?.files?.length) {
      alert('Please select an image file.');
      return;
    }

    const file = fileInput.files[0];
    const label = (labelInput?.value || '').trim() || file.name;

    try {
      const dataUrl = await fileToDataUrl(file);

      state.fieldImages.push({
        id: nextImageId(),
        label,
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        dataUrl
      });

      // Auto-select field_data module
      state.selectedModules.add('field_data');

      // Clear inputs
      if (labelInput) labelInput.value = '';
      if (fileInput) fileInput.value = '';

      refreshAll();
    } catch (err) {
      alert('Failed to read image: ' + err.message);
    }
  }

  // ─── Remove Image ───
  function removeImage(imageId) {
    state.fieldImages = state.fieldImages.filter((img) => img.id !== imageId);
    if (!state.fieldImages.length) {
      state.selectedModules.delete('field_data');
    }
    refreshAll();
  }

  // ─── Add Resident Verification Image ───
  async function addRVImage() {
    const labelInput = qs('#rvImageLabel');
    const fileInput = qs('#rvImageFile');
    if (!fileInput?.files?.length) {
      alert('Please select an image file.');
      return;
    }
    const file = fileInput.files[0];
    const label = (labelInput?.value || '').trim() || file.name;
    try {
      const dataUrl = await fileToDataUrl(file);
      state.residentVerificationImages.push({
        id: nextImageId(),
        label,
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        dataUrl
      });
      state.selectedModules.add('resident_verification');
      if (labelInput) labelInput.value = '';
      if (fileInput) fileInput.value = '';
      refreshAll();
    } catch (err) {
      alert('Failed to read image: ' + err.message);
    }
  }

  function removeRVImage(imageId) {
    state.residentVerificationImages = state.residentVerificationImages.filter((img) => img.id !== imageId);
    refreshAll();
  }

  // ─── Render Resident Verification Images ───
  function renderRVImages() {
    const list = qs('#rvImageUploadList');
    if (!list) return;
    if (!state.residentVerificationImages.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = state.residentVerificationImages.map((img) => `
      <div class="image-item" data-rv-image-id="${img.id}">
        <img class="image-item-thumb" src="${img.dataUrl}" alt="${escapeHtml(img.label)}" />
        <div class="image-item-info">
          <div class="image-item-label">${escapeHtml(img.label)}</div>
          <div class="image-item-meta">${escapeHtml(img.fileName)} • ${escapeHtml(img.mimeType)}</div>
        </div>
        <button class="btn btn-danger" data-remove-rv-image="${img.id}">✕ Remove</button>
      </div>
    `).join('');
  }

  // ─── Officer Photo & Signature Uploads ───
  async function uploadOfficerPhoto() {
    const fileInput = qs('#officerPhotoFile');
    if (!fileInput?.files?.length) { alert('Please select a photo.'); return; }
    try {
      const file = fileInput.files[0];
      state.officerPhoto = { dataUrl: await fileToDataUrl(file), fileName: file.name, mimeType: file.type || 'image/jpeg' };
      fileInput.value = '';
      refreshAll();
    } catch (err) { alert('Failed to read photo: ' + err.message); }
  }

  async function uploadOfficerSignature() {
    const fileInput = qs('#officerSignatureFile');
    if (!fileInput?.files?.length) { alert('Please select a signature image.'); return; }
    try {
      const file = fileInput.files[0];
      state.officerSignature = { dataUrl: await fileToDataUrl(file), fileName: file.name, mimeType: file.type || 'image/jpeg' };
      fileInput.value = '';
      refreshAll();
    } catch (err) { alert('Failed to read signature: ' + err.message); }
  }

  function renderOfficerUploads() {
    const photoPrev = qs('#officerPhotoPreview');
    const sigPrev = qs('#officerSignaturePreview');
    if (photoPrev) {
      photoPrev.innerHTML = state.officerPhoto
        ? `<img src="${state.officerPhoto.dataUrl}" alt="Officer Photo" style="max-height:80px;max-width:100%;border-radius:6px;border:1px solid #e2e8f0" /><br><button class="btn btn-danger" id="removeOfficerPhotoBtn" style="margin-top:4px;font-size:11px">✕ Remove</button>`
        : '<div style="font-size:12px;color:#94a3b8">No photo uploaded</div>';
    }
    if (sigPrev) {
      sigPrev.innerHTML = state.officerSignature
        ? `<img src="${state.officerSignature.dataUrl}" alt="Officer Signature" style="max-height:60px;max-width:100%;border-radius:4px;border:1px solid #e2e8f0" /><br><button class="btn btn-danger" id="removeOfficerSignatureBtn" style="margin-top:4px;font-size:11px">✕ Remove</button>`
        : '<div style="font-size:12px;color:#94a3b8">No signature uploaded</div>';
    }
  }

  // ─── PDF Preview state ───
  let _previewBlobUrl = null;

  // ─── Preview PDF (in iframe) ───
  async function previewPdf() {
    const overlay = qs('#generateOverlay');
    const statusEl = qs('#overlayStatus');
    const btn = qs('#previewPdfBtn');
    const wrap = qs('#pdfPreviewWrap');
    const iframe = qs('#pdfPreviewIframe');
    const statStatus = qs('#statStatus');

    const payload = buildReportPayload();
    const selectedCount = payload.reportConfig.selectedModules.length + (payload.fieldImages.length ? 1 : 0);

    if (selectedCount === 0) {
      alert('Please select at least one module to preview a report.');
      return;
    }

    if (overlay) overlay.hidden = false;
    if (statusEl) statusEl.textContent = 'Building report payload for preview...';
    if (btn) btn.disabled = true;

    try {
      if (statusEl) statusEl.textContent = 'Generating PDF preview...';

      const res = await fetch('/api/generate-due-diligence-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let msg = 'Failed to generate report';
        try { const j = await res.json(); msg = j?.error || msg; } catch {}
        throw new Error(msg);
      }

      if (statusEl) statusEl.textContent = 'PDF ready! Loading preview...';

      const blob = await res.blob();

      // Revoke previous blob URL if any
      if (_previewBlobUrl) { try { URL.revokeObjectURL(_previewBlobUrl); } catch {} }
      _previewBlobUrl = URL.createObjectURL(blob);

      if (iframe) iframe.src = _previewBlobUrl;
      if (wrap) wrap.style.display = '';
      if (statStatus) statStatus.textContent = 'Preview ready — ' + new Date().toLocaleString('en-IN');
    } catch (err) {
      alert('Preview failed: ' + err.message);
      if (statStatus) statStatus.textContent = 'Preview failed';
    } finally {
      if (overlay) overlay.hidden = true;
      if (btn) btn.disabled = false;
    }
  }

  function downloadPreviewedPdf() {
    if (!_previewBlobUrl) {
      alert('No preview available. Click "Preview PDF" first.');
      return;
    }
    const payload = buildReportPayload();
    const companyName = payload.case?.companyName || 'Report';
    const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_')}_Report.pdf`;
    const a = document.createElement('a');
    a.href = _previewBlobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function closePdfPreview() {
    const wrap = qs('#pdfPreviewWrap');
    const iframe = qs('#pdfPreviewIframe');
    if (wrap) wrap.style.display = 'none';
    if (iframe) iframe.src = 'about:blank';
    if (_previewBlobUrl) { try { URL.revokeObjectURL(_previewBlobUrl); } catch {} _previewBlobUrl = null; }
  }

  // ─── Generate PDF ───
  async function generatePdf() {
    const overlay = qs('#generateOverlay');
    const statusEl = qs('#overlayStatus');
    const btn = qs('#generatePdfBtn');

    const payload = buildReportPayload();
    const selectedCount = payload.reportConfig.selectedModules.length + (payload.fieldImages.length ? 1 : 0);

    if (selectedCount === 0) {
      alert('Please select at least one module to generate a report.');
      return;
    }

    if (overlay) overlay.hidden = false;
    if (statusEl) statusEl.textContent = 'Building report payload...';
    if (btn) btn.disabled = true;

    try {
      if (statusEl) statusEl.textContent = 'Sending to server for PDF generation...';

      const res = await fetch('/api/generate-due-diligence-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let msg = 'Failed to generate report';
        try { const j = await res.json(); msg = j?.error || msg; } catch {}
        throw new Error(msg);
      }

      if (statusEl) statusEl.textContent = 'PDF generated! Downloading...';

      const blob = await res.blob();
      const companyName = payload.case?.companyName || 'Report';
      const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_')}_Report.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Report generation failed: ' + err.message);
    } finally {
      if (overlay) overlay.hidden = true;
      if (btn) btn.disabled = false;
    }
  }

  // ─── Refresh All ───
  function refreshAll() {
    renderModuleGrid();
    renderModuleStructures();
    renderFieldImages();
    renderRVImages();
    renderOfficerUploads();
    renderOverallObservation();
    renderPreview();
  }

  // ─── Event Delegation ───
  function initEvents() {
    // Module grid checkbox toggle
    qs('#moduleGrid')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-module-key]');
      if (!card) return;

      const key = card.dataset.moduleKey;
      const checkbox = card.querySelector('input[type="checkbox"]');

      // If user clicked checkbox directly, use its new state
      // If user clicked the card, toggle the checkbox
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }

      if (checkbox.checked) {
        state.selectedModules.add(key);
      } else {
        state.selectedModules.delete(key);
      }

      refreshAll();
    });

    // Module structures: remove, field selection, array controls
    qs('#moduleStructures')?.addEventListener('click', (e) => {
      // Remove module
      const rmBtn = e.target.closest('[data-remove-module]');
      if (rmBtn) { state.selectedModules.delete(rmBtn.dataset.removeModule); refreshAll(); return; }

      // Select All Fields
      const selAll = e.target.closest('[data-select-all-fields]');
      if (selAll) {
        const mk = selAll.dataset.selectAllFields;
        const s = state.moduleFieldSelections[mk];
        if (s) { for (const k of Object.keys(s)) s[k] = true; refreshAll(); }
        return;
      }

      // Deselect All Fields
      const deAll = e.target.closest('[data-deselect-all-fields]');
      if (deAll) {
        const mk = deAll.dataset.deselectAllFields;
        const s = state.moduleFieldSelections[mk];
        if (s) { for (const k of Object.keys(s)) s[k] = false; refreshAll(); }
        return;
      }

      // Array Select All
      const arrAll = e.target.closest('[data-array-all]');
      if (arrAll) {
        const [mk, fk] = arrAll.dataset.arrayAll.split('||');
        const s = state.moduleFieldSelections[mk];
        if (s) { for (const k of Object.keys(s)) { if (k === fk || k.startsWith(`${fk}__`)) s[k] = true; } refreshAll(); }
        return;
      }

      // Array Deselect All
      const arrNone = e.target.closest('[data-array-none]');
      if (arrNone) {
        const [mk, fk] = arrNone.dataset.arrayNone.split('||');
        const s = state.moduleFieldSelections[mk];
        if (s) { for (const k of Object.keys(s)) { if (k === fk || k.startsWith(`${fk}__`)) s[k] = false; } refreshAll(); }
        return;
      }

      // Toggle expand/collapse array items
      const toggle = e.target.closest('[data-toggle-expand]');
      if (toggle) {
        const body = qs(`[data-array-body="${toggle.dataset.toggleExpand}"]`);
        if (body) { body.classList.toggle('collapsed'); toggle.textContent = body.classList.contains('collapsed') ? '\u25B6' : '\u25BC'; }
        return;
      }

      // Edit AI Summary toggle
      const editSum = e.target.closest('[data-edit-summary]');
      if (editSum) {
        const mk = editSum.dataset.editSummary;
        const display = qs(`[data-summary-display="${mk}"]`);
        const ta = qs(`[data-summary-textarea="${mk}"]`);
        const actions = qs(`[data-summary-edit-actions="${mk}"]`);
        if (display) display.style.display = 'none';
        if (ta) { ta.style.display = 'block'; ta.focus(); }
        if (actions) actions.style.display = 'flex';
        editSum.style.display = 'none';
        return;
      }

      // Save AI Summary
      const saveSum = e.target.closest('[data-save-summary]');
      if (saveSum) {
        const mk = saveSum.dataset.saveSummary;
        const ta = qs(`[data-summary-textarea="${mk}"]`);
        if (ta) {
          state.moduleSummaries[mk] = ta.value;
          renderModuleStructures();
          renderPreview();
        }
        return;
      }

      // Cancel AI Summary edit
      const cancelSum = e.target.closest('[data-cancel-summary]');
      if (cancelSum) {
        const mk = cancelSum.dataset.cancelSummary;
        const display = qs(`[data-summary-display="${mk}"]`);
        const ta = qs(`[data-summary-textarea="${mk}"]`);
        const actions = qs(`[data-summary-edit-actions="${mk}"]`);
        const editBtn = qs(`[data-edit-summary="${mk}"]`);
        if (display) display.style.display = '';
        if (ta) { ta.style.display = 'none'; ta.value = state.moduleSummaries[mk] || ''; }
        if (actions) actions.style.display = 'none';
        if (editBtn) editBtn.style.display = '';
        return;
      }

      // Delete AI Summary
      const deleteSum = e.target.closest('[data-delete-summary]');
      if (deleteSum) {
        const mk = deleteSum.dataset.deleteSummary;
        if (confirm('Delete this summary? You can re-generate or enter manually.')) {
          delete state.moduleSummaries[mk];
          renderModuleStructures();
          renderPreview();
        }
        return;
      }
    });

    // Field checkbox changes
    qs('#moduleStructures')?.addEventListener('change', (e) => {
      const check = e.target.closest('[data-field-check]');
      if (!check) return;
      const parts = check.dataset.fieldCheck.split('||');
      if (parts.length !== 2) return;
      const [mk, fp] = parts;
      if (state.moduleFieldSelections[mk]) {
        state.moduleFieldSelections[mk][fp] = check.checked;
        // If toggling a parent array key, toggle all children too
        if (!fp.includes('__')) {
          const data = state.moduleData[mk];
          if (data && Array.isArray(data[fp])) {
            data[fp].forEach((_, i) => { state.moduleFieldSelections[mk][`${fp}__${i}`] = check.checked; });
          }
        }
        refreshAll();
      }
    });

    // Use event delegation on the parent for dynamically rendered structure cards
    qs('#selectedModulesPanel')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-module]');
      if (!btn) return;
      const key = btn.dataset.removeModule;
      state.selectedModules.delete(key);
      refreshAll();
    });

    // Add image
    qs('#addImageBtn')?.addEventListener('click', addImage);

    // Remove image (delegation)
    qs('#imageUploadList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-image]');
      if (!btn) return;
      removeImage(btn.dataset.removeImage);
    });

    // Add Resident Verification image
    qs('#addRVImageBtn')?.addEventListener('click', addRVImage);

    // Remove Resident Verification image (delegation)
    qs('#rvImageUploadList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-rv-image]');
      if (!btn) return;
      removeRVImage(btn.dataset.removeRvImage);
    });

    // Load case
    qs('#loadCaseBtn')?.addEventListener('click', () => {
      const caseId = qs('#caseIdInput')?.value?.trim();
      if (caseId) {
        loadCase(caseId);
      } else {
        alert('Please enter a Case ID.');
      }
    });

    // Also allow Enter key in case ID input
    qs('#caseIdInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        qs('#loadCaseBtn')?.click();
      }
    });

    // Business Summary textarea sync
    // ── Financial Remark select + custom input ──
    // (Removed from report page — now lives on case-workspace financial module dashboard)

    qs('#businessSummaryInput')?.addEventListener('input', (e) => {
      state.businessSummary = e.target.value;
    });

    // Officer photo & signature uploads
    qs('#uploadOfficerPhotoBtn')?.addEventListener('click', uploadOfficerPhoto);
    qs('#uploadOfficerSignatureBtn')?.addEventListener('click', uploadOfficerSignature);
    qs('#officerPhotoPreview')?.addEventListener('click', (e) => {
      if (e.target.closest('#removeOfficerPhotoBtn')) { state.officerPhoto = null; refreshAll(); }
    });
    qs('#officerSignaturePreview')?.addEventListener('click', (e) => {
      if (e.target.closest('#removeOfficerSignatureBtn')) { state.officerSignature = null; refreshAll(); }
    });

    // Generate AI Summaries
    qs('#generateAiBtn')?.addEventListener('click', generateAISummaries);

    // Refresh Preview
    qs('#refreshPreviewBtn')?.addEventListener('click', renderPreview);

    // Generate PDF
    qs('#generatePdfBtn')?.addEventListener('click', generatePdf);

    // Preview PDF (in-browser iframe)
    qs('#previewPdfBtn')?.addEventListener('click', previewPdf);

    // Download the previewed PDF
    qs('#downloadPreviewedPdfBtn')?.addEventListener('click', downloadPreviewedPdf);

    // Close PDF preview
    qs('#closePdfPreviewBtn')?.addEventListener('click', closePdfPreview);
  }

  // ─── URL Params ───
  function loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const caseId = params.get('caseId') || params.get('case');
    if (caseId) {
      const input = qs('#caseIdInput');
      if (input) input.value = caseId;
      loadCase(caseId);
    }
  }

  // ─── Init ───
  function init() {
    renderModuleGrid();
    renderOverallObservation();
    renderPreview();
    initEvents();
    loadFromUrl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
