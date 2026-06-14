import { useState } from 'react';
import type { Engine } from '../simulation/engine';
import { ConversationsPanel } from './ConversationsPanel';
import { ChroniclePanel } from './ChroniclePanel';
import { EvolutionViewer } from './EvolutionViewer';

const TABS = ['Conversations', 'Chronicle', 'Evolution'] as const;
type Tab = (typeof TABS)[number];

export function BottomTabs({ engine }: { engine: Engine }) {
  const [tab, setTab] = useState<Tab>('Conversations');
  return (
    <div className="bottom">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'Conversations' && <ConversationsPanel engine={engine} />}
        {tab === 'Chronicle' && <ChroniclePanel engine={engine} />}
        {tab === 'Evolution' && <EvolutionViewer engine={engine} />}
      </div>
    </div>
  );
}
