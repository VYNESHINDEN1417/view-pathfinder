export interface StudioSettings {
  resolution: "1080p" | "1080p" | "1440p" | "2160p";
  aspect: "9:16" | "16:9" | "1:1";
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

export function outputSize(s: StudioSettings) {
  const short = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 }[s.resolution];
  if (s.aspect === "1:1") return { width: short, height: short };
  const long = Math.round((short * 16) / 9 / 2) * 2;
  return s.aspect === "9:16" ? { width: short, height: long } : { width: long, height: short };
}

export const bitrateBps = { low: 2_000_000, medium: 6_000_000, high: 16_000_000, ultra: 40_000_000 };
