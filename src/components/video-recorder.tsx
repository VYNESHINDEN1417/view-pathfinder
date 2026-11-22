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

type ExportBackground = (ctx: CanvasRenderingContext2D) => void;

/** Reproduce the CSS backdrop visible through transparent WebGPU canvas pixels. */
async function prepareExportBackground(canvas: HTMLCanvasElement, width: number, height: number): Promise<ExportBackground | null> {
  const root = canvas.closest<HTMLElement>(".ship-viewer");
  const stage = canvas.closest<HTMLElement>(".viewer-stage");
  if (!root || !stage) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const stageStyle = getComputedStyle(stage);
  const rootStyle = getComputedStyle(root);
  const stageImage = stageStyle.backgroundImage;
  const rootImage = rootStyle.backgroundImage;
  const useStage = stageImage && stageImage !== "none" && !stageImage.includes("gradient(");
  const targetRect = useStage ? stageRect : rootRect;
  const style = useStage ? stageStyle : rootStyle;
  const imageCss = style.backgroundImage;
  const scaleX = width / Math.max(canvasRect.width, 1);
  const offsetX = (canvasRect.left - targetRect.left) * scaleX;
  const offsetY = (canvasRect.top - targetRect.top) * scaleX;
  const targetWidth = targetRect.width * scaleX;
  const targetHeight = targetRect.height * scaleX;

  if (imageCss && imageCss !== "none" && imageCss.includes("url(")) {
    const match = imageCss.match(/url\(["']?(.*?)["']?\)/);
    if (!match?.[1]) return null;
    const image = new Image();
    image.src = new URL(match[1], window.location.href).href;
    try { await image.decode(); } catch { return null; }
    const cover = Math.max(targetWidth / image.naturalWidth, targetHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * cover;
    const drawHeight = image.naturalHeight * cover;
    const left = (targetWidth - drawWidth) * 0.5 - offsetX;
    const top = (targetHeight - drawHeight) * 0.5 - offsetY;
    return (ctx) => ctx.drawImage(image, left, top, drawWidth, drawHeight);
  }

  // Recreate the CSS checkerboard, which is not part of the WebGPU canvas.
  if (rootImage.includes("conic-gradient(")) {
    const checker = rootStyle.getPropertyValue("--viewer-checker").trim() || "#b8b8b8";
    const white = rootStyle.getPropertyValue("--viewer-white").trim() || "#ffffff";
    const tile = document.createElement("canvas");
    tile.width = tile.height = Math.max(2, Math.round(20 * scaleX));
    const tileCtx = tile.getContext("2d");
    if (!tileCtx) return null;
    const half = tile.width / 2;
    tileCtx.fillStyle = white;
    tileCtx.fillRect(0, 0, tile.width, tile.height);
    tileCtx.fillStyle = checker;
    tileCtx.fillRect(0, 0, half, half);
    tileCtx.fillRect(half, half, tile.width - half, tile.height - half);
    const pattern = tileCtx.createPattern(tile, "repeat");
    if (!pattern) return null;
    const phaseX = (canvasRect.left - rootRect.left) * scaleX;
    const phaseY = (canvasRect.top - rootRect.top) * scaleX;
    return (ctx) => {
      ctx.save();
      ctx.translate(-phaseX, -phaseY);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, rootRect.width * scaleX, rootRect.height * scaleX);
      ctx.restore();
    };
  }
  const color = style.backgroundColor;
  if (!color || color === "rgba(0, 0, 0, 0)" || color === "transparent") return null;
  return (ctx) => { ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); };
}
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    if (settings.fps === 90 && pixels > 2_073_600) {
      setError("90 fps export is currently limited to 1080p. Switch to 60 fps for 1440p or 4K.");
      return;
    }
    const bitrate = Math.round(bitrateBps(settings.bitrate) * (settings.optimizeExport === "smaller" ? 0.75 : 1));
    const estimatedBytes = (bitrate * settings.duration) / 8;
    if (estimatedBytes > 256 * 1024 * 1024) {
      setError("This export is estimated to exceed the 256 MB in-memory safety limit. Reduce duration or bitrate, or export in shorter sections.");
      return;
    }
    const isWebm = settings.format === "webm";
    let mp4Module: typeof import("mp4-muxer") | null = null;
    let encoderConfig: VideoEncoderConfig | null = null;
    let muxerCodec: "avc" | "hevc" | "av1" = "avc";
    if (isWebm) {
      const mimeType = settings.codec === "vp8" ? "video/webm;codecs=vp8" : "video/webm;codecs=vp9";
      if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function" || !MediaRecorder.isTypeSupported(mimeType)) {
        setError(`${settings.codec.toUpperCase()} WebM recording is not supported by this browser. Try the other WebM codec or use MP4.`);
        return;
      }
    } else {
      mp4Module = await import("mp4-muxer");
      const codecChoices = {
        h264: { muxer: "avc" as const, candidates: ["avc1.640034", "avc1.4d0034", "avc1.42003e"] },
        h265: { muxer: "hevc" as const, candidates: ["hvc1.1.6.L153.B0", "hev1.1.6.L153.B0", "hvc1.1.6.L93.B0"] },
        av1: { muxer: "av1" as const, candidates: ["av01.0.10M.08", "av01.0.08M.08"] },
      }[settings.codec as "h264" | "h265" | "av1"];
      if (!codecChoices) { setError("Choose a codec supported by the selected file format."); return; }
      muxerCodec = codecChoices.muxer;
      if (typeof VideoEncoder !== "undefined") {
        for (const candidate of codecChoices.candidates) {
          const baseConfig: VideoEncoderConfig = {
            codec: candidate, width, height, bitrate, framerate: settings.fps,
            latencyMode: "quality", bitrateMode: "variable",
            hardwareAcceleration: settings.optimizeExport === "faster" ? "prefer-hardware" : "no-preference",
          };
          let supported = await VideoEncoder.isConfigSupported(baseConfig).catch(() => null);
          if (!supported?.supported && settings.optimizeExport === "faster") {
            const fallback: VideoEncoderConfig = { ...baseConfig, hardwareAcceleration: "no-preference" };
            supported = await VideoEncoder.isConfigSupported(fallback).catch(() => null);
            if (supported?.supported) encoderConfig = fallback;
          }
          if (supported?.supported) { encoderConfig ??= baseConfig; break; }
        }
      }
      if (!encoderConfig) {
        setError(`This browser or device does not support ${settings.codec.toUpperCase()} encoding at the selected resolution. Choose another codec or lower the resolution.`);
        return;
      }
    }
    // Render at the viewport's existing drawing-buffer dimensions. The
    // export delivery size can be much larger (e.g. 1080x1920 on a phone),
    // which changes screen-space AO/depth sampling and can darken thin carpet
    // surfaces. Scale the finished viewport-matched frame only after rendering.
    const prev = { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight };
    const renderWidth = Math.max(1, prev.w);
    const renderHeight = Math.max(1, prev.h);
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width; frameCanvas.height = height;
    const frameContext = frameCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    if (!frameContext) { setError("Unable to prepare the anti-aliased export surface."); return; }
    // Preserve CSS-backed viewport backgrounds behind the transparent WebGPU canvas.
    const drawExportBackdrop = await prepareExportBackground(canvas, width, height);
    // Restore the live view after the temporary export render.
    const restore = () => {
      canvas.width = prev.w; canvas.height = prev.h;
      v.resize(prev.w, prev.h, prev.cw, prev.ch);
      v.set_shadow_mode(shadowMode);
      v.set_point_orbit_visible(blueLightPanelOpen);
      schedule();
    };
    canvas.width = renderWidth; canvas.height = renderHeight; v.resize(renderWidth, renderHeight, prev.cw, prev.ch);
    // Export uses the same Rust renderer and fully settled lighting as the viewport.
    // Rebuild cached sun shadows before the first frame so a recent azimuth change
    // cannot leak a stale/partially updated shadow map into the recording.
    v.refresh_sun_shadow();
    if (!settings.shadows) v.set_shadow_mode(0);
    // Editor orbit and source marker are guides, never part of rendered video.
    v.set_point_orbit_visible(false);
    const total = totalFrames(settings.duration, settings.fps);
    const denoiser = settings.noiseReduction ? createExportDenoiser(width, height) : null;
    if (settings.noiseReduction && !denoiser)
      setError("Noise reduction is unavailable on this browser or device. Export will continue without it.");
    ctrl.current = { paused: false, cancel: false };
    setRs("rendering"); setTab("render");

    if (isWebm) {
      const mimeType = settings.codec === "vp8" ? "video/webm;codecs=vp8" : "video/webm;codecs=vp9";
      const recordCanvas = denoiser?.canvas ?? frameCanvas;
      const stream = recordCanvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      if (!track || typeof track.requestFrame !== "function") {
        stream.getTracks().forEach((item) => item.stop());
        denoiser?.destroy(); restore(); setRs("idle");
        setError("This browser cannot capture export frames manually. Use MP4 or a supported browser.");
        return;
      }
      const chunks: Blob[] = [];
      let recorderError = false;
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => { recorderError = true; };
      recorder.start(1000);
      let startedAt: number | null = null;
      let pausedTotal = 0;
      let pauseStarted: number | null = null;
      for (let f = 0; f < total; f++) {
        if (ctrl.current.cancel || recorderError) break;
        while (ctrl.current.paused && !ctrl.current.cancel) {
          if (pauseStarted === null) pauseStarted = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        if (pauseStarted !== null) { pausedTotal += performance.now() - pauseStarted; pauseStarted = null; }
        if (ctrl.current.cancel) break;
        const t = f / settings.fps;
        const sampled = sampleCamera(keysRef.current, t, settings.smoothing);
        if (!sampled) break;
        v.set_camera_pose(new Float32Array(sampled));
        v.frame();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        frameContext.fillStyle = "#000000";
        frameContext.fillRect(0, 0, width, height);
        drawExportBackdrop?.(frameContext);
        frameContext.drawImage(canvas, 0, 0, width, height);
        denoiser?.process(frameCanvas);
        startedAt ??= performance.now();
        const deadline = startedAt + pausedTotal + (f * 1000) / settings.fps;
        const wait = deadline - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        track.requestFrame();
        if (f % 3 === 0 || f === total - 1) {
          const elapsed = Math.max(1, performance.now() - (startedAt ?? performance.now()) - pausedTotal);
          const fps = (f + 1) / (elapsed / 1000);
          setTime(t); setProg({ frame: f + 1, total, fps, eta: f > 5 ? (total - f - 1) / fps : null });
        }
      }
      const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      mediaRecorderRef.current = null;
      stream.getTracks().forEach((item) => item.stop());
      denoiser?.destroy();
      restore();
      if (ctrl.current.cancel || recorderError) {
        setRs("idle"); setProg({ frame: 0, total: 0, fps: 0, eta: null });
        if (recorderError) setError("WebM recording failed. Try a lower resolution or VP8.");
        return;
      }
      setVideoUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || mimeType })));
      setRs("done");
      return;
    }

    const { Muxer, ArrayBufferTarget } = mp4Module!;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: muxerCodec, width, height, frameRate: settings.fps }, fastStart: "in-memory" });
    // Preserve the encoder's own output color description. The input frame is
    // explicitly tagged as full-range sRGB below; guessing that the encoded
    // H.264 stream is limited-range BT.709 when the encoder omits metadata can
    // mislabel the actual YUV range and make midtone materials look darker.
    let encErr: unknown = null;
    const enc = new VideoEncoder({
      output: (chunk, metadata) => {
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (er) => { encErr = er; },
    });
    enc.configure(encoderConfig);
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
      // Give the browser a compositor turn after the GPU submission before the
      // canvas is sampled. Export is offline-timed, so this does not drop frames.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      // H.264 has no alpha channel. Composite the WebGPU canvas onto an opaque
      // sRGB frame here so premultiplied canvas RGB is not later mistaken for
      // straight-alpha video pixels by the encoder.
      frameContext.fillStyle = "#000000";
      frameContext.fillRect(0, 0, width, height);
      drawExportBackdrop?.(frameContext);
      frameContext.drawImage(canvas, 0, 0, width, height);
      const frameSource = denoiser ? denoiser.process(frameCanvas) : frameCanvas;
      const vf = new VideoFrame(frameSource, {
        timestamp: Math.round(f * us),
        duration: Math.round(us),
        // The composited frame canvas contains SDR sRGB pixels.
        colorSpace: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
      });
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
    denoiser?.destroy();
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
  const pauseResume = () => {
    ctrl.current.paused = !ctrl.current.paused;
    if (mediaRecorderRef.current?.state === "recording" && ctrl.current.paused) mediaRecorderRef.current.pause();
    else if (mediaRecorderRef.current?.state === "paused" && !ctrl.current.paused) mediaRecorderRef.current.resume();
    setRs(ctrl.current.paused ? "paused" : "rendering");
  };
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
          <p className="mt-1 font-mono text-muted-foreground">{settings.format.toUpperCase()} · {settings.codec.toUpperCase()} · {out.width}×{out.height} · {settings.fps} fps · {settings.duration}s · {totalFrames(settings.duration, settings.fps)} frames</p>
          {keys.length < 2 && <p className="mt-2 text-primary">Add at least 2 keyframes to render.</p>}
        </div>
        <button className="studio-btn-primary h-16 w-full text-lg" onClick={() => void startRender()} disabled={keys.length < 2}><Clapperboard className="size-6" />Start Rendering</button>
        {videoUrl && <div className="space-y-3">
          <video src={videoUrl} controls playsInline className="max-h-80 w-full rounded-xl bg-muted" />
          <a href={videoUrl} download={`${exportFilename(name, "vid")}.${settings.format}`} className="studio-btn w-full"><Download className="size-5" />Download video</a>
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
