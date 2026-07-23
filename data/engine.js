'use strict';
/* ============================================================
   fuelbook engine — pure functions, no DOM, no I/O.
   Loaded by the browser as a global (window.FUELBOOK) and by
   `node --test` via require(). Every formula the app shows is
   defined HERE and only here.

   Conventions:
   - Money is INTEGER minor units (paise/cents). Never float rupees.
   - Volume is INTEGER thousandths (millilitres in km+L mode,
     milligallons in mi+gal mode) — the arithmetic is unit-blind.
   - Odometer readings allow one decimal; distances are rounded
     to one decimal to kill float drift.
   - Dates are ISO YYYY-MM-DD strings, validated with real month
     lengths and leap years.
   ============================================================ */

/* ---------- rounding ---------- */

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function round1(x) {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/* ---------- dates ---------- */

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) { // m: 1..12
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/* ---------- input parsing (string -> integer units) ---------- */

// "9.84" -> 9840 (thousandths). Rejects junk, zero, negatives.
function parseVolumeToMilli(s) {
  const t = String(s).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const v = Number(w) * 1000 + Number((f + '000').slice(0, 3));
  return v > 0 ? v : null;
}

// "945.00" -> 94500 (minor units). Rejects junk, zero, negatives.
function parseAmountToMinor(s) {
  const t = String(s).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return v > 0 ? v : null;
}

// Odometer: whole units with at most one decimal. 0 allowed.
function parseOdo(s) {
  const t = String(s).trim();
  if (!/^\d+(\.\d)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/* ---------- fill validation ---------- */

/**
 * A fill: { id, date, odo, milli, minor, full, note }
 * Rules (stated in the UI):
 *  - date must be a real calendar date;
 *  - volume and amount must be positive;
 *  - the odometer must be strictly higher than every earlier-dated
 *    entry and strictly lower than every later-dated entry;
 *  - no two entries may share the same odometer reading.
 * `existing` excludes the entry being edited (match by id).
 */
function validateFill(existing, cand) {
  if (!isValidISODate(cand.date)) return { ok: false, error: 'Enter a real date as YYYY-MM-DD.' };
  if (!(Number.isInteger(cand.milli) && cand.milli > 0)) return { ok: false, error: 'Volume must be a positive number.' };
  if (!(Number.isInteger(cand.minor) && cand.minor > 0)) return { ok: false, error: 'Amount must be a positive number.' };
  if (!(typeof cand.odo === 'number' && Number.isFinite(cand.odo) && cand.odo >= 0)) {
    return { ok: false, error: 'Odometer must be a non-negative number.' };
  }
  const others = existing.filter((f) => f.id !== cand.id);
  for (const o of others) {
    if (o.odo === cand.odo) return { ok: false, error: 'Another entry already has odometer ' + o.odo + '.' };
    if (o.date < cand.date && o.odo > cand.odo) {
      return { ok: false, error: 'Odometer must be higher than the ' + o.date + ' entry (' + o.odo + ').' };
    }
    if (o.date > cand.date && o.odo < cand.odo) {
      return { ok: false, error: 'Odometer must be lower than the later ' + o.date + ' entry (' + o.odo + ').' };
    }
  }
  return { ok: true };
}

/* ---------- the full-to-full engine ---------- */

const NEED_TWO_FULLS = 'need two full fills to compute';

function sortFills(fills) {
  return fills.slice().sort((a, b) => a.odo - b.odo);
}

function fullIndexes(sorted) {
  const idx = [];
  sorted.forEach((f, i) => { if (f.full) idx.push(i); });
  return idx;
}

/**
 * A segment runs between consecutive FULL fills. Its distance is the
 * odometer difference; its fuel is the sum of EVERY fill after the
 * previous FULL through this FULL (partials folded in), because that
 * is the fuel that actually covered those km.
 */
function computeSegments(fills) {
  const sorted = sortFills(fills);
  const fulls = fullIndexes(sorted);
  const segments = [];
  for (let k = 1; k < fulls.length; k++) {
    const a = fulls[k - 1], b = fulls[k];
    let milli = 0, minor = 0, includesPartial = false;
    for (let i = a + 1; i <= b; i++) {
      milli += sorted[i].milli;
      minor += sorted[i].minor;
      if (!sorted[i].full) includesPartial = true;
    }
    const km = round1(sorted[b].odo - sorted[a].odo);
    segments.push({
      startDate: sorted[a].date,
      endDate: sorted[b].date,
      startOdo: sorted[a].odo,
      endOdo: sorted[b].odo,
      km,
      milli,
      minor,
      includesPartial,
      kmPerL: km / (milli / 1000)
    });
  }
  return segments;
}

/**
 * Lifetime figures over the first-FULL-to-last-FULL window.
 * The first FULL's own fuel is excluded (it filled the tank you
 * started measuring from); fills after the last FULL are excluded
 * (their km haven't been closed by a full fill yet).
 */
function lifetimeStats(fills) {
  const sorted = sortFills(fills);
  const fulls = fullIndexes(sorted);
  if (fulls.length < 2) {
    return {
      kmPerL: null,
      reason: NEED_TWO_FULLS,
      km: 0, milli: 0, minor: 0,
      excludedBefore: 0, excludedAfter: 0,
      firstFullDate: null, lastFullDate: null
    };
  }
  const a = fulls[0], b = fulls[fulls.length - 1];
  let milli = 0, minor = 0;
  for (let i = a + 1; i <= b; i++) { milli += sorted[i].milli; minor += sorted[i].minor; }
  const km = round1(sorted[b].odo - sorted[a].odo);
  return {
    kmPerL: km / (milli / 1000),
    reason: null,
    km, milli, minor,
    excludedBefore: a,
    excludedAfter: sorted.length - 1 - b,
    firstFullDate: sorted[a].date,
    lastFullDate: sorted[b].date
  };
}

/* ---------- cost per km ---------- */

// Fuel-only cost per unit distance, in MAJOR currency units rounded to 2 dp.
function fuelCostPerKm(fills) {
  const l = lifetimeStats(fills);
  if (l.kmPerL === null || l.km <= 0) return { value: null, reason: l.reason || NEED_TWO_FULLS };
  return { value: round2(l.minor / 100 / l.km), windowMinor: l.minor, km: l.km };
}

// Split expenses into the first-FULL..last-FULL window (inclusive) vs outside it.
function splitExpenses(expenses, firstFullDate, lastFullDate) {
  const inWindow = [], outside = [];
  for (const e of expenses) {
    if (firstFullDate !== null && e.date >= firstFullDate && e.date <= lastFullDate) inWindow.push(e);
    else outside.push(e);
  }
  return { inWindow, outside };
}

/**
 * All-in cost per km: (window fuel spend + window expenses) / window km.
 * Expenses dated outside the window are returned as `excluded` — they are
 * shown in totals but flagged "waiting for next full fill".
 */
function allInCostPerKm(fills, expenses) {
  const l = lifetimeStats(fills);
  if (l.kmPerL === null || l.km <= 0) {
    return { value: null, reason: l.reason || NEED_TWO_FULLS, excluded: expenses.slice() };
  }
  const { inWindow, outside } = splitExpenses(expenses, l.firstFullDate, l.lastFullDate);
  const expMinor = inWindow.reduce((s, e) => s + e.minor, 0);
  return {
    value: round2((l.minor + expMinor) / 100 / l.km),
    includedExpenseMinor: expMinor,
    excluded: outside,
    km: l.km
  };
}

/* ---------- per-fill and unit conversions ---------- */

// e.g. 103320 paise over 9840 mL -> 10500 paise per litre (105.00).
function pricePerUnitMinor(minor, milli) {
  if (!(milli > 0)) return null;
  return Math.round(minor * 1000 / milli);
}

function lPer100km(kmPerL) {
  if (!(kmPerL > 0)) return null;
  return round2(100 / kmPerL);
}

/* ---------- trend ---------- */

// Mean of up to `n` values BEFORE the last one; null if fewer than 2 values.
function trailingAvgBefore(values, n) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const prev = values.slice(Math.max(0, values.length - 1 - n), values.length - 1);
  const sum = prev.reduce((a, b) => a + b, 0);
  return sum / prev.length;
}

// True when the latest segment is more than 10% below the trailing average.
function isBelowAverage(latest, trailingAvg) {
  if (trailingAvg === null || !(trailingAvg > 0)) return false;
  return (trailingAvg - latest) / trailingAvg > 0.10;
}

/* ---------- monthly + totals ---------- */

function monthFuelSpendMinor(fills, isoMonth) { // isoMonth: "YYYY-MM"
  return fills.reduce((s, f) => (f.date.slice(0, 7) === isoMonth ? s + f.minor : s), 0);
}

function totalKmLogged(fills) {
  if (fills.length < 2) return 0;
  const sorted = sortFills(fills);
  return round1(sorted[sorted.length - 1].odo - sorted[0].odo);
}

/* ---------- CSV (RFC 4180) ---------- */

function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

function toCsv(rows) {
  return rows.map(csvRow).join('\r\n') + '\r\n';
}

/* ---------- display formatting ---------- */

function groupIntString(s, grouping) {
  if (grouping === 'plain') return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Indian grouping: last three digits, then pairs (12,34,567).
  if (s.length <= 3) return s;
  const head = s.slice(0, -3), tail = s.slice(-3);
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
}

// 94500 -> "₹945.00"; 123456789 (indian) -> "₹12,34,567.89".
function formatMinor(minor, symbol, grouping) {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const units = String(Math.trunc(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  return (neg ? '−' : '') + symbol + groupIntString(units, grouping) + '.' + frac;
}

// 9840 -> "9.84"; trims trailing zeros in the thousandths.
function formatMilli(milli) {
  const whole = Math.trunc(milli / 1000);
  const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? whole + '.' + frac : String(whole);
}

/* ---------- seeded PRNG (for the property test; deterministic) ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- sample log (clearly-invented demo data) ---------- */
/* Every entry is fictional: a made-up commuter scooter at a flat
   ₹105.00/L so the payoff is visible before a user's own second
   full fill. The app shows a persistent SAMPLE banner while this
   data is loaded and never presents it as real prices or figures. */

const SAMPLE_FILLS = [
  { id: 's01', date: '2026-03-02', odo: 8240, milli: 4100, minor: 43050, full: true,  note: 'sample' },
  { id: 's02', date: '2026-03-14', odo: 8422, milli: 4050, minor: 42525, full: true,  note: 'sample' },
  { id: 's03', date: '2026-03-29', odo: 8610, milli: 4200, minor: 44100, full: true,  note: 'sample' },
  { id: 's04', date: '2026-04-08', odo: 8735, milli: 2000, minor: 21000, full: false, note: 'sample — topped up ₹210' },
  { id: 's05', date: '2026-04-15', odo: 8890, milli: 4300, minor: 45150, full: true,  note: 'sample' },
  { id: 's06', date: '2026-05-01', odo: 9078, milli: 4150, minor: 43575, full: true,  note: 'sample' },
  { id: 's07', date: '2026-05-18', odo: 9260, milli: 4100, minor: 43050, full: true,  note: 'sample' },
  { id: 's08', date: '2026-05-30', odo: 9366, milli: 1500, minor: 15750, full: false, note: 'sample — small top-up' },
  { id: 's09', date: '2026-06-06', odo: 9448, milli: 2800, minor: 29400, full: true,  note: 'sample' },
  { id: 's10', date: '2026-06-21', odo: 9600, milli: 4000, minor: 42000, full: true,  note: 'sample — mileage dipped' }
];

const SAMPLE_EXPENSES = [
  { id: 'se1', date: '2026-04-20', category: 'service',   minor: 68000,  note: 'sample — oil + filter' },
  { id: 'se2', date: '2026-06-25', category: 'tyres',     minor: 140000, note: 'sample — rear tyre (after last full fill)' }
];

/* ---------- export ---------- */

const ENGINE = {
  round2, round1,
  isLeapYear, daysInMonth, isValidISODate,
  parseVolumeToMilli, parseAmountToMinor, parseOdo,
  validateFill,
  NEED_TWO_FULLS, sortFills, computeSegments, lifetimeStats,
  fuelCostPerKm, splitExpenses, allInCostPerKm,
  pricePerUnitMinor, lPer100km,
  trailingAvgBefore, isBelowAverage,
  monthFuelSpendMinor, totalKmLogged,
  csvField, csvRow, toCsv,
  groupIntString, formatMinor, formatMilli,
  mulberry32,
  SAMPLE_FILLS, SAMPLE_EXPENSES
};

if (typeof module !== 'undefined') module.exports = ENGINE;
if (typeof window !== 'undefined') window.FUELBOOK = ENGINE;
