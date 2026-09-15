import { el, icon } from '../dom.js';

/**
 * A bottom sheet for picking one value from a short list.
 *
 * Lives in `position: fixed` outside the app's locked layout, so it cannot
 * disturb the scroll lock — the page behind it stays immovable.
 *
 * @param {object}   opts
 * @param {string}   opts.title
 * @param {Array}    opts.options   [{ value, label }] — value null means "no limit"
 * @param {*}        opts.value     the currently selected value
 * @param {object}   [opts.custom]  { placeholder, label } to show a free-entry row
 * @param {Node}     [opts.accessory] control shown on the title row, right-aligned
 * @param {Node}     [opts.body]    replaces the option rows entirely
 * @param {Function} opts.onSelect  called with the chosen value; the sheet then closes
 * @returns {{ close: Function, setBody: Function }} setBody(null) restores the rows
 */
export function openSheet({ title, options, value, custom, accessory, body, onSelect }) {
  let closing = false;

  const rows = options.map((option) => {
    const selected = option.value === value;
    return el(
      'button',
      {
        class: 'sheet__row',
        type: 'button',
        'aria-pressed': String(selected),
        onclick: () => choose(option.value)
      },
      [
        el('span', { class: 'sheet__label' }, option.label),
        selected ? icon('check') : null
      ]
    );
  });

  let customInput = null;
  if (custom) {
    // Pre-fill when the current value is a custom one rather than a preset.
    const isCustom = value !== null && !options.some((o) => o.value === value);

    customInput = el('input', {
      class: 'sheet__input',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '3',
      value: isCustom ? String(value) : '',
      placeholder: custom.placeholder,
      'aria-label': custom.label,
      oninput: (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitCustom();
        }
      }
    });

    rows.push(
      el('div', { class: 'sheet__row sheet__row--custom' }, [
        el('span', { class: 'sheet__label' }, custom.label),
        customInput,
        el(
          'button',
          { class: 'sheet__set', type: 'button', onclick: commitCustom },
          'Set'
        )
      ])
    );
  }

  function commitCustom() {
    const parsed = Number.parseInt(customInput.value, 10);
    choose(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }

  const list = el('div', { class: 'sheet__list' }, rows);
  const bodyWrap = el('div', { class: 'sheet__body' }, [body || list]);

  const panel = el('div', { class: 'sheet__panel', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet__handle' }),
    el('div', { class: 'sheet__head' }, [
      el('div', { class: 'sheet__title' }, title),
      accessory || null
    ]),
    bodyWrap
  ]);

  const root = el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet__backdrop', onclick: close }),
    panel
  ]);

  function choose(next) {
    onSelect(next);
    close();
  }

  function close() {
    if (closing) return;
    closing = true;
    window.removeEventListener('keydown', onKey);
    root.classList.remove('is-open');
    // Let the slide-out finish before removing, but never leak the node if
    // the transition never fires (reduced motion collapses it to ~0ms).
    setTimeout(() => root.remove(), 320);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  window.addEventListener('keydown', onKey);
  document.body.append(root);
  // Next frame, so the opening transition has a starting point to animate from.
  requestAnimationFrame(() => root.classList.add('is-open'));

  return {
    close,
    /** Swap the sheet's contents in place; null restores the option rows. */
    setBody: (node) => bodyWrap.replaceChildren(node || list)
  };
}
