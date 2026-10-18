import { el, icon } from '../dom.js';
import { toggle, segmented } from './controls.js';
import * as audio from '../audio.js';
import * as haptics from '../haptics.js';
import * as voice from '../voice.js';
import { THEMES } from '../storage.js';

/**
 * Each theme's name is written in its own breath colour, which says more than
 * a swatch would and fits five across a phone. Mirrors --ph-inhale per theme
 * in styles.css.
 */
const THEME_HUES = {
  amber: '#f97316',
  ocean: '#22d3ee',
  forest: '#22c55e',
  rose: '#f43f5e',
  mono: '#d4d4d4'
};

function row(title, note, control, options = {}) {
  const classes = ['row'];
  if (options.disabled) classes.push('row--disabled');
  if (options.stack) classes.push('row--stack');
  return el('div', { class: classes.join(' ') }, [
    el('div', { class: 'row__body' }, [
      el('div', { class: 'row__title' }, title),
      note ? el('div', { class: 'row__note' }, note) : null
    ]),
    control
  ]);
}

function rangeRow(label, note, value, spec, onInput) {
  const readout = el('div', { class: 'slider-row__value' }, spec.format(value));
  const input = el('input', {
    type: 'range',
    min: spec.min,
    max: spec.max,
    step: spec.step,
    value,
    'aria-label': label,
    oninput: (e) => {
      const next = Number(e.target.value);
      readout.textContent = spec.format(next);
      onInput(next);
    }
  });

  return el('div', { class: 'range-block' }, [
    el('div', { class: 'slider-row' }, [
      el('div', {}, [
        el('div', { class: 'row__title' }, label),
        note ? el('div', { class: 'row__note' }, note) : null
      ]),
      readout
    ]),
    input
  ]);
}

export function settings(app) {
  const s = app.settings;

  const dimRow = rangeRow(
    'Sleep dim level',
    'How dark it goes once the controls fade',
    s.dimFloor,
    { min: 0.15, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    (v) => {
      s.dimFloor = v;
      app.save();
    }
  );
  dimRow.hidden = !s.sleepMode;

  const soundNote = voice.supported
    ? 'Ambient is a soft drone that follows the breath; Voice speaks each phase'
    : 'Ambient is a soft drone that follows the breath. Voice needs speech synthesis, which this browser lacks';

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'topbar' }, [
      el(
        'button',
        { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.go('home') },
        [icon('back')]
      ),
      el('h1', { class: 'title' }, 'settings'),
      el('div', { style: { width: '44px' } })
    ]),

    el('div', { class: 'screen__scroll' }, [
      el('div', { class: 'section-label' }, 'During a session'),
      el('div', { class: 'rows' }, [
        // Four options no longer fit beside the title on a narrow phone, so
        // this row stacks: words above, the control full-width below.
        row(
          'Sound',
          soundNote,
          segmented(
            [
              { value: 'off', label: 'Off' },
              { value: 'chime', label: 'Chime' },
              { value: 'ambient', label: 'Ambient' },
              { value: 'voice', label: 'Voice', disabled: !voice.supported }
            ],
            s.sound,
            (value) => {
              s.sound = value;
              audio.unlock();
              audio.setMode(value);
              if (value === 'voice') voice.prime();
              app.save();
            },
            { fill: true }
          ),
          { stack: true }
        ),
        row(
          'Lead-in',
          'Count 3, 2, 1 before the first breath',
          toggle(s.leadIn, (value) => {
            s.leadIn = value;
            app.save();
          })
        ),
        row(
          'Countdown',
          'Show the seconds remaining in each phase',
          toggle(s.countdown, (value) => {
            s.countdown = value;
            app.save();
          })
        ),
        row(
          'Haptics',
          haptics.supported
            ? 'A short pulse at each phase change'
            : 'Not supported in this browser — iOS Safari has no vibration API',
          toggle(
            s.haptics && haptics.supported,
            (value) => {
              s.haptics = value;
              haptics.setEnabled(value);
              app.save();
            },
            !haptics.supported
          ),
          { disabled: !haptics.supported }
        ),
        row(
          'Sleep mode',
          'Fade the controls and dim the screen after 20 seconds',
          toggle(s.sleepMode, (value) => {
            s.sleepMode = value;
            dimRow.hidden = !value;
            app.save();
          })
        )
      ]),

      el('div', { class: 'section-label', style: { marginTop: '30px' } }, 'Display'),
      rangeRow(
        'Brightness',
        'Lower it right down for use in the dark',
        s.brightness,
        { min: 0.25, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
        (v) => {
          s.brightness = v;
          app.setBrightness(v);
          app.save();
        }
      ),
      dimRow,
      el('div', { class: 'rows' }, [
        row(
          'Theme',
          null,
          segmented(
            THEMES.map((name) => ({
              value: name,
              label: el('span', { style: { color: THEME_HUES[name] } },
                name[0].toUpperCase() + name.slice(1))
            })),
            s.theme,
            (value) => {
              s.theme = value;
              app.applyTheme();
              app.save();
            },
            { fill: true }
          ),
          { stack: true }
        ),
        row(
          'Phase colours',
          'Each phase gets its own colour, matched to your theme',
          toggle(s.phaseColours, (value) => {
            s.phaseColours = value;
            app.save();
          })
        ),
        row(
          'Guide',
          'Square traces one side per phase — for Box, Box Extreme, and Custom with all four phases',
          segmented(
            [{ value: 'orb', label: 'Orb' }, { value: 'square', label: 'Square' }],
            s.guide,
            (value) => {
              s.guide = value;
              app.save();
            }
          )
        )
      ]),

      el('div', { class: 'footnote' }, [
        el('div', {}, 'Everything is stored on this device only.'),
        el('div', {}, 'Works fully offline once installed.'),
        el('div', {}, 'To move it to another device, use Export backup in history.')
      ])
    ])
  ]);

  return { el: root };
}
