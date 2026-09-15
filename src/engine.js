/**
 * Session clock.
 *
 * Everything is derived from one absolute elapsed time rather than accumulated
 * per-frame deltas, so the breath cannot drift however badly the frame rate
 * behaves. Two consequences are the whole point of this file:
 *
 * Nothing is learned by observation. The current cycle is found by walking the
 * session's rungs from zero, and the session ends at an instant `endTimeFor`
 * works out before the first breath. The previous version watched the phase
 * index for a change and counted a round when it wrapped, which silently lost
 * rounds — and overran the session — whenever the loop stalled across a
 * boundary. Backgrounding the app stalls it for minutes, so this was not a
 * rare case.
 *
 * There is no requestAnimationFrame loop, and no periodic tick at all. The ring
 * animates itself on the compositor (see ui/ring.js) and the ambient sound is
 * scheduled on the audio clock (see audio.js), leaving this to wake only at
 * moments that change something: a phase boundary, a countdown digit, a whole
 * second, the end. Every wake is scheduled from absolute time, so a timer that
 * fires late gets a shorter next delay instead of pushing the error forward. In
 * iPhone Low Power Mode, where rAF is throttled to 30fps, this is both smoother
 * and more accurate than a frame loop — and a phase can never run long or
 * short, because nothing is counted: every boundary is a sum of durations on
 * the same clock.
 *
 * A session is a list of rungs, `[{ fromSeconds, phases }]`: each cycle uses
 * the last rung whose mark is at or before the cycle's start. An ordinary
 * session has one rung; a Box ladder has one per rise, so the phase time only
 * ever changes at the top of a cycle and no breath is cut short.
 *
 * Pause banks the paused duration and subtracts it, so resuming picks the breath
 * back up exactly where it was left.
 *
 * Events: `frame`, `phase`, `pause`, `resume`, `end`.
 */

/** Divergence between the monotonic and wall clocks that means a real suspend. */
const SUSPEND_MS = 1000;

/** Absorbs the float error in `n / step` landing a hair either side of an integer. */
const EPS = 1e-9;

/** The easing the previous build used for the breath — keep it. */
function ease(p) {
  return 0.5 - Math.cos(Math.PI * p) / 2;
}

/** Which phase a session ends at the completion of, resolved against the list. */
function endIndexOf(phases, kind) {
  let index = phases.findIndex((p) => p.kind === kind);
  if (index < 0) index = phases.findIndex((p) => p.kind === 'out');
  if (index < 0) index = phases.length - 1;
  return index;
}

function cycleLength(phases) {
  return phases.reduce((total, p) => total + p.duration, 0);
}

/** The instant the ending phase completes, measured from the top of a cycle. */
function endOffset(phases, kind) {
  return phases
    .slice(0, endIndexOf(phases, kind) + 1)
    .reduce((total, p) => total + p.duration, 0);
}

/** The rung in force for a cycle starting at `start`: the last at or before it. */
function rungAt(rungs, start) {
  let rung = rungs[0];
  for (const candidate of rungs) {
    if (candidate.fromSeconds <= start + EPS) rung = candidate;
    else break;
  }
  return rung;
}

/**
 * Walk cycles from a known one until the cycle containing `elapsed`.
 * `from` is `{ k, start, ordinal }` — index, start time and how many phases
 * came before it. Returns null if a rung has no duration, which would loop.
 */
function walk(rungs, elapsed, from = { k: 0, start: 0, ordinal: 0 }) {
  let { k, start, ordinal } = from;
  for (;;) {
    const phases = rungAt(rungs, start).phases;
    const cycle = cycleLength(phases);
    if (!(cycle > 0)) return null;
    if (elapsed < start + cycle) return { k, start, ordinal, phases, cycle };
    start += cycle;
    ordinal += phases.length;
    k += 1;
  }
}

function toRungs(config) {
  if (Array.isArray(config.rungs) && config.rungs.length) return config.rungs;
  return [{ fromSeconds: 0, phases: config.phases || [] }];
}

/**
 * The exact second at which a session finishes.
 *
 * A session never stops mid-breath. A limit only *arms* the ending; the session
 * then runs on to the next completion of its ending phase — the exhale for most
 * exercises, the wait for Box Extreme (see `endOn` in exercises.js). So the real
 * duration is the first such completion at or after the limit, which can be most
 * of a cycle longer than the limit itself: a 5 minute Box session at 5s a phase
 * really runs 5:15. Box Extreme ends on its wait, which is the last phase of its
 * cycle, so its sessions land exactly on the limit.
 *
 * The engine finishes at this instant and the HUD counts towards it, from the
 * same call — so what is promised and what happens cannot drift apart.
 *
 * @param {Array} rungs  `[{ fromSeconds, phases }]`, as from `ladderRungs`
 */
export function endTimeFor(rungs, config) {
  if (!Array.isArray(rungs) || rungs.length === 0) return Infinity;
  const kind = config.endKind || 'out';
  const round3 = (t) => Math.round(t * 1000) / 1000;

  if (config.mode === 'rounds') {
    if (!(config.targetRounds > 0)) return Infinity;
    let start = 0;
    for (let k = 0; ; k += 1) {
      const phases = rungAt(rungs, start).phases;
      const cycle = cycleLength(phases);
      if (!(cycle > 0)) return Infinity;
      if (k === config.targetRounds - 1) return round3(start + endOffset(phases, kind));
      start += cycle;
    }
  }

  if (!(config.limitSeconds > 0)) return Infinity;
  let start = 0;
  for (;;) {
    const phases = rungAt(rungs, start).phases;
    const cycle = cycleLength(phases);
    if (!(cycle > 0)) return Infinity;
    const candidate = start + endOffset(phases, kind);
    if (candidate >= config.limitSeconds - EPS) return round3(candidate);
    start += cycle;
  }
}

/**
 * @param {object} [deps]  clocks and timers, injectable so tests can drive the
 *   engine deterministically: `now` (ms, monotonic), `wallNow` (ms, wall),
 *   `setTimeout`, `clearTimeout`.
 */
export function createEngine(deps = {}) {
  const now = deps.now || (() => performance.now());
  const wallNow = deps.wallNow || (() => Date.now());
  const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || ((id) => clearTimeout(id));

  const handlers = new Map();
  let timer = 0;
  let s = null;

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event).delete(fn);
  }

  function emit(event, payload) {
    const set = handlers.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  /* ------------------------------------------------------------------ clock */

  /**
   * `performance.now()` is the clock: monotonic, and immune to the user or an
   * NTP sync moving the wall clock underneath a running session. `skew` carries
   * the correction for the one thing it gets wrong — some platforms stop
   * advancing it while the device is genuinely suspended, which would hand the
   * session back time it never spent. `reconcile()` measures that and folds it
   * in here.
   *
   * A stall while *paused* is a different matter: `pausedTotal` is measured on
   * the same stalled clock, so it already comes out of the sum, and it must not
   * be counted a second time as skew. That is why `wallOffset` is re-based on
   * resume rather than fixed at the start.
   */
  function elapsedSeconds() {
    if (!s) return 0;
    const stamp = now();
    const paused = s.running ? 0 : stamp - s.pausedAt;
    return (stamp - s.t0 + s.skew - s.pausedTotal - paused) / 1000;
  }

  /** Elapsed, never reported past the end — a catch-up must not overshoot. */
  function cappedElapsed() {
    return Math.min(elapsedSeconds(), s.endTime);
  }

  /**
   * Fold in any time the monotonic clock slept through.
   *
   * Only called when the page returns to the foreground while running, the one
   * moment a suspend can have happened. Wall time is trusted for the size of
   * the gap and never as the clock itself, and only ever forwards: a clock
   * correction that moves time backwards must not rewind the breath. The gap is
   * measured since the last look, not since the start, so nothing is ever
   * folded in twice and a stall that happened while paused is never folded in
   * at all.
   */
  function reconcile() {
    if (!s) return;
    const offset = wallNow() - now();
    const missing = offset - s.wallOffset;
    s.wallOffset = offset;
    if (missing > SUSPEND_MS) s.skew += missing;
  }

  /* --------------------------------------------------------------- position */

  /** Where the breath is at `elapsed`, and how long the current phase has left. */
  function positionAt(elapsed) {
    // The walk resumes from the last cycle found whenever time has only moved
    // forward, which is every tick; it restarts from zero after a resync.
    const from = s.cache && s.cache.start <= elapsed ? s.cache : undefined;
    const c = walk(s.rungs, elapsed, from);
    s.cache = { k: c.k, start: c.start, ordinal: c.ordinal };

    // Clamped because `elapsed - start` can land a hair outside [0, cycle) on
    // floats, and the scan below assumes it does not.
    const cyclePos = Math.min(Math.max(elapsed - c.start, 0), c.cycle - EPS);

    let index = 0;
    let phaseStart = 0;
    let acc = 0;
    for (let i = 0; i < c.phases.length; i++) {
      if (cyclePos < acc + c.phases[i].duration) {
        index = i;
        phaseStart = acc;
        break;
      }
      acc += c.phases[i].duration;
    }

    const phase = c.phases[index];
    const phaseElapsed = cyclePos - phaseStart;

    return {
      elapsed,
      cycleIndex: c.k,
      index,
      phase,
      phaseElapsed,
      remaining: phase.duration - phaseElapsed,
      // Absolute across the whole session, so a stall of any length is caught up
      // in one step instead of being missed the way comparing with the last
      // index would miss it.
      ordinal: c.ordinal + index
    };
  }

  /**
   * Half-second phases (Coherent at 4.5s) hold their full value for the first
   * half-second rather than showing a bare "5".
   */
  function countdownFor(phase, remaining) {
    const hasHalf = phase.duration % 1 !== 0;
    return hasHalf && remaining > Math.floor(phase.duration)
      ? phase.duration
      : Math.ceil(remaining);
  }

  function frameOf(at) {
    const { phase } = at;
    const progress = at.phaseElapsed / phase.duration;

    let breath;
    if (phase.kind === 'in') breath = ease(progress);
    else if (phase.kind === 'out') breath = 1 - ease(progress);
    else if (phase.kind === 'hold') breath = 1;
    else breath = 0;

    return {
      elapsed: at.elapsed,
      seconds: Math.floor(at.elapsed + EPS),
      index: at.index,
      phase,
      progress,
      countdown: countdownFor(phase, at.remaining),
      breath,
      rounds: at.cycleIndex
    };
  }

  /* -------------------------------------------------------------- scheduler */

  /**
   * Wake at the next instant something actually changes, and no sooner.
   *
   * Each candidate is an absolute session time, so the delay is re-derived from
   * the real clock on every wake and a late timer corrects itself rather than
   * compounding. This is what keeps the session exact on a throttled device
   * instead of merely smooth.
   */
  function schedule(at) {
    const { elapsed, remaining } = at;

    // Time until the countdown number next changes: the next integer strictly
    // below `remaining`. Written this way so a `remaining` that is already a
    // whole number waits a full second rather than firing twice.
    const toDigit = remaining - Math.max(0, Math.ceil(remaining - EPS) - 1);

    const next = Math.min(
      s.endTime,
      elapsed + remaining,            // phase boundary
      elapsed + toDigit,              // countdown digit
      Math.floor(elapsed + EPS) + 1   // HUD second
    );

    timer = setTimer(tick, Math.max(0, (next - elapsed) * 1000));
  }

  function tick() {
    timer = 0;
    if (!s || !s.running) return;

    const raw = elapsedSeconds();
    const done = raw >= s.endTime;
    const at = positionAt(done ? s.endTime : raw);

    emit('frame', frameOf(at));

    if (done) {
      // The phase that just completed, not the one the clock has rolled into.
      const last = positionAt(Math.max(0, s.endTime - 1e-6));
      emit('phase', {
        index: last.index,
        phase: last.phase,
        phaseElapsed: last.phase.duration,
        isFinal: true,
        initial: false,
        skipped: 0,
        resynced: false
      });
      finish(true);
      return;
    }

    if (at.ordinal !== s.ordinal) {
      const skipped = Math.max(0, at.ordinal - s.ordinal - 1);
      s.ordinal = at.ordinal;
      emit('phase', {
        index: at.index,
        phase: at.phase,
        phaseElapsed: at.phaseElapsed,
        isFinal: false,
        initial: false,
        // How many phases went by unseen. Non-zero means the app was throttled
        // or backgrounded across them, and their cues are stale — the session
        // view uses this to catch up silently rather than firing a burst.
        skipped,
        resynced: false
      });
    }

    schedule(at);
  }

  /**
   * Put the view back where the clock says it should be, without a cue.
   *
   * Used after a resume and after the page returns to the foreground: the phase
   * event carries `resynced` so the ring reseeks its animations silently rather
   * than treating the moment as a boundary worth chiming.
   */
  function resync() {
    if (!s || !s.running) return;
    stopLoop();

    const elapsed = elapsedSeconds();
    if (elapsed < s.endTime) {
      const at = positionAt(elapsed);
      s.ordinal = at.ordinal;
      emit('phase', {
        index: at.index,
        phase: at.phase,
        phaseElapsed: at.phaseElapsed,
        isFinal: false,
        initial: false,
        skipped: 0,
        resynced: true
      });
    }

    tick();
  }

  /* ------------------------------------------------------------- life cycle */

  /**
   * @param {object} config
   * @param {Array}  [config.rungs]       `[{ fromSeconds, phases }]` — see the
   *                                      header; from `ladderRungs()`
   * @param {Array}  [config.phases]      a single-rung session, if no `rungs`
   * @param {string} config.mode          'time' | 'rounds'
   * @param {number} config.limitSeconds  0 = open-ended
   * @param {number} config.targetRounds  0 = open-ended
   * @param {string} config.endKind       phase kind to finish on, default 'out'
   */
  function start(config) {
    stopLoop();

    const rungs = toRungs(config);
    s = {
      rungs,
      endTime: endTimeFor(rungs, config),
      mode: config.mode,
      t0: now(),
      wallOffset: wallNow() - now(),
      skew: 0,
      pausedAt: 0,
      pausedTotal: 0,
      running: true,
      ordinal: 0,
      cache: null
    };

    emit('phase', {
      index: 0,
      phase: rungs[0].phases[0],
      phaseElapsed: 0,
      isFinal: false,
      initial: true,
      skipped: 0,
      resynced: false
    });
    tick();
  }

  function finish(completed) {
    if (!s) return;
    const elapsed = cappedElapsed();
    // Completed cycles: the cycle containing the end instant, nudged past a
    // boundary that lands exactly on it.
    const at = walk(s.rungs, elapsed + EPS);
    const summary = {
      completed,
      seconds: Math.round(elapsed),
      rounds: at ? at.k : 0,
      mode: s.mode
    };
    stopLoop();
    s = null;
    emit('end', summary);
  }

  function stopLoop() {
    if (timer) clearTimer(timer);
    timer = 0;
  }

  function pause() {
    if (!s || !s.running) return;
    s.running = false;
    s.pausedAt = now();
    stopLoop();
    emit('pause');
  }

  function resume() {
    if (!s || s.running) return;
    s.pausedTotal += now() - s.pausedAt;
    // Whatever the two clocks did to each other while paused is already
    // accounted for by `pausedTotal`; start measuring afresh from here.
    s.wallOffset = wallNow() - now();
    s.running = true;
    emit('resume');
    resync();
  }

  /**
   * Coming back to the foreground is the only moment the clock can have been
   * suspended, and — on iOS especially — the only moment a stalled session finds
   * out how much it missed. Reconcile, then catch up in one step. (Exposed so
   * tests can call it without a document.)
   */
  function foreground() {
    if (!s || !s.running) return;
    reconcile();
    resync();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') foreground();
    });
  }

  return {
    on,
    start,
    pause,
    resume,
    foreground,
    /** User-initiated stop. Records the session as not completed. */
    end: () => finish(false),
    /** Tear down without emitting `end` — used when navigating away. */
    dispose: () => { stopLoop(); s = null; },
    get active() { return s !== null; },
    get paused() { return s !== null && !s.running; }
  };
}
