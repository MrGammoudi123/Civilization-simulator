import { useEngine } from './hooks/useEngine';
import { useOfflineResume } from './hooks/useOfflineResume';
import { ControlBar } from './ui/ControlBar';
import { SaveBar } from './ui/SaveBar';
import { WorldStats } from './ui/WorldStats';
import { RightPanel } from './ui/RightPanel';
import { BottomTabs } from './ui/BottomTabs';
import { SimulationCanvas } from './ui/SimulationCanvas';
import { AgentInspector } from './ui/AgentInspector';
import { OfflineReportModal } from './ui/OfflineReportModal';

export default function App() {
  const { engine, snap, controls } = useEngine();
  const offline = useOfflineResume(engine);

  return (
    <div className="app">
      <OfflineReportModal offline={offline} />
      <ControlBar snap={snap} controls={controls} />
      <SaveBar engine={engine} dirty={snap.dirty} />
      <div className="app-body">
        <aside className="panel panel-left">
          <WorldStats snap={snap} />
        </aside>
        <main className="stage">
          <SimulationCanvas engine={engine} />
          <AgentInspector engine={engine} />
        </main>
        <aside className="panel panel-right">
          <RightPanel engine={engine} snap={snap} />
        </aside>
      </div>
      <footer className="panel panel-bottom">
        <BottomTabs engine={engine} />
      </footer>
    </div>
  );
}
