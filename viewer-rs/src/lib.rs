//! Minimal OBJ/MTL inspection viewer: wgpu (WebGPU, WebGL2 fallback) compiled to WebAssembly.
use glam::{Mat4, Quat, Vec3};
use std::collections::HashMap;
use std::io::BufReader;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

const SAMPLES: u32 = 4;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
const TAP_SLOP: f32 = 6.0;
const DOUBLE_TAP_MS: f64 = 320.0;
const FOV_Y: f32 = 45.0 * std::f32::consts::PI / 180.0;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    pos: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
    ao: f32,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    light: [f32; 4],
    screen: [f32; 4],
    light_vp: [[f32; 4]; 4],
    inverse_vp: [[f32; 4]; 4],
    effects: [f32; 4], // enabled, quality, sun strength, AO world radius
    shadow: [f32; 4], // master, directional, contact, overhang strengths
    shadow_detail: [f32; 4], // block-edge, ambient-occlusion, reserved, reserved
    point_light: [f32; 4], // static starboard point-light position (xyz) and range (w)
    point_color: [f32; 4], // blue light color (rgb) and subtle intensity (w)
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct MaterialU {
    ambient: [f32; 4],
    diffuse: [f32; 4],
    specular: [f32; 4],
    flags: [f32; 4],
}

struct Mat {
    uniform: MaterialU,
    buffer: wgpu::Buffer,
    texture_name: Option<String>,
    bind: wgpu::BindGroup,
}

struct Draw {
    start: u32,
    count: u32,
    material: usize,
    center: Vec3,
}

#[derive(Clone, Copy)]
struct Camera {
    target: Vec3,
    rot: Quat,
    dist: f32,
}

struct Pointer {
    id: i32,
    x: f32,
    y: f32,
}


#[derive(Clone,Copy)] struct AoTri{a:Vec3,b:Vec3,c:Vec3,lo:Vec3,hi:Vec3,mid:Vec3}
struct AoNode{lo:Vec3,hi:Vec3,l:Option<usize>,r:Option<usize>,start:usize,count:usize}
fn compute_geometry_ao(v:&mut[Vertex],ix:&[u32],ranges:&[std::ops::Range<usize>],radius:f32){
 let mut ts=Vec::new();for rg in ranges{for t in ix[rg.clone()].chunks_exact(3){let a=Vec3::from(v[t[0]as usize].pos);let b=Vec3::from(v[t[1]as usize].pos);let c=Vec3::from(v[t[2]as usize].pos);ts.push(AoTri{a,b,c,lo:a.min(b).min(c),hi:a.max(b).max(c),mid:(a+b+c)/3.0});}}
 if ts.is_empty(){return;}let n=ts.len();let mut nodes=Vec::with_capacity(n*2);build_ao(&mut ts,&mut nodes,0,n);let reach=(radius*0.035).clamp(0.08,3.0);let mut used=vec![false;v.len()];for rg in ranges{for &j in &ix[rg.clone()]{used[j as usize]=true;}}
 for(i,x)in v.iter_mut().enumerate(){if !used[i]{x.ao=1.0;continue;}let p=Vec3::from(x.pos);let normal=Vec3::from(x.normal).normalize_or(Vec3::Y);let h=if normal.y.abs()<0.9{Vec3::Y}else{Vec3::X};let t=normal.cross(h).normalize_or(Vec3::X);let b=normal.cross(t).normalize_or(Vec3::Z);let mut blocked=0.0;const R:u32=12;
 for k in 0..R{let u=(k as f32+0.5)/R as f32;let phi=k as f32*2.39996323;let rr=u.sqrt();let z=(1.0-u).sqrt();let d=(t*(rr*phi.cos())+b*(rr*phi.sin())+normal*z).normalize_or(normal);if ao_hit(&ts,&nodes,0,p+normal*(reach*0.0015),d,reach){blocked+=1.0;}}
 x.ao=(1.0-blocked/R as f32*0.88).clamp(0.12,1.0);
 }}
fn build_ao(ts:&mut[AoTri],ns:&mut Vec<AoNode>,s:usize,e:usize)->usize{let(mut lo,mut hi)=(Vec3::splat(f32::MAX),Vec3::splat(f32::MIN));for t in &ts[s..e]{lo=lo.min(t.lo);hi=hi.max(t.hi);}let id=ns.len();ns.push(AoNode{lo,hi,l:None,r:None,start:s,count:e-s});if e-s<=8{return id;}let ex=hi-lo;let ax=if ex.x>=ex.y&&ex.x>=ex.z{0}else if ex.y>=ex.z{1}else{2};ts[s..e].sort_by(|a,b|a.mid[ax].total_cmp(&b.mid[ax]));let m=s+(e-s)/2;let l=build_ao(ts,ns,s,m);let r=build_ao(ts,ns,m,e);ns[id].l=Some(l);ns[id].r=Some(r);ns[id].count=0;id}
fn ao_box(lo:Vec3,hi:Vec3,o:Vec3,iv:Vec3,m:f32)->bool{let a=(lo-o)*iv;let b=(hi-o)*iv;let n=a.min(b).max_element().max(0.0);let f=a.max(b).min_element();f>=n&&n<=m}
fn ao_tri(t:&AoTri,o:Vec3,d:Vec3,m:f32)->bool{let e1=t.b-t.a;let e2=t.c-t.a;let p=d.cross(e2);let det=e1.dot(p);if det.abs()<1e-8{return false;}let inv=1.0/det;let s=o-t.a;let u=s.dot(p)*inv;if u<0.0||u>1.0{return false;}let q=s.cross(e1);let v=d.dot(q)*inv;if v<0.0||u+v>1.0{return false;}let z=e2.dot(q)*inv;z>1e-5&&z<m}
fn ao_hit(ts:&[AoTri],ns:&[AoNode],root:usize,o:Vec3,d:Vec3,m:f32)->bool{let iv=Vec3::new(if d.x.abs()<1e-8{1e8}else{1.0/d.x},if d.y.abs()<1e-8{1e8}else{1.0/d.y},if d.z.abs()<1e-8{1e8}else{1.0/d.z});let mut st=[0usize;64];let mut n=1;st[0]=root;while n>0{n-=1;let x=&ns[st[n]];if !ao_box(x.lo,x.hi,o,iv,m){continue;}if x.count>0{for t in &ts[x.start..x.start+x.count]{if ao_tri(t,o,d,m){return true;}}}else{if let Some(q)=x.l{if n<63{st[n]=q;n+=1;}}if let Some(q)=x.r{if n<63{st[n]=q;n+=1;}}}}false}

#[wasm_bindgen]
pub struct Viewer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    transparent_pipeline: wgpu::RenderPipeline,
    shadow_pipeline: wgpu::RenderPipeline,
    shadow_texture: wgpu::Texture,
    shadow_view: wgpu::TextureView,
    shadow_bind: wgpu::BindGroup,
    shadow_dirty: bool,
    shadow_layout: wgpu::BindGroupLayout,
    shadow_sampler: wgpu::Sampler,
    shadow_mode: u32, // 0 off, 1 cached static, 2 real-time
    twist: f32,
    light_vp: Mat4,
    transition: Option<(Quat, Quat, f64)>,
    bg_pipeline: wgpu::RenderPipeline,
    bg_image_layout: wgpu::BindGroupLayout,
    bg_image_sampler: wgpu::Sampler,
    bg_image_texture: Option<wgpu::Texture>,
    bg_image_bind: wgpu::BindGroup,
    ao_pipeline: wgpu::RenderPipeline,
    ao_layout: wgpu::BindGroupLayout,
    sun_direction: Vec3,
    sun_strength: f32,
    point_azimuth: f32,
    point_brightness: f32,
    point_intensity: f32,
    point_color: [f32; 3],
    point_range: f32,
    point_enabled: bool,
    point_orbit_visible: bool,
    point_orbit_major_x: bool,
    fancy: bool,
    fancy_quality: u32,
    shadow_strength: f32,
    shadow_components: [f32; 6], // directional, contact, overhang, block edge, ambient occlusion
    ao_v2_enabled: bool,
    globals_buf: wgpu::Buffer,
    globals_bind: wgpu::BindGroup,
    mat_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    anisotropic_sampler: wgpu::Sampler,
    white: wgpu::TextureView,
    textures: HashMap<String, (wgpu::Texture, wgpu::TextureView)>,
    vbuf: wgpu::Buffer,
    ibuf: wgpu::Buffer,
    orbit_vbuf: wgpu::Buffer,
    orbit_ibuf: wgpu::Buffer,
    orbit_index_count: u32,
    orbit_axes: [f32; 2],
    orbit_y: f32,
    orbit_mat: Mat,
    draws: Vec<Draw>,
    mats: Vec<Mat>,
    msaa: Option<wgpu::TextureView>,
    depth: wgpu::TextureView,
    max_dim: u32,
    css_w: f32,
    css_h: f32,
    center: Vec3,
    radius: f32,
    cam: Camera,
    home: Camera,
    light_intensity: f32,
    orthographic: bool,
    background: u32,
    dirty: bool,
    pointers: Vec<Pointer>,
    button: i32,
    dragging: bool,
    multi: bool,
    down_x: f32,
    down_y: f32,
    last_tap: (f64, f32, f32),
    pinch: (f32, f32, f32), // spread, cx, cy
}

fn log(s: &str) {
    web_sys::console::warn_1(&s.into());
}

#[wasm_bindgen]
impl Viewer {
    /// Creates the viewer. `mtl` may be empty if the material library failed to load.
    pub async fn create(canvas: HtmlCanvasElement, obj: String, mtl: String, progress: js_sys::Function) -> Result<Viewer, JsValue> {
        report(&progress, "renderer", 0.0, 0.0).await;
        console_error_panic_hook::set_once();
        let (w, h) = (canvas.width().max(1), canvas.height().max(1));
        let instance = wgpu::util::new_instance_with_webgpu_detection(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL,
            ..Default::default()
        })
        .await;
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: None,
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()),
                memory_hints: wgpu::MemoryHints::MemoryUsage,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let max_dim = device.limits().max_texture_dimension_2d;

        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied().find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: w.min(max_dim),
            height: h.min(max_dim),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps.alpha_modes.iter().copied().find(|m| *m == wgpu::CompositeAlphaMode::PreMultiplied)
                .or_else(|| caps.alpha_modes.iter().copied().find(|m| *m == wgpu::CompositeAlphaMode::PostMultiplied))
                .unwrap_or(caps.alpha_modes[0]),
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        report(&progress, "renderer", 1.0, 1.0).await;
        report(&progress, "parse", 0.0, 0.0).await;
        // ---- Geometry ----
        let opts = tobj::LoadOptions { single_index: true, triangulate: true, ignore_points: true, ignore_lines: true };
        let mut rd = BufReader::new(obj.as_bytes());
        let (models, materials) = tobj::load_obj_buf(&mut rd, &opts, |_p| {
            if mtl.trim().is_empty() {
                return Err(tobj::LoadError::OpenFileFailed);
            }
            tobj::load_mtl_buf(&mut BufReader::new(mtl.as_bytes()))
        })
        .map_err(|e| JsValue::from_str(&format!("OBJ parse error: {e}")))?;
        let materials = materials.unwrap_or_else(|e| {
            log(&format!("MTL unavailable ({e}); using default material"));
            Vec::new()
        });

        report(&progress, "parse", 1.0, 1.0).await;
        report(&progress, "geometry", 0.0, models.len() as f64).await;
        let mut verts: Vec<Vertex> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut draws = Vec::new();
        let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        let default_mat = materials.len();
        for (model_index, m) in models.iter().enumerate() {
            let mesh = &m.mesh;
            let n = mesh.positions.len() / 3;
            if n == 0 || mesh.indices.is_empty() {
                continue;
            }
            let base = verts.len() as u32;
            let has_n = mesh.normals.len() == mesh.positions.len();
            let has_uv = mesh.texcoords.len() / 2 == n;
            for i in 0..n {
                let p = [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
                let pv = Vec3::from(p);
                lo = lo.min(pv);
                hi = hi.max(pv);
                verts.push(Vertex {
                    pos: p,
                    normal: if has_n { [mesh.normals[3 * i], mesh.normals[3 * i + 1], mesh.normals[3 * i + 2]] } else { [0.0; 3] },
                    uv: if has_uv { [mesh.texcoords[2 * i], 1.0 - mesh.texcoords[2 * i + 1]] } else { [0.0; 2] },
                    ao: 1.0,
                });
            }
            if !has_n {
                // Area-weighted smooth normals over shared vertices.
                for t in mesh.indices.chunks_exact(3) {
                    let (a, b, c) = ((base + t[0]) as usize, (base + t[1]) as usize, (base + t[2]) as usize);
                    let pa = Vec3::from(verts[a].pos);
                    let fnrm = (Vec3::from(verts[b].pos) - pa).cross(Vec3::from(verts[c].pos) - pa);
                    for k in [a, b, c] {
                        verts[k].normal = (Vec3::from(verts[k].normal) + fnrm).into();
                    }
                }
                for v in &mut verts[base as usize..] {
                    v.normal = Vec3::from(v.normal).normalize_or(Vec3::Y).into();
                }
            }
            let start = indices.len() as u32;
            indices.extend(mesh.indices.iter().map(|i| i + base));
            let material = mesh.material_id.filter(|&id| id < materials.len()).unwrap_or(default_mat);
            let mesh_center = mesh.positions.chunks_exact(3)
                .fold(Vec3::ZERO, |sum, p| sum + Vec3::new(p[0], p[1], p[2]))
                / n as f32;
            draws.push(Draw { start, count: mesh.indices.len() as u32, material, center: mesh_center });
            if model_index % 128 == 0 || model_index + 1 == models.len() {
                report(&progress, "geometry", (model_index + 1) as f64, models.len() as f64).await;
            }
        }
        report(&progress, "geometry", models.len() as f64, models.len() as f64).await;
        if verts.is_empty() {
            return Err(JsValue::from_str("model contains no geometry"));
        }
        let center = (lo + hi) * 0.5;
        let radius = ((hi - lo).length() * 0.5).max(1e-4);
        // Center the model at the origin.
        for v in &mut verts {
            v.pos = (Vec3::from(v.pos) - center).into();
        }
        for draw in &mut draws { draw.center -= center; }
        let opaque_ranges: Vec<std::ops::Range<usize>> = draws.iter().filter(|d| materials.get(d.material).and_then(|m| m.dissolve).unwrap_or(1.0) >= 0.999).map(|d| d.start as usize..(d.start+d.count) as usize).collect();
        compute_geometry_ao(&mut verts,&indices,&opaque_ranges,radius);
        report(&progress, "upload", 0.0, 2.0).await;
        let vbuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("vertices"),
            contents: bytemuck::cast_slice(&verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        report(&progress, "upload", 1.0, 2.0).await;
        let ibuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("indices"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        drop(verts);
        drop(indices);
        report(&progress, "upload", 2.0, 2.0).await;

        // ---- Pipeline ----
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let uniform_entry = |binding, vis| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: vis,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
            count: None,
        };
        let g_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[uniform_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT)],
        });
        let mat_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                uniform_entry(0, wgpu::ShaderStages::FRAGMENT),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let shadow_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow sampling"), entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Depth, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison), count: None },
            ],
        });
        let shadow_size = if w < 900 { 512 } else { 1024 };
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor { compare: Some(wgpu::CompareFunction::LessEqual), ..Default::default() });
        let (shadow_texture, shadow_view, shadow_bind) = create_shadow(&device, &shadow_layout, &shadow_sampler, shadow_size);
        let shadow_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[&g_layout, &mat_layout], push_constant_ranges: &[] });
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("static ship shadow"), layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_shadow"), compilation_options: Default::default(), buffers: &[wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2, 3 => Float32],
            }] },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs_shadow"), compilation_options: Default::default(), targets: &[] }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: true, depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(), bias: wgpu::DepthBiasState { constant: 2, slope_scale: 2.0, clamp: 0.0 } }),
            multisample: Default::default(), multiview: None, cache: None,
        });
        let light_dir = Vec3::new(0.35, 0.8, 0.55).normalize();
        let light_vp = Mat4::orthographic_rh(-radius, radius, -radius, radius, radius * 0.5, radius * 3.5)
            * Mat4::look_at_rh(light_dir * radius * 2.0, Vec3::ZERO, Vec3::Y);
        let ao_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("AO depth"), entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Depth, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None,
            }],
        });
        let ao_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("AO model depth prepass"), layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2, 3 => Float32],
            }] },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs_shadow"), compilation_options: Default::default(), targets: &[] }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: wgpu::TextureFormat::Depth32Float, depth_write_enabled: true, depth_compare: wgpu::CompareFunction::Less, stencil: Default::default(), bias: Default::default() }),
            multisample: Default::default(), multiview: None, cache: None,
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&g_layout, &mat_layout, &shadow_layout, &ao_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2, 3 => Float32],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: SAMPLES, ..Default::default() },
            multiview: None,
            cache: None,
        });
        let transparent_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sorted translucent materials"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2, 3 => Float32],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: SAMPLES, ..Default::default() },
            multiview: None,
            cache: None,
        });
        let bg_image_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("background image"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let bg_image_sampler = device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        let bg_fallback = device.create_texture_with_data(&queue, &wgpu::TextureDescriptor { label: Some("background fallback"), size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8UnormSrgb, usage: wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[] }, Default::default(), &[16, 21, 27, 255]);
        let bg_fallback_view = bg_fallback.create_view(&Default::default());
        let bg_image_bind = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("background image bind"), layout: &bg_image_layout, entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&bg_fallback_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&bg_image_sampler) },
        ] });
        let bg_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&g_layout, &bg_image_layout],
            push_constant_ranges: &[],
        });
        let bg_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&bg_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_bg"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_bg"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::Always,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: SAMPLES, ..Default::default() },
            multiview: None,
            cache: None,
        });

        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let globals_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &g_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: globals_buf.as_entire_binding() }],
        });
        // Shared model sampler: smooth magnification, trilinear minification,
        // and high anisotropy for ship decks viewed at shallow angles.
        // Crisp baseline sampler: nearest magnification preserves Minecraft texels.
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            anisotropy_clamp: 1,
            ..Default::default()
        });
        // Used only for strongly oblique, minified surfaces such as long ship decks.
        let anisotropic_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            anisotropy_clamp: 16,
            ..Default::default()
        });
        let white_tex = device.create_texture_with_data(
            &queue,
            &wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            Default::default(),
            &[255, 255, 255, 255],
        );
        let white = white_tex.create_view(&Default::default());

        let mut mat_defs: Vec<(MaterialU, Option<String>)> = materials
            .iter()
            .map(|m| {
                let a = m.ambient.unwrap_or([0.0; 3]);
                let d = m.diffuse.unwrap_or([0.7; 3]);
                let s = m.specular.unwrap_or([0.2; 3]);
                let tex = m.diffuse_texture.clone().filter(|t| !t.trim().is_empty());
                let is_plank = tex.as_deref().is_some_and(|name| name.to_ascii_lowercase().contains("planks"));
                (
                    MaterialU {
                        ambient: [a[0], a[1], a[2], 1.0],
                        diffuse: [d[0], d[1], d[2], m.dissolve.unwrap_or(1.0)],
                        specular: [s[0], s[1], s[2], m.shininess.unwrap_or(32.0)],
                        // x = textured, y = wooden-plank contrast. Preserve authored stone texture colors.
                        flags: [0.0, if is_plank { 1.0 } else { 0.0 }, 0.0, 0.0],
                    },
                    tex,
                )
            })
            .collect();
        mat_defs.push((
            MaterialU { ambient: [0.1, 0.1, 0.1, 1.0], diffuse: [0.7, 0.7, 0.72, 1.0], specular: [0.3, 0.3, 0.3, 40.0], flags: [0.0; 4] },
            None,
        ));
        let mats = mat_defs
            .into_iter()
            .map(|(u, texture_name)| {
                let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: None,
                    contents: bytemuck::bytes_of(&u),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });
                let bind = make_mat_bind(&device, &mat_layout, &buffer, &white, &sampler, &anisotropic_sampler);
                Mat { uniform: u, buffer, texture_name, bind }
            })
            .collect();

        // Dedicated, unlit orbit guide. It is real model-space geometry, not a panel overlay.
        // Keep the orbit tied to the model's vertical bounds. Using the overall
        // radius here makes long ships push the light far below the hull.
        let model_height = (hi.y - lo.y).max(radius * 0.02);
        let orbit_y = lo.y + model_height * 0.10;
        let orbit_axes = [
            ((hi.x - lo.x) * 0.62).max(radius * 0.30),
            ((hi.z - lo.z) * 0.62).max(radius * 0.30),
        ];
        let (orbit_vertices, orbit_indices) = build_orbit_geometry(orbit_axes, orbit_y, 90.0, radius * 0.075);
        let orbit_vbuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Blue Light world-space orbit vertices"),
            contents: bytemuck::cast_slice(&orbit_vertices),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });
        let orbit_ibuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Blue Light world-space orbit indices"),
            contents: bytemuck::cast_slice(&orbit_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let orbit_uniform = MaterialU {
            ambient: [0.0, 0.0, 0.0, 1.0],
            diffuse: [0.12, 0.48, 1.0, 1.0], // vivid blue
            specular: [0.0, 0.0, 0.0, 1.0],
            flags: [0.0, 0.0, 0.0, 1.0], // unlit: consistent color at every camera angle
        };
        let orbit_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Blue Light orbit material"),
            contents: bytemuck::bytes_of(&orbit_uniform),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let orbit_bind = make_mat_bind(&device, &mat_layout, &orbit_buffer, &white, &sampler, &anisotropic_sampler);
        let orbit_mat = Mat { uniform: orbit_uniform, buffer: orbit_buffer, texture_name: None, bind: orbit_bind };

        let (msaa, depth) = make_targets(&device, &config);
        let home = Camera { target: Vec3::ZERO, rot: Quat::IDENTITY, dist: radius * 2.6 };
        let mut v = Viewer {
            surface,
            device,
            queue,
            config,
            pipeline,
            transparent_pipeline,
            shadow_pipeline, shadow_texture, shadow_view, shadow_bind, shadow_dirty: true, shadow_layout, shadow_sampler, shadow_mode: 1, twist: 0.0, light_vp, transition: None,
            bg_pipeline, bg_image_layout, bg_image_sampler, bg_image_texture: Some(bg_fallback), bg_image_bind, ao_pipeline, ao_layout, sun_direction: light_dir, sun_strength: 1.0, point_azimuth: 90.0, point_brightness: 1.0, point_intensity: 0.72, point_color: [0.16, 0.38, 1.0], point_range: 1.05, point_enabled: false, point_orbit_visible: false, fancy: false, fancy_quality: 1,
            globals_buf,
            globals_bind,
            mat_layout,
            sampler,
            anisotropic_sampler,
            white,
            textures: HashMap::new(),
            vbuf,
            ibuf,
            orbit_vbuf,
            orbit_ibuf,
            orbit_index_count: orbit_indices.len() as u32,
            orbit_axes,
            orbit_y,
            orbit_mat,
            draws,
            mats,
            msaa,
            depth,
            max_dim,
            css_w: w as f32,
            css_h: h as f32,
            center,
            radius,
            point_orbit_major_x: (hi.x - lo.x) >= (hi.z - lo.z),
            cam: home,
            home,
            light_intensity: 1.5,
            shadow_strength: 1.0,
            shadow_components: [1.0; 6],
            ao_v2_enabled: false,
            orthographic: false,
            background: 0,
            dirty: true,
            pointers: Vec::new(),
            button: 0,
            dragging: false,
            multi: false,
            down_x: 0.0,
            down_y: 0.0,
            last_tap: (-1e9, 0.0, 0.0),
            pinch: (0.0, 0.0, 0.0),
        };
        v.home = v.fit_camera();
        v.cam = v.home;
        Ok(v)
    }

    /// Distinct texture file names referenced by the MTL file.
    pub fn texture_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.mats.iter().filter_map(|m| m.texture_name.clone()).collect();
        names.sort();
        names.dedup();
        names
    }

    /// Supplies encoded image bytes for a texture. Returns false if decoding failed (material keeps its color).
    pub fn set_texture(&mut self, name: &str, bytes: &[u8]) -> bool {
        if !self.mats.iter().any(|m| m.texture_name.as_deref() == Some(name)) { return false; }
        let img = match image::load_from_memory(bytes) {
            Ok(i) => i.to_rgba8(),
            Err(e) => {
                log(&format!("texture {name} could not be decoded: {e}"));
                return false;
            }
        };
        let (w, h) = img.dimensions();
        if w > self.max_dim || h > self.max_dim { log("texture exceeds GPU limits; original retained"); return false; }
        // Match the portfolio viewer's original sRGB-correct, alpha-aware mip
        // filtering. Distant plank tonal softening is handled once in the shader,
        // avoiding stacked contrast corrections across mip levels and screen LOD.
        let mut mip_images = vec![img];
        while mip_images.last().is_some_and(|level| level.width() > 1 || level.height() > 1) {
            let next = downsample_srgb(
                mip_images.last().expect("base mip exists"),
                None,
            );
            mip_images.push(next);
        }
        let mip_level_count = mip_images.len() as u32;
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(name),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for (level, mip) in mip_images.iter().enumerate() {
            let mip_w = mip.width();
            let mip_h = mip.height();
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &tex,
                    mip_level: level as u32,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                mip.as_raw(),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(mip_w * 4),
                    rows_per_image: Some(mip_h),
                },
                wgpu::Extent3d { width: mip_w, height: mip_h, depth_or_array_layers: 1 },
            );
        }
        let view = tex.create_view(&Default::default());
        for m in &mut self.mats {
            if m.texture_name.as_deref() == Some(name) {
                m.uniform.flags[0] = 1.0;
                self.queue.write_buffer(&m.buffer, 0, bytemuck::bytes_of(&m.uniform));
                m.bind = make_mat_bind(&self.device, &self.mat_layout, &m.buffer, &view, &self.sampler, &self.anisotropic_sampler);
            }
        }
        if let Some((old, _)) = self.textures.insert(name.to_string(), (tex, view)) { old.destroy(); }
        self.shadow_dirty = true;
        self.dirty = true;
        true
    }

    /// Resize in device pixels; css size is used for input scaling.
    pub fn resize(&mut self, width: u32, height: u32, css_w: f32, css_h: f32) {
        let (w, h) = (width.clamp(1, self.max_dim), height.clamp(1, self.max_dim));
        self.css_w = css_w.max(1.0);
        self.css_h = css_h.max(1.0);
        if w != self.config.width || h != self.config.height {
            self.config.width = w;
            self.config.height = h;
            self.surface.configure(&self.device, &self.config);
            let (m, d) = make_targets(&self.device, &self.config);
            self.msaa = m;
            self.depth = d;
        }
        self.dirty = true;
    }

    /// Configure the independent localized colored point light around the model.
    pub fn set_point_light(&mut self, azimuth: f32, brightness: f32, intensity: f32, red: f32, green: f32, blue: f32, range: f32) {
        self.point_azimuth = azimuth.rem_euclid(360.0);
        self.point_brightness = brightness.clamp(0.0, 2.5);
        self.point_intensity = intensity.clamp(0.0, 2.0);
        self.point_color = [red, green, blue].map(|value| value.clamp(0.0, 1.0));
        self.point_range = range.clamp(0.2, 2.5);
        self.dirty = true;
    }

    /// Enable or disable only the localized Blue Light illumination.
    pub fn set_point_light_enabled(&mut self, enabled: bool) {
        self.point_enabled = enabled;
        self.dirty = true;
    }

    /// Show or hide the editor-only orbit guide and source marker.
    pub fn set_point_orbit_visible(&mut self, visible: bool) {
        self.point_orbit_visible = visible;
        self.dirty = true;
    }

    /// Sun direction in world coordinates; independent of the camera.
    pub fn set_sun(&mut self, azimuth: f32, elevation: f32, intensity: f32) {
        let a = azimuth.to_radians(); let e = elevation.clamp(0.0, 90.0).to_radians();
        let direction = Vec3::new(a.sin() * e.cos(), e.sin(), a.cos() * e.cos()).normalize();
        self.sun_direction = direction; self.sun_strength = intensity.clamp(0.0, 2.0); self.dirty = true;
    }

    /// Rebuild the cached directional shadow map after interactive sun movement settles.
    pub fn refresh_sun_shadow(&mut self) {
        self.shadow_dirty = true;
        self.dirty = true;
    }

    pub fn set_fancy(&mut self, enabled: bool, quality: u32) {
        self.fancy = enabled; self.fancy_quality = quality.min(2); self.dirty = true;
    }

    /// Set shared directional and ambient-occlusion shadow strength (0.0 = off, 1.0 = baseline, 2.0 = double).
    pub fn set_shadow_strength(&mut self, strength: f32) {
        self.shadow_strength = strength.clamp(0.0, 2.0);
        self.dirty = true;
    }
    pub fn set_ao_v2_enabled(&mut self, enabled: bool) { self.ao_v2_enabled = enabled; self.dirty = true; }

    /// Set the five independent shadow-family controls. Values are clamped to 0.0..2.0.
    pub fn set_shadow_components(&mut self, directional: f32, contact: f32, overhang: f32, edge: f32, ambient: f32, depth: f32) {
        self.shadow_components = [directional, contact, overhang, edge, ambient, depth].map(|value| value.clamp(0.0, 2.0));
        self.dirty = true;
    }

    /// Adjust model exposure only; backgrounds are invariant.
    pub fn set_light(&mut self, intensity: f32) {
        self.light_intensity = intensity.clamp(0.25, 3.0);
        self.dirty = true;
    }

    pub fn set_orthographic(&mut self, enabled: bool) {
        self.orthographic = enabled;
        self.dirty = true;
    }

    /// Screen-space twist: positive radians turn the model clockwise on screen.
    pub fn roll(&mut self, angle: f32) {
        if angle == 0.0 { return; }
        self.transition = None;
        self.cam.rot = (self.cam.rot * Quat::from_rotation_z(angle)).normalize();
        self.dirty = true;
    }

    /// 0 = off, 1 = cached static sun, 2 = real-time sun that follows the view.
    pub fn set_shadow_mode(&mut self, mode: u32) {
        self.shadow_mode = mode.min(2);
        self.shadow_dirty = true;
        self.dirty = true;
    }

    /// Shadow map resolution in texels (clamped to 256..4096 and GPU limits).
    pub fn set_shadow_quality(&mut self, size: u32) {
        let size = size.clamp(256, 4096).min(self.max_dim);
        if self.shadow_texture.width() == size { return; }
        let (t, v, b) = create_shadow(&self.device, &self.shadow_layout, &self.shadow_sampler, size);
        self.shadow_texture.destroy();
        self.shadow_texture = t; self.shadow_view = v; self.shadow_bind = b;
        self.shadow_dirty = true;
        self.dirty = true;
    }

    /// 0 = grey gradient, 1 = white, 2 = green, 3 = transparent, 4 = uploaded image.
    pub fn set_background(&mut self, mode: u32) {
        self.background = mode.min(4);
        self.dirty = true;
    }

    /// Uploads a background image directly into the GPU renderer, independent of canvas alpha support.
    pub fn set_background_image(&mut self, bytes: &[u8]) -> bool {
        let img = match image::load_from_memory(bytes) {
            Ok(i) => i.to_rgba8(),
            Err(e) => { log(&format!("background image could not be decoded: {e}")); return false; }
        };
        let (w, h) = img.dimensions();
        if w == 0 || h == 0 || w > self.max_dim || h > self.max_dim { log("background image exceeds GPU limits"); return false; }
        let texture = self.device.create_texture_with_data(&self.queue, &wgpu::TextureDescriptor {
            label: Some("viewer background image"), size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb, usage: wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
        }, Default::default(), img.as_raw());
        let view = texture.create_view(&Default::default());
        self.bg_image_bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("uploaded background image bind"), layout: &self.bg_image_layout, entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.bg_image_sampler) },
        ] });
        self.bg_image_texture = Some(texture);
        self.background = 4;
        self.dirty = true;
        true
    }

    /// Capture the same renderer into an offscreen target; never depends on canvas preservation.
    pub fn capture_png(&mut self, out_w: u32, out_h: u32) -> js_sys::Promise {
        let width = if out_w == 0 { self.config.width } else { out_w.clamp(16, self.max_dim) };
        let height = if out_h == 0 { self.config.height } else { out_h.clamp(16, self.max_dim) };
        let format = self.config.format;
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("PNG capture"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format, usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let (cm, cd) = make_targets_sized(&self.device, format, width, height);
        self.render_to(&texture.create_view(&Default::default()), width, height, cm.as_ref(), &cd, false);
        let row_bytes = width * 4;
        let padded = (row_bytes + 255) & !255;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("PNG readback"), size: padded as u64 * height as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout {
                offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(height),
            } },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        self.queue.submit(Some(encoder.finish()));
        let completed = std::rc::Rc::new(std::cell::Cell::new(false));
        let callback_completed = completed.clone();
        let mapped = js_sys::Promise::new(&mut |resolve, reject| {
            let callback_completed = callback_completed.clone();
            buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
                callback_completed.set(true);
                match result {
                    Ok(()) => { let _ = resolve.call0(&JsValue::NULL); }
                    Err(error) => { let _ = reject.call1(&JsValue::NULL, &JsValue::from_str(&error.to_string())); }
                }
            });
        });
        let device = self.device.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            // WebGL readback completion needs polling after its GPU fence signals.
            // Poll only while this requested capture is pending, never when idle.
            for _ in 0..2000 {
                let _ = device.poll(wgpu::PollType::Poll);
                if completed.get() { break; }
                let tick = js_sys::Promise::new(&mut |resolve, _| {
                    if let Some(window) = web_sys::window() {
                        let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, 10);
                    }
                });
                wasm_bindgen_futures::JsFuture::from(tick).await?;
            }
            if !completed.get() { buffer.destroy(); texture.destroy(); return Err(JsValue::from_str("Capture timed out")); }
            wasm_bindgen_futures::JsFuture::from(mapped).await?;
            let pixels = buffer.slice(..).get_mapped_range();
            let mut rgba = Vec::with_capacity((row_bytes * height) as usize);
            for row in pixels.chunks(padded as usize) { rgba.extend_from_slice(&row[..row_bytes as usize]); }
            drop(pixels);
            buffer.unmap(); buffer.destroy(); texture.destroy();
            if matches!(format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb) {
                for pixel in rgba.chunks_exact_mut(4) { pixel.swap(0, 2); }
            }
            // MSAA resolves premultiplied edge colors; PNG requires straight alpha.
            for pixel in rgba.chunks_exact_mut(4) {
                let alpha = pixel[3] as f32 / 255.0;
                if alpha > 0.0 && alpha < 1.0 {
                    for channel in &mut pixel[..3] {
                        let srgb = *channel as f32 / 255.0;
                        let linear = if srgb <= 0.04045 { srgb / 12.92 } else { ((srgb + 0.055) / 1.055).powf(2.4) };
                        let straight = (linear / alpha).min(1.0);
                        let encoded = if straight <= 0.0031308 { straight * 12.92 } else { 1.055 * straight.powf(1.0 / 2.4) - 0.055 };
                        *channel = (encoded * 255.0).round() as u8;
                    }
                }
            }
            let mut png = Vec::new();
            use image::ImageEncoder;
            image::codecs::png::PngEncoder::new(&mut png)
                .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(js_sys::Uint8Array::from(png.as_slice()).into())
        })
    }

    /// Camera orientation is computed only in Rust; browser projects the gizmo from this quaternion.
    pub fn camera_rotation(&self) -> Vec<f32> { self.cam.rot.to_array().to_vec() }
    /// Pose as [tx, ty, tz, qx, qy, qz, qw, dist] for timeline keyframes.
    pub fn camera_pose(&self) -> Vec<f32> {
        let t = self.cam.target; let q = self.cam.rot;
        vec![t.x, t.y, t.z, q.x, q.y, q.z, q.w, self.cam.dist]
    }
    pub fn set_camera_pose(&mut self, p: Vec<f32>) {
        if p.len() < 8 { return; }
        self.transition = None;
        self.cam.target = Vec3::new(p[0], p[1], p[2]);
        self.cam.rot = Quat::from_xyzw(p[3], p[4], p[5], p[6]).normalize();
        self.cam.dist = p[7].max(1e-4);
        self.dirty = true;
    }
    pub fn orbit_drag(&mut self, dx: f32, dy: f32) {
        self.transition = None;
        let s = 0.012;
        self.cam.rot = (self.cam.rot * Quat::from_rotation_y(-dx * s) * Quat::from_rotation_x(-dy * s)).normalize();
        self.dirty = true;
    }
    pub fn snap_direction(&mut self, x: f32, y: f32, z: f32, time_ms: f64) {
        let dir = Vec3::new(x, y, z).normalize_or(Vec3::Z);
        let up = if dir.y.abs() > 0.99 { -Vec3::Z * dir.y.signum() } else { Vec3::Y };
        let rot = Quat::from_mat4(&Mat4::look_at_rh(dir, Vec3::ZERO, up).inverse()).normalize();
        self.transition = Some((self.cam.rot, rot, time_ms));
        self.dirty = true;
    }
    pub fn animate(&mut self, time_ms: f64) {
        if let Some((from, to, start)) = self.transition {
            let t = ((time_ms - start) / 280.0).clamp(0.0, 1.0) as f32;
            self.cam.rot = from.slerp(to, t * t * (3.0 - 2.0 * t)).normalize();
            if t >= 1.0 { self.transition = None; }
            self.dirty = true;
        }
    }
    pub fn animating(&self) -> bool { self.transition.is_some() }
    pub fn reset(&mut self) {
        self.transition = None;
        self.home = self.fit_camera();
        self.cam = self.home;
        self.dirty = true;
    }

    pub fn needs_redraw(&self) -> bool {
        self.dirty
    }

    // ---------------- Input ----------------

    pub fn pointer_down(&mut self, id: i32, x: f32, y: f32, button: i32) {
        self.transition = None;
        self.pointers.retain(|p| p.id != id);
        self.pointers.push(Pointer { id, x, y });
        if self.pointers.len() == 1 {
            self.button = button;
            self.dragging = false;
            self.multi = false;
            self.down_x = x;
            self.down_y = y;
        } else {
            self.multi = true;
            self.pinch = self.pinch_state();
            self.twist = self.twist_angle();
        }
    }

    pub fn pointer_move(&mut self, id: i32, x: f32, y: f32) {
        let Some(idx) = self.pointers.iter().position(|p| p.id == id) else { return };
        let (px, py) = (self.pointers[idx].x, self.pointers[idx].y);
        self.pointers[idx].x = x;
        self.pointers[idx].y = y;
        if self.pointers.len() >= 2 {
            let (spread, cx, cy) = self.pinch_state();
            let (s0, cx0, cy0) = self.pinch;
            if s0 > 1.0 && spread > 1.0 {
                self.zoom(s0 / spread);
            }
            self.pan(cx - cx0, cy - cy0);
            let angle = self.twist_angle();
            self.roll(wrap_angle(angle - self.twist));
            self.twist = angle;
            self.pinch = (spread, cx, cy);
            return;
        }
        if self.multi {
            return; // finishing a two-finger gesture: ignore leftover finger
        }
        if !self.dragging {
            if (x - self.down_x).hypot(y - self.down_y) < TAP_SLOP {
                return;
            }
            self.dragging = true;
        }
        let (dx, dy) = (x - px, y - py);
        if self.button == 2 || self.button == 1 {
            self.pan(dx, dy);
        } else {
            let s = std::f32::consts::PI / self.css_h.min(self.css_w);
            let q = Quat::from_axis_angle(Vec3::Y, -dx * s) * Quat::from_axis_angle(Vec3::X, -dy * s);
            self.cam.rot = (self.cam.rot * q).normalize();
            self.dirty = true;
        }
    }

    /// Returns 0 = nothing, 1 = tap/click, 2 = double tap (camera was reset).
    pub fn pointer_up(&mut self, id: i32, x: f32, y: f32, time_ms: f64) -> u8 {
        let before = self.pointers.len();
        self.pointers.retain(|p| p.id != id);
        if before == 0 || !self.pointers.is_empty() {
            if self.pointers.len() >= 2 {
                self.pinch = self.pinch_state();
                self.twist = self.twist_angle();
            }
            return 0;
        }
        let tap = !self.dragging && !self.multi && self.button == 0;
        self.dragging = false;
        if !tap {
            return 0;
        }
        let (t0, x0, y0) = self.last_tap;
        if time_ms - t0 < DOUBLE_TAP_MS && (x - x0).hypot(y - y0) < 30.0 {
            self.last_tap = (-1e9, 0.0, 0.0);
            self.reset();
            return 2;
        }
        self.last_tap = (time_ms, x, y);
        1
    }

    pub fn pointer_cancel(&mut self, id: i32) {
        self.pointers.retain(|p| p.id != id);
        if self.pointers.is_empty() {
            self.dragging = false;
        }
    }

    pub fn wheel(&mut self, delta_y: f32) {
        self.zoom((delta_y.clamp(-300.0, 300.0) * 0.0015).exp());
    }

    // ---------------- Render ----------------

    /// Renders a frame only if something changed. Returns true when a frame was drawn.
    pub fn frame(&mut self) -> bool {
        if !self.dirty {
            return false;
        }
        let frame = match self.surface.get_current_texture() {
            Ok(f) => f,
            Err(_) => {
                self.surface.configure(&self.device, &self.config);
                return false;
            }
        };
        self.dirty = false;
        let (m, d) = (self.msaa.clone(), self.depth.clone());
        let (w, h) = (self.config.width, self.config.height);
        self.render_to(&frame.texture.create_view(&Default::default()), w, h, m.as_ref(), &d, true);
        if self.shadow_mode == 2 { self.shadow_dirty = true; }
        frame.present();
        true
    }

    fn render_to(&mut self, view: &wgpu::TextureView, width: u32, height: u32, msaa: Option<&wgpu::TextureView>, depth: &wgpu::TextureView, include_editor_guides: bool) {
        let aspect = width as f32 / height as f32;
        let eye = self.eye();
        let up = self.cam.rot * Vec3::Y;
        let near = if self.orthographic { -self.radius * 3.0 } else {
            (self.cam.dist - self.radius * 1.5).max(self.radius * 0.002).max(self.cam.dist * 0.01)
        };
        let far = self.cam.dist + self.radius * 3.0;
        let half_height = self.cam.dist * (FOV_Y * 0.5).tan();
        let projection = if self.orthographic {
            Mat4::orthographic_rh(-half_height * aspect, half_height * aspect, -half_height, half_height, near, far)
        } else { Mat4::perspective_rh(FOV_Y, aspect, near, far) };
        let vp = projection * Mat4::look_at_rh(eye, self.cam.target, up);
        let light = self.light_dir();
        if self.shadow_mode == 2 || self.shadow_dirty {
            let r = self.radius;
            self.light_vp = Mat4::orthographic_rh(-r, r, -r, r, r * 0.5, r * 3.5) * Mat4::look_at_rh(light * r * 2.0, Vec3::ZERO, if light.y.abs() > 0.99 { Vec3::Z } else { Vec3::Y });
        }
        let point_azimuth = self.point_azimuth.to_radians();
        // Rebuild only the small marker vertices; the ellipse remains fixed to the ship's plane.
        if include_editor_guides && self.point_orbit_visible {
            let (orbit_vertices, _) = build_orbit_geometry(self.orbit_axes, self.orbit_y, self.point_azimuth, self.radius * 0.075);
            self.queue.write_buffer(&self.orbit_vbuf, 0, bytemuck::cast_slice(&orbit_vertices));
        }
        // Stretch the orbit along the model's longest horizontal axis so the source
        // travels around the bow/stern as well as the port/starboard sides.
        let (orbit_x, orbit_z) = (self.orbit_axes[0], self.orbit_axes[1]);
        let g = Globals {
            view_proj: vp.to_cols_array_2d(),
            eye: [eye.x, eye.y, eye.z, 1.0],
            light: [light.x, light.y, light.z, self.light_intensity],
            screen: [width as f32, height as f32, self.background as f32, (if self.shadow_mode == 0 { 0.0 } else { 1.0 }) + (if self.config.alpha_mode == wgpu::CompositeAlphaMode::PreMultiplied { 2.0 } else { 0.0 })],
            light_vp: self.light_vp.to_cols_array_2d(),
            inverse_vp: vp.inverse().to_cols_array_2d(),
            effects: [if self.fancy { 1.0 } else { 0.0 }, self.fancy_quality as f32, self.sun_strength, self.radius * 0.012],
            shadow: [self.shadow_strength, self.shadow_components[0], self.shadow_components[1], self.shadow_components[2]],
            shadow_detail: [self.shadow_components[3], self.shadow_components[4], if self.ao_v2_enabled { 1.0 } else { 0.0 }, self.shadow_components[5]],
            // Elliptical world-space orbit follows the model's long axis; azimuth remains 0–360°.
            point_light: [orbit_x * point_azimuth.sin(), self.orbit_y, orbit_z * point_azimuth.cos(), self.radius * self.point_range],
            point_color: [self.point_color[0] * self.point_brightness, self.point_color[1] * self.point_brightness, self.point_color[2] * self.point_brightness, if self.point_enabled { self.point_intensity } else { 0.0 }],
        };
        self.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&g));

        // Depth-only prepass is allocated only at full size when Fancy is enabled.
        let needs_scene_depth = self.fancy || self.point_enabled;
        let ao_size = if needs_scene_depth { (width, height) } else { (1, 1) };
        let ao_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("model AO depth"), size: wgpu::Extent3d { width: ao_size.0, height: ao_size.1, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
        });
        let ao_view = ao_texture.create_view(&Default::default());
        let ao_bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("AO read"), layout: &self.ao_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&ao_view) }],
        });
        let mut enc = self.device.create_command_encoder(&Default::default());
        if needs_scene_depth {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("model-only AO depth"), color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &ao_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
                timestamp_writes: None, occlusion_query_set: None,
            });
            pass.set_pipeline(&self.ao_pipeline); pass.set_bind_group(0, &self.globals_bind, &[]);
            pass.set_vertex_buffer(0, self.vbuf.slice(..)); pass.set_index_buffer(self.ibuf.slice(..), wgpu::IndexFormat::Uint32);
            for d in &self.draws { pass.set_bind_group(1, &self.mats[d.material].bind, &[]); pass.draw_indexed(d.start..d.start + d.count, 0, 0..1); }
        }
        if self.shadow_dirty && self.shadow_mode != 0 {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("cached shadow generation"), color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &self.shadow_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
                timestamp_writes: None, occlusion_query_set: None,
            });
            pass.set_pipeline(&self.shadow_pipeline);
            pass.set_bind_group(0, &self.globals_bind, &[]);
            pass.set_vertex_buffer(0, self.vbuf.slice(..));
            pass.set_index_buffer(self.ibuf.slice(..), wgpu::IndexFormat::Uint32);
            for d in &self.draws {
                pass.set_bind_group(1, &self.mats[d.material].bind, &[]);
                pass.draw_indexed(d.start..d.start + d.count, 0, 0..1);
            }
            self.shadow_dirty = false;
        }
        {
            let (target, resolve) = match msaa {
                Some(m) => (m, Some(view)),
                None => (view, None),
            };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_bind_group(0, &self.globals_bind, &[]);
            // Always draw the background pass. In transparent mode fs_bg outputs
            // alpha 0; skipping this pass leaves the opaque black render-pass clear
            // color visible and hides the CSS background image.
            pass.set_pipeline(&self.bg_pipeline);
            pass.set_bind_group(1, &self.bg_image_bind, &[]);
            pass.draw(0..3, 0..1);
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(2, &self.shadow_bind, &[]);
            pass.set_bind_group(3, &ao_bind, &[]);
            pass.set_vertex_buffer(0, self.vbuf.slice(..));
            pass.set_index_buffer(self.ibuf.slice(..), wgpu::IndexFormat::Uint32);
            // Opaque materials render first and populate depth. Transparent MTL
            // materials render back-to-front with alpha blending and no depth writes.
            for d in self.draws.iter().filter(|d| self.mats[d.material].uniform.diffuse[3] >= 0.999) {
                pass.set_bind_group(1, &self.mats[d.material].bind, &[]);
                pass.draw_indexed(d.start..d.start + d.count, 0, 0..1);
            }
            let mut transparent_draws: Vec<&Draw> = self.draws.iter()
                .filter(|d| self.mats[d.material].uniform.diffuse[3] < 0.999)
                .collect();
            transparent_draws.sort_by(|a, b|
                b.center.distance_squared(eye).total_cmp(&a.center.distance_squared(eye)));
            if !transparent_draws.is_empty() {
                pass.set_pipeline(&self.transparent_pipeline);
                for d in transparent_draws {
                    pass.set_bind_group(1, &self.mats[d.material].bind, &[]);
                    pass.draw_indexed(d.start..d.start + d.count, 0, 0..1);
                }
                pass.set_pipeline(&self.pipeline);
            }
            // The orbit guide is visible only while the Blue Light panel is active.
            if include_editor_guides && self.point_orbit_visible {
                pass.set_bind_group(1, &self.orbit_mat.bind, &[]);
                pass.set_vertex_buffer(0, self.orbit_vbuf.slice(..));
                pass.set_index_buffer(self.orbit_ibuf.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.orbit_index_count, 0, 0..1);
            }
        }
        self.queue.submit(Some(enc.finish()));
    }

    /// Explicitly release GPU resources.
    pub fn destroy(self) {
        self.shadow_texture.destroy();
        self.vbuf.destroy();
        self.ibuf.destroy();
        self.orbit_vbuf.destroy();
        self.orbit_ibuf.destroy();
        for (t, _) in self.textures.values() {
            t.destroy();
        }
        drop(self);
    }
}

impl Viewer {
    fn eye(&self) -> Vec3 {
        self.cam.target + self.cam.rot * Vec3::new(0.0, 0.0, self.cam.dist)
    }

    fn fit_camera(&self) -> Camera {
        let aspect = self.config.width as f32 / self.config.height as f32;
        let half_y = FOV_Y * 0.5;
        let half_x = (half_y.tan() * aspect).atan();
        let dist = self.radius / half_y.min(half_x).sin() * 1.05;
        // Slightly elevated three-quarter view.
        let rot = Quat::from_axis_angle(Vec3::Y, 0.6) * Quat::from_axis_angle(Vec3::X, -0.35);
        let _ = self.center;
        Camera { target: Vec3::ZERO, rot, dist }
    }

    fn zoom(&mut self, factor: f32) {
        self.cam.dist = (self.cam.dist * factor).clamp(self.radius * 0.02, self.radius * 60.0);
        self.dirty = true;
    }

    fn pan(&mut self, dx: f32, dy: f32) {
        let units = 2.0 * self.cam.dist * (FOV_Y * 0.5).tan() / self.css_h;
        let right = self.cam.rot * Vec3::X;
        let up = self.cam.rot * Vec3::Y;
        self.cam.target += (-right * dx + up * dy) * units;
        self.dirty = true;
    }

    fn twist_angle(&self) -> f32 {
        if self.pointers.len() < 2 { return 0.0; }
        let (a, b) = (&self.pointers[0], &self.pointers[1]);
        (b.y - a.y).atan2(b.x - a.x)
    }

    fn light_dir(&self) -> Vec3 {
        self.sun_direction
    }

    fn pinch_state(&self) -> (f32, f32, f32) {
        if self.pointers.len() < 2 {
            return (0.0, 0.0, 0.0);
        }
        let (a, b) = (&self.pointers[0], &self.pointers[1]);
        ((a.x - b.x).hypot(a.y - b.y), (a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
    }
}

// Downsample in linear-light RGB and premultiplied-alpha space. This avoids
// dark fringes and preserves perceived brightness in sRGB Minecraft textures.
fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(v: f32) -> f32 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

fn linear_rgb_mean(src: &image::RgbaImage) -> [f32; 3] {
    let mut sum = [0.0f32; 3];
    let mut weight = 0.0f32;
    for pixel in src.pixels() {
        let alpha = pixel[3] as f32 / 255.0;
        weight += alpha;
        for channel in 0..3 {
            sum[channel] += srgb_to_linear(pixel[channel] as f32 / 255.0) * alpha;
        }
    }
    if weight > 1e-8 {
        [sum[0] / weight, sum[1] / weight, sum[2] / weight]
    } else {
        [0.0, 0.0, 0.0]
    }
}

fn downsample_srgb(src: &image::RgbaImage, contrast_center: Option<[f32; 3]>) -> image::RgbaImage {
    let (sw, sh) = src.dimensions();
    let (dw, dh) = ((sw / 2).max(1), (sh / 2).max(1));
    let mut dst = image::RgbaImage::new(dw, dh);
    // Separable 4-tap binomial/Gaussian kernel [1, 3, 3, 1].
    // Sampling around each destination texel center avoids a fixed 2x2
    // even/odd phase and attenuates the one-pixel plank seams before mipmapping.
    const KERNEL: [f32; 4] = [1.0, 3.0, 3.0, 1.0];
    for y in 0..dh {
        let cy = (y as f32 + 0.5) * sh as f32 / dh as f32 - 0.5;
        for x in 0..dw {
            let cx = (x as f32 + 0.5) * sw as f32 / dw as f32 - 0.5;
            let mut rgb_premul = [0.0f32; 3];
            let mut alpha_weight = 0.0f32;
            let mut total_weight = 0.0f32;
            for ky in 0..4 {
                let sy = (cy.floor() as i32 + ky as i32 - 1).clamp(0, sh as i32 - 1) as u32;
                for kx in 0..4 {
                    let sx = (cx.floor() as i32 + kx as i32 - 1).clamp(0, sw as i32 - 1) as u32;
                    let weight = KERNEL[kx] * KERNEL[ky];
                    let p = src.get_pixel(sx, sy).0;
                    let a = p[3] as f32 / 255.0;
                    alpha_weight += a * weight;
                    for c in 0..3 {
                        rgb_premul[c] += srgb_to_linear(p[c] as f32 / 255.0) * a * weight;
                    }
                    total_weight += weight;
                }
            }
            let alpha = alpha_weight / total_weight;
            let mut out = [0u8; 4];
            for c in 0..3 {
                let mut linear = if alpha_weight > 1e-8 { rgb_premul[c] / alpha_weight } else { 0.0 };
                // A restrained 2.5% gain per mip level counteracts distance-only
                // loss of plank tonal separation. It never sharpens or adds detail.
                if let Some(center) = contrast_center {
                    linear = (center[c] + (linear - center[c]) * 1.025).clamp(0.0, 1.0);
                }
                out[c] = (linear_to_srgb(linear) * 255.0).round() as u8;
            }
            out[3] = (alpha * 255.0).round() as u8;
            dst.put_pixel(x, y, image::Rgba(out));
        }
    }
    dst
}

fn build_orbit_geometry(axes: [f32; 2], y: f32, azimuth_deg: f32, marker_radius: f32) -> (Vec<Vertex>, Vec<u32>) {
    const SEGMENTS: usize = 96;
    const TUBE_SIDES: usize = 8;
    const MARKER_SEGMENTS: usize = 16;
    let (rx, rz) = (axes[0].max(0.01), axes[1].max(0.01));
    // A true round tube, rather than a flat ribbon, stays visible from low and edge-on views.
    // Deliberately substantial cross-section: the guide must read as a 3D tube at mobile viewing distances.
    let tube_radius = (rx.min(rz) * 0.04).max(0.025);
    let mut vertices = Vec::with_capacity(SEGMENTS * TUBE_SIDES + MARKER_SEGMENTS + 1);
    let mut indices = Vec::with_capacity(SEGMENTS * TUBE_SIDES * 6 + MARKER_SEGMENTS * 3);
    for i in 0..SEGMENTS {
        let a0 = i as f32 / SEGMENTS as f32 * std::f32::consts::TAU;
        let a1 = (i + 1) as f32 / SEGMENTS as f32 * std::f32::consts::TAU;
        let ring_start = vertices.len() as u32;
        for (a, _) in [(a0, 0usize), (a1, 1usize)] {
            let center = Vec3::new(rx * a.cos(), y, rz * a.sin());
            let tangent = Vec3::new(-rx * a.sin(), 0.0, rz * a.cos()).normalize_or(Vec3::Z);
            let outward = Vec3::new(tangent.z, 0.0, -tangent.x).normalize_or(Vec3::X);
            for side in 0..TUBE_SIDES {
                let phi = side as f32 / TUBE_SIDES as f32 * std::f32::consts::TAU;
                let radial = outward * phi.cos() + Vec3::Y * phi.sin();
                let p = center + radial * tube_radius;
                vertices.push(Vertex { pos: p.into(), normal: radial.into(), uv: [0.0, 0.0], ao: 1.0 });
            }
        }
        for side in 0..TUBE_SIDES {
            let next = (side + 1) % TUBE_SIDES;
            let a = ring_start + side as u32;
            let b = ring_start + next as u32;
            let c = ring_start + TUBE_SIDES as u32 + next as u32;
            let d = ring_start + TUBE_SIDES as u32 + side as u32;
            indices.extend([a, b, c, a, c, d]);
        }
    }
    // The bright source marker travels on the same ellipse as the shader's point light.
    let a = azimuth_deg.to_radians();
    let cx = rx * a.sin();
    let cz = rz * a.cos();
    let center_index = vertices.len() as u32;
    vertices.push(Vertex { pos: [cx, y + marker_radius * 0.025, cz], normal: [0.0, 1.0, 0.0], uv: [0.0, 0.0], ao: 1.0 });
    for i in 0..MARKER_SEGMENTS {
        let angle = i as f32 / MARKER_SEGMENTS as f32 * std::f32::consts::TAU;
        vertices.push(Vertex {
            pos: [cx + marker_radius * angle.cos(), y + marker_radius * 0.025, cz + marker_radius * angle.sin()],
            normal: [0.0, 1.0, 0.0], uv: [0.0, 0.0], ao: 1.0,
        });
    }
    // Close every wedge back to the first perimeter vertex for a seamless full disc.
    for i in 0..MARKER_SEGMENTS {
        let current = center_index + 1 + i as u32;
        let next = center_index + 1 + ((i + 1) % MARKER_SEGMENTS) as u32;
        indices.extend([center_index, current, next]);
    }
    (vertices, indices)
}

fn wrap_angle(a: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    (a + std::f32::consts::PI).rem_euclid(tau) - std::f32::consts::PI
}

fn create_shadow(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, sampler: &wgpu::Sampler, size: u32) -> (wgpu::Texture, wgpu::TextureView, wgpu::BindGroup) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("directional shadow"), size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: 1 },
        mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: DEPTH,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
    });
    let view = texture.create_view(&Default::default());
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout, entries: &[
        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
    ] });
    (texture, view, bind)
}

fn make_mat_bind(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    buf: &wgpu::Buffer,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
    anisotropic_sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
            wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(anisotropic_sampler) },
        ],
    })
}

fn make_targets(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> (Option<wgpu::TextureView>, wgpu::TextureView) {
    make_targets_sized(device, config.format, config.width, config.height)
}

fn make_targets_sized(device: &wgpu::Device, format: wgpu::TextureFormat, width: u32, height: u32) -> (Option<wgpu::TextureView>, wgpu::TextureView) {
    let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
    let mk = |format, label| {
        device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size,
                mip_level_count: 1,
                sample_count: SAMPLES,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default())
    };
    (Some(mk(format, "msaa")), mk(DEPTH, "depth"))
}

// Yield stage updates to the browser; exact parser internals remain indeterminate.
async fn report(callback: &js_sys::Function, stage: &str, completed: f64, total: f64) {
    let _ = callback.call3(&JsValue::NULL, &stage.into(), &completed.into(), &total.into());
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        if let Some(window) = web_sys::window() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, 0);
        } else { let _ = resolve.call0(&JsValue::NULL); }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}

// Rebuild trigger: ensure the exported starboard point-light method is present in the checked-in WASM runtime.
