import { useEffect, useRef, useState } from "react";
import { Camera, Menu, Box, Sun, Moon, LoaderCircle, Upload, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ASPECTS, BACKGROUNDS, RESOLUTIONS, SHADOW_MODES, SHADOW_QUALITIES, parseRatio } from "@/lib/viewer-settings";

export type ShadowComponents = { directional: number; contact: number; overhang: number; edge: number; ambient: number };

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

const AO_TUNING_CONTROLS = [
  { label: "Corner depth", detail: "Strengthen darkening in tight inside corners.", family: "ambient" },
  { label: "Enclosed-space shade", detail: "Increase occlusion inside enclosed spaces.", family: "ambient" },
  { label: "Crevice darkness", detail: "Tune narrow cracks and recessed gaps.", family: "ambient" },
  { label: "Cavity fill", detail: "Adjust the depth of broad hidden cavities.", family: "ambient" },
  { label: "Block contact", detail: "Darken surfaces where blocks meet.", family: "contact" },
  { label: "Joint definition", detail: "Emphasize seams between touching blocks.", family: "contact" },
  { label: "Near-surface contact", detail: "Tune short-distance contact shading.", family: "contact" },
  { label: "Under-deck shade", detail: "Strengthen occlusion beneath overhangs.", family: "overhang" },
  { label: "Roof underside", detail: "Tune shade below roofs and platforms.", family: "overhang" },
  { label: "Beam underside", detail: "Adjust shade beneath narrow protrusions.", family: "overhang" },
  { label: "Deep overhang", detail: "Increase shade in deeply recessed undersides.", family: "overhang" },
  { label: "Edge definition", detail: "Tune the darkness along block boundaries.", family: "edge" },
  { label: "Corner edge", detail: "Emphasize edges where two faces meet.", family: "edge" },
  { label: "Fine seam", detail: "Adjust thin, close-range edge shading.", family: "edge" },
  { label: "Broad edge", detail: "Adjust wider edge transitions.", family: "edge" },
  { label: "Directional contrast", detail: "Tune the contribution of sun-cast shadows.", family: "directional" },
] as const;

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

export function ViewerControls({ options, brightness, shadowStrength, shadowComponents, orthographic, saving, error, onOptions, onBrightness, onShadowStrength, onShadowComponents, onProjection, onSave, uploading, customModel, onUpload, models, activeModel, onModel, sunIntensity, onSunIntensity }: {
  options: ViewerOptions; brightness: number; shadowStrength: number; shadowComponents: ShadowComponents; orthographic: boolean; saving: boolean; error: string;
  onOptions: (patch: Partial<ViewerOptions>) => void; onBrightness: (value: number) => void; onShadowStrength: (value: number) => void; onShadowComponents: (patch: Partial<ShadowComponents>) => void;
  onProjection: () => void; onSave: () => void;
  uploading: boolean; customModel: boolean; onUpload: () => void; models: { id: string; name: string }[]; activeModel: string; onModel: (id: string) => void;
  sunIntensity: number; onSunIntensity: (value: number) => void;
}) {
  const [draft, setDraft] = useState<[string, string]>([String(options.custom[0]), String(options.custom[1])]);
  const [shadowPanelOpen, setShadowPanelOpen] = useState(false);
  const [aoTuning, setAoTuning] = useState<number[]>(() => AO_TUNING_CONTROLS.map((control) => control.label === "Under-deck shade" ? 0.35 : 1));
  const baseShadowRef = useRef(shadowComponents);
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
    <Button className="viewer-tool viewer-fancy" variant="ghost" size="icon" onClick={() => onOptions({ fancy: !options.fancy })}
      aria-label="Fancy Graphics" aria-pressed={options.fancy} title={options.fancy ? "Disable Fancy Graphics" : "Enable Fancy Graphics"}><Sparkles /></Button>
    {error && <p className="capture-error" role="alert">{error}</p>}
    <div className="viewer-brightness" title="Brightness">
      <SliderValueReadout value={brightness} min={0.25} max={3} step={0.05} label="brightness" onApply={onBrightness} />
      <Sun size={17} aria-hidden="true" />
      <Slider orientation="vertical" className="brightness-slider" min={0.25} max={3} step={0.05}
        value={[brightness]} onValueChange={(values) => { const value = values[0]; if (value !== undefined) onBrightness(value); }}
        aria-label="Brightness" />
    </div>
    <div className={`viewer-shadow-strength ${options.fancy ? "" : "shadow-strength-disabled"}`} title="Shadow strength">
      <SliderValueReadout value={shadowStrength} min={0} max={2} step={0.05} label="shadow strength" disabled={!options.fancy} onApply={onShadowStrength} />
      <button type="button" className="shadow-settings-trigger" aria-label="Open shadow settings" title="Shadow settings" disabled={!options.fancy} onClick={() => setShadowPanelOpen(true)}><Moon size={17} aria-hidden="true" /></button>
      <Slider orientation="vertical" className="shadow-strength-slider" min={0} max={2} step={0.05}
        value={[shadowStrength]} disabled={!options.fancy}
        onValueChange={(values) => { const value = values[0]; if (value !== undefined) onShadowStrength(value); }}
        aria-label="Shadow strength" />
    </div>
    {shadowPanelOpen && <div className="shadow-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShadowPanelOpen(false); }}>
      <section className="shadow-settings-panel" role="dialog" aria-modal="true" aria-label="Shadow settings">
        <header className="shadow-settings-header">
          <button type="button" className="shadow-settings-close" aria-label="Close shadow settings" onClick={() => setShadowPanelOpen(false)}><X size={19} /></button>
        </header>
        <div className="shadow-settings-lab-heading">
          <strong>AO CONTROL LABORATORY</strong>
          <span>16 live tuning controls · neutral = 1.00×</span>
        </div>
        <div className="shadow-settings-list">
          {AO_TUNING_CONTROLS.map((control, index) => {
            const value = aoTuning[index] ?? 1;
            const update = (next: number) => {
              const values = [...aoTuning];
              values[index] = next;
              setAoTuning(values);
              const multiplier = AO_TUNING_CONTROLS.reduce((product, item, i) =>
                item.family === control.family ? product * (values[i] ?? 1) : product, 1);
              const base = baseShadowRef.current[control.family];
              onShadowComponents({ [control.family]: Math.min(2, Math.max(0, base * multiplier)) });
            };
            return <ShadowSettingRow key={control.label} title={control.label} description={control.detail}
              value={value} onChange={update} disabled={!options.fancy} />;
          })}
        </div>
        {!options.fancy && <p className="shadow-settings-disabled-note">Enable Fancy Graphics to adjust shadow rendering.</p>}
        <footer className="shadow-settings-footer"><span>0.00× OFF</span><span>1.00× NEUTRAL</span><span>2.00× MAX</span></footer>
      </section>
    </div>}
    <Button className="viewer-tool viewer-projection" variant="ghost" size="icon" onClick={onProjection}
      aria-label="Orthographic view" aria-pressed={orthographic} title={orthographic ? "Switch to perspective" : "Switch to orthographic"}><Box /></Button>
  </>;
}
