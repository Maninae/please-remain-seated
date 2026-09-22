/**
 * Snapshot helpers: annotate the sim state for the renderer without mutating it.
 *
 * The renderer reads a plain `state`. To draw the "followed" passenger with a ring, we hand it a
 * shallow copy of `state.passengers` where the followed passenger's flag is set, and let the
 * cabin-view draw the highlight in a wrapper pass. The renderer itself only knows about `vis`,
 * so this module ships the followed-id separately and races.js does the follow-ring drawing on
 * top of whatever the cabin-view painted. Kept in its own module so race.js stays small.
 */

export function snapshotForRender(state, { followId } = {}) {
  return {
    cabin: state.cabin,
    passengers: state.passengers,
    bins: state.bins,
    followId: Number.isFinite(followId) ? followId : null,
    t: state.t,
    doneCount: state.doneCount,
  };
}
