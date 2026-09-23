/**
 * Shared preset-to-overrides logic used by tools/simulate.mjs and tools/precompute.mjs.
 *
 * A cabin preset in js/engine/cabin-presets.js is either single-class (top-level layout / rows /
 * rowPitchMeters / binCapacityPerSeatRow) or sectioned (a `sections` array). The engine's
 * `createCabin(overrides)` takes the same shape either way, so the callers only need to unwrap
 * the preset into an `overrides` object and drop in whatever extras the run wants (a rear door,
 * a legacy bin era, ...).
 *
 * `cabinOverridesFromPreset(preset, extras)`:
 *   - extras.rearDoor {boolean}          : force rearDoor = true on top of the preset.
 *   - extras.binCapacityPerSeatRow {num} : override bins for the whole cabin. On a sectioned
 *                                          preset the value is stamped on every section so
 *                                          "legacy bins on a 787-9" means every section gets
 *                                          0.67, not just the top-level fallback.
 *
 * `passengerOverridesFromKnobs(knobs)`:
 *   - knobs.load          -> params.loadFactor
 *   - knobs.compliance    -> params.compliance
 *   - knobs.groups        -> params.groupFraction
 *   - knobs.bags          -> params.bagCountProbabilities  (must be a 3-element array)
 */

/**
 * Extras (all optional):
 *   - rearDoor: boolean
 *   - binCapacityPerSeatRow: number  applies to top-level AND every section on a sectioned preset
 */
export function cabinOverridesFromPreset(preset, extras = {}) {
  const overrides = preset.sections
    ? {
        sections: preset.sections.map((section) => ({ ...section })),
        binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
        premiumRows: preset.premiumRows,
      }
    : {
        layout: preset.layout.slice(),
        rows: preset.rows,
        binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
        rowPitchMeters: preset.rowPitchMeters,
      };

  if (extras.rearDoor) overrides.rearDoor = true;

  if (typeof extras.binCapacityPerSeatRow === 'number') {
    overrides.binCapacityPerSeatRow = extras.binCapacityPerSeatRow;
    if (Array.isArray(overrides.sections)) {
      overrides.sections = overrides.sections.map((section) => ({
        ...section,
        binCapacityPerSeatRow: extras.binCapacityPerSeatRow,
      }));
    }
  }

  return overrides;
}

/**
 * Turn a knob bag into the { params } dict createSimFromSeed expects for passengerOverrides.
 * Only known keys are forwarded; unknown keys are ignored so a caller can pass a full knob dict
 * that includes non-passenger knobs (like `bins`) without polluting the passenger config.
 */
export function passengerOverridesFromKnobs(knobs = {}) {
  const params = {};
  if (typeof knobs.load === 'number') params.loadFactor = knobs.load;
  if (typeof knobs.compliance === 'number') params.compliance = knobs.compliance;
  if (typeof knobs.groups === 'number') params.groupFraction = knobs.groups;
  if (Array.isArray(knobs.bagCountProbabilities)) params.bagCountProbabilities = knobs.bagCountProbabilities.slice();
  return params;
}
