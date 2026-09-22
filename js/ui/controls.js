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
    const button = document.getElementById('btn-race');
    if (!button) return;
    button.addEventListener('click', () => race.restart());
  }

  function bindSpeedGroup(current) {
    const group = document.getElementById('speed-group');
    if (!group) return;
    const buttons = group.querySelectorAll('.seg[data-speed]');
    for (const button of buttons) {
      const speed = Number(button.dataset.speed);
      button.setAttribute('aria-checked', String(speed === current));
      button.classList.toggle('on', speed === current);
      button.addEventListener('click', () => {
        for (const other of buttons) {
          const otherSpeed = Number(other.dataset.speed);
          other.setAttribute('aria-checked', String(otherSpeed === speed));
          other.classList.toggle('on', otherSpeed === speed);
        }
        race.setSpeed(speed);
      });
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
    const select = document.getElementById('preset-select');
    if (!select) return;
    select.innerHTML = '';
    for (const preset of CABIN_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.label} · ${preset.layout.join('-')} · ${preset.rows * preset.layout.reduce((a, b) => a + b, 0)} seats`;
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
    const inputs = ['bag0-slider', 'bag1-slider', 'bag2-slider'].map((id) => document.getElementById(id));
    const values = ['bag0-value', 'bag1-value', 'bag2-value'].map((id) => document.getElementById(id));
    const keys = ['bagP0', 'bagP1', 'bagP2'];
    for (let i = 0; i < inputs.length; i += 1) {
      const slider = inputs[i];
      if (!slider) continue;
      slider.value = store.state()[keys[i]];
      if (values[i]) values[i].textContent = formatPercent(Number(slider.value));
      slider.addEventListener('input', () => {
        if (values[i]) values[i].textContent = formatPercent(Number(slider.value));
      });
      slider.addEventListener('change', () => {
        const raw = inputs.map((input, index) => Math.max(0, Number(input.value)));
        const sum = raw.reduce((total, value) => total + value, 0);
        const normalized = sum > 0 ? raw.map((value) => value / sum) : [0.2, 0.6, 0.2];
        // Reflect normalized values in the sliders and store.
        for (let j = 0; j < inputs.length; j += 1) {
          inputs[j].value = String(normalized[j]);
          if (values[j]) values[j].textContent = formatPercent(normalized[j]);
        }
        store.update({ bagP0: normalized[0], bagP1: normalized[1], bagP2: normalized[2] });
      });
    }
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
    const group = document.getElementById('speed-group');
    if (!group) return;
    const buttons = group.querySelectorAll('.seg[data-speed]');
    for (const button of buttons) {
      const match = Number(button.dataset.speed) === target;
      button.setAttribute('aria-checked', String(match));
      button.classList.toggle('on', match);
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
