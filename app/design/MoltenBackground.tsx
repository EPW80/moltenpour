import { useCallback, useRef } from 'react';
import { WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, ShaderMaterial, Mesh, Vector2 } from 'three';
import { BACKGROUND } from './tokens';

const vertexShader = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = `
precision mediump float;
varying vec2 vUv;
uniform float uTime; uniform vec2 uRes; uniform float uAmt; uniform vec2 uPtr;
uniform float uMaxAlpha;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = .5; for (int i = 0; i < 5; i++){ v += a*n(p); p = p*2.03 + 17.1; a *= .5; } return v; }
void main(){
  vec2 uv = vUv; vec2 p = (uv - .5) * vec2(uRes.x/uRes.y, 1.0) * 2.2;
  float t = uTime * .025;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + t*.6), fbm(p + 3.0*q + vec2(8.3, 2.8) - t*.4));
  float f = fbm(p + 3.2*r);
  float vein = smoothstep(.52, .78, f) * (1.0 - smoothstep(.78, .95, f));
  float sheen = pow(clamp(f, 0.0, 1.0), 3.0);
  float lit = 1.0 - smoothstep(.0, .75, distance(uv, uPtr));
  float vig = 1.0 - smoothstep(.25, 1.05, distance(uv, vec2(.5, .38)));
  vec3 bronze = vec3(.36, .22, .08), gold = vec3(.96, .78, .38);
  vec3 col = mix(bronze, gold, vein*.8 + sheen*.4);
  float a = (vein*.55 + sheen*.35) * vig * (.75 + .25*lit) * uAmt * uMaxAlpha;
  gl_FragColor = vec4(col * a, a);
}
`;

/** Decorative only. Its context, listeners and frame belong to the host node. */
export function MoltenBackground({ intensity = BACKGROUND.intensity, dimmed = false }: { intensity?: number; dimmed?: boolean }) {
  const live = useRef({ intensity, dimmed });
  live.current = { intensity, dimmed };
  const cleanup = useRef<(() => void) | null>(null);
  const attach = useCallback((host: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!host) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch {
      return; // APP_GROUND is the complete non-WebGL fallback.
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(BACKGROUND.pixelRatio);
    const canvas = renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    host.appendChild(canvas);
    const targetAmount = () => Math.max(0, Math.min(1, live.current.intensity)) * (live.current.dimmed ? BACKGROUND.dimWhilePouring : 1);
    const uniforms = {
      uTime: { value: 40 }, uRes: { value: new Vector2(1, 1) },
      uAmt: { value: targetAmount() }, uPtr: { value: new Vector2(.5, .5) },
      uMaxAlpha: { value: BACKGROUND.maxAlpha },
    };
    const geometry = new PlaneGeometry(2, 2);
    // The shader already premultiplies RGB; use matching blend factors.
    const material = new ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, premultipliedAlpha: true, depthWrite: false });
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = new Vector2(.5, .5);
    let dirty = true;
    let lost = false;
    let raf = 0;
    let last = 0;
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      uniforms.uRes.value.set(Math.max(1, width), Math.max(1, height));
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const onPointer = (event: PointerEvent) => pointer.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight);
    const onMotion = () => { dirty = true; };
    const onLost = (event: Event) => { event.preventDefault(); lost = true; };
    const onRestored = () => { lost = false; dirty = true; last = 0; };
    window.addEventListener('pointermove', onPointer, { passive: true });
    motion.addEventListener('change', onMotion);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || lost) { last = 0; return; }
      if (now - last < 1000 / BACKGROUND.fps) return;
      const dt = last ? Math.min((now - last) / 1000, .1) : 1 / BACKGROUND.fps;
      last = now;
      const target = targetAmount();
      const movingAmount = Math.abs(target - uniforms.uAmt.value) > .0001;
      uniforms.uAmt.value = movingAmount ? uniforms.uAmt.value + (target - uniforms.uAmt.value) * Math.min(1, dt * 1.5) : target;
      // Reduced motion freezes both the field and its pointer-driven lighting.
      if (!motion.matches) {
        uniforms.uTime.value += dt;
        uniforms.uPtr.value.lerp(pointer, Math.min(1, dt * .6));
      }
      if (!motion.matches || dirty || movingAmount) renderer.render(scene, camera);
      dirty = false;
    };
    raf = requestAnimationFrame(frame);
    cleanup.current = () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      motion.removeEventListener('change', onMotion);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  return <div ref={attach} className="app-chrome mp-bg" aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} />;
}
