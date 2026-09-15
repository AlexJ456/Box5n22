/**
 * Sound. Three modes:
 *
 *   off      silence
 *   chime    the 528Hz phase tone and the 880 / 1174.66Hz completion bell,
 *            carried over unchanged from the previous build
 *   ambient  a soft pad that rises through the inhale, holds at the top, falls
 *            back through the exhale and drops away to nothing in the wait
 *
 * The AudioContext is created lazily on the first user gesture. Creating it at
 * load (as the previous build did) means Safari hands back a suspended context
 * that never starts.
 *
 * Everything is synthesised — there are no audio files to download, so the app
 * still works offline from the cached shell alone.
 */

let ctx = null;
let master = null;
let mode = 'off';
let pad = null;
let retiring = [];
let impulse = null;
let lastParamUpdate = 0;
let lastAmount = 0;
let swellUntil = 0;

/* -------------------------------------------------------------------------
   Ambient tuning

   Every number that shapes the pad lives here so it can be adjusted by ear
   without reading the graph code below.
   ------------------------------------------------------------------------- */

const AMBIENT = {
  // Fixed pitches — an open stack of octaves and fifths on C. The pad never
  // glides; the phase envelope moves timbre and level instead. A drone that
  // slides in pitch reads as a siren.
  voices: [
    { hz: 65.41,  type: 'sine',     gain: 0.55, pan: 0.0,   detune: -4 }, // C2, the floor
    { hz: 130.81, type: 'sine',     gain: 1.0,  pan: -0.25, detune: 3 },  // C3, the body
    { hz: 196.0,  type: 'triangle', gain: 0.28, pan: 0.3,   detune: -6 }, // G3, a little edge
    { hz: 261.63, type: 'sine',     gain: 0.3,  pan: -0.15, detune: 5 },  // C4
    { hz: 392.0,  type: 'sine',     gain: 0.22, pan: 0.35,  detune: -3, bloom: true } // G4
  ],

  // The bloom voice stays out of the way until the top of the breath, so the
  // chord opens up rather than simply getting louder.
  bloomFrom: 0.6,

  // The envelope drives the lowpass. Closed at the bottom, open at the top.
  cutoffLow: 300,
  cutoffHigh: 1500,
  filterQ: 0.5,

  // Pad level. `floor` is the wait — almost nothing, so the bottom of the
  // cycle is unmistakable.
  levelFloor: 0.004,
  levelLow: 0.05,
  levelHigh: 0.13,
  curve: 1.6,

  // Smoothing. Slower on the way down so the exhale is a release rather than
  // a gate closing.
  glideIn: 0.18,
  glideOut: 0.42,

  // Filtered noise that swells towards the top of the breath. Reads as air.
  airLevel: 0.05,
  airFrom: 0.25,        // silent below this much of the envelope
  airHz: 620,
  airQ: 0.7,

  // The hold is parked at full level, which on its own sounds frozen rather
  // than suspended. A slow shallow tremolo keeps it alive without moving where
  // the level sits. Set shimmerDepth to 0 for a completely static hold.
  shimmerHz: 3.5,
  shimmerDepth: 0.012,

  // A soft "wush" at each phase boundary — textural, never percussive.
  swellLift: 700,
  swellMs: 450,

  // Procedural room. Length in seconds, and how much of the pad is sent to it.
  reverbSeconds: 2.8,
  reverbDecay: 3.2,
  reverbSend: 0.42,

  fadeIn: 2.5,
  fadeOut: 2.0,
  duckUnderBell: 0.35   // how far the pad drops when the completion bell lands
};

const MASTER_LEVEL = 1;

/* -------------------------------------------------------------------------
   Context
   ------------------------------------------------------------------------- */

function context() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch (e) {
      console.warn('Audio unavailable', e);
      return null;
    }
  }
  return ctx;
}

/**
 * Single output stage. Every voice goes through this, so levels stay balanced
 * against each other and the pad can be faded as a whole.
 */
function output() {
  const c = context();
  if (!c) return null;
  if (!master) {
    master = c.createGain();
    master.gain.setValueAtTime(MASTER_LEVEL, c.currentTime);
    master.connect(c.destination);
  }
  return master;
}

/** Call from a user gesture handler before anything else needs to make noise. */
export function unlock() {
  const c = context();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setMode(next) {
  mode = next;
  if (mode !== 'ambient') stopPad();
}

export function getMode() {
  return mode;
}

/* -------------------------------------------------------------------------
   Chime
   ------------------------------------------------------------------------- */

function phaseChime() {
  const c = context();
  const out = output();
  if (!c || !out) return;
  const t = c.currentTime;
  const gain = c.createGain();
  gain.connect(out);

  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(528, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.01);
  gain.gain.linearRampToValueAtTime(0, t + 0.3);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.3);
}

function completionBell() {
  const c = context();
  const out = output();
  if (!c || !out) return;
  const t = c.currentTime;
  const gain = c.createGain();
  gain.connect(out);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

  [880, 1174.66].forEach((frequency, i) => {
    const osc = c.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(frequency, t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 1.2);
  });
}

/* -------------------------------------------------------------------------
   Ambient pad
   ------------------------------------------------------------------------- */

/**
 * A room, made out of noise. Exponentially decaying white noise convolved with
 * the pad is what separates "an instrument" from "a signal generator", and it
 * costs nothing to ship because we generate it here rather than loading a file.
 * Built once on first use and reused for the life of the page.
 */
function impulseResponse(c) {
  if (impulse) return impulse;
  const length = Math.floor(c.sampleRate * AMBIENT.reverbSeconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = Math.pow(1 - i / length, AMBIENT.reverbDecay);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  impulse = buffer;
  return impulse;
}

/** White noise to loop for the air layer. Two seconds is past hearing the seam. */
function noiseBuffer(c) {
  const length = Math.floor(c.sampleRate * 2);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Where the pad should sit right now, as a single 0–1 number.
 *
 *   in     climbs to the maximum by the end of the inhale
 *   hold   parked at that maximum, unchanged
 *   out    falls back down through the exhale
 *   wait   the bottom — level drops to `levelFloor`, near silence
 *
 * The engine already holds `breath` at a constant 1 through the whole hold and
 * 0 through the whole wait, so the phase kind is what tells those two apart
 * from a moving inhale or exhale that happens to be at an extreme.
 */
function envelope(breath, kind) {
  if (kind === 'hold') return 1;
  if (kind === 'wait') return 0;
  return Math.pow(Math.max(0, Math.min(1, breath)), AMBIENT.curve);
}

function startPad() {
  const c = context();
  const out = output();
  if (!c || !out || pad) return;

  // Pausing and resuming inside the fade-out window would otherwise build a
  // second pad on top of the first one and double the volume.
  clearRetiring();
  lastAmount = 0;
  swellUntil = 0;

  const stereo = typeof c.createStereoPanner === 'function';
  const t = c.currentTime;

  // Pad bus: voices -> filter -> level -> envelope -> (dry + reverb) -> master.
  const level = c.createGain();
  level.gain.setValueAtTime(AMBIENT.levelFloor, t);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(AMBIENT.cutoffLow, t);
  filter.Q.setValueAtTime(AMBIENT.filterQ, t);
  filter.connect(level);

  // Fades the whole pad in at the start of a session and out at the end,
  // separately from the phase-driven level so the two never fight.
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.setTargetAtTime(1, t, AMBIENT.fadeIn / 3);
  level.connect(env);
  env.connect(out);

  if (typeof c.createConvolver === 'function') {
    const send = c.createGain();
    send.gain.setValueAtTime(AMBIENT.reverbSend, t);
    const convolver = c.createConvolver();
    convolver.buffer = impulseResponse(c);
    env.connect(send);
    send.connect(convolver);
    convolver.connect(out);
  }

  // The shimmer rides into the level AudioParam. Web Audio sums a param's
  // scheduled value with whatever is connected to it, so this layers on top of
  // the setTargetAtTime writes in follow() instead of fighting them.
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(AMBIENT.shimmerHz, t);
  const lfoDepth = c.createGain();
  lfoDepth.gain.setValueAtTime(0, t);
  lfo.connect(lfoDepth);
  lfoDepth.connect(level.gain);
  lfo.start();

  const voices = AMBIENT.voices.map((spec) => {
    const osc = c.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.hz, t);
    // A few cents apart so the stack shimmers instead of beating at a fixed rate.
    if (osc.detune) osc.detune.setValueAtTime(spec.detune, t);

    const gain = c.createGain();
    gain.gain.setValueAtTime(spec.bloom ? 0.0001 : spec.gain, t);
    osc.connect(gain);

    if (stereo) {
      const panner = c.createStereoPanner();
      panner.pan.setValueAtTime(spec.pan, t);
      gain.connect(panner);
      panner.connect(filter);
    } else {
      gain.connect(filter);
    }

    osc.start();
    return { osc, gain, spec };
  });

  // Air layer, into the envelope so it gets the same fade and the same room.
  const air = c.createBufferSource();
  air.buffer = noiseBuffer(c);
  air.loop = true;
  const airFilter = c.createBiquadFilter();
  airFilter.type = 'bandpass';
  airFilter.frequency.setValueAtTime(AMBIENT.airHz, t);
  airFilter.Q.setValueAtTime(AMBIENT.airQ, t);
  const airGain = c.createGain();
  airGain.gain.setValueAtTime(0.0001, t);
  air.connect(airFilter);
  airFilter.connect(airGain);
  airGain.connect(env);
  air.start();

  pad = { level, filter, env, voices, air, airGain, airFilter, lfo, lfoDepth };
}

function stopPad() {
  if (!pad || !ctx) return;
  const graph = pad;
  const t = ctx.currentTime;
  const dead = t + AMBIENT.fadeOut + 0.3;
  pad = null;
  swellUntil = 0;

  // The oscillators keep running while the tail fades, so hold on to the graph
  // until they are actually gone.
  retiring.push(graph);
  setTimeout(() => {
    retiring = retiring.filter((g) => g !== graph);
  }, (AMBIENT.fadeOut + 0.4) * 1000);

  silence(graph, t, AMBIENT.fadeOut / 3, dead);
}

/** Cut short anything still fading out. */
function clearRetiring() {
  if (!ctx || retiring.length === 0) return;
  const t = ctx.currentTime;
  for (const graph of retiring) silence(graph, t, 0.03, t + 0.2);
  retiring = [];
}

function silence(graph, at, timeConstant, dead) {
  try {
    graph.env.gain.cancelScheduledValues(at);
    graph.env.gain.setTargetAtTime(0.0001, at, timeConstant);
    graph.lfoDepth.gain.setTargetAtTime(0, at, 0.2);
    graph.voices.forEach(({ osc }) => osc.stop(dead));
    graph.air.stop(dead);
    graph.lfo.stop(dead);
  } catch (e) {
    /* already stopped */
  }
}

/**
 * Follow the breath. Called every frame during a session; parameter writes are
 * throttled to ~25Hz because `setTargetAtTime` smooths between them anyway.
 */
export function follow(breath, kind) {
  if (mode !== 'ambient') return;
  if (!pad) startPad();
  if (!pad || !ctx) return;

  const now = ctx.currentTime;
  if (now - lastParamUpdate < 0.04) return;
  lastParamUpdate = now;

  const amount = envelope(breath, kind);

  // Settle more slowly than we open, so the exhale feels like a release.
  const glide = amount >= lastAmount ? AMBIENT.glideIn : AMBIENT.glideOut;
  lastAmount = amount;

  const level =
    kind === 'wait'
      ? AMBIENT.levelFloor
      : AMBIENT.levelLow + (AMBIENT.levelHigh - AMBIENT.levelLow) * amount;
  pad.level.gain.setTargetAtTime(level, now, glide);

  // Leave the filter alone while a boundary swell is still ringing out,
  // otherwise these writes cancel it 40ms after it starts.
  if (now >= swellUntil) {
    pad.filter.frequency.setTargetAtTime(
      AMBIENT.cutoffLow + (AMBIENT.cutoffHigh - AMBIENT.cutoffLow) * amount,
      now,
      glide
    );
  }

  // Only the hold shimmers — everywhere else the movement is the envelope.
  pad.lfoDepth.gain.setTargetAtTime(kind === 'hold' ? AMBIENT.shimmerDepth : 0, now, 0.15);

  // The top voice only arrives near the peak of the breath.
  const bloom = Math.max(0, amount - AMBIENT.bloomFrom) / (1 - AMBIENT.bloomFrom);
  for (const voice of pad.voices) {
    if (!voice.spec.bloom) continue;
    voice.gain.gain.setTargetAtTime(Math.max(0.0001, voice.spec.gain * bloom), now, glide);
  }

  const airAmount =
    kind === 'wait' ? 0 : Math.max(0, amount - AMBIENT.airFrom) / (1 - AMBIENT.airFrom);
  pad.airGain.gain.setTargetAtTime(Math.max(0.0001, AMBIENT.airLevel * airAmount), now, glide);
  pad.airFilter.frequency.setTargetAtTime(AMBIENT.airHz * (1 + 0.6 * amount), now, glide);
}

/**
 * A quiet bell at each phase boundary, pitched by phase.
 *
 * The pad tells you where in the breath you are; these tell you which phase
 * just began without having to open your eyes. The pair rises into the top of
 * the breath and falls away into the bottom. Roughly a quarter the level of
 * chime mode, sine rather than triangle, so it sits inside the pad instead of
 * on top of it.
 */
const AMBIENT_BELL = {
  in: 523.25,    // C5
  hold: 659.25,  // E5 — highest, lungs full
  out: 392.0,    // G4
  wait: 261.63   // C4 — lowest, lungs empty
};

function ambientBell(kind) {
  const c = context();
  const out = output();
  if (!c || !out) return;
  const freq = AMBIENT_BELL[kind];
  if (!freq) return;

  const t = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  gain.connect(out);

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.55);
}

/** A soft "wush" marking a phase boundary — textural, never percussive. */
function swell() {
  if (!pad || !ctx) return;
  const now = ctx.currentTime;
  const from = pad.filter.frequency.value;

  pad.filter.frequency.cancelScheduledValues(now);
  pad.filter.frequency.setValueAtTime(from, now);
  pad.filter.frequency.linearRampToValueAtTime(from + AMBIENT.swellLift, now + 0.09);
  pad.filter.frequency.setTargetAtTime(AMBIENT.cutoffLow, now + 0.09, 0.22);
  swellUntil = now + AMBIENT.swellMs / 1000;
}

/* -------------------------------------------------------------------------
   Public cues
   ------------------------------------------------------------------------- */

export function phaseCue(kind) {
  if (mode === 'chime') phaseChime();
  else if (mode === 'ambient') {
    swell();
    ambientBell(kind);
  }
}

export function completeCue() {
  if (mode === 'off') return;
  // Duck the pad and let it decay underneath the bell rather than cutting both
  // off at the same instant.
  if (mode === 'ambient' && pad && ctx) {
    pad.env.gain.cancelScheduledValues(ctx.currentTime);
    pad.env.gain.setTargetAtTime(AMBIENT.duckUnderBell, ctx.currentTime, 0.15);
    setTimeout(stopPad, 400);
  }
  completionBell();
}

export function stop() {
  stopPad();
}

/** Free the hardware when the app is backgrounded; resume on return. */
export function suspend() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
