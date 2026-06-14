import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from '../simulation/engine';
import type { EngineSnapshot, SpeedMultiplier } from '../simulation/types';

export interface EngineControls {
  start(): void;
  pause(): void;
  toggle(): void;
  step(): void;
  reset(): void;
  newWorld(): void;
  setSpeed(s: SpeedMultiplier): void;
}

export interface UseEngine {
  engine: Engine;
  snap: EngineSnapshot;
  controls: EngineControls;
}

/**
 * Creates a single Engine instance for the app's lifetime and bridges it to React.
 * The engine is created once via a ref (survives React 18 StrictMode's double-render),
 * and the RAF loop is owned by an effect so it is cleanly started/stopped on mount.
 * React state only holds the throttled snapshot — never the per-tick world.
 */
export function useEngine(): UseEngine {
  const engineRef = useRef<Engine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new Engine();
  }
  const engine = engineRef.current;

  const [snap, setSnap] = useState<EngineSnapshot>(() => engine.snapshot());

  useEffect(() => {
    const unsub = engine.subscribe(setSnap);
    engine.startLoop();
    return () => {
      engine.stopLoop();
      unsub();
    };
  }, [engine]);

  const controls = useMemo<EngineControls>(
    () => ({
      start: () => engine.start(),
      pause: () => engine.pause(),
      toggle: () => engine.toggle(),
      step: () => engine.step(),
      reset: () => engine.reset(),
      newWorld: () => engine.newWorld(),
      setSpeed: (s: SpeedMultiplier) => engine.setSpeed(s),
    }),
    [engine],
  );

  return { engine, snap, controls };
}
