/* Enterprise Case Management Dashboard (vanilla JS)
   - Stores cases in localStorage
   - KPI filters, search, status filter
   - Lightweight charts (Canvas)
   - Open Case -> /case-workspace with query params
*/

(function () {
  const STORAGE_KEY = 'cv360:cma:cases:v1';
  const UI_KEY = 'cv360:cma:ui:v1';
  const SEEDED_KEY = 'cv360:cma:seeded:v1';

  const SESSION_KEY = 'cv360:auth:session';

  // ── Session guard: redirect to login if not authenticated ──
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  const _session = getSession();
  if (!_session) {
    window.location.replace('/');
    return; // stop executing
  }

  // Show logged-in user info
  (function hydrateUser() {
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatar');
    if (nameEl && _session.userId) nameEl.textContent = _session.userId;
    if (avatarEl && _session.userId) avatarEl.textContent = _session.userId.charAt(0).toUpperCase();
  })();

  // Logout handler
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    const toast = document.getElementById('logoutToast');
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => window.location.replace('/'), 1400);
    } else {
      window.location.replace('/');
    }
  });

  const WORKSPACE_MODULE_KEYS = ['gst', 'mca', 'compliance', 'pan', 'udyam', 'itr', 'bank_statement', 'financial', 'field_data'];

  function caseWorkspacePrefix(caseId) {
    const safeId = (caseId || '').toString().trim();
    if (!safeId) return 'cv360.caseWorkspace.default.';
    const normalized = safeId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    return `cv360.caseWorkspace.${normalized}.`;
  }

  function purgeCaseWorkspace(caseId) {
    const prefix = caseWorkspacePrefix(caseId);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    });
  }

  const STATUS = {
    PENDING: 'pending',
    ONGOING: 'ongoing',
    COMPLETED: 'completed'
  };

  const RISK = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
  };

  function nowISO() {
    return new Date().toISOString();
  }

  function safeJSONParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  /* ── In-memory cache (synced from server) ── */
  let _casesCache = null; // populated by fetchCasesFromServer()

  function loadCases() {
    if (_casesCache) return _casesCache;
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = safeJSONParse(raw, []);
    return Array.isArray(data) ? data : [];
  }

  function saveCasesLocal(cases) {
    _casesCache = cases;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }

  // Alias kept for backward compat in this file
  function saveCases(cases) { saveCasesLocal(cases); }

  function showTopLoader() {
    const l = document.getElementById('pageLoader');
    if (!l) return;
    l.classList.remove('done');
    const bar = l.querySelector('.page-loader-bar');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
  }
  function hideTopLoader() {
    const l = document.getElementById('pageLoader');
    if (l) l.classList.add('done');
  }

  async function fetchCasesFromServer() {
    showTopLoader();
    try {
      const res = await fetch('/api/cases');
      const json = await res.json();
      if (json.success && Array.isArray(json.cases)) {
        // Server is source-of-truth — use server cases directly
        const serverMap = new Map(json.cases.map(c => [c.id, c]));

        // Clean up stale deleted IDs: if a case exists on server, it's not deleted
        try {
          const deletedIds = safeJSONParse(localStorage.getItem('gst_deleted_cases'), []);
          const stillDeleted = deletedIds.filter(id => !serverMap.has(id));
          localStorage.setItem('gst_deleted_cases', JSON.stringify(stillDeleted));
        } catch {}

        // Merge local-only fields (like businessName set at create time)
        const local = loadCases();
        local.forEach(lc => {
          if (!serverMap.has(lc.id)) return; // orphaned local case — discard
          const sc = serverMap.get(lc.id);
          if (!sc.businessName && lc.businessName) {
            serverMap.set(lc.id, { ...sc, ...lc, progress: sc.progress ?? lc.progress, status: sc.status || lc.status });
          }
        });
        const merged = Array.from(serverMap.values()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        _casesCache = merged;
        saveCasesLocal(merged);
        hideTopLoader();
        return merged;
      }
    } catch (err) {
      console.warn('Failed to fetch cases from server, using localStorage fallback', err);
    }
    hideTopLoader();
    return loadCases();
  }

  async function pushCaseToServer(c) {
    try {
      await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c)
      });
    } catch { /* best-effort */ }
  }

  async function deleteCaseFromServer(caseId) {
    try {
      const res = await fetch('/api/cases/' + encodeURIComponent(caseId), { method: 'DELETE' });
      if (!res.ok) console.error('Server delete failed:', res.status);
      return res.ok;
    } catch (err) {
      console.error('Delete request failed:', err);
      return false;
    }
  }

  function loadUIState() {
    const raw = localStorage.getItem(UI_KEY);
    const data = safeJSONParse(raw, {});
    return data && typeof data === 'object' ? data : {};
  }

  function saveUIState(state) {
    localStorage.setItem(UI_KEY, JSON.stringify(state));
  }

  function idFromTime() {
    // Reminder: not cryptographic; fine for local demo.
    const t = Date.now().toString(36).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CASE-${t}-${r}`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function calcProgressFromStatus(status) {
    if (status === STATUS.COMPLETED) return 100;
    if (status === STATUS.ONGOING) return 55;
    return 0;
  }

  function normalizeModuleStatus(s) {
    const v = (s || '').toString().trim();
    if (v === 'completed' || v === 'in_progress' || v === 'pending') return v;
    return 'pending';
  }

  function readWorkspaceModuleStatuses(caseId) {
    const prefix = caseWorkspacePrefix(caseId);
    const raw = localStorage.getItem(`${prefix}moduleStatuses`);
    const parsed = safeJSONParse(raw, null);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  }

  function computeProgressFromModuleStatuses(statuses) {
    if (!statuses || typeof statuses !== 'object') return null;
    const weights = { pending: 0, in_progress: 0.5, completed: 1 };
    const total = WORKSPACE_MODULE_KEYS.length;
    const done = WORKSPACE_MODULE_KEYS.reduce((sum, key) => {
      const st = normalizeModuleStatus(statuses[key]);
      return sum + (weights[st] ?? 0);
    }, 0);
    return Math.round((done / Math.max(1, total)) * 100);
  }

  function deriveStatusFromModuleStatuses(statuses) {
    if (!statuses || typeof statuses !== 'object') return null;
    const values = WORKSPACE_MODULE_KEYS.map((k) => normalizeModuleStatus(statuses[k]));
    if (values.every((s) => s === 'completed')) return STATUS.COMPLETED;
    return STATUS.ONGOING;
  }

  function deriveRisk({ purpose, businessType, gstin, cin }) {
    const text = `${purpose || ''} ${businessType || ''}`.toLowerCase();
    const hasGov = text.includes('government') || text.includes('govt');
    const hasHighRisk =
      text.includes('cash') ||
      text.includes('trading') ||
      text.includes('import') ||
      text.includes('export') ||
      text.includes('real estate') ||
      text.includes('construction') ||
      text.includes('crypto') ||
      text.includes('money');

    if (hasGov) return RISK.LOW;
    if (hasHighRisk) return RISK.HIGH;
    if (gstin || cin) return RISK.MEDIUM;
    return RISK.MEDIUM;
  }

  function sanitizeText(v) {
    return (v ?? '').toString().trim();
  }

  function normalizeGSTIN(v) {
    const s = sanitizeText(v).toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    return s;
  }

  function normalizeCIN(v) {
    const s = sanitizeText(v).toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    return s;
  }

  function statusLabel(status) {
    if (status === STATUS.COMPLETED) return 'Completed';
    return 'In Progress';
  }

  function riskLabel(risk) {
    if (risk === RISK.HIGH) return 'High';
    if (risk === RISK.LOW) return 'Low';
    return 'Medium';
  }

  function riskBadgeColor(risk) {
    if (risk === RISK.HIGH) return { bg: 'rgba(185, 28, 28, 0.08)', border: 'rgba(185, 28, 28, 0.28)', text: '#7f1d1d' };
    if (risk === RISK.LOW) return { bg: 'rgba(15, 118, 110, 0.08)', border: 'rgba(15, 118, 110, 0.28)', text: '#0f766e' };
    return { bg: 'rgba(180, 83, 9, 0.08)', border: 'rgba(180, 83, 9, 0.28)', text: '#8a4b10' };
  }

  function getMonthKey(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function lastNMonths(n) {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < n; i++) {
      const key = getMonthKey(d.toISOString());
      out.unshift(key);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }

  function showToast(msg) {
    const toast = document.querySelector('[data-toast]');
    if (!toast) return;
    toast.hidden = false;
    toast.textContent = msg;
    toast.setAttribute('data-show', 'true');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      toast.setAttribute('data-show', 'false');
    }, 2400);
  }

  // Canvas chart helpers
  function setupHiDPICanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(10, Math.floor(rect.width));
    const h = Math.max(10, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function clearChart(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
  }

  function drawDonut(canvas, segments, options) {
    const { ctx, w, h } = setupHiDPICanvas(canvas);
    clearChart(ctx, w, h);

    const padding = 14;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - padding;
    const thickness = clamp(radius * 0.35, 14, 22);

    const total = segments.reduce((a, s) => a + s.value, 0);
    const startAngle = -Math.PI / 2;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#eef2f7';
    ctx.lineWidth = thickness;
    ctx.stroke();

    let angle = startAngle;
    segments.forEach((s) => {
      const frac = total ? s.value / total : 0;
      const next = angle + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle, next);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.stroke();
      angle = next;
    });

    // Center label
    ctx.fillStyle = '#0b1f3a';
    ctx.font = '900 16px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(options?.centerText || '', cx, cy);

    ctx.fillStyle = '#475569';
    ctx.font = '800 11px ui-sans-serif, system-ui';
    ctx.fillText(options?.subText || '', cx, cy + 20);
  }

  function drawBars(canvas, labels, values, options) {
    const { ctx, w, h } = setupHiDPICanvas(canvas);
    clearChart(ctx, w, h);

    const padding = { t: 14, r: 12, b: 22, l: 12 };
    const innerW = w - padding.l - padding.r;
    const innerH = h - padding.t - padding.b;

    const max = Math.max(1, ...values);
    const count = labels.length || 1;
    const gap = 10;
    const barW = clamp((innerW - gap * (count - 1)) / count, 18, 44);

    // grid line
    ctx.strokeStyle = '#eef2f7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t + innerH);
    ctx.lineTo(padding.l + innerW, padding.t + innerH);
    ctx.stroke();

    labels.forEach((lab, i) => {
      const v = values[i] || 0;
      const bh = (v / max) * (innerH - 6);
      const x = padding.l + i * (barW + gap);
      const y = padding.t + (innerH - bh);

      // bar
      ctx.fillStyle = options?.barColor || '#1d4ed8';
      roundRect(ctx, x, y, barW, bh, 8);
      ctx.fill();

      // label
      ctx.fillStyle = '#475569';
      ctx.font = '800 10px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(lab, x + barW / 2, padding.t + innerH + 6);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function el(id) {
    return document.getElementById(id);
  }

  function q(sel) {
    return document.querySelector(sel);
  }

  function qa(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function ensureSeedCases() {
    // Seed only once for demo; if user deletes, don't resurrect.
    if (localStorage.getItem(SEEDED_KEY) === 'true') return;
    const cases = loadCases();
    if (cases.length) return;

    const seed = [
      {
        id: idFromTime(),
        businessName: 'Aarav Traders',
        businessType: 'Proprietorship',
        purpose: 'Working Capital Limit',
        gstin: '27AAEPM1234C1Z9',
        cin: '',
        assignedTo: 'Executive A',
        status: STATUS.PENDING,
        risk: RISK.MEDIUM,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        progress: 12
      },
      {
        id: idFromTime(),
        businessName: 'Sapphire Engineering Pvt Ltd',
        businessType: 'Private Limited',
        purpose: 'Term Loan',
        gstin: '29AACCS1234E1Z7',
        cin: 'U28999KA2020PTC123456',
        assignedTo: 'Executive B',
        status: STATUS.ONGOING,
        risk: RISK.MEDIUM,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        progress: 58
      },
      {
        id: idFromTime(),
        businessName: 'GreenField Foods',
        businessType: 'Partnership',
        purpose: 'OD Renewal',
        gstin: '',
        cin: '',
        assignedTo: 'Executive A',
        status: STATUS.COMPLETED,
        risk: RISK.LOW,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        progress: 100
      }
    ];

    saveCases(seed);
    localStorage.setItem(SEEDED_KEY, 'true');
  }

  async function deleteCaseById(caseId) {
    const all = loadCases();
    const next = all.filter((c) => c.id !== caseId);
    saveCases(next);
    purgeCaseWorkspace(caseId);
    // Track deleted IDs so fetchCasesFromServer won't re-push them
    try {
      const deleted = safeJSONParse(localStorage.getItem('gst_deleted_cases'), []);
      if (!deleted.includes(caseId)) deleted.push(caseId);
      localStorage.setItem('gst_deleted_cases', JSON.stringify(deleted));
    } catch {}
    await deleteCaseFromServer(caseId);
  }

  function getFilteredCases(allCases, filters) {
    const q = (filters.search || '').toLowerCase();

    return allCases
      .filter((c) => {
        if (filters.kpi && filters.kpi !== 'all') {
          if (c.status !== filters.kpi) return false;
        }
        if (filters.status && filters.status !== 'all') {
          if (c.status !== filters.status) return false;
        }

        if (filters.risk && filters.risk !== 'all') {
          if (c.risk !== filters.risk) return false;
        }
        if (q) {
          const hay = `${c.id} ${c.businessName} ${c.businessType} ${c.purpose} ${c.gstin} ${c.cin} ${c.assignedTo}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function computeKPIs(cases) {
    const total = cases.length;
    const completed = cases.filter((c) => c.status === STATUS.COMPLETED).length;
    const ongoing = total - completed;

    return { total, ongoing, completed };
  }

  function renderKPIs(kpis, activeKpi) {
    // KPI strip uses buttons with data-filter and value targets with data-kpi.
    const valueMap = {
      total: kpis.total,
      ongoing: kpis.ongoing,
      completed: kpis.completed
    };

    Object.keys(valueMap).forEach((k) => {
      const node = q(`[data-kpi="${k}"]`);
      if (node) node.textContent = String(valueMap[k] ?? 0);
    });

    qa('.kpi[data-filter]').forEach((btn) => {
      const f = btn.getAttribute('data-filter') || 'all';
      btn.setAttribute('data-active', String(activeKpi === f));
    });
  }

  function percent(n, d) {
    if (!d) return '0%';
    return `${Math.round((n / d) * 100)}%`;
  }

  function stageLabel(status) {
    if (status === STATUS.COMPLETED) return 'Final Report';
    if (status === STATUS.ONGOING) return 'Verification';
    return 'Initiation';
  }

  const MODULE_LABELS = {
    gst: 'GST', mca: 'MCA', compliance: 'Compliance', pan: 'PAN', udyam: 'Udyam',
    itr: 'ITR', bank_statement: 'Bank', financial: 'Financial', field_data: 'Field'
  };

  function renderCards(cases) {
    const tbody = document.getElementById('caseGridBody') || el('caseGrid');
    const empty = el('emptyState');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!cases.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    cases.forEach((c) => {
      // Respect explicit 'completed' from server (set when Done is clicked)
      const derivedStatus = c.status === STATUS.COMPLETED
        ? STATUS.COMPLETED
        : (deriveStatusFromModuleStatuses(c.moduleStatuses || readWorkspaceModuleStatuses(c.id)) || STATUS.ONGOING);

      const created = new Date(c.createdAt || nowISO()).toLocaleDateString('en-IN');

      const tr = document.createElement('tr');
      tr.dataset.status = derivedStatus;
      tr.style.cursor = 'pointer';

      tr.innerHTML = `
        <td data-label="Business"><strong>${escapeHTML(c.businessName || '—')}</strong></td>
        <td data-label="Case ID" class="mono" style="font-size:11px">${escapeHTML(c.id)}</td>
        <td data-label="Type">${escapeHTML(c.businessType || '—')}</td>
        <td data-label="Status"><span class="status-pill" data-status="${escapeHTML(derivedStatus)}"><span class="status-dot"></span>${escapeHTML(statusLabel(derivedStatus))}</span></td>
        <td data-label="Executive">${escapeHTML(c.assignedTo || '—')}</td>
        <td data-label="Created">${escapeHTML(created)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-danger btn-sm" type="button" data-action="delete" style="padding:4px 10px;font-size:11px">Delete</button>
          <button class="btn btn-primary btn-sm" type="button" data-action="open" style="padding:4px 10px;font-size:11px">Open</button>
        </td>
      `;

      // Row click opens case (except button clicks)
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openCase(c);
      });

      tr.querySelector('[data-action="open"]')?.addEventListener('click', () => openCase(c));
      tr.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = window.confirm(`Delete case ${c.id}?\n\nThis will permanently delete this case and all its data.`);
        if (!ok) return;
        showToast('Deleting case…');
        await deleteCaseById(c.id);
        showToast('Case deleted.');
        applyAndRender();
      });
      tbody.appendChild(tr);
    });
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderCharts(allCases) {
    const kpis = computeKPIs(allCases);

    const statusCanvas = el('chartStatus');
    const monthlyCanvas = el('chartMonthly');
    const riskCanvas = el('chartRisk');

    if (statusCanvas) {
      drawDonut(
        statusCanvas,
        [
          { label: 'In Progress', value: kpis.ongoing, color: '#1d4ed8' },
          { label: 'Completed', value: kpis.completed, color: '#0f766e' }
        ],
        { centerText: String(kpis.total), subText: 'Total Cases' }
      );
    }

    if (monthlyCanvas) {
      const months = lastNMonths(6);
      const counts = months.map((m) => allCases.filter((c) => getMonthKey(c.createdAt) === m).length);
      const labels = months.map((m) => {
        const [y, mo] = m.split('-');
        return `${mo}/${y.slice(2)}`;
      });
      drawBars(monthlyCanvas, labels, counts, { barColor: '#0b1f3a' });
    }

    if (riskCanvas) {
      const low = allCases.filter((c) => c.risk === RISK.LOW).length;
      const med = allCases.filter((c) => c.risk === RISK.MEDIUM).length;
      const high = allCases.filter((c) => c.risk === RISK.HIGH).length;
      drawDonut(
        riskCanvas,
        [
          { label: 'Low', value: low, color: '#0f766e' },
          { label: 'Medium', value: med, color: '#b45309' },
          { label: 'High', value: high, color: '#b91c1c' }
        ],
        { centerText: percent(high, allCases.length), subText: 'High Risk' }
      );
    }
  }

  function getActiveFilters() {
    const ui = loadUIState();

    const kpiAllowed = new Set(['all', STATUS.PENDING, STATUS.ONGOING, STATUS.COMPLETED]);
    const kpi = kpiAllowed.has(ui.kpi) ? ui.kpi : 'all';

    const statusAllowed = new Set(['all', STATUS.PENDING, STATUS.ONGOING, STATUS.COMPLETED]);
    const statusRaw = el('statusFilter')?.value || ui.status || 'all';
    const status = statusAllowed.has(statusRaw) ? statusRaw : 'all';

    const riskAllowed = new Set(['all', RISK.LOW, RISK.MEDIUM, RISK.HIGH]);
    const riskRaw = el('riskFilter')?.value || ui.risk || 'all';
    const risk = riskAllowed.has(riskRaw) ? riskRaw : 'all';

    return {
      kpi,
      status,
      risk,
      search: el('searchInput')?.value || ui.search || ''
    };
  }

  function setActiveFilters(next) {
    const current = loadUIState();
    const ui = { ...current, ...next };
    saveUIState(ui);

    if (typeof next.search === 'string' && el('searchInput')) el('searchInput').value = next.search;
    if (typeof next.status === 'string' && el('statusFilter')) el('statusFilter').value = next.status;
    if (typeof next.risk === 'string' && el('riskFilter')) el('riskFilter').value = next.risk;
  }

  function applyAndRender() {
    const all = loadCases();
    const filters = getActiveFilters();

    const kpis = computeKPIs(all);
    renderKPIs(kpis, filters.kpi);

    const filtered = getFilteredCases(all, filters);
    renderCards(filtered);
    renderCharts(all);
    populateRVCaseDropdown();

    const subtitle = el('queueSubtitle');
    if (subtitle) {
      subtitle.textContent = `Showing ${filtered.length} of ${all.length} cases • In Progress ${kpis.ongoing} • Completed ${kpis.completed}`;
    }
  }

  function openModal() {
    const modal = el('createCaseModal') || q('[data-modal]');
    if (!modal) return;
    modal.hidden = false;

    window.setTimeout(() => {
      el('businessName')?.focus();
    }, 0);
  }

  function closeModal() {
    const modal = el('createCaseModal') || q('[data-modal]');
    if (!modal) return;
    modal.hidden = true;
    resetCreateForm();
  }

  function resetCreateForm() {
    const form = q('[data-form="create"]');
    if (form && typeof form.reset === 'function') form.reset();

    // Defensive: clear by ids too (if form.reset() doesn't cover custom widgets)
    ['businessName', 'businessType', 'purpose', 'gstin', 'cin', 'assigned'].forEach((id) => {
      const node = el(id);
      if (node && 'value' in node) node.value = '';
    });
  }

  function createCaseFromForm() {
    const businessName = sanitizeText(el('businessName')?.value);
    const businessType = sanitizeText(el('businessType')?.value);
    const purpose = sanitizeText(el('purpose')?.value);
    const gstin = normalizeGSTIN(el('gstin')?.value);
    const cin = normalizeCIN(el('cin')?.value);
    const assignedTo = sanitizeText(el('assigned')?.value);

    if (!businessName) {
      showToast('Business Name is required.');
      el('businessName')?.focus();
      return null;
    }
    if (!businessType) {
      showToast('Business Type is required.');
      el('businessType')?.focus();
      return null;
    }
    if (!purpose) {
      showToast('Purpose is required.');
      el('purpose')?.focus();
      return null;
    }
    if (!assignedTo) {
      showToast('Assigned Executive is required.');
      el('assigned')?.focus();
      return null;
    }

    const createdAt = nowISO();
    const status = STATUS.ONGOING;

    const next = {
      id: idFromTime(),
      businessName,
      businessType,
      purpose,
      gstin,
      cin,
      assignedTo,
      status,
      risk: deriveRisk({ purpose, businessType, gstin, cin }),
      createdAt,
      updatedAt: createdAt,
      progress: 0
    };

    return next;
  }

  function addCase(newCase) {
    const all = loadCases();
    all.unshift(newCase);
    saveCases(all);
    pushCaseToServer(newCase);
  }

  function openCase(c, opts = {}) {
    // Query params consumed by case-workspace.js: caseId, businessName, businessType, assignedTo, gstin, cin
    // Optional: view=blocks to start in block selection mode
    const url = new URL('/case-workspace', window.location.origin);
    url.searchParams.set('caseId', c.id);
    url.searchParams.set('businessName', c.businessName || '');
    url.searchParams.set('businessType', c.businessType || '');
    url.searchParams.set('assignedTo', c.assignedTo || '');
    if (c.gstin) url.searchParams.set('gstin', c.gstin);
    if (c.cin) url.searchParams.set('cin', c.cin);

    const view = (opts.view || 'blocks').toString().trim();
    if (view) url.searchParams.set('view', view);
    window.location.href = url.toString();
  }

  function bindEvents() {
    qa('[data-action="open-create"]').forEach((btn) => btn.addEventListener('click', openModal));

    qa('[data-action="close-create"]').forEach((btn) => btn.addEventListener('click', closeModal));

    el('createCaseModal')?.addEventListener('click', (e) => {
      if (e.target && e.target.matches('[data-backdrop]')) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      const modal = el('createCaseModal');
      if (!modal || modal.hidden) return;
      if (e.key === 'Escape') closeModal();
    });

    q('[data-form="create"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = createCaseFromForm();
      if (!next) return;
      addCase(next);
      closeModal();

      // New flow: after create, show block selection first.
      openCase(next, { view: 'blocks' });
    });

    el('searchInput')?.addEventListener('input', (e) => {
      const v = e.target.value || '';
      setActiveFilters({ search: v });
      applyAndRender();
    });

    el('statusFilter')?.addEventListener('change', (e) => {
      const v = e.target.value || 'all';
      setActiveFilters({ status: v });
      applyAndRender();
    });

    el('riskFilter')?.addEventListener('change', (e) => {
      const v = e.target.value || 'all';
      setActiveFilters({ risk: v });
      applyAndRender();
    });

    qa('.kpi[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') || 'all';
        setActiveFilters({ kpi: filter });
        applyAndRender();
      });
    });
  }

  function hydrateUIFromStorage() {
    const ui = loadUIState();
    // Always reset KPI filter to 'all' on page load so all cases are visible
    if (ui.kpi && ui.kpi !== 'all') {
      ui.kpi = 'all';
      saveUIState(ui);
    }
    if (ui.search && el('searchInput')) el('searchInput').value = ui.search;
    if (ui.status && el('statusFilter')) el('statusFilter').value = ui.status;
    if (ui.risk && el('riskFilter')) el('riskFilter').value = ui.risk;
  }

  function initRoleSelector() {
    const role = el('roleSelect');
    if (!role) return;

    const ui = loadUIState();
    if (ui.role) role.value = ui.role;

    role.addEventListener('change', () => {
      setActiveFilters({ role: role.value });
      showToast(`Role: ${role.value}`);
    });
  }

  /* ── Resident Verification on Dashboard ── */
  let rvImages = [];
  let rvSelectedCaseId = '';

  function populateRVCaseDropdown() {
    const select = el('rvCaseSelect');
    if (!select) return;
    const cases = loadCases();
    select.innerHTML = '<option value="">— Select Case —</option>';
    cases.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.id + ' — ' + (c.businessName || 'Untitled');
      select.appendChild(opt);
    });
  }

  async function loadRVData(caseId) {
    if (!caseId) return;
    rvSelectedCaseId = caseId;
    // Load address from resident_verification
    try {
      const addrRes = await fetch('/case-data/' + encodeURIComponent(caseId) + '/snapshots/resident_verification.latest.json');
      if (addrRes.ok) {
        const json = await addrRes.json();
        const d = json?.data || json?.data?.primary || {};
        const p = d.primary || d;
        if (el('rvAddress')) el('rvAddress').value = p.address || '';
        if (el('rvLocality')) el('rvLocality').value = p.locality || '';
        if (el('rvCity')) el('rvCity').value = p.city || '';
        if (el('rvState')) el('rvState').value = p.state || '';
        if (el('rvPincode')) el('rvPincode').value = p.pincode || '';
        if (el('rvLandmark')) el('rvLandmark').value = p.landmark || '';
        if (el('rvRemarks')) el('rvRemarks').value = p.remarks || '';
      }
    } catch { /* no saved address */ }
    // Load images from resident_verification_images
    try {
      const imgRes = await fetch('/case-data/' + encodeURIComponent(caseId) + '/snapshots/resident_verification_images.latest.json');
      if (imgRes.ok) {
        const json = await imgRes.json();
        rvImages = (json?.data?.images || []).slice();
      } else {
        rvImages = [];
      }
    } catch {
      rvImages = [];
    }
    renderRVImages();
  }

  function renderRVImages() {
    const grid = el('rvImgGrid');
    if (!grid) return;
    if (!rvImages.length) {
      grid.innerHTML = '<div style="padding:8px 0;font-size:12px;color:#94a3b8;">No images uploaded yet.</div>';
      return;
    }
    grid.innerHTML = rvImages.map(function (img, idx) {
      return '<div class="rv-img-card">' +
        '<img src="' + escapeHTML(img.dataUrl || '') + '" alt="' + escapeHTML(img.label || '') + '" />' +
        '<div class="rv-img-card-label"><span>' + escapeHTML(img.label || 'Image ' + (idx + 1)) + '</span>' +
        '<button class="rv-img-card-remove" type="button" data-rv-remove="' + idx + '" title="Remove">&times;</button></div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('[data-rv-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = parseInt(btn.getAttribute('data-rv-remove'), 10);
        if (!isNaN(i) && i >= 0 && i < rvImages.length) {
          rvImages.splice(i, 1);
          renderRVImages();
        }
      });
    });
  }

  function addRVImage() {
    const labelEl = el('rvImgLabel');
    const fileEl = el('rvImgFile');
    if (!fileEl || !fileEl.files || !fileEl.files.length) {
      showToast('Please select an image file.');
      return;
    }
    const label = (labelEl?.value || '').trim() || 'Image ' + (rvImages.length + 1);
    const file = fileEl.files[0];
    const reader = new FileReader();
    reader.onload = function (e) {
      rvImages.push({ label: label, dataUrl: e.target.result, name: file.name, addedAt: new Date().toISOString() });
      renderRVImages();
      if (labelEl) labelEl.value = '';
      fileEl.value = '';
      showToast('Image added: ' + label);
    };
    reader.readAsDataURL(file);
  }

  function collectRVAddress() {
    return {
      address: (el('rvAddress')?.value || '').trim(),
      locality: (el('rvLocality')?.value || '').trim(),
      city: (el('rvCity')?.value || '').trim(),
      state: (el('rvState')?.value || '').trim(),
      pincode: (el('rvPincode')?.value || '').trim(),
      landmark: (el('rvLandmark')?.value || '').trim(),
      remarks: (el('rvRemarks')?.value || '').trim()
    };
  }

  async function saveRVToServer() {
    if (!rvSelectedCaseId) {
      showToast('Please select and load a case first.');
      return;
    }
    const statusEl = el('rvSaveStatus');
    if (statusEl) statusEl.textContent = 'Saving…';

    try {
      // Save address
      const addrPayload = { primary: collectRVAddress() };
      await fetch('/api/case/save-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: rvSelectedCaseId, moduleKey: 'resident_verification', data: addrPayload })
      });

      // Save images
      await fetch('/api/case/save-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: rvSelectedCaseId, moduleKey: 'resident_verification_images', data: { images: rvImages } })
      });

      showToast('Resident Verification saved for ' + rvSelectedCaseId);
      if (statusEl) statusEl.textContent = 'Saved at ' + new Date().toLocaleTimeString();
    } catch (err) {
      showToast('Save failed: ' + (err.message || err));
      if (statusEl) statusEl.textContent = 'Save failed';
    }
  }

  function initResidentVerification() {
    populateRVCaseDropdown();

    const loadBtn = el('rvLoadBtn');
    if (loadBtn) {
      loadBtn.addEventListener('click', function () {
        const caseId = el('rvCaseSelect')?.value;
        if (!caseId) {
          showToast('Please select a case first.');
          return;
        }
        // Clear fields before loading
        ['rvAddress', 'rvLocality', 'rvCity', 'rvState', 'rvPincode', 'rvLandmark', 'rvRemarks'].forEach(function (id) {
          if (el(id)) el(id).value = '';
        });
        rvImages = [];
        renderRVImages();
        loadRVData(caseId);
        showToast('Loading data for ' + caseId + '…');
      });
    }

    const addImgBtn = el('rvImgAddBtn');
    if (addImgBtn) addImgBtn.addEventListener('click', addRVImage);

    const saveBtn = el('rvSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveRVToServer);
  }

  async function init() {
    hydrateUIFromStorage();
    bindEvents();
    applyAndRender(); // render immediately from localStorage

    // Then sync from server and re-render
    await fetchCasesFromServer();
    applyAndRender();

    window.addEventListener('resize', () => {
      renderCharts(loadCases());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
