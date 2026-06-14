import { useState } from 'react';
import type { Engine } from '../simulation/engine';
import type { EngineSnapshot } from '../simulation/types';
import { TribesPanel } from './TribesPanel';
import { CitiesPanel } from './CitiesPanel';
import { HiddenCouncilPanel } from './HiddenCouncilPanel';
import { GodModePanel } from './GodModePanel';

type Tab = 'tribes' | 'cities' | 'council' | 'god';

export function RightPanel({ engine, snap }: { engine: Engine; snap: EngineSnapshot }) {
  const [tab, setTab] = useState<Tab>('tribes');
  return (
    <div className="right-panel">
      <div className="right-tabs">
        <button className={`right-tab${tab === 'tribes' ? ' active' : ''}`} onClick={() => setTab('tribes')}>
          Tribes <span className="title-count">{snap.tribeCount}</span>
        </button>
        <button className={`right-tab${tab === 'cities' ? ' active' : ''}`} onClick={() => setTab('cities')}>
          Cities <span className="title-count">{snap.cityCount}</span>
        </button>
        <button className={`right-tab${tab === 'council' ? ' active' : ''}`} onClick={() => setTab('council')}>
          Council
        </button>
        <button className={`right-tab${tab === 'god' ? ' active' : ''}`} onClick={() => setTab('god')}>
          God
        </button>
      </div>
      <div className="right-body">
        {tab === 'tribes' && <TribesPanel tribes={snap.tribes} />}
        {tab === 'cities' && <CitiesPanel cities={snap.cities} />}
        {tab === 'council' && <HiddenCouncilPanel engine={engine} council={snap.council} />}
        {tab === 'god' && <GodModePanel engine={engine} />}
      </div>
    </div>
  );
}
