import { useState } from "react";
import { Camera, Menu, Box, Sun, LoaderCircle, Upload, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ASPECTS, BACKGROUNDS, RESOLUTIONS, SHADOW_MODES, SHADOW_QUALITIES, parseRatio } from "@/lib/viewer-settings";

export type ViewerOptions = {
  background: number; aspect: string; custom: [number, number]; resolution: number; shadowMode: number; shadowQuality: number; fancy: boolean; fancyQuality: number;
};

export function ViewerControls({ options, brightness, orthographic, saving, error, onOptions, onBrightness, onProjection, onSave, uploading, customModel, onUpload, models, activeModel, onModel, sunIntensity, onSunIntensity }: {
  options: ViewerOptions; brightness: number; orthographic: boolean; saving: boolean; error: string;
  onOptions: (patch: Partial<ViewerOptions>) => void; onBrightness: (value: number) => void;
  onProjection: () => void; onSave: () => void;
  uploading: boolean; customModel: boolean; onUpload: () => void; models: { id: string; name: string }[]; activeModel: string; onModel: (id: string) => void;
  sunIntensity: number; onSunIntensity: (value: number) => void;
}) {
  const [draft, setDraft] = useState<[string, string]>([String(options.custom[0]), String(options.custom[1])]);
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
      <Sun size={17} aria-hidden="true" />
      <Slider orientation="vertical" className="brightness-slider" min={0.25} max={3} step={0.05}
        value={[brightness]} onValueChange={(values) => { const value = values[0]; if (value !== undefined) onBrightness(value); }}
        aria-label="Brightness" />
    </div>
    <Button className="viewer-tool viewer-projection" variant="ghost" size="icon" onClick={onProjection}
      aria-label="Orthographic view" aria-pressed={orthographic} title={orthographic ? "Switch to perspective" : "Switch to orthographic"}><Box /></Button>
  </>;
}
