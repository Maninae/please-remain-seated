/**
 * Unit tests for js/render/charts.js. We build a tiny DOM stub with just enough createElementNS,
 * appendChild, and getAttribute to exercise both renderStrips and renderTimeSplit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStrips, renderTimeSplit, quantile, niceCeiling } from '../../js/render/charts.js';

// -------- minimal DOM stub --------

function makeStub(tag = 'svg') {
  const node = {
    tagName: tag,
    nodeName: tag,
    children: [],
    parentNode: null,
    attrs: {},
    textContent: '',
    ownerDocument: null,
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return key in this.attrs ? this.attrs[key] : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    replaceChildren(...next) { this.children.length = 0; for (const c of next) this.appendChild(c); },
  };
  node.ownerDocument = {
    createElementNS(_ns, elTag) { return makeStub(elTag); },
  };
  return node;
}

function findAll(node, tag) {
  const out = [];
  const walk = (n) => {
    if (n.tagName === tag || n.nodeName === tag) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

// -------- helpers --------

test('quantile: linear interpolation between neighbours', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 3], 0.5), 2);
  assert.equal(quantile([1, 3], 0.25), 1.5);
  assert.equal(quantile([], 0.5), 0);
  assert.equal(quantile([7], 0.9), 7);
});

/**
 * Round-09 N9-n2 note: the ladder was densified with 4, 6, 7 and 9 so a small-cap panel
 * (E175 deplane at ~6.5 min) does not jump to 8 or 10. The two updated lines below reflect
 * that: 8 min padded 2% snaps to 9 (was 10), and 14 min padded 2% still snaps to 15.
 */
test('niceCeiling rounds up to a friendly minute count', () => {
  // The shared axis-scale module uses the fine ladder N6-m9 introduced for the sensitivity
  // panels: 8, 10, 12, 15, 18, 20, 22, 25, 28, 30. 8-and-a-hair min snaps to 10 (padded
  // just past 8); 14 min snaps to 15; 22 min snaps to 25 (padded past 22).
  assert.equal(niceCeiling(60 * 8), 540);       // 8 min padded 2% -> 9 min (fine ladder)
  assert.equal(niceCeiling(60 * 14), 900);      // 14 min -> 15 min
  assert.equal(niceCeiling(60 * 22), 1500);     // 22 min padded -> 25 min
  assert.equal(niceCeiling(0), 60);
});

// -------- strips --------

test('renderStrips: one group per series', () => {
  const svg = makeStub('svg');
  // Round-14: values chosen so no series' median lands above the p90-derived cap and no
  // seed value falls outside the plot window. The strip axis policy computes floor = 0
  // (smallest median is small enough to snap the floor down) and cap = 120 s here.
  const series = [
    { id: 'a', label: 'Alpha', values: [10, 20, 30, 40, 50] },
    { id: 'b', label: 'Beta', values: [60, 70, 80, 90, 100] },
    { id: 'c', label: 'Gamma', values: [80, 90, 100, 110, 120] },
  ];
  renderStrips(svg, series, { title: 'Test', width: 800 });
  const texts = findAll(svg, 'text');
  const labels = texts.filter((t) => t.textContent && ['Alpha', 'Beta', 'Gamma'].includes(t.textContent));
  assert.equal(labels.length, 3);
  const dots = findAll(svg, 'circle');
  assert.equal(dots.length, 15);
  const rects = findAll(svg, 'rect');
  assert.equal(rects.length, 3);
});

test('renderStrips: the median tick x matches the numeric median', () => {
  const svg = makeStub('svg');
  // Round-14: three series so p90-of-medians sits above every median and the whole panel
  // renders on-scale. The single-series version failed because the p90-of-medians equalled
  // the row's median and the row was correctly classified as off-scale (drawn as a broken
  // bar with no median tick), which the axis policy now guards.
  const seriesA = { id: 'a', label: 'A', values: [20, 120, 180, 240, 300] };   // median 180
  const seriesB = { id: 'b', label: 'B', values: [30, 130, 190, 250, 310] };
  const seriesC = { id: 'c', label: 'C', values: [40, 140, 200, 260, 320] };
  renderStrips(svg, [seriesA, seriesB, seriesC], { width: 800 });
  // Extract the axis floor and cap from the median-tick position of the SECOND median (B),
  // then check that seriesA's tick sits at the expected proportional offset. That reads the
  // shared axis policy through the DOM, so the test does not need to duplicate the policy.
  const lines = findAll(svg, 'line');
  const verticalLines = lines.filter((l) => l.attrs.x1 === l.attrs.x2);
  const medianTicks = verticalLines.filter((l) => l.attrs['data-median-seconds']);
  assert.ok(medianTicks.length >= 3, `expected three median ticks, got ${medianTicks.length}`);
  const byRow = new Map();
  for (const l of medianTicks) byRow.set(l.attrs['data-row-id'], parseFloat(l.attrs.x1));
  assert.ok(byRow.has('a') && byRow.has('b') && byRow.has('c'),
    `expected ticks for a, b, c; got ${[...byRow.keys()].join(',')}`);
  // seriesA (median 180) and seriesC (median 200) must project 20 seconds apart along the
  // shared axis. Any linear scale respects this.
  const xa = byRow.get('a');
  const xc = byRow.get('c');
  assert.ok(xc > xa,
    `median C (200) should draw to the right of median A (180); got A=${xa}, C=${xc}`);
});

test('renderStrips: title text is rendered when provided', () => {
  const svg = makeStub('svg');
  renderStrips(svg, [{ id: 's', label: 's', values: [60, 120] }], {
    title: 'A finding stated in one sentence.', width: 600,
  });
  const texts = findAll(svg, 'text');
  const titles = texts.filter((t) => t.textContent === 'A finding stated in one sentence.');
  assert.equal(titles.length, 1);
});

test('renderStrips: an empty series renders its label without crashing', () => {
  const svg = makeStub('svg');
  renderStrips(svg, [
    { id: 'a', label: 'has data', values: [60] },
    { id: 'b', label: 'empty', values: [] },
  ], { width: 700 });
  const texts = findAll(svg, 'text');
  const labelTexts = texts.filter((t) => t.textContent === 'empty');
  assert.equal(labelTexts.length, 1);
});

test('renderStrips: highlighted series uses the exit-green ink', () => {
  const svg = makeStub('svg');
  // Round-14: three series with medians spread so the p90-of-medians cap sits comfortably
  // above every value, keeping both panels on-scale. The highlighted series then carries
  // the exit-green ink through its dots.
  renderStrips(svg, [
    { id: 'a', label: 'A', values: [50, 60, 70] },
    { id: 'b', label: 'B', values: [80, 90, 100], highlight: true },
    { id: 'c', label: 'C', values: [110, 120, 130] },
  ], { width: 600 });
  const dots = findAll(svg, 'circle');
  const colors = new Set(dots.map((d) => d.attrs.fill));
  assert.ok(colors.size >= 2, `expected at least two dot colours, got ${[...colors].join(',')}`);
});

// -------- time split --------

test('renderTimeSplit: four segments sum to the full width', () => {
  const svg = makeStub('svg');
  renderTimeSplit(svg, { seatedWait: 300, aisleBlocked: 60, bags: 30, walking: 10 }, { width: 800 });
  const rects = findAll(svg, 'rect').filter((r) => r.attrs.fill !== 'none');
  // Four buckets, all non-zero, so four rects.
  assert.equal(rects.length, 4);
  const total = rects.reduce((sum, r) => sum + parseFloat(r.attrs.width), 0);
  assert.ok(Math.abs(total - 800) < 1e-6);
});

test('renderTimeSplit: hides a label that will not fit inside its segment', () => {
  const svg = makeStub('svg');
  // Walking is a tiny sliver: its label should be hidden.
  renderTimeSplit(svg, { seatedWait: 3600, aisleBlocked: 5, bags: 5, walking: 5 }, { width: 400 });
  const texts = findAll(svg, 'text');
  const labels = texts.map((t) => t.textContent || '');
  const walkingRendered = labels.some((l) => l.startsWith('walking'));
  assert.equal(walkingRendered, false);
});

test('renderTimeSplit: a zero split renders one empty rect and does not crash', () => {
  const svg = makeStub('svg');
  renderTimeSplit(svg, { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 }, { width: 400 });
  const rects = findAll(svg, 'rect');
  assert.ok(rects.length >= 1);
});
