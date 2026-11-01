struct Globals {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>, // xyz = direction (towards light), w = intensity
  screen: vec4<f32>, // xy = framebuffer size in pixels
  light_vp: mat4x4<f32>,
};

struct Material {
  ambient: vec4<f32>,
  diffuse: vec4<f32>,   // a = dissolve
  specular: vec4<f32>,  // w = shininess
  flags: vec4<f32>,     // x = has texture
};

@group(0) @binding(0) var<uniform> g: Globals;
@group(1) @binding(0) var<uniform> m: Material;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(2) @binding(0) var shadow_tex: texture_depth_2d;
@group(2) @binding(1) var shadow_samp: sampler_comparison;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VsOut {
  var o: VsOut;
  o.pos = g.view_proj * vec4<f32>(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  var n = normalize(in.normal);
  let v = normalize(g.eye.xyz - in.world);
  if (dot(n, v) < 0.0) { n = -n; }
  let l = normalize(g.light.xyz);
  let t = textureSample(tex, samp, in.uv);
  var kd = m.diffuse.rgb;
  if (m.flags.x > 0.5) { kd = kd * t.rgb; }
  let diff = max(dot(n, l), 0.0);
  let lp = g.light_vp * vec4<f32>(in.world, 1.0);
  let ndc = lp.xyz / lp.w;
  let uv = ndc.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  // Four fixed comparison taps provide inexpensive PCF without blurring block textures.
  // All implicit-derivative samples occur before the alpha discard.
  let step = vec2<f32>(0.5) / vec2<f32>(textureDimensions(shadow_tex));
  let depth = ndc.z - 0.0015;
  let shadow = 0.25 * (
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>(-step.x, -step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>( step.x, -step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>(-step.x,  step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>( step.x,  step.y), depth));
  if (m.flags.x > 0.5 && t.a * m.diffuse.a < 0.3) { discard; }
  var visibility = shadow;
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { visibility = 1.0; }
  // Two cheap, bounded diffuse interactions: sky/ground fill then subtle albedo bounce.
  let bounce_one = 0.22 + 0.08 * max(n.y, 0.0);
  let bounce_two = kd * 0.035 * max(-n.y, 0.0);
   let color = (kd * (bounce_one + diff * visibility * 0.78) + bounce_two) * g.light.w;
  return vec4<f32>(color, 1.0);
}

@vertex
fn vs_shadow(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VsOut {
  var o: VsOut;
  o.pos = g.light_vp * vec4<f32>(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.uv = uv;
  return o;
}

@fragment
fn fs_shadow(in: VsOut) {
  let alpha = textureSample(tex, samp, in.uv).a;
  if (m.flags.x > 0.5 && alpha * m.diffuse.a < 0.3) { discard; }
}

// Fullscreen background: vertical gradient, lighter grey at top fading to black at bottom.
@vertex
fn vs_bg(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_bg(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  if (g.screen.z > 0.5 && g.screen.z < 1.5) { return vec4<f32>(1.0); }
  if (g.screen.z > 1.5 && g.screen.z < 2.5) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
  let t = clamp(1.0 - pos.y / max(g.screen.y, 1.0), 0.0, 1.0);
  let top = vec3<f32>(0.16, 0.16, 0.18);
  let bottom = vec3<f32>(0.0, 0.0, 0.0);
  return vec4<f32>(mix(bottom, top, t * t * (3.0 - 2.0 * t)) * g.light.w, 1.0);
}
