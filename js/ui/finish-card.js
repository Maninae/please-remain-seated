/**
 * The finish card: a shareable end-of-race summary drawn immediately under lane B, so the
 * player sees it inside the viewport at the instant a race ends (NEW-B1). race.js scrolls
 * the card and lane B into view together on finish.
 *
 * Two states:
 *  - Provisional (one lane done, the other still racing): "Two doors finished at 3:35. Free-
 *    for-all still going · 82 to go." Fires on `prs:race-first-lane-finished`, ticks on
 *    `prs:race-first-lane-tick` so the "82 to go" counter keeps counting down. Fixes the round-
 *    3 acceptance criterion under NEW3-M4: after the fast lane crosses the line the race must
 *    still feel alive, not go quiet, since the new default matchup (free-for-all vs two-doors)
 *    has minutes of race left after the fast lane finishes.
 *  - Final (both lanes done):
 *      - Winner, margin, one-line why ("aisle-first spent 3:29 seated vs 5:10").
 *      - Aircraft, load, compliance, families, seed on a small facts line.
 *      - "Copy link" button that writes the current URL (with every knob) to the clipboard.
 *      - Personal-best line ("biggest win with Two doors: 3:19"); a "New PB" flag when the
 *        current margin exceeds the stored one for this matchup (NEW-m1).
 *
 * The card no longer carries a second Restart button (NEW-n3). Restart lives in the persistent
 * race-controls row above the card so a player who has just seen the result does not need to
 * scroll or hunt for it.
 */

import { formatClock, formatPercent } from './format.js';
import { createPersonalBestStore } from './personal-best.js';

const PB_STORE = createPersonalBestStore();

export function mountFinishCard({ store }) {
  const card = document.getElementById('finish-card');
  if (!card) return;

  let lastProvisional = null;

  window.addEventListener('prs:race-first-lane-finished', (event) => {
    const payload = event.detail;
    if (!payload) return;
    lastProvisional = payload;
    renderProvisional(card, payload);
  });

  window.addEventListener('prs:race-first-lane-tick', (event) => {
    if (!lastProvisional) return;
    const detail = event.detail || {};
    lastProvisional = {
      ...lastProvisional,
      otherRemaining: detail.otherRemaining,
      otherTotal: detail.otherTotal,
    };
    const remainingLine = card.querySelector('[data-provisional-status]');
    if (remainingLine) {
      remainingLine.textContent = provisionalStatusLine(lastProvisional);
    }
  });

  window.addEventListener('prs:race-finished', (event) => {
    const payload = event.detail;
    if (!payload) return;
    lastProvisional = null;
    renderCard(card, store, payload);
  });

  window.addEventListener('prs:race-reset', () => {
    card.hidden = true;
    card.innerHTML = '';
    lastProvisional = null;
  });
}

function renderProvisional(card, payload) {
  card.innerHTML = '';
  card.hidden = false;
  card.classList.add('provisional');

  const headline = document.createElement('div');
  headline.className = 'headline';
  const verb = payload.mode === 'board' ? 'boarded' : 'deplaned';
  headline.innerHTML = `<span class="winner-name">${escapeHtml(payload.finishedLabel)}</span> ${verb} in ${formatClock(payload.finishedSeconds)}.`;
  card.appendChild(headline);

  const status = document.createElement('div');
  status.className = 'why';
  status.setAttribute('data-provisional-status', '');
  status.textContent = provisionalStatusLine(payload);
  card.appendChild(status);
}

function provisionalStatusLine(payload) {
  const remaining = Math.max(0, Number(payload.otherRemaining) || 0);
  const totalNoun = payload.mode === 'board' ? 'to board' : 'to go';
  if (remaining === 0) {
    return `${payload.otherLabel} is finishing up.`;
  }
  return `${payload.otherLabel} still going · ${remaining} ${totalNoun}.`;
}

function renderCard(card, store, payload) {
  const state = store.state();
  const winnerLabel = payload.winnerLabel;
  const loserLabel = payload.loserLabel;
  const winnerSeconds = payload.winnerSeconds;
  const loserSeconds = payload.loserSeconds;
  const margin = Math.max(0, loserSeconds - winnerSeconds);

  const preset = payload.presetLabel || state.presetId;
  const modeVerb = state.mode === 'deplane' ? 'deplaned' : 'boarded';
  const why = payload.whyLine || '';
  const pbResult = PB_STORE.recordFinish(state, payload.winnerLane, margin);

  card.innerHTML = '';
  card.hidden = false;
  card.classList.remove('provisional');

  const headline = document.createElement('div');
  headline.className = 'headline';
  headline.innerHTML = `<span class="winner-name">${escapeHtml(winnerLabel)}</span> ${modeVerb} in ${formatClock(winnerSeconds)}, ${formatClock(margin)} ahead of ${escapeHtml(loserLabel)}.`;
  card.appendChild(headline);

  if (why) {
    const whyNode = document.createElement('div');
    whyNode.className = 'why';
    whyNode.textContent = why;
    card.appendChild(whyNode);
  }

  const facts = document.createElement('div');
  facts.className = 'facts';
  facts.textContent = `${preset} · load ${formatPercent(state.loadFactor)} · compliance ${formatPercent(state.compliance)} · families ${formatPercent(state.families)} · seed ${state.seed}`;
  card.appendChild(facts);

  // Multi-class-only per-class finish line ("First class off in 0:48, economy in 6:10").
  // Drawn just under the facts line so a reader who cares about the class breakdown finds it
  // right where the aggregate result is. Single-class cabins get no extra line (the aggregate
  // clock IS the economy total).
  const byClassLine = renderByClassLine(payload);
  if (byClassLine) {
    const byClass = document.createElement('div');
    byClass.className = 'by-class';
    byClass.textContent = byClassLine;
    card.appendChild(byClass);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'primary';
  copyButton.textContent = 'Copy link';
  copyButton.addEventListener('click', () => copyLink(copyButton));
  actions.appendChild(copyButton);

  card.appendChild(actions);

  const pb = document.createElement('div');
  pb.className = 'pb';
  pb.textContent = pbLine(pbResult, winnerLabel);
  if (pbResult.improved && pbResult.previous) pb.classList.add('new');
  else if (pbResult.improved) pb.classList.add('new');
  card.appendChild(pb);
}

/**
 * Compose the per-class summary line for a multi-class winner. Reads `byClass` off the
 * finish-payload's `winnerByClass` (the finish controller supplies it from summary().byClass).
 * Returns '' on a single-class result so the finish card stays compact for the A320 / 737
 * standard case.
 *
 * Format: "First class off in 0:48, economy in 6:10" (deplane) or "First class on in 1:20,
 * economy on in 9:45" (board), reading classes in the natural front-to-back order.
 */
function renderByClassLine(payload) {
  const byClass = payload && payload.winnerByClass;
  if (!byClass) return '';
  const keys = Object.keys(byClass);
  if (keys.length < 2) return '';
  const verb = payload.mode === 'board' ? 'on' : 'off';
  const order = ['first', 'business', 'premium', 'economy'];
  const parts = [];
  for (const key of order) {
    const entry = byClass[key];
    if (!entry || !Number.isFinite(entry.meanTotal)) continue;
    const label = CLASS_FINISH_LABELS[key] || key;
    parts.push(`${label} ${verb} in ${formatClock(entry.meanTotal)}`);
  }
  if (parts.length < 2) return '';
  return parts.join(', ');
}

const CLASS_FINISH_LABELS = Object.freeze({
  first: 'First class',
  business: 'Business',
  premium: 'Premium economy',
  economy: 'Economy',
});

function pbLine(pbResult, winnerLabel) {
  if (pbResult.improved && pbResult.previous) {
    return `New PB · biggest win with ${winnerLabel}: ${formatClock(pbResult.best.marginSeconds)} (was ${formatClock(pbResult.previous.marginSeconds)})`;
  }
  if (pbResult.improved) {
    return `New PB · biggest win with ${winnerLabel}: ${formatClock(pbResult.best.marginSeconds)}`;
  }
  if (pbResult.best) {
    return `Biggest win with ${winnerLabel}: ${formatClock(pbResult.best.marginSeconds)}`;
  }
  return '';
}

function copyLink(button) {
  const url = window.location.href;
  const done = () => {
    const original = button.textContent;
    button.textContent = 'Link copied';
    setTimeout(() => { button.textContent = original; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
}

function fallbackCopy(text, done) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } catch (error) { /* ignore */ }
  document.body.removeChild(textarea);
  done();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
