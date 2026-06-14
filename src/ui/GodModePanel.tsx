import type { Engine } from '../simulation/engine';
import type { GodActionType } from '../simulation/types';

interface Group {
  title: string;
  actions: { type: GodActionType; label: string }[];
}

const GROUPS: Group[] = [
  {
    title: 'Energy',
    actions: [
      { type: 'add_energy', label: '✦ Seed energy' },
      { type: 'remove_energy', label: '▽ Drain energy' },
      { type: 'trigger_scarcity', label: '☄ Famine' },
      { type: 'miracle', label: '✺ Miracle' },
    ],
  },
  {
    title: 'Beings',
    actions: [
      { type: 'spawn_agent', label: '＋ Spawn being' },
      { type: 'smite', label: '⚡ Smite a being' },
      { type: 'spawn_prophet', label: '☉ Raise a prophet' },
    ],
  },
  {
    title: 'Politics',
    actions: [
      { type: 'trigger_war', label: '⚔ Ignite war' },
      { type: 'trigger_peace', label: '☮ Impose peace' },
    ],
  },
  {
    title: 'Reality',
    actions: [
      { type: 'reveal_council', label: '◬ Reveal the council' },
      { type: 'glitch', label: '▦ System glitch' },
    ],
  },
];

export function GodModePanel({ engine }: { engine: Engine }) {
  return (
    <div className="panel-inner">
      <h2 className="panel-title">God Mode</h2>
      <p className="panel-note" style={{ marginTop: 0, marginBottom: 12 }}>
        Intervene directly. Every act is logged in the Chronicle, and the beings may react.
      </p>
      {GROUPS.map((g) => (
        <div className="god-group" key={g.title}>
          <div className="god-group-title">{g.title}</div>
          <div className="god-buttons">
            {g.actions.map((a) => (
              <button key={a.type} className="btn" onClick={() => engine.godAction(a.type)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
