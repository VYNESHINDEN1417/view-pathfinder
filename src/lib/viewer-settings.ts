export const DEFAULT_BRIGHTNESS = 1.5;
export const BACKGROUNDS = [
  { id: 0, label: "Dark grey", swatch: "grey" },
  { id: 1, label: "Pure white", swatch: "white" },
  { id: 2, label: "Pure green", swatch: "green" },
  { id: 3, label: "Transparent", swatch: "transparent" },
] as const;

/** ratio = width / height; "fill" follows the screen, "custom" uses the user's input. */
export const ASPECTS = [
  { id: "fill", label: "Fill screen", ratio: 0 },
  { id: "1:1", label: "1:1 Square", ratio: 1 },
  { id: "5:4", label: "5:4", ratio: 5 / 4 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "16:10", label: "16:10", ratio: 16 / 10 },
  { id: "16:9", label: "16:9 Widescreen", ratio: 16 / 9 },
  { id: "2:1", label: "2:1", ratio: 2 },
  { id: "21:9", label: "21:9 Ultrawide", ratio: 21 / 9 },
  { id: "32:9", label: "32:9 Super ultrawide", ratio: 32 / 9 },
  { id: "4:5", label: "4:5 Portrait", ratio: 4 / 5 },
  { id: "3:4", label: "3:4 Portrait", ratio: 3 / 4 },
  { id: "2:3", label: "2:3 Portrait", ratio: 2 / 3 },
  { id: "9:16", label: "9:16 Story", ratio: 9 / 16 },
  { id: "custom", label: "Input ratio…", ratio: 0 },
] as const;

/** Shorter image side in pixels; 0 = same as the screen. */
export const RESOLUTIONS = [
  { id: 0, label: "Screen" },
  { id: 420, label: "420p" },
  { id: 480, label: "480p" },
  { id: 720, label: "720p HD" },
  { id: 1080, label: "1080p Full HD" },
  { id: 1440, label: "1440p 2K" },
] as const;

export const SHADOW_MODES = [
  { id: 0, label: "Off" },
  { id: 1, label: "Static" },
  { id: 2, label: "Real-time" },
] as const;

export const SHADOW_QUALITIES = [
  { id: 512, label: "Low (512)" },
  { id: 1024, label: "Medium (1024)" },
  { id: 2048, label: "High (2048)" },
  { id: 4096, label: "Ultra (4096)" },
] as const;

export function parseRatio(w: number, h: number) {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w / h >= 0.1 && w / h <= 10 ? w / h : 0;
}

/** Output size for a capture: the shorter side matches the chosen resolution. */
export function captureSize(ratio: number, shortSide: number) {
  if (!shortSide || !ratio) return { width: 0, height: 0 };
  return ratio >= 1
    ? { width: Math.round(shortSide * ratio), height: shortSide }
    : { width: shortSide, height: Math.round(shortSide / ratio) };
}

/** Screen twist (radians, clockwise positive in screen space) between two finger positions. */
export function twistDelta(a0: [number, number], b0: [number, number], a1: [number, number], b1: [number, number]) {
  const before = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const after = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  let d = after - before;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
