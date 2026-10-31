import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { ViewerGizmo } from "@/components/viewer-gizmo";
import { LoadingTracker, downloadAsset, materialTextures, textureCandidates, type LoadingState } from "@/lib/viewer-loading";
import replacements from "@/assets/texture-replacements.json";

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
        raf = requestAnimationFrame(() => {
          raf = 0;
          viewer?.frame();
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
      let tracker = new LoadingTracker(["wasm", "obj", "mtl"], notify);
      const bytes = (url: string, key: string, label: string) => downloadAsset(url, controller.signal, (done, total) => tracker.update(key, done, total, label));
      const mod = await import("@/lib/wasm/viewer/viewer");
      const wasm = await bytes("/wasm/viewer_bg.wasm", "wasm", "Loading viewer...");
      await mod.default({ module_or_path: wasm });
      const obj = new TextDecoder().decode(await bytes(MODEL_DIR + MODEL, "obj", "Loading model..."));
      const lib = /^mtllib\s+(.+)$/m.exec(obj)?.[1]?.trim();
      const mtl = lib ? new TextDecoder().decode(await bytes(MODEL_DIR + lib.replace(/^\.\//, ""), "mtl", "Loading materials...")) : "";
      const names = materialTextures(mtl);
      tracker = new LoadingTracker(["wasm", "obj", "mtl", "renderer", "parse", "geometry", "upload", ...names.flatMap((name) => ["download:" + name, "decode:" + name]), "ready"], notify);
      for (const key of ["wasm", "obj", "mtl"]) tracker.update(key, 1, 1, "Preparing viewer...");
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
      for (const name of v.texture_names()) {
        const pending = downloads.get(name);
        if (!pending) continue;
        const result = await pending;
        if (disposed) return;
        tracker.update("decode:" + name, 0, 0, "Decoding and uploading textures...");
        // Paint stage state before the synchronous decoder runs; this is not simulated progress.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        let valid = v.set_texture(name, result.data);
        if (!valid && result.url !== MODEL_DIR + name) {
          const original = await bytes(MODEL_DIR + name, "download:" + name, "Loading original texture...");
          if (disposed) return;
          valid = v.set_texture(name, original);
        }
        if (!valid) throw new Error("A texture image is invalid. Please retry with the original assets.");
        tracker.update("decode:" + name, 1, 1, "Preparing viewer...");
      }
      if (disposed) return;
      v.frame();
      setRotation(v.camera_rotation());
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

  return <main className="ship-viewer">
    <canvas ref={ref} className="viewer-canvas" aria-label="Interactive Iowa ship" />
    {loading.ready && <ViewerGizmo rotation={rotation}
      onOrbit={(dx, dy) => { viewerRef.current?.orbit_drag(dx, dy); scheduleRef.current(); }}
      onSnap={([x, y, z]) => { viewerRef.current?.snap_direction(x, y, z, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? performance.now() - 280 : performance.now()); scheduleRef.current(); }} />}
    <div className={`loading-overlay ${loading.ready ? "loading-complete" : ""}`} aria-live="polite">
      {!loading.error && <div className={`loader ${loading.indeterminate ? "loader-indeterminate" : ""}`} role="progressbar"
        aria-label="Loading ship" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loading.indeterminate ? undefined : Math.floor(loading.progress * 100)}
        style={{ "--remaining": `${100 - loading.progress * 100}%` } as CSSProperties} />}
      <p>{loading.error ?? loading.status}</p>
      {loading.error && <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
    </div>
  </main>;
}
