import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../simulation/engine';
import type { ChronicleCategory, ChronicleEvent } from '../simulation/types';

export const CAT_COLOR: Record<ChronicleCategory, string> = {
  genesis: '#7c5cff',
  survival: '#4aa8ff',
  social: '#3fb950',
  economy: '#d29922',
  politics: '#56b4e9',
  conflict: '#f85149',
  revolution: '#ff6ad5',
  collapse: '#f85149',
  hidden_council: '#9aa0ff',
  discovery: '#3fd0c9',
  culture: '#e3b341',
  era: '#8b949e',
};

const FILTERS: (ChronicleCategory | 'all')[] = [
  'all',
  'genesis',
  'social',
  'economy',
  'politics',
  'conflict',
  'revolution',
  'collapse',
  'culture',
  'era',
];

export function ChroniclePanel({ engine }: { engine: Engine }) {
  const [events, setEvents] = useState<ChronicleEvent[]>([]);
  const [cat, setCat] = useState<ChronicleCategory | 'all'>('all');

  useEffect(() => {
    const pull = () => setEvents(engine.getChronicle(400));
    pull();
    const id = window.setInterval(pull, 400);
    return () => window.clearInterval(id);
  }, [engine]);

  const shown = useMemo(() => {
    const list = cat === 'all' ? events : events.filter((e) => e.category === cat);
    return list.slice(-200).reverse();
  }, [events, cat]);

  return (
    <div className="conv">
      <div className="conv-controls">
        <div className="conv-filters">
          {FILTERS.map((c) => (
            <button key={c} className={`chip${cat === c ? ' active' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="conv-list">
        {shown.length === 0 ? (
          <p className="muted conv-empty">No events yet. Start the simulation and let history unfold.</p>
        ) : (
          shown.map((e) => (
            <div className="chron-row" key={e.id}>
              <span className="conv-cycle mono">{e.cycle.toLocaleString()}</span>
              <span className="chron-sev" title={`severity ${e.severity}`} style={{ color: CAT_COLOR[e.category] }}>
                {'●'.repeat(e.severity)}
              </span>
              <span className="chron-body">
                <span className="chron-title" style={{ color: CAT_COLOR[e.category] }}>
                  {e.title}
                </span>
                <span className="chron-desc">{e.description}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
