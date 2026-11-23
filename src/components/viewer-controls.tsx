import { useEffect, useRef, useState } from "react";
import { Camera, Menu, Box, Sun, Moon, LoaderCircle, Upload, RotateCcw, Sparkles, X, Lightbulb } from "lucide-react";
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

export function ViewerControls({ options, brightness, shadowStrength, shadowComponents, orthographic, rotation, saving, error, onOptions, onBrightness, onShadowStrength, onShadowComponents, onProjection, onSave, uploading, customModel, onUpload, models, activeModel, onModel, sunIntensity, onSunIntensity, blueLight, onBlueLightChange, blueLightEnabled, onBlueLightEnabledChange, blueLightPanelOpen, onBlueLightPanelOpenChange, aoV2Enabled, onAoV2EnabledChange, aoV2ContactStrength, onAoV2ContactStrengthChange, noiseReduction, onNoiseReductionChange }: {
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
}) {
  const [draft, setDraft] = useState<[string, string]>([String(options.custom[0]), String(options.custom[1])]);
  const [shadowPanelOpen, setShadowPanelOpen] = useState(false);\n  const [denoiseMenuOpen, setDenoiseMenuOpen] = useState(false);\n  const aoHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n  const suppressAoClick = useRef(false);\n  const clearAoHold = () => { if (aoHoldTimer.current) clearTimeout(aoHoldTimer.current); aoHoldTimer.current = null; };
  const valid = parseRatio(Number(draft[0]), Number(draft[1])) > 0;
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  return <>
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
          <DropdownMenuItem onSelect={() => onOptions({ fancy: !options.fancy })}>{options.fancy ? "✓ Fancy Graphics" : "Fancy Graphics"}</DropdownMenuItem>
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
      aria-label="Save image" title="Save PNG image">{saving ? <LoaderCircle className="animate-spin" /> : <Camera />}</Button>
    <Button className="viewer-tool viewer-fancy" variant="ghost" size="icon" onClick={() => onAoV2EnabledChange(!aoV2Enabled)}
      aria-label="AO V2" aria-pressed={aoV2Enabled} title={aoV2Enabled ? "Disable AO V2" : "Enable AO V2"}><Sparkles /></Button>
    {error && <p className="capture-error" role="alert">{error}</p>}
    <div className="viewer-brightness" title="Brightness">
      <SliderValueReadout value={brightness} min={0.25} max={3} step={0.05} label="brightness" onApply={onBrightness} />
      <Sun size={17} aria-hidden="true" />
      <Slider orientation="vertical" className="brightness-slider" min={0.25} max={3} step={0.05}
        value={[brightness]} onValueChange={(values) => { const value = values[0]; if (value !== undefined) onBrightness(value); }}
        aria-label="Brightness" />
    </div>
    <div className={`viewer-shadow-strength ${options.fancy || aoV2Enabled ? "" : "shadow-strength-disabled"}`} title="Shadow strength">
      <SliderValueReadout value={shadowStrength} min={0} max={2} step={0.05} label="shadow strength" disabled={!options.fancy && !aoV2Enabled} onApply={onShadowStrength} />
      <button type="button" className="shadow-settings-trigger" aria-label="Open shadow settings" title="Shadow settings" disabled={!options.fancy && !aoV2Enabled} onClick={() => setShadowPanelOpen(true)}><Moon size={17} aria-hidden="true" /></button>
      <Slider orientation="vertical" className="shadow-strength-slider" min={0} max={2} step={0.05}
        value={[shadowStrength]} disabled={!options.fancy && !aoV2Enabled}
        onValueChange={(values) => { const value = values[0]; if (value !== undefined) onShadowStrength(value); }}
        aria-label="Shadow strength" />
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
      aria-label="Orthographic view" aria-pressed={orthographic} title={orthographic ? "Switch to perspective" : "Switch to orthographic"}><Box /></Button>
    <Button className="viewer-tool viewer-blue-light-trigger" variant="ghost" size="icon" onClick={() => onBlueLightPanelOpenChange(true)}
      aria-label="Blue light settings" title="Blue light settings"><Lightbulb /></Button>
    {blueLightPanelOpen && <BlueLightPanel value={blueLight} rotation={rotation} onChange={onBlueLightChange} enabled={blueLightEnabled} onToggle={onBlueLightEnabledChange} onClose={() => onBlueLightPanelOpenChange(false)} />}
  </>;
}
