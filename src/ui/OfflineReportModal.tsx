import type { OfflineResume } from '../hooks/useOfflineResume';
import { CAT_COLOR } from './ChroniclePanel';

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function OfflineReportModal({ offline }: { offline: OfflineResume }) {
  const { phase, save, elapsedMs, progress, report } = offline;
  if (phase === 'checking' || phase === 'done' || !save) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        {phase === 'offer' && (
          <>
            <h2 className="modal-title">Welcome back</h2>
            <p className="modal-text">
              A saved civilization was found (seed <span className="mono">0x{save.world.seed.toString(16)}</span>,
              cycle <span className="mono">{save.world.cycle.toLocaleString()}</span>). You were away for{' '}
              <strong>{fmtDuration(elapsedMs)}</strong>.
            </p>
            <p className="modal-text muted">
              Fast-forward to evolve the world through your absence, resume it exactly as you left it, or
              start a fresh world.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => void offline.resumeFastForward()}>
                ⏩ Fast-forward &amp; Resume
              </button>
              <button className="btn" onClick={offline.resumeSkip}>
                ↥ Resume (skip evolution)
              </button>
              <button className="btn" onClick={offline.startFresh}>
                ✦ Start fresh
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <h2 className="modal-title">Evolving the world…</h2>
            <p className="modal-text muted">Simulating the cycles that passed while you were away.</p>
            <div className="modal-progress">
              <div className="modal-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="modal-text mono">{Math.round(progress * 100)}%</p>
          </>
        )}

        {phase === 'report' && report && (
          <>
            <h2 className="modal-title">Offline Evolution Report</h2>
            <p className="modal-summary">{report.summary}</p>
            <div className="report-grid">
              <Stat k="Time away" v={fmtDuration(report.timeAwayMs)} />
              <Stat k="Cycles" v={report.cyclesSimulated.toLocaleString()} />
              <Stat k="Births" v={String(report.births)} />
              <Stat k="Deaths" v={String(report.deaths)} />
              <Stat k="New tribes" v={String(report.tribesFormed)} />
              <Stat k="New cities" v={String(report.citiesFounded)} />
              <Stat k="Revolutions" v={String(report.revolutions)} />
              <Stat k="Conflicts" v={report.conflicts.toLocaleString()} />
              <Stat k="Collapses" v={String(report.collapses)} />
              <Stat k="Population" v={`${report.populationBefore} → ${report.populationAfter}`} />
              <Stat k="Inequality" v={`${report.inequalityBefore.toFixed(2)} → ${report.inequalityAfter.toFixed(2)}`} />
            </div>
            {report.events.length > 0 && (
              <div className="report-events">
                <div className="report-events-title">Notable events</div>
                <ul>
                  {report.events.map((e) => (
                    <li key={e.id}>
                      <span className="mono report-cycle">{e.cycle.toLocaleString()}</span>{' '}
                      <span style={{ color: CAT_COLOR[e.category] }}>{e.title}</span>{' '}
                      <span className="muted">— {e.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={offline.closeReport}>
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="report-stat">
      <span className="report-stat-k">{k}</span>
      <span className="report-stat-v mono">{v}</span>
    </div>
  );
}
