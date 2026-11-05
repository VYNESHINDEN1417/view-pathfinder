import { useEffect, useRef, useState } from "react";
import { Video, Circle, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Viewer } from "@/lib/wasm/viewer/viewer";

const DURATIONS = [5, 10, 20];

function pickMime() {
  const types = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

/** Records the live Rust-rendered canvas; turntable mode orbits the camera through the engine. */
export function VideoRecorder({ getViewer, getCanvas, schedule, name }: {
  getViewer: () => Viewer | null; getCanvas: () => HTMLCanvasElement | null; schedule: () => void; name: string;
}) {
  const [open, setOpen] = useState(false);
  const [turntable, setTurntable] = useState(true);
  const [duration, setDuration] = useState(10);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  const start = () => {
    const canvas = getCanvas();
    if (!canvas || typeof MediaRecorder === "undefined") { setError("Video recording is not supported in this browser."); return; }
    const mime = pickMime();
    const stream = canvas.captureStream(30);
    const quality = canvas.width * canvas.height * 30 * 0.2;
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.min(40e6, Math.max(8e6, quality)) });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || "video/webm";
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement("a");
      a.href = url; a.download = `${name}-video.${type.includes("mp4") ? "mp4" : "webm"}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    let raf = 0; let last = 0; const begin = performance.now();
    const tick = (t: number) => {
      const viewer = getViewer();
      const sec = (t - begin) / 1000;
      setElapsed(sec);
      if (sec >= duration) { stop(); return; }
      if (viewer && turntable) {
        // One full turn over the clip length, in canvas pixels of orbit drag.
        const dt = last ? t - last : 16;
        viewer.orbit_drag((canvas.clientWidth * 1.2 * dt) / (duration * 1000), 0);
        viewer.animate(t); viewer.frame();
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      if (rec.state !== "inactive") rec.stop();
      setRecording(false); stopRef.current = () => {}; schedule();
    };
    stopRef.current = stop;
    setError(""); setElapsed(0); setRecording(true);
    rec.start(250);
    raf = requestAnimationFrame(tick);
  };

  return <>
    <Button className="viewer-tool viewer-record" variant="ghost" size="icon" aria-label="Record video" aria-pressed={open}
      title="Record video" onClick={() => setOpen((v) => !v)}><Video /></Button>
    {open && <div className="video-panel" role="dialog" aria-label="Video recording">
      <div className="video-panel-row">
        <strong>{recording ? <><span className="rec-dot" /> {elapsed.toFixed(1)}s / {duration}s</> : "Record video"}</strong>
        <Button variant="ghost" size="icon" aria-label="Close" disabled={recording} onClick={() => setOpen(false)}><X /></Button>
      </div>
      <div className="video-panel-row">
        <Button size="sm" variant={turntable ? "secondary" : "ghost"} disabled={recording} onClick={() => setTurntable(true)}>Turntable</Button>
        <Button size="sm" variant={!turntable ? "secondary" : "ghost"} disabled={recording} onClick={() => setTurntable(false)}>Free camera</Button>
      </div>
      <div className="video-panel-row">
        {DURATIONS.map((d) => <Button key={d} size="sm" variant={duration === d ? "secondary" : "ghost"} disabled={recording} onClick={() => setDuration(d)}>{d}s</Button>)}
      </div>
      <div className="video-progress"><span style={{ width: `${Math.min(100, (elapsed / duration) * 100)}%` }} /></div>
      {recording
        ? <Button onClick={() => stopRef.current()}><Square /> Stop & save</Button>
        : <Button onClick={start}><Circle /> Start recording</Button>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </>;
}
