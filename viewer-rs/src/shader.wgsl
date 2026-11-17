struct Globals {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>, // xyz = direction (towards light), w = intensity
  screen: vec4<f32>, // xy = framebuffer size in pixels
  light_vp: mat4x4<f32>,
  inverse_vp: mat4x4<f32>,
  effects: vec4<f32>,
};

struct Material {
  ambient: vec4<f32>,
  diffuse: vec4<f32>,   // a = dissolve
  specular: vec4<f32>,  // w = shininess
  flags: vec4<f32>,     // x = has texture
};

@group(0) @binding(0) var<uniform> g: Globals;
@group(1) @binding(0) var bg_tex: texture_2d<f32>;
@group(1) @binding(1) var bg_samp: sampler;
@group(1) @binding(0) var<uniform> m: Material;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var samp_aniso: sampler;
@group(2) @binding(0) var shadow_tex: texture_depth_2d;
@group(2) @binding(1) var shadow_samp: sampler_comparison;
@group(3) @binding(0) var scene_depth: texture_depth_2d;

fn ambient_occlusion(pixel: vec2<f32>, world: vec3<f32>, normal: vec3<f32>) -> f32 {
  if (g.effects.x < 0.5) { return 1.0; }
  let size = vec2<f32>(textureDimensions(scene_depth));
  let reach = g.effects.w;
  let projected = g.view_proj * vec4<f32>(world + vec3<f32>(reach, 0.0, 0.0), 1.0);
  let center = g.view_proj * vec4<f32>(world, 1.0);
  let radius_px = clamp(abs(projected.x / projected.w - center.x / center.w) * size.x * 0.5, 3.0, 28.0);
  var blocked = 0.0;
  let count = 3u + u32(g.effects.y) * 4u;
  for (var i = 0u; i < 12u; i++) {
    if (i >= count) { break; }
    let angle = f32(i) * 2.399963;
    let offset = vec2<f32>(cos(angle), sin(angle)) * radius_px * (0.35 + 0.65 * f32(i + 1u) / f32(count));
    let coord = vec2<i32>(clamp(pixel + offset, vec2<f32>(0.0), size - 1.0));
    let depth = textureLoad(scene_depth, coord, 0);
    if (depth < 0.99999) {
      let uv = (vec2<f32>(coord) + 0.5) / size;
      let reconstructed = g.inverse_vp * vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), depth, 1.0);
      let delta = reconstructed.xyz / reconstructed.w - world;
      let distance = length(delta);
      if (distance > reach * 0.04 && distance < reach * 2.0) {
        blocked += max(dot(normal, delta / distance) - 0.12, 0.0) * (1.0 - smoothstep(reach * 0.3, reach * 2.0, distance));
      }
    }
  }
  return clamp(1.0 - blocked * 1.8 / f32(count), 0.65, 1.0);
}

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
  // Select anisotropic filtering only when the UV footprint is both minified
  // and strongly stretched. This targets distant deck planks without softening
  // close-up Minecraft texels or ordinary front-facing surfaces.
  let uv_dx = dpdx(in.uv);
  let uv_dy = dpdy(in.uv);
  let tex_size = vec2<f32>(textureDimensions(tex));
  // Build the screen-to-texel Jacobian. Comparing |dUV/dx| and |dUV/dy|
  // misses stretched footprints when the UV axes are rotated or skewed.
  let dx_tex = uv_dx * tex_size;
  let dy_tex = uv_dy * tex_size;
  let j00 = dot(dx_tex, dx_tex);
  let j01 = dot(dx_tex, dy_tex);
  let j11 = dot(dy_tex, dy_tex);
  let trace = j00 + j11;
  let determinant = max(j00 * j11 - j01 * j01, 0.0);
  let discriminant = sqrt(max(trace * trace - 4.0 * determinant, 0.0));
  let major_footprint = sqrt(max(0.5 * (trace + discriminant), 0.0));
  let minor_footprint = sqrt(max(0.5 * (trace - discriminant), 0.00000001));
  let footprint_ratio = major_footprint / minor_footprint;
  // Keep the crisp nearest-magnification path for close views, then transition
  // continuously to the linear, high-anisotropy sampler as the texel footprint
  // becomes minified. The ratio term increases filtering for grazing angles.
  let minification_weight = smoothstep(1.0, 1.35, major_footprint);
  let anisotropy_weight = smoothstep(1.0, 1.8, footprint_ratio);
  let filter_weight = minification_weight * anisotropy_weight;
  let crisp_sample = textureSampleGrad(tex, samp, in.uv, uv_dx, uv_dy);
  let aniso_sample = textureSampleGrad(tex, samp_aniso, in.uv, uv_dx, uv_dy);
  let t = mix(crisp_sample, aniso_sample, filter_weight);
  // Preserve source texture brightness while retaining intentional MTL color
  // tints. Minecraft grass-top textures are often grayscale masks whose green
  // color is supplied by MTL Kd; ignoring Kd turns the top face gray. Normalize
  // the tint by its brightest channel so neutral exporter defaults (e.g. 0.7)
  // do not darken every textured material.
  var kd = m.diffuse.rgb;
  if (m.flags.x > 0.5) {
    let tint_peak = max(m.diffuse.r, max(m.diffuse.g, m.diffuse.b));
    let normalized_tint = m.diffuse.rgb / max(tint_peak, 0.001);
    kd = t.rgb * normalized_tint;
  }
  let diff = max(dot(n, l), 0.0);
  let lp = g.light_vp * vec4<f32>(in.world, 1.0);
  let ndc = lp.xyz / lp.w;
  let uv = ndc.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  // Four fixed comparison taps provide inexpensive PCF without blurring block textures.
  // All implicit-derivative samples occur before the alpha discard.
  // Keep PCF tightly clustered. The previous 1.5–3.5 texel radius blurred
  // even 2048/4096 maps enough to make High look like Low. Resolution now
  // controls world-space edge precision; filtering stays sub-texel.
  let step = vec2<f32>(select(0.5, 0.75, g.effects.x > 0.5)) / vec2<f32>(textureDimensions(shadow_tex));
  let depth = ndc.z - 0.0015;
  let shadow = 0.25 * (
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>(-step.x, -step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>( step.x, -step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>(-step.x,  step.y), depth) +
    textureSampleCompare(shadow_tex, shadow_samp, uv + vec2<f32>( step.x,  step.y), depth));
  if (m.flags.x > 0.5 && t.a * m.diffuse.a < 0.3) { discard; }
  var visibility = shadow;
  let shadows_enabled = (g.screen.w > 0.5 && g.screen.w < 1.5) || g.screen.w > 2.5;
  if (!shadows_enabled || any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { visibility = 1.0; }
  // A generous neutral sky floor keeps shaded blocks readable. Background never enters this path.
  let ao = ambient_occlusion(in.pos.xy, in.world, n);
  // Keep texture albedo close to its authored color. Ambient light is the
  // neutral baseline; sun and shadows add restrained shape instead of
  // dramatically changing the block's palette.
  let ao_factor = mix(1.0, ao, 0.35);
  let ambient = (0.72 + 0.06 * max(n.y, 0.0)) * ao_factor;
  let fill = 0.02 * max(dot(n, v), 0.0);
  var color = kd * (ambient + fill + diff * visibility * 0.26 * g.effects.z);
  if (g.effects.x > 0.5) {
    let half_vector = normalize(l + v);
    let highlight = pow(max(dot(n, half_vector), 0.0), clamp(m.specular.w, 8.0, 96.0));
    let fresnel = 0.025 + 0.08 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    color += clamp(m.specular.rgb, vec3<f32>(0.02), vec3<f32>(0.3)) * highlight * visibility * g.effects.z * 0.25;
    color += vec3<f32>(0.55, 0.60, 0.65) * fresnel * (0.25 + 0.75 * max(n.y, 0.0)) * ao;
  }
  color *= g.light.w;
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

// Fullscreen background: mode 4 samples the uploaded image texture.
@vertex
fn vs_bg(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_bg(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  if (g.screen.z > 3.5) {
    let uv = pos.xy / max(g.screen.xy, vec2<f32>(1.0));
    let color = textureSample(bg_tex, bg_samp, uv);
    // A stronger shadow and midtone lift counteracts the dark presentation while retaining highlight detail.
    let lifted = pow(color.rgb, vec3<f32>(0.35));
    // The canvas prefers premultiplied alpha. Preserve translucent PNG colors
    // by premultiplying only when the configured surface expects it.
    if (g.screen.w > 1.5) { return vec4<f32>(lifted * color.a, color.a); }
    return vec4<f32>(lifted, color.a);
  }
  if (g.screen.z > 0.5 && g.screen.z < 1.5) { return vec4<f32>(1.0); }
  if (g.screen.z > 1.5 && g.screen.z < 2.5) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
  // Mode 3 is a genuinely transparent canvas so CSS image backgrounds remain visible.
  if (g.screen.z > 2.5 && g.screen.z < 3.5) { return vec4<f32>(0.0); }
  let t = clamp(1.0 - pos.y / max(g.screen.y, 1.0), 0.0, 1.0);
  let top = vec3<f32>(0.16, 0.16, 0.18);
  let bottom = vec3<f32>(0.0, 0.0, 0.0);
  return vec4<f32>(mix(bottom, top, t * t * (3.0 - 2.0 * t)), 1.0);
}
