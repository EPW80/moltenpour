/**
 * introScene.ts — the Three.js opening sequence
 *
 * Gold is poured, it pools, the pool becomes a sigil, the sigil is named — the
 * whole product story with no words beyond the title. This module owns only the
 * GPU scene and its own requestAnimationFrame; the overlay's type lives in HTML
 * (crisp, real self-hosted Bodoni, and free to load) inside Intro.tsx, which
 * calls playIntroScene after dynamically importing this file. See Intro.tsx for
 * the gating.
 *
 * Kept in its own module so `three` travels with this chunk and never weighs
 * down the homepage for a returning visitor — Intro.tsx imports it only with a
 * dynamic `import()`.
 */

import * as THREE from 'three';

/** Per-frame values the DOM overlay needs. Numbers, so the caller decides px. */
export interface IntroFrameData {
  eyebrow: { opacity: number; y: number };
  spout: { top: number; opacity: number; scaleX: number };
  title: { opacity: number; y: number };
  motto: { opacity: number; y: number };
}

export interface IntroSceneHandle {
  dispose: () => void;
}

/**
 * The intro's timing in world units and seconds. Emit runs from .35s to 2.05s
 * at 34 drops/s (64 slots), the camera sweeps 2.25s–3.6s, and the whole thing
 * ends at 4.15s — see the handoff's "The intro animation".
 */
const I = {
  spoutY: 2.2,
  poolY: -1.3,
  sigilR: 2.75,
  emitStart: 0.35,
  emitEnd: 2.05,
  rate: 34,
  drops: 64,
  gravity: -11,
  camStart: 2.25,
  camDur: 1.35,
  end: 4.15,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const fadeIn = (T: number, s: number, d: number) => easeOut(clamp01((T - s) / d));

/**
 * mulberry32, matching app/sigil/sigil.ts, seeded 0x4d50 like the certificate
 * sigil so the intro's ring reads as the same signature the user will own.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Build, run and eventually tear down the sequence on `canvas`. The first
 * rendered frame fades the canvas in over .4s so a slow shader compile never
 * flashes as a black rectangle. onFrame carries the DOM values every frame and
 * onEnded fires once when the sequence reaches I.end.
 */
export function playIntroScene(
  canvas: HTMLCanvasElement,
  onFrame: (data: IntroFrameData) => void,
  onEnded: () => void,
): IntroSceneHandle {
  let disposed = false;

  let ownedRenderer: THREE.WebGLRenderer | undefined;
  let resizeListener: (() => void) | undefined;
  let raf = 0;
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(resource: T): T => {
    disposables.push(resource);
    return resource;
  };
  // This handle exists before setup starts, including the paths that never return it.
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    if (resizeListener) window.removeEventListener('resize', resizeListener);
    for (const resource of disposables.reverse()) {
      try {
        resource.dispose();
      } catch {
        // Continue releasing the remaining resources even if one fails.
      }
    }
    try {
      ownedRenderer?.dispose();
    } catch {
      // Context loss must still run if renderer disposal fails.
    }
    try {
      ownedRenderer?.forceContextLoss();
    } catch {
      // The context may already be unavailable.
    }
  };

  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const renderer = ownedRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: dpr < 1.5,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const fovT = Math.tan(THREE.MathUtils.degToRad(17.5));

    // Studio reflections for the gold, baked once into a PMREM — no lights per frame.
    const pmrem = keep(new THREE.PMREMGenerator(renderer));
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x1a0e1e);
    const box = keep(new THREE.BoxGeometry(1, 1, 1));
    const panel = (
      hex: number,
      k: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
    ) => {
      const m = new THREE.Mesh(
        box,
        keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide })),
      );
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      envScene.add(m);
    };
    panel(0xfff1c8, 6, 0, 6, 0, 8, 0.1, 4);
    panel(0xf5d67a, 3, -6, 1, 2, 0.1, 6, 1.2);
    panel(0xfff6d8, 4, 5, 2, -3, 0.1, 4, 0.8);
    panel(0x2a1136, 1.2, 0, -5, 0, 12, 0.1, 12);
    const environment = keep(pmrem.fromScene(envScene, 0.035));
    scene.environment = environment.texture;

    const gold = keep(new THREE.MeshStandardMaterial({ color: 0xe9be62, metalness: 1, roughness: 0.2 }));
    const goldDim = keep(new THREE.MeshStandardMaterial({ color: 0xc9922e, metalness: 1, roughness: 0.34 }));
    const sphere = keep(new THREE.SphereGeometry(1, 18, 12));

    // A shared radial blob texture drives the additive glows under spout and pool.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const gctx = glowCanvas.getContext('2d');
    if (!gctx) throw new Error('2D canvas unavailable for the intro glow');
    const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 64, 64);
    const glowTex = keep(new THREE.CanvasTexture(glowCanvas));
    const glowMat = (hex: number) =>
      keep(new THREE.SpriteMaterial({ map: glowTex, color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));

    const poolGlow = new THREE.Sprite(glowMat(0xf5d67a));
    poolGlow.position.set(0, I.poolY, 0);
    poolGlow.renderOrder = -1;
    scene.add(poolGlow);
    const spoutGlow = new THREE.Sprite(glowMat(0xfff6d8));
    spoutGlow.position.set(0, I.spoutY, 0);
    spoutGlow.scale.setScalar(0.9);
    scene.add(spoutGlow);

    const pool = new THREE.Mesh(keep(new THREE.SphereGeometry(1, 48, 24)), gold);
    pool.position.set(0, I.poolY, 0);
    pool.visible = false;
    scene.add(pool);

    const dummy = new THREE.Object3D();
    const hideAll = (mesh: THREE.InstancedMesh, n: number) => {
      dummy.position.set(0, 0, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    };
    const drops = keep(new THREE.InstancedMesh(sphere, gold, I.drops));
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    drops.frustumCulled = false;
    hideAll(drops, I.drops);
    scene.add(drops);

    // Sigil geometry: the pool's ring of satellites and tendrils, as on the certificate.
    const r = rng(0x4d50);
    const SAT = 26;
    const TEN = 9;
    const sats: Array<{ a: number; R: number; s: number }> = [];
    for (let i = 0; i < SAT; i++)
      sats.push({ a: (i / SAT) * Math.PI * 2 + (r() - 0.5) * 0.08, R: 1.35 + r() * 1.25, s: 0.035 + r() * 0.075 });
    const tens: Array<{ a: number; len: number }> = [];
    for (let i = 0; i < TEN; i++) tens.push({ a: (i / TEN) * Math.PI * 2 + 0.18, len: 0.35 + r() * 1.15 });
    const satMesh = keep(new THREE.InstancedMesh(sphere, goldDim, SAT));
    satMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    satMesh.frustumCulled = false;
    hideAll(satMesh, SAT);
    scene.add(satMesh);
    const tenPos = new Float32Array(TEN * 6);
    const tenGeo = keep(new THREE.BufferGeometry());
    const tenAttr = new THREE.BufferAttribute(tenPos, 3);
    tenGeo.setAttribute('position', tenAttr);
    const tenMat = keep(new THREE.LineBasicMaterial({ color: 0xc9922e, transparent: true, opacity: 0 }));
    const tendrils = new THREE.LineSegments(tenGeo, tenMat);
    tendrils.frustumCulled = false;
    scene.add(tendrils);

    // Fit the camera to the viewport: start framed on the spout, end on the sigil.
    const F = { w: 1, h: 1, d0: 10, d1: 14, zOff: 1 };
    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      F.w = w;
      F.h = h;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      F.d0 = Math.max(2.6, 1.75 / aspect) / fovT;
      const halfH1 = Math.max(I.sigilR / (0.86 * aspect), I.sigilR / 0.52);
      F.d1 = halfH1 / fovT;
      F.zOff = 0.28 * halfH1; // keeps the sigil at ~36% from the top, clear of the title
    };
    resizeListener = resize;
    window.addEventListener('resize', resize);
    resize();

    const tgt0 = new THREE.Vector3(0, 0.45, 0);
    const tgt1 = new THREE.Vector3();
    const tgt = new THREE.Vector3();
    const proj = new THREE.Vector3();
    const placeCamera = (T: number) => {
      const u = easeInOut(clamp01((T - I.camStart) / I.camDur));
      const phi = THREE.MathUtils.degToRad(6 + 84 * u);
      const rad = F.d0 * (1 - 0.05 * clamp01(T / 2.2)) * (1 - u) + F.d1 * u;
      tgt1.set(0, I.poolY, F.zOff);
      tgt.copy(tgt0).lerp(tgt1, u);
      camera.position.set(tgt.x, tgt.y + Math.sin(phi) * rad, tgt.z + Math.cos(phi) * rad);
      camera.up.set(0, Math.cos(phi), -Math.sin(phi));
      camera.lookAt(tgt);
    };

    const pos = new Float32Array(I.drops * 3);
    const vel = new Float32Array(I.drops * 3);
    const rad = new Float32Array(I.drops);
    const alive = new Uint8Array(I.drops);
    const expected = I.rate * (I.emitEnd - I.emitStart);
    let T = 0;
    let last = performance.now();
    let acc = 0;
    let cursor = 0;
    let landed = 0;
    let poolR = 0;
    let wob = 0;
    let wobV = 0;
    let ended = false;
    let first = true;

    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      T += dt;

      if (T >= I.emitStart && T <= I.emitEnd) {
        acc += dt * I.rate;
        while (acc >= 1) {
          acc -= 1;
          const i = cursor;
          cursor = (cursor + 1) % I.drops;
          alive[i] = 1;
          pos[i * 3] = (Math.random() - 0.5) * 0.05;
          pos[i * 3 + 1] = I.spoutY;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
          vel[i * 3] = (Math.random() - 0.5) * 0.12;
          vel[i * 3 + 1] = -0.4 - Math.random() * 0.5;
          vel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
          rad[i] = 0.05 + Math.random() * 0.035;
        }
      }

      const surface = I.poolY + 0.06 + poolR * 0.05;
      for (let i = 0; i < I.drops; i++) {
        if (!alive[i]) continue;
        vel[i * 3 + 1] += I.gravity * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] <= surface) {
          alive[i] = 0;
          landed++;
          wobV += 1.2 * (rad[i] / 0.07);
          dummy.scale.setScalar(0);
        } else {
          const stretch = 1 + Math.min(Math.abs(vel[i * 3 + 1]) * 0.11, 1.8);
          dummy.scale.set(rad[i] / Math.sqrt(stretch), rad[i] * stretch, rad[i] / Math.sqrt(stretch));
        }
        dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        dummy.updateMatrix();
        drops.setMatrixAt(i, dummy.matrix);
      }
      drops.instanceMatrix.needsUpdate = true;

      const rT = landed ? 0.2 + 1.0 * Math.sqrt(Math.min(1, landed / expected)) : 0;
      poolR += (rT - poolR) * Math.min(1, dt * 7);
      wobV += (-wob * 150 - wobV * 11) * dt;
      wob += wobV * dt;
      pool.visible = poolR > 0.01;
      const thick = 0.07 + poolR * 0.06;
      pool.scale.set(poolR * (1 - wob * 0.25), Math.max(0.01, thick * (1 + wob * 1.4)), poolR * (1 - wob * 0.25));
      poolGlow.scale.setScalar(Math.max(0.01, poolR * 4.2));
      poolGlow.material.opacity = 0.42 * Math.min(1, poolR * 2);
      spoutGlow.material.opacity = 0.7 * fadeIn(T, 0.25, 0.3) * (1 - fadeIn(T, I.emitEnd, 0.35));

      if (T > 2.45) {
        for (let i = 0; i < SAT; i++) {
          const s = sats[i];
          const p = easeOut(clamp01((T - 2.65 - i * 0.014) / 0.75));
          const rr = poolR * 0.85 + (s.R - poolR * 0.85) * p;
          dummy.position.set(Math.cos(s.a) * rr, I.poolY + 0.02, Math.sin(s.a) * rr);
          dummy.scale.setScalar(s.s * Math.min(1, p * 3));
          dummy.updateMatrix();
          satMesh.setMatrixAt(i, dummy.matrix);
        }
        satMesh.instanceMatrix.needsUpdate = true;
        let tp = 0;
        for (let i = 0; i < TEN; i++) {
          const t = tens[i];
          const p = easeOut(clamp01((T - 2.55 - i * 0.03) / 0.8));
          const r0 = poolR * 0.98;
          const r1 = r0 + t.len * p;
          const c = Math.cos(t.a);
          const sn = Math.sin(t.a);
          tenPos.set([c * r0, I.poolY + 0.01, sn * r0, c * r1, I.poolY + 0.01, sn * r1], i * 6);
          tp = Math.max(tp, p);
        }
        tenAttr.needsUpdate = true;
        tenMat.opacity = 0.75 * Math.min(1, tp * 2);
      }

      placeCamera(T);
      renderer.render(scene, camera);

      const inOut = fadeIn(T, 0.05, 0.5) * (1 - fadeIn(T, 2.0, 0.4));
      proj.set(0, I.spoutY, 0).project(camera);
      const frame: IntroFrameData = {
        eyebrow: { opacity: inOut, y: (1 - fadeIn(T, 0.05, 0.5)) * 8 },
        spout: { top: ((1 - proj.y) / 2) * F.h, opacity: 1 - fadeIn(T, 2.0, 0.4), scaleX: fadeIn(T, 0.1, 0.45) },
        title: { opacity: fadeIn(T, 2.95, 0.6), y: (1 - fadeIn(T, 2.95, 0.6)) * 10 },
        motto: { opacity: fadeIn(T, 3.3, 0.55), y: (1 - fadeIn(T, 3.3, 0.55)) * 8 },
      };

      if (first) {
        first = false;
        canvas.style.transition = 'opacity .4s ease-out';
        canvas.style.opacity = '1';
      }
      onFrame(frame);
      if (!ended && T >= I.end) {
        ended = true;
        onEnded();
      }
    };
    raf = requestAnimationFrame(tick);
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
