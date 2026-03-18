/**
 * Financial Calculation Dashboard — Frontend JS
 * ================================================
 * Communicates with /api/financial-calc/* endpoints.
 * Dynamically renders input forms from schema and displays results.
 * Supports push-to-report via case snapshot system.
 */

(function () {
  'use strict';

  const API_BASE = '/api/financial-calc';
  let schema = null;
  let yearCount = 3;
  let activeYear = 0;
  let lastResult = null;

  // Section icons & colors
  const SECTION_META = {
    profitability_statement: { icon: '📊', accent: '#2563eb', label: 'Profitability Statement (P&L)' },
    balance_sheet_assets:    { icon: '🏦', accent: '#059669', label: 'Balance Sheet — Assets' },
    balance_sheet_liabilities: { icon: '📋', accent: '#d97706', label: 'Balance Sheet — Liabilities' },
  };

  // ─── Element references ────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const yearTabsEl = $('#yearTabs');
  const yearFormsEl = $('#yearForms');
  const calculateBtn = $('#calculateBtn');
  const clearAllBtn = $('#clearAllBtn');
  const loadSampleBtn = $('#loadSampleBtn');
  const exportJsonBtn = $('#exportJsonBtn');
  const copyJsonBtn = $('#copyJsonBtn');
  const resultsSection = $('#resultsSection');

  // ─── Init ──────────────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(`${API_BASE}/schema`);
      const json = await res.json();
      if (json.success) {
        schema = json.data;
        buildForms();
      } else {
        toast('Failed to load schema', 'error');
      }
    } catch (e) {
      toast('Cannot connect to server', 'error');
      console.error(e);
    }

    // Bind events
    calculateBtn.addEventListener('click', runCalculation);
    clearAllBtn.addEventListener('click', clearAll);
    loadSampleBtn.addEventListener('click', loadSample);
    exportJsonBtn.addEventListener('click', exportJson);
    copyJsonBtn?.addEventListener('click', copyJson);
    yearTabsEl.addEventListener('click', handleTabClick);
    $('#addYearBtn')?.addEventListener('click', addYear);
    $('#pushReportBtn')?.addEventListener('click', pushToReport);
  }

  // ─── Build Forms from Schema ───────────────────────────────────────
  function buildForms() {
    yearFormsEl.innerHTML = '';
    for (let yi = 0; yi < yearCount; yi++) {
      const form = document.createElement('div');
      form.className = `year-form ${yi === activeYear ? 'active' : ''}`;
      form.dataset.year = yi;

      // Metadata section
      const metaHtml = `
        <div class="form-section section-meta">
          <div class="form-section-head" onclick="this.parentElement.classList.toggle('collapsed')">
            <span class="section-icon">⚙️</span> Year ${yi + 1} — Metadata & Settings
          </div>
          <div class="form-section-body">
            <div class="meta-row">
              ${schema.metadata_fields.map(f => {
                let defVal = f.default != null ? f.default : '';
                return `
                <div class="input-group-sm">
                  <label for="y${yi}_${f.key}">${f.label}</label>
                  <input type="${f.type === 'number' ? 'number' : 'text'}"
                    id="y${yi}_${f.key}" class="input" data-year="${yi}" data-field="${f.key}"
                    placeholder="${defVal}" value="${defVal}" />
                </div>
              `}).join('')}
            </div>
            <div class="meta-note">Defaults: 12 months, CA qualification, AUDITED. Change if needed — values push to report.</div>
          </div>
        </div>
      `;

      // Financial field sections
      const sectionDefs = [
        { key: 'profitability_statement', start: 'net_sales', end: 'gross_cash_accruals' },
        { key: 'balance_sheet_assets', start: 'gross_block', end: 'total_assets' },
        { key: 'balance_sheet_liabilities', start: 'paid_up_equity_share_capital', end: 'total_liabilities' },
      ];

      let sectionsHtml = '';
      for (const sec of sectionDefs) {
        const meta = SECTION_META[sec.key];
        const fields = getFieldsForSection(sec.start, sec.end);
        const inputCount = fields.filter(f => !f.computed).length;
        const computedCount = fields.filter(f => f.computed).length;
        sectionsHtml += `
          <div class="form-section section-${sec.key}" style="--section-accent: ${meta.accent}">
            <div class="form-section-head" onclick="this.parentElement.classList.toggle('collapsed')">
              <span class="section-icon">${meta.icon}</span>
              <span class="section-title">${meta.label}</span>
              <span class="section-badge">${inputCount} inputs · ${computedCount} auto</span>
            </div>
            <div class="form-section-body">
              <div class="field-grid-header">
                <span class="fgh-label">Field</span>
                <span class="fgh-value">Amount (₹)</span>
              </div>
              ${fields.map((f, idx) => `
                <div class="field-row ${f.computed ? 'computed' : ''} ${idx % 2 === 0 ? 'even' : 'odd'}">
                  <div class="field-label">
                    <span class="field-num">${idx + 1}.</span>
                    ${esc(f.label)}
                    ${f.computed ? '<span class="auto-badge">AUTO</span>' : ''}
                  </div>
                  <input type="number" step="any"
                    class="input input-number field-input ${f.computed ? 'computed-field' : ''}"
                    id="y${yi}_${f.key}" data-year="${yi}" data-field="${f.key}"
                    placeholder="${f.computed ? 'Auto' : '0.00'}" value=""
                    ${f.computed ? 'disabled' : ''} />
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      form.innerHTML = metaHtml + sectionsHtml;
      yearFormsEl.appendChild(form);
    }
  }

  function getFieldsForSection(startKey, endKey) {
    const fields = schema.financial_fields;
    let collecting = false;
    const result = [];
    for (const f of fields) {
      if (f.key === startKey) collecting = true;
      if (collecting) result.push(f);
      if (f.key === endKey) break;
    }
    return result;
  }

  // ─── Tab Management ────────────────────────────────────────────────
  function handleTabClick(e) {
    const tab = e.target.closest('.year-tab');
    if (!tab) return;
    const yi = parseInt(tab.dataset.year, 10);
    setActiveYear(yi);
  }

  function setActiveYear(yi) {
    activeYear = yi;
    $$('.year-tab').forEach(t => t.classList.toggle('active', parseInt(t.dataset.year, 10) === yi));
    $$('.year-form').forEach(f => f.classList.toggle('active', parseInt(f.dataset.year, 10) === yi));
  }

  function addYear() {
    if (yearCount >= 5) { toast('Maximum 5 years supported', 'warn'); return; }
    yearCount++;
    renderTabs();
    buildForms();
    setActiveYear(yearCount - 1);
  }

  function renderTabs() {
    const tabsHtml = Array.from({ length: yearCount }, (_, i) =>
      `<button class="year-tab ${i === activeYear ? 'active' : ''}" data-year="${i}">Year ${i + 1}${i === 0 ? ' (Latest)' : ''}</button>`
    ).join('');
    yearTabsEl.innerHTML = tabsHtml + `<button class="btn btn-sm btn-primary" id="addYearBtn" title="Add Year">+ Add Year</button>`;
    yearTabsEl.querySelector('#addYearBtn')?.addEventListener('click', addYear);
  }

  // ─── Collect Form Data ─────────────────────────────────────────────
  function collectInput() {
    const years = [];
    for (let yi = 0; yi < yearCount; yi++) {
      const yearData = {};
      const inputs = yearFormsEl.querySelectorAll(`[data-year="${yi}"]`);
      inputs.forEach(inp => {
        const key = inp.dataset.field;
        const val = inp.type === 'number' ? parseFloat(inp.value) || 0 : inp.value;
        yearData[key] = val;
      });
      years.push(yearData);
    }

    return {
      company_name: $('#companyName')?.value || '',
      gstin: $('#gstinInput')?.value || '',
      case_id: $('#caseIdInput')?.value || '',
      years,
    };
  }

  // ─── Run Calculation ───────────────────────────────────────────────
  async function runCalculation() {
    const input = collectInput();
    const overlay = $('#calcOverlay');
    overlay.hidden = false;

    try {
      const res = await fetch(`${API_BASE}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      overlay.hidden = true;

      if (json.success) {
        lastResult = json.data;
        fillComputedFields(json.data);
        renderResults(json.data, json.warnings);
        // Auto-collapse form sections to avoid showing parameters twice
        collapseFormSections();
        toast('Calculation complete!', 'success');
      } else {
        toast(json.errors?.join(', ') || 'Calculation failed', 'error');
      }
    } catch (e) {
      overlay.hidden = true;
      toast('Calculation request failed', 'error');
      console.error(e);
    }
  }

  // ─── Push to Report (Save to Case) ────────────────────────────────
  async function pushToReport() {
    if (!lastResult) { toast('Run calculation first before pushing to report', 'warn'); return; }
    const caseId = ($('#caseIdInput')?.value || '').trim();
    if (!caseId) { toast('Enter a Case ID to push financial data to report', 'warn'); return; }

    const btn = $('#pushReportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
      const payload = {
        caseId: caseId,
        moduleKey: 'financial',
        data: {
          source: 'financial-calc-dashboard',
          savedAt: new Date().toISOString(),
          input: collectInput(),
          output: lastResult,
        }
      };
      const res = await fetch('/api/case/save-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json?.success) {
        toast('Financial data pushed to report! Open Report Builder to use it.', 'success');
      } else {
        toast(json?.error || 'Failed to save to case', 'error');
      }
    } catch (e) {
      toast('Failed to push to report', 'error');
      console.error(e);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="btn-icon">📤</span> Push to Report'; }
    }
  }

  // ─── Render Results ────────────────────────────────────────────────
  function renderResults(data, warnings) {
    resultsSection.hidden = false;

    // Eligibility cards
    const elig = data.eligibility || {};
    const flags = elig.flags || {};
    const cardsHtml = [
      cardHtml('Grade', elig.grade || 'N/A', `Score: ${elig.score}/${elig.max_score}`, `grade-${(elig.grade || 'poor').toLowerCase()}`),
      cardHtml('Net Worth', fmt(elig.net_worth), 'Tangible Net Worth', elig.net_worth > 0 ? 'pass' : 'fail'),
      cardHtml('Total Debt', fmt(elig.total_debt), '', ''),
      cardHtml('Max Term Loan (Ind.)', fmt(elig.max_term_loan_indicative), 'Indicative', ''),
      cardHtml('Max WC (Ind.)', fmt(elig.max_working_capital_indicative), 'Indicative', ''),
      ...Object.entries(flags).map(([k, v]) =>
        cardHtml(k.replace(/_/g, ' '), v ? '✓ PASS' : '✗ FAIL', '', v ? 'pass' : 'fail')
      ),
    ].join('');
    $('#eligibilityCards').innerHTML = cardsHtml;

    // Ratio tables
    renderRatioTable('#profitabilityTable', data.profitability, '%');
    renderRatioTable('#liquidityTable', data.liquidity);
    renderRatioTable('#leverageTable', data.leverage);
    renderRatioTable('#growthTable', data.growth, '%');
    renderRatioTable('#turnoverTable', data.years?.[0]?.computed?.turnover || {});
    renderRatioTable('#derivedTable', data.derived_metrics);

    // Yearwise detail table
    renderYearwiseTable(data.years || []);

    // JSON output
    const jsonStr = JSON.stringify(data, null, 2);
    $('#jsonOutput').textContent = jsonStr;

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cardHtml(label, value, sub, cls) {
    return `
      <div class="summary-card ${cls}">
        <div class="summary-card-label">${esc(label)}</div>
        <div class="summary-card-value">${esc(String(value))}</div>
        ${sub ? `<div class="summary-card-sub">${esc(sub)}</div>` : ''}
      </div>
    `;
  }

  function renderRatioTable(selector, obj, suffix = '') {
    const el = document.querySelector(selector);
    if (!el || !obj) return;
    el.innerHTML = Object.entries(obj).map(([k, v]) => {
      const num = typeof v === 'number' ? v : 0;
      const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : 'neutral';
      return `
        <div class="ratio-row">
          <div class="ratio-label">${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
          <div class="ratio-value ${cls}">${fmt(num)}${suffix}</div>
        </div>
      `;
    }).join('');
  }

  function renderYearwiseTable(years) {
    const el = $('#yearwiseDetail');
    if (!el || !years.length) return;

    // Keys to split Balance Sheet into Assets vs Liabilities
    const BS_ASSET_KEYS = [
      'gross_block', 'accumulated_depreciation', 'net_block',
      'capital_work_in_progress', 'net_fixed_assets',
      'investments_affiliate', 'non_current_investments', 'non_current_loans_advances',
      'deferred_tax_assets', 'other_non_current_assets', 'non_current_assets',
      'receivables_gt6m', 'receivables_lt6m', 'provision_doubtful_debts', 'bills_receivable',
      'total_receivables',
      'investments_marketable_securities', 'loans_advances_subsidiaries', 'loans_advances_affiliates',
      'loans_advances_current_ops', 'cash_and_bank', 'total_inventories_non_ops',
      'loans_advances_non_ops', 'advance_tax_paid', 'total_other_assets',
      'total_current_assets_ops', 'total_current_assets', 'total_assets',
    ];
    const BS_LIABILITY_KEYS = [
      'paid_up_equity_share_capital', 'reserves_surplus', 'share_application_money', 'quasi_equity',
      'gross_reserves', 'intangible_assets', 'misc_expenses_not_written_off', 'debit_balance_pnl',
      'net_reserves', 'tangible_net_worth',
      'deferred_payment_credit', 'rupee_term_loans', 'total_long_term_debt',
      'long_term_provisions', 'other_long_term_liabilities', 'current_portion_ltd', 'net_long_term_debt',
      'working_capital_bank_borrowings', 'intercorporate_borrowings',
      'loans_advances_from_subsidiaries', 'loans_advances_from_promoters',
      'other_short_term_loans', 'new_short_term_loans', 'total_short_term_debt',
      'creditors_for_goods', 'creditors_for_expenses', 'other_current_liabilities_ops',
      'current_liabilities_non_ops', 'total_other_liabilities',
      'provision_dividend', 'provision_taxes', 'other_provisions_regular', 'total_provisions',
      'total_current_liabilities_ops', 'total_outside_liabilities', 'total_liabilities',
    ];

    // Computed field keys (formulas — highlight these rows)
    const COMPUTED_KEYS = new Set([
      'total_operating_income', 'cost_of_sales', 'pbildt', 'pbit', 'opbt', 'pbt', 'apbt', 'pat', 'gross_cash_accruals',
      'net_block', 'net_fixed_assets', 'non_current_assets', 'total_receivables',
      'total_current_assets_ops', 'total_current_assets', 'total_assets',
      'gross_reserves', 'net_reserves', 'tangible_net_worth', 'total_long_term_debt', 'net_long_term_debt',
      'total_short_term_debt', 'total_other_liabilities', 'total_provisions',
      'total_current_liabilities_ops', 'total_outside_liabilities', 'total_liabilities',
    ]);

    const headers = ['Metric', ...years.map(y => y.period || 'Year')];

    const sections = [
      { title: '📊 Profitability Statement', key: 'profit_and_loss', filterKeys: null },
      { title: '🏦 Balance Sheet — Assets', key: 'balance_sheet', filterKeys: BS_ASSET_KEYS },
      { title: '📋 Balance Sheet — Liabilities', key: 'balance_sheet', filterKeys: BS_LIABILITY_KEYS },
      { title: '💧 Liquidity Ratios', key: 'liquidity', filterKeys: null },
      { title: '🏗️ Capital Structure', key: 'capital_structure', filterKeys: null },
      { title: '📈 Profitability Ratios', key: 'profitability', filterKeys: null },
      { title: '🚀 Growth Ratios', key: 'growth', filterKeys: null },
      { title: '🔄 Turnover Ratios', key: 'turnover', filterKeys: null },
      { title: '🛡️ Solvency Ratios', key: 'solvency', filterKeys: null },
    ];

    let tableHtml = `<table class="yearwise-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;

    for (const sec of sections) {
      tableHtml += `<tr class="section-header"><td colspan="${headers.length}">${sec.title}</td></tr>`;

      let orderedKeys;
      if (sec.filterKeys) {
        // Use predefined order (Assets or Liabilities)
        orderedKeys = sec.filterKeys.filter(k => {
          return years.some(y => y.computed?.[sec.key]?.[k] !== undefined);
        });
      } else {
        // Collect all keys in appearance order
        const allKeys = [];
        const seen = new Set();
        years.forEach(y => {
          const obj = y.computed?.[sec.key];
          if (obj) Object.keys(obj).forEach(k => { if (!seen.has(k)) { seen.add(k); allKeys.push(k); } });
        });
        orderedKeys = allKeys;
      }

      for (const k of orderedKeys) {
        const isComputed = COMPUTED_KEYS.has(k);
        const rowCls = isComputed ? ' class="computed-row"' : '';
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        tableHtml += `<tr${rowCls}><td>${isComputed ? '<b>' + label + '</b>' : label}</td>`;
        for (const y of years) {
          const v = y.computed?.[sec.key]?.[k];
          tableHtml += `<td>${typeof v === 'number' ? fmt(v) : esc(String(v ?? ''))}</td>`;
        }
        tableHtml += `</tr>`;
      }
    }

    tableHtml += `</tbody></table>`;
    el.innerHTML = tableHtml;
  }

  // ─── Utilities ─────────────────────────────────────────────────────
  function fmt(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function collapseFormSections() {
    $$('.form-section').forEach(sec => sec.classList.add('collapsed'));
  }

  function expandFormSections() {
    $$('.form-section').forEach(sec => sec.classList.remove('collapsed'));
  }

  function clearAll() {
    $$('.field-input').forEach(inp => { inp.value = ''; });
    expandFormSections();
    // Re-set metadata defaults
    for (let yi = 0; yi < yearCount; yi++) {
      if (schema?.metadata_fields) {
        schema.metadata_fields.forEach(f => {
          const inp = document.getElementById(`y${yi}_${f.key}`);
          if (inp && f.default != null) inp.value = f.default;
        });
      }
    }
    resultsSection.hidden = true;
    lastResult = null;
    toast('All fields cleared (defaults restored)', 'success');
  }

  function fillComputedFields(data) {
    if (!data?.years) return;
    data.years.forEach((y, yi) => {
      const pl = y.computed?.profit_and_loss || {};
      const bs = y.computed?.balance_sheet || {};
      const all = { ...pl, ...bs };
      Object.entries(all).forEach(([k, v]) => {
        const inp = document.getElementById(`y${yi}_${k}`);
        if (inp && inp.disabled) {
          inp.value = typeof v === 'number' ? parseFloat(v.toFixed(2)) : v;
        }
      });
    });
  }

  function exportJson() {
    if (!lastResult) { toast('Run calculation first', 'warn'); return; }
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial_calc_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyJson() {
    if (!lastResult) { toast('Run calculation first', 'warn'); return; }
    navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2))
      .then(() => toast('JSON copied!', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  }

  // ─── Sample Data ───────────────────────────────────────────────────
  function loadSample() {
    const sample = {
      y0: {
        period_ends_on: '3/31/2025', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 5000000, other_income_operations: 100000, handling_costs: 50000,
        cost_of_traded_goods: 2500000, consumable_stores: 100000, power_and_fuel: 80000,
        employee_costs: 500000, other_expenses: 200000, selling_expenses: 50000,
        other_related_expenses: 30000, depreciation: 200000,
        interest_and_finance_charges: 300000, non_operating_income_expense: 50000,
        cash_adjustments: 0, extraordinary_adjustments: 0,
        current_tax: 310000, provision_deferred_tax: 20000,
        gross_block: 3000000, accumulated_depreciation: 800000,
        capital_work_in_progress: 100000,
        investments_affiliate: 0, non_current_investments: 0,
        non_current_loans_advances: 0, deferred_tax_assets: 0, other_non_current_assets: 0,
        receivables_gt6m: 100000, receivables_lt6m: 400000,
        provision_doubtful_debts: 10000, bills_receivable: 50000,
        investments_marketable_securities: 50000,
        loans_advances_subsidiaries: 0, loans_advances_affiliates: 0,
        loans_advances_current_ops: 200000, cash_and_bank: 500000,
        total_inventories_non_ops: 100000, loans_advances_non_ops: 50000,
        advance_tax_paid: 80000, total_other_assets: 50000,
        paid_up_equity_share_capital: 1000000, reserves_surplus: 500000,
        share_application_money: 0, quasi_equity: 0,
        intangible_assets: 50000, misc_expenses_not_written_off: 0, debit_balance_pnl: 0,
        deferred_payment_credit: 0, rupee_term_loans: 500000,
        long_term_provisions: 0, other_long_term_liabilities: 0, current_portion_ltd: 100000,
        working_capital_bank_borrowings: 300000, intercorporate_borrowings: 0,
        loans_advances_from_subsidiaries: 0, loans_advances_from_promoters: 0,
        other_short_term_loans: 0, new_short_term_loans: 0,
        creditors_for_goods: 200000, creditors_for_expenses: 80000,
        other_current_liabilities_ops: 150000, current_liabilities_non_ops: 0,
        provision_dividend: 50000, provision_taxes: 50000, other_provisions_regular: 0,
      },
      y1: {
        period_ends_on: '3/31/2024', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 4200000, other_income_operations: 80000, handling_costs: 40000,
        cost_of_traded_goods: 2100000, consumable_stores: 80000, power_and_fuel: 70000,
        employee_costs: 450000, other_expenses: 180000, selling_expenses: 40000,
        other_related_expenses: 20000, depreciation: 180000,
        interest_and_finance_charges: 280000, non_operating_income_expense: 40000,
        cash_adjustments: 0, extraordinary_adjustments: 0,
        current_tax: 240000, provision_deferred_tax: 15000,
        gross_block: 2700000, accumulated_depreciation: 700000,
        capital_work_in_progress: 80000,
        investments_affiliate: 0, non_current_investments: 0,
        non_current_loans_advances: 0, deferred_tax_assets: 0, other_non_current_assets: 0,
        receivables_gt6m: 80000, receivables_lt6m: 350000,
        provision_doubtful_debts: 8000, bills_receivable: 40000,
        investments_marketable_securities: 40000,
        loans_advances_subsidiaries: 0, loans_advances_affiliates: 0,
        loans_advances_current_ops: 180000, cash_and_bank: 400000,
        total_inventories_non_ops: 80000, loans_advances_non_ops: 40000,
        advance_tax_paid: 60000, total_other_assets: 40000,
        paid_up_equity_share_capital: 1000000, reserves_surplus: 350000,
        share_application_money: 0, quasi_equity: 0,
        intangible_assets: 40000, misc_expenses_not_written_off: 0, debit_balance_pnl: 0,
        deferred_payment_credit: 0, rupee_term_loans: 600000,
        long_term_provisions: 0, other_long_term_liabilities: 0, current_portion_ltd: 100000,
        working_capital_bank_borrowings: 350000, intercorporate_borrowings: 0,
        loans_advances_from_subsidiaries: 0, loans_advances_from_promoters: 0,
        other_short_term_loans: 0, new_short_term_loans: 0,
        creditors_for_goods: 180000, creditors_for_expenses: 70000,
        other_current_liabilities_ops: 120000, current_liabilities_non_ops: 0,
        provision_dividend: 40000, provision_taxes: 40000, other_provisions_regular: 0,
      },
      y2: {
        period_ends_on: '3/31/2023', result_type: 'AUDITED', auditor_qualification: 'CA', no_of_months: 12,
        net_sales: 3800000, other_income_operations: 60000, handling_costs: 30000,
        cost_of_traded_goods: 1900000, consumable_stores: 60000, power_and_fuel: 60000,
        employee_costs: 400000, other_expenses: 170000, selling_expenses: 30000,
        other_related_expenses: 15000, depreciation: 160000,
        interest_and_finance_charges: 260000, non_operating_income_expense: 30000,
        cash_adjustments: 0, extraordinary_adjustments: 0,
        current_tax: 210000, provision_deferred_tax: 10000,
        gross_block: 2400000, accumulated_depreciation: 600000,
        capital_work_in_progress: 60000,
        investments_affiliate: 0, non_current_investments: 0,
        non_current_loans_advances: 0, deferred_tax_assets: 0, other_non_current_assets: 0,
        receivables_gt6m: 60000, receivables_lt6m: 300000,
        provision_doubtful_debts: 5000, bills_receivable: 30000,
        investments_marketable_securities: 30000,
        loans_advances_subsidiaries: 0, loans_advances_affiliates: 0,
        loans_advances_current_ops: 150000, cash_and_bank: 300000,
        total_inventories_non_ops: 60000, loans_advances_non_ops: 30000,
        advance_tax_paid: 50000, total_other_assets: 30000,
        paid_up_equity_share_capital: 1000000, reserves_surplus: 200000,
        share_application_money: 0, quasi_equity: 0,
        intangible_assets: 30000, misc_expenses_not_written_off: 0, debit_balance_pnl: 0,
        deferred_payment_credit: 0, rupee_term_loans: 700000,
        long_term_provisions: 0, other_long_term_liabilities: 0, current_portion_ltd: 100000,
        working_capital_bank_borrowings: 400000, intercorporate_borrowings: 0,
        loans_advances_from_subsidiaries: 0, loans_advances_from_promoters: 0,
        other_short_term_loans: 0, new_short_term_loans: 0,
        creditors_for_goods: 160000, creditors_for_expenses: 60000,
        other_current_liabilities_ops: 100000, current_liabilities_non_ops: 0,
        provision_dividend: 30000, provision_taxes: 30000, other_provisions_regular: 0,
      },
    };

    const yearMap = [sample.y0, sample.y1, sample.y2];
    yearMap.forEach((data, yi) => {
      Object.entries(data).forEach(([key, val]) => {
        const inp = document.getElementById(`y${yi}_${key}`);
        if (inp) inp.value = val;
      });
    });

    toast('Sample data loaded — click Calculate', 'success');
  }

  // ─── Start ─────────────────────────────────────────────────────────
  init();
})();
