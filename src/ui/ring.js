/**
 * The breathing guide.
 *
 * A fixed outer ring carries a hairline arc showing progress through the current
 * phase; an inner orb scales with the breath itself.
 *
 * Both are driven by one Web Animations API animation per phase, created at the
 * phase boundary and seeked to the right position — not by a value written every
 * frame. That distinction is the whole reason this file exists in this shape.
 * The previous version wrote a `--breath` custom property from a rAF loop; since
 * an unregistered custom property is not interpolable, every write invalidated
 * style on this subtree and the `calc()` inside `transform` was resolved on the
 * main thread each frame. Animating `transform` and `opacity` directly hands the
 * work to the compositor instead, where a downclocked CPU cannot make it stutter
 * — which is what iPhone Low Power Mode was doing to it.
 *
 * Seeking via `currentTime` is what lets the session catch up exactly after a
 * pause or a spell in the background: the animation is placed at the position
 * the clock says it should be at, rather than restarted from the top.
 */

import { el, svg } from '../dom.js';

const R = 112;
const CIRCUMFERENCE = 2 * Math.PI * R;

/* Scale and fade limits, previously baked into the calc()s in styles.css. */
const ORB = [0.46, 1];
const GLOW = [0.7, 1];
const FADE = [0.35, 1];
/** Reduced motion holds the orb at a middling size and breathes with light. */
const REDUCED_SCALE = 0.86;

/**
 * How full the lungs are at the start and end of each kind of phase. The engine
 * eases between them with `0.5 - cos(πp)/2`; this is the standard
 * ease-in-out-sine, which tracks that cosine to within half a percent.
 */
const FULLNESS = { in: [0, 1], out: [1, 0], hold: [1, 1], wait: [0, 0] };
const BREATH_EASE = 'cubic-bezier(0.37, 0, 0.63, 1)';

const lerp = ([from, to], t) => from + (to - from) * t;

export function createRing({ showCountdown }) {
  const track = svg('circle', { class: 'ring__track', cx: 120, cy: 120, r: R });
  const arc = svg('circle', {
    class: 'ring__arc',
    cx: 120,
    cy: 120,
    r: R,
    'stroke-dasharray': CIRCUMFERENCE,
    'stroke-dashoffset': CIRCUMFERENCE
  });

  const graphic = svg(
    'svg',
    { class: 'ring__svg', viewBox: '0 0 240 240', 'aria-hidden': 'true' },
    [track, arc]
  );

  const phaseText = el('div', { class: 'ring__phase', 'aria-live': 'polite' });
  const countText = el('div', { class: 'ring__count' });
  countText.hidden = !showCountdown;

  const orb = el('div', { class: 'ring__orb' });
  const glow = el('div', { class: 'ring__glow' });

  const root = el('div', { class: 'ring', role: 'img' }, [
    glow,
    graphic,
    orb,
    el('div', { class: 'ring__label' }, [phaseText, countText])
  ]);

  // Cached so we only touch the DOM when the rendered value actually changes.
  let lastPhase = '';
  let lastCount = '';

  let running = [];

  function play(node, keyframes, durationMs, seekMs, easing) {
    const anim = node.animate(keyframes, { duration: durationMs, easing, fill: 'both' });
    anim.currentTime = Math.min(Math.max(seekMs, 0), durationMs);
    running.push(anim);
    return anim;
  }

  function setPaused(paused) {
    for (const anim of running) {
      if (paused) anim.pause();
      else anim.play();
    }
  }

  return {
    el: root,

    setPhaseName(name) {
      if (name === lastPhase) return;
      lastPhase = name;
      phaseText.textContent = name;
      root.setAttribute('aria-label', `${name} phase`);
    },

    setCountdown(text) {
      if (countText.hidden || text === lastCount) return;
      lastCount = text;
      countText.textContent = text;
    },

    showCountdown(show) {
      countText.hidden = !show;
      if (!show) lastCount = '';
    },

    /**
     * Hand the whole phase to the compositor at once.
     *
     * `seekMs` is how far into the phase the session clock already is, so this
     * is equally the way a phase starts, the way a resumed session picks back
     * up, and the way a backgrounded one snaps to where it should be.
     */
    setPhase(kind, durationMs, seekMs, paused) {
      for (const anim of running) anim.cancel();
      running = [];

      const [from, to] = FULLNESS[kind] || FULLNESS.wait;

      if (document.documentElement.classList.contains('reduce-motion')) {
        // Scale is the part that bothers people, so the orb holds still and the
        // breath reads as light. The glow is left to the stylesheet.
        play(orb, {
          transform: [`scale(${REDUCED_SCALE})`, `scale(${REDUCED_SCALE})`],
          opacity: [lerp(FADE, from), lerp(FADE, to)]
        }, durationMs, seekMs, BREATH_EASE);
      } else {
        play(orb, {
          transform: [`scale(${lerp(ORB, from)})`, `scale(${lerp(ORB, to)})`]
        }, durationMs, seekMs, BREATH_EASE);

        play(glow, {
          transform: [`scale(${lerp(GLOW, from)})`, `scale(${lerp(GLOW, to)})`],
          opacity: [lerp(FADE, from), lerp(FADE, to)]
        }, durationMs, seekMs, BREATH_EASE);
      }

      // Linear: the arc reports time passing, so it should not ease.
      play(arc, {
        strokeDashoffset: [String(CIRCUMFERENCE), '0']
      }, durationMs, seekMs, 'linear');

      if (paused) setPaused(true);
    },

    setPaused,

    setColor(hex, rgb) {
      root.style.setProperty('--phase-color', hex);
      root.style.setProperty('--phase-rgb', rgb);
    }
  };
}
