import { el, clear } from './dom.js';
import { loadSettings, saveSettings } from './storage.js';
import { createEngine } from './engine.js';
import * as audio from './audio.js';
import * as haptics from './haptics.js';

import { home } from './ui/home.js';
import { session } from './ui/session.js';
import { complete } from './ui/complete.js';
import { settings as settingsView } from './ui/settings.js';
import { history } from './ui/history.js';

const appEl = document.getElementById('app');
const viewEl = document.getElementById('view');
const toastEl = document.getElementById('toast');

const VIEWS = { home, session, complete, settings: settingsView, history };

const settings = loadSettings();
const engine = createEngine();

let current = null;

const app = {
  settings,
  engine,
  go,
  save: () => saveSettings(settings),
  setBrightness,
  toast
};

function go(name, props = {}) {
  if (current && current.destroy) current.destroy();
  clear(viewEl);
  current = VIEWS[name](app, props);
  viewEl.append(current.el);
  watchView(name);
  syncScrollLocks();
}

/* ------------------------------------------------------------ scroll lock -
   Scroll containers are locked (`overflow: hidden`) in CSS and only opened
   up when their content genuinely overflows. Measuring beats a `max-height`
   media query here: the query would see the raw viewport height and know
   nothing about the safe-area insets the content actually has to live
   inside, which differ per device. This way a screen that fits is truly
   immovable, and one that does not stays reachable instead of clipping. */

function syncScrollLocks() {
  for (const node of viewEl.querySelectorAll('.screen__scroll, .done')) {
    // 1px of slack so sub-pixel rounding never unlocks a screen that fits.
    node.classList.toggle('is-scrollable', node.scrollHeight > node.clientHeight + 1);
  }
}

let relayoutPending = false;
function scheduleSync() {
  if (relayoutPending) return;
  relayoutPending = true;
  requestAnimationFrame(() => {
    relayoutPending = false;
    syncScrollLocks();
  });
}

// Content changes (switching exercise, clearing history, revealing the sleep
// dim slider) and viewport changes (rotation, a resized desktop window) both
// need a re-measure. Watching the view covers every case without each screen
// having to remember to ask.
//
// Except during a session: that screen has no scroll container to unlock, but
// its ring rewrites the countdown text every second — which fired this observer,
// scheduled a frame, and re-walked the DOM for nothing, once a second,
// underneath the breathing animation.
const viewObserver = new MutationObserver(scheduleSync);

function watchView(name) {
  viewObserver.disconnect();
  if (name !== 'session') viewObserver.observe(viewEl, { childList: true, subtree: true });
}

new ResizeObserver(scheduleSync).observe(viewEl);
window.addEventListener('orientationchange', scheduleSync);

function setBrightness(value) {
  appEl.style.setProperty('--lum', String(value));
}

/* --------------------------------------------------------------- toast --- */

let toastTimer = 0;

function toast(message, action) {
  clearTimeout(toastTimer);
  const children = [el('span', {}, message)];
  if (action) {
    children.push(
      el('button', { type: 'button', onclick: action.onClick }, action.label)
    );
  }
  toastEl.replaceChildren(...children);
  toastEl.classList.add('is-visible');
  if (!action) toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  toastEl.classList.remove('is-visible');
}

/* ----------------------------------------------------------- environment - */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function applyMotion() {
  document.documentElement.classList.toggle('reduce-motion', reducedMotion.matches);
}
applyMotion();
reducedMotion.addEventListener('change', applyMotion);

window.addEventListener('offline', () => {
  toast('Offline — everything still works');
});
window.addEventListener('online', hideToast);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    audio.suspend();
  } else {
    if (engine.active && !engine.paused) audio.resume();
  }
});

/* ------------------------------------------------------------------ boot - */

setBrightness(settings.brightness);
audio.setMode(settings.sound);
haptics.setEnabled(settings.haptics);
go('home');

/* --------------------------------------------------------- service worker  */

if ('serviceWorker' in navigator) {
  // Only reload for an update if this page was already controlled. On a first
  // install `clients.claim()` also fires controllerchange, and reloading then
  // would be a pointless flash for a first-time visitor.
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('service-worker.js');

      const offerUpdate = (worker) => {
        if (!worker || !wasControlled) return;
        toast('A new version is ready', {
          label: 'Reload',
          onClick: () => {
            hideToast();
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      };

      if (registration.waiting) offerUpdate(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') offerUpdate(registration.waiting || worker);
        });
      });

      // Check for a new build when the app comes back to the foreground —
      // an installed PWA may not be reloaded for weeks at a time.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  });
}
