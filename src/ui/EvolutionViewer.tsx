import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../simulation/engine';
import type { ChronicleEvent, HistorySample } from '../simulation/types';
import { CAT_COLOR } from './ChroniclePanel';

const RANGES: { label: string; cycles: number | null }[] = [
  { label: '1k', cycles: 1000 },
  { label: '10k', cycles: 10000 },
  { label: 'All', cycles: null },
];

interface Metric {
  key: keyof HistorySample;
  label: string;
  color: string;
  fmt: (v: number) => string;
}

const METRICS: Metric[] = [
  { key: 'population', label: 'Population', color: '#4aa8ff', fmt: (v) => v.toFixed(0) },
  { key: 'avgEnergy', label: 'Avg energy', color: '#3fb950', fmt: (v) => v.toFixed(1) },
  { key: 'naturalEnergy', label: 'Natural energy', color: '#56d364', fmt: (v) => v.toFixed(0) },
  { key: 'inequality', label: 'Inequality', color: '#d29922', fmt: (v) => v.toFixed(2) },
  { key: 'tribes', label: 'Tribes', color: '#7c5cff', fmt: (v) => v.toFixed(0) },
  { key: 'cities', label: 'Cities', color: '#3fd0c9', fmt: (v) => v.toFixed(0) },
  { key: 'conflicts', label: 'Conflicts', color: '#f85149', fmt: (v) => v.toFixed(0) },
  { key: 'protests', label: 'Protests', color: '#ffa657', fmt: (v) => v.toFixed(0) },
  { key: 'revolutions', label: 'Revolutions', color: '#ff6ad5', fmt: (v) => v.toFixed(0) },
  { key: 'discoveryRisk', label: 'Council risk', color: '#9aa0ff', fmt: (v) => (v * 100).toFixed(0) + '%' },
  // W10 — autonomous-intelligence series
  { key: 'languageDiversity', label: 'Language', color: '#5ad1c4', fmt: (v) => v.toFixed(0) },
  { key: 'discoveries', label: 'Discoveries', color: '#facc55', fmt: (v) => v.toFixed(0) },
  { key: 'cultures', label: 'Culture', color: '#c98bff', fmt: (v) => v.toFixed(0) },
];

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 200;
  const h = 26;
  if (values.length < 2) return <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function EvolutionViewer({ engine }: { engine: Engine }) {
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [chronicle, setChronicle] = useState<ChronicleEvent[]>([]);
  const [rangeIdx, setRangeIdx] = useState(1); // default: last 10k cycles
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    const pull = () => {
      setHistory(engine.getHistory());
      setChronicle(engine.getChronicle(400));
    };
    pull();
    const id = window.setInterval(pull, 500);
    return () => window.clearInterval(id);
  }, [engine]);

  const { samples, minCycle, maxCycle } = useMemo(() => {
    if (history.length === 0) return { samples: [] as HistorySample[], minCycle: 0, maxCycle: 0 };
    const maxC = history[history.length - 1].cycle;
    const range = RANGES[rangeIdx].cycles;
    const minC = range === null ? history[0].cycle : Math.max(history[0].cycle, maxC - range);
    return { samples: history.filter((s) => s.cycle >= minC), minCycle: minC, maxCycle: maxC };
  }, [history, rangeIdx]);

  const eventsInRange = useMemo(
    () => chronicle.filter((e) => e.cycle >= minCycle && e.cycle <= maxCycle),
    [chronicle, minCycle, maxCycle],
  );

  const scrubCycle = scrub ?? maxCycle;

  const nearest = useMemo(() => {
    if (samples.length === 0) return null;
    let best = samples[0];
    let bd = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.cycle - scrubCycle);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }, [samples, scrubCycle]);

  const nearEvents = useMemo(() => {
    const span = maxCycle - minCycle || 1;
    const win = span * 0.04;
    return eventsInRange.filter((e) => Math.abs(e.cycle - scrubCycle) <= win).slice(-6).reverse();
  }, [eventsInRange, scrubCycle, minCycle, maxCycle]);

  if (history.length === 0) {
    return <p className="muted tab-hint">No history yet. Start the simulation and let it run.</p>;
  }

  const span = maxCycle - minCycle || 1;

  return (
    <div className="evo">
      <div className="evo-head">
        <div className="conv-filters">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              className={`chip${rangeIdx === i ? ' active' : ''}`}
              onClick={() => {
                setRangeIdx(i);
                setScrub(null);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="muted evo-span">
          cycles {Math.round(minCycle).toLocaleString()}–{maxCycle.toLocaleString()}
        </span>
      </div>

      <div className="evo-graphs">
        {METRICS.map((m) => {
          const vals = samples.map((s) => Number(s[m.key] ?? 0));
          const at = nearest ? Number(nearest[m.key] ?? 0) : 0;
          return (
            <div className="evo-row" key={m.key}>
              <span className="evo-label" style={{ color: m.color }}>
                {m.label}
              </span>
              <Sparkline values={vals} color={m.color} />
              <span className="evo-val mono">{m.fmt(at)}</span>
            </div>
          );
        })}
      </div>

      <div className="evo-timeline" aria-hidden>
        {eventsInRange.map((e) => (
          <span
            key={e.id}
            className="evo-mark"
            title={`${e.title} (cycle ${e.cycle})`}
            style={{ left: `${((e.cycle - minCycle) / span) * 100}%`, background: CAT_COLOR[e.category] }}
          />
        ))}
      </div>

      <input
        className="evo-slider"
        type="range"
        min={minCycle}
        max={maxCycle}
        value={scrubCycle}
        onChange={(e) => setScrub(Number(e.target.value))}
      />

      <div className="evo-scrub">
        <span className="mono">cycle {Math.round(scrubCycle).toLocaleString()}</span>
        {nearEvents.length > 0 ? (
          <ul className="evo-events">
            {nearEvents.map((e) => (
              <li key={e.id}>
                <span style={{ color: CAT_COLOR[e.category] }}>{e.title}</span>{' '}
                <span className="muted">— {e.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted"> · no events near this point</span>
        )}
      </div>
    </div>
  );
}
