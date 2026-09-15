import { el, icon, mmss } from '../dom.js';
import { getExercise } from '../exercises.js';
import { loadHistory, historyStats } from '../storage.js';

export function complete(app, props) {
  const exercise = getExercise(props.exerciseId);
  const stats = historyStats(loadHistory());

  const detail = props.mode === 'rounds' && props.rounds
    ? `${props.rounds} ${props.rounds === 1 ? 'round' : 'rounds'} · ${mmss(props.seconds)}`
    : mmss(props.seconds);

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'done' }, [
      el('div', { class: 'done__mark' }, [icon('check')]),
      el('div', { class: 'done__title' }, props.completed ? 'Complete' : 'Session ended'),
      el('div', { class: 'done__stat' }, `${exercise.name} · ${detail}`),
      stats.streak > 1
        ? el('div', { class: 'done__stat' }, `${stats.streak} day streak`)
        : null,
      el('div', { class: 'done__actions' }, [
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => app.go('home')
          },
          'Done'
        ),
        el(
          'button',
          {
            class: 'btn btn--quiet',
            type: 'button',
            onclick: () => app.go('session', {
              exerciseId: props.exerciseId,
              limitMinutes: props.limitMinutes || 0,
              targetRounds: props.targetRounds || 0
            })
          },
          'Go again'
        )
      ])
    ])
  ]);

  return { el: root };
}
