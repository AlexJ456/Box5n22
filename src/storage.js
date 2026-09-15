/**
 * Settings and session history. Everything lives in localStorage and never
 * leaves the device.
 */

import { CUSTOM_KINDS, LADDER_LIMITS } from './exercises.js';

const SETTINGS_KEY = 'breathe.settings.v1';
const HISTORY_KEY = 'breathe.history.v1';
const LEGACY_SETTINGS_KEY = 'breathingExercisesSettings';

const HISTORY_LIMIT = 500;

// Backup files carry their own marker and version so an importer can tell a
// Breathe backup from any other JSON, and so a future format change can be
// migrated rather than rejected.
const BACKUP_FORMAT = 'breathe.backup';
const BACKUP_VERSION = 1;

export const DEFAULTS = {
  exercise: 'box',
  // One key per exercise with a slider. They used to share `phaseTime`,
  // which meant setting one silently moved the other.
  phaseTime: 4,        // Box Breathing
  coherentTime: 5,     // Coherent Breathing
  exhaleDuration: 6,   // Long Exhale
  sound: 'off',        // 'off' | 'chime' | 'ambient' | 'voice'
  // Session length, remembered per exercise. Box and Box Extreme are both
  // time-based, so keying this off the mode alone meant setting one silently
  // moved the other. `lastMinutes`/`lastRounds` survive as the fallback for an
  // exercise that has never been given a length of its own — still split by
  // mode, so a first visit to 4-7-8 cannot inherit minutes as a count of rounds.
  lengths: {},         // exercise id -> minutes, or rounds for 4-7-8. 0 = open
  lastMinutes: 0,      // 0 = open-ended
  lastRounds: 0,       // 0 = open-ended
  phaseInput: 'list',  // how the phase-time sheet picks: 'list' | 'slider'
  custom: { in: 4, hold: 4, out: 6, wait: 0 },   // the Custom pattern, seconds; 0 skips a hold
  ladder: { on: false, to: 6, step: 1, minutes: 2 }, // Box only: rise `step`s every `minutes` up to `to`
  countdown: false,
  haptics: false,
  sleepMode: true,
  brightness: 1,       // 0.25 – 1
  dimFloor: 0.35       // brightness sleep mode fades down to
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('Could not read', key, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not write', key, e);
  }
}

/**
 * Pull forward the settings saved by the previous build. The old key is left
 * in place deliberately, so rolling back to the old app still finds it.
 */
function migrateLegacy() {
  const old = read(LEGACY_SETTINGS_KEY, null);
  if (!old || typeof old !== 'object') return null;

  const migrated = {};
  if (typeof old.soundEnabled === 'boolean') migrated.sound = old.soundEnabled ? 'chime' : 'off';
  if (typeof old.countdownEnabled === 'boolean') migrated.countdown = old.countdownEnabled;
  if (typeof old.exerciseType === 'string') migrated.exercise = old.exerciseType;
  if (typeof old.phaseTime === 'number') migrated.phaseTime = old.phaseTime;
  if (typeof old.exhaleDuration === 'number') migrated.exhaleDuration = old.exhaleDuration;
  return migrated;
}

/**
 * Fill in from DEFAULTS and drop anything unrecognised or the wrong type. Used
 * for both the stored copy and an imported one, so a hand-edited file and a
 * hand-edited localStorage entry are treated with the same suspicion.
 */
export function sanitizeSettings(input) {
  // An imported file can hand us anything at all, including null.
  const base = input && typeof input === 'object' ? input : {};

  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = base[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== typeof DEFAULTS[key]) continue;
    settings[key] = value;
  }

  // `lengths` cannot come through the loop above. `typeof [] === 'object'`, so
  // an array — or any other shape a hand-edited backup might carry — would pass
  // the type check unexamined, and the spread from DEFAULTS aliases one empty
  // object into every settings instance ever sanitized. Rebuild it instead.
  settings.lengths = sanitizeLengths(base.lengths);
  settings.custom = sanitizeCustom(base.custom);
  settings.ladder = sanitizeLadder(base.ladder);

  // One-time migration, safe to delete once installs have turned over.
  // Coherent used to share Box's `phaseTime`. Carry the value across when it
  // is valid for Coherent so the card keeps showing what it showed before;
  // otherwise leave the default. Either way Box is untouched.
  // Range mirrors EXERCISES.coherent.slider — that is the source of truth.
  if (base.coherentTime === undefined && typeof base.phaseTime === 'number') {
    const shared = base.phaseTime;
    const onGrid = Math.abs(shared * 2 - Math.round(shared * 2)) < 1e-9;
    if (shared >= 4.5 && shared <= 6 && onGrid) settings.coherentTime = shared;
  }

  // Guard the ranged values in case the stored copy was hand-edited.
  settings.brightness = clamp(settings.brightness, 0.25, 1);
  settings.dimFloor = clamp(settings.dimFloor, 0.15, 1);
  if (!['off', 'chime', 'ambient', 'voice'].includes(settings.sound)) settings.sound = 'off';
  if (!['list', 'slider'].includes(settings.phaseInput)) settings.phaseInput = 'list';
  return settings;
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, null);
  const settings = sanitizeSettings(stored || migrateLegacy() || {});
  if (!stored) write(SETTINGS_KEY, settings);
  return settings;
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * exercise id -> a whole number of minutes or rounds, 0 meaning open-ended.
 * Ids are not checked against the catalogue on purpose: an entry for an
 * exercise this build does not have costs nothing, and dropping it would lose
 * the setting for anyone moving between builds.
 */
function sanitizeLengths(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, value] of Object.entries(input)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[id] = clamp(Math.round(value), 0, 999);
  }
  return out;
}

/** Each slot clamped to its own range from CUSTOM_KINDS, whole seconds. */
function sanitizeCustom(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const slot of CUSTOM_KINDS) {
    const value = src[slot.key];
    out[slot.key] = typeof value === 'number' && Number.isFinite(value)
      ? clamp(Math.round(value), slot.min, slot.max)
      : DEFAULTS.custom[slot.key];
  }
  return out;
}

/** `to` on a half-second grid, `step` one of the offered sizes, whole minutes. */
function sanitizeLadder(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const d = DEFAULTS.ladder;
  const number = (v) => typeof v === 'number' && Number.isFinite(v);
  return {
    on: src.on === true,
    to: number(src.to) ? clamp(Math.round(src.to * 2) / 2, LADDER_LIMITS.to[0], LADDER_LIMITS.to[1]) : d.to,
    step: LADDER_LIMITS.steps.includes(src.step) ? src.step : d.step,
    minutes: number(src.minutes)
      ? clamp(Math.round(src.minutes), LADDER_LIMITS.minutes[0], LADDER_LIMITS.minutes[1])
      : d.minutes
  };
}

/* -------------------------------------------------------------------------
   History
   ------------------------------------------------------------------------- */

export function loadHistory() {
  const list = read(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.ts === 'number') : [];
}

export function recordSession(entry) {
  // Filter out mis-taps, but stay below one 4-7-8 round (19s) so a genuine
  // single-round session is still recorded.
  if (!entry || entry.seconds < 10) return loadHistory();
  const list = loadHistory();
  list.push({
    ts: Date.now(),
    exercise: entry.exercise,
    seconds: Math.round(entry.seconds),
    rounds: entry.rounds || 0,
    completed: Boolean(entry.completed)
  });
  const trimmed = list.slice(-HISTORY_LIMIT);
  write(HISTORY_KEY, trimmed);
  return trimmed;
}

export function clearHistory() {
  write(HISTORY_KEY, []);
}

/** Local calendar day, not UTC — a 11pm session belongs to that day. */
export function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function historyStats(list) {
  const days = new Set(list.map((e) => dayKey(e.ts)));
  const totalSeconds = list.reduce((sum, e) => sum + e.seconds, 0);

  // Count back from today. A day with no session yet does not break the
  // streak until it is over, so we allow starting from yesterday. Stepped by
  // calendar day, not by 24 hours: after the clocks go back, 24 hours before
  // midnight is 11pm the day before, and every step from there is a day out.
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const DAY = 86400000;
  const weekAgo = Date.now() - 7 * DAY;
  const thisWeek = list.filter((e) => e.ts >= weekAgo).length;

  return {
    sessions: list.length,
    totalMinutes: Math.round(totalSeconds / 60),
    streak,
    thisWeek,
    days
  };
}

/**
 * Seconds breathed per day for the last `weeks` weeks, ordered oldest first
 * and aligned so each column is a Sunday-to-Saturday week.
 */
export function heatmapData(list, weeks = 12) {
  const perDay = new Map();
  for (const entry of list) {
    const key = dayKey(entry.ts);
    perDay.set(key, (perDay.get(key) || 0) + entry.seconds);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - today.getDay())); // end of this week
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));

  // Walked with setDate, which keeps midnight across a clock change; adding
  // 86 400 000 ms does not, and used to shift every cell after one by a day.
  const cells = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const t = d.getTime();
    cells.push({ ts: t, seconds: perDay.get(dayKey(t)) || 0, future: t > today.getTime() });
  }
  return cells;
}

/* -------------------------------------------------------------------------
   Backup

   There is no account and no server, so moving history to another device means
   moving a file. Export writes one, import merges it in.
   ------------------------------------------------------------------------- */

/**
 * Write a backup file. Resolves to 'shared', 'downloaded' or 'cancelled'.
 *
 * On a phone the file goes through the share sheet: an installed iOS app has
 * nowhere sensible to put a download, and the share sheet offers Files,
 * AirDrop and the rest. A desktop browser has a downloads folder, so there the
 * link is kept — a desktop share dialog would have nowhere to save to. Must be
 * called from a user gesture, and `share()` is reached without an await in
 * between so that activation still holds.
 */
export async function exportBackup(list, settings) {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: sanitizeSettings(settings),
    history: list
  };
  const json = JSON.stringify(backup, null, 2);
  const name = `breathe-backup-${dayKey(Date.now())}.json`;

  if (shouldShare()) {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Breathe backup' });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // Anything else: fall through to the download.
      }
    }
  }

  download(json, name);
  return 'downloaded';
}

function shouldShare() {
  return (
    typeof File === 'function' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

function download(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a backup file. Returns `{ history, settings }` — settings is null when
 * the file does not carry any. Throws with a message worth showing the user.
 *
 * A bare array is accepted too: that is what the previous "Export as JSON"
 * button produced, and those files should still be worth something.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('That file is not valid JSON.');
  }

  if (Array.isArray(data)) {
    return { history: validEntries(data), settings: null };
  }

  if (!data || typeof data !== 'object' || data.format !== BACKUP_FORMAT) {
    throw new Error("That file isn't a Breathe backup.");
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of Breathe.');
  }
  if (!Array.isArray(data.history)) {
    throw new Error('That backup has no session history in it.');
  }

  return {
    history: validEntries(data.history),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : null
  };
}

function validEntries(list) {
  return list.filter(
    (e) => e && typeof e.ts === 'number' && Number.isFinite(e.ts) && typeof e.seconds === 'number'
  );
}

/**
 * There is no session id, so identity is the timestamp plus what was recorded
 * against it. `ts` comes from `Date.now()` at millisecond resolution, so two
 * genuinely different sessions never collide, while the same session imported
 * twice always does.
 */
function entryKey(entry) {
  return `${entry.ts}|${entry.exercise}|${entry.seconds}`;
}

/**
 * Merge imported sessions into the stored history. Returns counts so the caller
 * can tell the user what actually happened.
 */
export function mergeHistory(incoming) {
  const current = loadHistory();
  const seen = new Set(current.map(entryKey));

  let added = 0;
  const combined = current.slice();
  for (const entry of incoming) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push({
      ts: entry.ts,
      exercise: entry.exercise,
      seconds: Math.round(entry.seconds),
      rounds: entry.rounds || 0,
      completed: Boolean(entry.completed)
    });
    added += 1;
  }

  combined.sort((a, b) => a.ts - b.ts);
  const list = combined.slice(-HISTORY_LIMIT);

  write(HISTORY_KEY, list);
  return {
    list,
    added,
    skipped: incoming.length - added,
    dropped: combined.length - list.length
  };
}
