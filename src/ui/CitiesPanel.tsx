import type { CitySummary } from '../simulation/types';

export function CitiesPanel({ cities }: { cities: CitySummary[] }) {
  const sorted = cities.slice().sort((a, b) => b.population - a.population);
  return (
    <div className="panel-inner">
      <h2 className="panel-title">
        Cities <span className="title-count">{cities.length}</span>
      </h2>
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>
            ▲
          </div>
          <p>No cities yet</p>
          <p className="muted">
            Cities crystallize from large, stable (or long-lived) tribes with a treasury.
            Keep the world running.
          </p>
        </div>
      ) : (
        <div className="tribe-list">
          {sorted.map((c) => (
            <div className="tribe-card" key={c.id}>
              <div className="tribe-head">
                <span
                  className="tribe-swatch"
                  style={{ background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})` }}
                  aria-hidden
                />
                <span className="tribe-name">{c.name}</span>
                <span className="tribe-pop">{c.population}</span>
              </div>
              <div className="tribe-meta">
                <span className="badge">{c.ideology}</span>
                <span className="badge">tax {(c.taxRate * 100).toFixed(0)}%</span>
                {c.unrest > 0.55 && <span className="badge war">unrest</span>}
              </div>
              <div className="tribe-rows">
                <Row k="Leader" v={c.leaderName ?? '—'} />
                <Row k="Classes" v={`${c.classElite} / ${c.classMiddle} / ${c.classPoor}`} />
                <Row k="Treasury" v={c.storedEnergy.toFixed(0)} />
                <Bar k="Inequality" v={c.inequality} />
                <Bar k="Unrest" v={c.unrest} />
              </div>
              <div className="tribe-meta">
                {c.buildings.map((b, i) => (
                  <span className="badge soft" key={`${b}-${i}`}>
                    {b.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}

function Bar({ k, v }: { k: string; v: number }) {
  return (
    <div className="bar-row">
      <span className="kv-k">{k}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} />
      </span>
    </div>
  );
}
