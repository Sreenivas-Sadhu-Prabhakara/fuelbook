'use strict';
/* fuelbook self-tests — re-derive the full-to-full engine against the
   hand-computed fixture log, to the paisa. Run with: node --test */

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../data/engine.js');

/* ---------- the fixture log (from the build brief, hand-computed) ---------- */

function fixtureFills() {
  return [
    { id: 'f1', date: '2026-01-05', odo: 12000, milli: E.parseVolumeToMilli('9.00'), minor: E.parseAmountToMinor('945.00'),  full: true },
    { id: 'f2', date: '2026-01-18', odo: 12410, milli: E.parseVolumeToMilli('9.84'), minor: E.parseAmountToMinor('1033.20'), full: true },
    { id: 'f3', date: '2026-02-02', odo: 12600, milli: E.parseVolumeToMilli('4.50'), minor: E.parseAmountToMinor('477.00'),  full: false },
    { id: 'f4', date: '2026-02-14', odo: 12810, milli: E.parseVolumeToMilli('5.50'), minor: E.parseAmountToMinor('583.00'),  full: true }
  ];
}

const TRAILING_PARTIAL = { id: 'f5', date: '2026-02-25', odo: 12980, milli: 4000, minor: 42400, full: false };

function fixtureExpenses() {
  return [
    { id: 'e1', date: '2026-01-25', category: 'service',   minor: 120000, note: '' },
    { id: 'e2', date: '2026-03-01', category: 'insurance', minor: 400000, note: '' }
  ];
}

/* ---------- input parsing to integer units ---------- */

test('volume and amount parse to exact integer units', () => {
  assert.equal(E.parseVolumeToMilli('9.84'), 9840);
  assert.equal(E.parseVolumeToMilli('9'), 9000);
  assert.equal(E.parseVolumeToMilli('0.5'), 500);
  assert.equal(E.parseVolumeToMilli('0'), null);
  assert.equal(E.parseVolumeToMilli('-2'), null);
  assert.equal(E.parseVolumeToMilli('9,84'), null);
  assert.equal(E.parseAmountToMinor('1033.20'), 103320);
  assert.equal(E.parseAmountToMinor('945'), 94500);
  assert.equal(E.parseAmountToMinor('945.5'), 94550);
  assert.equal(E.parseAmountToMinor('0.00'), null);
  assert.equal(E.parseAmountToMinor('abc'), null);
  assert.equal(E.parseOdo('12410'), 12410);
  assert.equal(E.parseOdo('12410.5'), 12410.5);
  assert.equal(E.parseOdo('12410.55'), null); // one decimal max
});

/* ---------- segments ---------- */

test('segment 1 (clean full-to-full) km/L === 41.67', () => {
  const segs = E.computeSegments(fixtureFills());
  assert.equal(segs.length, 2);
  assert.equal(segs[0].km, 410);
  assert.equal(segs[0].milli, 9840);
  assert.equal(E.round2(segs[0].kmPerL), 41.67); // 410 / 9.84
  assert.equal(segs[0].includesPartial, false);
});

test('segment 2 (partial folded in) km/L === 40.00 and flagged includesPartial', () => {
  const segs = E.computeSegments(fixtureFills());
  assert.equal(segs[1].km, 400);
  assert.equal(segs[1].milli, 10000); // 4.50 + 5.50 L
  assert.equal(E.round2(segs[1].kmPerL), 40.00); // 400 / 10.00
  assert.equal(segs[1].includesPartial, true);
});

/* ---------- lifetime ---------- */

test('lifetime km/L === 40.83 (first FULL litres excluded)', () => {
  const l = E.lifetimeStats(fixtureFills());
  assert.equal(l.km, 810);
  assert.equal(l.milli, 19840); // 9.84 + 4.50 + 5.50
  assert.equal(E.round2(l.kmPerL), 40.83); // 810 / 19.84
});

test('a trailing PARTIAL after the last FULL leaves lifetime km/L at 40.83', () => {
  const fills = fixtureFills().concat([TRAILING_PARTIAL]);
  const l = E.lifetimeStats(fills);
  assert.equal(E.round2(l.kmPerL), 40.83);
  assert.equal(l.excludedAfter, 1); // the on-screen exclusion reason counts it
  const segs = E.computeSegments(fills);
  assert.equal(segs.length, 2); // no new segment until the next FULL
});

/* ---------- cost per km ---------- */

test('fuel cost per km === 2.58', () => {
  const fills = fixtureFills().concat([TRAILING_PARTIAL]);
  const r = E.fuelCostPerKm(fills);
  // (1033.20 + 477.00 + 583.00) = ₹2093.20 over 810 km; trailing partial excluded
  assert.equal(r.windowMinor, 209320);
  assert.equal(r.value, 2.58);
});

test('all-in cost per km === 4.07; insurance dated after last FULL is excluded + flagged', () => {
  const fills = fixtureFills().concat([TRAILING_PARTIAL]);
  const r = E.allInCostPerKm(fills, fixtureExpenses());
  // (2093.20 fuel + 1200 service) / 810 km; ₹4000 insurance (2026-03-01) outside window
  assert.equal(r.includedExpenseMinor, 120000);
  assert.equal(r.value, 4.07);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].id, 'e2');
});

/* ---------- derived price, unit conversions ---------- */

test('derived price per litre for the 2026-01-18 fill === 105.00', () => {
  assert.equal(E.pricePerUnitMinor(103320, 9840), 10500); // paise per litre
});

test('L/100km and mpg conversions', () => {
  const kmPerL = 410 / 9.84; // 41.67 segment
  assert.equal(E.lPer100km(kmPerL), 2.40);
  assert.equal(E.round2(300 / 9.375), 32.00); // mi+gal mode: same engine, mpg
});

/* ---------- trend flag ---------- */

test('trend flag: >10% below trailing average', () => {
  assert.equal(E.isBelowAverage(44.00, 50.00), true);          // 12% drop
  assert.equal(E.isBelowAverage(40.00, 41.67), false);         // 4.01% drop
  assert.equal(E.trailingAvgBefore([50, 50, 50, 44], 3), 50);
  assert.equal(E.trailingAvgBefore([41.67, 40.00], 3), 41.67);
  assert.equal(E.trailingAvgBefore([40.00], 3), null);         // nothing to compare
  assert.equal(E.isBelowAverage(40.00, null), false);
});

/* ---------- validation ---------- */

test('entry with odometer 12400 dated after existing odo 12410 is rejected', () => {
  const r = E.validateFill(fixtureFills(), {
    id: 'x1', date: '2026-01-20', odo: 12400, milli: 5000, minor: 52500, full: true
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /[Oo]dometer/);
});

test('duplicate odometer and non-positive volume/amount are rejected; valid entry passes', () => {
  const fills = fixtureFills();
  assert.equal(E.validateFill(fills, { id: 'x', date: '2026-02-20', odo: 12810, milli: 100, minor: 100, full: true }).ok, false);
  assert.equal(E.validateFill(fills, { id: 'x', date: '2026-02-20', odo: 12900, milli: 0, minor: 100, full: true }).ok, false);
  assert.equal(E.validateFill(fills, { id: 'x', date: '2026-02-20', odo: 12900, milli: 100, minor: 0, full: true }).ok, false);
  assert.equal(E.validateFill(fills, { id: 'x', date: '2026-02-31', odo: 12900, milli: 100, minor: 100, full: true }).ok, false);
  assert.equal(E.validateFill(fills, { id: 'x', date: '2026-02-20', odo: 12900, milli: 100, minor: 100, full: true }).ok, true);
  // editing an entry in place (same id) does not collide with itself
  assert.equal(E.validateFill(fills, { id: 'f4', date: '2026-02-14', odo: 12810, milli: 5500, minor: 58300, full: true }).ok, true);
});

/* ---------- honest refusal ---------- */

test('one FULL fill (or only PARTIALs) returns null km/L with the need-two-fulls reason', () => {
  const oneFull = [{ id: 'a', date: '2026-01-05', odo: 100, milli: 5000, minor: 50000, full: true }];
  const l1 = E.lifetimeStats(oneFull);
  assert.equal(l1.kmPerL, null);
  assert.equal(l1.reason, 'need two full fills to compute');

  const partials = [
    { id: 'a', date: '2026-01-05', odo: 100, milli: 3000, minor: 30000, full: false },
    { id: 'b', date: '2026-01-12', odo: 220, milli: 3000, minor: 30000, full: false }
  ];
  const l2 = E.lifetimeStats(partials);
  assert.equal(l2.kmPerL, null);
  assert.equal(l2.reason, E.NEED_TWO_FULLS);
  assert.equal(E.fuelCostPerKm(partials).value, null);
  assert.equal(E.allInCostPerKm(partials, fixtureExpenses()).value, null);
});

/* ---------- dates: leap years + real month lengths ---------- */

test('ISO date validation handles leap years and month lengths', () => {
  assert.equal(E.isValidISODate('2024-02-29'), true);   // leap
  assert.equal(E.isValidISODate('2000-02-29'), true);   // 400-rule leap
  assert.equal(E.isValidISODate('2100-02-29'), false);  // century non-leap
  assert.equal(E.isValidISODate('2026-02-29'), false);
  assert.equal(E.isValidISODate('2026-02-28'), true);
  assert.equal(E.isValidISODate('2026-04-31'), false);  // April clamps at 30
  assert.equal(E.isValidISODate('2026-12-31'), true);
  assert.equal(E.isValidISODate('2026-13-01'), false);
  assert.equal(E.isValidISODate('2026-00-10'), false);
  assert.equal(E.isValidISODate('26-01-05'), false);
  assert.equal(E.daysInMonth(2024, 2), 29);
  assert.equal(E.daysInMonth(2026, 2), 28);
});

/* ---------- CSV (RFC 4180) ---------- */

test('CSV quoting and CRLF joining follow RFC 4180', () => {
  assert.equal(E.csvRow(['2026-01-18', '12410', '9.84', '1033.20', 'FULL', 'highway, long run']),
    '2026-01-18,12410,9.84,1033.20,FULL,"highway, long run"');
  assert.equal(E.csvField('he said "full"'), '"he said ""full"""');
  assert.equal(E.toCsv([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d\r\n');
});

/* ---------- money formatting ---------- */

test('minor-unit formatting with Indian and plain grouping', () => {
  assert.equal(E.formatMinor(94500, '₹', 'indian'), '₹945.00');
  assert.equal(E.formatMinor(123456789, '₹', 'indian'), '₹12,34,567.89');
  assert.equal(E.formatMinor(123456789, '$', 'plain'), '$1,234,567.89');
  assert.equal(E.formatMinor(209320, '₹', 'indian'), '₹2,093.20');
  assert.equal(E.formatMilli(9840), '9.84');
  assert.equal(E.formatMilli(19840), '19.84');
  assert.equal(E.formatMilli(4000), '4');
});

/* ---------- month spend + total km ---------- */

test('this-month fuel spend and total km logged', () => {
  const fills = fixtureFills().concat([TRAILING_PARTIAL]);
  assert.equal(E.monthFuelSpendMinor(fills, '2026-01'), 94500 + 103320);
  assert.equal(E.monthFuelSpendMinor(fills, '2026-02'), 47700 + 58300 + 42400);
  assert.equal(E.monthFuelSpendMinor(fills, '2026-03'), 0);
  assert.equal(E.totalKmLogged(fills), 980); // 12980 − 12000, all entries
  assert.equal(E.totalKmLogged(fills.slice(0, 1)), 0);
});

/* ---------- sample log invariants ---------- */

test('sample log is internally valid and demos both flag paths', () => {
  const fills = [];
  for (const f of E.SAMPLE_FILLS) {
    const v = E.validateFill(fills, f);
    assert.equal(v.ok, true, 'sample fill ' + f.id + ': ' + (v.error || ''));
    fills.push(f);
  }
  const segs = E.computeSegments(fills);
  assert.equal(segs.length, 7);
  // the last sample segment triggers the below-average prompt
  const kmls = segs.map((s) => s.kmPerL);
  assert.equal(E.isBelowAverage(kmls[kmls.length - 1], E.trailingAvgBefore(kmls, 3)), true);
  // one sample expense falls outside the full-to-full window and gets flagged
  const r = E.allInCostPerKm(fills, E.SAMPLE_EXPENSES);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].id, 'se2');
  // every sample row says so in its note or id
  for (const f of E.SAMPLE_FILLS) assert.match(String(f.note), /sample/);
  for (const e of E.SAMPLE_EXPENSES) assert.match(String(e.note), /sample/);
});

/* ---------- property test: integer-unit conservation ---------- */

test('property: segments conserve km, volume, and paise against the lifetime window', () => {
  const rand = E.mulberry32(0xF0E1B00C); // fixed seed — deterministic run
  for (let iter = 0; iter < 400; iter++) {
    const n = 2 + Math.floor(rand() * 14);
    const fills = [];
    let odo = 1000 + Math.floor(rand() * 20000);
    let day = Date.UTC(2025, 0, 1);
    for (let i = 0; i < n; i++) {
      odo += 50 + Math.floor(rand() * 450);
      day += (1 + Math.floor(rand() * 20)) * 86400000;
      const milli = 1000 + Math.floor(rand() * 11000);
      fills.push({
        id: 'p' + i,
        date: new Date(day).toISOString().slice(0, 10),
        odo,
        milli,
        minor: Math.round(milli * (8 + rand() * 4)), // ~₹80–120/L in paise
        full: rand() < 0.6
      });
    }
    const segs = E.computeSegments(fills);
    const l = E.lifetimeStats(fills);
    if (l.kmPerL === null) {
      assert.equal(segs.length, 0);
      continue;
    }
    const segKm = E.round1(segs.reduce((s, x) => s + x.km, 0));
    const segMilli = segs.reduce((s, x) => s + x.milli, 0);
    const segMinor = segs.reduce((s, x) => s + x.minor, 0);
    assert.equal(segKm, l.km, 'km conserved');
    assert.equal(segMilli, l.milli, 'volume conserved to the millilitre');
    assert.equal(segMinor, l.minor, 'money conserved to the paisa');
    // lifetime km/L lies between the worst and best segment (mediant inequality)
    const kmls = segs.map((s) => s.kmPerL);
    assert.ok(l.kmPerL >= Math.min(...kmls) - 1e-9);
    assert.ok(l.kmPerL <= Math.max(...kmls) + 1e-9);
  }
});
