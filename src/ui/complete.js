import { el, icon, mmss } from '../dom.js';
import { getExercise, ladderRungs, num } from '../exercises.js';
import { loadHistory, historyStats } from '../storage.js';

export function complete(app, props) {
  const exercise = getExercise(props.exerciseId);
  const stats = historyStats(loadHistory());

  const detail = props.mode === 'rounds' && props.rounds
    ? `${props.rounds} ${props.rounds === 1 ? 'round' : 'rounds'} · ${mmss(props.seconds)}`
    : mmss(props.seconds);

  // How far a Box ladder got: the first rung's phase time to the one in force
  // when the session ended. Settings cannot change mid-session, so the rungs
  // rebuilt here are the ones that were breathed.
  const rungs = ladderRungs(props.exerciseId, app.settings);
  let climbed = null;
  if (rungs.length > 1) {
    const reached = rungs.filter((r) => r.fromSeconds <= props.seconds).pop() || rungs[0];
    const from = rungs[0].phases[0].duration;
    const to = reached.phases[0].duration;
    climbed = to > from ? `Climbed ${num(from)}s → ${num(to)}s` : `Stayed at ${num(from)}s`;
  }

  // History already includes this session: it is recorded before we get here.
  const minutes = (seconds) => `${Math.round(seconds / 60)} min`;
  const totals = `Today ${minutes(stats.todaySeconds)} · This week ${minutes(stats.weekSeconds)}`;

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'done' }, [
      el('div', { class: 'done__mark' }, [icon('check')]),
      el('div', { class: 'done__title' }, props.completed ? 'Complete' : 'Session ended'),
      el('div', { class: 'done__stat' }, `${exercise.name} · ${detail}`),
      climbed ? el('div', { class: 'done__stat' }, climbed) : null,
      el('div', { class: 'done__stat' }, totals),
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
