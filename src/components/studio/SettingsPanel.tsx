import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
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
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} disabled={disabled}
            data-active={value === o.v} className="studio-btn" onClick={() => onChange(o.v)}>
            {o.l}
          </button>
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

export function SettingsPanel({ s, set, locked }: { s: StudioSettings; set: Set; locked: boolean }) {
  const sections = [
    { id: "video", title: "Video Output", body: (
      <>
        <Choice label="Resolution" value={s.resolution} disabled={locked} onChange={(v) => set("resolution", v)}
          options={[{ v: "720p", l: "720p" }, { v: "1080p", l: "1080p" }, { v: "1440p", l: "2K" }, { v: "2160p", l: "4K" }]} />
        <Choice label="Aspect ratio" desc="9:16 suits phone stories and reels." value={s.aspect} disabled={locked} onChange={(v) => set("aspect", v)}
          options={[{ v: "9:16", l: "9:16" }, { v: "16:9", l: "16:9" }, { v: "1:1", l: "1:1" }]} />
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
      <Choice label="Bitrate" desc="Higher means sharper video and bigger files." value={s.bitrate} disabled={locked} onChange={(v) => set("bitrate", v)}
        options={[{ v: "low", l: "Low" }, { v: "medium", l: "Medium" }, { v: "high", l: "High" }, { v: "ultra", l: "Ultra" }]} />
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
