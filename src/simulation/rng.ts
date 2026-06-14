// Seeded pseudo-random number generator (mulberry32).
//
// Determinism is a core requirement of Genesis: the same seed must reproduce the
// exact same civilization, and offline evolution must be replayable. Therefore NO
// simulation code may call Math.random() — every random draw goes through an RNG
// instance whose state is serializable (getState/setState) and saved with the world.

export class RNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  /** Serializable internal state — saved/restored with the world. */
  getState(): number {
    return this.s >>> 0;
  }

  setState(state: number): void {
    this.s = state >>> 0;
  }
}

/** A fresh random 32-bit seed (used only to *choose* a seed for a new world). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** Deterministically hash a string into a 32-bit seed (FNV-1a). */
export function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
