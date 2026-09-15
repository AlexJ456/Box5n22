import { el, icon } from '../dom.js';
import { openSheet } from './sheet.js';
import { toggle, segmented, stepper } from './controls.js';

import {
  EXERCISE_IDS,
  CUSTOM_KINDS,
  LADDER_LIMITS,
  getExercise,
  patternLabel,
  sliderValue,
  sliderSteps,
  ladderInfo,
  num,
  TIME_PRESETS,
  ROUND_PRESETS
} from '../exercises.js';
import * as audio from '../audio.js';
import * as voice from '../voice.js';

export function home(app) {
  const { settings } = app;

  /**
   * Chosen length: a number of minutes/rounds, or null for open-ended.
   *
   * Remembered per exercise. Box and Box Extreme are both time-based, so a
   * single shared value meant setting Box Extreme to 10 minutes silently moved
   * Box to 10 minutes as well. An exercise you have never given a length falls
   * back to the last one picked in its mode, which is still kept separately for
   * minutes and rounds — those two are not interchangeable.
   */
  const lengthKey = () => (getExercise(settings.exercise).mode === 'rounds' ? 'lastRounds' : 'lastMinutes');

  function readLength() {
    const stored = settings.lengths[settings.exercise];
    if (typeof stored === 'number') return stored || null;
    return settings[lengthKey()] || null;
  }

  function writeLength(value) {
    settings.lengths[settings.exercise] = value || 0;
    // Keeps the fallback on the most recent choice, so an exercise opened for
    // the first time starts somewhere sensible rather than wide open.
    settings[lengthKey()] = value || 0;
    app.save();
  }

  const listWrap = el('div', { class: 'ex-list block' });
  const quickWrap = el('div', { class: 'quick' });

  const startBtn = el(
    'button',
    { class: 'btn', type: 'button', onclick: start },
    [icon('play'), el('span', {}, 'Start')]
  );

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'topbar' }, [
      el('h1', { class: 'title' }, 'breathe'),
      el('div', { class: 'topbar__actions' }, [
        el(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'History',
            onclick: () => app.go('history')
          },
          [icon('chart')]
        ),
        el(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Settings',
            onclick: () => app.go('settings')
          },
          [icon('settings')]
        )
      ])
    ]),
    el('div', { class: 'screen__scroll' }, [listWrap]),
    el('div', { class: 'home__foot' }, [quickWrap, startBtn])
  ]);

  /* ------------------------------------------------------------- exercises */

  function renderList() {
    const nodes = EXERCISE_IDS.map((id) => {
      const exercise = getExercise(id);
      const selected = id === settings.exercise;
      return el(
        'button',
        {
          class: 'ex',
          type: 'button',
          'aria-pressed': String(selected),
          onclick: () => selectExercise(id)
        },
        [
          el('div', { class: 'ex__body' }, [
            el('div', { class: 'ex__name' }, exercise.name),
            el('div', { class: 'ex__desc' }, exercise.description)
          ]),
          el('div', { class: 'ex__pattern' }, patternLabel(id, settings))
        ]
      );
    });
    listWrap.replaceChildren(...nodes);
  }

  function selectExercise(id) {
    if (settings.exercise === id) return;
    settings.exercise = id;
    app.save();
    // No reset needed — each exercise keeps its own remembered length, and
    // renderAll re-reads it for the one now selected.
    renderAll();
  }

  /* ------------------------------------------------------------ phase time */

  /**
   * Every slider range is only three or four steps wide (Box 3–6, Coherent
   * 4.5–6 by halves, Long Exhale 6–8), so the sheet lists them rather than
   * offering a slider — easier to hit and consistent with session length.
   */
  function applyPhase(spec, value) {
    settings[spec.setting] = value;
    app.save();
    renderList();
    renderQuick();
  }

  /**
   * The slider is indexed over the same steps the list offers rather than
   * over raw seconds, so it can only ever land on a value the exercise
   * actually supports — including Coherent's half-seconds.
   */
  function phaseSliderBody(spec, steps, sheet, onMove) {
    const current = sliderValue(getExercise(settings.exercise), settings);
    const readout = el('div', { class: 'sheet__readout' }, `${num(current)}s`);

    const input = el('input', {
      type: 'range',
      min: 0,
      max: steps.length - 1,
      step: 1,
      value: Math.max(0, steps.indexOf(current)),
      'aria-label': spec.label,
      oninput: (e) => {
        const value = steps[Number(e.target.value)];
        readout.textContent = `${num(value)}s`;
        applyPhase(spec, value);
        if (onMove) onMove();
      }
    });

    return el('div', { class: 'sheet__slider' }, [
      el('div', { class: 'sheet__range' }, [
        el('div', { class: 'sheet__scale' }, `${num(steps[0])}s`),
        readout,
        el('div', { class: 'sheet__scale' }, `${num(steps[steps.length - 1])}s`)
      ]),
      input,
      el(
        'button',
        { class: 'btn', type: 'button', onclick: () => sheet.close() },
        'Done'
      )
    ]);
  }

  /**
   * The Box ladder, under the phase-time picker: a switch, and when it is on,
   * where to rise to, by how much, and how often. Everything is applied as it
   * is tapped; the note reads the result back in one line.
   */
  function ladderBlock(exercise, sheet) {
    const L = settings.ladder;
    const note = el('div', { class: 'sheet__note' });
    const details = el('div', {});

    function summary() {
      const info = ladderInfo(exercise.id, settings);
      if (!info) {
        const start = sliderValue(exercise, settings);
        return `Rise to needs to be above the ${num(start)}s phase time.`;
      }
      return `${num(info.start)}s → ${num(info.to)}s, +${num(info.step)}s every ` +
        `${info.minutes} min · about ${info.steps * info.minutes} min to the top. ` +
        'Each rise waits for the end of a full cycle.';
    }

    function refresh() {
      details.hidden = !L.on;
      note.textContent = summary();
    }

    function commit() {
      app.save();
      refresh();
      renderQuick();
    }

    const to = stepper({
      label: 'Rise to',
      value: L.to,
      min: LADDER_LIMITS.to[0],
      max: LADDER_LIMITS.to[1],
      step: 0.5,
      format: (v) => `${num(v)}s`,
      onChange: (v) => { L.to = v; commit(); }
    });

    const step = el('div', { class: 'sheet__row' }, [
      el('div', { class: 'sheet__label' }, 'Step'),
      segmented(
        LADDER_LIMITS.steps.map((v) => ({ value: v, label: `${num(v)}s` })),
        L.step,
        (v) => { L.step = v; commit(); }
      )
    ]);

    const every = stepper({
      label: 'Every',
      value: L.minutes,
      min: LADDER_LIMITS.minutes[0],
      max: LADDER_LIMITS.minutes[1],
      step: 1,
      format: (v) => `${v} min`,
      onChange: (v) => { L.minutes = v; commit(); }
    });

    const head = el('div', { class: 'sheet__row' }, [
      el('div', { class: 'sheet__label' }, [
        el('div', {}, 'Ladder'),
        el('div', { class: 'row__note' }, 'Phase time rises over the session')
      ]),
      toggle(L.on, (on) => { L.on = on; commit(); })
    ]);

    details.append(to.el, step, every.el, note);
    refresh();

    return {
      el: el('div', { class: 'sheet__section' }, [
        head,
        details,
        el('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Done')
      ]),
      refresh
    };
  }

  function openPhaseSheet() {
    const exercise = getExercise(settings.exercise);
    const spec = exercise.slider;
    if (!spec) return;

    const steps = sliderSteps(spec);
    let sheet;
    let ladder = null;

    // Box carries the ladder block under either picker; the list closes the
    // sheet on a pick as usual, and the block has its own Done.
    function body(mode) {
      const picker = mode === 'slider'
        ? phaseSliderBody(spec, steps, sheet, () => ladder && ladder.refresh())
        : sheet.list;
      if (!ladder) return mode === 'slider' ? picker : null;
      return el('div', {}, [picker, ladder.el]);
    }

    // Two ways to pick the same value; which one you prefer is remembered.
    const modes = [['list', 'List'], ['slider', 'Slider']];
    const buttons = modes.map(([mode, label]) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(settings.phaseInput === mode),
          onclick: () => {
            settings.phaseInput = mode;
            app.save();
            buttons.forEach((b, i) =>
              b.setAttribute('aria-pressed', String(modes[i][0] === mode))
            );
            sheet.setBody(body(mode));
          }
        },
        label
      )
    );

    sheet = openSheet({
      title: spec.label,
      value: sliderValue(exercise, settings),
      options: steps.map((v) => ({ value: v, label: `${num(v)} seconds` })),
      accessory: el('div', { class: 'seg seg--sheet', role: 'group' }, buttons),
      onSelect: (value) => {
        if (value === null) return;
        applyPhase(spec, value);
      }
    });

    if (exercise.ladder) ladder = ladderBlock(exercise, sheet);
    const initial = body(settings.phaseInput);
    if (initial) sheet.setBody(initial);
  }

  /* --------------------------------------------------------- custom pattern */

  /** Four steppers, one per slot. A hold or wait at 0 reads "off" and is skipped. */
  function openCustomSheet() {
    let sheet;
    const rows = CUSTOM_KINDS.map((slot) =>
      stepper({
        label: slot.name,
        value: settings.custom[slot.key],
        min: slot.min,
        max: slot.max,
        step: 1,
        format: (v) => (v > 0 ? `${v}s` : 'off'),
        onChange: (v) => {
          settings.custom[slot.key] = v;
          app.save();
          renderList();
          renderQuick();
        }
      }).el
    );

    sheet = openSheet({
      title: 'Pattern',
      value: null,
      options: [],
      onSelect: () => {},
      body: el('div', {}, [
        ...rows,
        el('div', { class: 'sheet__note' }, 'Turn Hold or Wait down to off to leave them out.'),
        el('div', { class: 'sheet__section' }, [
          el('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Done')
        ])
      ])
    });
  }

  /* --------------------------------------------------------------- length  */

  /** "Open", "5 min", "6 rounds" — what the length chip reads. */
  function lengthLabel() {
    const value = readLength();
    if (!value) return 'Open';
    if (getExercise(settings.exercise).mode === 'rounds') {
      return `${value} ${value === 1 ? 'round' : 'rounds'}`;
    }
    return `${value} min`;
  }

  function openLengthSheet() {
    const rounds = getExercise(settings.exercise).mode === 'rounds';
    const presets = rounds ? ROUND_PRESETS : TIME_PRESETS;

    openSheet({
      title: rounds ? 'Rounds' : 'Session length',
      value: readLength(),
      options: [
        { value: null, label: 'Open — until I end it' },
        ...presets.map((value) => ({
          value,
          label: rounds ? `${value} rounds` : `${value} minutes`
        }))
      ],
      custom: {
        label: 'Custom',
        placeholder: rounds ? 'rounds' : 'minutes'
      },
      onSelect: (value) => {
        writeLength(value);
        renderQuick();
      }
    });
  }

  /* ----------------------------------------------------------- quick chips */

  /**
   * One row: session length, phase time (when the exercise has one), then the
   * three per-session toggles. The first two carry values you read, the rest
   * you just flip — hence wide labelled chips and square icon buttons.
   */
  function renderQuick() {
    // Filtered, because replaceChildren stringifies null rather than skipping
    // it — phaseChip() returns null for the exercises with nothing to set.
    const children = [
      el(
        'button',
        {
          class: 'chip chip--wide',
          type: 'button',
          'data-chip': 'length',
          'aria-haspopup': 'dialog',
          onclick: openLengthSheet
        },
        [icon('clock'), el('span', { class: 'chip__label' }, lengthLabel())]
      ),
      phaseChip(),
      soundChip(),
      chip('countdown', 'hash', 'Countdown', settings.countdown, () => {
        settings.countdown = !settings.countdown;
        commit();
      }),
      chip('sleep', 'moon', 'Sleep', settings.sleepMode, () => {
        settings.sleepMode = !settings.sleepMode;
        commit();
      })
    ];
    quickWrap.replaceChildren(...children.filter(Boolean));
  }

  /**
   * Sound is a four-way choice, so the chip opens a sheet like the other
   * value chips rather than toggling. The icon carries the current mode, so
   * it still reads at a glance without costing the row any width.
   */
  const SOUND_ICON = { ambient: 'volume', chime: 'bell', voice: 'mic', off: 'volumeOff' };

  function soundChip() {
    const on = settings.sound !== 'off';
    return el(
      'button',
      {
        class: 'chip',
        type: 'button',
        'data-chip': 'sound',
        'aria-haspopup': 'dialog',
        'aria-pressed': String(on),
        'aria-label': `Sound: ${settings.sound === 'off' ? 'mute' : settings.sound}`,
        title: 'Sound',
        onclick: openSoundSheet
      },
      [icon(SOUND_ICON[settings.sound] || 'volumeOff')]
    );
  }

  function openSoundSheet() {
    audio.unlock();
    openSheet({
      title: 'Sound',
      value: settings.sound,
      options: [
        { value: 'ambient', label: 'Ambient — drone and soft chime' },
        { value: 'chime', label: 'Chime — a tone at each phase' },
        {
          value: 'voice',
          label: 'Voice — spoken phase names',
          disabled: !voice.supported,
          note: voice.supported ? null : 'Not supported in this browser'
        },
        { value: 'off', label: 'Mute' }
      ],
      onSelect: (value) => {
        if (!value) return;
        settings.sound = value;
        audio.setMode(value);
        // Picking it is a tap, which is when iOS lets speech be unlocked.
        if (value === 'voice') voice.prime();
        commit();
      }
    });
  }

  /**
   * The chip beside the length: phase time for the slider exercises (reading
   * "4→8s" while Box is laddered), the pattern editor for Custom, nothing for
   * the fixed ones.
   */
  function phaseChip() {
    const exercise = getExercise(settings.exercise);
    if (exercise.custom) {
      // An icon, not the pattern: the card already spells it out, and a long
      // pattern would squeeze the length chip off a narrow phone.
      return el(
        'button',
        {
          class: 'chip',
          type: 'button',
          'data-chip': 'phase',
          'aria-haspopup': 'dialog',
          'aria-label': 'Edit pattern',
          title: 'Edit pattern',
          onclick: openCustomSheet
        },
        [icon('sliders')]
      );
    }
    if (!exercise.slider) return null;
    const info = ladderInfo(exercise.id, settings);
    const label = info
      ? `${num(info.start)}→${num(info.to)}s`
      : `${num(sliderValue(exercise, settings))}s`;
    return el(
      'button',
      {
        class: 'chip chip--value',
        type: 'button',
        'data-chip': 'phase',
        'aria-haspopup': 'dialog',
        'aria-label': exercise.slider.label,
        title: exercise.slider.label,
        onclick: openPhaseSheet
      },
      [el('span', { class: 'chip__label' }, label)]
    );
  }

  function chip(key, iconName, label, on, onclick) {
    return el(
      'button',
      {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(Boolean(on)),
        'aria-label': label,
        title: label,
        'data-chip': key,
        onclick
      },
      [icon(iconName)]
    );
  }

  function commit() {
    app.save();
    renderQuick();
  }

  function renderAll() {
    renderList();
    renderQuick();
  }

  function start() {
    // Creating the AudioContext inside the tap is what keeps Safari happy, and
    // the same goes for the first spoken word.
    audio.unlock();
    if (settings.sound === 'voice') voice.prime();
    const exercise = getExercise(settings.exercise);
    app.go('session', {
      exerciseId: settings.exercise,
      limitMinutes: exercise.mode === 'time' ? readLength() : 0,
      targetRounds: exercise.mode === 'rounds' ? readLength() : 0
    });
  }

  renderAll();

  return { el: root };
}
