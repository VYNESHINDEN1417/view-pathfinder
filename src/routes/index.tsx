import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { ViewerGizmo } from "@/components/viewer-gizmo";
import { LoadingTracker, downloadAsset, materialTextures, textureCandidates, type LoadingState } from "@/lib/viewer-loading";
import replacements from "@/assets/texture-replacements.json";
import { ViewerControls } from "@/components/viewer-controls";
import { DEFAULT_BRIGHTNESS } from "@/lib/viewer-settings";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VYNESHINDEN — 3D Ship Viewer" },
      { name: "description", content: "Explore the Iowa ship with precise XYZ navigation, crisp Minecraft textures and lightweight shadows." },
      { property: "og:title", content: "VYNESHINDEN — 3D Ship Viewer" },
      { property: "og:description", content: "Explore the Iowa ship with precise XYZ navigation, crisp Minecraft textures and lightweight shadows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MODEL_DIR = "/models/";
const MODEL = "Iowaaa.obj";

function Index() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<import("@/lib/wasm/viewer/viewer").Viewer | null>(null);
  const scheduleRef = useRef<() => void>(() => {});
  const [rotation, setRotation] = useState<number[]>([0, 0, 0, 1]);
  const [attempt, setAttempt] = useState(0);
  const [background, setBackground] = useState(0);
  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS);
  const [orthographic, setOrthographic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const settingsRef = useRef({ background, brightness, orthographic });
  useEffect(() => {
    settingsRef.current = { background, brightness, orthographic };
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.set_background(background);
    viewer.set_light(brightness);
    viewer.set_orthographic(orthographic);
    scheduleRef.current();
  }, [background, brightness, orthographic]);
  const [loading, setLoading] = useState<LoadingState>({ progress: 0, status: "Loading model...", indeterminate: true, ready: false });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const controller = new AbortController();
    setLoading({ progress: 0, status: "Loading model...", indeterminate: true, ready: false });
    let disposed = false;
    let viewer: import("@/lib/wasm/viewer/viewer").Viewer | null = null;
    let raf = 0;
    const cleanups: Array<() => void> = [];

    const schedule = () => {
      if (!raf && viewer)
        raf = requestAnimationFrame((time) => {
          raf = 0;
          if (!viewer) return;
          viewer.animate(time);
          viewer.frame();
          setRotation(Array.from(viewer.camera_rotation()));
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
      const obj = new TextDecoder().decode(await bytes(MODEL_DIR + MODEL, "obj", "Loading model..."));
      const lib = /^mtllib\s+(.+)$/m.exec(obj)?.[1]?.trim();
      const mtl = lib ? new TextDecoder().decode(await bytes(MODEL_DIR + lib.replace(/^\.\//, ""), "mtl", "Loading materials...")) : "";
      const names = materialTextures(mtl);
      if (!lib) tracker.update("mtl", 1, 1, "Preparing viewer...");
      tracker.addTextureTasks(names);
      // Download while Rust prepares geometry; decoded uploads begin only after initialization.
      const downloads = new Map(names.map((name) => [name, (async () => {
        const candidates = textureCandidates(name, replacements, MODEL_DIR);
        for (const url of candidates) {
          try { return { data: await bytes(url, "download:" + name, "Loading textures..."), url }; }
          catch (error) { if (controller.signal.aborted) throw error; }
        }
        throw new Error("A required texture could not be downloaded. Please retry.");
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
      v.set_background(settingsRef.current.background);
      v.set_light(settingsRef.current.brightness);
      v.set_orthographic(settingsRef.current.orthographic);
      for (const name of v.texture_names()) {
        const pending = downloads.get(name);
        if (!pending) continue;
        const result = await pending;
        if (disposed) return;
        tracker.update("decode:" + name, 0, 0, "Decoding and uploading textures...");
        // Paint stage state before the synchronous decoder runs; this is not simulated progress.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        let valid = v.set_texture(name, result.data);
        const fallback = textureCandidates(name, {}, MODEL_DIR)[0];
        if (!valid && fallback && result.url !== fallback) {
          const original = await bytes(fallback, "download:" + name, "Loading original texture...");
          if (disposed) return;
          valid = v.set_texture(name, original);
        }
        if (!valid) throw new Error("A texture image is invalid. Please retry with the original assets.");
        tracker.update("decode:" + name, 1, 1, "Preparing viewer...");
      }
      if (disposed) return;
      v.frame();
      setRotation(Array.from(v.camera_rotation()));
      tracker.update("ready", 1, 1, "Viewer ready");
      tracker.ready();

      const on = <K extends keyof HTMLElementEventMap>(
        t: K,
        f: (e: HTMLElementEventMap[K]) => void,
        o?: AddEventListenerOptions,
      ) => {
        canvas.addEventListener(t, f as EventListener, o);
        cleanups.push(() => canvas.removeEventListener(t, f as EventListener, o));
      };
      on("pointerdown", (e) => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        v.pointer_down(e.pointerId, e.clientX, e.clientY, e.pointerType === "mouse" ? e.button : 0);
      });
      on("pointermove", (e) => {
        v.pointer_move(e.pointerId, e.clientX, e.clientY);
        if (v.needs_redraw()) schedule();
      });
      on("pointerup", (e) => {
        const r = v.pointer_up(e.pointerId, e.clientX, e.clientY, performance.now());
        if (r === 1 && !document.fullscreenElement) {
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
      on("pointercancel", (e) => v.pointer_cancel(e.pointerId));
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
  }, [attempt]);

  const saveImage = async () => {
    const viewer = viewerRef.current;
    if (!viewer || saving) return;
    setSaving(true); setCaptureError("");
    try {
      // Rust draws only the model and chosen background, never any DOM controls.
      const png = await viewer.capture_png() as Uint8Array;
      const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
      const link = document.createElement("a");
      link.href = url; link.download = `VYNESHINDEN-${orthographic ? "orthographic" : "perspective"}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setCaptureError("Image could not be saved. Please try again.");
    } finally { setSaving(false); }
  };

  return <main className={`ship-viewer background-${background}`} data-scene-ready={loading.ready ? "true" : undefined}>
    <canvas ref={ref} className="viewer-canvas" aria-label="Interactive Iowa ship" />
    {loading.ready && <ViewerGizmo rotation={rotation}
      onOrbit={(dx, dy) => { viewerRef.current?.orbit_drag(dx, dy); scheduleRef.current(); }}
      onSnap={([x, y, z]) => { viewerRef.current?.snap_direction(x, y, z, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? performance.now() - 280 : performance.now()); scheduleRef.current(); }} />}
    {loading.ready && <ViewerControls background={background} brightness={brightness} orthographic={orthographic}
      saving={saving} error={captureError} onBackground={setBackground} onBrightness={setBrightness}
      onProjection={() => setOrthographic((value) => !value)} onSave={() => void saveImage()} />}
    <div className={`loading-overlay ${loading.ready ? "loading-complete" : ""}`} aria-live="polite">
      {!loading.error && <div className={`loader ${loading.indeterminate ? "loader-indeterminate" : ""}`} role="progressbar"
        aria-label="Loading ship" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loading.indeterminate ? undefined : Math.floor(loading.progress * 100)}
        style={{ "--remaining": `${100 - loading.progress * 100}%` } as CSSProperties} />}
      <p>{loading.error ?? loading.status}</p>
      {loading.error && <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
    </div>
  </main>;
}
