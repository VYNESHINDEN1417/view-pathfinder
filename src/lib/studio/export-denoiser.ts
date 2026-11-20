/**
 * Lightweight edge-preserving spatial denoiser for exported frames.
 * It runs on a separate WebGL2 canvas, leaving the live WebGPU viewport untouched.
 * The deliberately low default strength reduces fine grain without broad blurring.
 */
export type ExportDenoiser = {
  canvas: HTMLCanvasElement;
  process: (source: HTMLCanvasElement) => HTMLCanvasElement;
  destroy: () => void;
};

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uStrength;
out vec4 outColor;

float colorDistance(vec3 a, vec3 b) {
  return length(a - b);
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec4 center = texture(uSource, uv);
  vec3 sum = center.rgb * 2.0;
  float total = 2.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec4 sampleColor = texture(uSource, uv + vec2(float(x), float(y)) * uTexel);
      float edgeWeight = exp(-colorDistance(sampleColor.rgb, center.rgb) * 22.0);
      float spatialWeight = (x == 0 || y == 0) ? 1.0 : 0.72;
      float weight = edgeWeight * spatialWeight;
      sum += sampleColor.rgb * weight;
      total += weight;
    }
  }
  vec3 filtered = sum / max(total, 0.0001);
  outColor = vec4(mix(center.rgb, filtered, uStrength), center.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate export denoiser shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Export denoiser shader compilation failed.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function createExportDenoiser(width: number, height: number, strength = 0.22): ExportDenoiser | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) return null;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate export denoiser program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Export denoiser program linking failed.");
    }

    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate export denoiser texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "uSource"), 0);
    gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / width, 1 / height);
    gl.uniform1f(gl.getUniformLocation(program, "uStrength"), Math.max(0, Math.min(0.5, strength)));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, width, height);

    return {
      canvas,
      process(source) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return canvas;
      },
      destroy() {
        gl.deleteTexture(texture);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
    };
  } catch {
    return null;
  }
}
