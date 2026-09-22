/**
 * Strategy registry. The UI, the batch runner, and the CLI look strategies up here by id.
 *
 * Deplane strategy shape: { id, label, blurb, canLeaveSeat(passenger, state) -> boolean }
 *   - called only for compliant passengers whose prep timer has run out; non-compliant ones and group
 *     members act free-for-all. Return true when the announced order lets this passenger stand now.
 * Board strategy shape:   { id, label, blurb, order(passengers, rng) -> Passenger[] }
 *   - returns the door queue order. The sim then shuffles non-compliant passengers a little and keeps
 *     groups adjacent. Open seating may also set passenger.row / col before returning.
 *
 * deplane.js and board.js each export an ordered array; this file indexes them.
 */

import { DEPLANE_STRATEGIES } from './deplane.js';
import { BOARD_STRATEGIES } from './board.js';

export { DEPLANE_STRATEGIES, BOARD_STRATEGIES };

export const DEPLANE_STRATEGY_BY_ID = Object.fromEntries(DEPLANE_STRATEGIES.map((strategy) => [strategy.id, strategy]));
export const BOARD_STRATEGY_BY_ID = Object.fromEntries(BOARD_STRATEGIES.map((strategy) => [strategy.id, strategy]));

export const DEFAULT_DEPLANE_STRATEGY_ID = 'free-for-all';
export const DEFAULT_BOARD_STRATEGY_ID = 'random';
