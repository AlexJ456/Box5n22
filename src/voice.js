/**
 * Spoken phase names — the `voice` sound mode.
 *
 * Uses the browser's own speech synthesis, so there is nothing to download and
 * it works offline with whatever system voice the device has. iOS will only
 * speak later, from a timer, if it has already spoken once inside a user
 * gesture; `prime()` does that with an empty utterance from the Start tap.
 *
 * Firefox on Linux can report support but have no voices installed, in which
 * case `speak()` is simply silent — the settings note says as much.
 */

export const supported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof window.SpeechSynthesisUtterance === 'function';

let primed = false;

function utterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
  u.rate = 1;
  u.pitch = 1;
  return u;
}

/** Call from a user gesture before the first real cue. Once is enough. */
export function prime() {
  if (!supported || primed) return;
  primed = true;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance(''));
  } catch (e) {
    /* nothing to do: the first real cue will try again on its own */
  }
}

/** Say one thing now, dropping anything still queued so cues never pile up. */
export function say(text) {
  if (!supported || !text) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance(text));
  } catch (e) {
    /* ignore */
  }
}

export function stop() {
  if (!supported) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    /* ignore */
  }
}
