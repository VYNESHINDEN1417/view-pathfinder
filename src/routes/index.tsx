import { VideoRecorder } from "@/components/video-recorder";
import { BASIC_SCENE_MTL, BASIC_SCENE_OBJ } from "@/lib/basic-scene";
import { exportFilename } from "@/lib/export-filename";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { ViewerGizmo } from "@/components/viewer-gizmo";
import { LoadingTracker, downloadAsset, materialTextures, type LoadingState } from "@/lib/viewer-loading";
import { localTexture, readModelArchive, type ModelArchive } from "@/lib/model-archive";
import { ViewerControls } from "@/components/viewer-controls";
import { ASPECTS, DEFAULT_BRIGHTNESS, captureSize, parseRatio } from "@/lib/viewer-settings";
import type { ShadowComponents, ViewerOptions } from "@/components/viewer-controls";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VYNESHINDEN — 3D Ship Viewer" },
      { name: "description", content: "Explore the Wisconsin and Iowa battleships with precise XYZ navigation, crisp Minecraft textures and lightweight shadows." },
      { property: "og:title", content: "VYNESHINDEN — 3D Ship Viewer" },
      { property: "og:description", content: "Explore the Wisconsin and Iowa battleships with precise XYZ navigation, crisp Minecraft textures and lightweight shadows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MODEL_DIR = "/models/";
export const BUILT_IN_MODELS = [
  { id: "wisconsin", name: "Wisconsin", obj: "/models/wisconsin/Wisconsin.obj", mtl: "/models/wisconsin/Wisconsin.mtl", dir: "/models/" },
  { id: "iowa", name: "Iowa", obj: "/models/Iowaaa.obj", mtl: "", dir: "/models/" },
] as const;
type BuiltInId = (typeof BUILT_IN_MODELS)[number]["id"];
const FALLBACK_TEXTURE = localTexture("stone");

const BACKGROUND_IMAGES: Record<number, { url: string; name: string }> = {
  4: { url: "/backgrounds/3untitled.png", name: "Warm" },
  5: { url: "/backgrounds/IMG_20261117_190830_478.png", name: "RUSTY" },
};
const backgroundImageCache = new Map<number, Promise<Uint8Array>>();
let backgroundRequest = 0;


async function adjustTextureBrightness(bytes: Uint8Array, brightness: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return bytes; }
  context.filter = `brightness(${brightness})`;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : bytes;
}

function hueToRgb(hue: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const rgb: [number, number, number] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return rgb;
}

function isIronTrapdoorTexture(name: string) {
  return /(?:iron|pale_oak)_trapdoor/i.test(name);
}

async function applyViewerBackground(viewer: import("@/lib/wasm/viewer/viewer").Viewer, mode: number) {
  const request = ++backgroundRequest;
  const image = BACKGROUND_IMAGES[mode];
  if (!image) { viewer.set_background(mode); return; }

  // Keep the canvas transparent while the selected image loads, avoiding a flash
  // of the previously selected image when switching between image backgrounds.
  viewer.set_background(3);
  let cached = backgroundImageCache.get(mode);
  if (!cached) {
    cached = (async () => {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`${image.name} background image could not be loaded.`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    backgroundImageCache.set(mode, cached);
  }

  const bytes = await cached;
  if (request !== backgroundRequest) return;
  if (!viewer.set_background_image(bytes)) throw new Error(`${image.name} background image could not be decoded.`);
  viewer.set_background(4);
}

function Index() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<import("@/lib/wasm/viewer/viewer").Viewer | null>(null);
  const scheduleRef = useRef<() => void>(() => {});
  const [rotation, setRotation] = useState<number[]>([0, 0, 0, 1]);
  const sunShadowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [model, setModel] = useState<ModelArchive | null>(null);
  const [builtInId, setBuiltInId] = useState<BuiltInId>("wisconsin");
  const [sceneSelected, setSceneSelected] = useState(false);
  const [emptyScene, setEmptyScene] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [sun, setSun] = useState({ azimuth: 32.47, elevation: 50.81, intensity: 1 });
  const [blueLight, setBlueLight] = useState({ azimuth: 90, brightness: 1, intensity: 0.72, hue: 220, range: 1.05 });
  const [blueLightPanelOpen, setBlueLightPanelOpen] = useState(false);
  const [blueLightEnabled, setBlueLightEnabled] = useState(false);
  const [aoV2Enabled, setAoV2Enabled] = useState(false);
  const [options, setOptions] = useState<ViewerOptions>({ background: 4, aspect: "fill", custom: [16, 9], resolution: 0, shadowMode: 1, shadowQuality: 1024, fancy: true, fancyQuality: 1 });
  const background = options.background;
  const ratio = options.aspect === "custom" ? parseRatio(options.custom[0], options.custom[1]) : (ASPECTS.find((a) => a.id === options.aspect)?.ratio ?? 0);
  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS);
  const [ironTrapdoorBrightness, setIronTrapdoorBrightness] = useState(0.73);
  const ironTrapdoorBrightnessRef = useRef(0.73);
  const ironTrapdoorOriginalsRef = useRef(new Map<string, Uint8Array>());
  const ironTrapdoorRevisionRef = useRef(0);
  const [shadowStrength, setShadowStrength] = useState(1);
  const [shadowComponents, setShadowComponents] = useState<ShadowComponents>({ directional: 1, contact: 1, overhang: 1, edge: 1, ambient: 1 });
  const [orthographic, setOrthographic] = useState(false);
  const [studioLayout, setStudioLayout] = useState({ open: false, ratio: 9 / 16 });
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const settingsRef = useRef({ background, brightness, shadowStrength, shadowComponents, orthographic, options, sun, blueLight, blueLightEnabled, aoV2Enabled });
  useEffect(() => {
    settingsRef.current = { background, brightness, shadowStrength, shadowComponents, orthographic, options, sun, blueLight, blueLightEnabled, aoV2Enabled };
    const viewer = viewerRef.current;
    if (!viewer) return;
    const target = viewer;
    void applyViewerBackground(target, background).then(() => {
      if (viewerRef.current === target) scheduleRef.current();
    }).catch((error) => {
      console.warn("Background image failed:", error);
      if (viewerRef.current === target) { target.set_background(0); scheduleRef.current(); }
    });
    viewer.set_light(brightness);
    viewer.set_shadow_strength(shadowStrength);
    viewer.set_shadow_components(shadowComponents.directional, shadowComponents.contact, shadowComponents.overhang, shadowComponents.edge, shadowComponents.ambient);
    viewer.set_orthographic(orthographic);
    viewer.set_shadow_mode(options.shadowMode);
    viewer.set_shadow_quality(options.shadowQuality);
    viewer.set_sun(sun.azimuth, sun.elevation, sun.intensity);
    // Keep sun movement on the fast lighting path while dragging. Rebuild the
    // expensive cached shadow map once the user's adjustment has settled.
    if (sunShadowTimerRef.current) clearTimeout(sunShadowTimerRef.current);
    sunShadowTimerRef.current = setTimeout(() => {
      if (viewerRef.current === target) {
        target.refresh_sun_shadow();
        scheduleRef.current();
      }
    }, 120);
    const [red, green, blue] = hueToRgb(blueLight.hue);
    viewer.set_point_light(blueLight.azimuth, blueLight.brightness, blueLight.intensity, red, green, blue, blueLight.range);
    viewer.set_point_light_enabled(blueLightEnabled);
    viewer.set_point_orbit_visible(blueLightPanelOpen);
    viewer.set_fancy(options.fancy, options.fancyQuality);
    viewer.set_ao_v2_enabled(aoV2Enabled);
    scheduleRef.current();
  }, [background, brightness, shadowStrength, shadowComponents, orthographic, options, sun, blueLight, blueLightEnabled, blueLightPanelOpen, aoV2Enabled]);
  const [loading, setLoading] = useState<LoadingState>({ progress: 0, status: "Loading model...", indeterminate: true, ready: false });

  useEffect(() => {
    if (!sceneSelected) return;
    const canvas = ref.current;
    if (!canvas) return;
    const controller = new AbortController();
    setLoading({ progress: 0, status: "Loading model...", indeterminate: true, ready: false });
    let disposed = false;
    let viewer: import("@/lib/wasm/viewer/viewer").Viewer | null = null;
    let raf = 0;
    let lastRotation = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    const cleanups: Array<() => void> = [];
    ironTrapdoorOriginalsRef.current.clear();
    ironTrapdoorRevisionRef.current += 1;

    const schedule = () => {
      if (!raf && viewer)
        raf = requestAnimationFrame((time) => {
          raf = 0;
          if (!viewer) return;
          viewer.animate(time);
          viewer.frame();
          const nextRotation = Array.from(viewer.camera_rotation());
          if (nextRotation.some((value, index) => Math.abs(value - lastRotation[index]) > 1e-5)) {
            lastRotation = nextRotation;
            setRotation(nextRotation);
          }
          if (viewer.animating() || viewer.needs_redraw()) schedule();
        });
    };
    scheduleRef.current = schedule;
    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      canvas.width = w;
      canvas.height = h;
      return { w, h, cw: r.width, ch: r.height };
    };

    (async () => {
      const notify = (state: LoadingState) => { if (!disposed) setLoading(state); };
      const tracker = new LoadingTracker(["wasm", "obj", "mtl", "renderer", "parse", "geometry", "upload", "textures", "ready"], notify);
      const bytes = (url: string, key: string, label: string) => downloadAsset(url, controller.signal, (done, total) => tracker.update(key, done, total, label));
      const mod = await import("@/lib/wasm/viewer/viewer");
      const wasm = await bytes("/wasm/viewer_bg.wasm", "wasm", "Loading viewer...");
      await mod.default({ module_or_path: wasm.buffer as ArrayBuffer });
      const builtIn = BUILT_IN_MODELS.find((m) => m.id === builtInId) ?? BUILT_IN_MODELS[0];
      const obj = emptyScene ? BASIC_SCENE_OBJ : model?.obj ?? new TextDecoder().decode(await bytes(builtIn.obj, "obj", "Loading model..."));
      if (model) tracker.update("obj", 1, 1, "Reading model...");
      const lib = /^mtllib\s+(.+)$/m.exec(obj)?.[1]?.trim();
      const mtlUrl = builtIn.mtl || (lib ? MODEL_DIR + lib.replace(/^\.\//, "") : "");
      const mtl = emptyScene ? BASIC_SCENE_MTL : model ? model.mtl : mtlUrl ? new TextDecoder().decode(await bytes(mtlUrl, "mtl", "Loading materials...")) : "";
      if (model) tracker.update("mtl", 1, 1, "Reading materials...");
      const names = materialTextures(mtl);
      if (!lib) tracker.update("mtl", 1, 1, "Preparing viewer...");
      tracker.addTextureTasks(names);
      // Download while Rust prepares geometry; decoded uploads begin only after initialization.
      const downloads = new Map(names.map((name) => [name, (async () => {
        const packed = model?.textures.get(name);
        if (packed) {
          tracker.update("download:" + name, 1, 1, "Reading ZIP textures...");
          return { data: packed, url: "zip" };
        }
        const local = localTexture(name);
        // Unknown blocks use a neutral stone tile rather than untextured white.
        const candidates = [...new Set([local, model ? undefined : builtIn.dir + name, FALLBACK_TEXTURE].filter((url): url is string => Boolean(url)))];
        for (const url of candidates) {
          try { return { data: await bytes(url, "download:" + name, "Loading textures..."), url }; }
          catch (error) { if (controller.signal.aborted) throw error; }
        }
        tracker.update("download:" + name, 1, 1, "Using material colors...");
        return null;
      })()]));
      // Observe early rejected downloads until their upload stage is reached.
      for (const task of downloads.values()) void task.catch(() => {});
      if (disposed) return;
      sizeCanvas();
      const stageLabels: Record<string, string> = { renderer: "Initializing renderer...", parse: "Parsing model...", geometry: "Preparing geometry...", upload: "Uploading geometry..." };
      const created = await mod.Viewer.create(canvas, obj, mtl, (stage: string, done: number, total: number) => tracker.update(stage, done, total, stageLabels[stage] ?? "Preparing viewer..."));
      if (disposed) { created.destroy(); return; }
      viewer = created;
      viewerRef.current = created;
      const v = created;
      const s = sizeCanvas();
      v.resize(s.w, s.h, s.cw, s.ch);
      v.reset();
      await applyViewerBackground(v, settingsRef.current.background).catch((error) => {
        console.warn("Background setup failed:", error);
        v.set_background(0);
      });
      v.set_light(settingsRef.current.brightness);
      v.set_shadow_strength(settingsRef.current.shadowStrength);
      v.set_shadow_components(settingsRef.current.shadowComponents.directional, settingsRef.current.shadowComponents.contact, settingsRef.current.shadowComponents.overhang, settingsRef.current.shadowComponents.edge, settingsRef.current.shadowComponents.ambient);
      v.set_orthographic(settingsRef.current.orthographic);
      v.set_shadow_mode(settingsRef.current.options.shadowMode);
      v.set_shadow_quality(settingsRef.current.options.shadowQuality);
      v.set_sun(settingsRef.current.sun.azimuth, settingsRef.current.sun.elevation, settingsRef.current.sun.intensity);
      const initialBlueLight = settingsRef.current.blueLight;
      const [blueRed, blueGreen, blueBlue] = hueToRgb(initialBlueLight.hue);
      v.set_point_light(initialBlueLight.azimuth, initialBlueLight.brightness, initialBlueLight.intensity, blueRed, blueGreen, blueBlue, initialBlueLight.range);
      v.set_point_light_enabled(settingsRef.current.blueLightEnabled);
      v.set_point_orbit_visible(false);
      v.set_fancy(settingsRef.current.options.fancy, settingsRef.current.options.fancyQuality);
      v.set_ao_v2_enabled(settingsRef.current.aoV2Enabled);
      for (const name of v.texture_names()) {
        const pending = downloads.get(name);
        if (!pending) continue;
        const result = await pending;
        if (disposed) return;
        if (!result) { tracker.update("decode:" + name, 1, 1, "Using material colors..."); continue; }
        tracker.update("decode:" + name, 0, 0, "Decoding and uploading textures...");
        // Paint stage state before the synchronous decoder runs; this is not simulated progress.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const isIronTrapdoor = isIronTrapdoorTexture(name);
        if (isIronTrapdoor) ironTrapdoorOriginalsRef.current.set(name, result.data);
        const initialTexture = isIronTrapdoor
          ? await adjustTextureBrightness(result.data, ironTrapdoorBrightnessRef.current)
          : result.data;
        let valid = v.set_texture(name, initialTexture);
        const fallback = model ? localTexture(name) : MODEL_DIR + name;
        if (!valid && fallback && result.url !== fallback) {
          const original = await bytes(fallback, "download:" + name, "Loading original texture...");
          if (disposed) return;
          if (isIronTrapdoor) ironTrapdoorOriginalsRef.current.set(name, original);
          const fallbackTexture = isIronTrapdoor
            ? await adjustTextureBrightness(original, ironTrapdoorBrightnessRef.current)
            : original;
          valid = v.set_texture(name, fallbackTexture);
        }
        // Unknown custom textures retain MTL diffuse colors.
        tracker.update("decode:" + name, 1, 1, "Preparing viewer...");
      }
      if (disposed) return;
      v.frame();
      setRotation(Array.from(v.camera_rotation()));
      tracker.update("ready", 1, 1, "Viewer ready");
      tracker.ready();

      // The stage covers the full preview area, including letterbox bars around the
      // aspect-ratio canvas. Route gestures through it so those bars remain draggable.
      const inputSurface = canvas.parentElement ?? canvas;
      const tapOrigins = new Map<number, boolean>();
      const on = <K extends keyof HTMLElementEventMap>(
        t: K,
        f: (e: HTMLElementEventMap[K]) => void,
        o?: AddEventListenerOptions,
      ) => {
        inputSurface.addEventListener(t, f as EventListener, o);
        cleanups.push(() => inputSurface.removeEventListener(t, f as EventListener, o));
      };
      on("pointerdown", (e) => {
        e.preventDefault();
        tapOrigins.set(e.pointerId, e.target === canvas);
        inputSurface.setPointerCapture(e.pointerId);
        v.pointer_down(e.pointerId, e.clientX, e.clientY, e.pointerType === "mouse" ? e.button : 0);
      });
      on("pointermove", (e) => {
        v.pointer_move(e.pointerId, e.clientX, e.clientY);
        if (v.needs_redraw()) schedule();
      });
      on("pointerup", (e) => {
        const startedOnCanvas = tapOrigins.get(e.pointerId) === true;
        tapOrigins.delete(e.pointerId);
        const r = v.pointer_up(e.pointerId, e.clientX, e.clientY, performance.now());
        if (r === 1 && startedOnCanvas && !document.fullscreenElement) {
          const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          try {
            const p = el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.();
            if (p instanceof Promise) p.catch(() => {});
          } catch {
            /* fullscreen unavailable: viewer keeps working */
          }
        }
        schedule();
      });
      on("pointercancel", (e) => { tapOrigins.delete(e.pointerId); v.pointer_cancel(e.pointerId); });
      on("wheel", (e) => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        v.wheel(e.deltaY * k);
        schedule();
      }, { passive: false });
      on("contextmenu", (e) => e.preventDefault());
      on("touchstart", (e) => e.preventDefault(), { passive: false });
      const block = (e: Event) => e.preventDefault();
      document.addEventListener("gesturestart", block);
      cleanups.push(() => document.removeEventListener("gesturestart", block));

      const ro = new ResizeObserver(() => {
        const s = sizeCanvas();
        v.resize(s.w, s.h, s.cw, s.ch);
        schedule();
      });
      ro.observe(canvas);
      cleanups.push(() => ro.disconnect());
    })().catch((error: unknown) => {
      if (disposed) return;
      controller.abort();
      cleanups.forEach((cleanup) => cleanup());
      viewer?.destroy(); viewer = null; viewerRef.current = null;
      console.warn("Viewer loading failed:", error);
      setLoading((state) => ({ ...state, ready: false, indeterminate: false, error: error instanceof Error ? error.message : "Your browser could not start the 3D viewer. Enable graphics acceleration and retry." }));
    });

    return () => {
      disposed = true;
      controller.abort();
      viewerRef.current = null;
      scheduleRef.current = () => {};
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
      viewer?.destroy();
      viewer = null;
    };
  }, [attempt, model, builtInId, sceneSelected, emptyScene]);

  const applyIronTrapdoorBrightness = async (value: number) => {
    setIronTrapdoorBrightness(value);
    ironTrapdoorBrightnessRef.current = value;
    const revision = ++ironTrapdoorRevisionRef.current;
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const [name, original] of ironTrapdoorOriginalsRef.current) {
      const adjusted = await adjustTextureBrightness(original, value);
      if (revision !== ironTrapdoorRevisionRef.current || viewerRef.current !== viewer) return;
      viewer.set_texture(name, adjusted);
    }
    viewer.frame();
    scheduleRef.current();
  };

  const uploadModel = async (file: File) => {
    setUploading(true); setUploadError("");
    try {
      const archive = await readModelArchive(file, () => {});
      setAttempt((value) => value + 1); setModel(archive); setEmptyScene(false); setSceneSelected(true);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "This model could not be opened."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const saveImage = async () => {
    const viewer = viewerRef.current;
    if (!viewer || saving) return;
    setSaving(true); setCaptureError("");
    try {
      // Rust draws only the model and chosen background, never any DOM controls.
      const canvas = ref.current;
      const r = studioLayout.open ? studioLayout.ratio : ratio || (canvas ? canvas.clientWidth / Math.max(1, canvas.clientHeight) : 1);
      const size = captureSize(r, options.resolution);
      const png = await viewer.capture_png(size.width, size.height) as Uint8Array;
      const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${exportFilename(model?.name ?? (emptyScene ? "Basic scene" : BUILT_IN_MODELS.find((m) => m.id === builtInId)?.name) ?? "VYNESHINDEN", "img")}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setCaptureError("Image could not be saved. Please try again.");
    } finally { setSaving(false); }
  };

  const frameRatio = studioLayout.open ? studioLayout.ratio : ratio;
  return <main className={`ship-viewer background-${background} ${studioLayout.open ? "studio-open" : ""}`} data-scene-ready={loading.ready ? "true" : undefined}>
    <input ref={fileRef} type="file" accept=".zip,application/zip" hidden aria-label="Upload model ZIP"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadModel(file); }} />
    {!sceneSelected && <div className="scene-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="scene-picker-title">
      <div className="scene-picker">
        <div className="scene-picker-mark">V</div>
        <p className="scene-picker-eyebrow">PATHFINDER 3D VIEWER</p>
        <h1 id="scene-picker-title">Choose your scene</h1>
        <p className="scene-picker-description">Start with a ship, bring your own model, or open an empty workspace.</p>
        <div className="scene-picker-options">
          <Button className="scene-picker-option scene-picker-upload" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <span className="scene-picker-option-icon">↑</span><span><strong>{uploading ? "Preparing model..." : "Add your own model"}</strong><small>Upload a model ZIP with its textures</small></span>
          </Button>
          <Button className="scene-picker-option" variant="secondary" onClick={() => { setModel(null); setEmptyScene(false); setBuiltInId("wisconsin"); setSceneSelected(true); setAttempt((value) => value + 1); }}>
            <span className="scene-picker-option-icon">W</span><span><strong>Wisconsin</strong><small>USS Wisconsin · BB-64</small></span>
          </Button>
          <Button className="scene-picker-option" variant="secondary" onClick={() => { setModel(null); setEmptyScene(false); setBuiltInId("iowa"); setSceneSelected(true); setAttempt((value) => value + 1); }}>
            <span className="scene-picker-option-icon">I</span><span><strong>Iowa</strong><small>USS Iowa · BB-61</small></span>
          </Button>
          <Button className="scene-picker-option" variant="secondary" onClick={() => { setModel(null); setEmptyScene(true); setSceneSelected(true); setAttempt((value) => value + 1); }}>
            <span className="scene-picker-option-icon">＋</span><span><strong>Basic scene</strong><small>A classic Minecraft grass block in a clean workspace</small></span>
          </Button>
        </div>
        {uploadError && <p className="scene-picker-error" role="alert">{uploadError}</p>}
      </div>
    </div>}
    <div className="viewer-stage" aria-label="Scene viewport">
      <canvas key={attempt} ref={ref} className={`viewer-canvas ${frameRatio ? "framed" : ""}`} style={{ "--frame-ratio": frameRatio || 1 } as CSSProperties} aria-label="Interactive model" />
    </div>
    {loading.ready && <ViewerGizmo rotation={rotation} sun={sun} onSun={(patch) => setSun((value) => ({ ...value, ...patch }))}
      onOrbit={(dx, dy) => { viewerRef.current?.orbit_drag(dx, dy); scheduleRef.current(); }}
      onSnap={([x, y, z]) => { viewerRef.current?.snap_direction(x, y, z, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? performance.now() - 280 : performance.now()); scheduleRef.current(); }}
      onTwist={(a) => { viewerRef.current?.roll(a); scheduleRef.current(); }} />}
    {loading.ready && <ViewerControls options={options} brightness={brightness} shadowStrength={shadowStrength} shadowComponents={shadowComponents} orthographic={orthographic} rotation={rotation}
      saving={saving} error={uploadError || captureError} uploading={uploading} customModel={Boolean(model)} sunIntensity={sun.intensity} blueLight={blueLight}
      onBlueLightChange={(patch) => setBlueLight((value) => ({ ...value, ...patch }))} blueLightEnabled={blueLightEnabled} onBlueLightEnabledChange={setBlueLightEnabled} blueLightPanelOpen={blueLightPanelOpen} onBlueLightPanelOpenChange={setBlueLightPanelOpen} aoV2Enabled={aoV2Enabled} onAoV2EnabledChange={setAoV2Enabled}
      onSunIntensity={(intensity) => setSun((value) => ({ ...value, intensity }))}
      onUpload={() => fileRef.current?.click()} models={BUILT_IN_MODELS.map(({ id, name }) => ({ id, name }))} activeModel={model ? "" : builtInId}
      onModel={(id) => { setModel(null); setEmptyScene(false); setBuiltInId(id as BuiltInId); setAttempt((value) => value + 1); }} onOptions={(patch) => setOptions((o) => ({ ...o, ...patch }))} onBrightness={setBrightness} onShadowStrength={setShadowStrength} onShadowComponents={(patch) => setShadowComponents((current) => ({ ...current, ...patch }))}
      onProjection={() => setOrthographic((value) => !value)} onSave={() => void saveImage()} />}
    {loading.ready && <VideoRecorder getViewer={() => viewerRef.current} getCanvas={() => ref.current} schedule={() => scheduleRef.current()}
      ironTrapdoorBrightness={ironTrapdoorBrightness} onIronTrapdoorBrightness={(value) => void applyIronTrapdoorBrightness(value)}
      shadowMode={options.shadowMode} blueLightPanelOpen={blueLightPanelOpen}
      onLayout={setStudioLayout}
      name={model?.name ?? (emptyScene ? "Basic scene" : BUILT_IN_MODELS.find((m) => m.id === builtInId)?.name) ?? "VYNESHINDEN"} />}
    {sceneSelected && <div className={`loading-overlay ${loading.ready ? "loading-complete" : ""}`} aria-live="polite">
      {!loading.error && <div className={`loader ${loading.indeterminate ? "loader-indeterminate" : ""}`} role="progressbar"
        aria-label="Loading ship" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loading.indeterminate ? undefined : Math.floor(loading.progress * 100)}
        style={{ "--remaining": `${100 - loading.progress * 100}%` } as CSSProperties} />}
      <p>{loading.error ?? loading.status}</p>
      {loading.error && <><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</Button><Button variant="secondary" onClick={() => { setModel(null); setBuiltInId("wisconsin"); setAttempt((value) => value + 1); }}>Restore Wisconsin</Button></>}
    </div>}
  </main>;
}
