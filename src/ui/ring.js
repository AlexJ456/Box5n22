/**
 * The breathing guide.
 *
 * A fixed outer ring carries a hairline arc showing progress through the current
 * phase; an inner orb scales with the breath itself; both are washed in a colour
 * that drifts from this phase's colour toward the next one's over the phase.
 *
 * Everything that moves during a phase is a Web Animations API animation of
 * `transform` or `opacity` — the only properties Safari and Chrome animate on
 * the compositor — created at the phase boundary and seeked to the right
 * position. Between boundaries nothing here touches the DOM at all. That is
 * the whole design: iPhone Low Power Mode caps requestAnimationFrame at 30fps
 * and downclocks the CPU, so anything repainted on the main thread stutters
 * there, and anything the compositor owns does not.
 *
 * Two things used to break that rule, and Low Power Mode made both visible:
 *
 *   The arc was an SVG circle animating `stroke-dashoffset`, which is not a
 *   compositor property, so the whole ring layer was repainted every frame. It
 *   is now two half-circle clips each holding a rotating bordered circle — the
 *   classic CSS progress ring — so the sweep is two `rotate()` animations.
 *
 *   The colour was a custom property rewritten from a timer ten times a second,
 *   and every write re-rasterised the orb's and glow's gradients. When the
 *   timer landed late and unevenly the colour stepped instead of drifting. Each
 *   element now carries two pre-coloured layers and the drift is an opacity
 *   crossfade between them, so the colour is written once per phase, to a layer
 *   nobody can see yet.
 *
 * Seeking via `currentTime` is what lets the session catch up exactly after a
 * pause or a spell in the background: the animation is placed at the position
 * the clock says it should be at, rather than restarted from the top.
 */

import { el } from '../dom.js';
import { PHASE_COLORS, PHASE_RGB } from '../exercises.js';

/* Scale and fade limits. */
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

/**
 * The colour used to drift with `smoothstep(p) = 3p² − 2p³`, applied by hand
 * on every timer tick. This bezier's y(t) is exactly that polynomial and its
 * x(t) is within one percent of t, so the crossfade reads the same.
 */
const DRIFT_EASE = 'cubic-bezier(0.333, 0, 0.667, 1)';

/**
 * Arc sweep. Each half-ring is a circle with only its top and right borders
 * coloured, which is the 180° from 45° before twelve o'clock round to 45° past
 * six. Rotated by 45° it fills the right half exactly; rotated 180° further
 * back it sits wholly in the left half, where the right clip cannot see it.
 * The right half sweeps during the first half of the phase and then holds; the
 * left half waits and then sweeps. Linear, because the arc reports time.
 */
const ARC_OFFSETS = [0, 0.5, 1];
const ARC_RIGHT = ['rotate(-135deg)', 'rotate(45deg)', 'rotate(45deg)'];
const ARC_LEFT = ['rotate(45deg)', 'rotate(45deg)', 'rotate(225deg)'];

const lerp = ([from, to], t) => from + (to - from) * t;

function pair(className) {
  return [el('div', { class: className }), el('div', { class: className })];
}

/** Written only when it changes, so a repeat is not even a style recalc. */
function paint(node, kind) {
  const hex = PHASE_COLORS[kind] || PHASE_COLORS.in;
  if (node.style.getPropertyValue('--c') === hex) return;
  node.style.setProperty('--c', hex);
  node.style.setProperty('--c-rgb', (PHASE_RGB[kind] || PHASE_RGB.in).join(', '));
}

export function createRing({ showCountdown }) {
  const glowFills = pair('ring__fill ring__fill--glow');
  const glow = el('div', { class: 'ring__glow' }, glowFills);

  const track = el('div', { class: 'ring__track' });

  const arcRight = el('div', { class: 'ring__arc-fill' });
  const arcLeft = el('div', { class: 'ring__arc-fill' });
  const arc = el('div', { class: 'ring__arc' }, [
    el('div', { class: 'ring__arc-half ring__arc-half--r' }, [arcRight]),
    el('div', { class: 'ring__arc-half ring__arc-half--l' }, [arcLeft])
  ]);

  const orbFills = pair('ring__fill ring__fill--orb');
  const edges = pair('ring__edge');
  const orb = el('div', { class: 'ring__orb' }, [...orbFills, ...edges]);

  const phaseText = el('div', { class: 'ring__phase', 'aria-live': 'polite' });
  const countText = el('div', { class: 'ring__count' });
  countText.hidden = !showCountdown;

  const root = el('div', { class: 'ring', role: 'img' }, [
    glow,
    track,
    arc,
    orb,
    el('div', { class: 'ring__label' }, [phaseText, countText])
  ]);

  // Cached so we only touch the DOM when the rendered value actually changes.
  let lastPhase = '';
  let lastCount = '';

  /**
   * Which layer of each pair is showing the current colour. It alternates every
   * phase: the layer that faded in during one phase is the one that fades out
   * during the next, and it already carries the right colour when it does.
   */
  let showing = 0;

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
    setPhase(kind, nextKind, durationMs, seekMs, paused) {
      for (const anim of running) anim.cancel();
      running = [];

      const [from, to] = FULLNESS[kind] || FULLNESS.wait;
      const a = showing;
      const b = 1 - a;

      /* ---------------------------------------------------------- colour */

      // The label and the arc are a flat colour per phase; the 700ms
      // transition on the label is the only main-thread colour change left.
      root.style.setProperty('--phase-color', PHASE_COLORS[kind] || PHASE_COLORS.in);

      // The soft gradients crossfade both ways: the showing layer fades out as
      // the other fades in. Where the two overlap at low alpha the sum is
      // within a few percent of a true blend, which is invisible in a wash.
      for (const fills of [glowFills, orbFills]) {
        paint(fills[a], kind);
        paint(fills[b], nextKind);
        play(fills[a], { opacity: [1, 0] }, durationMs, seekMs, DRIFT_EASE);
        play(fills[b], { opacity: [0, 1] }, durationMs, seekMs, DRIFT_EASE);
      }

      // The orb's hairline edge is opaque, and two opaque layers crossfading
      // both ways dip to three quarters brightness in the middle. So the edge
      // pair never both move: the lower layer stays solid and only the upper
      // one animates — in over the lower, then out to reveal it recoloured.
      // Either way what shows is exactly this colour blending into the next.
      paint(edges[a], kind);
      paint(edges[b], nextKind);
      play(edges[1], { opacity: a === 0 ? [0, 1] : [1, 0] }, durationMs, seekMs, DRIFT_EASE);

      showing = b;

      /* ---------------------------------------------------------- breath */

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

      /* ------------------------------------------------------------- arc */

      play(arcRight, { transform: ARC_RIGHT, offset: ARC_OFFSETS }, durationMs, seekMs, 'linear');
      play(arcLeft, { transform: ARC_LEFT, offset: ARC_OFFSETS }, durationMs, seekMs, 'linear');

      if (paused) setPaused(true);
    },

    setPaused
  };
}
