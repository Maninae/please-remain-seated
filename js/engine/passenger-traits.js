/**
 * Class-and-status traits drawn separately from the per-passenger physical traits so introducing
 * them does not shift the pre-existing rng stream a single-section preset consumes.
 *
 * `assignClassAndStatus(passengers, params, cabin, classRng)` fills these fields on every
 * passenger, respecting a section's `cabinClass` and any preset `premiumRows` list:
 *   cabinClass    'first' | 'business' | 'premium' | 'economy'  (from the seat's section)
 *   fare          'first' | 'business' | 'premium' | 'main' | 'basic'
 *                 First and business sections inherit the class name as the fare. A premium
 *                 section (or an economy seat flagged premium by section.premium or the
 *                 preset's `premiumRows`) is 'premium'. The rest of economy splits between
 *                 'basic' (share = `basicFareFraction`) and 'main'.
 *   status        'none' | 'silver' | 'gold' | 'top'   drawn against `statusFractions`.
 *   preboard      true for `preboardFraction` of passengers (families with small children,
 *                 wheelchair assistance). Pre-boarders board first regardless of strategy and
 *                 their group-mates go with them (handled by the airline strategies later).
 *
 * Every draw lives on its own fork so the existing per-passenger stream (bags, walk speed, prep,
 * yields, compliance, doorGap) stays bit-identical to what a single-section preset produced
 * before these fields existed. Group members share status, fare, and preboard after alignment.
 */

import { PASSENGER_DEFAULTS } from './config.js';

const STATUS_ORDER = Object.freeze(['none', 'silver', 'gold', 'top']);
const CLASS_TO_FARE = Object.freeze({ first: 'first', business: 'business', premium: 'premium' });

export function assignClassAndStatus(passengers, paramOverrides, cabin, classRng) {
  const params = { ...PASSENGER_DEFAULTS, ...paramOverrides };
  const statusFractions = params.statusFractions ?? PASSENGER_DEFAULTS.statusFractions;
  const statusCumulative = buildStatusCumulative(statusFractions);
  const basicFareFraction = params.basicFareFraction ?? PASSENGER_DEFAULTS.basicFareFraction;
  const preboardFraction = params.preboardFraction ?? PASSENGER_DEFAULTS.preboardFraction;
  for (const passenger of passengers) {
    const section = cabin.sections[cabin.sectionsIndex.rowIndex.sectionByRow[passenger.row]];
    passenger.cabinClass = section.cabinClass;
    passenger.fare = resolveFare(section, passenger.row, cabin.premiumRows, basicFareFraction, classRng);
    passenger.status = drawStatus(classRng.next(), statusCumulative);
    passenger.preboard = classRng.next() < preboardFraction;
  }
}

function buildStatusCumulative(fractions) {
  const cumulative = new Array(STATUS_ORDER.length);
  let running = 0;
  for (let index = 0; index < STATUS_ORDER.length; index += 1) {
    running += fractions[STATUS_ORDER[index]] ?? 0;
    cumulative[index] = running;
  }
  return cumulative;
}

function drawStatus(u, cumulative) {
  for (let index = 0; index < cumulative.length; index += 1) {
    if (u < cumulative[index]) return STATUS_ORDER[index];
  }
  return STATUS_ORDER[STATUS_ORDER.length - 1];
}

/**
 * Fare for one seat. First/business/premium sections inherit their class as the fare. Economy
 * seats flagged premium (by section.premium or by the preset's premiumRows list) also count as
 * 'premium'. The remaining economy seats split 'basic' vs 'main' from one draw.
 */
function resolveFare(section, row, premiumRows, basicFareFraction, classRng) {
  if (CLASS_TO_FARE[section.cabinClass]) return CLASS_TO_FARE[section.cabinClass];
  // Economy: check the extra-legroom flag before spending a draw on basic vs main so a preset
  // that flags rows premium stays deterministic even if basicFareFraction changes.
  if (section.premium || (premiumRows && premiumRows.has(row))) return 'premium';
  return classRng.next() < basicFareFraction ? 'basic' : 'main';
}

/**
 * After alignClassAndStatus fills every passenger, promote every group to a single shared
 * status/fare/preboard so a family boards as one priority tier. The leader is chosen as the
 * member with the highest per-status tier (top > gold > silver > none); every group-mate
 * inherits their status, fare, and preboard flag. This matches how airlines actually treat a
 * group PNR at the gate.
 */
export function alignGroupClassAndStatus(passengers) {
  const leadersByGroup = new Map();
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    const current = leadersByGroup.get(passenger.groupId);
    if (!current || rankStatus(passenger.status) > rankStatus(current.status)) {
      leadersByGroup.set(passenger.groupId, passenger);
    }
  }
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    const leader = leadersByGroup.get(passenger.groupId);
    passenger.status = leader.status;
    passenger.fare = leader.fare;
    passenger.preboard = leader.preboard;
  }
}

function rankStatus(status) {
  const index = STATUS_ORDER.indexOf(status);
  return index < 0 ? 0 : index;
}
