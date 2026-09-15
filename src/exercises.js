/**
 * The breathing protocols.
 *
 * Timings are carried over verbatim from the previous build — do not change
 * them without deciding to change the exercise itself.
 *
 * `kind` drives everything behavioural (which way the ring moves, which phase
 * a session is allowed to end on). `name` is only ever shown to the user.
 *
 * `endOn` names the phase kind a session finishes at the completion of, and
 * defaults to `out` — a breath is a poor thing to be cut off mid-exhale. Only
 * set it where the exercise genuinely wants a different landing (see
 * `boxExtreme`), and read it through `endKind()` rather than off the object.
 */

export const PHASE_COLORS = {
  in: '#f97316',    // inhale
  hold: '#fbbf24',  // held full — brightest point of the breath
  out: '#b45309',   // exhale
  wait: '#78350f'   // held empty — dimmest point of the breath
};

export const PHASE_RGB = {
  in: [249, 115, 22],
  hold: [251, 191, 36],
  out: [180, 83, 9],
  wait: [120, 53, 15]
};

/**
 * The four slots of the Custom pattern, in breath order, with the range each
 * accepts. A hold or wait at 0 is left out of the pattern; the breath itself
 * always has to be there.
 */
export const CUSTOM_KINDS = [
  { key: 'in', name: 'Inhale', kind: 'in', min: 1, max: 30 },
  { key: 'hold', name: 'Hold', kind: 'hold', min: 0, max: 30 },
  { key: 'out', name: 'Exhale', kind: 'out', min: 1, max: 30 },
  { key: 'wait', name: 'Wait', kind: 'wait', min: 0, max: 30 }
];

/** What the Box ladder may be set to. `to` moves on a half-second grid. */
export const LADDER_LIMITS = {
  to: [3.5, 10],
  steps: [0.5, 1, 2],
  minutes: [1, 60]
};

export const EXERCISES = {
  box: {
    id: 'box',
    name: 'Box Breathing',
    description: 'Equal phases for balance and calm',
    mode: 'time',
    slider: {
      setting: 'phaseTime',
      label: 'Phase time',
      min: 3, max: 6, step: 1, fallback: 4
    },
    // The only exercise with a ladder: `settings.ladder` can raise phaseTime
    // step by step over the session. See `ladderRungs`.
    ladder: true,
    phases: (s) => [
      { name: 'Inhale', kind: 'in', duration: s.phaseTime },
      { name: 'Hold', kind: 'hold', duration: s.phaseTime },
      { name: 'Exhale', kind: 'out', duration: s.phaseTime },
      { name: 'Wait', kind: 'wait', duration: s.phaseTime }
    ]
  },

  boxExtreme: {
    id: 'boxExtreme',
    name: 'Box Extreme',
    description: 'Ten-second phases for deep calm',
    mode: 'time',
    // Fixed, not a slider. Box already uses the `phaseTime` setting; giving
    // this one a slider on that same key would make the two reset each other
    // every time you switched between them.
    slider: null,
    // The one exercise that finishes on the empty hold rather than the exhale.
    // Ten seconds of stillness after the last breath out is the point of it,
    // and because `Wait` is the final phase the session also lands exactly on
    // a cycle boundary — a 10 minute session really is 10:00, not 10:30.
    endOn: 'wait',
    phases: () => [
      { name: 'Inhale', kind: 'in', duration: 10 },
      { name: 'Hold', kind: 'hold', duration: 10 },
      { name: 'Exhale', kind: 'out', duration: 10 },
      { name: 'Wait', kind: 'wait', duration: 10 }
    ]
  },

  fourSevenEight: {
    id: 'fourSevenEight',
    name: '4-7-8 Breathing',
    description: 'Relaxation and sleep aid',
    mode: 'rounds',
    slider: null,
    phases: () => [
      { name: 'Inhale', kind: 'in', duration: 4 },
      { name: 'Hold', kind: 'hold', duration: 7 },
      { name: 'Exhale', kind: 'out', duration: 8 }
    ]
  },

  longExhale: {
    id: 'longExhale',
    name: 'Long Exhale',
    description: 'Extended exhale for relaxation',
    mode: 'time',
    slider: {
      setting: 'exhaleDuration',
      label: 'Exhale time',
      min: 6, max: 8, step: 1, fallback: 6
    },
    phases: (s) => [
      { name: 'Inhale', kind: 'in', duration: 4 },
      { name: 'Exhale', kind: 'out', duration: s.exhaleDuration }
    ]
  },

  coherent: {
    id: 'coherent',
    name: 'Coherent Breathing',
    description: 'Equal inhale and exhale for HRV',
    mode: 'time',
    slider: {
      // Its own key, not Box's `phaseTime`. Sharing one meant picking 4.5s
      // here silently snapped Box onto 5s, and vice versa.
      setting: 'coherentTime',
      label: 'Breath time',
      min: 4.5, max: 6, step: 0.5, fallback: 5
    },
    phases: (s) => [
      { name: 'Inhale', kind: 'in', duration: s.coherentTime },
      { name: 'Exhale', kind: 'out', duration: s.coherentTime }
    ]
  },

  custom: {
    id: 'custom',
    name: 'Custom',
    description: 'Your own pattern',
    mode: 'time',
    // No slider: the pattern is four values, edited in its own sheet and kept
    // in `settings.custom` (sanitized in storage.js against CUSTOM_KINDS).
    slider: null,
    custom: true,
    phases: (s) => CUSTOM_KINDS
      .filter((slot) => s.custom[slot.key] > 0)
      .map((slot) => ({ name: slot.name, kind: slot.kind, duration: s.custom[slot.key] }))
  }
};

/**
 * Two exercises sharing a `slider.setting` means one storage slot for two
 * values, and each one silently drags the other onto its own step grid. That
 * shipped once and was invisible until it was hit by hand, so make it
 * announce itself instead.
 */
(function assertDistinctSettings() {
  const seen = new Map();
  for (const [id, exercise] of Object.entries(EXERCISES)) {
    const key = exercise.slider && exercise.slider.setting;
    if (!key) continue;
    if (seen.has(key)) {
      console.error(
        `[exercises] "${id}" and "${seen.get(key)}" both store their slider in ` +
        `"${key}". Each exercise needs its own settings key or they will ` +
        `overwrite each other.`
      );
    }
    seen.set(key, id);
  }
})();

/** Display order on the home screen. */
export const EXERCISE_IDS = ['box', 'boxExtreme', 'fourSevenEight', 'longExhale', 'coherent', 'custom'];

/** Minute presets for time-based exercises, round presets for 4-7-8. */
export const TIME_PRESETS = [2, 3, 5, 10, 15, 20];
export const ROUND_PRESETS = [4, 6, 8];

export function getExercise(id) {
  return EXERCISES[id] || EXERCISES.box;
}

/** Which phase kind a session ends at the completion of. See `endOn` above. */
export function endKind(id) {
  return getExercise(id).endOn || 'out';
}

/**
 * Each slider exercise accepts its own range (Box 3–6 step 1, Coherent 4.5–6
 * step 0.5, Long Exhale 6–8 step 1). Rather than special-case that at every
 * call site, resolve the slider value against the exercise's own range once
 * and hand everything else a settings object that is already valid for this
 * exercise.
 */
export function sliderValue(exercise, settings) {
  const s = exercise.slider;
  if (!s) return null;

  const raw = settings[s.setting];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return s.fallback;
  if (raw < s.min || raw > s.max) return s.fallback;

  const snapped = s.min + Math.round((raw - s.min) / s.step) * s.step;
  return Math.round(Math.min(s.max, Math.max(s.min, snapped)) * 100) / 100;
}

/** Every value a slider can land on, e.g. [4.5, 5, 5.5, 6] for Coherent. */
export function sliderSteps(spec) {
  const out = [];
  for (let v = spec.min; v <= spec.max + 1e-9; v += spec.step) {
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}

export function resolve(id, settings) {
  const exercise = getExercise(id);
  if (!exercise.slider) return settings;
  return { ...settings, [exercise.slider.setting]: sliderValue(exercise, settings) };
}

export function getPhases(id, settings) {
  return getExercise(id).phases(resolve(id, settings));
}

export function cycleSeconds(id, settings) {
  return getPhases(id, settings).reduce((total, p) => total + p.duration, 0);
}

/**
 * The Box ladder, if it is on and actually goes anywhere:
 * `{ start, to, step, minutes, steps }`, where `steps` is how many rises it
 * takes to reach the top. Null for every other exercise, for a ladder that is
 * off, and for one whose target is not above the starting phase time.
 */
export function ladderInfo(id, settings) {
  const exercise = getExercise(id);
  const ladder = settings.ladder;
  if (!exercise.ladder || !ladder || !ladder.on) return null;
  const start = sliderValue(exercise, settings);
  const { to, step, minutes } = ladder;
  if (!(to > start) || !(step > 0) || !(minutes > 0)) return null;
  return { start, to, step, minutes, steps: Math.ceil((to - start) / step - 1e-9) };
}

/**
 * The session as a list of rungs: `[{ fromSeconds, phases }]`, each the phase
 * list in force for any cycle that *starts* at or after its mark. One rung for
 * an ordinary session. For a Box ladder, one per rise: the phase time goes up
 * by `step` every `minutes` minutes and stops at `to`. Rungs are built with
 * the exercise's own `phases()` directly rather than through `sliderValue`,
 * which would snap a 4.5s rung back onto Box's whole-second grid.
 */
export function ladderRungs(id, settings) {
  const info = ladderInfo(id, settings);
  if (!info) return [{ fromSeconds: 0, phases: getPhases(id, settings) }];

  const exercise = getExercise(id);
  const rungs = [];
  for (let k = 0; ; k += 1) {
    const value = Math.min(Math.round((info.start + k * info.step) * 100) / 100, info.to);
    rungs.push({
      fromSeconds: k * info.minutes * 60,
      phases: exercise.phases({ ...settings, [exercise.slider.setting]: value })
    });
    if (value >= info.to) break;
  }
  return rungs;
}

/** Drops a trailing `.0` so 4.5 stays "4.5" but 5.0 renders as "5". */
export function num(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** e.g. "4·4·4·4" — a glanceable summary of the pattern. */
export function patternLabel(id, settings) {
  return getPhases(id, settings).map((p) => num(p.duration)).join('·');
}
