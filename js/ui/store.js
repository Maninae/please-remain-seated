/**
 * Tiny observable store used by every UI module.
 *
 * Public API:
 *   const store = createStore(initial)
 *   store.state()               -> current snapshot (frozen shallow copy)
 *   store.update(patch, opts?)  -> shallow-merge patch, notify subscribers
 *   store.subscribe(fn)         -> returns an unsubscribe function
 *
 * Options on update:
 *   silent: true    do not notify (used for scratch fields the UI wrote itself)
 *   reason: string  passed to subscribers so they can skip work
 */

export function createStore(initial) {
  let state = { ...initial };
  const subscribers = new Set();

  function snapshot() {
    return { ...state };
  }

  function update(patch, options = {}) {
    if (!patch || typeof patch !== 'object') return state;
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (state[key] !== patch[key]) {
        state[key] = patch[key];
        changed = true;
      }
    }
    if (changed && !options.silent) {
      const snap = snapshot();
      for (const fn of subscribers) fn(snap, options);
    }
    return state;
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { state: snapshot, update, subscribe };
}
