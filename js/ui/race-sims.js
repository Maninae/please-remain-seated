/**
 * Builders for the two race sims. Owns nothing DOM: just turns a store snapshot into two ready
 * sims that race.js drops into its race loop.
 *
 * - `buildRaceSims(state, currentStrategyIdForLane)` samples one shared population and returns
 *   both lane sims (createSimFromSeed clones per lane so the two do not share mutable passengers).
 * - `buildDeplaneFromBoarded(state, boardedState, currentStrategyIdForLane)` starts a deplaning
 *   pair from a plane that just finished boarding: same passengers (reset), same bins, whatever
 *   deplane strategies the store now names.
 * - `revivePassengersForDeplaning(passengers)` clears the boarding-only fields on each passenger.
 */

import { createSimFromSeed, samplePopulation } from '../engine/sim-factory.js';
import {
  cabinOverridesFromState, passengerOverridesFromState, strategyCabinOverridesFor,
} from './sim-config.js';

export function buildRaceSims(state, currentStrategyIdForLane) {
  const cabinOverrides = cabinOverridesFromState(state);
  const passengerOverrides = passengerOverridesFromState(state);
  const population = samplePopulation({ seed: state.seed, cabinOverrides, passengerOverrides });
  const sims = [];
  for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
    const strategyId = currentStrategyIdForLane(laneIndex);
    const laneCabinOverrides = {
      ...cabinOverrides,
      ...(strategyCabinOverridesFor(state.mode, strategyId) || {}),
    };
    sims.push(createSimFromSeed({
      mode: state.mode,
      strategyId,
      seed: state.seed,
      cabinOverrides: laneCabinOverrides,
      passengerOverrides,
      passengers: population.passengers,
      bins: state.mode === 'deplane' ? population.bins : null,
    }));
  }
  return sims;
}

export function buildDeplaneFromBoarded(state, boardedState, currentStrategyIdForLane) {
  const passengerOverrides = passengerOverridesFromState(state);
  const cabinOverrides = {
    layout: boardedState.cabin.layout.slice(),
    rows: boardedState.cabin.rows,
    rearDoor: boardedState.cabin.rearDoor,
    binCapacityPerSeatRow: boardedState.cabin.binCapacityPerSeatRow,
    loadFactor: state.loadFactor,
  };
  const revived = revivePassengersForDeplaning(boardedState.passengers);
  const bins = boardedState.bins;
  const sims = [];
  for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
    const strategyId = currentStrategyIdForLane(laneIndex);
    const laneCabinOverrides = {
      ...cabinOverrides,
      ...(strategyCabinOverridesFor('deplane', strategyId) || {}),
    };
    sims.push(createSimFromSeed({
      mode: 'deplane',
      strategyId,
      seed: state.seed,
      cabinOverrides: laneCabinOverrides,
      passengerOverrides,
      passengers: revived,
      bins,
    }));
  }
  return sims;
}

export function revivePassengersForDeplaning(passengers) {
  // Boarding leaves per-passenger phase, aisleCell, timers, and vis set from the seating loop.
  // Reset them (and clone the arrays) so the deplaning sim can drive the same population fresh.
  // Keeps geometry (row, col, block, aisle, side, depth), bags, and behaviour traits.
  return passengers.map((passenger) => ({
    ...passenger,
    bagBins: passenger.bagBins.slice(),
    retrievalSeconds: passenger.retrievalSeconds.slice(),
    stowSeconds: passenger.stowSeconds.slice(),
    timeSplit: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
    phase: null,
    vis: 'seated',
    aisleCell: null,
    timer: 0,
  }));
}
