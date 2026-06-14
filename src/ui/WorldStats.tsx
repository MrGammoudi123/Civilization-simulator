import type { EngineSnapshot } from '../simulation/types';

export function WorldStats({ snap }: { snap: EngineSnapshot }) {
  const healthPct = Math.round(snap.health * 100);
  return (
    <div className="panel-inner">
      <h2 className="panel-title">World Health</h2>
      <div className="kv-list">
        <Row k="Era" v={snap.era} accent={snap.era === 'Golden Age'} warn={snap.era === 'Dark Age' || snap.era === 'Extinction'} />
        <Row k="Health" v={`${healthPct}%`} accent={healthPct >= 60} warn={healthPct < 30} />
        <Row k="Natural energy" v={Math.round(snap.naturalEnergy).toLocaleString()} />
        <Row k="Scarcity" v={`${Math.round(snap.scarcityIndex * 100)}%`} warn={snap.scarcityIndex > 0.8} />
        <Row k="Protests" v={snap.totalProtests.toLocaleString()} warn={snap.protesters > 0} />
        <Row k="Revolutions" v={snap.totalRevolutions.toLocaleString()} warn={snap.totalRevolutions > 0} />
        <Row k="Council suspicion" v={`${Math.round(snap.discoveryRisk * 100)}%`} warn={snap.discoveryRisk > 0.5} />
        <Row k="Ruins" v={String(snap.ruinsCount)} />
      </div>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        World Stats
      </h2>
      <div className="kv-list">
        <Row k="Status" v={snap.running ? 'Running' : 'Paused'} accent={snap.running} />
        <Row k="Population" v={snap.population.toLocaleString()} />
        <Row k="Births" v={snap.births.toLocaleString()} />
        <Row k="Deaths" v={snap.deaths.toLocaleString()} />
        <Row k="Avg energy" v={snap.avgEnergy.toFixed(1)} />
        <Row k="Max generation" v={String(snap.maxGeneration)} />
        <Row k="Energy nodes" v={String(snap.energySources)} />
        <Row k="Tribes" v={String(snap.tribeCount)} />
        <Row k="Cities" v={String(snap.cityCount)} />
        <Row k="Social bonds" v={snap.socialBonds.toLocaleString()} />
        <Row k="Rivalries" v={snap.rivalries.toLocaleString()} />
        <Row k="Messages" v={snap.messageCount.toLocaleString()} />
      </div>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        Economy
      </h2>
      <div className="kv-list">
        <Row k="Inequality" v={snap.inequalityIndex.toFixed(2)} />
        <Row k="Starving" v={snap.starvationCount.toLocaleString()} warn={snap.starvationCount > 0} />
        <Row k="Unrest" v={`${Math.round(snap.unrestLevel * 100)}%`} warn={snap.unrestLevel > 0.5} />
        <Row k="Rebellion risk" v={`${Math.round(snap.rebellionRisk * 100)}%`} warn={snap.rebellionRisk > 0.5} />
      </div>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        Conflict
      </h2>
      <div className="kv-list">
        <Row k="Fighting" v={snap.fighters.toLocaleString()} warn={snap.fighters > 0} />
        <Row k="Protesting" v={snap.protesters.toLocaleString()} warn={snap.protesters > 0} />
        <Row k="Total conflicts" v={snap.totalConflicts.toLocaleString()} />
        <Row k="Revolutions" v={snap.totalRevolutions.toLocaleString()} warn={snap.totalRevolutions > 0} />
      </div>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        Engine
      </h2>
      <div className="kv-list">
        <Row k="Cycle" v={snap.cycle.toLocaleString()} />
        <Row k="Speed" v={`×${snap.speed}`} />
        <Row k="Seed" v={`0x${snap.seed.toString(16)}`} />
        <Row k="Tick rate" v={`${snap.tps}/s`} />
        <Row k="Frame rate" v={`${Math.round(snap.fps)} fps`} />
      </div>

      <p className="panel-note">
        The Chronicle, Hidden Council and God Mode build on these systems in later stages.
      </p>
    </div>
  );
}

function Row({ k, v, accent, warn }: { k: string; v: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={`kv-v${accent ? ' ok' : ''}${warn ? ' warn' : ''}`}>{v}</span>
    </div>
  );
}
