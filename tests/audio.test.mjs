import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeAt, sampleEnvelope } from '../src/audio.js';

const ease = (p) => 0.5 - Math.cos(Math.PI * p) / 2;

test('the pad envelope follows the engine\'s breath easing', () => {
  for (let i = 0; i <= 10; i += 1) {
    const p = i / 10;
    assert.ok(Math.abs(envelopeAt('in', p) - Math.pow(ease(p), 1.6)) < 1e-12, `in ${p}`);
    assert.ok(Math.abs(envelopeAt('out', p) - Math.pow(1 - ease(p), 1.6)) < 1e-12, `out ${p}`);
  }
  assert.equal(envelopeAt('in', 0), 0);
  assert.equal(envelopeAt('in', 1), 1);
  assert.equal(envelopeAt('out', 0), 1);
  assert.equal(envelopeAt('out', 1), 0);
  assert.equal(envelopeAt('hold', 0.3), 1);
  assert.equal(envelopeAt('wait', 0.3), 0);
  assert.equal(envelopeAt('in', -1), 0, 'clamped');
  assert.equal(envelopeAt('in', 2), 1, 'clamped');
});

test('sampleEnvelope spans p0..1 and is monotonic', () => {
  const full = sampleEnvelope('in', 0, 201);
  assert.equal(full.length, 201);
  assert.equal(full[0], 0);
  assert.ok(Math.abs(full[200] - 1) < 1e-6);
  for (let i = 1; i < full.length; i += 1) assert.ok(full[i] >= full[i - 1]);

  const half = sampleEnvelope('out', 0.5, 3);
  assert.ok(Math.abs(half[0] - envelopeAt('out', 0.5)) < 1e-6, 'starts where the seek is');
  assert.ok(Math.abs(half[2]) < 1e-6);
  assert.ok(half instanceof Float32Array);
});
