import { describe, expect, it } from "vitest";
import { BACKGROUNDS, DEFAULT_BRIGHTNESS } from "@/lib/viewer-settings";

describe("Viewer settings", () => {
  it("starts the brightness slider at approximately 73%", () => {
    expect(DEFAULT_BRIGHTNESS).toBe(2.25);
    expect((DEFAULT_BRIGHTNESS - 0.25) / (3 - 0.25)).toBeCloseTo(0.73, 2);
  });
  it("offers the configured renderer backgrounds", () => {
    expect(BACKGROUNDS.map((option) => option.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(BACKGROUNDS.map((option) => option.swatch)).toEqual(["grey", "white", "green", "transparent", "warm", "rusty"]);
    expect(BACKGROUNDS.at(-1)).toMatchObject({ id: 5, label: "RUSTY", swatch: "rusty" });
  });
});