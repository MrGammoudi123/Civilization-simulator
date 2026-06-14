import type { Engine } from '../simulation/engine';
import type { HiddenCouncilSummary } from '../simulation/types';

const KIND_LABEL: Record<string, string> = {
  spawn_energy: 'seed energy',
  create_scarcity: 'create scarcity',
  protect_leader: 'protect leader',
  corrupt_agent: 'corrupt agent',
  plant_rumor: 'plant rumor',
  create_prophet: 'raise prophet',
  system_glitch: 'system glitch',
  secret_agent: 'insert secret agent',
  suppress_memory: 'suppress memory',
};

export function HiddenCouncilPanel({ engine, council }: { engine: Engine; council: HiddenCouncilSummary }) {
  return (
    <div className="panel-inner">
      <h2 className="panel-title">Hidden Council</h2>

      <label className="autosave" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={council.enabled}
          onChange={(e) => engine.setCouncilEnabled(e.target.checked)}
        />
        Council active
      </label>

      {!council.enabled ? (
        <p className="panel-note">
          The Hidden Council is dormant. Activate it to let a secret hand covertly steer the
          world — and watch whether the beings begin to suspect.
        </p>
      ) : (
        <>
          <div className="kv-list">
            <div className="bar-row">
              <span className="kv-k">Manipulation</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.round(council.manipulation * 100)}%` }} />
              </span>
            </div>
            <div className="bar-row">
              <span className="kv-k">Discovery risk</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${Math.round(council.discoveryRisk * 100)}%`, background: '#ff6ad5' }}
                />
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Revealed</span>
              <span className="kv-v">{council.revealed ? 'yes' : 'hidden'}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Interventions</span>
              <span className="kv-v">{council.interventions}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Watched</span>
              <span className="kv-v">{council.watched}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Next planned</span>
              <span className="kv-v">{council.nextKind ? (KIND_LABEL[council.nextKind] ?? council.nextKind) : '—'}</span>
            </div>
          </div>

          <h2 className="panel-title" style={{ marginTop: 16 }}>
            Secret Log
          </h2>
          {council.secretLog.length === 0 ? (
            <p className="panel-note">No interventions yet.</p>
          ) : (
            <div className="council-log">
              {council.secretLog
                .slice()
                .reverse()
                .map((e, i) => (
                  <div className="council-log-row" key={`${e.cycle}-${i}`}>
                    <span className="conv-cycle mono">{e.cycle.toLocaleString()}</span>
                    <span className="council-log-text">{e.text}</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
