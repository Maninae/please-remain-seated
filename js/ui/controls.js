/**
 * All input widgets: mode toggle, primary button, speed, seed, aircraft preset, sliders, "more
 * knobs" disclosure, sound toggle. Every change is pushed into the store; the race listens.
 *
 * URL round-trip and localStorage persistence live in main.js (subscribers on the store), so this
 * module just talks to the store.
 *
 * Also owns global keyboard shortcuts (space, R, 1-4, N).
 */

import { CABIN_PRESETS } from '../engine/cabin-presets.js';
import { formatPercent } from './format.js';

const SPEEDS = [1, 4, 15, 60];

export function mountControls({ store, sound, race }) {
  const state = store.state();

  populatePresetSelect(state.presetId);
  bindModeToggle();
  bindPrimaryButton();
  bindSpeedGroup(state.speed);
  bindSeedControls();
  bindPresetSelect();
  bindSlider('load-slider', 'load-value', 'loadFactor', formatPercent);
  bindSlider('compliance-slider', 'compliance-value', 'compliance', formatPercent);
  bindSlider('families-slider', 'families-value', 'families', formatPercent);
  bindBinsSelect();
  bindSlider('politeness-slider', 'politeness-value', 'politeness', formatPercent);
  bindSlider('distracted-slider', 'distracted-value', 'distracted', formatPercent);
  bindSlider('prep-slider', 'prep-value', 'prepMedian', (value) => `${value.toFixed(2)} s`);
  bindBagSliders();
  bindSoundToggle();
  bindSplitTargetToggle();
  bindKeyboard();

  writeAllValues();

  // Re-sync UI labels when the store changes from anywhere (URL load, another module).
  store.subscribe((next) => writeAllValues(next));

  function bindModeToggle() {
    const buttons = document.querySelectorAll('.masthead .segmented .seg[data-mode]');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (mode !== 'deplane' && mode !== 'board') return;
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
        store.update({ mode });
      });
    }
  }

  function bindPrimaryButton() {
    // Both the main-column Restart and the sidebar Restart route through the same race handle,
    // so the sidebar copy is a real second control, not just a mirror.
    for (const id of ['btn-race', 'btn-race-side']) {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', () => race.restart());
    }
  }

  function bindSpeedGroup(current) {
    // The main column carries the compact speed pips (near the cabins). The sidebar carries
    // the same pips grouped with the other settings. Selecting either updates both groups so
    // there is one consistent "current speed" across the page.
    const groups = ['speed-group', 'speed-group-side']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const allButtons = [];
    for (const group of groups) {
      const buttons = group.querySelectorAll('.seg[data-speed]');
      for (const button of buttons) {
        const speed = Number(button.dataset.speed);
        button.setAttribute('aria-checked', String(speed === current));
        button.classList.toggle('on', speed === current);
        allButtons.push(button);
        button.addEventListener('click', () => {
          syncSpeedButtons(speed);
          race.setSpeed(speed);
        });
      }
    }
  }

  function bindSeedControls() {
    const newBtn = document.getElementById('btn-new-plane');
    const seedInput = document.getElementById('seed-input');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        const nextSeed = `plane-${Math.floor(Math.random() * 1e6).toString(36)}`;
        store.update({ seed: nextSeed });
      });
    }
    if (seedInput) {
      seedInput.value = store.state().seed;
      seedInput.addEventListener('change', () => {
        const value = seedInput.value.trim();
        if (value.length > 0) store.update({ seed: value });
      });
    }
  }

  function populatePresetSelect(currentId) {
    // The layout numbers stay in the option text because people recognise 3-3 and 2-3-2 by
    // shape. The plain label carries the aircraft name and seat count.
    const select = document.getElementById('preset-select');
    if (!select) return;
    select.innerHTML = '';
    for (const preset of CABIN_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      const seats = preset.rows * preset.layout.reduce((a, b) => a + b, 0);
      option.textContent = `${preset.label} · ${preset.layout.join('-')} · ${seats} seats`;
      if (preset.id === currentId) option.selected = true;
      select.appendChild(option);
    }
  }

  function bindPresetSelect() {
    const select = document.getElementById('preset-select');
    if (!select) return;
    select.addEventListener('change', () => store.update({ presetId: select.value }));
  }

  function bindBinsSelect() {
    const select = document.getElementById('bins-select');
    if (!select) return;
    select.value = store.state().bins;
    select.addEventListener('change', () => store.update({ bins: select.value }));
  }

  function bindSlider(sliderId, valueId, storeKey, formatter) {
    const slider = document.getElementById(sliderId);
    const valueNode = document.getElementById(valueId);
    if (!slider) return;
    slider.value = store.state()[storeKey];
    if (valueNode) valueNode.textContent = formatter(Number(slider.value));
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      if (valueNode) valueNode.textContent = formatter(value);
    });
    slider.addEventListener('change', () => {
      const value = Number(slider.value);
      store.update({ [storeKey]: value });
    });
  }

  function bindBagSliders() {
    // Fix for NEW-M5: pin the dragged slider at its exact value, spread the deficit or surplus
    // across the OTHER two proportionally, and drive every label from the same normalized value
    // its slider now sits at. That means the label under the thumb matches the thumb, all three
    // sum to 1.00 by construction, and dragging bag2 to 0.9 leaves it at 0.9 (not 0.55).
    const inputs = ['bag0-slider', 'bag1-slider', 'bag2-slider'].map((id) => document.getElementById(id));
    const values = ['bag0-value', 'bag1-value', 'bag2-value'].map((id) => document.getElementById(id));
    const keys = ['bagP0', 'bagP1', 'bagP2'];

    function updateFrom(pinnedIndex) {
      const pinned = clampUnit(Number(inputs[pinnedIndex].value));
      const remaining = Math.max(0, 1 - pinned);
      const others = [0, 1, 2].filter((i) => i !== pinnedIndex);
      const currentOthers = others.map((i) => clampUnit(Number(inputs[i].value)));
      const otherSum = currentOthers[0] + currentOthers[1];
      let redistributed;
      if (otherSum > 1e-6) {
        // Preserve the existing ratio between the two non-dragged sliders.
        redistributed = currentOthers.map((v) => (v / otherSum) * remaining);
      } else {
        // Both others were zero; split the remaining probability evenly.
        redistributed = [remaining / 2, remaining / 2];
      }
      const result = [0, 0, 0];
      result[pinnedIndex] = pinned;
      result[others[0]] = redistributed[0];
      result[others[1]] = redistributed[1];
      return result;
    }

    function applyValues(nextValues) {
      for (let i = 0; i < inputs.length; i += 1) {
        if (!inputs[i]) continue;
        inputs[i].value = String(nextValues[i]);
        if (values[i]) values[i].textContent = formatPercent(nextValues[i]);
      }
    }

    for (let i = 0; i < inputs.length; i += 1) {
      const slider = inputs[i];
      if (!slider) continue;
      const pinnedIndex = i;
      slider.value = store.state()[keys[i]];
      if (values[i]) values[i].textContent = formatPercent(Number(slider.value));

      // Drag preview: update all three labels live so what the user sees under every thumb
      // matches what the store will hold when they let go. No store write here.
      slider.addEventListener('input', () => {
        const next = updateFrom(pinnedIndex);
        applyValues(next);
      });
      slider.addEventListener('change', () => {
        const next = updateFrom(pinnedIndex);
        applyValues(next);
        store.update({ bagP0: next[0], bagP1: next[1], bagP2: next[2] });
      });
    }
  }

  function clampUnit(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function bindSoundToggle() {
    const toggle = document.getElementById('sound-toggle');
    if (!toggle) return;
    toggle.checked = store.state().sound;
    toggle.addEventListener('change', () => {
      store.update({ sound: toggle.checked });
      if (toggle.checked) sound.unlock();
    });
  }

  function bindSplitTargetToggle() {
    const group = document.getElementById('split-target');
    if (!group) return;
    const buttons = group.querySelectorAll('.seg[data-split]');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const kind = button.dataset.split;
        for (const other of buttons) {
          const isMatch = other === button;
          other.setAttribute('aria-checked', String(isMatch));
          other.classList.toggle('on', isMatch);
        }
        race.setSplitTarget(kind);
      });
    }
  }

  function bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const isText = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isText) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space') {
        event.preventDefault();
        race.togglePlay();
      } else if (key === 'r') {
        event.preventDefault(); race.restart();
      } else if (key === 'n') {
        event.preventDefault();
        const nextSeed = `plane-${Math.floor(Math.random() * 1e6).toString(36)}`;
        store.update({ seed: nextSeed });
      } else if (SPEEDS.map((s) => String(s)[0]).includes(key)) {
        // 1 -> 1x, 4 -> 4x. For 15x and 60x use 3 and 4 as spec-ish shortcuts.
      }
      if (key === '1') { race.setSpeed(1); syncSpeedButtons(1); }
      if (key === '2') { race.setSpeed(4); syncSpeedButtons(4); }
      if (key === '3') { race.setSpeed(15); syncSpeedButtons(15); }
      if (key === '4') { race.setSpeed(60); syncSpeedButtons(60); }
    });
  }

  function syncSpeedButtons(target) {
    // Sync both speed groups (main compact + sidebar) so the selection is visible wherever
    // the user is looking.
    for (const id of ['speed-group', 'speed-group-side']) {
      const group = document.getElementById(id);
      if (!group) continue;
      const buttons = group.querySelectorAll('.seg[data-speed]');
      for (const button of buttons) {
        const match = Number(button.dataset.speed) === target;
        button.setAttribute('aria-checked', String(match));
        button.classList.toggle('on', match);
      }
    }
  }

  function writeAllValues(next) {
    const s = next || store.state();
    setValue('load-slider', s.loadFactor);
    setText('load-value', formatPercent(s.loadFactor));
    setValue('compliance-slider', s.compliance);
    setText('compliance-value', formatPercent(s.compliance));
    setValue('families-slider', s.families);
    setText('families-value', formatPercent(s.families));
    setValue('politeness-slider', s.politeness);
    setText('politeness-value', formatPercent(s.politeness));
    setValue('distracted-slider', s.distracted);
    setText('distracted-value', formatPercent(s.distracted));
    setValue('prep-slider', s.prepMedian);
    setText('prep-value', `${Number(s.prepMedian).toFixed(2)} s`);
    setValue('bag0-slider', s.bagP0);
    setText('bag0-value', formatPercent(s.bagP0));
    setValue('bag1-slider', s.bagP1);
    setText('bag1-value', formatPercent(s.bagP1));
    setValue('bag2-slider', s.bagP2);
    setText('bag2-value', formatPercent(s.bagP2));
    setValue('preset-select', s.presetId);
    setValue('bins-select', s.bins);
    setValue('seed-input', s.seed);
    // Mode toggle
    for (const button of document.querySelectorAll('.masthead .segmented .seg[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === s.mode));
    }
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (String(el.value) !== String(value)) el.value = value;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}
