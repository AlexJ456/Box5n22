/**
 * The breathing guide.
 *
 * A fixed outer ring carries a hairline arc showing progress through the current
 * phase; an inner orb scales with the breath itself. The whole guide is one
 * colour: which phase you are in is carried by the shape, not the hue — the orb
 * grows through an inhale and shrinks through an exhale, and holds at full or at
 * empty for the two still phases. How full the lungs are is carried by light,
 * the orb and glow brightening toward the top of the breath.
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
 *   and every write re-rasterised the orb's and glow's gradients. That became a
 *   per-phase crossfade between two pre-coloured layers, and then went away
 *   altogether: phase is no longer encoded as colour, so there is nothing left
 *   to repaint. The stylesheet names one colour and nothing here ever writes it.
 *
 * Dropping the colour also made `setPhase` a pure function of its arguments. It
 * used to alternate which of each pair of layers held the current colour, so
 * every mid-phase re-call — a resume, a return from the background — repainted
 * both gradients. Now re-calling it costs nothing but the animations it seeks.
 *
 * Seeking via `currentTime` is what lets the session catch up exactly after a
 * pause or a spell in the background: the animation is placed at the position
 * the clock says it should be at, rather than restarted from the top.
 */

import { el } from '../dom.js';

/* Scale and fade limits. */
const ORB = [0.46, 1];
const GLOW = [0.7, 1];
const FADE = [0.35, 1];
/**
 * The orb fades far less than the glow does. The glow is a diffuse wash and can
 * be taken almost to nothing, but the orb carries the hairline edge that draws
 * the shape, and that edge is scaled down to 0.46 at the bottom of a breath —
 * under half a CSS pixel. Multiply a deep fade into that, and again into the
 * brightness veil at its 0.15 floor, and the outline shimmers and drops out.
 * Both ranges end at 1, so the top of the breath is unchanged either way; only
 * the empty end darkens.
 */
const ORB_FADE = [0.62, 1];
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

export function createRing({ showCountdown }) {
  const glow = el('div', { class: 'ring__glow' });

  const track = el('div', { class: 'ring__track' });

  const arcRight = el('div', { class: 'ring__arc-fill' });
  const arcLeft = el('div', { class: 'ring__arc-fill' });
  const arc = el('div', { class: 'ring__arc' }, [
    el('div', { class: 'ring__arc-half ring__arc-half--r' }, [arcRight]),
    el('div', { class: 'ring__arc-half ring__arc-half--l' }, [arcLeft])
  ]);

  const orb = el('div', { class: 'ring__orb' });

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
     * up, and the way a backgrounded one snaps to where it should be. Calling
     * it twice for the same phase is free and lands in the same place.
     */
    setPhase(kind, durationMs, seekMs, paused) {
      for (const anim of running) anim.cancel();
      running = [];

      const [from, to] = FULLNESS[kind] || FULLNESS.wait;

      /* ---------------------------------------------------------- breath */

      // Scale is the part of this that bothers people, so reduced motion holds
      // the orb still and lets the breath read as light alone. With no scale to
      // carry it, that branch needs the glow's deeper fade to say as much.
      const reduced = document.documentElement.classList.contains('reduce-motion');
      const scale = reduced ? [REDUCED_SCALE, REDUCED_SCALE] : ORB;
      const fade = reduced ? FADE : ORB_FADE;

      play(orb, {
        transform: [`scale(${lerp(scale, from)})`, `scale(${lerp(scale, to)})`],
        opacity: [lerp(fade, from), lerp(fade, to)]
      }, durationMs, seekMs, BREATH_EASE);

      // Left to the stylesheet under reduced motion: a glow that still swelled
      // and faded every breath would be the pulse the setting asks us to drop.
      if (!reduced) {
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
