/**
 * Airline boarding strategies, one per carrier. Each entry encodes the published boarding order
 * from design/06-airline-research.md as a list of `groups` that `orderByGroups` (see
 * group-order.js) unfolds into a queue. Every strategy carries an `asOf` month and a `source`
 * URL so the UI popover can cite the airline's own page.
 *
 * Shape:
 *   {
 *     id, label, blurb,
 *     family: 'airline',
 *     asOf: 'YYYY-MM',
 *     source: URL,
 *     groups: [ { id, label, member(passenger, cabin, context), within? }, ... ],
 *     notes?,
 *     order(passengers, rng, cabin)      // wraps orderByGroups, added below.
 *   }
 *
 * `member(passenger, cabin, context)` reads the passenger's attributes (`cabinClass`, `status`,
 * `fare`, `preboard`, `cardholder`, `military`, `groupId`, `row`, `seatDepth`) plus the cabin's
 * shape (`cabin.rows` for the front-vs-rear split, `context.seatType(passenger)` for WILMA). It
 * MUST NOT touch the passenger list or the sim state. Pre-boarders (families with kids,
 * assistance) bypass every group and go first inside `orderByGroups`.
 *
 * Choices made where the research report flags a gap:
 *   - Frontier 6 vs 7 back/front split: research says Frontier's FAQ does not spell out which
 *     half boards first, but the industry secondary reads it as "rear then front". We take that
 *     documented-secondary reading and say so in `notes`.
 *   - Air Canada zones 4-6 rear-first tendency: Air Canada's own page lists three general
 *     groups without a within-zone rule; upgradedpoints reports a rear-first tendency. We use
 *     `within: 'rear-half-first'` for the general group and note the source.
 *   - Southwest within-group tiebreak: research flags no confirmation from Southwest.com whether
 *     the ties are by seat, check-in time, or random. We choose 'random' (the documented
 *     secondary reading) and note it.
 *   - Spirit is excluded from the shipped list (ceased operations May 2, 2026 per CNN / NPR).
 *     Kept as a one-line comment below so a future contributor sees why.
 *   - easyJet and Ryanair board through both doors in reality. This build boards through the
 *     front door only (rear-door boarding was scoped as optional and skipped to avoid touching
 *     board-sim's arrival path). Both strategies note this in `notes`.
 *
 * WHEN YOU ADD OR CHANGE AN AIRLINE: update the `asOf` month and re-verify the `source` URL
 * against the airline's own boarding page. The research report design/06-airline-research.md is
 * the source of truth.
 */

import { orderByGroups } from './group-order.js';

// Small membership helpers shared by every airline. Each reads only the passenger's traits (and
// cabin.rows for the front/back split) so the strategy definitions stay readable.
const isFirstClass = (p) => p.cabinClass === 'first';
const isBusinessClass = (p) => p.cabinClass === 'business';
const isPremiumEconomyClass = (p) => p.cabinClass === 'premium';
const isEconomyClass = (p) => p.cabinClass === 'economy';
const isExtraLegroom = (p) => isEconomyClass(p) && p.fare === 'premium';
const isBasicFare = (p) => p.fare === 'basic';
const isMainEconomy = (p) => isEconomyClass(p) && !isBasicFare(p) && !isExtraLegroom(p);
const inRearHalf = (p, cabin) => p.row > cabin.rows / 2;
const inFrontHalf = (p, cabin) => p.row <= cabin.rows / 2;
const isWindow = (p, _cabin, ctx) => ctx.seatType(p) === 'window';
const isMiddle = (p, _cabin, ctx) => ctx.seatType(p) === 'middle';
const isAisle = (p, _cabin, ctx) => ctx.seatType(p) === 'aisle';

// -----------------------------------------------------------------------------
// Alaska Airlines. Published order: F, A (top + military), B (silver + premium), C (cardholder),
// D (main rear), E (main front), F (Saver). Source: alaskaair.com/content/travel-info/flight-
// experience/our-boarding-process. Style: hybrid status/cabin then back-to-front for main.
// -----------------------------------------------------------------------------
const alaskaStrategy = {
  id: 'alaska',
  label: 'Alaska Airlines',
  blurb: 'First and top elites, then Gold and military, silver and premium, cards, main rear then front, Saver last.',
  family: 'airline',
  asOf: '2026-09',
  source: 'https://www.alaskaair.com/content/travel-info/flight-experience/our-boarding-process',
  groups: [
    { id: 'first', label: 'First Class + Atmos Titanium', member: (p) => isFirstClass(p) || p.status === 'top' },
    { id: 'A', label: 'A: Platinum/Gold + military', member: (p) => p.status === 'gold' || p.military },
    { id: 'B', label: 'B: Silver + Premium Class', member: (p) => p.status === 'silver' || isExtraLegroom(p) },
    { id: 'C', label: 'C: Visa cardholders', member: (p) => p.cardholder },
    { id: 'D', label: 'D: Main Cabin rear half', member: (p, c) => isMainEconomy(p) && inRearHalf(p, c) },
    { id: 'E', label: 'E: Main Cabin front half', member: (p, c) => isMainEconomy(p) && inFrontHalf(p, c) },
    { id: 'F-saver', label: 'F: Saver fare', member: isBasicFare },
  ],
  notes: 'Hybrid status-then-back-to-front. Alaska simplified to A-F in 2024; Hawaiian mirrors this on the shared PSS.',
};

// -----------------------------------------------------------------------------
// American Airlines. Nine numbered groups plus Concierge/F/J/military preboard courtesy. Source:
// aa.com/i18n/travel-info/during-trip/boarding-your-flight.jsp. Style: pure status/fare, no
// seat-location ordering. Basic Economy moves to group 7 in 2026, then groups 8-9 for general.
// -----------------------------------------------------------------------------
const americanStrategy = {
  id: 'american',
  label: 'American Airlines',
  blurb: 'F/J and top elites and military, then elites and Premium, cards, MCE, main, Basic last.',
  family: 'airline',
  asOf: '2026-05',
  source: 'https://www.aa.com/i18n/travel-info/during-trip/boarding-your-flight.jsp',
  groups: [
    { id: '1', label: 'ConciergeKey / F / J / top / military', member: (p) => isFirstClass(p) || isBusinessClass(p) || p.status === 'top' || p.military },
    { id: '2-3', label: 'Platinum Pro/Sapphire + Premium Economy', member: (p) => p.status === 'gold' || isPremiumEconomyClass(p) },
    { id: '4', label: 'Gold + AAdvantage cardholders', member: (p) => p.status === 'silver' || p.cardholder },
    { id: '5', label: 'Main Cabin Extra / Preferred', member: isExtraLegroom },
    { id: '6', label: 'Main Cabin', member: isMainEconomy },
    { id: '7-9', label: 'Basic Economy', member: isBasicFare },
  ],
  notes: 'Pure fare/status hierarchy, no window-first within a group. Basic Economy moved to group 7 in 2026 per thepointsguy.',
};

// -----------------------------------------------------------------------------
// Delta Air Lines. Numbered rework rolled out 2024, now 8 groups plus military preboard.
// Source: delta.com/us/en/onboard/travel-experience-onboard/boarding.
// -----------------------------------------------------------------------------
const deltaStrategy = {
  id: 'delta',
  label: 'Delta Air Lines',
  blurb: 'F/One and military, Diamond and Premium Select, Comfort+, Sky Priority and cards, main, Basic last.',
  family: 'airline',
  asOf: '2026-06',
  source: 'https://www.delta.com/us/en/onboard/travel-experience-onboard/boarding',
  groups: [
    { id: '1', label: 'Delta One / First + military', member: (p) => isFirstClass(p) || isBusinessClass(p) || p.military },
    { id: '2', label: 'Diamond + Premium Select', member: (p) => p.status === 'top' || isPremiumEconomyClass(p) },
    { id: '3', label: 'Comfort+', member: isExtraLegroom },
    { id: '4', label: 'Sky Priority (Platinum/Gold + Amex Reserve)', member: (p) => p.status === 'gold' || p.status === 'silver' || p.cardholder },
    { id: '5-7', label: 'Main Cabin', member: isMainEconomy },
    { id: '8', label: 'Basic Economy', member: isBasicFare },
  ],
  notes: 'Pure fare/status; no seat-location tiebreak within a group.',
};

// -----------------------------------------------------------------------------
// United Airlines. WILMA (Window/Middle/Aisle) in economy since Oct 2023. Source: Business
// Traveller Oct 2023. Style: 3 priority groups, then window/middle/aisle in economy, Basic last.
// This is the strategy the "windows before middles before aisles" test targets.
// -----------------------------------------------------------------------------
const unitedStrategy = {
  id: 'united',
  label: 'United Airlines',
  blurb: 'Polaris/First, top elites and military; then elites and cards; then windows, middles, aisles in economy.',
  family: 'airline',
  asOf: '2026-01',
  source: 'https://www.united.com/ual/en/us/fly/travel/inflight/boarding.html',
  groups: [
    { id: '1', label: 'Polaris / First / 1K / Star Alliance Gold / military', member: (p) => isFirstClass(p) || isBusinessClass(p) || p.status === 'top' || p.military },
    { id: '2', label: 'Premier Platinum/Gold + premium cards', member: (p) => p.status === 'gold' || p.cardholder },
    { id: '3', label: 'Premier Silver + Economy Plus', member: (p) => p.status === 'silver' || isExtraLegroom(p) || isPremiumEconomyClass(p) },
    { id: '4', label: 'Economy window', member: (p, c, ctx) => isMainEconomy(p) && isWindow(p, c, ctx) },
    { id: '5', label: 'Economy middle', member: (p, c, ctx) => isMainEconomy(p) && isMiddle(p, c, ctx) },
    { id: '6', label: 'Economy aisle', member: (p, c, ctx) => isMainEconomy(p) && isAisle(p, c, ctx) },
    { id: '7', label: 'Basic Economy', member: isBasicFare },
  ],
  notes: 'WILMA in economy. United claims 2 minutes saved per turn (CNBC Select).',
};

// -----------------------------------------------------------------------------
// Southwest (2026 assigned seats). Launched Jan 27, 2026 with 8 numbered groups plus military
// preboard. Source: southwest.com/customer-enhancements/assigned-seating. Style: fare + status
// + seat-type, not row-based. Family boarding for adult+child<=6 sits between groups 2 and 3.
// -----------------------------------------------------------------------------
const southwestStrategy = {
  id: 'southwest',
  label: 'Southwest (2026 assigned seats)',
  blurb: 'A-List Preferred, then A-List, Extra Legroom, Choice Preferred, cards, Choice, Basic last.',
  family: 'airline',
  asOf: '2026-01',
  source: 'https://www.southwest.com/customer-enhancements/assigned-seating/',
  groups: [
    { id: 'A-list-pref', label: 'A-List Preferred', member: (p) => p.status === 'top' },
    { id: '1', label: 'A-List + Choice Extra', member: (p) => p.status === 'gold' },
    { id: '2', label: 'Extra Legroom', member: isExtraLegroom },
    { id: '3-4', label: 'Choice Preferred', member: (p) => p.status === 'silver' },
    { id: '5', label: 'Rapid Rewards cardholders', member: (p) => p.cardholder },
    { id: '6-7', label: 'Choice', member: isMainEconomy },
    { id: '8', label: 'Basic', member: isBasicFare },
  ],
  notes: 'No F cabin. Within-group tiebreak not spelled out on southwest.com (documented secondary reading is random).',
};

// -----------------------------------------------------------------------------
// JetBlue. New numbered system live Apr 29, 2026. Source: jetblue.com/help/boarding-procedures.
// Style: hybrid, groups 4-8 by seat location (rear-first is the reported pattern).
// -----------------------------------------------------------------------------
const jetblueStrategy = {
  id: 'jetblue',
  label: 'JetBlue',
  blurb: 'Mint and top Mosaic, then EvenMore, cards and Blue Extra, then general rear-first, Basic last.',
  family: 'airline',
  asOf: '2026-04',
  source: 'https://www.jetblue.com/help/boarding-procedures',
  groups: [
    { id: '1', label: 'Mint + Mosaic 3/4', member: (p) => isBusinessClass(p) || isFirstClass(p) || p.status === 'top' },
    { id: '2', label: 'EvenMore + Mosaic 1/2', member: (p) => isExtraLegroom(p) || p.status === 'gold' },
    { id: '3', label: 'Cards + Blue Extra + military', member: (p) => p.cardholder || p.status === 'silver' || p.military },
    { id: '4-8', label: 'General boarding, rear-first', member: (p) => isEconomyClass(p) && !isBasicFare(p), within: 'rear-half-first' },
    { id: 'blue-basic', label: 'Blue Basic', member: isBasicFare },
  ],
  notes: 'Rear-first is reported (thepointsguy, aviationa2z) rather than fully spelled out by JetBlue.',
};

// Spirit Airlines ceased operations May 2, 2026 (CNN, NPR); excluded from the live shipped list.

// -----------------------------------------------------------------------------
// Frontier Airlines. 7 groups since Oct 2, 2025. Source: news.flyfrontier.com. Groups 6-7 split
// Basic between rear and front; the split is a secondary-source reading (upgradedpoints), not
// spelled out on Frontier's FAQ, so we take the documented-secondary reading and note it.
// -----------------------------------------------------------------------------
const frontierStrategy = {
  id: 'frontier',
  label: 'Frontier',
  blurb: 'Elite bundles, silver, paid carry-ons, cards and premium seats, members, then Basic rear then front.',
  family: 'airline',
  asOf: '2025-10',
  source: 'https://news.flyfrontier.com/frontier-airlines-unveils-new-streamlined-boarding-process/',
  groups: [
    { id: '1', label: 'Elite Plat/Gold + premium bundle + Board First', member: (p) => p.status === 'top' || p.status === 'gold' || isBusinessClass(p) || isFirstClass(p) },
    { id: '2', label: 'Silver + carry-on / Economy Bundle', member: (p) => p.status === 'silver' },
    { id: '3', label: 'Paid carry-on / Economy Bundle', member: isExtraLegroom },
    { id: '4', label: 'World Mastercard + Priority + Premium/Exit', member: (p) => p.cardholder },
    { id: '5', label: 'Frontier Miles members general', member: (p) => isMainEconomy(p) },
    { id: '6', label: 'Basic, rear half', member: (p, c) => isBasicFare(p) && inRearHalf(p, c) },
    { id: '7', label: 'Basic, front half', member: (p, c) => isBasicFare(p) && inFrontHalf(p, c) },
  ],
  notes: 'Split at 6/7 rear-then-front is the documented-secondary reading (upgradedpoints); Frontier FAQ lists only "remaining fares".',
};

// -----------------------------------------------------------------------------
// Hawaiian Airlines. Aligned with Alaska's A-F on the shared PSS in 2026. Source: Alaska/Hawaiian
// PSS transition news. Mirrors Alaska's order exactly for narrowbody A321neo.
// -----------------------------------------------------------------------------
const hawaiianStrategy = {
  id: 'hawaiian',
  label: 'Hawaiian Airlines',
  blurb: 'Mirrors Alaska A-F: First, elites and military, silver, cards, main rear then front, Basic last.',
  family: 'airline',
  asOf: '2026-06',
  source: 'https://news.alaskaair.com/company/alaska-airlines-hawaiian-airlines-transition-to-shared-passenger-service-system-to-deliver-a-more-seamless-guest-experience/',
  groups: [
    { id: 'first', label: 'First + top-tier', member: (p) => isFirstClass(p) || p.status === 'top' },
    { id: 'A', label: 'A: Gold + military', member: (p) => p.status === 'gold' || p.military },
    { id: 'B', label: 'B: Silver + Extra Comfort', member: (p) => p.status === 'silver' || isExtraLegroom(p) },
    { id: 'C', label: 'C: Cardholders', member: (p) => p.cardholder },
    { id: 'D', label: 'D: Main rear', member: (p, c) => isMainEconomy(p) && inRearHalf(p, c) },
    { id: 'E', label: 'E: Main front', member: (p, c) => isMainEconomy(p) && inFrontHalf(p, c) },
    { id: 'F-basic', label: 'F: Basic', member: isBasicFare },
  ],
  notes: 'Post 2026 Alaska/Hawaiian PSS integration; procedure mirrors Alaska.',
};

// -----------------------------------------------------------------------------
// Ryanair. Two effective groups plus PRM pre-board. Source: whichterminal.co.uk. Priority is
// a paid fare bucket rather than a status thing; we key it on premium (Priority fare) OR
// cardholder (the paid-priority proxy).
// -----------------------------------------------------------------------------
const ryanairStrategy = {
  id: 'ryanair',
  label: 'Ryanair',
  blurb: 'PRM pre-board, then Priority with two cabin bags, then general boarding.',
  family: 'airline',
  asOf: '2026-01',
  source: 'https://whichterminal.co.uk/guides/ryanair-boarding-process-explained',
  groups: [
    { id: 'priority', label: 'Priority + 2 Cabin Bags', member: (p) => isExtraLegroom(p) || p.cardholder || p.status !== 'none' },
    { id: 'general', label: 'General', member: () => true },
  ],
  notes: 'Ryanair often boards front AND rear doors on stand; this build boards through the front door only.',
};

// -----------------------------------------------------------------------------
// easyJet. 3 nominal groups after pre-board. Source: upgradedpoints.com/travel/airlines/
// easyjet-boarding-groups. easyJet uniquely boards front and back doors simultaneously in
// reality; this build boards through the front door only.
// -----------------------------------------------------------------------------
const easyjetStrategy = {
  id: 'easyjet',
  label: 'easyJet',
  blurb: 'Speedy Boarding (Plus, Up Front, Extra Legroom) first, then general boarding.',
  family: 'airline',
  asOf: '2026-01',
  source: 'https://upgradedpoints.com/travel/airlines/easyjet-boarding-groups/',
  groups: [
    { id: 'speedy', label: 'Speedy Boarding (Plus, Up Front, Extra Legroom)', member: (p) => isExtraLegroom(p) || p.cardholder || p.status !== 'none' },
    { id: 'general', label: 'General', member: () => true },
  ],
  notes: 'easyJet boards front and rear doors simultaneously on stand; this build boards through the front door only. Families with kids under 5 are covered by the pre-board wave.',
};

// -----------------------------------------------------------------------------
// Lufthansa. Continental short-haul 3 groups post-priority, long-haul 4. WILMA in economy per
// secondary sources plus Lufthansa's group visual. Source: lufthansa.com/us/en/boarding.
// -----------------------------------------------------------------------------
const lufthansaStrategy = {
  id: 'lufthansa',
  label: 'Lufthansa',
  blurb: 'First/HON, Business/Senator, Premium Econ; then windows, middles, aisles; Light last.',
  family: 'airline',
  asOf: '2026-06',
  source: 'https://www.lufthansa.com/us/en/boarding',
  groups: [
    { id: '1', label: 'First / HON Circle', member: (p) => isFirstClass(p) || p.status === 'top' },
    { id: '2', label: 'Business / Senator / Star Alliance Gold', member: (p) => isBusinessClass(p) || p.status === 'gold' },
    { id: '3', label: 'Premium Economy', member: (p) => isPremiumEconomyClass(p) || isExtraLegroom(p) },
    { id: '4', label: 'Economy window', member: (p, c, ctx) => isMainEconomy(p) && isWindow(p, c, ctx) },
    { id: '5', label: 'Economy middle', member: (p, c, ctx) => isMainEconomy(p) && isMiddle(p, c, ctx) },
    { id: '6', label: 'Economy aisle', member: (p, c, ctx) => isMainEconomy(p) && isAisle(p, c, ctx) },
    { id: '7', label: 'Light fare (last)', member: isBasicFare },
  ],
  notes: 'Short-haul group count varies by leg; the WILMA split is documented in Lufthansa’s group visual and secondary sources. Light fare boards last (Lufthansa’s basic-economy equivalent).',
};

// -----------------------------------------------------------------------------
// British Airways. Simplified to 5 groups long-haul, 4 short-haul (April 2025). Source:
// britishairways.com/content/information/checking-in-and-boarding/boarding. No seat-location
// ordering within groups.
// -----------------------------------------------------------------------------
const britishAirwaysStrategy = {
  id: 'british-airways',
  label: 'British Airways',
  blurb: 'First and Gold, Club and Silver, Premium Econ, Bronze, main, Basic on short-haul.',
  family: 'airline',
  asOf: '2025-04',
  source: 'https://www.britishairways.com/content/information/checking-in-and-boarding/boarding',
  groups: [
    { id: '1', label: 'First / Concorde Room / Gold', member: (p) => isFirstClass(p) || p.status === 'top' },
    { id: '2', label: 'Club / Silver / Premium Economy', member: (p) => isBusinessClass(p) || p.status === 'gold' || isPremiumEconomyClass(p) || isExtraLegroom(p) },
    { id: '3', label: 'Bronze / oneworld Ruby', member: (p) => p.status === 'silver' },
    { id: '4', label: 'Rest of Euro/World Traveller', member: isMainEconomy },
    { id: '5', label: 'Basic (short-haul)', member: isBasicFare },
  ],
  notes: 'Simplified to 5 groups LH / 4 SH in April 2025. No seat-location tiebreak.',
};

// -----------------------------------------------------------------------------
// Air Canada. Source: aircanada.com/ca/en/aco/home/fly/at-the-airport/boarding-by-zone.html.
// Air Canada's own page does not spell out a within-zone rule; upgradedpoints reports that
// zones 4-6 tend to fill from the rear. We take that documented-secondary reading via
// within: 'rear-half-first' on the general boarding group and note it.
// -----------------------------------------------------------------------------
const airCanadaStrategy = {
  id: 'air-canada',
  label: 'Air Canada',
  blurb: 'J/Super Elite, Premium Econ and top Aeroplan and cards, Latitude/Comfort, then general rear-first.',
  family: 'airline',
  asOf: '2026-06',
  source: 'https://www.aircanada.com/ca/en/aco/home/fly/at-the-airport/boarding-by-zone.html',
  groups: [
    { id: '1', label: 'Business / Signature / Super Elite + military', member: (p) => isBusinessClass(p) || isFirstClass(p) || p.status === 'top' || p.military },
    { id: '2', label: 'Premium Economy + 75K/50K/35K/25K + premium cards', member: (p) => isPremiumEconomyClass(p) || p.status === 'gold' || p.cardholder },
    { id: '3', label: 'Latitude / Comfort / preferred seat', member: (p) => p.status === 'silver' || isExtraLegroom(p) },
    { id: '4-6', label: 'Remaining economy (rear-first)', member: (p) => isEconomyClass(p) && !isBasicFare(p), within: 'rear-half-first' },
    { id: '4-6-basic', label: 'Basic remaining', member: isBasicFare },
  ],
  notes: 'Rear-first tendency for zones 4-6 is a secondary-source reading (upgradedpoints); Air Canada’s own page does not spell it out.',
};

// -----------------------------------------------------------------------------
// ANA. WILMA in economy since Nov 15, 2021. Source: ana.co.jp/en/us/amc/premium-members/
// benefits/smooth-flying. This is one of the two Asian-carrier options and the one with the
// clearest published order.
// -----------------------------------------------------------------------------
const anaStrategy = {
  id: 'ana',
  label: 'ANA',
  blurb: 'Diamond/First, Platinum/Business/*G, then windows, middles, aisles in economy.',
  family: 'airline',
  asOf: '2026-01',
  source: 'https://www.ana.co.jp/en/us/amc/premium-members/benefits/smooth-flying/',
  groups: [
    { id: '1', label: 'Diamond / First', member: (p) => isFirstClass(p) || p.status === 'top' },
    { id: '2', label: 'Platinum / Super Flyers / *G / Business', member: (p) => isBusinessClass(p) || p.status === 'gold' || p.status === 'silver' || isPremiumEconomyClass(p) || isExtraLegroom(p) || p.cardholder },
    { id: '3', label: 'Economy window', member: (p, c, ctx) => isEconomyClass(p) && !isBasicFare(p) && isWindow(p, c, ctx) },
    { id: '4', label: 'Economy middle', member: (p, c, ctx) => isEconomyClass(p) && !isBasicFare(p) && isMiddle(p, c, ctx) },
    { id: '5', label: 'Economy aisle', member: (p, c, ctx) => isEconomyClass(p) && !isBasicFare(p) && isAisle(p, c, ctx) },
  ],
  notes: 'WILMA in economy since Nov 15, 2021 (ana.co.jp announcement).',
};

/**
 * Attach the `order(passengers, rng, cabin)` wrapper every board strategy needs. Kept out of
 * each entry above so the definitions stay data-only and one line couldn't drift out of sync
 * across fourteen carriers.
 */
function withOrder(strategy) {
  return {
    ...strategy,
    order(passengers, rng, cabin) {
      return orderByGroups(passengers, rng, strategy, cabin);
    },
  };
}

export const AIRLINE_STRATEGIES = Object.freeze([
  withOrder(alaskaStrategy),
  withOrder(americanStrategy),
  withOrder(deltaStrategy),
  withOrder(unitedStrategy),
  withOrder(southwestStrategy),
  withOrder(jetblueStrategy),
  withOrder(frontierStrategy),
  withOrder(hawaiianStrategy),
  withOrder(ryanairStrategy),
  withOrder(easyjetStrategy),
  withOrder(lufthansaStrategy),
  withOrder(britishAirwaysStrategy),
  withOrder(airCanadaStrategy),
  withOrder(anaStrategy),
]);

export const AIRLINE_STRATEGY_BY_ID = Object.freeze(
  Object.fromEntries(AIRLINE_STRATEGIES.map((strategy) => [strategy.id, strategy])),
);
