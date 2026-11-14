# Pathfinder rendering defaults

Pathfinder's Rust renderer owns shared texture and material appearance rules. These defaults apply automatically to every model loaded by the renderer. Integrations should consume the generated WASM runtime from this repository rather than reimplementing these adjustments in individual model viewers.

## Texture filtering and distance detail

- Every successfully loaded model texture receives a complete mipmap chain, down to 1×1.
- Mip levels are generated on the CPU during texture loading, using sRGB-aware averaging and premultiplied-alpha handling. This reduces distance-dependent aliasing and Moiré while avoiding dark or bright transparent-edge halos.
- The shared sampler uses nearest-neighbor magnification to keep Minecraft texels crisp when viewed up close, plus linear minification and linear interpolation between mip levels (trilinear filtering) when viewed from farther away.
- The current crisp-texture sampler uses anisotropy clamp 1. Do not describe this configuration as 8× or 16× anisotropic filtering. If anisotropy is re-enabled later, keep WebGPU's sampler filter-mode requirements in mind and validate both close-up sharpness and oblique deck surfaces on mobile devices.
- These rules apply to all loaded textures, not only wooden planks. No per-model setting is required.

Keep mip generation and the shared sampler in `viewer-rs/src/lib.rs`. Do not move texture filtering into a model-specific frontend.

## Wooden plank texture treatment

- Textures whose MTL diffuse-map filename contains `planks` (case-insensitive) are classified as wooden plank materials when material uniforms are created.
- The fragment shader compresses the sampled plank texture's RGB contrast by 18% around neutral mid-grey (`0.5`). This softens harsh light/dark variation while preserving the underlying wood hue and grain.
- The treatment is applied only to those plank textures. Other material textures and untextured materials are unchanged.
- The classification is stored in the material uniform, so the treatment is automatic whenever the material texture is loaded. No per-model viewer setting is required.

Keep the classification and shader treatment in `viewer-rs/src/lib.rs` and `viewer-rs/src/shader.wgsl`; do not move it into a model-specific frontend.

## Runtime build and integration

Changes under `viewer-rs/` trigger `.github/workflows/build-wasm.yml`, which rebuilds and commits the browser WASM runtime.

Every new viewer integration should use the generated WASM runtime from this repository, preferably pinned to the exact runtime build commit. Do not copy or recreate the filtering and material adjustments in individual model projects. This ensures current and future models receive the same renderer-wide defaults.
