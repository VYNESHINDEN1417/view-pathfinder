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
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    light: [f32; 4],
    screen: [f32; 4],
    light_vp: [[f32; 4]; 4],
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

#[wasm_bindgen]
pub struct Viewer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    shadow_pipeline: wgpu::RenderPipeline,
    shadow_texture: wgpu::Texture,
    shadow_view: wgpu::TextureView,
    shadow_bind: wgpu::BindGroup,
    shadow_dirty: bool,
    light_vp: Mat4,
    transition: Option<(Quat, Quat, f64)>,
    bg_pipeline: wgpu::RenderPipeline,
    globals_buf: wgpu::Buffer,
    globals_bind: wgpu::BindGroup,
    mat_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    white: wgpu::TextureView,
    textures: HashMap<String, (wgpu::Texture, wgpu::TextureView)>,
    vbuf: wgpu::Buffer,
    ibuf: wgpu::Buffer,
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
            alpha_mode: caps.alpha_modes[0],
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
            draws.push(Draw { start, count: mesh.indices.len() as u32, material });
            if model_index % 128 == 0 || model_index + 1 == models.len() {
                report(&progress, "geometry", (model_index + 1) as f64, models.len() as f64).await;
            }
        }
        if verts.is_empty() {
            return Err(JsValue::from_str("model contains no geometry"));
        }
        let center = (lo + hi) * 0.5;
        let radius = ((hi - lo).length() * 0.5).max(1e-4);
        // Center the model at the origin.
        for v in &mut verts {
            v.pos = (Vec3::from(v.pos) - center).into();
        }

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
        let shadow_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("cached directional shadow"), size: wgpu::Extent3d { width: shadow_size, height: shadow_size, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: DEPTH,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
        });
        let shadow_view = shadow_texture.create_view(&Default::default());
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor { compare: Some(wgpu::CompareFunction::LessEqual), ..Default::default() });
        let shadow_bind = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &shadow_layout, entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&shadow_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&shadow_sampler) },
        ] });
        let shadow_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[&g_layout, &mat_layout], push_constant_ranges: &[] });
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("static ship shadow"), layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_shadow"), compilation_options: Default::default(), buffers: &[wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2],
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
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&g_layout, &mat_layout, &shadow_layout],
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
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2],
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
        let bg_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&g_layout],
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
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
                (
                    MaterialU {
                        ambient: [a[0], a[1], a[2], 1.0],
                        diffuse: [d[0], d[1], d[2], m.dissolve.unwrap_or(1.0)],
                        specular: [s[0], s[1], s[2], m.shininess.unwrap_or(32.0)],
                        flags: [0.0; 4],
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
                let bind = make_mat_bind(&device, &mat_layout, &buffer, &white, &sampler);
                Mat { uniform: u, buffer, texture_name, bind }
            })
            .collect();

        let (msaa, depth) = make_targets(&device, &config);
        let home = Camera { target: Vec3::ZERO, rot: Quat::IDENTITY, dist: radius * 2.6 };
        let mut v = Viewer {
            surface,
            device,
            queue,
            config,
            pipeline,
            shadow_pipeline, shadow_texture, shadow_view, shadow_bind, shadow_dirty: true, light_vp, transition: None,
            bg_pipeline,
            globals_buf,
            globals_bind,
            mat_layout,
            sampler,
            white,
            textures: HashMap::new(),
            vbuf,
            ibuf,
            draws,
            mats,
            msaa,
            depth,
            max_dim,
            css_w: w as f32,
            css_h: h as f32,
            center,
            radius,
            cam: home,
            home,
            light_intensity: 1.0,
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
        let tex = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some(name),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            Default::default(),
            img.as_raw(),
        );
        let view = tex.create_view(&Default::default());
        for m in &mut self.mats {
            if m.texture_name.as_deref() == Some(name) {
                m.uniform.flags[0] = 1.0;
                self.queue.write_buffer(&m.buffer, 0, bytemuck::bytes_of(&m.uniform));
                m.bind = make_mat_bind(&self.device, &self.mat_layout, &m.buffer, &view, &self.sampler);
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

    /// Adjust headlight intensity (default 1.0).
    pub fn set_light(&mut self, intensity: f32) {
        self.light_intensity = intensity.max(0.0);
        self.dirty = true;
    }

    /// Camera orientation is computed only in Rust; browser projects the gizmo from this quaternion.
    pub fn camera_rotation(&self) -> Vec<f32> { self.cam.rot.to_array().to_vec() }
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
        let aspect = self.config.width as f32 / self.config.height as f32;
        let eye = self.eye();
        let up = self.cam.rot * Vec3::Y;
        let near = (self.cam.dist - self.radius * 1.5).max(self.radius * 0.002).max(self.cam.dist * 0.01);
        let far = self.cam.dist + self.radius * 3.0;
        let vp = Mat4::perspective_rh(FOV_Y, aspect, near, far) * Mat4::look_at_rh(eye, self.cam.target, up);
        let light = Vec3::new(0.35, 0.8, 0.55).normalize();
        let g = Globals {
            view_proj: vp.to_cols_array_2d(),
            eye: [eye.x, eye.y, eye.z, 1.0],
            light: [light.x, light.y, light.z, self.light_intensity],
            screen: [self.config.width as f32, self.config.height as f32, 0.0, 0.0],
            light_vp: self.light_vp.to_cols_array_2d(),
        };
        self.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&g));

        let view = frame.texture.create_view(&Default::default());
        let mut enc = self.device.create_command_encoder(&Default::default());
        if self.shadow_dirty {
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
            let (target, resolve) = match &self.msaa {
                Some(m) => (m, Some(&view)),
                None => (&view, None),
            };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.bg_pipeline);
            pass.set_bind_group(0, &self.globals_bind, &[]);
            pass.draw(0..3, 0..1);
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(2, &self.shadow_bind, &[]);
            pass.set_vertex_buffer(0, self.vbuf.slice(..));
            pass.set_index_buffer(self.ibuf.slice(..), wgpu::IndexFormat::Uint32);
            for d in &self.draws {
                pass.set_bind_group(1, &self.mats[d.material].bind, &[]);
                pass.draw_indexed(d.start..d.start + d.count, 0, 0..1);
            }
        }
        self.queue.submit(Some(enc.finish()));
        frame.present();
        true
    }

    /// Explicitly release GPU resources.
    pub fn destroy(self) {
        self.shadow_texture.destroy();
        self.vbuf.destroy();
        self.ibuf.destroy();
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

    fn pinch_state(&self) -> (f32, f32, f32) {
        if self.pointers.len() < 2 {
            return (0.0, 0.0, 0.0);
        }
        let (a, b) = (&self.pointers[0], &self.pointers[1]);
        ((a.x - b.x).hypot(a.y - b.y), (a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
    }
}

fn make_mat_bind(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    buf: &wgpu::Buffer,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

fn make_targets(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> (Option<wgpu::TextureView>, wgpu::TextureView) {
    let size = wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 };
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
    (Some(mk(config.format, "msaa")), mk(DEPTH, "depth"))
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
