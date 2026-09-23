/**
 * About tab: the thesis, the model, what is measured vs assumed, the calibration gates,
 * airline sources with as-of months, what the model does not cover, and links to the design
 * docs. Reads the rankings index (when available) to print the generation date and engine sha.
 *
 * The calibration gates are printed from the constants in js/ui/calibration-gates.js so the
 * page and the tests hold the engine to the same numbers. If the tests move a bound, the
 * About page moves with it.
 *
 * The measured-vs-assumed table lists one row per assumption named in js/engine/config.js
 * (the ops assumption, the two behaviour assumptions, the prep distribution) so a skeptic
 * has one place to see every tuned parameter. Cited numbers live in one column, and the
 * "measured or assumed" verdict lives in its own scannable column.
 *
 * Public API:
 *   mountAboutTab({ getGenerationInfo })
 *   getGenerationInfo returns { generatedAt, engineVersion } or null; the caller pulls it
 *   from the rankings index once it has been loaded.
 */

import { GLOSSARY } from './glossary.js';
import {
  DEPLANE_CALIBRATION_GATES, formatWholeRunGateSentence, formatFirstTwoMinGateSentence,
} from './calibration-gates.js';

const AIRLINE_ORDER = Object.freeze([
  'alaska', 'american', 'delta', 'united', 'southwest', 'jetblue',
  'frontier', 'hawaiian', 'ryanair', 'easyjet', 'lufthansa',
  'british-airways', 'air-canada', 'ana',
]);

const REPO_BLOB_BASE = 'https://github.com/Maninae/please-remain-seated/blob/main/';

// Each row: { label, value, source } — `source` is either a cited paper or the word
// "Assumption" so the honesty column reads scannably down one axis. Ordered to put the
// three-highest-effect assumptions first (door open delay, patient fraction, prep spread),
// then measured values, then estimates.
const ASSUMPTION_ROWS = Object.freeze([
  {
    label: 'Door-open staging window',
    value: '45 s from seatbelt sign off',
    source: 'Assumption (ops range 60 to 180 s field, tuned to Schultz median)',
    kind: 'assumption',
  },
  {
    label: 'Patient fraction',
    value: '40% of passengers wait for the aisle to start moving before standing',
    source: 'Assumption (behavioural, shapes the deplaning curve)',
    kind: 'assumption',
  },
  {
    label: 'Prep distribution (seatbelt off to ready to stand)',
    value: 'lognormal, median 3 s, sigma 1.0',
    source: 'Assumption (behavioural; no primary source verified)',
    kind: 'assumption',
  },
  {
    label: 'Door service time',
    value: '2 s per passenger through the jet-bridge',
    source: 'Derived (~0.8 m/s at ~1.5 m spacing, single-file)',
    kind: 'derived',
  },
  {
    label: 'Politeness (let a row-mate step ahead)',
    value: 'P = 0.9',
    source: 'Assumption (behavioural; the yielding parameter is not verified in a primary source)',
    kind: 'assumption',
  },
  {
    label: 'Walking speed, bag stow time, door outflow',
    value: '0.8 m/s; Weibull(1.7, 16 s); 23 pax/min median',
    source: 'Schultz 2018, Aerospace 5(1):27 (field data)',
    kind: 'measured',
  },
  {
    label: 'Seat-interference movement counts',
    value: '1 / 4 / 5 / 9 per case, 5 s each',
    source: 'Schultz 2018, Aerospace 5(4):101',
    kind: 'measured',
  },
  {
    label: 'One-column (aisle-first) deplaning claim',
    value: 'aisle-first faster than free-for-all',
    source: 'Wald, Harmon and Klabjan 2014, JATM 36:101-109 (structured deplaning >40% reduction), doi 10.1016/j.jairtraman.2014.01.001',
    kind: 'measured',
  },
  {
    label: 'Boarding-method ordering',
    value: 'Steffen block orders; WILMA; reverse pyramid',
    source: 'Steffen 2008 (arxiv 0802.0733); Steffen and Hotchkiss 2012 (arxiv 1108.5211)',
    kind: 'measured',
  },
  {
    label: 'Random / WILMA / open-seating boarding times',
    value: 'anchors for boarding times',
    source: 'MythBusters episode 222, 2014 (n=1, TV volunteers)',
    kind: 'measured',
  },
  {
    label: 'Status mix (elite tiers on a US mainline)',
    value: 'none 90%, silver 6%, gold 3%, top 1%',
    source: 'Estimate (design/06-airline-research.md)',
    kind: 'estimate',
  },
  {
    label: 'Basic-fare share (boards last)',
    value: '20% of economy',
    source: 'Estimate (trade press 15 to 30% domestic)',
    kind: 'estimate',
  },
  {
    label: 'Pre-boarders',
    value: '5% of the cabin',
    source: 'Estimate (practitioner 3 to 8%, no aggregate)',
    kind: 'estimate',
  },
  {
    label: 'Cardholder priority zone',
    value: '25% of the cabin',
    source: 'Estimate (co-brand penetration high side)',
    kind: 'estimate',
  },
  {
    label: 'Military courtesy zone',
    value: '1% of the cabin',
    source: 'Estimate (per capita travel share)',
    kind: 'estimate',
  },
  {
    label: 'Distracted-passenger tail, group size',
    value: 'lognormal tail, 2 to 3 seats per group',
    source: 'Assumption (tunable in the sidebar)',
    kind: 'assumption',
  },
]);

export function mountAboutTab({ getGenerationInfo }) {
  const panel = document.getElementById('tab-panel-about');
  if (!panel) return null;
  panel.innerHTML = '';
  panel.appendChild(buildAbout());
  window.addEventListener('prs:tab-changed', (event) => {
    if (event.detail?.tab === 'about') refreshGenerationLine(getGenerationInfo?.());
  });
  window.addEventListener('prs:rankings-index-loaded', (event) => {
    refreshGenerationLine(event.detail || getGenerationInfo?.());
  });
  return { rerender: () => panel.replaceChildren(buildAbout()) };
}

function buildAbout() {
  const wrap = document.createElement('article');
  wrap.className = 'about-tab';
  wrap.appendChild(buildHeader());
  wrap.appendChild(buildHowSection());
  wrap.appendChild(buildAssumptionsSection());
  wrap.appendChild(buildCalibrationSection());
  wrap.appendChild(buildAirlineSection());
  wrap.appendChild(buildLimitsSection());
  wrap.appendChild(buildParagraphSection());
  wrap.appendChild(buildDesignDocsSection());
  const gen = document.createElement('p');
  gen.className = 'about-generation';
  gen.dataset.aboutGeneration = '';
  gen.textContent = 'Rankings data generation date will appear once the index loads.';
  wrap.appendChild(gen);
  populateAirlineList(wrap);
  refreshGenerationLine(null, wrap);
  return wrap;
}

function buildHeader() {
  const header = document.createElement('header');
  header.className = 'about-header';
  header.innerHTML = `
    <h2 class="about-title">The thesis, honestly.</h2>
    <p class="about-lede">
      The aisle is a single-lane road, and every stopped person blocks everyone behind them.
      Every strategy above rides that same physics. Change a slider and the winner may flip.
      That is why airlines cannot promise a boarding time.
    </p>
  `;
  return header;
}

function buildHowSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  section.innerHTML = `
    <h3>How the model works</h3>
    <ul class="about-list">
      <li>Each passenger is a person with a seat, some number of bags, a walking speed, a prep time, and a compliance flag. Same seed, same people, same bags.</li>
      <li>People walk about 0.8 metres per second. Getting up takes 2 to 3 seconds for most; a long tail take longer if they are on a phone.</li>
      <li>Pulling a bag out of the overhead bin takes about 9 seconds; stowing one takes longer. Every bag pull or stow blocks the aisle cell it happens in.</li>
      <li>When a passenger is not compliant with the announced order, they fall back to free-for-all: they stand as soon as they can. Groups leave and board together, ignoring the order that would separate them.</li>
      <li>The aisle is discrete cells; one person per cell. Two doors means the plane drains through both.</li>
      <li>Every number lives in <code>js/engine/config.js</code> with a source comment.</li>
    </ul>
  `;
  return section;
}

function buildAssumptionsSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  const heading = document.createElement('h3');
  heading.textContent = 'What is measured vs. what is assumed';
  section.appendChild(heading);
  const intro = document.createElement('p');
  intro.className = 'about-inline';
  intro.textContent = 'Every tuned parameter sits in js/engine/config.js with a source comment. The three top rows are the assumptions with the largest effect on the numbers.';
  section.appendChild(intro);
  const table = document.createElement('table');
  table.className = 'about-table about-assumptions-table';
  table.dataset.aboutAssumptions = '';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Number', 'Value', 'Source or assumption']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of ASSUMPTION_ROWS) {
    const tr = document.createElement('tr');
    tr.dataset.kind = row.kind;
    const cells = [row.label, row.value, row.source];
    for (const cellText of cells) {
      const td = document.createElement('td');
      td.textContent = cellText;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function buildCalibrationSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  const g = DEPLANE_CALIBRATION_GATES.wholeRunPaxPerMin;
  const t = DEPLANE_CALIBRATION_GATES.totalMinutes;
  const f = DEPLANE_CALIBRATION_GATES.firstTwoMinPaxPerMin;
  section.innerHTML = `
    <h3>Calibration gates</h3>
    <p class="about-inline">The whole-run deplaning gate is derived from the two measured sources, not tuned to pass:</p>
    <ul class="about-list">
      <li>A320 default carries 153 passengers (180 seats at 0.85 load factor).</li>
      <li>Schultz measured a median door outflow of 23 pax/min (Q1 18, Q3 29) in the first minute of outflow.</li>
      <li>Wald, Harmon and Klabjan 2014 (JATM 36:101-109) report a 15 to 17 pax/min average deplaning rate on a full A320; at 144 seats that arithmetic gives an 8.5 to 9.6 minute total, a derived figure rather than one they measure directly.</li>
      <li data-about-whole-run-gate>${formatWholeRunGateSentence()}</li>
      <li data-about-first-two-min-gate>${formatFirstTwoMinGateSentence()}</li>
      <li>The model runs at the fast end of that band. Whole-run throughput lands around 23 to 25 pax/min at defaults, close to Schultz's median and above the Wald, Harmon and Klabjan range. The 45-second staging window (see the assumptions table) is what puts it there.</li>
    </ul>
    <p class="about-inline">Gates live in <a href="${REPO_BLOB_BASE}tests/unit/calibration-deplane.test.js" target="_blank" rel="noopener">tests/unit/calibration-deplane.test.js</a> and <a href="${REPO_BLOB_BASE}tests/unit/calibration-board.test.js" target="_blank" rel="noopener">tests/unit/calibration-board.test.js</a>. A bound is never widened to make a test pass.</p>
  `;
  // The template above already carries the printed gate text; the values below prevent lint
  // complaints about unused imports when the template is edited by hand.
  void g; void t; void f;
  return section;
}

function buildAirlineSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  section.innerHTML = `
    <h3>Airline procedures and sources</h3>
    <p class="about-inline">The airline strategies come straight from each carrier's boarding page, verified against a secondary source. Every entry names its as-of date so the reader can retrace.</p>
    <div class="about-airlines" data-about-airlines></div>
  `;
  return section;
}

function buildLimitsSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  section.innerHTML = `
    <h3>What this model does not cover</h3>
    <ul class="about-list">
      <li>Children or anyone needing mobility assistance.</li>
      <li>Gate-checked bags. Every bag in the sim uses the overhead bin.</li>
      <li>Cabin crew directing traffic or clearing the aisle mid-boarding.</li>
      <li>The jet-bridge queue past a fixed service time per passenger.</li>
      <li>Airline announcements' effect on compliance (that is baked into the "Follow the rules" slider).</li>
      <li>Front-to-back boarding runs slow at the tail (about 3.8 pax/min in the sim, against 7 pax/min in the MythBusters back-to-front test). Treat the extremes of the ranking as extrapolation rather than result.</li>
    </ul>
  `;
  return section;
}

function buildParagraphSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  section.innerHTML = `
    <h3>How this works (in one paragraph)</h3>
    <p class="about-inline">When the seatbelt sign turns off, people prep, stand, and start filling the aisle. The door opens after a short pause. From then on anyone whose row is clear and whose slot in the aisle is free can stand up and walk. Every bag pull or stow blocks the aisle slot it happens in. Nothing behind a stopped person moves. That is the whole story. How well people follow the announced order matters more than which order gets announced. Opening the back door is by far the biggest win.</p>
  `;
  return section;
}

function buildDesignDocsSection() {
  const section = document.createElement('section');
  section.className = 'about-section';
  section.innerHTML = `
    <h3>Design docs</h3>
    <ul class="about-list about-docs">
      <li><a href="${REPO_BLOB_BASE}design/01-spec.md" target="_blank" rel="noopener">design/01-spec.md</a>: the model, the thesis, the calibration gates.</li>
      <li><a href="${REPO_BLOB_BASE}design/02-research.md" target="_blank" rel="noopener">design/02-research.md</a>: every measured parameter, with its source.</li>
      <li><a href="${REPO_BLOB_BASE}design/03-engine-contract.md" target="_blank" rel="noopener">design/03-engine-contract.md</a>: binding engine surface and rule sets.</li>
      <li><a href="${REPO_BLOB_BASE}design/04-page.md" target="_blank" rel="noopener">design/04-page.md</a>: page and UI spec.</li>
      <li><a href="${REPO_BLOB_BASE}design/06-airline-research.md" target="_blank" rel="noopener">design/06-airline-research.md</a>: airline boarding procedures brief.</li>
      <li><a href="${REPO_BLOB_BASE}design/07-rankings.md" target="_blank" rel="noopener">design/07-rankings.md</a>: Rankings tab and precomputed Monte Carlo.</li>
    </ul>
  `;
  return section;
}

function populateAirlineList(wrap) {
  const airlineList = wrap.querySelector('[data-about-airlines]');
  if (!airlineList) return;
  for (const id of AIRLINE_ORDER) {
    const entry = GLOSSARY[id];
    if (!entry) continue;
    const item = document.createElement('div');
    item.className = 'about-airline';
    const title = document.createElement('span');
    title.className = 'about-airline-title';
    title.textContent = entry.title;
    const body = document.createElement('span');
    body.className = 'about-airline-body';
    body.textContent = extractAsOf(entry.body) || entry.body.split('.').slice(0, 2).join('.') + '.';
    item.appendChild(title);
    item.appendChild(body);
    if (entry.learnMore?.href) {
      const link = document.createElement('a');
      link.href = entry.learnMore.href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'about-airline-link';
      link.textContent = entry.learnMore.label || 'source';
      item.appendChild(link);
    }
    airlineList.appendChild(item);
  }
}

/**
 * Pull an "as of <Month YYYY>" phrase out of a glossary body, so the airline row can print the
 * shortest useful sentence. Falls back to the first two sentences if the phrase is missing.
 */
function extractAsOf(body) {
  const match = body.match(/[^.]*(as of|since|from|current as of|Current as of|current since|Current since|Since)[^.]*\./i);
  if (match) return match[0].trim();
  const first = body.split('.').slice(0, 2).join('.');
  return first ? `${first.trim()}.` : '';
}

function refreshGenerationLine(info, root) {
  const el = (root || document).querySelector('[data-about-generation]');
  if (!el) return;
  if (!info) {
    el.textContent = 'Rankings data has not been generated yet.';
    return;
  }
  const date = info.generatedAt ? new Date(info.generatedAt) : null;
  const dateStr = date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : info.generatedAt || 'unknown';
  const sha = info.engineVersion ? info.engineVersion.slice(0, 12) : 'unknown';
  // N5-B1: state the tiers HONESTLY, computed from the index cells themselves. The old code
  // read seedTiers.headline (a plan number) and printed "10,000" while cells on disk carried
  // 200 or 2,000. The summary sentence describes what actually shipped.
  const summary = info.seedTierSummary && info.seedTierSummary.sentence
    ? info.seedTierSummary.sentence
    : (info.seeds
      ? `Each cell holds ${info.seeds.toLocaleString('en-US')} runs per strategy.`
      : '');
  const runsPart = summary ? ` ${summary}` : '';
  el.textContent = `Rankings data generated ${dateStr} with engine ${sha}.${runsPart}`;
}
