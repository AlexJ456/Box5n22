/**
 * A virtual clock and timer queue for driving the engine deterministically.
 *
 *   now()       monotonic milliseconds, like performance.now()
 *   wallNow()   wall milliseconds, like Date.now()
 *   advance(ms) move both clocks forward, running due timers in order
 *   jump(ms)    move both clocks forward WITHOUT running timers — a stalled
 *               main thread; the next advance() runs whatever is overdue
 *   stall(ms)   move only the wall clock — the monotonic clock sleeping
 *               through a device suspend
 */
export function virtualClock() {
  let t = 0;
  let stalled = 0;
  let nextId = 1;
  const timers = new Map();

  function due(target) {
    let next = null;
    for (const timer of timers.values()) {
      if (timer.at <= target && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) {
        next = timer;
      }
    }
    return next;
  }

  return {
    now: () => t,
    wallNow: () => 1e12 + t + stalled,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { id, at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const target = t + ms;
      for (let next = due(target); next; next = due(target)) {
        timers.delete(next.id);
        // An overdue timer (after a jump) runs late, at the current time; the
        // clock never moves backwards to when it was meant to fire.
        t = Math.max(t, next.at);
        next.fn();
      }
      t = target;
    },
    jump(ms) { t += ms; },
    stall(ms) { stalled += ms; },
    pending: () => timers.size
  };
}

/** A minimal in-memory localStorage. */
export function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear()
  };
}

/**
 * Pin "now" for code that calls `new Date()` and `Date.now()`. Returns a
 * restore function.
 */
export function freezeDate(ts) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ts);
      else super(...args);
    }
    static now() { return ts; }
  }
  globalThis.Date = FrozenDate;
  return () => { globalThis.Date = RealDate; };
}
