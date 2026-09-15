/**
 * Small form controls shared by the settings screen and the sheets: a switch,
 * a segmented control and a −/+ stepper. All buttons and labels, so they work
 * the same with a thumb and a mouse and never need the keyboard.
 */

import { el } from '../dom.js';

export function toggle(checked, onChange, disabled) {
  const input = el('input', {
    type: 'checkbox',
    checked,
    disabled,
    onchange: (e) => onChange(e.target.checked)
  });
  return el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]);
}

/**
 * @param {Array}   options  [{ value, label, disabled? }]
 * @param {object}  [opts]   `fill: true` stretches it to the row's width
 */
export function segmented(options, value, onChange, opts = {}) {
  const buttons = options.map((option) =>
    el(
      'button',
      {
        type: 'button',
        disabled: Boolean(option.disabled),
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
  return el('div', { class: `seg${opts.fill ? ' seg--fill' : ''}`, role: 'group' }, buttons);
}

/**
 * A labelled value with − and + either side of it.
 *
 * @param {object}   spec
 * @param {string}   spec.label
 * @param {string}   [spec.note]
 * @param {number}   spec.value
 * @param {number}   spec.min
 * @param {number}   spec.max
 * @param {number}   spec.step
 * @param {Function} spec.format    value -> text shown
 * @param {Function} spec.onChange  called with the new value on every tap
 * @returns {{ el: HTMLElement, set: Function }}  `set` moves it from outside
 */
export function stepper({ label, note, value, min, max, step, format, onChange }) {
  let current = value;
  const readout = el('div', { class: 'stepper__value' });
  const dec = el(
    'button',
    { class: 'stepper__btn', type: 'button', 'aria-label': `Less ${label}` },
    '−'
  );
  const inc = el(
    'button',
    { class: 'stepper__btn', type: 'button', 'aria-label': `More ${label}` },
    '+'
  );

  function render() {
    readout.textContent = format(current);
    dec.disabled = current <= min + 1e-9;
    inc.disabled = current >= max - 1e-9;
  }

  function set(next) {
    // Rounded onto the step grid so repeated 0.5 taps never drift into floats.
    const snapped = Math.round(next / step) * step;
    current = Math.round(Math.min(max, Math.max(min, snapped)) * 100) / 100;
    render();
  }

  dec.addEventListener('click', () => { set(current - step); onChange(current); });
  inc.addEventListener('click', () => { set(current + step); onChange(current); });
  set(value);

  const root = el('div', { class: 'sheet__row stepper' }, [
    el('div', { class: 'stepper__body' }, [
      el('div', {}, label),
      note ? el('div', { class: 'row__note' }, note) : null
    ]),
    readout,
    dec,
    inc
  ]);

  return { el: root, set };
}
