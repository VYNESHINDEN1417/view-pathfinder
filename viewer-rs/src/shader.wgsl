struct Globals {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>, // xyz = direction (towards light), w = intensity
  screen: vec4<f32>, // xy = framebuffer size in pixels
  light_vp: mat4x4<f32>,
  inverse_vp: mat4x4<f32>,
  effects: vec4<f32>,
  shadow: vec4<f32>,
  shadow_detail: vec4<f32>,
  point_light: vec4<f32>, // xyz = elliptical-orbit light position, w = effective range
  point_color: vec4<f32>, // rgb = blue light tint, w = intensity
  ao_v2: vec4<f32>, // x = AO V2 enabled, y = AO V2 contact-shadow strength
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
  // Fancy Graphics owns contact/overhang effects; AO V2 independently enables edge rays.
  if (g.effects.x < 0.5 && g.ao_v2.x < 0.5) { return 1.0; }
  let size = vec2<f32>(textureDimensions(scene_depth));
  let reach = g.effects.w;
  let edge_reach = reach * 0.18;
  let contact_reach = reach * 0.42;
  let broad_reach = reach * 2.0;
  let center = g.view_proj * vec4<f32>(world, 1.0);
  // Estimate a conservative screen-space radius from all three world axes.
  // Using only world-X makes the sampling footprint collapse or stretch as the
  // camera rotates, which can associate unrelated deck pixels with this surface.
  let edge_x = g.view_proj * vec4<f32>(world + vec3<f32>(edge_reach, 0.0, 0.0), 1.0);
  let edge_y = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, edge_reach, 0.0), 1.0);
  let edge_z = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, 0.0, edge_reach), 1.0);
  let contact_x = g.view_proj * vec4<f32>(world + vec3<f32>(contact_reach, 0.0, 0.0), 1.0);
  let contact_y = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, contact_reach, 0.0), 1.0);
  let contact_z = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, 0.0, contact_reach), 1.0);
  let broad_x = g.view_proj * vec4<f32>(world + vec3<f32>(broad_reach, 0.0, 0.0), 1.0);
  let broad_y = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, broad_reach, 0.0), 1.0);
  let broad_z = g.view_proj * vec4<f32>(world + vec3<f32>(0.0, 0.0, broad_reach), 1.0);
  let center_ndc = center.xy / center.w;
  let edge_radius_px = max(max(length((edge_x.xy / edge_x.w - center_ndc) * size * 0.5), length((edge_y.xy / edge_y.w - center_ndc) * size * 0.5)), length((edge_z.xy / edge_z.w - center_ndc) * size * 0.5));
  let contact_radius_px = max(max(length((contact_x.xy / contact_x.w - center_ndc) * size * 0.5), length((contact_y.xy / contact_y.w - center_ndc) * size * 0.5)), length((contact_z.xy / contact_z.w - center_ndc) * size * 0.5));
  let broad_radius_px = max(max(length((broad_x.xy / broad_x.w - center_ndc) * size * 0.5), length((broad_y.xy / broad_y.w - center_ndc) * size * 0.5)), length((broad_z.xy / broad_z.w - center_ndc) * size * 0.5));

  var blocked_vertical_edge = 0.0;
  var blocked_horizontal_edge = 0.0;
  var blocked_contact = 0.0;
  var blocked_overhang = 0.0;
  // AO V2 runs independently of Fancy Graphics; give its edge pass enough
  // directions to detect both vertical and horizontal blockers on its own.
  let count = select(4u + u32(g.effects.y) * 4u, 12u, g.ao_v2.x > 0.5 && g.effects.x < 0.5);
  let edge_samples = max(count / 4u, 1u);
  let contact_samples = max(count / 4u, 1u);
  let overhang_samples = count - edge_samples - contact_samples;
  for (var i = 0u; i < 12u; i++) {
    if (i >= count) { break; }
    let is_edge = i < edge_samples;
    let is_contact = i >= edge_samples && i < edge_samples + contact_samples;
    // AO V2 stays strictly local: broad overhang rays can turn unrelated depth
    // samples into faint floating shadow boxes across open deck areas.
    let ao_v2_local = g.ao_v2.x > 0.5 && g.effects.x < 0.5;
    let sample_reach = select(broad_reach, select(contact_reach, edge_reach, is_edge), is_edge || is_contact || ao_v2_local);
    let sample_radius_px = select(broad_radius_px, select(contact_radius_px, edge_radius_px, is_edge), is_edge || is_contact || ao_v2_local);
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
      // Overhang shading must remain local to the receiving surface. The old
      // 2.4x broad-distance allowance let distant, unrelated geometry create
      // large floating patches across open deck areas.
      let max_distance = sample_reach * select(1.15, select(1.7, 1.22, ao_v2_local), is_contact || is_edge);
      let fade_start = sample_reach * select(0.55, 0.28, is_contact || is_edge);
      if (distance > sample_reach * 0.035 && distance < max_distance) {
        let facing_threshold = select(0.06, 0.14, ao_v2_local);
        let facing = max(dot(normal, delta / distance) - facing_threshold, 0.0);
        let fade = 1.0 - smoothstep(fade_start, max_distance, distance);
        let scale_weight = select(0.86, select(0.70, 0.62, is_edge), is_contact || is_edge);
        let contribution = facing * fade * scale_weight;
        if (is_edge) {
          // Classify blocker direction in model space, independent of camera orbit.
          let vertical_weight = smoothstep(0.35, 0.85, abs(delta.y) / max(distance, 0.0001));
          blocked_vertical_edge += contribution * vertical_weight;
          blocked_horizontal_edge += contribution * (1.0 - vertical_weight);
        } else if (is_contact) { blocked_contact += contribution; }
        else { blocked_overhang += contribution; }
      }
    }
  }
  let vertical_edge_ao = clamp(1.0 - blocked_vertical_edge * 4.0 / f32(edge_samples), 0.04, 1.0);
  let horizontal_edge_ao = clamp(1.0 - blocked_horizontal_edge * 4.0 / f32(edge_samples), 0.04, 1.0);
  let contact_ao = clamp(1.0 - blocked_contact * 4.0 / f32(contact_samples), 0.04, 1.0);
  let overhang_ao = clamp(1.0 - blocked_overhang * 4.0 / f32(max(overhang_samples, 1u)), 0.04, 1.0);
  let ao_v2_active = g.ao_v2.x > 0.5;
  let vertical_strength = select(0.0, g.shadow_detail.x, ao_v2_active);
  let horizontal_strength = select(0.0, g.shadow_detail.y, ao_v2_active);
  // AO V2 uses the real depth-ray contact/overhang results for corner shading.
  // Its master AO slider is applied once to the combined result below.
  let contact_strength = select(g.shadow.z, g.ao_v2.y, ao_v2_active);
  // AO V2 has one nearby-contact control; apply it to both near-contact
  // and local overhang rays so zero genuinely disables both contributions.
  let overhang_strength = select(g.shadow.w, g.ao_v2.y, ao_v2_active);
  let local_occlusion =
      (1.0 - vertical_edge_ao) * vertical_strength * 0.35
    + (1.0 - horizontal_edge_ao) * horizontal_strength * 0.35
    + (1.0 - contact_ao) * contact_strength * 0.15
    + (1.0 - overhang_ao) * overhang_strength * 0.15;
  let ao_master = select(1.0, g.shadow_detail.z, ao_v2_active);
  let fancy_master = select(1.0, g.shadow.x, g.effects.x > 0.5);
  // Keep AO from crushing low-light faces to black; the old additive stack
  // could exceed 1.0 when several sliders were raised together.
  // Preserve a stronger ambient floor so stacked screen-space hits cannot make
  // textured faces look washed out or partially disappear.
  let occlusion = clamp(local_occlusion * ao_master * fancy_master, 0.0, 0.45);
  return 1.0 - occlusion;
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) vertex_ao: f32,
};

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, @location(3) vertex_ao: f32) -> VsOut {
  var o: VsOut;
  o.pos = g.view_proj * vec4<f32>(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.uv = uv;
  o.vertex_ao = vertex_ao;
  return o;
}

fn point_light_visibility(world: vec3<f32>, light_pos: vec3<f32>) -> f32 {
  if (g.effects.x < 0.5 && g.point_color.w <= 0.0) { return 1.0; }
  let size = vec2<i32>(textureDimensions(scene_depth));
  if (size.x <= 1 || size.y <= 1) { return 1.0; }
  let ray = light_pos - world;
  var blocked = false;
  // A few screen-space samples approximate whether ship geometry lies between
  // this surface and the local source. The depth prepass includes the full model.
  for (var i = 1u; i <= 4u; i++) {
    let t = f32(i) / 5.0;
    let sample_world = world + ray * t;
    let clip = g.view_proj * vec4<f32>(sample_world, 1.0);
    if (clip.w > 0.0001) {
      let ndc = clip.xyz / clip.w;
      let uv = ndc.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
      if (all(uv > vec2<f32>(0.0)) && all(uv < vec2<f32>(1.0)) && ndc.z > 0.0 && ndc.z < 1.0) {
        let coord = clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
        let scene = textureLoad(scene_depth, coord, 0);
        if (scene < ndc.z - 0.0018) { blocked = true; }
      }
    }
  }
  return select(1.0, 0.0, blocked);
}

@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  if (m.flags.w > 0.5) { return vec4<f32>(m.diffuse.rgb, m.diffuse.a); }
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
  // Directional shadow-map shading belongs to Fancy Graphics. AO V2 has its
  // own screen-space depth-ray occlusion; applying the shadow map while Fancy
  // is off can falsely classify sun-facing stone faces as fully shadowed.
  let shadow_strength = select(1.0, g.shadow.x * g.shadow.y, g.effects.x > 0.5);
  var visibility = clamp(1.0 - (1.0 - shadow) * shadow_strength, 0.0, 1.0);
  let shadows_enabled = g.effects.x > 0.5 && ((g.screen.w > 0.5 && g.screen.w < 1.5) || g.screen.w > 2.5);
  if (!shadows_enabled || any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { visibility = 1.0; }
  // A generous neutral sky floor keeps shaded blocks readable. Background never enters this path.
  // Ambient occlusion is a solid-surface effect. The AO depth prepass already
  // excludes translucent MTL geometry; don't then darken those same transparent
  // surfaces using nearby opaque depth samples, which creates floating dark boxes.
  var ao = 1.0;
  if (m.diffuse.a >= 0.999) {
    // AO V2 must use the authored geometric normal, not the camera-flipped
    // two-sided lighting normal. This prevents geometry behind a carpet or
    // other thin surface from being treated as a valid front-side occluder.
    let ao_normal = select(n, normalize(in.normal), g.ao_v2.x > 0.5);
    ao = ambient_occlusion(in.pos.xy, in.world, ao_normal);
  }
  // AO V2 now uses screen-space depth rays as its sole AO source. Applying
  // baked vertex AO here as well double-darkened the same corners and faces.
  let geometry_ao = 1.0;
  // AO V2 far-face darkness is a dedicated sun-orientation term.
  // It uses the authored face normal against the sun direction only: shadow-map
  // visibility and AO ray occlusion must not drive this slider.
  let far_face_darkness = select(0.0, clamp(g.shadow_detail.w, 0.0, 1.0), g.ao_v2.x > 0.5);
  let sun_facing = clamp(dot(normalize(in.normal), l), 0.0, 1.0);
  let far_face_weight = 1.0 - smoothstep(0.0, 0.72, sun_facing);
  // Preserve a readable ambient floor on textured stone and other block faces.
  // Even at maximum slider strength, far-face shading may reduce ambient fill by
  // no more than 35%; direct sunlight and the original texture albedo stay intact.
  let far_face_floor = 1.0 - far_face_darkness * 0.35;
  let far_face_ambient = mix(1.0, far_face_floor, far_face_weight);
  // Stone textures need a stronger neutral fill so their authored gray albedo
  // remains readable instead of looking charcoal under otherwise direct light.
  let ambient_base = select(0.43, 0.50, m.flags.z > 0.5);
  let ambient = (ambient_base + 0.09 * max(n.y, 0.0)) * ao * geometry_ao * far_face_ambient;
  let fill = 0.06 * max(dot(n, v), 0.0) * far_face_ambient;
  let diffuse_response = select(0.38, 0.50, m.flags.z > 0.5);
  var color = kd * (ambient + fill + diff * visibility * diffuse_response * g.effects.z);
  // Localized colored light moving on an elliptical world-space orbit, independent of camera and sun.
  let to_point = g.point_light.xyz - in.world;
  let point_distance = length(to_point);
  let point_direction = to_point / max(point_distance, 0.0001);
  // Use the authored geometric normal, not the camera-flipped shading normal:
  // the reverse side of a hull must not receive light from the source behind it.
  let point_facing = max(dot(normalize(in.normal), point_direction), 0.0);
  let point_falloff = 1.0 - smoothstep(g.point_light.w * 0.10, g.point_light.w, point_distance);
  let point_attenuation = point_falloff * point_falloff;
  // No ambient blue fill: only source-facing surfaces receive this light.
  // Four-tap screen-space depth testing prevents the source illuminating surfaces
  // hidden behind the visible hull or superstructure.
  let point_visibility = point_light_visibility(in.world, g.point_light.xyz);
  let blue_contribution = point_facing * point_attenuation * point_visibility * g.point_color.w;
  color += kd * g.point_color.rgb * blue_contribution;
  if (g.effects.x > 0.5) {
    let half_vector = normalize(l + v);
    let highlight = pow(max(dot(n, half_vector), 0.0), clamp(m.specular.w, 8.0, 96.0));
    let fresnel = 0.025 + 0.08 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    color += clamp(m.specular.rgb, vec3<f32>(0.02), vec3<f32>(0.3)) * highlight * visibility * g.effects.z * 0.25;
    color += vec3<f32>(0.55, 0.60, 0.65) * fresnel * (0.25 + 0.75 * max(n.y, 0.0)) * ao * geometry_ao;
  } else if (g.ao_v2.x > 0.5) {
    // Keep AO V2's shadow color in the same subtle cool-neutral family as
    // Fancy Graphics without enabling its specular highlight response.
    let fresnel = 0.025 + 0.08 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    color += vec3<f32>(0.55, 0.60, 0.65) * fresnel * (0.25 + 0.75 * max(n.y, 0.0)) * ao * geometry_ao;
  }
  color *= g.light.w;
  // Soft highlight shoulder: unchanged below 0.7, asymptotically approaches 1 instead of clipping.
  let above = max(color - vec3<f32>(0.7), vec3<f32>(0.0));
  color = min(color, vec3<f32>(0.7)) + above / (vec3<f32>(1.0) + above / 0.3);
  return vec4<f32>(color, m.diffuse.a);
}

@vertex
fn vs_shadow(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VsOut {
  var o: VsOut;
  o.pos = g.light_vp * vec4<f32>(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.uv = uv;
  o.vertex_ao = 1.0;
  return o;
}

@fragment
fn fs_shadow(in: VsOut) {
  // The shadow map and AO/point-light depth prepass must contain only opaque
  // blockers. Treat MTL dissolve and partially transparent texture texels as
  // non-occluding; otherwise invisible rigging/box faces still write depth and
  // incorrectly remove sunlight or local light from surfaces behind them.
  // The regular color pass keeps its existing cutout threshold and appearance.
  let texture_alpha = textureSample(tex, samp, in.uv).a;
  let surface_alpha = texture_alpha * m.diffuse.a;
  if (surface_alpha < 0.98) { discard; }
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
