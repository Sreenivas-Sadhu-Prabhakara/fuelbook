'use strict';
/* fuelbook UI — wires the DOM to the pure engine (data/engine.js).
   No inline handlers (CSP), no network (CSP blocks it anyway).
   All persistent state lives in localStorage under one namespaced key. */

(function () {
  const E = window.FUELBOOK;
  const STORE_KEY = 'fuelbook.v1';

  /* ---------- state ---------- */

  const DEFAULT_SETTINGS = {
    name: '',
    type: 'two-wheeler',
    currency: '₹',
    units: 'metric',   // 'metric' (km + L) | 'us' (mi + gal)
    grouping: 'indian',
    claimed: ''        // free-text number, "as entered by you"
  };

  let state = load();
  let editingFillId = null;
  let editingExpenseId = null;
  let idCounter = 0;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          fills: Array.isArray(s.fills) ? s.fills : [],
          expenses: Array.isArray(s.expenses) ? s.expenses : [],
          settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {}),
          sample: !!s.sample
        };
      }
    } catch (e) { /* corrupted store — start fresh */ }
    return { fills: [], expenses: [], settings: Object.assign({}, DEFAULT_SETTINGS), sample: false };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function genId(prefix) {
    idCounter += 1;
    return prefix + Date.now().toString(36) + '-' + idCounter;
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- unit labels ---------- */

  function U() {
    const metric = state.settings.units === 'metric';
    return {
      metric,
      dist: metric ? 'km' : 'mi',
      vol: metric ? 'litres' : 'gallons',
      volShort: metric ? 'L' : 'gal',
      eff: metric ? 'km/L' : 'mpg',
      perDist: metric ? '/km' : '/mi'
    };
  }

  const LABELS = {
    odo:  (u) => 'Odometer (' + u.dist + ')',
    vol:  (u) => u.metric ? 'Litres' : 'Gallons',
    amt:  () => 'Total amount',
    amt2: () => 'Amount',
    odo2: (u) => 'Odometer (' + u.dist + ')',
    vol2: (u) => u.metric ? 'Litres' : 'Gallons',
    ppu:  (u) => 'Price/' + u.volShort,
    claimed: (u) => 'Claimed ' + u.eff + ' (optional)'
  };

  /* ---------- DOM helpers ---------- */

  const $ = (sel) => document.querySelector(sel);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) n.appendChild(c);
    return n;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  function money(minor) {
    return E.formatMinor(minor, state.settings.currency, state.settings.grouping);
  }

  function fmt2(x) { return x === null || x === undefined ? '—' : E.round2(x).toFixed(2); }

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function shortDate(iso) { // 2026-06-21 -> 21 Jun
    return +iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1].slice(0, 3);
  }

  /* ---------- render: everything ---------- */

  function renderAll() {
    renderUnitLabels();
    renderSampleBanner();
    renderStats();
    renderChart();
    renderFills();
    renderExpenses();
    renderSettingsInputs();
    renderPrintSummary();
  }

  function renderUnitLabels() {
    const u = U();
    document.querySelectorAll('[data-label]').forEach((n) => {
      const fn = LABELS[n.getAttribute('data-label')];
      if (fn) n.textContent = fn(u);
    });
  }

  function renderSampleBanner() {
    $('#sample-banner').hidden = !state.sample;
    $('#btn-sample').hidden = state.fills.length > 0 || state.expenses.length > 0;
  }

  /* ---------- stats ---------- */

  function statCard(label, value, sub, windowText) {
    return el('div', { class: 'stat-card' }, [
      el('div', { class: 'stat-label', text: label }),
      el('div', { class: 'stat-value', text: value }),
      el('div', { class: 'stat-sub', text: sub || '' }),
      el('div', { class: 'stat-window', text: windowText || '' })
    ]);
  }

  function renderStats() {
    const u = U();
    const grid = $('#stats-grid');
    grid.textContent = '';
    const fills = state.fills;
    const segs = E.computeSegments(fills);
    const life = E.lifetimeStats(fills);
    const fuel = E.fuelCostPerKm(fills);
    const allIn = E.allInCostPerKm(fills, state.expenses);
    const winText = life.kmPerL !== null
      ? 'window: ' + shortDate(life.firstFullDate) + ' → ' + shortDate(life.lastFullDate) + ' (first FULL to last FULL)'
      : 'window: needs two FULL fills';

    // lifetime efficiency
    if (life.kmPerL !== null) {
      const sub = u.metric ? E.lPer100km(life.kmPerL).toFixed(2) + ' L/100km · ' + life.km + ' ' + u.dist + ' on ' + E.formatMilli(life.milli) + ' ' + u.volShort : life.km + ' ' + u.dist + ' on ' + E.formatMilli(life.milli) + ' ' + u.volShort;
      grid.appendChild(statCard('Lifetime ' + u.eff, fmt2(life.kmPerL), sub, winText));
    } else {
      grid.appendChild(statCard('Lifetime ' + u.eff, '—', 'need two full fills to compute', winText));
    }

    // best / worst tank
    if (segs.length) {
      let best = segs[0], worst = segs[0];
      for (const s of segs) { if (s.kmPerL > best.kmPerL) best = s; if (s.kmPerL < worst.kmPerL) worst = s; }
      grid.appendChild(statCard('Best tank', fmt2(best.kmPerL) + ' ' + u.eff, 'ended ' + shortDate(best.endDate) + (best.includesPartial ? ' · includes partial' : ''), 'window: that tank only'));
      grid.appendChild(statCard('Worst tank', fmt2(worst.kmPerL) + ' ' + u.eff, 'ended ' + shortDate(worst.endDate) + (worst.includesPartial ? ' · includes partial' : ''), 'window: that tank only'));
    } else {
      grid.appendChild(statCard('Best tank', '—', 'no full-to-full tank yet', 'window: needs two FULL fills'));
      grid.appendChild(statCard('Worst tank', '—', 'no full-to-full tank yet', 'window: needs two FULL fills'));
    }

    // fuel cost / km
    grid.appendChild(statCard('Fuel cost' + u.perDist,
      fuel.value !== null ? money(Math.round(fuel.value * 100)) : '—',
      fuel.value !== null ? money(fuel.windowMinor) + ' fuel over ' + fuel.km + ' ' + u.dist : 'need two full fills to compute',
      winText));

    // all-in cost / km
    let allInSub = 'need two full fills to compute';
    if (allIn.value !== null) {
      allInSub = 'fuel + ' + money(allIn.includedExpenseMinor) + ' expenses';
      if (allIn.excluded.length) allInSub += ' · ' + allIn.excluded.length + ' expense' + (allIn.excluded.length > 1 ? 's' : '') + ' waiting for next full fill';
    }
    grid.appendChild(statCard('All-in cost' + u.perDist,
      allIn.value !== null ? money(Math.round(allIn.value * 100)) : '—',
      allInSub, winText));

    // this-month fuel spend
    const now = todayISO();
    const monthSpend = E.monthFuelSpendMinor(fills, now.slice(0, 7));
    grid.appendChild(statCard('Fuel spend — ' + MONTHS[+now.slice(5, 7) - 1] + ' ' + now.slice(0, 4),
      money(monthSpend), 'all fills dated this calendar month', 'window: this calendar month'));

    // total distance logged
    grid.appendChild(statCard('Total ' + u.dist + ' logged', String(E.totalKmLogged(fills)),
      fills.length + ' fill-up' + (fills.length === 1 ? '' : 's') + ' recorded', 'window: first to last entry, all fills'));

    // excluded-entries note
    const note = $('#excluded-note');
    if (life.kmPerL !== null && (life.excludedBefore > 0 || life.excludedAfter > 0)) {
      const parts = [];
      if (life.excludedBefore) parts.push(life.excludedBefore + ' before your first FULL');
      if (life.excludedAfter) parts.push(life.excludedAfter + ' after your last FULL');
      note.textContent = 'Excluded from ' + u.eff + ': ' + parts.join(' and ') + ' — those entries join the figures after your next full fill.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  /* ---------- chart ---------- */

  function renderChart() {
    const u = U();
    const box = $('#chart');
    box.textContent = '';
    const segs = E.computeSegments(state.fills);
    const trendNote = $('#trend-note');
    trendNote.hidden = true;

    const W = 680, H = 260, mL = 48, mR = 18, mT = 18, mB = 40;
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-labelledby': 'chart-title' });
    svg.appendChild(svgEl('title', { id: 'chart-title', text: 'Tank-to-tank ' + u.eff + ' trend chart' }));

    if (!segs.length) {
      // the motif: the gauge at E — nothing to show yet
      const g = svgEl('g');
      g.appendChild(svgEl('path', { d: 'M280 160 A60 60 0 0 1 400 160', class: 'c-empty-arc' }));
      g.appendChild(svgEl('line', { x1: 340, y1: 160, x2: 288, y2: 128, class: 'c-empty-needle' }));
      g.appendChild(svgEl('circle', { cx: 340, cy: 160, r: 7, class: 'c-empty-hub' }));
      g.appendChild(svgEl('text', { x: 268, y: 180, class: 'c-text-strong', text: 'E' }));
      g.appendChild(svgEl('text', { x: 404, y: 180, class: 'c-text-strong', text: 'F' }));
      g.appendChild(svgEl('text', { x: 340, y: 214, 'text-anchor': 'middle', class: 'c-text', text: 'No full-to-full tank yet — the chart starts at your second FULL fill.' }));
      svg.appendChild(g);
      box.appendChild(svg);
      $('#chart-summary').textContent = 'No full-to-full segments yet.';
      $('#claimed-legend').hidden = true;
      return;
    }

    const vals = segs.map((s) => s.kmPerL);
    const claimed = parseFloat(state.settings.claimed);
    const hasClaimed = Number.isFinite(claimed) && claimed > 0;
    $('#claimed-legend').hidden = !hasClaimed;

    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hasClaimed) { lo = Math.min(lo, claimed); hi = Math.max(hi, claimed); }
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    lo -= pad; hi += pad;

    const px = (i) => segs.length === 1 ? (mL + (W - mL - mR) / 2) : mL + (i * (W - mL - mR)) / (segs.length - 1);
    const py = (v) => mT + (hi - v) * (H - mT - mB) / (hi - lo);

    // horizontal grid + y labels
    for (let g = 0; g <= 3; g++) {
      const v = lo + ((hi - lo) * g) / 3;
      const y = py(v);
      svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: W - mR, y2: y, class: 'c-grid' }));
      svg.appendChild(svgEl('text', { x: mL - 6, y: y + 4, 'text-anchor': 'end', class: 'c-text', text: v.toFixed(1) }));
    }

    // claimed reference (dotted) — user-entered
    if (hasClaimed) {
      const y = py(claimed);
      svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: W - mR, y2: y, class: 'c-claimed' }));
      svg.appendChild(svgEl('text', { x: W - mR, y: y - 5, 'text-anchor': 'end', class: 'c-text', text: 'claimed ' + claimed + ' (as entered by you)' }));
    }

    // trailing rolling average (up to 3 tanks incl. current) — dashed sand line
    const avgPts = vals.map((_, i) => {
      const from = Math.max(0, i - 2);
      const slice = vals.slice(from, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
    svg.appendChild(svgEl('polyline', { points: avgPts.map((v, i) => px(i) + ',' + py(v)).join(' '), class: 'c-avg' }));

    // the km/L line + dots (partials get a square marker, not just a colour)
    svg.appendChild(svgEl('polyline', { points: vals.map((v, i) => px(i) + ',' + py(v)).join(' '), class: 'c-line' }));
    segs.forEach((s, i) => {
      if (s.includesPartial) {
        svg.appendChild(svgEl('rect', { x: px(i) - 4.5, y: py(s.kmPerL) - 4.5, width: 9, height: 9, class: 'c-dot-partial' }));
      } else {
        svg.appendChild(svgEl('circle', { cx: px(i), cy: py(s.kmPerL), r: 5, class: 'c-dot' }));
      }
      // x labels (thin out when crowded)
      const step = Math.ceil(segs.length / 8);
      if (i % step === 0 || i === segs.length - 1) {
        svg.appendChild(svgEl('text', { x: px(i), y: H - mB + 18, 'text-anchor': 'middle', class: 'c-text', text: shortDate(s.endDate) }));
      }
    });
    svg.appendChild(svgEl('text', { x: mL, y: 12, class: 'c-text', text: u.eff + ' per tank · square marker = includes partial fill' }));
    box.appendChild(svg);

    // screen-reader summary
    const latest = vals[vals.length - 1];
    $('#chart-summary').textContent = segs.length + ' tank segment' + (segs.length > 1 ? 's' : '') + '. Latest ' + fmt2(latest) + ' ' + u.eff + ' ending ' + segs[segs.length - 1].endDate + '. Best ' + fmt2(Math.max(...vals)) + ', worst ' + fmt2(Math.min(...vals)) + '.';

    // trend prompt (neutral, never a diagnosis)
    const tAvg = E.trailingAvgBefore(vals, 3);
    if (E.isBelowAverage(latest, tAvg)) {
      trendNote.textContent = 'Latest tank ' + fmt2(latest) + ' ' + u.eff + ' is more than 10% below your trailing 3-tank average (' + fmt2(tAvg) + ') — below your average; check tyre pressure, service due, or fuel quality. This is a prompt, not a diagnosis.';
      trendNote.hidden = false;
    }
  }

  /* ---------- fills table ---------- */

  function renderFills() {
    const u = U();
    const body = $('#fills-body');
    body.textContent = '';
    const sorted = E.sortFills(state.fills).reverse(); // newest first
    $('#fills-empty').hidden = sorted.length > 0;

    for (const f of sorted) {
      const price = E.pricePerUnitMinor(f.minor, f.milli);
      const tr = el('tr', null, [
        el('td', { text: f.date }),
        el('td', { class: 'num', text: String(f.odo) }),
        el('td', { class: 'num', text: E.formatMilli(f.milli) }),
        el('td', { class: 'num', text: money(f.minor) }),
        el('td', { class: 'num', text: price !== null ? money(price) : '—' }),
        el('td', null, [el('span', { class: f.full ? 'badge badge-full' : 'badge badge-partial', text: f.full ? 'FULL' : 'PARTIAL' })]),
        el('td', { text: f.note || '' }),
        el('td', { class: 'row-actions' }, [
          el('button', { type: 'button', class: 'link-btn', 'data-act': 'edit-fill', 'data-id': f.id, text: 'Edit' }),
          el('button', { type: 'button', class: 'link-btn danger', 'data-act': 'del-fill', 'data-id': f.id, text: 'Delete' })
        ])
      ]);
      body.appendChild(tr);
    }
  }

  /* ---------- expenses table ---------- */

  function renderExpenses() {
    const body = $('#expenses-body');
    body.textContent = '';
    const life = E.lifetimeStats(state.fills);
    const sorted = state.expenses.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    $('#expenses-empty').hidden = sorted.length > 0;

    for (const x of sorted) {
      const inWindow = life.kmPerL !== null && x.date >= life.firstFullDate && x.date <= life.lastFullDate;
      const status = inWindow
        ? el('span', { text: 'in all-in ' + U().perDist.slice(1) + ' figure' })
        : el('span', { class: 'badge badge-flag', text: 'waiting for next full fill' });
      const tr = el('tr', null, [
        el('td', { text: x.date }),
        el('td', { text: x.category.charAt(0).toUpperCase() + x.category.slice(1) }),
        el('td', { class: 'num', text: money(x.minor) }),
        el('td', { text: x.note || '' }),
        el('td', null, [status]),
        el('td', { class: 'row-actions' }, [
          el('button', { type: 'button', class: 'link-btn', 'data-act': 'edit-exp', 'data-id': x.id, text: 'Edit' }),
          el('button', { type: 'button', class: 'link-btn danger', 'data-act': 'del-exp', 'data-id': x.id, text: 'Delete' })
        ])
      ]);
      body.appendChild(tr);
    }
  }

  /* ---------- settings ---------- */

  function renderSettingsInputs() {
    $('#s-name').value = state.settings.name;
    $('#s-type').value = state.settings.type;
    $('#s-currency').value = state.settings.currency;
    $('#s-units').value = state.settings.units;
    $('#s-grouping').value = state.settings.grouping;
    $('#s-claimed').value = state.settings.claimed;
  }

  function bindSettings() {
    $('#s-name').addEventListener('change', (e) => { state.settings.name = e.target.value.trim(); save(); renderAll(); });
    $('#s-type').addEventListener('change', (e) => { state.settings.type = e.target.value; save(); });
    $('#s-currency').addEventListener('change', (e) => { state.settings.currency = e.target.value.trim() || '₹'; save(); renderAll(); });
    $('#s-units').addEventListener('change', (e) => { state.settings.units = e.target.value; save(); renderAll(); });
    $('#s-grouping').addEventListener('change', (e) => { state.settings.grouping = e.target.value; save(); renderAll(); });
    $('#s-claimed').addEventListener('change', (e) => { state.settings.claimed = e.target.value.trim(); save(); renderAll(); });
    $('#btn-erase').addEventListener('click', () => {
      if (confirm('Erase ALL fuelbook data in this browser? This cannot be undone. Download your CSVs first if you want a backup.')) {
        state = { fills: [], expenses: [], settings: Object.assign({}, DEFAULT_SETTINGS), sample: false };
        save();
        resetFillForm(); resetExpenseForm();
        renderAll();
      }
    });
  }

  /* ---------- fill form ---------- */

  function resetFillForm() {
    editingFillId = null;
    $('#fill-form').reset();
    $('#f-date').value = todayISO();
    $('#fill-submit').textContent = 'Add fill-up';
    $('#fill-cancel').hidden = true;
    $('#fill-error').hidden = true;
    $('#fill-derived').hidden = true;
  }

  function showDerivedPrice() {
    const u = U();
    const milli = E.parseVolumeToMilli($('#f-litres').value);
    const minor = E.parseAmountToMinor($('#f-amount').value);
    const out = $('#fill-derived');
    if (milli && minor) {
      out.textContent = 'Derived price: ' + money(E.pricePerUnitMinor(minor, milli)) + ' per ' + (u.metric ? 'litre' : 'gallon') + ' (auto-computed from amount ÷ volume).';
      out.hidden = false;
    } else {
      out.hidden = true;
    }
  }

  function bindFillForm() {
    $('#f-litres').addEventListener('input', showDerivedPrice);
    $('#f-amount').addEventListener('input', showDerivedPrice);

    $('#fill-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const u = U();
      const err = $('#fill-error');
      const date = $('#f-date').value;
      const odo = E.parseOdo($('#f-odo').value);
      const milli = E.parseVolumeToMilli($('#f-litres').value);
      const minor = E.parseAmountToMinor($('#f-amount').value);

      let msg = null;
      if (!E.isValidISODate(date)) msg = 'Enter a real date.';
      else if (odo === null) msg = 'Odometer must be a non-negative number (one decimal allowed).';
      else if (milli === null) msg = (u.metric ? 'Litres' : 'Gallons') + ' must be a positive number (up to 3 decimals).';
      else if (minor === null) msg = 'Total amount must be a positive number (up to 2 decimals).';

      if (!msg) {
        const cand = {
          id: editingFillId || genId('f'),
          date, odo, milli, minor,
          full: $('#f-full').checked,
          note: $('#f-note').value.trim()
        };
        const v = E.validateFill(state.fills, cand);
        if (!v.ok) msg = v.error;
        else {
          if (editingFillId) {
            const i = state.fills.findIndex((f) => f.id === editingFillId);
            if (i >= 0) state.fills[i] = cand;
          } else {
            state.fills.push(cand);
          }
          save();
          resetFillForm();
          renderAll();
          return;
        }
      }
      err.textContent = msg;
      err.hidden = false;
    });

    $('#fill-cancel').addEventListener('click', () => { resetFillForm(); });

    $('#fills-body').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'del-fill') {
        if (confirm('Delete this fill-up entry?')) {
          state.fills = state.fills.filter((f) => f.id !== id);
          if (editingFillId === id) resetFillForm();
          save(); renderAll();
        }
      } else {
        const f = state.fills.find((x) => x.id === id);
        if (!f) return;
        editingFillId = id;
        $('#f-date').value = f.date;
        $('#f-odo').value = String(f.odo);
        $('#f-litres').value = E.formatMilli(f.milli);
        $('#f-amount').value = (f.minor / 100).toFixed(2);
        ($('#f-' + (f.full ? 'full' : 'partial'))).checked = true;
        $('#f-note').value = f.note || '';
        $('#fill-submit').textContent = 'Save changes';
        $('#fill-cancel').hidden = false;
        showDerivedPrice();
        $('#f-date').focus();
      }
    });
  }

  /* ---------- expense form ---------- */

  function resetExpenseForm() {
    editingExpenseId = null;
    $('#expense-form').reset();
    $('#e-date').value = todayISO();
    $('#expense-submit').textContent = 'Add expense';
    $('#expense-cancel').hidden = true;
    $('#expense-error').hidden = true;
  }

  function bindExpenseForm() {
    $('#expense-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const err = $('#expense-error');
      const date = $('#e-date').value;
      const minor = E.parseAmountToMinor($('#e-amount').value);
      let msg = null;
      if (!E.isValidISODate(date)) msg = 'Enter a real date.';
      else if (minor === null) msg = 'Amount must be a positive number (up to 2 decimals).';
      if (msg) { err.textContent = msg; err.hidden = false; return; }

      const cand = {
        id: editingExpenseId || genId('e'),
        date,
        category: $('#e-cat').value,
        minor,
        note: $('#e-note').value.trim()
      };
      if (editingExpenseId) {
        const i = state.expenses.findIndex((x) => x.id === editingExpenseId);
        if (i >= 0) state.expenses[i] = cand;
      } else {
        state.expenses.push(cand);
      }
      save();
      resetExpenseForm();
      renderAll();
    });

    $('#expense-cancel').addEventListener('click', () => { resetExpenseForm(); });

    $('#expenses-body').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'del-exp') {
        if (confirm('Delete this expense entry?')) {
          state.expenses = state.expenses.filter((x) => x.id !== id);
          if (editingExpenseId === id) resetExpenseForm();
          save(); renderAll();
        }
      } else {
        const x = state.expenses.find((e2) => e2.id === id);
        if (!x) return;
        editingExpenseId = id;
        $('#e-date').value = x.date;
        $('#e-cat').value = x.category;
        $('#e-amount').value = (x.minor / 100).toFixed(2);
        $('#e-note').value = x.note || '';
        $('#expense-submit').textContent = 'Save changes';
        $('#expense-cancel').hidden = false;
        $('#e-date').focus();
      }
    });
  }

  /* ---------- sample log ---------- */

  function bindSample() {
    $('#btn-sample').addEventListener('click', () => {
      state.fills = E.SAMPLE_FILLS.map((f) => Object.assign({}, f));
      state.expenses = E.SAMPLE_EXPENSES.map((x) => Object.assign({}, x));
      state.sample = true;
      save(); renderAll();
      $('#stats-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#btn-clear-sample').addEventListener('click', () => {
      state.fills = [];
      state.expenses = [];
      state.sample = false;
      save();
      resetFillForm(); resetExpenseForm();
      renderAll();
      $('#f-date').focus();
    });
  }

  /* ---------- CSV export ---------- */

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function bindExport() {
    $('#btn-csv-fills').addEventListener('click', () => {
      const u = U();
      const rows = [['date', 'odometer_' + u.dist, u.vol, 'total_amount', 'price_per_' + (u.metric ? 'litre' : 'gallon'), 'fill_type', 'note']];
      for (const f of E.sortFills(state.fills)) {
        const p = E.pricePerUnitMinor(f.minor, f.milli);
        rows.push([f.date, f.odo, E.formatMilli(f.milli), (f.minor / 100).toFixed(2), p !== null ? (p / 100).toFixed(2) : '', f.full ? 'FULL' : 'PARTIAL', f.note || '']);
      }
      downloadText('fuelbook-fills.csv', E.toCsv(rows));
    });
    $('#btn-csv-expenses').addEventListener('click', () => {
      const life = E.lifetimeStats(state.fills);
      const rows = [['date', 'category', 'amount', 'status', 'note']];
      for (const x of state.expenses.slice().sort((a, b) => (a.date > b.date ? 1 : -1))) {
        const inWindow = life.kmPerL !== null && x.date >= life.firstFullDate && x.date <= life.lastFullDate;
        rows.push([x.date, x.category, (x.minor / 100).toFixed(2), inWindow ? 'in_window' : 'waiting_for_next_full_fill', x.note || '']);
      }
      downloadText('fuelbook-expenses.csv', E.toCsv(rows));
    });
    $('#btn-print').addEventListener('click', () => { renderPrintSummary(); window.print(); });
  }

  /* ---------- print summary ---------- */

  function renderPrintSummary() {
    const u = U();
    const s = state.settings;
    const life = E.lifetimeStats(state.fills);
    const fuel = E.fuelCostPerKm(state.fills);
    const allIn = E.allInCostPerKm(state.fills, state.expenses);
    const segs = E.computeSegments(state.fills);

    $('#print-meta').textContent =
      (s.name ? s.name + ' (' + s.type + ')' : 'Vehicle: ' + s.type) +
      ' · generated ' + todayISO() +
      (state.sample ? ' · SAMPLE DATA — invented demo entries' : '') +
      (life.kmPerL !== null ? ' · window ' + life.firstFullDate + ' → ' + life.lastFullDate + ' (first FULL to last FULL)' : '');

    const stats = $('#print-stats');
    stats.textContent = '';
    const pstat = (label, val) => stats.appendChild(el('div', { class: 'pstat' }, [
      el('span', { text: label }), el('b', { text: val })
    ]));
    pstat('Lifetime ' + u.eff, life.kmPerL !== null ? fmt2(life.kmPerL) : 'need two full fills');
    pstat('Fuel cost' + u.perDist, fuel.value !== null ? money(Math.round(fuel.value * 100)) : '—');
    pstat('All-in cost' + u.perDist, allIn.value !== null ? money(Math.round(allIn.value * 100)) : '—');
    pstat('Total ' + u.dist + ' logged', String(E.totalKmLogged(state.fills)));
    pstat('Fill-ups', String(state.fills.length));
    pstat('Expenses', money(state.expenses.reduce((a, x) => a + x.minor, 0)));

    $('#print-km-h').textContent = u.dist;
    $('#print-vol-h').textContent = u.metric ? 'Litres' : 'Gallons';
    $('#print-eff-h').textContent = u.eff;
    const body = $('#print-segments-body');
    body.textContent = '';
    for (const g of segs) {
      body.appendChild(el('tr', null, [
        el('td', { text: g.startDate + ' → ' + g.endDate }),
        el('td', { class: 'num', text: String(g.km) }),
        el('td', { class: 'num', text: E.formatMilli(g.milli) }),
        el('td', { class: 'num', text: fmt2(g.kmPerL) }),
        el('td', { text: g.includesPartial ? 'includes partial' : '' })
      ]));
    }
    $('#print-footer').textContent = 'Full-to-full method: each tank runs between consecutive FULL fills; partial top-ups are folded into the tank they belong to. Figures are only as accurate as the entries. Informational only — not professional advice. Generated by fuelbook (offline, no cloud).';
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    resetFillForm();
    resetExpenseForm();
    bindFillForm();
    bindExpenseForm();
    bindSettings();
    bindSample();
    bindExport();
    renderAll();
  });
})();
