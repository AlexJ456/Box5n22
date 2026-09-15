import { el, icon, mmss } from '../dom.js';
import { getExercise, getPhases, endKind, PHASE_COLORS, PHASE_RGB, num } from '../exercises.js';
import { createRing } from './ring.js';
import * as audio from '../audio.js';
import * as haptics from '../haptics.js';
import * as wakelock from '../wakelock.js';
import { recordSession } from '../storage.js';
import { endTimeFor } from '../engine.js';

const SLEEP_DELAY = 20000;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Colour drifts continuously from this phase's colour toward the next one, so
 * the light swells and fades with the breath rather than switching between
 * four flat states.
 */
function blend(from, to, t) {
  const k = smoothstep(t);
  return [
    Math.round(from[0] + (to[0] - from[0]) * k),
    Math.round(from[1] + (to[1] - from[1]) * k),
    Math.round(from[2] + (to[2] - from[2]) * k)
  ];
}

export function session(app, props) {
  const { settings } = app;
  const exercise = getExercise(props.exerciseId);
  const phases = getPhases(props.exerciseId, settings);

  // One config, handed to both the HUD and the engine, so what the countdown
  // promises and what the session actually does cannot drift apart.
  const config = {
    phases,
    mode: exercise.mode,
    limitSeconds: props.limitMinutes ? props.limitMinutes * 60 : 0,
    targetRounds: props.targetRounds || 0,
    endKind: endKind(props.exerciseId)
  };

  // What the HUD counts towards: the real end, not the limit. The session
  // always finishes the breath it is on, so these differ by up to a cycle.
  // Infinity for an open-ended session.
  const endsAt = endTimeFor(phases, config);
  const targetRounds = config.targetRounds;
  const isRounds = exercise.mode === 'rounds';

  /* ---------------------------------------------------------------- chrome */

  const hudTime = el('div', { class: 'hud__time' }, isRounds ? '' : '0:00');
  const endBtn = el(
    'button',
    { class: 'icon-btn', type: 'button', 'aria-label': 'End session', onclick: stop },
    [icon('close')]
  );
  const hud = el('div', { class: 'hud' }, [hudTime, endBtn]);

  const ring = createRing({ showCountdown: settings.countdown });

  const dots = phases.map((phase) =>
    el('div', { class: 'dot', style: { '--dot-color': PHASE_COLORS[phase.kind] } }, [
      el('div', { class: 'dot__mark' }),
      el('div', { class: 'dot__label' }, phase.name)
    ])
  );
  const dotRow = el('div', { class: 'dots' }, dots);

  const stage = el('div', { class: 'session__stage' }, [ring.el, dotRow]);

  const primaryBtn = el(
    'button',
    { class: 'btn btn--ghost', type: 'button', onclick: togglePause },
    [icon('pause'), el('span', {}, 'Pause')]
  );
  const foot = el('div', { class: 'session__foot' }, [primaryBtn]);

  const root = el('div', { class: 'screen session' }, [hud, stage, foot]);

  /* ------------------------------------------------------------ sleep mode */

  let sleepTimer = 0;
  let asleep = false;

  function wake() {
    if (asleep) {
      asleep = false;
      root.classList.remove('is-dimmed');
      app.setBrightness(settings.brightness);
    }
    clearTimeout(sleepTimer);
    if (settings.sleepMode) sleepTimer = setTimeout(sleep, SLEEP_DELAY);
  }

  function sleep() {
    if (asleep || !settings.sleepMode) return;
    asleep = true;
    root.classList.add('is-dimmed');
    app.setBrightness(Math.min(settings.brightness, settings.dimFloor));
  }

  root.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', onKey);

  function onKey(event) {
    wake();
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      togglePause();
    } else if (event.key === 'Escape') {
      stop();
    }
  }

  /* --------------------------------------------------------------- engine  */

  const engine = app.engine;
  const off = [];

  off.push(engine.on('frame', onFrame));
  off.push(engine.on('phase', onPhase));
  off.push(engine.on('end', onEnd));

  let lastRgb = '';
  let lastHud = '';

  // The breath itself is not here: it is one compositor animation per phase,
  // handed to the ring at the boundary. This runs on the engine's coarse tick
  // and only touches things that change at human speed.
  function onFrame(f) {
    if (settings.countdown) ring.setCountdown(num(f.countdown));

    const next = phases[(f.index + 1) % phases.length];
    const rgb = blend(PHASE_RGB[f.phase.kind], PHASE_RGB[next.kind], f.progress);
    const key = rgb.join(',');
    if (key !== lastRgb) {
      lastRgb = key;
      ring.setColor(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, key);
    }

    const label = isRounds
      ? `Round ${Math.min(f.rounds + 1, targetRounds || f.rounds + 1)}${targetRounds ? ` of ${targetRounds}` : ''}`
      : Number.isFinite(endsAt)
        ? `${mmss(f.seconds)} / ${mmss(endsAt)}`
        : mmss(f.seconds);
    if (label !== lastHud) {
      lastHud = label;
      hudTime.textContent = label;
    }

    audio.follow(f.breath, f.phase.kind);
  }

  function onPhase({ index, phase, phaseElapsed, isFinal, initial, skipped, resynced }) {
    if (isFinal) {
      // The session is over on this instant. `phase` is the one that just
      // completed; leaving the ring showing it is more honest than flashing up
      // the phase the session never breathes.
      audio.completeCue();
      haptics.complete();
      return;
    }

    ring.setPhaseName(phase.name);
    // Seeked, not restarted — this is equally a phase starting, a resumed
    // session picking back up, and a backgrounded one snapping to where the
    // clock says it should be.
    ring.setPhase(phase.kind, phase.duration * 1000, phaseElapsed * 1000, engine.paused);
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));

    // `initial` opens the session, `resynced` is it coming back from a pause or
    // the background, and `skipped` counts boundaries that went by unseen while
    // it was away. None has earned a cue — otherwise a couple of minutes in
    // another app come back as a burst of chimes.
    if (initial || resynced || skipped > 0) return;
    audio.phaseCue(phase.kind);
    haptics.phase();
  }

  function onEnd(summary) {
    recordSession({
      exercise: props.exerciseId,
      seconds: summary.seconds,
      rounds: summary.rounds,
      completed: summary.completed
    });
    app.go('complete', {
      ...summary,
      exerciseId: props.exerciseId,
      limitMinutes: props.limitMinutes || 0,
      targetRounds: props.targetRounds || 0
    });
  }

  function togglePause() {
    wake();
    if (engine.paused) {
      audio.unlock();
      engine.resume(); // re-seeks the ring itself, via a resynced phase event
      primaryBtn.replaceChildren(icon('pause'), el('span', {}, 'Pause'));
      wakelock.request(onWakeLockDenied);
    } else {
      engine.pause();
      ring.setPaused(true);
      audio.stop();
      primaryBtn.replaceChildren(icon('play'), el('span', {}, 'Resume'));
      wakelock.release();
    }
  }

  /** User-initiated stop. The engine records it as an incomplete session. */
  function stop() {
    engine.end();
  }

  /* ----------------------------------------------------------------- start */

  /**
   * iOS refuses the wake lock in Low Power Mode, which used to fail silently —
   * the screen would go dark mid-session with no explanation. Said once, not on
   * every re-request.
   */
  let warnedNoWakeLock = false;
  function onWakeLockDenied() {
    if (warnedNoWakeLock) return;
    warnedNoWakeLock = true;
    app.toast('Low Power Mode — your screen may sleep');
  }

  audio.setMode(settings.sound);
  audio.unlock();
  haptics.setEnabled(settings.haptics);
  wakelock.request(onWakeLockDenied);
  wake();

  engine.start(config);

  return {
    el: root,
    destroy() {
      off.forEach((fn) => fn());
      engine.dispose();
      clearTimeout(sleepTimer);
      window.removeEventListener('keydown', onKey);
      audio.stop();
      haptics.stop();
      wakelock.release();
      app.setBrightness(settings.brightness);
    }
  };
}
