import type { TribeSummary } from '../simulation/types';

export function TribesPanel({ tribes }: { tribes: TribeSummary[] }) {
  const sorted = tribes.slice().sort((a, b) => b.population - a.population);
  return (
    <div className="panel-inner">
      <h2 className="panel-title">
        Tribes <span className="title-count">{tribes.length}</span>
      </h2>
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>
            ◌
          </div>
          <p>No tribes yet</p>
          <p className="muted">
            Tribes emerge when bonded agents cluster. Run the simulation for a while and
            watch territories appear on the map.
          </p>
        </div>
      ) : (
        <div className="tribe-list">
          {sorted.map((t) => (
            <div className="tribe-card" key={t.id}>
              <div className="tribe-head">
                <span
                  className="tribe-swatch"
                  style={{ background: `rgb(${t.color[0]}, ${t.color[1]}, ${t.color[2]})` }}
                  aria-hidden
                />
                <span className="tribe-name">{t.name}</span>
                <span className="tribe-pop">{t.population}</span>
              </div>
              <div className="tribe-meta">
                <span className="badge">{t.ideology}</span>
                {t.atWarWith.length > 0 && <span className="badge war">⚔ at war</span>}
              </div>
              <div className="tribe-rows">
                <TRow k="Leader" v={t.leaderName ?? '—'} />
                <Bar k="Stability" v={t.stability} />
                <Bar k="Aggression" v={t.aggressionLevel} />
                <Bar k="Inequality" v={t.inequalityLevel} />
                <TRow k="Shared energy" v={t.sharedEnergy.toFixed(0)} />
                {t.techLevel > 0 && <TRow k="Technology" v={`${t.techLevel} discovered`} />}
                {t.cultureNorms.length > 0 && <TRow k="Values" v={t.cultureNorms.join(', ')} />}
                {t.cultureTaboos.length > 0 && <TRow k="Taboos" v={t.cultureTaboos.join(', ')} />}
                {t.cultureMyths.length > 0 && <TRow k="Myths" v={t.cultureMyths.join(', ')} />}
                {t.dialect.length > 0 && <TRow k="Dialect" v={t.dialect.join(' · ')} />}
                {t.atWarWith.length > 0 && <TRow k="Enemies" v={t.atWarWith.join(', ')} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TRow({ k, v }: { k: string; v: string }) {
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
