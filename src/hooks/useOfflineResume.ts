import { useCallback, useEffect, useState } from 'react';
import type { Engine } from '../simulation/engine';
import { deserializeWorld } from '../simulation/saveSystem';
import type { SaveData } from '../simulation/saveSystem';
import { runOfflineEvolution } from '../simulation/offlineEvolution';
import type { OfflineReport } from '../simulation/offlineEvolution';
import { idbGet, SAVE_KEY } from '../storage/indexedDb';

export type ResumePhase = 'checking' | 'offer' | 'running' | 'report' | 'done';

export interface OfflineResume {
  phase: ResumePhase;
  save: SaveData | null;
  elapsedMs: number;
  progress: number;
  report: OfflineReport | null;
  resumeFastForward: () => Promise<void>;
  resumeSkip: () => void;
  startFresh: () => void;
  closeReport: () => void;
}

/**
 * On mount, look for a saved world. If one exists, offer to resume it — either
 * fast-forwarding through the time the user was away (offline evolution) or resuming as-is.
 * Picking "start fresh" keeps the freshly-seeded world the engine created at boot.
 */
export function useOfflineResume(engine: Engine): OfflineResume {
  const [phase, setPhase] = useState<ResumePhase>('checking');
  const [save, setSave] = useState<SaveData | null>(null);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<OfflineReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    idbGet(SAVE_KEY)
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setSave(d);
          setPhase('offer');
        } else {
          setPhase('done');
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('done');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const elapsedMs = save ? Math.max(0, Date.now() - save.savedAt) : 0;

  const resumeFastForward = useCallback(async () => {
    if (!save) return;
    setPhase('running');
    setProgress(0);
    const world = deserializeWorld(save);
    const rep = await runOfflineEvolution(world, Math.max(0, Date.now() - save.savedAt), setProgress);
    engine.loadSerialized(world);
    setReport(rep);
    setPhase('report');
  }, [engine, save]);

  const resumeSkip = useCallback(() => {
    if (!save) return;
    engine.loadSerialized(deserializeWorld(save));
    setPhase('done');
  }, [engine, save]);

  const startFresh = useCallback(() => setPhase('done'), []);
  const closeReport = useCallback(() => setPhase('done'), []);

  return { phase, save, elapsedMs, progress, report, resumeFastForward, resumeSkip, startFresh, closeReport };
}
