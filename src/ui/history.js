import { el, icon, mmss } from '../dom.js';
import { getExercise } from '../exercises.js';
import {
  loadHistory,
  historyStats,
  heatmapData,
  clearHistory,
  exportBackup,
  parseBackup,
  mergeHistory,
  sanitizeSettings
} from '../storage.js';
import * as audio from '../audio.js';
import * as haptics from '../haptics.js';

const RECENT_SHOWN = 20;

function intensity(seconds) {
  if (seconds <= 0) return 0.05;
  if (seconds < 120) return 0.22;
  if (seconds < 300) return 0.42;
  if (seconds < 600) return 0.66;
  return 0.9;
}

function relative(ts) {
  const day = 86400000;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const diff = Math.floor((midnight.getTime() - ts) / day);
  if (diff < 0) return 'Today';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff + 1} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function history(app) {
  let list = loadHistory();

  const body = el('div', { class: 'screen__scroll' });

  // There is no account to sync through, so a backup file is how history moves
  // between devices: export on one, import on the other.
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      // Reset first, so picking the same file twice still fires a change event.
      e.target.value = '';
      if (file) importBackup(file);
    }
  });

  async function importBackup(file) {
    let backup;
    try {
      backup = parseBackup(await file.text());
    } catch (err) {
      app.toast(err.message);
      return;
    }

    if (backup.history.length === 0 && !backup.settings) {
      app.toast('That backup is empty.');
      return;
    }

    const { added, dropped } = mergeHistory(backup.history);
    list = loadHistory();
    render();

    if (backup.settings && confirm('Also restore the settings saved in this backup?')) {
      applySettings(backup.settings);
    }

    const parts = [
      added === 0
        ? 'Already up to date'
        : `Added ${added} ${added === 1 ? 'session' : 'sessions'}`
    ];
    if (dropped > 0) parts.push(`${dropped} oldest trimmed`);
    app.toast(parts.join(' · '));
  }

  /** Same wiring the app does at boot, so a restore takes effect immediately. */
  function applySettings(incoming) {
    Object.assign(app.settings, sanitizeSettings(incoming));
    app.save();
    app.setBrightness(app.settings.brightness);
    audio.setMode(app.settings.sound);
    haptics.setEnabled(app.settings.haptics);
  }

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'topbar' }, [
      el(
        'button',
        { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.go('home') },
        [icon('back')]
      ),
      el('h1', { class: 'title' }, 'history'),
      el('div', { style: { width: '44px' } })
    ]),
    body,
    fileInput
  ]);

  function stat(value, label) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat__value' }, String(value)),
      el('div', { class: 'stat__label' }, label)
    ]);
  }

  function action(label, onclick) {
    return el('button', { class: 'btn btn--quiet', type: 'button', onclick }, label);
  }

  function render() {
    // A device you have just installed on is exactly where importing matters
    // most, so the empty state keeps that button.
    if (list.length === 0) {
      body.replaceChildren(
        el('div', { class: 'empty' }, 'No sessions yet. Your first one will show up here.'),
        el('div', { class: 'history__actions' }, [
          action('Import backup', () => fileInput.click())
        ])
      );
      return;
    }

    const s = historyStats(list);

    const cells = heatmapData(list).map((cell) =>
      el('div', {
        class: 'heat',
        style: { '--heat': cell.future ? 0.02 : intensity(cell.seconds) },
        title: `${new Date(cell.ts).toLocaleDateString()} — ${Math.round(cell.seconds / 60)} min`
      })
    );

    const recent = list
      .slice(-RECENT_SHOWN)
      .reverse()
      .map((entry) =>
        el('div', { class: 'log__item' }, [
          el('div', {}, getExercise(entry.exercise).name),
          el('div', { class: 'log__when' }, `${relative(entry.ts)} · ${mmss(entry.seconds)}`)
        ])
      );

    body.replaceChildren(
      el('div', { class: 'stats' }, [
        stat(s.streak, 'day streak'),
        stat(s.totalMinutes, 'minutes'),
        stat(s.sessions, 'sessions')
      ]),
      el('div', { class: 'section-label' }, 'Last 12 weeks'),
      el('div', { class: 'heatmap' }, cells),
      el('div', { class: 'section-label' },
        list.length > RECENT_SHOWN ? `Recent · ${RECENT_SHOWN} of ${list.length}` : 'Recent'),
      el('div', { class: 'log' }, recent),
      el('div', { class: 'history__actions' }, [
        action('Export', () => exportBackup(list, app.settings)),
        action('Import', () => fileInput.click()),
        action('Clear', () => {
          if (!confirm('Delete all session history? This cannot be undone.')) return;
          clearHistory();
          list = [];
          render();
        })
      ]),
      el('div', { class: 'footnote' }, 'Export on one device, import on another to move your history across.')
    );
  }

  render();

  return { el: root };
}
