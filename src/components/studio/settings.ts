export interface StudioSettings {
  resolution: "720p" | "1080p" | "1440p" | "2160p";
  aspect: "9:16" | "16:9" | "1:1" | "21:9" | "4:3" | "custom";
  customAspect: [number, number];
  fps: 24 | 30 | 60;
  duration: number;
  smoothing: boolean;
  loop: boolean;
  lowPoly: boolean;
  shadows: boolean;
  antialias: boolean;
  gpu: "auto" | "high" | "low";
  bitrate: "low" | "medium" | "high" | "ultra";
  pixelRatio: 1 | 1.5 | 2;
}

export const defaultSettings: StudioSettings = {
  resolution: "1080p",
  aspect: "9:16",
  customAspect: [16, 9],
  fps: 30,
  duration: 6,
  smoothing: true,
  loop: false,
  lowPoly: false,
  shadows: true,
  antialias: true,
  gpu: "auto",
  bitrate: "high",
  pixelRatio: 1.5,
};

export function studioAspect(s: StudioSettings) {
  const [w, h] = s.aspect === "custom" ? s.customAspect : s.aspect.split(":").map(Number);
  return w && h && Number.isFinite(w / h) && w / h >= 0.1 && w / h <= 10 ? w / h : 16 / 9;
}

export function outputSize(s: StudioSettings) {
  const short = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 }[s.resolution];
  const ratio = studioAspect(s);
  const long = Math.round((short * (ratio >= 1 ? ratio : 1 / ratio)) / 2) * 2;
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long };
}

export const bitrateBps = { low: 2_000_000, medium: 6_000_000, high: 16_000_000, ultra: 40_000_000 };
