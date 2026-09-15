import { el, icon } from '../dom.js';
import { openSheet } from './sheet.js';

import {
  EXERCISE_IDS,
  getExercise,
  patternLabel,
  sliderValue,
  num,
  TIME_PRESETS,
  ROUND_PRESETS
} from '../exercises.js';
import * as audio from '../audio.js';

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
  function sliderSteps(spec) {
    const out = [];
    for (let v = spec.min; v <= spec.max + 1e-9; v += spec.step) {
      out.push(Math.round(v * 100) / 100);
    }
    return out;
  }

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
  function phaseSliderBody(spec, steps, sheet) {
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

  function openPhaseSheet() {
    const exercise = getExercise(settings.exercise);
    const spec = exercise.slider;
    if (!spec) return;

    const steps = sliderSteps(spec);
    let sheet;

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
            sheet.setBody(mode === 'slider' ? phaseSliderBody(spec, steps, sheet) : null);
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

    if (settings.phaseInput === 'slider') {
      sheet.setBody(phaseSliderBody(spec, steps, sheet));
    }
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
    // it — phaseChip() returns null for the exercises with no slider.
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
   * Sound is a three-way choice, so the chip opens a sheet like the other
   * value chips rather than toggling. The icon carries the current mode, so
   * it still reads at a glance without costing the row any width.
   */
  const SOUND_ICON = { ambient: 'volume', chime: 'bell', off: 'volumeOff' };

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
        { value: 'off', label: 'Mute' }
      ],
      onSelect: (value) => {
        if (!value) return;
        settings.sound = value;
        audio.setMode(value);
        commit();
      }
    });
  }

  /** Only the three sliderless exercises omit this. */
  function phaseChip() {
    const exercise = getExercise(settings.exercise);
    if (!exercise.slider) return null;
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
      [el('span', { class: 'chip__label' }, `${num(sliderValue(exercise, settings))}s`)]
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
    // Creating the AudioContext inside the tap is what keeps Safari happy.
    audio.unlock();
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
