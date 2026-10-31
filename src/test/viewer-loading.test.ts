import { describe, expect, it } from "vitest";
import { LoadingTracker, isGizmoDrag, materialTextures, textureCandidates, type LoadingState } from "@/lib/viewer-loading";

describe("Viewer upgrade rules", () => {
  it("requires six pixels of movement before gizmo dragging", () => {
    expect(isGizmoDrag(5, 0)).toBe(false);
    expect(isGizmoDrag(6, 0)).toBe(true);
  });
  it("retains the original texture after an external replacement", () => {
    expect(textureCandidates("tex/stone.png", { "tex/stone.png": { url: "/replacement.png", source: "stone.png", fallback: "/models/tex/stone.png", width: 16, height: 16 } }, "/models/")).toEqual(["/replacement.png", "/models/tex/stone.png"]);
    expect(textureCandidates("tex/missing.png", {}, "/models/")).toEqual(["/models/tex/missing.png"]);
  });
  it("counts actual completed work and only reaches readiness explicitly", () => {
    const states: LoadingState[] = [];
    const tracker = new LoadingTracker(["obj", "textures"], (state) => states.push(state));
    tracker.update("obj", 50, 100, "Downloading");
    expect(states.at(-1)?.progress).toBe(0.25);
    tracker.addTextureTasks(["stone"]);
    tracker.update("download:stone", 1, 1, "Textures");
    expect(states.at(-1)?.progress).toBe(0.5);
    tracker.update("decode:stone", 0, 0, "Decoding");
    expect(states.at(-1)?.indeterminate).toBe(true);
    expect(states.at(-1)?.ready).toBe(false);
    tracker.ready();
    expect(states.at(-1)?.progress).toBe(1);
    expect(states.at(-1)?.ready).toBe(true);
  });
  it("deduplicates all material texture references", () => {
    expect(materialTextures("map_Kd tex/stone.png\nmap_Kd tex/oak.png\nmap_Kd tex/stone.png")).toEqual(["tex/oak.png", "tex/stone.png"]);
  });
});