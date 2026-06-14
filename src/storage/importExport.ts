import type { SaveData } from '../simulation/saveSystem';

/** Trigger a download of the save as a JSON file. */
export function downloadSave(data: SaveData): void {
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date(data.savedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `genesis-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read + parse a save file selected by the user. Throws if it isn't a valid save. */
export async function readSaveFile(file: File): Promise<SaveData> {
  const text = await file.text();
  const data = JSON.parse(text) as SaveData;
  if (typeof data !== 'object' || data === null || !('world' in data) || !('version' in data)) {
    throw new Error('Not a valid Genesis save file');
  }
  return data;
}
