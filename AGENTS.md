<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- 3D rendering lives in Rust (`viewer-rs/`, wgpu + tobj) compiled to `public/wasm/viewer_bg.wasm` with glue in `src/lib/wasm/viewer/`; JS only forwards browser events. Why: user requires a Rust/wgpu engine, no JS 3D libs. Build with CARGO_TARGET_DIR outside the repo (artifacts exceed commit limits).
- Camera orientation and transitions are owned by Rust; the browser gizmo projects the returned quaternion and schedules frames only during changes. Why: navigation must remain synchronized without a second renderer.
- Loading uses a fixed set of measured stages with texture operations grouped together; replacement texture URLs and original fallbacks are explicit manifest entries. Why: progress cannot reset as assets are discovered and missing replacements must not lose materials.
- Projection, background, exposure, and offscreen PNG capture belong to the Rust renderer; captures reuse the display draw path and read back GPU pixels, never DOM screenshots. Why: exports must omit controls and preserve alpha independently of browser canvas buffer retention.
- ZIP model parsing uses asynchronous fflate in the browser with normalized archive-relative paths, ZIP textures first and a committed local texture manifest second; unresolved images retain MTL colors. Why: optional-texture uploads remain self-contained without accounts or external services.
- Fancy shading uses a Rust depth prepass sampled only by model fragments, with shared display/capture rendering and world-space sun direction. Why: AO/contact darkening never changes backgrounds or export alpha, and sun positioning stays independent of the camera.
- Studio framing uses a dedicated contain-sized canvas above a fixed-height scrollable control dock, with one shared aspect calculation for preview and export. Why: panels never obscure the shot and all output ratios stay synchronized.
