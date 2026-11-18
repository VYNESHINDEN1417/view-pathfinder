struct Globals {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>, // xyz = direction (towards light), w = intensity
  screen: vec4<f32>, // xy = framebuffer size in pixels
  light_vp: mat4x4<f32>,
  inverse_vp: mat4x4<f32>,
  effects: vec4<f32>,
  shadow: vec4<f32>,
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

  // Two screen-space scales share the existing depth prepass:
  // short-range contact occlusion catches joins and tight crevices;
  // broad-range occlusion adds soft shade beneath larger overhangs.
  let contact_reach = reach * 0.42;
  let broad_reach = reach * 2.0;
  let center = g.view_proj * vec4<f32>(world, 1.0);
  let contact_projected = g.view_proj * vec4<f32>(world + vec3<f32>(contact_reach, 0.0, 0.0), 1.0);
  let broad_projected = g.view_proj * vec4<f32>(world + vec3<f32>(broad_reach, 0.0, 0.0), 1.0);
  let contact_radius_px = clamp(abs(contact_projected.x / contact_projected.w - center.x / center.w) * size.x * 0.5, 2.0, 15.0);
  let broad_radius_px = clamp(abs(broad_projected.x / broad_projected.w - center.x / center.w) * size.x * 0.5, 4.0, 40.0);

  var blocked = 0.0;
  let count = 4u + u32(g.effects.y) * 4u;
  let contact_samples = (count + 1u) / 2u;
  for (var i = 0u; i < 12u; i++) {
    if (i >= count) { break; }
    let is_contact = i < contact_samples;
    let sample_reach = select(broad_reach, contact_reach, is_contact);
    let sample_radius_px = select(broad_radius_px, contact_radius_px, is_contact);
    let angle = f32(i) * 2.399963;
    let radial = 0.35 + 0.65 * f32(i + 1u) / f32(count);
    let offset = vec2<f32>(cos(angle), sin(angle)) * sample_radius_px * radial;
    let coord = vec2<i32>(clamp(pixel + offset, vec2<f32>(0.0), size - 1.0));
    let depth = textureLoad(scene_depth, coord, 0);
    if (depth < 0.99999) {
      let uv = (vec2<f32>(coord) + 0.5) / size;
      let reconstructed = g.inverse_vp * vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), depth, 1.0);
      let delta = reconstructed.xyz / reconstructed.w - world;
      let distance = length(delta);
      let max_distance = sample_reach * select(2.4, 1.7, is_contact);
      let fade_start = sample_reach * select(0.35, 0.28, is_contact);
      if (distance > sample_reach * 0.035 && distance < max_distance) {
        let facing = max(dot(normal, delta / distance) - 0.06, 0.0);
        let fade = 1.0 - smoothstep(fade_start, max_distance, distance);
        let scale_weight = select(0.86, 0.70, is_contact);
        blocked += facing * fade * scale_weight;
      }
    }
  }
  // A lower floor permits stronger local shade without dimming exposed surfaces.
  let ao = clamp(1.0 - blocked * 4.0 / f32(count), 0.04, 1.0);
  let strength = select(1.0, g.shadow.x, g.effects.x > 0.5);
  return clamp(1.0 - (1.0 - ao) * strength, 0.0, 1.0);
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

fn stone_segment_hash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

// Smooth, low-frequency 3D value noise creates broad color regions in model space.
// Because it uses world coordinates, the pattern stays fixed while the camera moves.
fn stone_segment_noise(p: vec3<f32>) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let u = f * f * (vec3<f32>(3.0) - 2.0 * f);
  let x00 = mix(stone_segment_hash(cell + vec3<f32>(0.0, 0.0, 0.0)), stone_segment_hash(cell + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(stone_segment_hash(cell + vec3<f32>(0.0, 1.0, 0.0)), stone_segment_hash(cell + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(stone_segment_hash(cell + vec3<f32>(0.0, 0.0, 1.0)), stone_segment_hash(cell + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(stone_segment_hash(cell + vec3<f32>(0.0, 1.0, 1.0)), stone_segment_hash(cell + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
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
  var kd = m.diffuse.rgb;
  if (m.flags.x > 0.5) {
    var texture_color = t.rgb;
    if (m.flags.y > 0.5) {
      // Keep the portfolio-matched wooden-plank coloring at every camera
      // distance, including close-ups. Compress contrast uniformly around gray.
      let contrast = 0.82;
      texture_color = vec3<f32>(0.5) + (t.rgb - vec3<f32>(0.5)) * contrast;
    }
    if (m.flags.z > 0.5) {
      // Very restrained warm/cool shifts across broad, softly blended stone regions.
      // This is a render-time tint only; source texture pixels remain untouched.
      let segment_scale = max(g.effects.w * 5.0, 0.65);
      // 15% stronger than the first pass, while keeping the same broad spatial scale.
      let variation = (stone_segment_noise(in.world / segment_scale) - 0.5) * 0.06325;
      let tint = vec3<f32>(1.0 + variation * 0.55, 1.0 + variation * 0.10, 1.0 - variation * 0.45);
      texture_color = texture_color * tint;
    }
    kd = kd * texture_color;
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
  let shadow_strength = select(1.0, g.shadow.x, g.effects.x > 0.5);
  var visibility = clamp(1.0 - (1.0 - shadow) * shadow_strength, 0.0, 1.0);
  let shadows_enabled = (g.screen.w > 0.5 && g.screen.w < 1.5) || g.screen.w > 2.5;
  if (!shadows_enabled || any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { visibility = 1.0; }
  // A generous neutral sky floor keeps shaded blocks readable. Background never enters this path.
  let ao = ambient_occlusion(in.pos.xy, in.world, n);
  let ambient = (0.43 + 0.09 * max(n.y, 0.0)) * ao;
  let fill = 0.06 * max(dot(n, v), 0.0);
  var color = kd * (ambient + fill + diff * visibility * 0.38 * g.effects.z);
  if (g.effects.x > 0.5) {
    let half_vector = normalize(l + v);
    let highlight = pow(max(dot(n, half_vector), 0.0), clamp(m.specular.w, 8.0, 96.0));
    let fresnel = 0.025 + 0.08 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    color += clamp(m.specular.rgb, vec3<f32>(0.02), vec3<f32>(0.3)) * highlight * visibility * g.effects.z * 0.25;
    color += vec3<f32>(0.55, 0.60, 0.65) * fresnel * (0.25 + 0.75 * max(n.y, 0.0)) * ao;
  }
  color *= g.light.w;
  // Soft highlight shoulder: unchanged below 0.7, asymptotically approaches 1 instead of clipping.
  let above = max(color - vec3<f32>(0.7), vec3<f32>(0.0));
  color = min(color, vec3<f32>(0.7)) + above / (vec3<f32>(1.0) + above / 0.3);
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
    // Match CSS background-size: cover: preserve the source image aspect ratio
    // and crop the excess dimension instead of stretching the image to the canvas.
    var uv = pos.xy / max(g.screen.xy, vec2<f32>(1.0));
    let viewport_aspect = g.screen.x / max(g.screen.y, 1.0);
    let image_size = vec2<f32>(textureDimensions(bg_tex, 0));
    let image_aspect = image_size.x / max(image_size.y, 1.0);
    if (viewport_aspect > image_aspect) {
      uv.y = (uv.y - 0.5) * (image_aspect / viewport_aspect) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (viewport_aspect / image_aspect) + 0.5;
    }
    // The source texture and render target use sRGB formats, so sampling and
    // writing perform the matching transfer functions without an artificial lift.
    let color = textureSample(bg_tex, bg_samp, uv);
    // Preserve alpha according to the canvas surface's configured compositing mode.
    if (g.screen.w > 1.5) { return vec4<f32>(color.rgb * color.a, color.a); }
    return color;
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
