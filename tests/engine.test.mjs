import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, endTimeFor } from '../src/engine.js';
import { virtualClock } from './helpers.mjs';

const box = (t) => [
  { name: 'Inhale', kind: 'in', duration: t },
  { name: 'Hold', kind: 'hold', duration: t },
  { name: 'Exhale', kind: 'out', duration: t },
  { name: 'Wait', kind: 'wait', duration: t }
];
const single = (phases) => [{ fromSeconds: 0, phases }];
const time = (limitSeconds, extra = {}) => ({ mode: 'time', limitSeconds, targetRounds: 0, endKind: 'out', ...extra });

// Box 4s rising to 6s in 1s steps every minute.
const LADDER = [
  { fromSeconds: 0, phases: box(4) },
  { fromSeconds: 60, phases: box(5) },
  { fromSeconds: 120, phases: box(6) }
];

function harness(config) {
  const clock = virtualClock();
  const engine = createEngine(clock);
  const phases = [];
  const frames = [];
  const ends = [];
  engine.on('phase', (p) => phases.push({ ...p, at: clock.now() }));
  engine.on('frame', (f) => frames.push({ ...f, at: clock.now() }));
  engine.on('end', (e) => ends.push(e));
  engine.start(config);
  return { clock, engine, phases, frames, ends };
}

test('endTimeFor: a session runs on to the completion of its ending phase', () => {
  assert.equal(endTimeFor(single(box(5)), time(300)), 315, 'Box 5s, 5 min really runs 5:15');
  assert.equal(endTimeFor(single(box(4)), time(300)), 300, 'Box 4s, 5 min lands on a boundary');
  assert.equal(endTimeFor(single(box(10)), time(600, { endKind: 'wait' })), 600, 'Box Extreme ends on its wait');
  assert.equal(endTimeFor(single(box(4)), time(0)), Infinity, 'open-ended');
  const fse = single([{ kind: 'in', duration: 4 }, { kind: 'hold', duration: 7 }, { kind: 'out', duration: 8 }]);
  assert.equal(endTimeFor(fse, { mode: 'rounds', targetRounds: 4, endKind: 'out' }), 76, '4 rounds of 4-7-8');
  assert.equal(endTimeFor(fse, { mode: 'rounds', targetRounds: 0 }), Infinity);
});

test('endTimeFor: a ladder ends on the rung in force at the time', () => {
  // Cycles start at 0,16,32,48 (4s), then 64,84,104 (5s: 64 >= 60), then
  // 124,148,172 (6s: 124 >= 120). The first exhale to complete at or after
  // 180s is the one in the cycle starting at 172: 172 + 18 = 190.
  assert.equal(endTimeFor(LADDER, time(180)), 190);
  assert.equal(endTimeFor(LADDER, time(60)), 60, 'before the first rise it is plain Box');
});

test('phase boundaries land exactly on multiples of the phase length', () => {
  const { clock, phases } = harness({ phases: box(4), ...time(0) });
  clock.advance(100000);
  const boundaries = phases.filter((p) => !p.initial);
  assert.equal(boundaries.length, 25);
  boundaries.forEach((p, i) => {
    assert.equal(p.at, (i + 1) * 4000, `boundary ${i + 1}`);
    assert.equal(p.phaseElapsed, 0);
    assert.equal(p.skipped, 0);
    assert.equal(p.index, (i + 1) % 4);
  });
});

test('a stalled main thread is caught up in one step with the skipped count', () => {
  const { clock, phases } = harness({ phases: box(4), ...time(0) });
  clock.advance(2000);
  clock.jump(30000);   // nothing runs for 30s; we are now at 32s
  clock.advance(0);    // the overdue timer fires once
  const last = phases[phases.length - 1];
  assert.equal(last.at, 32000);
  assert.equal(last.index, 0, 'cycle 2, inhale');
  assert.equal(last.phaseElapsed, 0);
  // Ordinals 1..7 went by unseen; 8 is the one reported.
  assert.equal(last.skipped, 7);
  // Only one event for the whole gap — not a burst.
  assert.equal(phases.filter((p) => p.at === 32000).length, 1);
});

test('pause banks the time and resume re-seeks without a cue', () => {
  const { clock, engine, phases, frames } = harness({ phases: box(4), ...time(0) });
  clock.advance(6000);
  engine.pause();
  assert.equal(clock.pending(), 0, 'no timers while paused');
  clock.advance(10000);
  engine.resume();
  const resumed = phases[phases.length - 1];
  assert.equal(resumed.resynced, true);
  assert.equal(resumed.index, 1, 'hold');
  assert.equal(resumed.phaseElapsed, 2);
  assert.equal(frames[frames.length - 1].elapsed, 6);
  clock.advance(2000);
  const next = phases[phases.length - 1];
  assert.equal(next.index, 2, 'exhale follows two seconds later');
  assert.equal(next.resynced, false);
  assert.equal(next.skipped, 0);
});

test('a monotonic stall while running is folded in on foreground', () => {
  const { clock, engine, frames } = harness({ phases: box(4), ...time(0) });
  clock.advance(10000);
  clock.stall(5000);      // the device slept 5s; performance.now() did not move
  engine.foreground();
  assert.equal(frames[frames.length - 1].elapsed, 15);
});

test('a monotonic stall while paused is not folded in later', () => {
  const { clock, engine, frames } = harness({ phases: box(4), ...time(0) });
  clock.advance(10000);
  engine.pause();
  clock.stall(60000);     // locked the phone for a minute while paused
  clock.advance(3000);
  engine.resume();
  assert.equal(frames[frames.length - 1].elapsed, 10);
  clock.advance(1000);
  engine.foreground();    // a hide/show while running: must not add the minute
  assert.equal(frames[frames.length - 1].elapsed, 11);
  clock.stall(30000);     // but a real suspend while running still counts
  engine.foreground();
  assert.equal(frames[frames.length - 1].elapsed, 41);
});

test('a ladder changes the phase length only at a cycle boundary', () => {
  const { clock, phases } = harness({ rungs: LADDER, ...time(0) });
  clock.advance(200000);
  const starts = phases.filter((p) => p.index === 0 && !p.initial).map((p) => [p.at / 1000, p.phase.duration]);
  assert.deepEqual(starts.slice(0, 9), [
    [16, 4], [32, 4], [48, 4],
    [64, 5], [84, 5], [104, 5],
    [124, 6], [148, 6], [172, 6]
  ]);
  // Every phase of a cycle uses that cycle's length.
  for (const p of phases) {
    if (p.at >= 64000 && p.at < 124000) assert.equal(p.phase.duration, 5, `at ${p.at}`);
    if (p.at >= 124000) assert.equal(p.phase.duration, 6, `at ${p.at}`);
  }
});

test('the session ends at the instant endTimeFor promised, with the completed cycle count', () => {
  const { clock, phases, ends } = harness({ phases: box(4), ...time(60) });
  clock.advance(100000);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].completed, true);
  assert.equal(ends[0].seconds, 60);
  assert.equal(ends[0].rounds, 3, '60s is three full cycles and most of a fourth');
  const final = phases[phases.length - 1];
  assert.equal(final.isFinal, true);
  assert.equal(final.at, 60000);
  assert.equal(final.phase.kind, 'out', 'the phase that just completed');

  const extreme = harness({ phases: box(10), ...time(600, { endKind: 'wait' }) });
  extreme.clock.advance(700000);
  assert.equal(extreme.ends[0].rounds, 15);
  assert.equal(extreme.phases[extreme.phases.length - 1].phase.kind, 'wait');

  const ladder = harness({ rungs: LADDER, ...time(180) });
  ladder.clock.advance(300000);
  assert.equal(ladder.ends[0].seconds, 190);
  assert.equal(ladder.ends[0].rounds, 9);
});

test('a user stop records an incomplete session at the current time', () => {
  const { clock, engine, ends } = harness({ phases: box(4), ...time(300) });
  clock.advance(33000);
  engine.end();
  assert.deepEqual(ends[0], { completed: false, seconds: 33, rounds: 2, mode: 'time' });
  assert.equal(engine.active, false);
});
