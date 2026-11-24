import { useEffect, useRef, useState } from "react";
import { Camera, Menu, Box, Sun, Moon, LoaderCircle, Upload, RotateCcw, Sparkles, X, Lightbulb, Layers, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ASPECTS, BACKGROUNDS, RESOLUTIONS, SHADOW_MODES, SHADOW_QUALITIES, parseRatio } from "@/lib/viewer-settings";

export type ShadowComponents = { directional: number; contact: number; overhang: number; edge: number; ambient: number; depth: number; verticalEdge: number; horizontalEdge: number };
export type BlueLightSettings = { azimuth: number; brightness: number; intensity: number; hue: number; range: number };

export type ViewerOptions = {
  background: number; aspect: string; custom: [number, number]; resolution: number; shadowMode: number; shadowQuality: number; fancy: boolean; fancyQuality: number;
};

function SliderValueReadout({ value, min, max, step, label, disabled, onApply }: {
  value: number; min: number; max: number; step: number; label: string; disabled?: boolean; onApply: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => { if (!editing) setDraft(value.toFixed(2)); }, [value, editing]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && draft.trim() !== "") {
      const clamped = Math.min(max, Math.max(min, parsed));
      const snapped = Math.min(max, Math.max(min, min + Math.round((clamped - min) / step) * step));
      onApply(Number(snapped.toFixed(4)));
    }
    setEditing(false);
  };
  if (editing) return <input className="viewer-value-input" type="number" inputMode="decimal" min={min} max={max} step={step}
    aria-label={`Set ${label}`} value={draft} autoFocus
    onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditing(false); }} />;
  return <button type="button" className="viewer-value-readout" aria-label={`Edit ${label}, current value ${value.toFixed(2)}`}
    title={`Tap to enter ${label}`} disabled={disabled}
    onClick={() => { setDraft(value.toFixed(2)); setEditing(true); }}>{value.toFixed(2)}×</button>;
}

function ArcSlider({ value, min, max, onChange, disabled, label, variant }: {
  value: number; min: number; max: number; onChange: (value: number) => void;
  disabled?: boolean; label: string; variant: "outer" | "inner";
}) {
  // Slider paths are traced from the inner orange contour of the supplied wireframe.
  const points = variant === "outer"
    ? [[90.32,1.01],[70.97,11.36],[55.48,22.98],[45.16,35.35],[40,48.74],[40,58.84],[41.29,64.14],[46.45,74.24],[56.13,85.1],[64.52,91.92],[74.84,98.23]]
    : [[88.52,1.01],[77.51,4.29],[65.07,9.09],[54.55,14.39],[45.93,19.95],[38.76,26.01],[32.06,33.84],[28.71,39.65],[26.32,46.21],[25.84,59.34],[28.23,66.92],[32.06,73.74],[37.8,80.56],[44.98,86.87],[55.02,93.43],[66.03,98.74]];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0]-points[i][0], p[1]-points[i][1]));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const pointAt = (t: number) => {
    let remaining = Math.max(0, Math.min(1, t)) * totalLength;
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i];
      if (remaining <= length || i === lengths.length - 1) {
        const ratio = length ? remaining / length : 0;
        return { x: points[i][0] + (points[i+1][0]-points[i][0])*ratio, y: points[i][1] + (points[i+1][1]-points[i][1])*ratio };
      }
      remaining -= length;
    }
    return { x: points[points.length-1][0], y: points[points.length-1][1] };
  };
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const thumb = pointAt(t);
  const d = points.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
  const updateFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * 100;
    const py = (event.clientY - rect.top) / rect.height * 100;
    let bestT = 0, bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 300; i++) {
      const candidateT = i / 300;
      const p = pointAt(candidateT);
      const distance = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (distance < bestDistance) { bestDistance = distance; bestT = candidateT; }
    }
    onChange(Number((min + bestT * (max - min)).toFixed(4)));
  };
  const adjust = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return <svg className={`viewer-arc-slider viewer-arc-slider-${variant}`} viewBox="0 0 100 100" preserveAspectRatio="none"
    role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min}
    aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled || undefined}
    onPointerDown={(event) => { if (disabled) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }}
    onPointerMove={(event) => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={(event) => { if (disabled) return; if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); adjust((max-min)/100); } if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); adjust(-(max-min)/100); } if (event.key === "Home") { event.preventDefault(); onChange(min); } if (event.key === "End") { event.preventDefault(); onChange(max); } }}>
    <path className="viewer-arc-slider-track" d={d} />
    <path className="viewer-arc-slider-progress" d={d} pathLength="100" strokeDasharray={`${t*100} 100`} />
    <circle className="viewer-arc-slider-thumb" cx={thumb.x} cy={thumb.y} r="6.5" />
  </svg>;
}

function ShadowSettingRow({ title, description, value, onChange, disabled }: {
  title: string; description: string; value: number; onChange: (value: number) => void; disabled: boolean;
}) {
  return <div className="shadow-setting-row">
    <div className="shadow-setting-copy">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
    <div className="shadow-setting-control">
      <SliderValueReadout value={value} min={0} max={2} step={0.05} label={title.toLowerCase()} disabled={disabled} onApply={onChange} />
      <Slider min={0} max={2} step={0.05} value={[value]} disabled={disabled}
        onValueChange={(values) => { const next = values[0]; if (next !== undefined) onChange(next); }}
        aria-label={title} />
    </div>
  </div>;
}


function rotateDirection(v: [number, number, number], q: number[]) {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (-y * vz + z * vy), ty = 2 * (-z * vx + x * vz), tz = 2 * (-x * vy + y * vx);
  return [vx + w * tx - y * tz + z * ty, vy + w * ty - z * tx + x * tz, vz + w * tz - x * ty + y * tx] as [number, number, number];
}

function BlueLightPanel({ value, rotation, onChange, onClose, enabled, onToggle }: { value: BlueLightSettings; rotation: number[]; onChange: (patch: Partial<BlueLightSettings>) => void; onClose: () => void; enabled: boolean; onToggle: (enabled: boolean) => void }) {
  const axisX = rotateDirection([1, 0, 0], rotation);
  const axisZ = rotateDirection([0, 0, 1], rotation);
  const screenX = (x: number, z: number) => 110 + (axisX[0] * x + axisZ[0] * z) * 90;
  const screenY = (x: number, z: number) => 110 - (axisX[1] * x + axisZ[1] * z) * 90;
  const directionPoint = (azimuth: number) => {
    const a = azimuth * Math.PI / 180;
    const x = Math.sin(a), z = Math.cos(a);
    return { left: (screenX(x, z) / 220 * 100) + "%", top: (screenY(x, z) / 220 * 100) + "%" };
  };
  const ringPath = Array.from({ length: 73 }, (_, i) => {
    const a = i / 72 * Math.PI * 2;
    return `${i === 0 ? "M" : "L"}${screenX(Math.sin(a), Math.cos(a)).toFixed(2)} ${screenY(Math.sin(a), Math.cos(a)).toFixed(2)}`;
  }).join(" ") + " Z";
  const updateAzimuth = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) * 220 / rect.width - 110) / 90;
    const sy = (110 - (event.clientY - rect.top) * 220 / rect.height) / 90;
    // Invert the same screen projection used to draw the compass.
    // screenY is flipped for SVG, then converted back to upward-positive sy above.
    const det = axisX[0] * axisZ[1] - axisZ[0] * axisX[1];
    if (Math.abs(det) < 0.025) return;
    const worldX = (sx * axisZ[1] - axisZ[0] * sy) / det;
    const worldZ = (axisX[0] * sy - sx * axisX[1]) / det;
    onChange({ azimuth: Math.round(((Math.atan2(worldX, worldZ) * 180 / Math.PI + 360) % 360) * 10) / 10 });
  };
  const handle = directionPoint(value.azimuth);
  const cardinals = [{ label: "N", az: 0 }, { label: "E", az: 90 }, { label: "S", az: 180 }, { label: "W", az: 270 }];
  const row = (title: string, description: string, current: number, min: number, max: number, step: number, patch: keyof BlueLightSettings) => <div className="blue-light-setting">
    <div className="blue-light-setting-heading"><strong>{title}</strong><span>{current.toFixed(2)}×</span></div>
    <p>{description}</p>
    <Slider min={min} max={max} step={step} value={[current]} onValueChange={(values) => { const next = values[0]; if (next !== undefined) onChange({ [patch]: next } as Partial<BlueLightSettings>); }} aria-label={title} />
  </div>;
  return <div className="blue-light-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="blue-light-panel" role="group" aria-label="Blue light settings"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}>
      <header className="blue-light-header"><div><strong>BLUE LIGHT</strong><span>Localized point source</span></div>
        <button type="button" className="shadow-settings-close" aria-label="Close blue light settings" onClick={onClose}><X size={19} /></button>
      </header>
      <div className="blue-light-power-row"><div><strong>Light power</strong><span>{enabled ? "Illumination stays active when this panel closes." : "Light is currently off."}</span></div><button type="button" className="blue-light-power-toggle" role="switch" aria-checked={enabled} onClick={() => onToggle(!enabled)}><span className="blue-light-power-knob" />{enabled ? "ON" : "OFF"}</button></div>
      <div className="blue-light-layout">
        <div className="blue-light-direction">
          <div className="blue-light-compass" role="slider" tabIndex={0} aria-label="Blue light azimuth" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(value.azimuth)}
            onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); updateAzimuth(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateAzimuth(event); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={(event) => { if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 359 : value.azimuth + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -2 : 2); onChange({ azimuth: (next + 360) % 360 }); } }}>
            <svg viewBox="0 0 220 220" aria-hidden="true"><path d={ringPath} /><path d={cardinals.map(({ az }) => { const p = directionPoint(az); const x = parseFloat(p.left) * 2.2, y = parseFloat(p.top) * 2.2; const a = az * Math.PI / 180; return `M${screenX(Math.sin(a) * 0.88, Math.cos(a) * 0.88)} ${screenY(Math.sin(a) * 0.88, Math.cos(a) * 0.88)} L${x} ${y}`; }).join(" ")} /></svg>
            {cardinals.map(({ label, az }) => <span key={label} className="blue-light-cardinal" style={directionPoint(az)}>{label}</span>)}
            <span className="blue-light-handle" style={handle} />
          </div>
          <strong className="blue-light-azimuth-value">{value.azimuth.toFixed(1)}°</strong>
          <span className="blue-light-compass-caption">LIGHT DIRECTION</span>
        </div>
        <div className="blue-light-settings">
          {row("Brightness", "Source brightness multiplier.", value.brightness, 0, 2.5, 0.05, "brightness")}
          {row("Intensity", "How strongly the light illuminates surfaces.", value.intensity, 0, 2, 0.05, "intensity")}
          <div className="blue-light-setting"><div className="blue-light-setting-heading"><strong>Color</strong><span className="blue-light-color-chip" style={{ background: "hsl(" + value.hue + " 100% 55%)" }} /></div>
            <p>Change the light's hue.</p><Slider className="blue-light-hue-slider" min={0} max={360} step={1} value={[value.hue]} onValueChange={(values) => { const next = values[0]; if (next !== undefined) onChange({ hue: next }); }} aria-label="Light color hue" />
            <div className="blue-light-hue-labels"><span>RED</span><span>BLUE</span><span>VIOLET</span></div>
          </div>
          {row("Influence width", "How far the light reaches across the ship.", value.range, 0.2, 2.5, 0.05, "range")}
        </div>
      </div>
      <footer className="blue-light-footer"><span>AZIMUTH 0–360°</span><span>CAMERA-ALIGNED</span></footer>
    </section>
  </div>;
}

export function ViewerControls({ options, brightness, shadowStrength, shadowComponents, orthographic, rotation, saving, error, onOptions, onBrightness, onShadowStrength, onShadowComponents, onProjection, onSave, uploading, customModel, onUpload, models, activeModel, onModel, sunIntensity, onSunIntensity, blueLight, onBlueLightChange, blueLightEnabled, onBlueLightEnabledChange, blueLightPanelOpen, onBlueLightPanelOpenChange, aoV2Enabled, onAoV2EnabledChange, aoV2ContactStrength, onAoV2ContactStrengthChange, viewportResolution, onViewportResolutionChange, adaptivePreview, onAdaptivePreviewChange }: {
  options: ViewerOptions; brightness: number; shadowStrength: number; shadowComponents: ShadowComponents; orthographic: boolean; rotation: number[]; saving: boolean; error: string;
  onOptions: (patch: Partial<ViewerOptions>) => void; onBrightness: (value: number) => void; onShadowStrength: (value: number) => void; onShadowComponents: (patch: Partial<ShadowComponents>) => void;
  onProjection: () => void; onSave: () => void;
  uploading: boolean; customModel: boolean; onUpload: () => void; models: { id: string; name: string }[]; activeModel: string; onModel: (id: string) => void;
  sunIntensity: number; onSunIntensity: (value: number) => void;
  blueLight: BlueLightSettings; onBlueLightChange: (patch: Partial<BlueLightSettings>) => void;
  blueLightEnabled: boolean; onBlueLightEnabledChange: (enabled: boolean) => void;
  blueLightPanelOpen: boolean; onBlueLightPanelOpenChange: (open: boolean) => void;
  aoV2Enabled: boolean; onAoV2EnabledChange: (enabled: boolean) => void;
  aoV2ContactStrength: number; onAoV2ContactStrengthChange: (value: number) => void;
  viewportResolution: number; onViewportResolutionChange: (value: number) => void;
  adaptivePreview: boolean; onAdaptivePreviewChange: (enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState<[string, string]>([String(options.custom[0]), String(options.custom[1])]);
  const [shadowPanelOpen, setShadowPanelOpen] = useState(false);
  const [denoiseMenuOpen, setDenoiseMenuOpen] = useState(false);
  const [viewportPanelOpen, setViewportPanelOpen] = useState(false);
  const aoHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressAoClick = useRef(false);
  const clearAoHold = () => { if (aoHoldTimer.current) clearTimeout(aoHoldTimer.current); aoHoldTimer.current = null; };
  const valid = parseRatio(Number(draft[0]), Number(draft[1])) > 0;
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  return <>
    <svg className="viewer-wireframe" viewBox="0 0 814 1536" preserveAspectRatio="none" aria-hidden="true">
      <g fill="#ff7300" fillRule="evenodd">
        <path d="M508,1066 788,1066 788,968 637,967Z M519,1061 637,971 785,972 784,1063 520,1063Z" />
        <path d="M788,1166 788,1093 785,1092 521,1093 563,1123 588,1148 603,1168 787,1168Z M532,1097 784,1096 785,1163 783,1165 605,1165 573,1128 549,1108Z" />
        <path d="M622,1200 636,1236 645,1276 787,1276 787,1200Z M628,1204 782,1203 785,1205 785,1271 782,1273 648,1273 646,1271 645,1260 637,1229Z" />
        <path d="M645,1310 645,1327 642,1347 632,1385 787,1385 787,1310Z M648,1314 784,1313 785,1380 783,1382 638,1382 636,1380 645,1348Z" />
        <path d="M561,1486 787,1487 787,1417 618,1416 592,1455Z M570,1483 595,1456 620,1419 782,1419 785,1421 785,1482 783,1484Z" />
        <path d="M23,1065 135,1065 138,1067 144,1065 467,1066 544,1007 23,1006Z M314,1061 334,1045 372,1009 534,1010 526,1018 465,1063Z M147,1061 198,1009 363,1010 323,1049 310,1058 308,1062 152,1063Z M25,1059 27,1009 188,1010 188,1013 140,1062 27,1062Z" />
        <path d="M90,1091 80,1104 60,1141 45,1178 33,1220 27,1253 24,1285 24,1323 29,1368 36,1400 46,1433 70,1487 155,1487 143,1471 125,1439 107,1392 101,1368 95,1326 95,1282 101,1240 107,1216 121,1178 141,1140 159,1114 179,1091Z M91,1094 170,1095 140,1136 116,1182 100,1231 92,1284 92,1324 94,1345 102,1385 117,1428 130,1455 146,1480 146,1484 73,1484 71,1482 53,1443 43,1414 31,1361 27,1323 27,1284 31,1246 37,1216 43,1194 58,1153 77,1115Z" />
        <path d="M208,1091 182,1118 162,1145 144,1177 130,1211 122,1240 116,1276 115,1311 118,1347 125,1380 139,1420 162,1463 180,1487 271,1487 258,1476 226,1442 208,1415 196,1390 187,1364 181,1334 181,1273 187,1244 195,1220 208,1193 224,1168 242,1147 270,1122 300,1103 324,1092Z M209,1094 308,1095 285,1108 259,1127 237,1148 219,1170 204,1194 190,1225 183,1248 178,1274 177,1326 182,1356 190,1383 202,1410 217,1435 238,1461 261,1482 259,1484 182,1484 178,1480 172,1472 168,1465 165,1462 164,1459 157,1449 145,1426 143,1422 141,1415 138,1410 135,1399 133,1396 133,1394 131,1390 131,1387 129,1383 128,1376 127,1375 126,1369 125,1368 125,1363 123,1359 123,1353 122,1352 121,1340 120,1339 120,1333 119,1332 119,1309 118,1308 118,1299 119,1298 119,1276 120,1275 120,1269 121,1268 121,1262 122,1261 122,1255 123,1254 123,1249 124,1248 124,1245 125,1244 125,1240 126,1239 126,1236 127,1235 129,1224 131,1221 131,1218 132,1217 135,1206 137,1203 137,1201 139,1198 139,1196 141,1193 143,1186 154,1164 156,1162 163,1149 168,1143 169,1140 172,1137 174,1133 178,1129 178,1128 186,1119 186,1118Z" />
      </g>
    </svg>
    <div className="viewer-settings">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button className="viewer-tool" variant="ghost" size="icon" aria-label="Settings" title="Settings"><Menu /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="viewer-settings-menu">
          <DropdownMenuItem onSelect={onUpload} disabled={uploading}><Upload size={16} />{uploading ? "Opening ZIP…" : "Upload model ZIP"}</DropdownMenuItem>
          {models.map((m) => <DropdownMenuItem key={m.id} disabled={!customModel && activeModel === m.id} onSelect={() => onModel(m.id)}><RotateCcw size={16} />{m.name}{activeModel === m.id ? " (current)" : ""}</DropdownMenuItem>)}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Sun intensity</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu sun-intensity-menu">
              <Slider aria-label="Sun intensity" min={0} max={2} step={0.05} value={[sunIntensity]}
                onValueChange={(values) => { const value = values[0]; if (value !== undefined) onSunIntensity(value); }} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Fancy quality</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu">
              <DropdownMenuRadioGroup value={String(options.fancyQuality)} onValueChange={(v) => onOptions({ fancyQuality: Number(v) })}>
                {["Low", "Medium", "High"].map((label, id) => <DropdownMenuRadioItem key={id} value={String(id)}>{label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Background</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu">
              <DropdownMenuRadioGroup value={String(options.background)} onValueChange={(v) => onOptions({ background: Number(v) })}>
                {BACKGROUNDS.map((o) => <DropdownMenuRadioItem key={o.id} value={String(o.id)}>
                  <span className={`background-swatch swatch-${o.swatch}`} />{o.label}
                </DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Aspect ratio</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu viewer-settings-scroll">
              <DropdownMenuRadioGroup value={options.aspect} onValueChange={(v) => onOptions({ aspect: v })}>
                {ASPECTS.map((o) => <DropdownMenuRadioItem key={o.id} value={o.id}
                  onSelect={(e) => { if (o.id === "custom") e.preventDefault(); }}>{o.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              {options.aspect === "custom" && <form className="ratio-input" onKeyDown={stop}
                onSubmit={(e) => { e.preventDefault(); if (valid) onOptions({ custom: [Number(draft[0]), Number(draft[1])] }); }}>
                <input aria-label="Ratio width" inputMode="decimal" value={draft[0]} onChange={(e) => setDraft([e.target.value, draft[1]])} />
                <span>:</span>
                <input aria-label="Ratio height" inputMode="decimal" value={draft[1]} onChange={(e) => setDraft([draft[0], e.target.value])} />
                <Button type="submit" size="sm" variant="secondary" disabled={!valid}>Apply</Button>
              </form>}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Image resolution</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu">
              <DropdownMenuRadioGroup value={String(options.resolution)} onValueChange={(v) => onOptions({ resolution: Number(v) })}>
                {RESOLUTIONS.map((o) => <DropdownMenuRadioItem key={o.id} value={String(o.id)}>{o.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Shadows</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu">
              <DropdownMenuRadioGroup value={String(options.shadowMode)} onValueChange={(v) => onOptions({ shadowMode: Number(v) })}>
                {SHADOW_MODES.map((o) => <DropdownMenuRadioItem key={o.id} value={String(o.id)}>{o.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Shadow quality</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="viewer-settings-menu">
              <DropdownMenuRadioGroup value={String(options.shadowQuality)} onValueChange={(v) => onOptions({ shadowQuality: Number(v) })}>
                {SHADOW_QUALITIES.map((o) => <DropdownMenuRadioItem key={o.id} value={String(o.id)}>{o.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Button className="viewer-tool viewer-save" variant="ghost" size="icon" onClick={onSave} disabled={saving}
      aria-label="Take picture" title="Take picture">{saving ? <LoaderCircle className="animate-spin" /> : <Camera />}</Button>
    <div className="viewer-fancy-wrap">
      <Button className="viewer-tool viewer-fancy" variant="ghost" size="icon"
        onPointerDown={(event) => { if (event.pointerType === "mouse" && event.button !== 0) return; clearAoHold(); suppressAoClick.current = false; aoHoldTimer.current = setTimeout(() => { suppressAoClick.current = true; setDenoiseMenuOpen(true); }, 500); }}
        onPointerUp={clearAoHold} onPointerLeave={clearAoHold} onPointerCancel={clearAoHold}
        onClick={() => { if (suppressAoClick.current) { suppressAoClick.current = false; return; } onAoV2EnabledChange(!aoV2Enabled); }}
        aria-label="AO V2" aria-pressed={aoV2Enabled} title="AO V2 · Hold for viewport quality"><Sparkles /></Button>
      {denoiseMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 min-w-[190px] rounded-lg border border-white/10 bg-zinc-950 p-3 text-white shadow-xl" role="group" aria-label="Adaptive viewport quality">
        <div className="mb-2 text-xs font-semibold tracking-wide text-white/65">RENDER QUALITY</div>
        <button type="button" role="switch" aria-checked={adaptivePreview} onClick={() => onAdaptivePreviewChange(!adaptivePreview)} className="flex w-full items-center justify-between gap-4 rounded-md px-1 py-2 text-sm hover:bg-white/5">
          <span>Adaptive quality</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${adaptivePreview ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/55"}`}>{adaptivePreview ? "ON" : "OFF"}</span>
        </button>
        <div className="mt-1 text-[10px] leading-relaxed text-white/45">Temporarily lowers render resolution and skips expensive AO and shadow passes while rotating. Full quality returns when the camera settles.</div>
        <button type="button" className="mt-2 w-full border-t border-white/10 pt-2 text-left text-xs text-white/55" onClick={() => setDenoiseMenuOpen(false)}>Close</button>
      </div>}
    </div>
    <Button className="viewer-tool viewer-fancy-graphics" variant="ghost" size="icon" onClick={() => onOptions({ fancy: !options.fancy })}
      aria-label="Fancy graphics" aria-pressed={options.fancy} title={options.fancy ? "Disable Fancy Graphics" : "Enable Fancy Graphics"}><Layers /></Button>
    <div className="viewer-viewport-control-wrap">
      <Button className="viewer-tool viewer-viewport-trigger" variant="ghost" size="icon"
        onClick={() => setViewportPanelOpen((open) => !open)}
        aria-label="Viewport resolution settings" aria-expanded={viewportPanelOpen}
        title={`Viewport resolution: ${viewportResolution}%`}><Gauge /></Button>
      {viewportPanelOpen && <section className="viewer-viewport-popover" aria-label="Viewport resolution control">
        <div className="viewer-viewport-heading"><span>VIEWPORT RESOLUTION</span><strong>{viewportResolution}%</strong></div>
        <Slider min={5} max={100} step={5} value={[viewportResolution]} onValueChange={(values) => { const value = values[0]; if (value !== undefined) onViewportResolutionChange(value); }} aria-label="Viewport resolution" />
        <div className="viewer-viewport-presets">
          {[25, 50, 75, 100].map((value) => <button key={value} type="button" data-active={viewportResolution === value} onClick={() => onViewportResolutionChange(value)}>{value}%</button>)}
        </div>
        <p>Changes viewport rendering only. Model data and exports remain unchanged.</p>
      </section>}
    </div>
    {error && <p className="capture-error" role="alert">{error}</p>}
    <div className="viewer-brightness" title="Brightness">
      <SliderValueReadout value={brightness} min={0.25} max={3} step={0.05} label="brightness" onApply={onBrightness} />
      <Sun size={17} aria-hidden="true" />
      <ArcSlider variant="inner" value={brightness} min={0.25} max={3}
        onChange={onBrightness} label="Brightness" />
    </div>
    <div className={`viewer-shadow-strength ${options.fancy || aoV2Enabled ? "" : "shadow-strength-disabled"}`} title="Shadow slider">
      <SliderValueReadout value={shadowStrength} min={0} max={2} step={0.05} label="shadow strength" disabled={!options.fancy && !aoV2Enabled} onApply={onShadowStrength} />
      <button type="button" className="shadow-settings-trigger" aria-label="Open shadow settings" title="Shadow settings" disabled={!options.fancy && !aoV2Enabled} onClick={() => setShadowPanelOpen(true)}><Moon size={17} aria-hidden="true" /></button>
      <ArcSlider variant="outer" value={shadowStrength} min={0} max={2}
        disabled={!options.fancy && !aoV2Enabled} onChange={onShadowStrength} label="Shadow strength" />
    </div>
    {shadowPanelOpen && <div className="shadow-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShadowPanelOpen(false); }}>
      <section className="shadow-settings-panel" role="dialog" aria-modal="true" aria-label="Shadow settings">
        <header className="shadow-settings-header">
          <button type="button" className="shadow-settings-close" aria-label="Close shadow settings" onClick={() => setShadowPanelOpen(false)}><X size={19} /></button>
        </header>
        <div className="shadow-settings-list">
          {options.fancy && <>
            <ShadowSettingRow title="Directional shadows" description="Shadows cast by the sun across the model." value={shadowComponents.directional} onChange={(value) => onShadowComponents({ directional: value })} disabled={!options.fancy} />
            <ShadowSettingRow title="Contact shadows" description="Darkening where blocks meet or touch nearby surfaces." value={shadowComponents.contact} onChange={(value) => onShadowComponents({ contact: value })} disabled={!options.fancy} />
            <ShadowSettingRow title="Overhang shadows" description="Deeper shade beneath decks, roofs and protruding structures." value={shadowComponents.overhang} onChange={(value) => onShadowComponents({ overhang: value })} disabled={!options.fancy} />
          </>}
          {aoV2Enabled && <>
            {(options.fancy) && <div className="shadow-settings-divider" />}
            <div className="shadow-settings-section-title">AO V2 · GEOMETRY RAYS</div>
            <ShadowSettingRow title="Contact shadows" description="Controls real depth-ray darkening where nearby surfaces meet or nearly touch." value={aoV2ContactStrength} onChange={onAoV2ContactStrengthChange} disabled={!aoV2Enabled} />
            <ShadowSettingRow title="Vertical edge shadows" description="Emphasizes blockers above or below a surface in model space." value={shadowComponents.verticalEdge} onChange={(value) => onShadowComponents({ verticalEdge: value })} disabled={!aoV2Enabled} />
            <ShadowSettingRow title="Horizontal edge shadows" description="Emphasizes lateral blockers around decks, walls and ledges." value={shadowComponents.horizontalEdge} onChange={(value) => onShadowComponents({ horizontalEdge: value })} disabled={!aoV2Enabled} />
            <ShadowSettingRow title="Far-face darkness" description="Darkens sun-opposed block faces by their surface angle to the sun, independent of other shadows." value={shadowComponents.depth} onChange={(value) => onShadowComponents({ depth: value })} disabled={!aoV2Enabled} />
            <ShadowSettingRow title="AO / corner strength" description="Controls contact and corner darkening around geometry intersections." value={shadowComponents.ambient} onChange={(value) => onShadowComponents({ ambient: value })} disabled={!aoV2Enabled} />
          </>}
        </div>
        {!options.fancy && !aoV2Enabled && <p className="shadow-settings-disabled-note">Enable AO V2 or Fancy Graphics to adjust shadow settings.</p>}
        <footer className="shadow-settings-footer"><span>0.00× OFF</span><span>1.00× DEFAULT</span><span>2.00× MAX</span></footer>
      </section>
    </div>}
    <Button className="viewer-tool viewer-projection" variant="ghost" size="icon" onClick={onProjection}
      aria-label="Orthograph" aria-pressed={orthographic} title={orthographic ? "Switch to perspective" : "Switch to orthographic"}><Box /></Button>
    <Button className="viewer-tool viewer-blue-light-trigger" variant="ghost" size="icon" onClick={() => onBlueLightPanelOpenChange(true)}
      aria-label="Blue Sun" title="Open Blue Sun settings"><Lightbulb /></Button>
    {blueLightPanelOpen && <BlueLightPanel value={blueLight} rotation={rotation} onChange={onBlueLightChange} enabled={blueLightEnabled} onToggle={onBlueLightEnabledChange} onClose={() => onBlueLightPanelOpenChange(false)} />}
  </>;
}
