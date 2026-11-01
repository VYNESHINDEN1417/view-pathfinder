import { Camera, Menu, Box, Sun, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { BACKGROUNDS } from "@/lib/viewer-settings";

export function ViewerControls({ background, brightness, orthographic, saving, error, onBackground, onBrightness, onProjection, onSave }: {
  background: number; brightness: number; orthographic: boolean; saving: boolean; error: string;
  onBackground: (mode: number) => void; onBrightness: (value: number) => void;
  onProjection: () => void; onSave: () => void;
}) {
  return <>
    <div className="viewer-settings">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button className="viewer-tool" variant="ghost" size="icon" aria-label="Settings" title="Settings"><Menu /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="viewer-settings-menu">
          <DropdownMenuLabel>Background</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(background)} onValueChange={(value) => onBackground(Number(value))}>
            {BACKGROUNDS.map((option) => <DropdownMenuRadioItem key={option.id} value={String(option.id)}>
              <span className={`background-swatch swatch-${option.swatch}`} />{option.label}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Button className="viewer-tool viewer-save" variant="ghost" size="icon" onClick={onSave} disabled={saving}
      aria-label="Save image" title="Save PNG image">{saving ? <LoaderCircle className="animate-spin" /> : <Camera />}</Button>
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