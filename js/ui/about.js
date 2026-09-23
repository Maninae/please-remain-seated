/**
 * About tab: the thesis, the model, what is measured vs assumed, the calibration gates,
 * airline sources with as-of months, what the model does not cover, and links to the design
 * docs. Reads the rankings index (when available) to print the generation date and engine sha.
 *
 * Also carries the "How this works" explainer content that used to live on the Race tab
 * (round-07 move: the Race tab reserves the space above the fold for the race).
 *
 * The airline as-of months and sources come from js/ui/glossary.js and design/06. We list
 * the airlines in the order they appear in the strategies module so the reader can walk the
 * chart above and cross-reference on the About tab.
 *
 * Public API:
 *   mountAboutTab({ getGenerationInfo })
 *   getGenerationInfo returns { generatedAt, engineVersion } or null; the caller pulls it
 *   from the rankings index once it has been loaded.
 */

import { GLOSSARY } from './glossary.js';

const AIRLINE_ORDER = Object.freeze([
  'alaska', 'american', 'delta', 'united', 'southwest', 'jetblue',
  'frontier', 'hawaiian', 'ryanair', 'easyjet', 'lufthansa',
  'british-airways', 'air-canada', 'ana',
]);

const REPO_BLOB_BASE = 'https://github.com/Maninae/please-remain-seated/blob/main/';

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
  wrap.innerHTML = `
    <header class="about-header">
      <h2 class="about-title">The thesis, honestly.</h2>
      <p class="about-lede">
        The aisle is a single-lane road, and every stopped person blocks everyone behind them.
        Every strategy above rides that same physics. Change a slider and the winner may flip.
        That is why airlines cannot promise a boarding time.
      </p>
    </header>

    <section class="about-section">
      <h3>How the model works</h3>
      <ul class="about-list">
        <li>Each passenger is a person with a seat, some number of bags, a walking speed, a prep time, and a compliance flag. Same seed, same people, same bags.</li>
        <li>People walk about 0.8 metres per second. Getting up takes 2 to 3 seconds for most; a long tail take longer if they are on a phone.</li>
        <li>Pulling a bag out of the overhead bin takes about 9 seconds; stowing one takes longer. Every bag pull or stow blocks the aisle cell it happens in.</li>
        <li>When a passenger is not compliant with the announced order, they fall back to free-for-all: they stand as soon as they can. Groups leave and board together, ignoring the order that would separate them.</li>
        <li>The aisle is discrete cells; one person per cell. Two doors means the plane drains through both.</li>
        <li>Every number lives in <code>js/engine/config.js</code> with a source comment.</li>
      </ul>
    </section>

    <section class="about-section">
      <h3>What is measured vs. what is assumed</h3>
      <table class="about-table">
        <thead>
          <tr><th>Number</th><th>Where it comes from</th></tr>
        </thead>
        <tbody>
          <tr><td>Walking speed, bag stow time, door outflow</td><td>Schultz 2018, Aerospace 5(1):27, measured field data</td></tr>
          <tr><td>Seat-interference movement counts</td><td>Schultz 2018, Aerospace 5(4):101</td></tr>
          <tr><td>One-column (aisle-first) deplaning claim</td><td>Milne and Salari 2016, JATM 43</td></tr>
          <tr><td>Boarding-method ordering</td><td>Steffen 2008 (arxiv 0802.0733); Steffen and Hotchkiss 2012 (arxiv 1108.5211)</td></tr>
          <tr><td>Random / WILMA / open-seating boarding times</td><td>MythBusters episode 222, 2014</td></tr>
          <tr><td>Distracted-passenger tail, politeness, group size</td><td>Assumption; tunable in the sidebar. Marked assumption in code.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="about-section">
      <h3>Calibration gates</h3>
      <p class="about-inline">The whole-run deplaning gate is derived, not tuned:</p>
      <ul class="about-list">
        <li>A320 default carries 153 passengers (180 seats at 0.85 load factor).</li>
        <li>Schultz measured a median door outflow of 23 pax/min (Q1 18, Q3 29) in the first minute of outflow.</li>
        <li>Milne and Salari 2016 report A320 deplaning at 15 to 17 pax/min whole-run door rate, 8.5 to 9.6 minutes.</li>
        <li>Therefore the whole-run gate spans 14 to 24 pax/min (Milne and Salari low end to Schultz median), 5 to 13 minutes from door open, medians of 40 seeds.</li>
      </ul>
      <p class="about-inline">Gates live in <a href="${REPO_BLOB_BASE}tests/unit/calibration-deplane.test.js" target="_blank" rel="noopener">tests/unit/calibration-deplane.test.js</a> and <a href="${REPO_BLOB_BASE}tests/unit/calibration-board.test.js" target="_blank" rel="noopener">tests/unit/calibration-board.test.js</a>. A bound is never widened to make a test pass.</p>
    </section>

    <section class="about-section">
      <h3>Airline procedures and sources</h3>
      <p class="about-inline">The airline strategies come straight from each carrier's boarding page, verified against a secondary source. Every entry names its as-of date so the reader can retrace.</p>
      <div class="about-airlines" data-about-airlines></div>
    </section>

    <section class="about-section">
      <h3>What this model does not cover</h3>
      <ul class="about-list">
        <li>Children or anyone needing mobility assistance.</li>
        <li>Gate-checked bags. Every bag in the sim uses the overhead bin.</li>
        <li>Cabin crew directing traffic or clearing the aisle mid-boarding.</li>
        <li>The jet-bridge queue past a fixed service time per passenger.</li>
        <li>Airline announcements' effect on compliance (that is baked into the "Follow the rules" slider).</li>
      </ul>
    </section>

    <section class="about-section">
      <h3>How this works (in one paragraph)</h3>
      <p class="about-inline">When the seatbelt sign turns off, people prep, stand, and start filling the aisle. The door opens after a short pause. From then on anyone whose row is clear and whose slot in the aisle is free can stand up and walk. Every bag pull or stow blocks the aisle slot it happens in. Nothing behind a stopped person moves. That is the whole story. How well people follow the announced order matters more than which order gets announced. Opening the back door is by far the biggest win.</p>
    </section>

    <section class="about-section">
      <h3>Design docs</h3>
      <ul class="about-list about-docs">
        <li><a href="${REPO_BLOB_BASE}design/01-spec.md" target="_blank" rel="noopener">design/01-spec.md</a> — the model, the thesis, the calibration gates.</li>
        <li><a href="${REPO_BLOB_BASE}design/02-research.md" target="_blank" rel="noopener">design/02-research.md</a> — every measured parameter, with its source.</li>
        <li><a href="${REPO_BLOB_BASE}design/03-engine-contract.md" target="_blank" rel="noopener">design/03-engine-contract.md</a> — binding engine surface and rule sets.</li>
        <li><a href="${REPO_BLOB_BASE}design/04-page.md" target="_blank" rel="noopener">design/04-page.md</a> — page and UI spec.</li>
        <li><a href="${REPO_BLOB_BASE}design/06-airline-research.md" target="_blank" rel="noopener">design/06-airline-research.md</a> — airline boarding procedures brief.</li>
        <li><a href="${REPO_BLOB_BASE}design/07-rankings.md" target="_blank" rel="noopener">design/07-rankings.md</a> — Rankings tab and precomputed Monte Carlo.</li>
      </ul>
    </section>

    <p class="about-generation" data-about-generation>Rankings data generation date will appear once the index loads.</p>
  `;

  const airlineList = wrap.querySelector('[data-about-airlines]');
  if (airlineList) {
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

  refreshGenerationLine(null, wrap);
  return wrap;
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
  el.textContent = `Rankings data generated ${dateStr} with engine ${sha}.`;
}
