# Building the Rust/wgpu viewer

Requirements: Rust (with `wasm32-unknown-unknown` target), wasm-pack, lld.

    cd viewer-rs
    CARGO_TARGET_DIR=/tmp/viewer-target wasm-pack build --target web --release
    cp pkg/viewer_bg.wasm ../public/wasm/
    cp pkg/viewer.js pkg/viewer.d.ts ../src/lib/wasm/viewer/
    # in src/lib/wasm/viewer/viewer.js replace new URL('viewer_bg.wasm', import.meta.url) with '/wasm/viewer_bg.wasm'

Model files live in `public/models/` (OBJ, MTL and any textures named by `map_Kd`).
Rendering uses WebGPU when available, otherwise WebGL2 (both via wgpu). Deploy as a normal static/web build.
