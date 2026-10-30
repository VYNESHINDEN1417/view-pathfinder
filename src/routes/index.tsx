import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Airboat — 3D Inspection Viewer" },
      { name: "description", content: "Interactive Rust + WebGPU inspection viewer for the airboat model." },
      { property: "og:title", content: "Airboat — 3D Inspection Viewer" },
      { property: "og:description", content: "Interactive Rust + WebGPU inspection viewer for the airboat model." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MODEL_DIR = "/models/";
const MODEL = "airboat.obj";

function Index() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
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
      const mod = await import("@/lib/wasm/viewer/viewer");
      await mod.default();
      const text = (u: string) => fetch(u).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      const obj = await text(MODEL_DIR + MODEL);
      const lib = /^mtllib\s+(.+)$/m.exec(obj)?.[1]?.trim();
      const mtl = lib ? await text(MODEL_DIR + lib.replace(/^\.\//, "")) : "";
      if (disposed) return;
      sizeCanvas();
      try {
        viewer = await mod.Viewer.create(canvas, obj, mtl);
      } catch (e) {
        console.warn("Viewer unavailable:", e);
        return;
      }
      if (disposed) {
        viewer.free();
        return;
      }
      const v = viewer;
      const s = sizeCanvas();
      v.resize(s.w, s.h, s.cw, s.ch);
      v.reset();
      schedule();

      for (const name of v.texture_names()) {
        fetch(MODEL_DIR + name)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((b) => {
            if (viewer) {
              viewer.set_texture(name, new Uint8Array(b));
              schedule();
            }
          })
          .catch(() => console.warn("Texture missing:", name));
      }

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
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
      viewer?.destroy();
      viewer = null;
    };
  }, []);

  return <canvas ref={ref} className="viewer-canvas" />;
}
