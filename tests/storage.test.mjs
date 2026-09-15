process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage, freezeDate } from './helpers.mjs';

globalThis.localStorage = fakeStorage();
const storage = await import('../src/storage.js');
const { sanitizeSettings, DEFAULTS, historyStats, heatmapData, dayKey, mergeHistory, parseBackup, recordSession, loadHistory } = storage;

test('sanitizeSettings fills, types, clamps, and rebuilds the object-valued settings', () => {
  const s = sanitizeSettings({
    sound: 'voice',
    custom: { in: 99, hold: -3, out: 'x', wait: 2.6 },
    ladder: { on: 'yes', to: 7.3, step: 3, minutes: 500 },
    lengths: [1, 2],
    brightness: 5
  });
  assert.equal(s.sound, 'voice');
  assert.deepEqual(s.custom, { in: 30, hold: 0, out: 6, wait: 3 });
  assert.deepEqual(s.ladder, { on: false, to: 7.5, step: 1, minutes: 60 });
  assert.deepEqual(s.lengths, {});
  assert.equal(s.brightness, 1);

  assert.equal(sanitizeSettings({ sound: 'loud' }).sound, 'off');
  assert.deepEqual(sanitizeSettings(null).custom, DEFAULTS.custom);
  assert.deepEqual(sanitizeSettings({ ladder: { on: true, to: 6, step: 0.5, minutes: 2 } }).ladder,
    { on: true, to: 6, step: 0.5, minutes: 2 });
  assert.notEqual(sanitizeSettings({}).custom, DEFAULTS.custom, 'never aliases DEFAULTS');
});

test('history walks calendar days across the autumn clock change', () => {
  // Wed 5 Nov 2025, ten days after UK clocks went back (26 Oct).
  const restore = freezeDate(new Date(2025, 10, 5, 10, 0, 0).getTime());
  try {
    const list = [];
    for (let n = 0; n < 20; n += 1) {
      const d = new Date(2025, 10, 5, 9, 0, 0);
      d.setDate(d.getDate() - n);
      list.push({ ts: d.getTime(), exercise: 'box', seconds: 300, rounds: 0, completed: true });
    }
    const cells = heatmapData(list, 4);
    assert.equal(cells.length, 28);
    assert.equal(cells.filter((c) => new Date(c.ts).getHours() !== 0).length, 0, 'every cell at local midnight');
    assert.equal(dayKey(cells[0].ts), '2025-10-12');
    assert.equal(dayKey(cells[27].ts), '2025-11-08');
    assert.equal(cells.filter((c) => c.seconds > 0).length, 20);
    assert.equal(cells.filter((c) => c.future).length, 3, 'Thu Fri Sat');
    assert.equal(historyStats(list).streak, 20);
  } finally {
    restore();
  }
});

test('the streak survives a day with no session yet, but not a missed day', () => {
  const now = new Date(2025, 5, 10, 8, 0, 0).getTime();
  const restore = freezeDate(now);
  try {
    const day = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.getTime(); };
    const entry = (ts) => ({ ts, exercise: 'box', seconds: 60, rounds: 0, completed: true });
    assert.equal(historyStats([entry(day(1)), entry(day(2))]).streak, 2, 'today not yet breathed');
    assert.equal(historyStats([entry(day(0)), entry(day(2))]).streak, 1, 'yesterday missed');
    assert.equal(historyStats([]).streak, 0);
  } finally {
    restore();
  }
});

test('mergeHistory de-duplicates by timestamp and keeps order', () => {
  localStorage.clear();
  const a = { ts: 1000, exercise: 'box', seconds: 120, rounds: 2, completed: true };
  const b = { ts: 2000, exercise: 'coherent', seconds: 60, rounds: 0, completed: false };
  localStorage.setItem('breathe.history.v1', JSON.stringify([b]));
  const result = mergeHistory([a, b, { ...a }]);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.list.map((e) => e.ts), [1000, 2000]);
  assert.deepEqual(loadHistory().map((e) => e.ts), [1000, 2000]);
});

test('recordSession ignores mis-taps under ten seconds', () => {
  localStorage.clear();
  recordSession({ exercise: 'box', seconds: 4, rounds: 0, completed: false });
  assert.equal(loadHistory().length, 0);
  recordSession({ exercise: 'custom', seconds: 19, rounds: 1, completed: true });
  assert.equal(loadHistory()[0].exercise, 'custom');
});

test('parseBackup accepts the current format and the old bare array, and explains what it rejects', () => {
  assert.throws(() => parseBackup('{'), /not valid JSON/);
  assert.throws(() => parseBackup('{"format":"other"}'), /isn't a Breathe backup/);
  assert.throws(() => parseBackup('{"format":"breathe.backup","version":99,"history":[]}'), /newer version/);
  assert.throws(() => parseBackup('{"format":"breathe.backup","version":1}'), /no session history/);
  const ok = parseBackup('{"format":"breathe.backup","version":1,"history":[{"ts":1,"seconds":30},{"bad":true}],"settings":{"sound":"chime"}}');
  assert.equal(ok.history.length, 1);
  assert.equal(ok.settings.sound, 'chime');
  assert.deepEqual(parseBackup('[{"ts":5,"seconds":10}]'), { history: [{ ts: 5, seconds: 10 }], settings: null });
});
