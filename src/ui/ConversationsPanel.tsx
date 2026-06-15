import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../simulation/engine';
import type { ConversationMessage, TribeSummary } from '../simulation/types';

import type { MessageCategory } from '../simulation/types';

type Filter = 'all' | MessageCategory;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'revolution', label: 'Revolution' },
  { key: 'protest', label: 'Protest' },
  { key: 'reform', label: 'Reform' },
  { key: 'city_life', label: 'City' },
  { key: 'trade', label: 'Trade' },
  { key: 'building', label: 'Building' },
  { key: 'friendship', label: 'Friendship' },
  { key: 'gratitude', label: 'Gratitude' },
  { key: 'grief', label: 'Grief' },
  { key: 'betrayal', label: 'Betrayal' },
  { key: 'migration', label: 'Migration' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'cult', label: 'Cult' },
  { key: 'council_rumor', label: 'Council' },
  { key: 'suspicion', label: 'Suspicion' },
  { key: 'history', label: 'History' },
  { key: 'fear', label: 'Fear' },
];

export function ConversationsPanel({ engine }: { engine: Engine }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [tribes, setTribes] = useState<TribeSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [tribeId, setTribeId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');

  // Poll the engine's capped log at a calm rate (decoupled from the 12 Hz snapshot).
  useEffect(() => {
    const pull = () => {
      setMessages(engine.getRecentMessages(200));
      setTribes(engine.getTribesSummary());
    };
    pull();
    const id = window.setInterval(pull, 250);
    return () => window.clearInterval(id);
  }, [engine]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = messages;
    if (filter !== 'all') list = list.filter((m) => m.category === filter);
    if (tribeId !== 'all') list = list.filter((m) => m.tribeId === tribeId);
    if (q) {
      list = list.filter(
        (m) =>
          m.speakerName.toLowerCase().includes(q) ||
          (m.recipientName?.toLowerCase().includes(q) ?? false),
      );
    }
    return list.slice(-120).reverse(); // newest first
  }, [messages, filter, tribeId, search]);

  return (
    <div className="conv">
      <div className="conv-controls">
        <div className="conv-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {tribes.length > 0 && (
          <select
            className="conv-select"
            value={tribeId === 'all' ? 'all' : String(tribeId)}
            onChange={(e) => setTribeId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All tribes</option>
            {tribes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="conv-search"
          placeholder="filter by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="conv-list">
        {shown.length === 0 ? (
          <p className="muted conv-empty">No messages match. Start the simulation and let it run.</p>
        ) : (
          shown.map((m) => (
            <div className="conv-row" key={m.id}>
              <span className="conv-cycle mono">{m.cycle.toLocaleString()}</span>
              <span className={`conv-dot tone-${m.tone}`} aria-hidden />
              <span className="conv-speaker">{m.speakerName}</span>
              {m.recipientName && <span className="conv-arrow">→ {m.recipientName}</span>}
              <span className="conv-text">{m.text}</span>
              {m.estimatedMeaning && (
                <span className="conv-gloss" title="estimated meaning (inferred from the speaker's invented symbols)">
                  ≈ {m.estimatedMeaning}
                  {typeof m.confidence === 'number' ? ` ${Math.round(m.confidence * 100)}%` : ''}
                </span>
              )}
              <span className="conv-cat">{m.category}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
