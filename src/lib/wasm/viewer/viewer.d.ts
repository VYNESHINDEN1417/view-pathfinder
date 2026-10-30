/* tslint:disable */
/* eslint-disable */

export class Viewer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates the viewer. `mtl` may be empty if the material library failed to load.
     */
    static create(canvas: HTMLCanvasElement, obj: string, mtl: string): Promise<Viewer>;
    /**
     * Explicitly release GPU resources.
     */
    destroy(): void;
    /**
     * Renders a frame only if something changed. Returns true when a frame was drawn.
     */
    frame(): boolean;
    needs_redraw(): boolean;
    pointer_cancel(id: number): void;
    pointer_down(id: number, x: number, y: number, button: number): void;
    pointer_move(id: number, x: number, y: number): void;
    /**
     * Returns 0 = nothing, 1 = tap/click, 2 = double tap (camera was reset).
     */
    pointer_up(id: number, x: number, y: number, time_ms: number): number;
    reset(): void;
    /**
     * Resize in device pixels; css size is used for input scaling.
     */
    resize(width: number, height: number, css_w: number, css_h: number): void;
    /**
     * Adjust headlight intensity (default 1.0).
     */
    set_light(intensity: number): void;
    /**
     * Supplies encoded image bytes for a texture. Returns false if decoding failed (material keeps its color).
     */
    set_texture(name: string, bytes: Uint8Array): boolean;
    /**
     * Distinct texture file names referenced by the MTL file.
     */
    texture_names(): string[];
    wheel(delta_y: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_viewer_free: (a: number, b: number) => void;
    readonly viewer_create: (a: any, b: number, c: number, d: number, e: number) => any;
    readonly viewer_destroy: (a: number) => void;
    readonly viewer_frame: (a: number) => number;
    readonly viewer_needs_redraw: (a: number) => number;
    readonly viewer_pointer_cancel: (a: number, b: number) => void;
    readonly viewer_pointer_down: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly viewer_pointer_move: (a: number, b: number, c: number, d: number) => void;
    readonly viewer_pointer_up: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly viewer_reset: (a: number) => void;
    readonly viewer_resize: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly viewer_set_light: (a: number, b: number) => void;
    readonly viewer_set_texture: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly viewer_texture_names: (a: number) => [number, number];
    readonly viewer_wheel: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h26ddc75da1306d13: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h27b336f34cce715a: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
