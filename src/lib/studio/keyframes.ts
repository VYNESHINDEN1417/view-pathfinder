/** Camera pose from the Rust engine: [tx, ty, tz, qx, qy, qz, qw, dist]. */
export type Pose = number[];
export interface Keyframe { id: string; time: number; pose: Pose }

export const uid = () => Math.random().toString(36).slice(2, 9);
export const sortKeys = (keys: Keyframe[]) => [...keys].sort((a, b) => a.time - b.time);
export const totalFrames = (duration: number, fps: number) => Math.max(1, Math.round(duration * fps));

function slerp(a: Pose, b: Pose, u: number): number[] {
  let [bx, by, bz, bw] = [b[3]!, b[4]!, b[5]!, b[6]!];
  let d = a[3]! * bx + a[4]! * by + a[5]! * bz + a[6]! * bw;
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  let s0 = 1 - u, s1 = u;
  if (d < 0.9995) { const th = Math.acos(d), sn = Math.sin(th); s0 = Math.sin((1 - u) * th) / sn; s1 = Math.sin(u * th) / sn; }
  return [s0 * a[3]! + s1 * bx, s0 * a[4]! + s1 * by, s0 * a[5]! + s1 * bz, s0 * a[6]! + s1 * bw];
}

/** Catmull-Rom for position/distance (zero tangents at ends for ease), slerp for rotation. */
export function sampleCamera(keys: Keyframe[], t: number, smooth = true): Pose | null {
  const k = sortKeys(keys);
  if (!k.length) return null;
  if (t <= k[0]!.time) return k[0]!.pose;
  const last = k[k.length - 1]!;
  if (t >= last.time) return last.pose;
  const i = k.findIndex((x, j) => j < k.length - 1 && t >= x.time && t <= k[j + 1]!.time);
  const a = k[i]!, b = k[i + 1]!, p = k[i - 1], n = k[i + 2];
  const span = b.time - a.time || 1;
  const u = (t - a.time) / span;
  const tan = (x?: Keyframe, y?: Keyframe, c = 0) => (x && y && y.time !== x.time ? (y.pose[c]! - x.pose[c]!) / (y.time - x.time) : 0);
  const comp = (c: number) => {
    if (!smooth) return a.pose[c]! + (b.pose[c]! - a.pose[c]!) * u;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a.pose[c]! + (u3 - 2 * u2 + u) * span * tan(p, b, c) + (-2 * u3 + 3 * u2) * b.pose[c]! + (u3 - u2) * span * tan(a, n, c);
  };
  const ru = smooth && !p && !n ? u * u * (3 - 2 * u) : u;
  return [comp(0), comp(1), comp(2), ...slerp(a.pose, b.pose, ru), Math.max(1e-4, comp(7))];
}

export function formatEta(seconds: number | null) {
  if (seconds == null || !isFinite(seconds)) return "Estimating…";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
