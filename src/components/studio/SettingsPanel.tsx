import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { StudioSettings } from "./settings";

type Set = <K extends keyof StudioSettings>(k: K, v: StudioSettings[K]) => void;

function Choice<T extends string | number>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="studio-setting-field">
      <p className="studio-setting-label">{label}</p>
      <div className="studio-setting-choices" style={{ gridTemplateColumns: `repeat(${options.length > 4 ? 3 : options.length}, minmax(0,1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <Button variant="ghost" key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} disabled={disabled}
            data-active={value === o.v} className="studio-setting-choice" onClick={() => onChange(o.v)}>
            {o.l}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="studio-setting-toggle">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} className="shrink-0" />
    </label>
  );
}

function BitrateControl({ value, onChange, disabled, duration }: {
  value: number; onChange: (value: number) => void; disabled: boolean; duration: number;
}) {
  const presets = [12, 24, 40, 60, 80];
  const estimatedMb = (value * duration) / 8;
  return (
    <div className="studio-setting-field studio-bitrate">
      <div className="studio-setting-inline">
        <p className="studio-setting-label">Video bitrate</p>
        <strong>{value} Mbps</strong>
      </div>
      <Slider min={8} max={80} step={2} value={[value]} disabled={disabled}
        onValueChange={(values) => { const next = values[0]; if (next !== undefined) onChange(next); }}
        aria-label="Video bitrate in megabits per second" />
      <div className="studio-setting-choices studio-bitrate-presets" aria-label="Bitrate presets">
        {presets.map((preset) => (
          <Button key={preset} type="button" variant="ghost" disabled={disabled} data-active={value === preset}
            className="studio-setting-choice" onClick={() => onChange(preset)}>{preset}</Button>
        ))}
      </div>
      <p className="studio-setting-note">Approx. {estimatedMb.toFixed(1)} MB at {duration}s</p>
    </div>
  );
}

export function SettingsPanel({ s, set, locked }: { s: StudioSettings; set: Set; locked: boolean }) {
  return (
    <div className="studio-settings-compact">
      <section className="studio-settings-card">
        <h3>Video Output</h3>
        <Choice label="Resolution" value={s.resolution} disabled={locked} onChange={(v) => set("resolution", v)}
          options={[{ v: "720p", l: "720p" }, { v: "1080p", l: "1080p" }, { v: "1440p", l: "2K" }, { v: "2160p", l: "4K" }]} />
        <Choice label="Aspect ratio" value={s.aspect} disabled={locked} onChange={(v) => set("aspect", v)}
          options={[{ v: "9:16", l: "9:16" }, { v: "16:9", l: "16:9" }, { v: "1:1", l: "1:1" }, { v: "21:9", l: "21:9" }, { v: "4:3", l: "4:3" }, { v: "custom", l: "Custom" }]} />
        {s.aspect === "custom" && <div className="ratio-input studio-custom-ratio">
          <input type="number" aria-label="Aspect width" min="1" disabled={locked} value={s.customAspect[0]} onChange={(e) => set("customAspect", [Number(e.target.value), s.customAspect[1]])} />
          <span>:</span>
          <input type="number" aria-label="Aspect height" min="1" disabled={locked} value={s.customAspect[1]} onChange={(e) => set("customAspect", [s.customAspect[0], Number(e.target.value)])} />
        </div>}
        <Choice label="Frame rate" value={s.fps} disabled={locked} onChange={(v) => set("fps", v)}
          options={[{ v: 24, l: "24" }, { v: 30, l: "30" }, { v: 60, l: "60" }, { v: 90, l: "90" }]} />
        <p className="studio-setting-note">Frame rate in fps · 90 fps depends on device encoder support.</p>
      </section>
      <section className="studio-settings-card">
        <h3>Camera Animation</h3>
        <Choice label="Duration" value={s.duration} disabled={locked} onChange={(v) => set("duration", v)}
          options={[{ v: 4, l: "4s" }, { v: 6, l: "6s" }, { v: 10, l: "10s" }, { v: 15, l: "15s" }, { v: 30, l: "30s" }, { v: 60, l: "1m" }]} />
        <Toggle label="Smooth easing" checked={s.smoothing} onChange={(v) => set("smoothing", v)} disabled={locked} />
        <Toggle label="Loop preview" checked={s.loop} onChange={(v) => set("loop", v)} />
      </section>
      <section className="studio-settings-card">
        <h3>Lighting</h3>
        <Toggle label="Real-time shadows" checked={s.shadows} onChange={(v) => set("shadows", v)} disabled={locked} />
      </section>
      <section className="studio-settings-card">
        <h3>Encoding Quality</h3>
        <BitrateControl value={s.bitrate} duration={s.duration} disabled={locked} onChange={(v) => set("bitrate", v)} />
        <Toggle label="Noise reduction" checked={s.noiseReduction} onChange={(v) => set("noiseReduction", v)} disabled={locked} />
      </section>
    </div>
  );
}
