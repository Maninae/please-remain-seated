/**
 * Turn the store's plain state into the sim-factory's cabin and passenger overrides.
 *
 * A single source of truth for how UI knobs (preset, load factor, families, bin era, ...) map
 * onto the engine's `cabinOverrides` and `passengerOverrides`. Race and Compare both call these
 * so the compare batch always simulates the exact configuration on-screen.
 */

import { CABIN_PRESET_BY_ID } from '../engine/cabin-presets.js';
import { DEPLANE_STRATEGY_BY_ID } from '../engine/strategies/index.js';

export function cabinOverridesFromState(state) {
  const preset = CABIN_PRESET_BY_ID[state.presetId] || CABIN_PRESET_BY_ID.a320;
  const overrides = {
    loadFactor: state.loadFactor,
  };
  if (Array.isArray(preset.sections) && preset.sections.length > 0) {
    // Sectioned preset: hand the sections through unchanged. Each section carries its own
    // layout, pitch, and bin era; the top-level `binCapacityPerSeatRow` still rides along so
    // the single-section fallback the engine keeps for older overrides stays consistent.
    overrides.sections = preset.sections;
    if (preset.premiumRows) overrides.premiumRows = preset.premiumRows;
    if (Number.isFinite(preset.binCapacityPerSeatRow)) {
      overrides.binCapacityPerSeatRow = preset.binCapacityPerSeatRow;
    }
  } else {
    overrides.layout = preset.layout.slice();
    overrides.rows = preset.rows;
    overrides.rowPitchMeters = preset.rowPitchMeters;
    overrides.binCapacityPerSeatRow = preset.binCapacityPerSeatRow;
    // Legacy bin era only applies to single-section presets: each section on a multi-class
    // preset already declares its own bin era (a lie-flat business bin is per-suite, not the
    // shared main-cabin bin), so overriding here would misreport a business cabin as a legacy
    // retrofit. This is the same rule the design contract uses.
    if (state.bins === 'legacy') overrides.binCapacityPerSeatRow = 0.67;
  }
  return overrides;
}

export function passengerOverridesFromState(state) {
  const raw = [state.bagP0, state.bagP1, state.bagP2];
  const total = raw.reduce((sum, value) => sum + Math.max(0, value), 0);
  const normalized = total > 0 ? raw.map((value) => Math.max(0, value) / total) : [0.2, 0.6, 0.2];
  return {
    compliance: state.compliance,
    groupFraction: state.families,
    politeness: state.politeness,
    distractedFraction: state.distracted,
    prepMedianSeconds: state.prepMedian,
    bagCountProbabilities: normalized,
  };
}

/** Strategy-specific cabin overrides (only two-doors uses this today). */
export function strategyCabinOverridesFor(mode, strategyId) {
  if (mode !== 'deplane') return null;
  const strategy = DEPLANE_STRATEGY_BY_ID[strategyId];
  return strategy && strategy.cabinOverrides ? strategy.cabinOverrides : null;
}
