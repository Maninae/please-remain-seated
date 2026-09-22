/**
 * One entry point for building a sim of either mode from a seed and a handful of options.
 *
 * `createSimFromSeed({ mode, strategyId, seed, cabinOverrides, passengerOverrides, passengers, bins })`
 *   - samples the population and bins from the seed unless `passengers` (and, for deplaning, `bins`)
 *     are supplied, which is how the race shares one population and how a boarded plane is deplaned.
 *   - returns { step(dt), state, metrics, summary(), done } from deplane-sim.js or board-sim.js.
 *
 * Both sims must expose the same surface:
 *   step(dtSeconds): advance once; returns state.done
 *   state:           see types.js
 *   metrics:         see metrics.js
 *   summary():       summarizeMetrics(metrics, state) plus { mode, strategyId, seed }
 */

import { createRng } from './rng.js';
import { createCabin } from './cabin.js';
import { samplePassengers, assignBagsToBins, clonePassengers } from './passengers.js';
import { cloneBins } from './bins.js';
import { createDeplaneSim } from './deplane-sim.js';
import { createBoardSim } from './board-sim.js';
import { SimMode } from './types.js';

export function createSimFromSeed(options) {
  const {
    mode, strategyId, seed, cabinOverrides = {}, passengerOverrides = {}, passengers = null, bins = null,
  } = options;
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const population = passengers
    ? clonePassengers(passengers)
    : samplePassengers(cabin, passengerOverrides, rng.fork('population'));
  const strategyRng = rng.fork(`strategy:${strategyId}`);

  if (mode === SimMode.DEPLANE) {
    const startingBins = bins ? cloneBins(bins) : assignBagsToBins(cabin, population, rng.fork('bins'));
    return createDeplaneSim({ cabin, passengers: population, bins: startingBins, strategyId, params: passengerOverrides, rng: strategyRng, seed });
  }
  if (mode === SimMode.BOARD) {
    return createBoardSim({ cabin, passengers: population, strategyId, params: passengerOverrides, rng: strategyRng, seed });
  }
  throw new Error(`unknown sim mode: ${mode}`);
}

/** Sample a population once so several sims can share it (the race). */
export function samplePopulation({ seed, cabinOverrides = {}, passengerOverrides = {} }) {
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, passengerOverrides, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  return { cabin, passengers, bins };
}
