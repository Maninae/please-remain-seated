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

test('niceCeiling rounds up to a friendly minute count', () => {
  assert.equal(niceCeiling(60 * 8), 600);       // 8 min -> 10 min
  assert.equal(niceCeiling(60 * 14), 900);      // 14 min -> 15 min
  assert.equal(niceCeiling(60 * 22), 1800);     // 22 min -> 30 min
  assert.equal(niceCeiling(0), 60);
});

// -------- strips --------

test('renderStrips: one group per series', () => {
  const svg = makeStub('svg');
  const series = [
    { id: 'a', label: 'Alpha', values: [60, 90, 120, 150, 180] },
    { id: 'b', label: 'Beta', values: [300, 360, 420, 480, 540] },
    { id: 'c', label: 'Gamma', values: [30, 45, 60, 75, 90] },
  ];
  renderStrips(svg, series, { title: 'Test', width: 800 });
  // Every text node whose x != axis-tick x is either the title or a strategy label.
  const texts = findAll(svg, 'text');
  const labels = texts.filter((t) => t.textContent && ['Alpha', 'Beta', 'Gamma'].includes(t.textContent));
  assert.equal(labels.length, 3);
  // Each series contributes 5 dots.
  const dots = findAll(svg, 'circle');
  assert.equal(dots.length, 15);
  // Each series contributes one band rect (plus zero others; time-split rects are elsewhere).
  const rects = findAll(svg, 'rect');
  assert.equal(rects.length, 3);
});

test('renderStrips: the median tick x matches the numeric median', () => {
  const svg = makeStub('svg');
  const values = [60, 120, 180, 240, 300];   // median 180
  renderStrips(svg, [{ id: 'only', label: 'Only', values }], { width: 800 });
  const medianSeconds = 180;
  const paddedMax = niceCeiling(300);
  // STRIPS_PADDING_LEFT was widened to 200 in round-05 to fit longer airline labels.
  const chartX0 = 200;
  const chartX1 = 800 - 24;
  const expectedX = chartX0 + (medianSeconds / paddedMax) * (chartX1 - chartX0);
  const lines = findAll(svg, 'line');
  // The median tick has x1 == x2 (a vertical stroke). Ignore the axis line (a horizontal one).
  const verticalLines = lines.filter((l) => l.attrs.x1 === l.attrs.x2);
  const medianTicks = verticalLines.filter((l) => Math.abs(parseFloat(l.attrs.x1) - expectedX) < 0.5);
  assert.ok(medianTicks.length >= 1, `expected median tick near x=${expectedX}`);
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
  renderStrips(svg, [
    { id: 'a', label: 'A', values: [60, 120] },
    { id: 'b', label: 'B', values: [60, 120], highlight: true },
  ], { width: 600 });
  const dots = findAll(svg, 'circle');
  const colors = new Set(dots.map((d) => d.attrs.fill));
  // Two colours: default ink and highlight green.
  assert.ok(colors.size >= 2);
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
