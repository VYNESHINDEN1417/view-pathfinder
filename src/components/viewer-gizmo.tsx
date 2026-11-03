import { useRef, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { isGizmoDrag } from "@/lib/viewer-loading";
import { twistDelta } from "@/lib/viewer-settings";

type Direction = [number, number, number];
const axes: { direction: Direction; label: string; axis: string }[] = [
  { direction: [1, 0, 0], label: "X", axis: "x" }, { direction: [-1, 0, 0], label: "−X", axis: "x" },
  { direction: [0, 1, 0], label: "Y", axis: "y" }, { direction: [0, -1, 0], label: "−Y", axis: "y" },
  { direction: [0, 0, 1], label: "Z", axis: "z" }, { direction: [0, 0, -1], label: "−Z", axis: "z" },
];
const diagonals: Direction[] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as Direction)));

export function sunTrackValue(mode: "azimuth" | "elevation", x: number, y: number) {
  if (mode === "azimuth") return (Math.atan2(x - 110, 110 - y) * 180 / Math.PI + 360) % 360;
  const angle = Math.atan2(y - 110, Math.max(0, x - 110)) * 180 / Math.PI;
  return Math.max(0, Math.min(90, 45 - angle));
}

// Inverse-quaternion projection is display-only; every camera change is handled in Rust.
function project(v: Direction, q: number[]) {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (-y * vz + z * vy), ty = 2 * (-z * vx + x * vz), tz = 2 * (-x * vy + y * vx);
  return [vx + w * tx - y * tz + z * ty, vy + w * ty - z * tx + x * tz, vz + w * tz - x * ty + y * tx];
}

export function ViewerGizmo({ rotation, onOrbit, onSnap, onTwist, sun, onSun }: {
  rotation: number[]; onOrbit: (dx: number, dy: number) => void; onSnap: (direction: Direction) => void; onTwist: (radians: number) => void;
  sun: { azimuth: number; elevation: number }; onSun: (patch: Partial<{ azimuth: number; elevation: number }>) => void;
}) {
  const gesture = useRef<{ id: number; startX: number; startY: number; x: number; y: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  // Two-finger twist: positions per pointer id; while two are down, orbit/snap are suspended.
  const touches = useRef(new Map<number, [number, number]>());
  const points = [...axes.map((axis) => ({ ...axis, diagonal: false })), ...diagonals.map((direction) => ({ direction, label: "", axis: "diagonal", diagonal: true }))]
    .map((point) => {
      const length = Math.hypot(...point.direction);
      const projected = project(point.direction.map((v) => v / length) as Direction, rotation);
      const radius = point.diagonal ? 60 : 40;
      return { ...point, x: 110 + (projected[0] ?? 0) * radius, y: 110 - (projected[1] ?? 0) * radius, depth: projected[2] ?? 0 };
    }).sort((a, b) => a.depth - b.depth);
  const moveSun = (event: React.PointerEvent<HTMLElement>, mode: "azimuth" | "elevation") => {
    const bounds = event.currentTarget.closest(".viewer-gizmo")?.getBoundingClientRect();
    if (!bounds) return;
    onSun({ [mode]: sunTrackValue(mode, (event.clientX - bounds.left) * 220 / bounds.width, (event.clientY - bounds.top) * 220 / bounds.height) });
  };
  const az = sun.azimuth * Math.PI / 180;
  const el = (45 - sun.elevation) * Math.PI / 180;
  return (
    <div className="viewer-gizmo" role="group" aria-label="XYZ camera navigation"
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        touches.current.set(event.pointerId, [event.clientX, event.clientY]);
        if (touches.current.size >= 2) { if (gesture.current) gesture.current.dragged = true; return; }
        if (gesture.current) return;
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragged: false };
      }}
      onPointerMove={(event) => {
        const map = touches.current;
        const prev = map.get(event.pointerId);
        if (prev && map.size >= 2) {
          event.preventDefault(); event.stopPropagation();
          const [aId, bId] = [...map.keys()];
          if (aId === undefined || bId === undefined) return;
          const a0 = map.get(aId), b0 = map.get(bId);
          if (!a0 || !b0) return;
          map.set(event.pointerId, [event.clientX, event.clientY]);
          const a1 = map.get(aId), b1 = map.get(bId);
          if (a1 && b1) onTwist(twistDelta(a0, b0, a1, b1));
          return;
        }
        if (prev) map.set(event.pointerId, [event.clientX, event.clientY]);
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (isGizmoDrag(event.clientX - g.startX, event.clientY - g.startY)) g.dragged = true;
        if (g.dragged) onOrbit(event.clientX - g.x, event.clientY - g.y);
        g.x = event.clientX; g.y = event.clientY;
      }}
      onPointerUp={(event) => {
        touches.current.delete(event.pointerId);
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        suppressClick.current = g.dragged;
        if (!g.dragged) {
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-direction]");
          if (target && event.currentTarget.contains(target)) onSnap(JSON.parse(target.dataset["direction"] ?? "[0,0,1]") as Direction);
        }
        gesture.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => { touches.current.delete(event.pointerId); gesture.current = null; suppressClick.current = true; }}
      onLostPointerCapture={(event) => { touches.current.delete(event.pointerId); if (gesture.current?.id === event.pointerId) gesture.current = null; }}
      onContextMenu={(event) => event.preventDefault()}>
      <svg className="sun-tracks" viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r="90" />
        <path d="M180.71 39.29 A100 100 0 0 1 180.71 180.71" />
      </svg>
      {(["azimuth", "elevation"] as const).map((mode) => <Button key={mode} variant="ghost" size="icon"
        className="sun-handle" role="slider" aria-label={`Sun ${mode}`} title={`Sun ${mode}`}
        aria-valuemin={0} aria-valuemax={mode === "azimuth" ? 360 : 90} aria-valuenow={Math.round(sun[mode])}
        aria-valuetext={`${Math.round(sun[mode])} degrees`}
        style={{ "--point-x": `${(mode === "azimuth" ? 110 + Math.sin(az) * 90 : 110 + Math.cos(el) * 100) / 220 * 100}%`,
          "--point-y": `${(mode === "azimuth" ? 110 - Math.cos(az) * 90 : 110 + Math.sin(el) * 100) / 220 * 100}%` } as CSSProperties}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); moveSun(e, mode); }}
        onPointerMove={(e) => { e.stopPropagation(); if (e.currentTarget.hasPointerCapture(e.pointerId)) moveSun(e, mode); }}
        onPointerUp={(e) => { e.stopPropagation(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={(e) => e.stopPropagation()} onLostPointerCapture={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault(); e.stopPropagation(); const max = mode === "azimuth" ? 360 : 90;
          const value = e.key === "Home" ? 0 : e.key === "End" ? max : sun[mode] + (["ArrowLeft", "ArrowDown"].includes(e.key) ? -2 : 2);
          onSun({ [mode]: mode === "azimuth" ? (value + 360) % 360 : Math.max(0, Math.min(max, value)) });
        } }} />)}
      <svg className="gizmo-twist" viewBox="0 0 220 220" aria-hidden="true">
        <path d="M43 76 Q27 110 43 144" /><path d="M35 135 L43 146 L51 135" />
        <path d="M177 144 Q193 110 177 76" /><path d="M169 85 L177 74 L185 85" />
      </svg>
      <svg className="gizmo-lines" viewBox="0 0 220 220" aria-hidden="true">
        {points.filter((p) => !p.diagonal).map((point) => <line key={point.label} x1="110" y1="110" x2={point.x} y2={point.y} className={`axis-${point.axis}`} />)}
      </svg>
      {points.map((point) => <Button key={point.direction.join(",")} variant="ghost" size="icon"
        className={`gizmo-point axis-${point.axis} ${point.diagonal ? "gizmo-diagonal" : ""} ${point.depth < 0 ? "gizmo-rear" : ""}`}
        style={{ "--point-x": `${point.x / 220 * 100}%`, "--point-y": `${point.y / 220 * 100}%` } as CSSProperties}
        aria-label={point.diagonal ? `View diagonal ${point.direction.join(", ")}` : `View ${point.label} axis`}
        title={point.diagonal ? `Diagonal ${point.direction.join(", ")}` : `${point.label} view`}
        aria-pressed={point.depth > 0.999} data-direction={JSON.stringify(point.direction)}
        onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onSnap(point.direction); }}>
        {point.diagonal ? <span className="diagonal-dot" /> : point.label}
      </Button>)}
    </div>
  );
}