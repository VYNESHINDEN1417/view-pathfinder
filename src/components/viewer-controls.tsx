import { useEffect, useState } from "react";
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
      <section className="shadow-settings-panel" role="dialog" aria-modal="true" aria-labelledby="shadow-settings-title">
        <header className="shadow-settings-header">
          <div><span className="shadow-settings-eyebrow">PATHFINDER / LIGHTING</span><h2 id="shadow-settings-title">SHADOW SETTINGS</h2></div>
          <button type="button" className="shadow-settings-close" aria-label="Close shadow settings" onClick={() => setShadowPanelOpen(false)}><X size={19} /></button>
        </header>
        <p className="shadow-settings-intro">Fine-tune each shadow family independently. The main shadow slider remains the overall strength control.</p>
        <div className="shadow-settings-list">
          <ShadowSettingRow title="Directional shadows" description="Shadows cast by the sun across the model." value={shadowComponents.directional} onChange={(value) => onShadowComponents({ directional: value })} disabled={!options.fancy} />
          <ShadowSettingRow title="Contact shadows" description="Darkening where blocks meet or touch nearby surfaces." value={shadowComponents.contact} onChange={(value) => onShadowComponents({ contact: value })} disabled={!options.fancy} />
          <ShadowSettingRow title="Overhang shadows" description="Deeper shade beneath decks, roofs and protruding structures." value={shadowComponents.overhang} onChange={(value) => onShadowComponents({ overhang: value })} disabled={!options.fancy} />
          <ShadowSettingRow title="Block-edge shadows" description="Tight, subtle dark lines that define individual block boundaries." value={shadowComponents.edge} onChange={(value) => onShadowComponents({ edge: value })} disabled={!options.fancy} />
          <ShadowSettingRow title="Ambient occlusion" description="Soft corner and gap shading that adds depth to enclosed spaces." value={shadowComponents.ambient} onChange={(value) => onShadowComponents({ ambient: value })} disabled={!options.fancy} />
        </div>
        {!options.fancy && <p className="shadow-settings-disabled-note">Enable Fancy Graphics to adjust shadow rendering.</p>}
        <footer className="shadow-settings-footer"><span>0.00× OFF</span><span>1.00× DEFAULT</span><span>2.00× MAX</span></footer>
      </section>
    </div>}
    <Button className="viewer-tool viewer-projection" variant="ghost" size="icon" onClick={onProjection}
      aria-label="Orthographic view" aria-pressed={orthographic} title={orthographic ? "Switch to perspective" : "Switch to orthographic"}><Box /></Button>
  </>;
}
