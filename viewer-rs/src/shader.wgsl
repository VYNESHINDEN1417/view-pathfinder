struct Globals {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>, // xyz = direction (towards light), w = intensity
  screen: vec4<f32>, // xy = framebuffer size in pixels
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
  let h = normalize(l + v);
  let t = textureSample(tex, samp, in.uv);
  var kd = m.diffuse.rgb;
  if (m.flags.x > 0.5) { kd = kd * t.rgb; }
  let diff = max(dot(n, l), 0.0);
  let fill = 0.35 * max(dot(n, normalize(vec3<f32>(-0.4, 0.8, 0.3))), 0.0) + 0.15;
  let spec = pow(max(dot(n, h), 0.0), max(m.specular.w, 1.0));
  let color = m.ambient.rgb * 0.3 + kd * (diff * g.light.w + fill) + m.specular.rgb * spec * 0.5 * g.light.w;
  return vec4<f32>(color, 1.0);
}
