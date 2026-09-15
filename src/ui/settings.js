import { el, icon } from '../dom.js';
import * as audio from '../audio.js';
import * as haptics from '../haptics.js';

function row(title, note, control, options = {}) {
  return el('div', { class: `row${options.disabled ? ' row--disabled' : ''}` }, [
    el('div', { class: 'row__body' }, [
      el('div', { class: 'row__title' }, title),
      note ? el('div', { class: 'row__note' }, note) : null
    ]),
    control
  ]);
}

function toggle(checked, onChange, disabled) {
  const input = el('input', {
    type: 'checkbox',
    checked,
    disabled,
    onchange: (e) => onChange(e.target.checked)
  });
  return el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]);
}

function segmented(options, value, onChange) {
  const buttons = options.map((option) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(option.value === value),
        onclick: () => {
          buttons.forEach((b, i) =>
            b.setAttribute('aria-pressed', String(options[i].value === option.value))
          );
          onChange(option.value);
        }
      },
      option.label
    )
  );
  return el('div', { class: 'seg', role: 'group' }, buttons);
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
        row(
          'Sound',
          'Ambient is a soft drone that follows the breath',
          segmented(
            [
              { value: 'off', label: 'Off' },
              { value: 'chime', label: 'Chime' },
              { value: 'ambient', label: 'Ambient' }
            ],
            s.sound,
            (value) => {
              s.sound = value;
              audio.unlock();
              audio.setMode(value);
              app.save();
            }
          )
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

      el('div', { class: 'footnote' }, [
        el('div', {}, 'Everything is stored on this device only.'),
        el('div', {}, 'Works fully offline once installed.'),
        el('div', {}, 'To move it to another device, use Export backup in history.')
      ])
    ])
  ]);

  return { el: root };
}
