/**
 * Phase-change haptics.
 *
 * Known limitation: iOS Safari does not implement the Vibration API, so this
 * is inert on iPhone and iPad. It works on Android and on desktop Chrome with
 * a connected device. `supported` is exported so the settings UI can say so
 * plainly rather than offering a switch that silently does nothing.
 */

export const supported =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let enabled = false;

export function setEnabled(value) {
  enabled = Boolean(value) && supported;
}

function buzz(pattern) {
  if (!enabled) return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {
    /* some browsers throw when the page is not visible */
  }
}

export function phase() {
  buzz(12);
}

export function complete() {
  buzz([18, 70, 18, 70, 34]);
}

export function stop() {
  if (supported) {
    try { navigator.vibrate(0); } catch (e) { /* ignore */ }
  }
}
