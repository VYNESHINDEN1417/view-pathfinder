import { useRef, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { isGizmoDrag } from "@/lib/viewer-loading";

type Direction = [number, number, number];
const axes: { direction: Direction; label: string; axis: string }[] = [
  { direction: [1, 0, 0], label: "X", axis: "x" }, { direction: [-1, 0, 0], label: "−X", axis: "x" },
  { direction: [0, 1, 0], label: "Y", axis: "y" }, { direction: [0, -1, 0], label: "−Y", axis: "y" },
  { direction: [0, 0, 1], label: "Z", axis: "z" }, { direction: [0, 0, -1], label: "−Z", axis: "z" },
];
const diagonals: Direction[] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as Direction)));

// Inverse-quaternion projection is display-only; every camera change is handled in Rust.
function project(v: Direction, q: number[]) {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (-y * vz + z * vy), ty = 2 * (-z * vx + x * vz), tz = 2 * (-x * vy + y * vx);
  return [vx + w * tx - y * tz + z * ty, vy + w * ty - z * tx + x * tz, vz + w * tz - x * ty + y * tx];
}

export function ViewerGizmo({ rotation, onOrbit, onSnap }: {
  rotation: number[]; onOrbit: (dx: number, dy: number) => void; onSnap: (direction: Direction) => void;
}) {
  const gesture = useRef<{ id: number; startX: number; startY: number; x: number; y: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const points = [...axes.map((axis) => ({ ...axis, diagonal: false })), ...diagonals.map((direction) => ({ direction, label: "", axis: "diagonal", diagonal: true }))]
    .map((point) => {
      const length = Math.hypot(...point.direction);
      const projected = project(point.direction.map((v) => v / length) as Direction, rotation);
      const radius = point.diagonal ? 84 : 57;
      return { ...point, x: 110 + (projected[0] ?? 0) * radius, y: 110 - (projected[1] ?? 0) * radius, depth: projected[2] ?? 0 };
    }).sort((a, b) => a.depth - b.depth);
  return (
    <div className="viewer-gizmo" role="group" aria-label="XYZ camera navigation"
      onPointerDown={(event) => {
        if (gesture.current || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragged: false };
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (isGizmoDrag(event.clientX - g.startX, event.clientY - g.startY)) g.dragged = true;
        if (g.dragged) onOrbit(event.clientX - g.x, event.clientY - g.y);
        g.x = event.clientX; g.y = event.clientY;
      }}
      onPointerUp={(event) => {
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
      onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }}
      onLostPointerCapture={() => { gesture.current = null; }}
      onContextMenu={(event) => event.preventDefault()}>
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