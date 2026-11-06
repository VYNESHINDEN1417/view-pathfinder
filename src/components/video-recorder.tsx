import { useEffect, useRef, useState } from "react";
import { Clapperboard, Diamond, Download, Film, Pause, Play, RotateCcw, Settings2, Square, Video, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/studio/Timeline";
import { SettingsPanel } from "@/components/studio/SettingsPanel";
import { defaultSettings, outputSize, studioAspect, bitrateBps, type StudioSettings } from "@/components/studio/settings";
import { sampleCamera, sortKeys, totalFrames, formatEta, uid, type Keyframe } from "@/lib/studio/keyframes";
import type { Viewer } from "@/lib/wasm/viewer/viewer";

type Tab = "animate" | "render" | "settings";
type RenderState = "idle" | "rendering" | "paused" | "done";

/** Orbit Studio overlay driving the Rust camera; video is encoded offline frame by frame, so heavy shading never drops frames. */
export function VideoRecorder({ getViewer, getCanvas, schedule, name, onLayout }: {
  getViewer: () => Viewer | null; getCanvas: () => HTMLCanvasElement | null; schedule: () => void; name: string;
  onLayout: (layout: { open: boolean; ratio: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("animate");
  const [settings, setSettings] = useState<StudioSettings>(defaultSettings);
  const [keys, setKeys] = useState<Keyframe[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [rs, setRs] = useState<RenderState>("idle");
  const [prog, setProg] = useState({ frame: 0, total: 0, fps: 0, eta: null as number | null });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ctrl = useRef({ paused: false, cancel: false });
  const keysRef = useRef(keys); keysRef.current = keys;
  const locked = rs === "rendering" || rs === "paused";
  const ratio = studioAspect(settings);
  useEffect(() => { onLayout({ open, ratio }); }, [open, ratio, onLayout]);
  useEffect(() => () => { ctrl.current.cancel = true; }, []);

  const pose = () => Array.from(getViewer()?.camera_pose() ?? []);
  const apply = (p: number[] | null) => { const v = getViewer(); if (p && v) { v.set_camera_pose(new Float32Array(p)); schedule(); } };
  const set = <K extends keyof StudioSettings>(k: K, v: StudioSettings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }));
    if (k === "duration") setTime((t) => Math.min(t, v as number));
  };
  const seek = (t: number) => { setTime(t); apply(sampleCamera(keysRef.current, t, settings.smoothing)); };

  const addKey = () => {
    const existing = keys.find((k) => Math.abs(k.time - time) < 0.05);
    if (existing) { setKeys(keys.map((k) => (k.id === existing.id ? { ...k, pose: pose() } : k))); setSelected(existing.id); return; }
    const k = { id: uid(), time, pose: pose() };
    setKeys(sortKeys([...keys, k])); setSelected(k.id);
  };
  const updateKey = () => selected && setKeys(keys.map((k) => (k.id === selected ? { ...k, pose: pose() } : k)));
  const duplicateKey = () => {
    const k = keys.find((x) => x.id === selected); if (!k) return;
    let t = Math.min(settings.duration, k.time + 0.5);
    while (keys.some((x) => Math.abs(x.time - t) < 0.05) && t < settings.duration) t = Math.min(settings.duration, t + 0.5);
    const d = { ...k, id: uid(), time: t };
    setKeys(sortKeys([...keys, d])); setSelected(d.id); setTime(t);
  };
  const deleteKey = () => { setKeys(keys.filter((k) => k.id !== selected)); setSelected(null); };
  const removeKeyAtNeedle = () => {
    const k = keys.find((x) => Math.abs(x.time - time) < 0.05); if (!k) return;
    setKeys(keys.filter((x) => x.id !== k.id)); if (selected === k.id) setSelected(null);
  };
  const selectKey = (id: string) => { setSelected(id); const k = keys.find((x) => x.id === id); if (k) { setTime(k.time); apply(k.pose); } };
  const zoom = (d: number) => { getViewer()?.wheel(d); schedule(); };

  useEffect(() => {
    if (!previewing) return;
    let raf = 0;
    const start = performance.now() - time * 1000;
    let lastUi = 0;
    const tick = (now: number) => {
      let t = (now - start) / 1000;
      if (t > settings.duration) {
        if (settings.loop) t %= settings.duration;
        else { seek(settings.duration); setPreviewing(false); return; }
      }
      // Move the camera every frame but refresh the panel only ~10x/s to keep heavy shading smooth.
      apply(sampleCamera(keysRef.current, t, settings.smoothing));
      if (now - lastUi > 100) { lastUi = now; setTime(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing]);
  const togglePreview = () => { if (keys.length < 2) return; if (!previewing && time >= settings.duration) seek(0); setPreviewing((p) => !p); };

  const startRender = async () => {
    const v = getViewer(), canvas = getCanvas();
    if (!v || !canvas || keys.length < 2) return;
    setPreviewing(false); setError("");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    const size = outputSize(settings);
    const width = size.width & ~1, height = size.height & ~1;
    const bitrate = bitrateBps[settings.bitrate];
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    let codec = "";
    if (typeof VideoEncoder !== "undefined")
      for (const c of ["avc1.640034", "avc1.4d0034", "avc1.42003e"]) {
        const ok = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate, framerate: settings.fps }).catch(() => null);
        if (ok?.supported) { codec = c; break; }
      }
    if (!codec) { setError("This browser can't encode video frame-by-frame. Try the latest Chrome, Edge or Safari."); return; }
    // Render the engine at exact output size; restore the live view afterwards.
    const prev = { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight };
    const restore = () => { v.resize(prev.w, prev.h, prev.cw, prev.ch); canvas.width = prev.w; canvas.height = prev.h; v.resize(prev.w, prev.h, prev.cw, prev.ch); schedule(); };
    canvas.width = width; canvas.height = height; v.resize(width, height, width, height);
    const total = totalFrames(settings.duration, settings.fps);
    ctrl.current = { paused: false, cancel: false };
    setRs("rendering"); setTab("render");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width, height, frameRate: settings.fps }, fastStart: "in-memory" });
    let encErr: unknown = null;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (er) => { encErr = er; } });
    enc.configure({ codec, width, height, bitrate, framerate: settings.fps });
    const us = 1e6 / settings.fps;
    let activeMs = 0, last = performance.now();
    for (let f = 0; f < total; f++) {
      if (ctrl.current.cancel || encErr) break;
      while (ctrl.current.paused && !ctrl.current.cancel) { await new Promise((r) => setTimeout(r, 100)); last = performance.now(); }
      if (ctrl.current.cancel) break;
      const t = f / settings.fps;
      const sampled = sampleCamera(keysRef.current, t, settings.smoothing);
      if (!sampled) break;
      v.set_camera_pose(new Float32Array(sampled));
      v.frame();
      const vf = new VideoFrame(canvas, { timestamp: Math.round(f * us), duration: Math.round(us) });
      enc.encode(vf, { keyFrame: f % (settings.fps * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      await new Promise((r) => setTimeout(r, 0));
      const now = performance.now(); activeMs += now - last; last = now;
      if (f % 3 === 0 || f === total - 1) {
        const fps = (f + 1) / (activeMs / 1000);
        setTime(t); setProg({ frame: f + 1, total, fps, eta: f > 5 ? (total - f - 1) / fps : null });
      }
    }
    restore();
    if (ctrl.current.cancel || encErr) {
      enc.close(); setRs("idle"); setProg({ frame: 0, total: 0, fps: 0, eta: null });
      if (encErr) setError("Video encoding failed. Try a lower resolution.");
      return;
    }
    await enc.flush(); enc.close(); muxer.finalize();
    setVideoUrl(URL.createObjectURL(new Blob([target.buffer], { type: "video/mp4" })));
    setRs("done");
  };
  const pauseResume = () => { ctrl.current.paused = !ctrl.current.paused; setRs(ctrl.current.paused ? "paused" : "rendering"); };
  const pct = prog.total ? Math.round((prog.frame / prog.total) * 100) : 0;
  const out = outputSize(settings);

  const viewportControls = (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      <button className="studio-btn-primary" onClick={addKey} disabled={locked}><Diamond className="size-5" />Keyframe</button>
      <button className="studio-btn" onClick={() => { getViewer()?.reset(); schedule(); }} disabled={locked}><RotateCcw className="size-5" />Reset</button>
      <button className="studio-btn" onClick={() => zoom(-120)} disabled={locked}><ZoomIn className="size-5" />Zoom in</button>
      <button className="studio-btn" onClick={() => zoom(120)} disabled={locked}><ZoomOut className="size-5" />Zoom out</button>
      <button className="studio-btn" data-active={previewing} onClick={togglePreview} disabled={locked || keys.length < 2}>
        {previewing ? <Square className="size-5" /> : <Play className="size-5" />}{previewing ? "Stop" : "Preview"}
      </button>
    </div>
  );

  const renderPanel = (
    <section aria-label="Render" className="space-y-4">
      {rs === "idle" || rs === "done" ? <>
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Output</p>
          <p className="mt-1 font-mono text-muted-foreground">{out.width}×{out.height} · {settings.fps} fps · {settings.duration}s · {totalFrames(settings.duration, settings.fps)} frames</p>
          {keys.length < 2 && <p className="mt-2 text-primary">Add at least 2 keyframes to render.</p>}
        </div>
        <button className="studio-btn-primary h-16 w-full text-lg" onClick={() => void startRender()} disabled={keys.length < 2}><Clapperboard className="size-6" />Start Rendering</button>
        {videoUrl && <div className="space-y-3">
          <video src={videoUrl} controls playsInline className="max-h-80 w-full rounded-xl bg-muted" />
          <a href={videoUrl} download={`${name}-video.mp4`} className="studio-btn w-full"><Download className="size-5" />Download video</a>
        </div>}
      </> : (
        <div className="space-y-4 rounded-xl border border-primary/50 bg-card p-4" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <p className="text-lg font-semibold">{rs === "paused" ? "Paused" : "Rendering…"}</p>
            <p className="font-mono text-2xl text-primary">{pct}%</p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Frame</dt><dd className="font-mono">{prog.frame}/{prog.total}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Speed</dt><dd className="font-mono">{prog.fps.toFixed(1)} fps</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Remaining</dt><dd className="font-mono">{rs === "paused" ? "—" : formatEta(prog.eta)}</dd></div>
          </dl>
          <div className="grid grid-cols-2 gap-3">
            <button className="studio-btn-primary h-14" onClick={pauseResume}>{rs === "paused" ? <Play className="size-5" /> : <Pause className="size-5" />}{rs === "paused" ? "Resume" : "Pause"}</button>
            <button className="studio-btn-danger h-14" onClick={() => { ctrl.current.cancel = true; }}><X className="size-5" />Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );

  const tabs: { id: Tab; label: string; icon: typeof Film }[] = [
    { id: "animate", label: "Animate", icon: Diamond }, { id: "render", label: "Render", icon: Film }, { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return <>
    <Button className="viewer-tool viewer-record" variant="ghost" size="icon" aria-label="Video studio" aria-pressed={open}
      title="Video studio" onClick={() => setOpen((v) => !v)}><Video /></Button>
    {open && <aside className="studio-sheet dark" aria-label="Video studio">
      <header className="safe-x flex items-center justify-between gap-3 border-b border-border py-2">
        <h2 className="truncate text-lg font-bold">Orbit<span className="text-primary">Studio</span></h2>
        <div className="flex items-center gap-2">
          {locked && <span className="rounded-full bg-primary/15 px-3 py-1 font-mono text-sm text-primary">● REC {pct}%</span>}
          <Button variant="ghost" size="icon" aria-label="Close studio" disabled={locked} onClick={() => { setPreviewing(false); setOpen(false); }}><X /></Button>
        </div>
      </header>
      <nav className="safe-x grid grid-cols-3 gap-2 py-2" aria-label="Panels">
        {tabs.map((t) => <button key={t.id} className="studio-tab" data-active={tab === t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
          <t.icon className="size-5" />{t.label}{t.id === "render" && locked ? ` ${pct}%` : ""}</button>)}
      </nav>
      <div className="safe-x safe-b space-y-4 pt-1">
        {tab === "animate" && <>
          {viewportControls}
          <Timeline keys={keys} duration={settings.duration} time={time} selected={selected} locked={locked || previewing}
            onSeek={seek} onSelect={selectKey} onAdd={addKey} onRemoveAtNeedle={removeKeyAtNeedle} onUpdate={updateKey} onDuplicate={duplicateKey} onDelete={deleteKey} />
        </>}
        {tab === "render" && renderPanel}
        {tab === "settings" && <SettingsPanel s={settings} set={set} locked={locked} />}
      </div>
    </aside>}
  </>;
}
