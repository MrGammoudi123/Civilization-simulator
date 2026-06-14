import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../simulation/engine';
import { deserializeWorld, serializeWorld } from '../simulation/saveSystem';
import { idbDelete, idbGet, idbPut, SAVE_KEY } from '../storage/indexedDb';
import { downloadSave, readSaveFile } from '../storage/importExport';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_MS = 10000;

export interface SaveSystem {
  status: SaveStatus;
  lastSavedAt: number | null;
  autoSave: boolean;
  hasSave: boolean;
  setAutoSave: (on: boolean) => void;
  save: () => Promise<void>;
  load: () => Promise<boolean>;
  remove: () => Promise<void>;
  exportJson: () => void;
  importJson: (file: File) => Promise<void>;
}

/**
 * Save orchestration: manual save/load, auto-save every 10 s while there are unsaved
 * changes, a best-effort save on page close, JSON export/import, and detection of an
 * existing save. `dirty` comes from the engine snapshot.
 */
export function useSaveSystem(engine: Engine, dirty: boolean): SaveSystem {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const [hasSave, setHasSave] = useState(false);

  const save = useCallback(async () => {
    setStatus('saving');
    try {
      const data = serializeWorld(engine.getWorld(), Date.now());
      await idbPut(SAVE_KEY, data);
      engine.markSaved();
      setLastSavedAt(data.savedAt);
      setHasSave(true);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, [engine]);

  const load = useCallback(async () => {
    const data = await idbGet(SAVE_KEY);
    if (!data) return false;
    engine.loadSerialized(deserializeWorld(data));
    setLastSavedAt(data.savedAt);
    setStatus('saved');
    return true;
  }, [engine]);

  const remove = useCallback(async () => {
    await idbDelete(SAVE_KEY);
    setHasSave(false);
    setLastSavedAt(null);
    setStatus('idle');
  }, []);

  const exportJson = useCallback(() => {
    downloadSave(serializeWorld(engine.getWorld(), Date.now()));
  }, [engine]);

  const importJson = useCallback(
    async (file: File) => {
      const data = await readSaveFile(file);
      engine.loadSerialized(deserializeWorld(data));
      setLastSavedAt(data.savedAt);
      setStatus('saved');
    },
    [engine],
  );

  // Detect an existing save on mount.
  useEffect(() => {
    let cancelled = false;
    idbGet(SAVE_KEY)
      .then((d) => {
        if (!cancelled && d) {
          setHasSave(true);
          setLastSavedAt(d.savedAt);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save loop.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!autoSave) return;
    const id = window.setInterval(() => {
      if (dirtyRef.current) void save();
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [autoSave, save]);

  // Best-effort save when the page is closed.
  useEffect(() => {
    const handler = () => {
      if (dirtyRef.current) void idbPut(SAVE_KEY, serializeWorld(engine.getWorld(), Date.now()));
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [engine]);

  return { status, lastSavedAt, autoSave, hasSave, setAutoSave, save, load, remove, exportJson, importJson };
}
