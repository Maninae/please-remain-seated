/**
 * Strategy registry. The UI, the batch runner, and the CLI look strategies up here by id.
 *
 * Deplane strategy shape: { id, label, blurb, canLeaveSeat(passenger, state) -> boolean }
 *   - called only for compliant passengers whose prep timer has run out; non-compliant ones and group
 *     members act free-for-all. Return true when the announced order lets this passenger stand now.
 * Board strategy shape:   { id, label, blurb, family, order(passengers, rng, cabin) -> Passenger[] }
 *   - returns the door queue order. The sim then shuffles non-compliant passengers a little and keeps
 *     groups adjacent. Open seating may also set passenger.row / col before returning.
 *   - `family` is 'textbook' for the nine methods that live in board.js (random, WILMA, Steffen,
 *     Steffen-modified, reverse pyramid, back-to-front, front-to-back, rotating zones, open
 *     seating) and 'airline' for the fourteen airline strategies in airlines.js. The UI groups
 *     the two families under separate headers so a reader sees "textbook methods" vs "how
 *     airlines actually board" without having to know each id.
 *
 * BOARD_STRATEGIES here is the combined, family-tagged list every consumer imports. The tagged
 * versions replace the un-tagged entries board.js exports on its own, so board-sim.js also
 * looks strategies up via BOARD_STRATEGY_BY_ID from this file (not from board.js directly).
 */

import { DEPLANE_STRATEGIES } from './deplane.js';
import { BOARD_STRATEGIES as BOARD_TEXTBOOK_STRATEGIES } from './board.js';
import { AIRLINE_STRATEGIES } from './airlines.js';

export { DEPLANE_STRATEGIES };

function tagFamily(strategies, family) {
  return strategies.map((strategy) => (strategy.family === family ? strategy : { ...strategy, family }));
}

export const BOARD_STRATEGIES = Object.freeze([
  ...tagFamily(BOARD_TEXTBOOK_STRATEGIES, 'textbook'),
  ...tagFamily(AIRLINE_STRATEGIES, 'airline'),
]);

export const DEPLANE_STRATEGY_BY_ID = Object.fromEntries(DEPLANE_STRATEGIES.map((strategy) => [strategy.id, strategy]));
export const BOARD_STRATEGY_BY_ID = Object.fromEntries(BOARD_STRATEGIES.map((strategy) => [strategy.id, strategy]));

export const DEFAULT_DEPLANE_STRATEGY_ID = 'free-for-all';
export const DEFAULT_BOARD_STRATEGY_ID = 'random';
