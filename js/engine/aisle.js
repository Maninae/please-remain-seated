/**
 * Aisle cell operations shared by the deplaning and (later) boarding sims.
 *
 * Every aisle is one Int32Array of passenger ids (or EMPTY_CELL). This module owns the tiny
 * mutations both sims do on those arrays and the door-server bookkeeping. The lattice itself
 * lives on `state.aisles[aisleIndex]`; door servers live on `state.doors`.
 *
 * Exports:
 *   isCellEmpty(state, aisleIndex, cell)              -> boolean
 *   cellOccupant(state, aisleIndex, cell)             -> passenger id or EMPTY_CELL
 *   claimCell(state, aisleIndex, cell, passengerId)   place an id in an empty cell (asserts empty)
 *   releaseCell(state, aisleIndex, cell, passengerId) clear a cell (asserts it held that id)
 *   moveCell(state, aisleIndex, from, to, id)         atomic release + claim
 *   createDoorServers(cabin)                          front (and optional rear) shared servers
 *   doorTryAdmit(door, t, doorServiceSeconds)         admit one, arming busyUntil; returns bool
 */

import { EMPTY_CELL } from './types.js';

export function isCellEmpty(state, aisleIndex, cell) {
  return state.aisles[aisleIndex][cell] === EMPTY_CELL;
}

export function cellOccupant(state, aisleIndex, cell) {
  return state.aisles[aisleIndex][cell];
}

export function claimCell(state, aisleIndex, cell, passengerId) {
  const aisle = state.aisles[aisleIndex];
  if (aisle[cell] !== EMPTY_CELL) {
    throw new Error(
      `claimCell: aisle ${aisleIndex} cell ${cell} holds ${aisle[cell]}, expected EMPTY (adding ${passengerId})`,
    );
  }
  aisle[cell] = passengerId;
}

export function releaseCell(state, aisleIndex, cell, passengerId) {
  const aisle = state.aisles[aisleIndex];
  if (aisle[cell] !== passengerId) {
    throw new Error(
      `releaseCell: aisle ${aisleIndex} cell ${cell} holds ${aisle[cell]}, expected ${passengerId}`,
    );
  }
  aisle[cell] = EMPTY_CELL;
}

export function moveCell(state, aisleIndex, fromCell, toCell, passengerId) {
  releaseCell(state, aisleIndex, fromCell, passengerId);
  claimCell(state, aisleIndex, toCell, passengerId);
}

/**
 * The front door is one server shared across every aisle (a widebody's aisles merge in the
 * forward galley). The rear door, when the cabin has one, is another shared server. Each holds
 * `busyUntil` in simulation seconds; a passenger can cross when t >= busyUntil.
 */
export function createDoorServers(cabin) {
  return {
    front: { cell: cabin.frontDoorCell, busyUntil: 0 },
    rear: cabin.rearDoor ? { cell: cabin.rearDoorCell, busyUntil: 0 } : null,
  };
}

/**
 * Attempt to admit one passenger through `door` at time `t`. On success, mark the server busy
 * for `doorServiceSeconds`. Returns true on admission, false when the door is still busy.
 */
export function doorTryAdmit(door, t, doorServiceSeconds) {
  if (door.busyUntil > t + 1e-9) return false;
  door.busyUntil = t + doorServiceSeconds;
  return true;
}
