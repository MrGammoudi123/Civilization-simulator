/**
 * Development-mode switch for the framework-free simulation core. The core never imports a
 * bundler/DOM global directly (keeps it portable + headless-testable); instead the host
 * (the Engine, on construction) calls `setDevMode(import.meta.env.DEV)`. In production and in
 * the headless harness this stays off, so the consistency warnings below cost nothing.
 */
let devMode = false;

export function setDevMode(on: boolean): void {
  devMode = on;
}

export function isDev(): boolean {
  return devMode;
}

/** Emit a development warning (no-op unless dev mode is on). */
export function devWarn(message: string): void {
  if (devMode && typeof console !== 'undefined') console.warn(`[genesis] ${message}`);
}
