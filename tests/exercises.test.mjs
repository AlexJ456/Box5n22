import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXERCISES, EXERCISE_IDS, getPhases, sliderValue, sliderSteps, ladderInfo, ladderRungs, patternLabel, cycleSeconds
} from '../src/exercises.js';
import { DEFAULTS } from '../src/storage.js';

const base = () => JSON.parse(JSON.stringify(DEFAULTS));

test('sliderValue snaps onto each exercise\'s own grid and falls back out of range', () => {
  assert.equal(sliderValue(EXERCISES.box, { phaseTime: 4 }), 4);
  assert.equal(sliderValue(EXERCISES.box, { phaseTime: 4.4 }), 4);
  assert.equal(sliderValue(EXERCISES.box, { phaseTime: 9 }), 4, 'fallback');
  assert.equal(sliderValue(EXERCISES.coherent, { coherentTime: 4.5 }), 4.5);
  assert.equal(sliderValue(EXERCISES.coherent, { coherentTime: 4.7 }), 4.5);
  assert.equal(sliderValue(EXERCISES.longExhale, {}), 6);
  assert.deepEqual(sliderSteps(EXERCISES.coherent.slider), [4.5, 5, 5.5, 6]);
});

test('the custom pattern drops holds at zero and keeps the breath', () => {
  const s = base();
  s.custom = { in: 3, hold: 0, out: 5, wait: 2 };
  const phases = getPhases('custom', s);
  assert.deepEqual(phases.map((p) => [p.kind, p.duration]), [['in', 3], ['out', 5], ['wait', 2]]);
  assert.equal(cycleSeconds('custom', s), 10);
  assert.equal(patternLabel('custom', s), '3·5·2');
  assert.ok(EXERCISE_IDS.includes('custom'));
});

test('ladderInfo is null unless Box, on, and going somewhere', () => {
  const s = base();
  assert.equal(ladderInfo('box', s), null, 'off by default');
  s.ladder = { on: true, to: 6, step: 1, minutes: 2 };
  assert.deepEqual(ladderInfo('box', s), { start: 4, to: 6, step: 1, minutes: 2, steps: 2 });
  assert.equal(ladderInfo('coherent', s), null, 'only Box ladders');
  s.ladder.to = 4;
  assert.equal(ladderInfo('box', s), null, 'target not above the start');
  s.ladder = { on: true, to: 10, step: 2, minutes: 1 };
  s.phaseTime = 5;
  assert.equal(ladderInfo('box', s).steps, 3, '5 -> 7 -> 9 -> 10');
});

test('ladderRungs builds one rung per rise, capped at the target, on the audio-safe grid', () => {
  const s = base();
  assert.equal(ladderRungs('box', s).length, 1);
  assert.equal(ladderRungs('coherent', s).length, 1);

  s.ladder = { on: true, to: 6, step: 1, minutes: 2 };
  let rungs = ladderRungs('box', s);
  assert.deepEqual(rungs.map((r) => [r.fromSeconds, r.phases[0].duration]), [[0, 4], [120, 5], [240, 6]]);
  assert.equal(rungs[1].phases.length, 4);

  s.ladder = { on: true, to: 6, step: 0.5, minutes: 1 };
  rungs = ladderRungs('box', s);
  assert.deepEqual(rungs.map((r) => [r.fromSeconds, r.phases[0].duration]),
    [[0, 4], [60, 4.5], [120, 5], [180, 5.5], [240, 6]], 'half-second rungs are not snapped away');

  s.ladder = { on: true, to: 10, step: 2, minutes: 3 };
  rungs = ladderRungs('box', s);
  assert.deepEqual(rungs.map((r) => r.phases[0].duration), [4, 6, 8, 10], 'stops at the target');

  s.ladder = { on: true, to: 9, step: 2, minutes: 3 };
  rungs = ladderRungs('box', s);
  assert.deepEqual(rungs.map((r) => r.phases[0].duration), [4, 6, 8, 9], 'last rise is clipped to the target');
});
