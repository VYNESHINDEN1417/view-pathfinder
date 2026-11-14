# Pathfinder material defaults

Pathfinder's Rust renderer owns shared material appearance rules. Integrations should consume the generated WASM runtime from this repository rather than reimplementing these adjustments in individual model viewers.

## Wooden plank texture treatment

- Textures whose MTL diffuse-map filename contains `planks` (case-insensitive) are classified as wooden plank materials when material uniforms are created.
- The fragment shader compresses the sampled plank texture's RGB contrast by 18% around neutral mid-grey (`0.5`). This softens harsh light/dark variation while preserving the underlying wood hue and grain.
- The treatment is applied only to those plank textures. Other material textures and untextured materials are unchanged.
- The classification is stored in the material uniform, so the treatment is automatic whenever the material texture is loaded. No per-model viewer setting is required.

This is a renderer-wide default. Keep the classification and shader treatment in `viewer-rs/src/lib.rs` and `viewer-rs/src/shader.wgsl`; do not move it into a model-specific frontend.

## Runtime build

Changes under `viewer-rs/` trigger `.github/workflows/build-wasm.yml`, which rebuilds and commits the browser WASM runtime. Viewer integrations should pin their WASM URL to the resulting runtime build commit (or otherwise consume that generated runtime) so they receive the same material defaults.
