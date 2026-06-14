import { useEffect, useState } from 'react';
import type { Engine } from '../simulation/engine';
import type { AgentDetail, PersonalityTraits } from '../simulation/types';

const TRAIT_KEYS: (keyof PersonalityTraits)[] = [
  'curiosity',
  'aggression',
  'empathy',
  'fear',
  'greed',
  'loyalty',
  'intelligence',
  'socialNeed',
  'independence',
  'ambition',
];

const TRAIT_SHORT: Record<keyof PersonalityTraits, string> = {
  curiosity: 'curio',
  aggression: 'aggr',
  empathy: 'emp',
  fear: 'fear',
  greed: 'greed',
  loyalty: 'loyal',
  intelligence: 'intel',
  socialNeed: 'social',
  independence: 'indep',
  ambition: 'ambit',
};

/** Floating overlay shown while an agent is selected (camera follows it). */
export function AgentInspector({ engine }: { engine: Engine }) {
  const [d, setD] = useState<AgentDetail | null>(null);

  useEffect(() => {
    const pull = () => setD(engine.getSelectedAgent());
    pull();
    const id = window.setInterval(pull, 250);
    return () => window.clearInterval(id);
  }, [engine]);

  if (!d) return null;
  const ef = d.maxEnergy > 0 ? d.energy / d.maxEnergy : 0;

  return (
    <div className="agent-inspector">
      <div className="ai-head">
        <span className="ai-name">{d.name}</span>
        <button className="ai-close" onClick={() => engine.clearSelection()} title="Stop following">
          ✕
        </button>
      </div>
      <div className="ai-sub">
        {d.tribeName ?? 'unaffiliated'} · gen {d.generation} · age {d.age.toLocaleString()}
      </div>

      <div className="ai-row">
        <span className="ai-k">Role</span>
        <span className="mono">{d.role}</span>
      </div>
      <div className="ai-row">
        <span className="ai-k">State</span>
        <span className="mono">{d.state.replace(/_/g, ' ')}</span>
      </div>
      <div className="ai-row">
        <span className="ai-k">Energy</span>
        <span className="bar-track">
          <span className="bar-fill" style={{ width: `${Math.round(ef * 100)}%` }} />
        </span>
      </div>

      <div className="ai-traits">
        {TRAIT_KEYS.map((k) => (
          <div className="ai-trait" key={k}>
            <span className="ai-trait-k">{TRAIT_SHORT[k]}</span>
            <span className="ai-trait-bar">
              <span style={{ width: `${Math.round(d.traits[k] * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>

      {d.lastMessage && <div className="ai-msg">“{d.lastMessage}”</div>}
      <div className="ai-foot">
        {d.relationships} relationships · {d.memories} memories · camera following
      </div>
    </div>
  );
}
