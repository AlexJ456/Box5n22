/**
 * Screen wake lock.
 *
 * The browser drops the lock whenever the page is hidden, so it has to be
 * re-acquired on `visibilitychange`. Without that, backgrounding the app for a
 * moment mid-session leaves the screen free to sleep for the rest of it.
 *
 * The request is asynchronous, and both of the windows that opens are reachable
 * by hand: `wanted` is re-checked after the await, because starting a session
 * and immediately closing it used to strand a lock nobody would ever release;
 * and re-entry is guarded, because `lock` is still null while a request is in
 * flight, so a visibility change landing mid-request used to leak the first one.
 */

let lock = null;
let wanted = false;
let inFlight = false;
let onDenied = null;

async function acquire() {
  if (!wanted || lock || inFlight || !('wakeLock' in navigator)) return;
  inFlight = true;
  try {
    const next = await navigator.wakeLock.request('screen');
    if (!wanted) {
      // The session ended while this was in flight. Hand it straight back.
      next.release().catch(() => {});
      return;
    }
    lock = next;
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) {
    // Unsupported, or denied on low battery — which is exactly iPhone Low Power
    // Mode. Swallowing that silently meant the screen went dark mid-session with
    // no explanation, so tell whoever asked.
    lock = null;
    if (wanted && onDenied) onDenied();
  } finally {
    inFlight = false;
  }
}

/**
 * @param {Function} [denied] called if the browser refuses the lock. Kept until
 *   replaced, so a re-request after a pause does not have to pass it again.
 */
export function request(denied) {
  wanted = true;
  if (denied) onDenied = denied;
  acquire();
}

export function release() {
  wanted = false;
  if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});
