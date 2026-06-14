import { useRef } from 'react';
import type { Engine } from '../simulation/engine';
import { useSaveSystem } from '../hooks/useSaveSystem';

export function SaveBar({ engine, dirty }: { engine: Engine; dirty: boolean }) {
  const save = useSaveSystem(engine, dirty);
  const fileRef = useRef<HTMLInputElement>(null);

  const statusLabel =
    save.status === 'saving'
      ? 'Saving…'
      : save.status === 'error'
        ? 'Save failed'
        : dirty
          ? 'Unsaved changes'
          : 'Saved';
  const statusClass =
    save.status === 'error' ? 'err' : save.status === 'saving' ? 'saving' : dirty ? 'dirty' : 'ok';

  return (
    <div className="savebar">
      <span className={`save-status ${statusClass}`}>
        <span className="save-dot" aria-hidden />
        {statusLabel}
      </span>
      {save.lastSavedAt !== null && (
        <span className="save-time">last saved {new Date(save.lastSavedAt).toLocaleTimeString()}</span>
      )}

      <div className="ctl-group save-actions">
        <button className="btn" onClick={() => void save.save()}>
          💾 Save
        </button>
        <button className="btn" onClick={() => void save.load()} disabled={!save.hasSave}>
          ↥ Load
        </button>
        <button className="btn" onClick={save.exportJson}>
          ⇩ Export
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ⇧ Import
        </button>
        <button className="btn" onClick={() => void save.remove()} disabled={!save.hasSave}>
          🗑 Delete
        </button>
        <button className="btn" onClick={() => engine.newWorld()} title="Fresh civilization, new seed">
          ✦ New Civilization
        </button>
        <label className="autosave">
          <input
            type="checkbox"
            checked={save.autoSave}
            onChange={(e) => save.setAutoSave(e.target.checked)}
          />
          Auto-save
        </label>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void save.importJson(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
