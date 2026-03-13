/**
 * Financial Calculation Dashboard — Frontend JS
 * ================================================
 * Communicates with /api/financial-calc/* endpoints.
 * Dynamically renders input forms from schema and displays results.
 */

(function () {
  'use strict';

  const API_BASE = '/api/financial-calc';
  let schema = null;
  let yearCount = 3;
  let activeYear = 0;
  let lastResult = null;

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
  }

  // ─── Build Forms from Schema ───────────────────────────────────────
  function buildForms() {
    yearFormsEl.innerHTML = '';
    for (let yi = 0; yi < yearCount; yi++) {
      const form = document.createElement('div');
      form.className = `year-form ${yi === activeYear ? 'active' : ''}`;
      form.dataset.year = yi;

      // Metadata row
      const metaHtml = `
        <div class="form-section">
          <div class="form-section-head">Year ${yi + 1} Metadata</div>
          <div class="form-section-body">
            <div class="meta-row">
              ${schema.metadata_fields.map(f => `
                <div class="input-group-sm">
                  <label for="y${yi}_${f.key}">${f.label}</label>
                  <input type="${f.type === 'number' ? 'number' : 'text'}"
                    id="y${yi}_${f.key}" class="input" data-year="${yi}" data-field="${f.key}"
                    placeholder="${f.default || ''}" value="${f.default || ''}" />
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      // Financial field sections
      const sectionDefs = [
        { key: 'profitability_statement', label: 'Profitability Statement', start: 'net_sales', end: 'apat' },
        { key: 'balance_sheet_assets', label: 'Balance Sheet: Assets', start: 'gross_block', end: 'total_assets' },
        { key: 'balance_sheet_liabilities', label: 'Balance Sheet: Liabilities', start: 'paid_up_equity_share_capital', end: 'total_liabilities' },
      ];

      let sectionsHtml = '';
      for (const sec of sectionDefs) {
        const fields = getFieldsForSection(sec.start, sec.end);
        sectionsHtml += `
          <div class="form-section">
            <div class="form-section-head" onclick="this.parentElement.classList.toggle('collapsed')">${sec.label}</div>
            <div class="form-section-body">
              ${fields.map(f => `
                <div class="field-row">
                  <div class="field-label">
                    ${f.label}
                    <span class="field-hint">(Row ${f.row})</span>
                  </div>
                  <input type="number" step="any"
                    class="input input-number field-input"
                    id="y${yi}_${f.key}" data-year="${yi}" data-field="${f.key}"
                    placeholder="0.00" value="" />
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
    // Re‑bind addYear
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
        renderResults(json.data, json.warnings);
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

    const headers = ['Metric', ...years.map(y => y.period || 'Year')];
    const sections = [
      { title: 'Profitability Statement', key: 'profit_and_loss' },
      { title: 'Balance Sheet', key: 'balance_sheet' },
      { title: 'Liquidity', key: 'liquidity' },
      { title: 'Capital Structure', key: 'capital_structure' },
      { title: 'Profitability Ratios', key: 'profitability' },
      { title: 'Growth', key: 'growth' },
      { title: 'Turnover', key: 'turnover' },
      { title: 'Solvency', key: 'solvency' },
    ];

    let tableHtml = `<table class="yearwise-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;

    for (const sec of sections) {
      tableHtml += `<tr class="section-header"><td colspan="${headers.length}">${esc(sec.title)}</td></tr>`;
      const allKeys = new Set();
      years.forEach(y => {
        const obj = y.computed?.[sec.key];
        if (obj) Object.keys(obj).forEach(k => allKeys.add(k));
      });
      for (const k of allKeys) {
        tableHtml += `<tr><td>${k.replace(/_/g, ' ')}</td>`;
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

  function clearAll() {
    $$('.field-input').forEach(inp => { inp.value = 0; });
    resultsSection.hidden = true;
    lastResult = null;
    toast('All fields cleared', 'success');
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
        other_related_expenses: 30000, pbildt: 1690000, depreciation: 200000,
        pbit: 1490000, interest_and_finance_charges: 300000, opbt: 1190000,
        non_operating_income_expense: 50000, pbt: 1240000, cash_adjustments: 0,
        apbt: 1240000, tax: 310000, provision_deferred_tax: 20000, apat: 910000,
        // Balance Sheet Assets
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
        // Balance Sheet Liabilities
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
        total_outside_liabilities: 1430000, total_liabilities: 3830000,
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
        total_long_term_debt: 600000, total_short_term_debt: 350000,
        creditors_for_goods: 180000, creditors_for_expenses: 70000,
        total_outside_liabilities: 1300000, net_fixed_assets: 2150000,
        total_receivables: 800000, gross_cash_accruals: 900000,
        net_long_term_debt: 500000, quasi_equity: 0,
        total_investments: 40000,
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
        total_long_term_debt: 700000, total_short_term_debt: 400000,
        creditors_for_goods: 160000, creditors_for_expenses: 60000,
        total_outside_liabilities: 1200000, net_fixed_assets: 2000000,
        total_receivables: 700000, net_long_term_debt: 600000, quasi_equity: 0,
      },
    };

    // Set values on form
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
