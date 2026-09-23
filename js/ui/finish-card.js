/**
 * The finish card: a shareable end-of-race summary drawn between the race and the controls.
 *
 * When both lanes finish, the card shows:
 *  - Winner, margin, one-line why ("aisle-first spent 3:29 seated vs 5:10").
 *  - Aircraft, load, compliance, families, seed on a small facts line.
 *  - "Copy link" button that writes the current URL (with every knob) to the clipboard.
 *  - Personal-best line: "PB for this setup: 4:52 · new PB!" when improved.
 *
 * Reading is intentionally cheap: main.js emits `prs:race-finished` with the payload, this module
 * subscribes to it, renders the card, and hides itself when the race restarts.
 */

import { formatClock, formatPercent } from './format.js';
import { createPersonalBestStore } from './personal-best.js';

const PB_STORE = createPersonalBestStore();

export function mountFinishCard({ store }) {
  const card = document.getElementById('finish-card');
  if (!card) return;

  window.addEventListener('prs:race-finished', (event) => {
    const payload = event.detail;
    if (!payload) return;
    renderCard(card, store, payload);
  });

  window.addEventListener('prs:race-reset', () => {
    card.hidden = true;
    card.innerHTML = '';
  });
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
  const pbResult = PB_STORE.recordFinish(state, payload.winnerLane, winnerSeconds);

  card.innerHTML = '';
  card.hidden = false;

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

  const actions = document.createElement('div');
  actions.className = 'actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'primary';
  copyButton.textContent = 'Copy link';
  copyButton.addEventListener('click', () => copyLink(copyButton));
  actions.appendChild(copyButton);

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.textContent = 'Restart';
  shareButton.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('prs:request-restart'));
  });
  actions.appendChild(shareButton);

  card.appendChild(actions);

  const pb = document.createElement('div');
  pb.className = 'pb';
  if (pbResult.improved && pbResult.previous) {
    pb.classList.add('new');
    pb.textContent = `New PB · was ${formatClock(pbResult.previous.seconds)}`;
  } else if (pbResult.improved) {
    pb.classList.add('new');
    pb.textContent = 'New PB for this setup';
  } else if (pbResult.best) {
    pb.textContent = `PB for this setup: ${formatClock(pbResult.best.seconds)}`;
  }
  card.appendChild(pb);
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
