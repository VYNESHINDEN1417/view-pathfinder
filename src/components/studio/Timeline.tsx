import { useEffect, useRef, useState } from "react";
import { Copy, Minus, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Keyframe } from "@/lib/studio/keyframes";

interface Props {
  keys: Keyframe[];
  duration: number;
  time: number;
  selected: string | null;
  locked: boolean;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemoveAtNeedle: () => void;
  onUpdate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function Timeline(p: Props) {
  const [zoom, setZoom] = useState(1);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [half, setHalf] = useState(160);
  const pxPerSec = 80 * zoom;
  const tapeWidth = p.duration * pxPerSec;
  const keyUnderNeedle = p.keys.find((k) => Math.abs(k.time - p.time) < 0.05);
  const labelEvery = p.duration > 20 / zoom ? 5 : 1;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHalf(el.clientWidth / 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While the user is swiping, the scroll position is the source of truth;
  // never write scrollLeft back (that fights momentum scrolling and stutters).
  const userScrolling = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef<number | null>(null);
  const seekRef = useRef(p.onSeek);
  seekRef.current = p.onSeek;

  // Keep the tape positioned so the current time sits under the fixed center needle.
  useEffect(() => {
    const el = scroller.current;
    if (!el || userScrolling.current) return;
    const target = p.time * pxPerSec;
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
  }, [p.time, pxPerSec, half]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const markUser = () => {
    userScrolling.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { userScrolling.current = false; }, 200);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el || p.locked) return;
    // Only treat as user scroll if it doesn't match the time we'd programmatically set.
    if (Math.abs(el.scrollLeft - p.time * pxPerSec) > 1) markUser();
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const t = Math.min(p.duration, Math.max(0, el.scrollLeft / pxPerSec));
      seekRef.current(t);
    });
  };

  return (
    <section aria-label="Timeline" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm"><span className="text-primary">{p.time.toFixed(2)}s</span><span className="text-muted-foreground"> / {p.duration}s · {p.keys.length} keys</span></p>
        <div className="flex gap-2">
          <button className="studio-btn" aria-label="Zoom timeline out" onClick={() => setZoom((z) => Math.max(0.2, z / 1.4))}>−</button>
          <button className="studio-btn" aria-label="Zoom timeline in" onClick={() => setZoom((z) => Math.min(5, z * 1.4))}>+</button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          className={`rounded-xl border border-border bg-muted overscroll-x-contain ${p.locked ? "overflow-hidden" : "overflow-x-auto"}`}
          style={{ touchAction: "pan-x", scrollbarWidth: "none" }}
          onTouchStart={(e) => { if (e.touches.length === 2) pinch.current = { d: Math.abs(e.touches[0]!.clientX - e.touches[1]!.clientX), z: zoom }; }}
          onTouchMove={(e) => {
            if (e.touches.length === 2 && pinch.current) {
              const d = Math.abs(e.touches[0]!.clientX - e.touches[1]!.clientX);
              setZoom(Math.min(5, Math.max(0.2, pinch.current.z * (d / (pinch.current.d || 1)))));
            }
          }}
          onTouchEnd={() => { pinch.current = null; }}
        >
          <div className="relative h-24" style={{ width: tapeWidth + half * 2 }}>
            <div className="absolute inset-y-0 rounded bg-background/40" style={{ left: half, width: tapeWidth }} />
            {Array.from({ length: Math.floor(p.duration) + 1 }).map((_, s) => (
              <div key={s} className={`pointer-events-none absolute top-0 border-l border-border ${s % labelEvery === 0 ? "h-full" : "h-3"}`} style={{ left: half + s * pxPerSec }}>
                {s % labelEvery === 0 && <span className="ml-1 font-mono text-xs text-muted-foreground">{s}s</span>}
              </div>
            ))}
            {p.keys.map((k) => {
              const sel = k.id === p.selected;
              return (
                <button key={k.id} disabled={p.locked}
                  aria-label={`Keyframe at ${k.time.toFixed(2)} seconds`} aria-pressed={sel}
                  onClick={() => p.onSelect(k.id)}
                  className={`absolute top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-2 transition active:scale-90 ${sel ? "z-10 border-primary bg-primary text-primary-foreground shadow-lg" : "border-muted-foreground/60 bg-secondary text-foreground"}`}
                  style={{ left: half + k.time * pxPerSec, marginTop: 8 }}>
                  <span className={`block h-4 w-4 rotate-45 ${sel ? "bg-primary-foreground" : "bg-primary"}`} />
                </button>
              );
            })}
          </div>
        </div>
        {/* Fixed center needle */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-0.5 -translate-x-1/2 bg-accent">
          <span className="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-accent" />
          {!p.locked && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-accent px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent-foreground">
              {keyUnderNeedle ? "on key" : `+ ${p.time.toFixed(2)}s`}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {keyUnderNeedle ? (
          <button className="studio-btn-danger flex-col !gap-0.5 py-2 text-xs" onClick={p.onRemoveAtNeedle} disabled={p.locked}><Minus className="size-5" />Remove</button>
        ) : (
          <button className="studio-btn-primary flex-col !gap-0.5 py-2 text-xs" onClick={p.onAdd} disabled={p.locked}><Plus className="size-5" />Add</button>
        )}
        <button className="studio-btn flex-col !gap-0.5 py-2 text-xs" onClick={p.onUpdate} disabled={p.locked || !p.selected}><RefreshCw className="size-5" />Update</button>
        <button className="studio-btn flex-col !gap-0.5 py-2 text-xs" onClick={p.onDuplicate} disabled={p.locked || !p.selected}><Copy className="size-5" />Duplicate</button>
        <button className="studio-btn-danger flex-col !gap-0.5 py-2 text-xs" onClick={p.onDelete} disabled={p.locked || !p.selected}><Trash2 className="size-5" />Delete</button>
      </div>
    </section>
  );
}
