import { describe, expect, it } from "vitest";
import { BACKGROUNDS, DEFAULT_BRIGHTNESS } from "@/lib/viewer-settings";

describe("Viewer settings", () => {
  it("increases the initial scene exposure above the previous 1.0", () => {
    expect(DEFAULT_BRIGHTNESS).toBe(1.5);
    expect(DEFAULT_BRIGHTNESS).toBeGreaterThan(1);
  });
  it("offers all four requested renderer backgrounds", () => {
    expect(BACKGROUNDS.map((option) => option.id)).toEqual([0, 1, 2, 3]);
    expect(BACKGROUNDS.map((option) => option.swatch)).toEqual(["grey", "white", "green", "transparent"]);
  });
});