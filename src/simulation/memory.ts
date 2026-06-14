import type { Agent, MemoryEvent, MemoryKind } from './types';

/** Max episodic events retained per agent (oldest dropped beyond this). */
const MEMORY_CAP = 20;

interface RememberOpts {
  otherId?: number;
  x?: number;
  y?: number;
  strength?: number;
}

/** Record an episodic event. Drives later messages (Stage 4) and the agent inspector. */
export function remember(a: Agent, kind: MemoryKind, cycle: number, opts: RememberOpts = {}): void {
  a.memory.push({
    cycle,
    kind,
    otherId: opts.otherId ?? null,
    x: opts.x ?? null,
    y: opts.y ?? null,
    strength: opts.strength ?? 0.6,
  });
  if (a.memory.length > MEMORY_CAP) a.memory.shift();
}

/** Fade the emotional weight of stored memories over time. */
export function decayMemory(a: Agent, rate: number): void {
  const k = 1 - rate;
  for (let i = 0; i < a.memory.length; i++) a.memory[i].strength *= k;
}

/** Most recent memory of a given kind, if any (used by the message system later). */
export function lastMemoryOf(a: Agent, kind: MemoryKind): MemoryEvent | null {
  for (let i = a.memory.length - 1; i >= 0; i--) {
    if (a.memory[i].kind === kind) return a.memory[i];
  }
  return null;
}

/**
 * Detach memories from agents that no longer exist. Unlike relationships we do NOT drop the
 * memory — the *event* still happened and shapes the agent (grief, fear, a remembered theft);
 * we only null its `otherId` so nothing tries to resolve a dead agent, and mark it as a
 * legacy memory by halving its strength. Returns the number of references detached.
 */
export function sanitizeDeadMemory(a: Agent, aliveIds: Set<number>): number {
  let detached = 0;
  for (let i = 0; i < a.memory.length; i++) {
    const m = a.memory[i];
    if (m.otherId !== null && !aliveIds.has(m.otherId)) {
      m.otherId = null;
      m.strength *= 0.5;
      detached += 1;
    }
  }
  return detached;
}
