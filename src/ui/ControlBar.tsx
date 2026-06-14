import type { EngineSnapshot } from '../simulation/types';
import { SPEED_OPTIONS } from '../simulation/types';
import type { EngineControls } from '../hooks/useEngine';

export function ControlBar({
  snap,
  controls,
}: {
  snap: EngineSnapshot;
  controls: EngineControls;
}) {
  return (
    <header className="controlbar">
      <div className="brand">
        <span className="brand-dot" aria-hidden />
        <span className="brand-name">GENESIS</span>
        <span className="brand-sub">emergent civilization</span>
      </div>

      <div className="ctl-group">
        <button className="btn primary" onClick={controls.toggle}>
          {snap.running ? '❚❚ Pause' : '▶ Start'}
        </button>
        <button className="btn" onClick={controls.step} disabled={snap.running} title="Advance one tick">
          ⤳ Step
        </button>
        <button className="btn" onClick={controls.reset} title="Rebuild from the same seed">
          ↺ Reset
        </button>
        <button className="btn" onClick={controls.newWorld} title="New civilization, new seed">
          ✦ New Seed
        </button>
      </div>

      <div className="ctl-group speeds" role="group" aria-label="Speed">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            className={`btn speed${snap.speed === s ? ' active' : ''}`}
            onClick={() => controls.setSpeed(s)}
          >
            ×{s}
          </button>
        ))}
      </div>

      <div className="ctl-group readout">
        <Readout label="pop" value={snap.population.toLocaleString()} />
        <Readout label="cycle" value={snap.cycle.toLocaleString()} />
        <Readout label="tps" value={String(snap.tps)} />
        <Readout label="fps" value={String(Math.round(snap.fps))} />
      </div>
    </header>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout-item">
      <span className="readout-label">{label}</span>
      <span className="readout-value">{value}</span>
    </div>
  );
}
