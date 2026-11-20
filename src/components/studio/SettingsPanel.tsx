import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { StudioSettings } from "./settings";

type Set = <K extends keyof StudioSettings>(k: K, v: StudioSettings[K]) => void;

function Choice<T extends string | number>({ label, desc, value, options, onChange, disabled }: {
  label: string; desc?: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length > 4 ? 3 : options.length}, minmax(0,1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <Button variant="ghost" key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} disabled={disabled}
            data-active={value === o.v} className="studio-btn" onClick={() => onChange(o.v)}>
            {o.l}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange, disabled }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-[56px] items-center justify-between gap-4 rounded-xl border border-border bg-muted px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-sm text-muted-foreground">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} className="scale-125 shrink-0" />
    </label>
  );
}

function BitrateControl({ value, onChange, disabled, duration }: {
  value: number; onChange: (value: number) => void; disabled: boolean; duration: number;
}) {
  const presets = [12, 24, 40, 60, 80];
  const estimatedMb = (value * duration) / 8;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Video bitrate</p>
          <p className="text-sm text-muted-foreground">Higher bitrate preserves more detail, with larger files.</p>
        </div>
        <strong className="shrink-0 font-mono text-lg text-primary">{value} Mbps</strong>
      </div>
      <Slider min={8} max={80} step={2} value={[value]} disabled={disabled}
        onValueChange={(values) => { const next = values[0]; if (next !== undefined) onChange(next); }}
        aria-label="Video bitrate in megabits per second" />
      <div className="flex justify-between text-xs text-muted-foreground"><span>8 Mbps · Smaller</span><span>80 Mbps · Larger</span></div>
      <div className="grid grid-cols-5 gap-2" aria-label="Bitrate presets">
        {presets.map((preset) => (
          <Button key={preset} type="button" variant="ghost" disabled={disabled} data-active={value === preset}
            className="studio-btn px-1 text-xs" onClick={() => onChange(preset)}>{preset}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Approx. {estimatedMb.toFixed(1)} MB for {duration}s, before audio and container overhead.</p>
    </div>
  );
}

export function SettingsPanel({ s, set, locked }: { s: StudioSettings; set: Set; locked: boolean }) {
  const sections = [
    { id: "video", title: "Video Output", body: (
      <>
        <Choice label="Resolution" value={s.resolution} disabled={locked} onChange={(v) => set("resolution", v)}
          options={[{ v: "720p", l: "720p" }, { v: "1080p", l: "1080p" }, { v: "1440p", l: "2K" }, { v: "2160p", l: "4K" }]} />
        <Choice label="Aspect ratio" value={s.aspect} disabled={locked} onChange={(v) => set("aspect", v)}
          options={[{ v: "9:16", l: "9:16" }, { v: "16:9", l: "16:9" }, { v: "1:1", l: "1:1" }, { v: "21:9", l: "21:9" }, { v: "4:3", l: "4:3" }, { v: "custom", l: "Custom" }]} />
        {s.aspect === "custom" && <div className="ratio-input">
          <input type="number" aria-label="Aspect width" min="1" disabled={locked} value={s.customAspect[0]} onChange={(e) => set("customAspect", [Number(e.target.value), s.customAspect[1]])} />
          <span>:</span>
          <input type="number" aria-label="Aspect height" min="1" disabled={locked} value={s.customAspect[1]} onChange={(e) => set("customAspect", [s.customAspect[0], Number(e.target.value)])} />
        </div>}
        <Choice label="Frame rate" value={s.fps} disabled={locked} onChange={(v) => set("fps", v)}
          options={[{ v: 24, l: "24 fps" }, { v: 30, l: "30 fps" }, { v: 60, l: "60 fps" }]} />
      </>
    ) },
    { id: "camera", title: "Camera Animation", body: (
      <>
        <Choice label="Duration" value={s.duration} disabled={locked} onChange={(v) => set("duration", v)}
          options={[{ v: 4, l: "4s" }, { v: 6, l: "6s" }, { v: 10, l: "10s" }, { v: 15, l: "15s" }, { v: 30, l: "30s" }, { v: 60, l: "1m" }]} />
        <Toggle label="Smooth easing" desc="Ease in and out between keyframes." checked={s.smoothing} onChange={(v) => set("smoothing", v)} disabled={locked} />
        <Toggle label="Loop preview" desc="Repeat the preview until stopped." checked={s.loop} onChange={(v) => set("loop", v)} />
      </>
    ) },
    { id: "light", title: "Lighting and Shadows", body: (
      <Toggle label="Real-time shadows" desc="Sun shadows on the ship in the video." checked={s.shadows} onChange={(v) => set("shadows", v)} disabled={locked} />
    ) },
    { id: "enc", title: "Encoding Quality", body: (
      <BitrateControl value={s.bitrate} duration={s.duration} disabled={locked} onChange={(v) => set("bitrate", v)} />
    ) },
  ];
  return (
    <Accordion type="single" collapsible defaultValue="video" className="space-y-2">
      {sections.map((sec, i) => (
        <AccordionItem key={sec.id} value={sec.id} className="rounded-xl border border-border bg-card px-4">
          <AccordionTrigger className="min-h-[56px] text-base font-semibold hover:no-underline">
            <span><span className="mr-2 font-mono text-muted-foreground">{i + 1}</span>{sec.title}</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">{sec.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
