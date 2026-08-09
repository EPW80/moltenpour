/**
 * metaball.ts — the vessel's picture, and nothing else
 *
 * A single full-screen triangle; all shape comes from the fragment shader. It
 * reads the rig's blob arrays as uniforms and draws them as one molten body.
 *
 * This module is deliberately only a painter. It owns no physics and no
 * telemetry, so a browser without WebGL costs the user the picture and not the
 * pour — createRenderer returns null, the ceremony posts a notice, and the rig
 * goes on stepping on its own RAF.
 *
 * The palette constants below are the design tokens in linear RGB. They are the
 * same golds the rest of the document is set in; changing one here without
 * changing app/design/tokens.ts makes the fluid a different metal from its own
 * certificate.
 */

import { MAX_BLOBS, type Rig } from "./rig";

const VERTEX_SRC =
  "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

/**
 * MAX_BLOBS is interpolated from the rig's own constant. The uniform arrays and
 * the loop bound must match the JS arrays exactly — WebGL 1 requires a constant
 * loop bound, which is why it is compiled in rather than passed.
 */
const FRAGMENT_SRC = `
precision highp float;
uniform vec2  u_res;
uniform vec2  u_pos[${MAX_BLOBS}];
uniform float u_rad[${MAX_BLOBS}];
uniform float u_iridescence;
uniform float u_roughness;
const vec3 VOID_C = vec3(0.086, 0.043, 0.102);
const vec3 BRONZE_C = vec3(0.239, 0.141, 0.063);
const vec3 BODY_C = vec3(0.788, 0.573, 0.180);
const vec3 HOT_C = vec3(0.961, 0.839, 0.478);
const vec3 SPEC_C = vec3(1.000, 0.965, 0.847);
float field(vec2 p){
  float f = 0.0;
  for (int i = 0; i < ${MAX_BLOBS}; i++){
    float r = u_rad[i];
    if (r <= 0.0) continue;
    vec2 d = p - u_pos[i];
    f += (r * r) / max(dot(d, d), 1.0);
  }
  return f;
}
vec3 thinFilm(float ndv){
  float ph = (1.0 - ndv) * 9.0;
  return vec3(0.5 + 0.5*sin(ph), 0.5 + 0.5*sin(ph + 2.09), 0.5 + 0.5*sin(ph + 4.19));
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = p / u_res;
  float f = field(p);
  float mask = smoothstep(0.85, 1.15, f);
  float dither = (fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453) - 0.5) / 220.0;
  float vig = smoothstep(1.15, 0.30, length(vec2((uv.x-0.5)*1.05, uv.y-0.45)) * 1.55);
  if (mask <= 0.001){
    float glow = smoothstep(0.10, 0.9, f) * 0.42;
    vec3 bg = mix(VOID_C, BRONZE_C, glow);
    bg *= 0.55 + 0.45 * vig;
    gl_FragColor = vec4(bg + dither, 1.0);
    return;
  }
  float e = 1.5;
  float dx = field(p + vec2(e,0.0)) - field(p - vec2(e,0.0));
  float dy = field(p + vec2(0.0,e)) - field(p - vec2(0.0,e));
  vec3 N = normalize(vec3(-dx, dy, 1.6));
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndl = clamp(dot(N,L), 0.0, 1.0);
  float ndv = clamp(dot(N,V), 0.0, 1.0);
  float ndh = clamp(dot(N,H), 0.0, 1.0);
  float shininess = mix(12.0, 320.0, 1.0 - u_roughness);
  float spec = pow(ndh, shininess);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 col = mix(BRONZE_C, BODY_C, ndl);
  col = mix(col, HOT_C, ndl * ndl * 0.7);
  col = mix(col, SPEC_C, spec);
  col = mix(col, HOT_C, fres * 0.5);
  col = mix(col, thinFilm(ndv), u_iridescence * fres * 0.85);
  col *= 0.72 + 0.28 * vig;
  gl_FragColor = vec4(mix(VOID_C, col, mask) + dither, 1.0);
}`;

export type Renderer = {
  /** The backing store, in device pixels. What the rig integrates against. */
  readonly width: number;
  readonly height: number;
  draw(rig: Rig): void;
  dispose(): void;
};

/**
 * Cap at 2: past that the field function's per-pixel loop over 32 blobs costs
 * more than the sharper edge is worth on a phone.
 */
function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * The size the rig should integrate against, in device pixels.
 *
 * Exported because the pour loop needs it even when there is no renderer to ask.
 * The renderer sizes its own drawing buffer by the same rule, so the physics and
 * the picture cannot end up describing differently shaped stages.
 */
export function backingSize(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
} {
  const dpr = pixelRatio();
  return {
    width: Math.max(1, Math.round(canvas.clientWidth * dpr)),
    height: Math.max(1, Math.round(canvas.clientHeight * dpr)),
  };
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log ?? "shader failed to compile");
  }
  return shader;
}

/**
 * Attach a renderer to a canvas, or return null if this context cannot light it.
 *
 * Null is a normal outcome, not an error: some browsers refuse WebGL in private
 * windows and some machines have it blocklisted. The caller shows a notice and
 * carries on.
 *
 * IMPORTANT: call dispose() on detach. The canvas unmounts every time the user
 * changes view, and a renderer whose RAF is driven against a dropped context is
 * the exact leak that a mount-keyed effect produced here before this was a
 * callback-ref lifecycle.
 */
export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return null;

  let program: WebGLProgram | null = null;
  try {
    program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "metaball: program failed to link",
        gl.getProgramInfoLog(program),
      );
      return null;
    }
  } catch (e) {
    console.error("metaball:", e);
    return null;
  }
  gl.useProgram(program);

  // One triangle big enough to cover the clip volume. Cheaper than a quad and it
  // avoids the diagonal seam two triangles leave in a screen-space shader.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const attrib = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attrib);
  gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    res: gl.getUniformLocation(program, "u_res"),
    pos: gl.getUniformLocation(program, "u_pos"),
    rad: gl.getUniformLocation(program, "u_rad"),
    iridescence: gl.getUniformLocation(program, "u_iridescence"),
    roughness: gl.getUniformLocation(program, "u_roughness"),
  };

  const renderer = {
    width: 1,
    height: 1,
    draw(rig: Rig) {
      gl.uniform2f(uniforms.res, renderer.width, renderer.height);
      gl.uniform2fv(uniforms.pos, rig.pos);
      gl.uniform1fv(uniforms.rad, rig.rad);
      gl.uniform1f(uniforms.iridescence, rig.feel.iridescence);
      gl.uniform1f(uniforms.roughness, rig.feel.roughness);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      observer.disconnect();
      gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      // Frees the drawing buffer immediately rather than at the next GC, which
      // matters because contexts are a small fixed pool per document.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };

  const resize = () => {
    const size = backingSize(canvas);
    renderer.width = size.width;
    renderer.height = size.height;
    // Set together: a viewport that disagrees with the backing store stretches
    // the whole field.
    canvas.width = size.width;
    canvas.height = size.height;
    gl.viewport(0, 0, size.width, size.height);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return renderer;
}
