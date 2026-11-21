import { useEffect, useRef, useState } from "react";
import { Clapperboard, Diamond, Download, Film, Pause, Play, RotateCcw, Settings2, Square, Sun, Video, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { exportFilename } from "@/lib/export-filename";
import { Timeline } from "@/components/studio/Timeline";
import { SettingsPanel } from "@/components/studio/SettingsPanel";
import { defaultSettings, outputSize, studioAspect, bitrateBps, type StudioSettings } from "@/components/studio/settings";
import { sampleCamera, sortKeys, totalFrames, formatEta, uid, type Keyframe } from "@/lib/studio/keyframes";
import type { Viewer } from "@/lib/wasm/viewer/viewer";
import { createExportDenoiser } from "@/lib/studio/export-denoiser";

type Tab = "animate" | "render" | "settings";
type RenderState = "idle" | "rendering" | "paused" | "done";

/** Orbit Studio overlay driving the Rust camera; video is encoded offline frame by frame, so heavy shading never drops frames. */
export function VideoRecorder({ getViewer, getCanvas, schedule, name, ironTrapdoorBrightness, onIronTrapdoorBrightness, onLayout, blueLightPanelOpen, shadowMode }: {
  getViewer: () => Viewer | null; getCanvas: () => HTMLCanvasElement | null; schedule: () => void; name: string;
  ironTrapdoorBrightness: number; onIronTrapdoorBrightness: (value: number) => void;
  shadowMode: number;
  onLayout: (layout: { open: boolean; ratio: number }) => void;
  blueLightPanelOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ironTrapdoorPanelOpen, setIronTrapdoorPanelOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("animate");
  const [settings, setSettings] = useState<StudioSettings>(defaultSettings);
  const [bitratePreferenceLoaded, setBitratePreferenceLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("pathfinder-video-bitrate-mbps"));
      if (Number.isFinite(saved) && saved >= 8 && saved <= 80)
        setSettings((current) => ({ ...current, bitrate: Math.round(saved / 2) * 2 }));
    } catch { /* Storage may be unavailable. */ }
    setBitratePreferenceLoaded(true);
  }, []);
  useEffect(() => {
    if (!bitratePreferenceLoaded) return;
    try { window.localStorage.setItem("pathfinder-video-bitrate-mbps", String(settings.bitrate)); }
    catch { /* Storage may be unavailable. */ }
  }, [settings.bitrate, bitratePreferenceLoaded]);
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
    const pixels = width * height;
    // 90 fps is deliberately limited to a 1080p pixel budget on mobile-class GPUs.
    // Higher resolutions can allocate several full-frame GPU surfaces and crash the tab.
    if (settings.fps === 90 && pixels > 2_073_600) {
      setError("90 fps export is currently limited to 1080p. Switch to 60 fps for 1440p or 4K.");
      return;
    }
    const bitrate = bitrateBps(settings.bitrate);
    const estimatedBytes = (bitrate * settings.duration) / 8;
    if (estimatedBytes > 256 * 1024 * 1024) {
      setError("This export is estimated to exceed the 256 MB in-memory safety limit. Reduce duration or bitrate, or export in shorter sections.");
      return;
    }

    let enc: VideoEncoder | null = null;
    let denoiser: ReturnType<typeof createExportDenoiser> = null;
    let restore: (() => void) | null = null;
    let completed = false;
    let encErr: unknown = null;
    try {
      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      let codec = "";
      if (typeof VideoEncoder !== "undefined") {
        for (const c of ["avc1.640034", "avc1.4d0034", "avc1.42003e"]) {
          const config = { codec: c, width, height, bitrate, framerate: settings.fps };
          const ok = await VideoEncoder.isConfigSupported(config).catch(() => null);
          if (ok?.supported) { codec = c; break; }
        }
      }
      if (!codec) throw new Error("This browser or device does not support the selected export settings. Try 60 fps or a lower resolution.");

      const prev = { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight };
      restore = () => {
        canvas.width = prev.w; canvas.height = prev.h;
        v.resize(prev.w, prev.h, prev.cw, prev.ch);
        v.set_shadow_mode(shadowMode);
        v.set_point_orbit_visible(blueLightPanelOpen);
        schedule();
      };

      canvas.width = width; canvas.height = height;
      v.resize(width, height, width, height);
      v.refresh_sun_shadow();
      if (!settings.shadows) v.set_shadow_mode(0);
      v.set_point_orbit_visible(false);

      denoiser = settings.noiseReduction ? createExportDenoiser(width, height) : null;
      if (settings.noiseReduction && !denoiser)
        setError("Noise reduction is unavailable on this browser or device. Export will continue without it.");

      const total = totalFrames(settings.duration, settings.fps);
      ctrl.current = { paused: false, cancel: false };
      setRs("rendering"); setTab("render");
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: "avc", width, height, frameRate: settings.fps }, fastStart: "in-memory" });
      enc = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (error) => { encErr = error; },
      });
      enc.configure({ codec, width, height, bitrate, framerate: settings.fps });

      const frameDurationUs = 1e6 / settings.fps;
      const queueLimit = settings.fps >= 90 ? 1 : 2;
      let activeMs = 0, last = performance.now();
      for (let frame = 0; frame < total; frame++) {
        if (ctrl.current.cancel || encErr) break;
        while (ctrl.current.paused && !ctrl.current.cancel && !encErr) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          last = performance.now();
        }
        if (ctrl.current.cancel || encErr) break;

        // Apply backpressure BEFORE allocating the next VideoFrame. This bounds
        // queued GPU/encoder surfaces instead of allowing a burst at 90 fps.
        while (enc.encodeQueueSize >= queueLimit && !ctrl.current.cancel && !encErr) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        if (ctrl.current.cancel || encErr) break;

        const t = frame / settings.fps;
        const sampled = sampleCamera(keysRef.current, t, settings.smoothing);
        if (!sampled) throw new Error("Camera animation could not be sampled.");
        v.set_camera_pose(new Float32Array(sampled));
        v.frame();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        const frameSource = denoiser ? denoiser.process(canvas) : canvas;
        const videoFrame = new VideoFrame(frameSource, {
          timestamp: Math.round(frame * frameDurationUs),
          duration: Math.round(frameDurationUs),
        });
        try {
          enc.encode(videoFrame, { keyFrame: frame % (settings.fps * 2) === 0 });
        } finally {
          videoFrame.close();
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
        const now = performance.now();
        activeMs += now - last; last = now;
        if (frame % 3 === 0 || frame === total - 1) {
          const speed = (frame + 1) / Math.max(activeMs / 1000, 0.001);
          setTime(t);
          setProg({ frame: frame + 1, total, fps: speed, eta: frame > 5 ? (total - frame - 1) / speed : null });
        }
      }

      if (ctrl.current.cancel) throw new Error("Export cancelled.");
      if (encErr) throw encErr;
      await enc.flush();
      if (encErr) throw encErr;
      muxer.finalize();
      setVideoUrl(URL.createObjectURL(new Blob([target.buffer], { type: "video/mp4" })));
      completed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected export error occurred.";
      if (ctrl.current.cancel) setError("Export cancelled. Your project and keyframes are safe.");
      else setError(`Export stopped safely: ${message}`);
    } finally {
      denoiser?.destroy();
      if (enc && enc.state !== "closed") {
        try { enc.close(); } catch { /* Encoder may already have closed itself after an error. */ }
      }
      restore?.();
      setRs(completed ? "done" : "idle");
      if (!completed) setProg({ frame: 0, total: 0, fps: 0, eta: null });
    }
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
          <a href={videoUrl} download={`${exportFilename(name, "vid")}.mp4`} className="studio-btn w-full"><Download className="size-5" />Download video</a>
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
    <Button className="viewer-tool viewer-iron-trapdoor" variant="ghost" size="icon"
      aria-label="Iron trapdoor brightness" aria-expanded={ironTrapdoorPanelOpen}
      title="Iron trapdoor brightness" onClick={() => setIronTrapdoorPanelOpen((v) => !v)}><Sun /></Button>
    {ironTrapdoorPanelOpen && <section className="iron-trapdoor-panel" aria-label="Iron trapdoor brightness control">
      <div className="iron-trapdoor-panel-heading"><strong>Iron trapdoor</strong><span>{ironTrapdoorBrightness.toFixed(2)}×</span></div>
      <Slider min={0.25} max={1.5} step={0.01} value={[ironTrapdoorBrightness]}
        onValueChange={(values) => { const value = values[0]; if (value !== undefined) onIronTrapdoorBrightness(value); }}
        aria-label="Iron trapdoor brightness" />
      <div className="iron-trapdoor-panel-scale"><span>Darker</span><span>Brighter</span></div>
      <p>Only iron trapdoor textures are affected.</p>
    </section>}
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
