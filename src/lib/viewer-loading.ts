export type LoadingState = { progress: number; status: string; indeterminate: boolean; ready: boolean; error?: string };

/** Each known asset or processing operation contributes one measured work item, not a timed percentage. */
export class LoadingTracker {
  private tasks = new Map<string, number>();
  private textureTasks = new Map<string, number>();
  private highWater = 0;
  constructor(keys: string[], private notify: (state: LoadingState) => void) {
    keys.forEach((key) => this.tasks.set(key, 0));
  }
  addTextureTasks(names: string[]) {
    names.forEach((name) => {
      this.textureTasks.set("download:" + name, 0);
      this.textureTasks.set("decode:" + name, 0);
    });
    if (!names.length) this.tasks.set("textures", 1);
  }
  update(key: string, completed: number, total: number, status: string) {
    const tasks = this.textureTasks.has(key) ? this.textureTasks : this.tasks;
    if (total > 0) tasks.set(key, Math.max(tasks.get(key) ?? 0, Math.min(completed / total, 1)));
    if (this.textureTasks.size) this.tasks.set("textures", [...this.textureTasks.values()].reduce((sum, value) => sum + value, 0) / this.textureTasks.size);
    const value = [...this.tasks.values()].reduce((sum, fraction) => sum + fraction, 0) / this.tasks.size;
    this.highWater = Math.max(this.highWater, Math.min(value, 0.99));
    this.notify({ progress: this.highWater, status, indeterminate: total <= 0, ready: false });
  }
  ready() { this.notify({ progress: 1, status: "Viewer ready", indeterminate: false, ready: true }); }
}

export async function downloadAsset(url: string, signal: AbortSignal, onBytes: (loaded: number, total: number) => void) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not download ${url.split("/").pop()} (${response.status})`);
  const total = Number(response.headers.get("Content-Length")) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length, bytes.length);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onBytes(0, total);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  onBytes(loaded, loaded);
  return bytes;
}

export function materialTextures(mtl: string) {
  return [...new Set([...mtl.matchAll(/^map_Kd\s+(.+)$/gm)].flatMap((match) => match[1] ? [match[1].trim()] : []))].sort();
}

export type Replacement = { url: string; source: string; fallback: string; width: number; height: number };
export function textureCandidates(name: string, replacements: Record<string, Replacement>, modelDir: string) {
  const resolved = name === "tex/pale_oak_trapdoor.png" ? "tex/iron_trapdoor.png" : name;
  const replacement = replacements[resolved];
  return replacement ? [replacement.url, modelDir + resolved] : [modelDir + resolved];
}

export const GIZMO_DRAG_THRESHOLD = 6;
export function isGizmoDrag(dx: number, dy: number) { return Math.hypot(dx, dy) >= GIZMO_DRAG_THRESHOLD; }