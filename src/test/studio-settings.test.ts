import { describe, expect, it } from "vitest";
import { defaultSettings, studioAspect, outputSize } from "@/components/studio/settings";
import { totalFrames } from "@/lib/studio/keyframes";

describe("Studio framing and output", () => {
  it("defaults to MP4, H.264, and balanced export optimization", () => {
    expect(defaultSettings.format).toBe("mp4");
    expect(defaultSettings.codec).toBe("h264");
    expect(defaultSettings.optimizeExport).toBe("balanced");
  });
  it("enables export noise reduction by default", () => {
    expect(defaultSettings.noiseReduction).toBe(true);
  });
  it("supports 90 fps output frame counts", () => {
    expect(totalFrames(6, 90)).toBe(540);
  });
  it("keeps landscape output at 16:9", () => {
    const settings = { ...defaultSettings, aspect: "16:9" as const };
    expect(studioAspect(settings)).toBe(16 / 9);
    expect(outputSize(settings)).toEqual({ width: 1920, height: 1080 });
  });
  it("keeps portrait output at 9:16", () => {
    expect(studioAspect(defaultSettings)).toBe(9 / 16);
    expect(outputSize(defaultSettings)).toEqual({ width: 1080, height: 1920 });
  });
  it("uses custom ratios for both preview and export", () => {
    const settings = { ...defaultSettings, aspect: "custom" as const, customAspect: [5, 4] as [number, number] };
    expect(studioAspect(settings)).toBe(1.25);
    expect(outputSize(settings)).toEqual({ width: 1350, height: 1080 });
  });
  it("supports square and cinematic framing", () => {
    expect(outputSize({ ...defaultSettings, aspect: "1:1" })).toEqual({ width: 1080, height: 1080 });
    expect(outputSize({ ...defaultSettings, aspect: "21:9" })).toEqual({ width: 2520, height: 1080 });
  });
});