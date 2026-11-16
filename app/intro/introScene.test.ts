import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { playIntroScene } from './introScene';

// Keep real CPU-side Three objects; replace only the GPU boundary.
const gpu = vi.hoisted(() => ({
  fromScene: vi.fn(),
  pmremDispose: vi.fn(),
  rendererDispose: vi.fn(),
  loseContext: vi.fn(),
  setSize: vi.fn(),
}));

vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    setPixelRatio() {}
    setClearColor() {}
    setSize = gpu.setSize;
    dispose = gpu.rendererDispose;
    forceContextLoss = gpu.loseContext;
  },
  PMREMGenerator: class {
    fromScene = gpu.fromScene;
    dispose = gpu.pmremDispose;
  },
}));

describe('intro scene resource ownership', () => {
  const canvas = { clientWidth: 1280, clientHeight: 900, style: {} } as HTMLCanvasElement;
  let target: THREE.WebGLRenderTarget;
  const getContext = vi.fn();
  const addListener = vi.fn();
  const removeListener = vi.fn();
  const requestFrame = vi.fn();
  const cancelFrame = vi.fn();

  beforeEach(() => {
    for (const mock of Object.values(gpu)) mock.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
    requestFrame.mockReset().mockReturnValue(42);
    cancelFrame.mockReset();
    getContext.mockReset().mockReturnValue({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    });
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      innerWidth: 1280,
      innerHeight: 900,
      addEventListener: addListener,
      removeEventListener: removeListener,
    });
    vi.stubGlobal('document', { createElement: () => ({ getContext }) });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    target = new THREE.WebGLRenderTarget(64, 64);
    gpu.fromScene.mockReturnValue(target);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('releases resources acquired before PMREM generation fails', () => {
    const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const material = vi.spyOn(THREE.Material.prototype, 'dispose');
    const failure = new Error('PMREM failed');
    gpu.fromScene.mockImplementation(() => { throw failure; });

    expect(() => playIntroScene(canvas, vi.fn(), vi.fn())).toThrow(failure);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledTimes(4);
    expect(gpu.pmremDispose).toHaveBeenCalledOnce();
    expect(gpu.rendererDispose).toHaveBeenCalledOnce();
    expect(gpu.loseContext).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('disposes the PMREM target and renderer when the glow canvas fails', () => {
    const targetDispose = vi.spyOn(target, 'dispose');
    getContext.mockReturnValue(null);

    expect(() => playIntroScene(canvas, vi.fn(), vi.fn())).toThrow('2D canvas unavailable');
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(gpu.pmremDispose).toHaveBeenCalledOnce();
    expect(gpu.rendererDispose).toHaveBeenCalledOnce();
    expect(gpu.loseContext).toHaveBeenCalledOnce();
  });

  it('removes the resize listener and instance buffers after a late setup failure', () => {
    const instances = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');
    const texture = vi.spyOn(THREE.Texture.prototype, 'dispose');
    gpu.setSize.mockImplementation(() => { throw new Error('resize failed'); });

    expect(() => playIntroScene(canvas, vi.fn(), vi.fn())).toThrow('resize failed');
    expect(removeListener).toHaveBeenCalledWith('resize', addListener.mock.calls[0][1]);
    expect(instances).toHaveBeenCalledTimes(2);
    expect(texture).toHaveBeenCalledOnce();
    expect(gpu.loseContext).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('owns the complete successful scene and tears it down only once', () => {
    const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const material = vi.spyOn(THREE.Material.prototype, 'dispose');
    const instances = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');
    const texture = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const targetDispose = vi.spyOn(target, 'dispose');
    const scene = playIntroScene(canvas, vi.fn(), vi.fn());

    scene.dispose();
    scene.dispose();

    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('resize', addListener.mock.calls[0][1]);
    expect(geometry).toHaveBeenCalledTimes(4);
    expect(material).toHaveBeenCalledTimes(9);
    expect(instances).toHaveBeenCalledTimes(2);
    expect(texture).toHaveBeenCalledOnce();
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(gpu.pmremDispose).toHaveBeenCalledOnce();
    expect(gpu.rendererDispose).toHaveBeenCalledOnce();
    expect(gpu.loseContext).toHaveBeenCalledOnce();
    expect(targetDispose.mock.invocationCallOrder[0]).toBeLessThan(gpu.pmremDispose.mock.invocationCallOrder[0]);
  });

  it('continues teardown when individual resource and renderer disposal throw', () => {
    const targetDispose = vi.spyOn(target, 'dispose').mockImplementation(() => { throw new Error('target lost'); });
    gpu.rendererDispose.mockImplementation(() => { throw new Error('renderer lost'); });
    const scene = playIntroScene(canvas, vi.fn(), vi.fn());

    expect(() => scene.dispose()).not.toThrow();
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(gpu.pmremDispose).toHaveBeenCalledOnce();
    expect(gpu.loseContext).toHaveBeenCalledOnce();
  });
});
