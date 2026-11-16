/**
 * Intro.tsx — the opening ceremony
 *
 * First open in a session plays a ~4 s Three.js sequence over the homepage and
 * fades into it: gold is poured, it pools, the pool becomes a sigil, the sigil
 * is named. The type rides over the canvas as HTML — crisp, and the real
 * self-hosted Bodoni — the sequence is skippable (button or Esc), and
 * reduced-motion / no-WebGL / slow-load visitors get a static fallback instead
 * of a blank stage.
 *
 * Gating is decided synchronously before first paint (introInitial) so the
 * homepage never flashes underneath. The scene itself loads on demand via a
 * dynamic import, so returning visitors never download Three.js; onBusyChange
 * lets the shell pause its own WebGL rig while this one runs.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { APP_GROUND, COLOR, FONT, GRAIN_URL } from '../design/tokens';
import type { IntroFrameData, IntroSceneHandle } from './introScene';

export type IntroPhase = 'pending' | 'static' | 'done';

export const INTRO_KEY = 'molten-pour:intro-seen';
export const INTRO_LOAD_BUDGET_MS = 1600;

/**
 * Decided before first render. Only the session check lives here; reduced
 * motion and the WebGL probe are settled by startIntro right after mount — the
 * overlay is already up by then either way.
 */
export function introInitial(): IntroPhase {
  if (typeof window === 'undefined') return 'pending';
  try {
    return window.sessionStorage.getItem(INTRO_KEY) === '1' ? 'done' : 'pending';
  } catch {
    // Storage blocked: the intro simply plays.
    return 'pending';
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Probe a throwaway context, then drop it so the real one is unobstructed. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Set an overlay element's reveal (opacity + the 8–10 px rise). */
const applyReveal = (el: HTMLElement | null, o: number, y: number) => {
  if (!el) return;
  el.style.opacity = o.toFixed(3);
  el.style.transform = `translateY(${y.toFixed(1)}px)`;
};

export function Intro({ onBusyChange, onDismiss }: {
  onBusyChange?: (busy: boolean) => void;
  /** Fires after the fade and teardown, when the underlying controls can be used. */
  onDismiss?: () => void;
}) {
  const [phase, setPhase] = useState<IntroPhase>(introInitial);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);
  const spoutRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const mottoRef = useRef<HTMLDivElement>(null);
  const skipButtonRef = useRef<HTMLButtonElement>(null);

  // The skip button renders the overlay, but the lifecycle lives in the effect —
  // a stable ref hands the button a real handler once one exists.
  const skipRef = useRef<() => void>(() => {});
  const onBusyRef = useRef(onBusyChange);
  onBusyRef.current = onBusyChange;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    skipButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (phase === 'done') return;

    // Local to the effect, so a StrictMode remount re-runs it cleanly.
    let loadTimer: number | null = null;
    let endTimer: number | null = null;
    let fadeTimer: number | null = null;
    let fadeFrame = 0;
    let scene: IntroSceneHandle | null = null;
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    let ending = false;
    let disposed = false;

    const disposeThree = () => {
      scene?.dispose();
      scene = null;
    };
    const disposeIntro = () => {
      disposed = true;
      disposeThree();
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      if (endTimer !== null) window.clearTimeout(endTimer);
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
      cancelAnimationFrame(fadeFrame);
      if (onKey) {
        window.removeEventListener('keydown', onKey);
        onKey = null;
      }
    };

    const endIntro = (fast: boolean) => {
      if (ending || disposed) return;
      ending = true;
      // Hand the homepage's own rig back the moment the fade starts.
      onBusyRef.current?.(false);
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      if (endTimer !== null) window.clearTimeout(endTimer);
      const el = rootRef.current;
      const ms = fast ? 380 : 650;
      if (el) {
        el.style.transition = `opacity ${ms}ms cubic-bezier(.4,0,.2,1)`;
        el.style.pointerEvents = 'none';
        fadeFrame = requestAnimationFrame(() => {
          el.style.opacity = '0';
        });
      }
      fadeTimer = window.setTimeout(() => {
        disposeIntro();
        setPhase('done');
        onDismissRef.current?.();
      }, ms + 60);
    };
    skipRef.current = () => endIntro(true);

    const playStatic = () => {
      setPhase('static');
      applyReveal(eyebrowRef.current, 1, 0);
      applyReveal(titleRef.current, 1, 0);
      applyReveal(mottoRef.current, 1, 0);
      if (spoutRef.current) spoutRef.current.style.display = 'none';
      // The static tableau holds for two seconds, then fades like the sequence.
      endTimer = window.setTimeout(() => endIntro(false), 2000);
    };

    const onFrame = (data: IntroFrameData) => {
      applyReveal(eyebrowRef.current, data.eyebrow.opacity, data.eyebrow.y);
      const sp = spoutRef.current;
      if (sp) {
        sp.style.top = `${data.spout.top.toFixed(1)}px`;
        sp.style.opacity = data.spout.opacity.toFixed(3);
        sp.style.transform = `scaleX(${data.spout.scaleX.toFixed(3)})`;
      }
      applyReveal(titleRef.current, data.title.opacity, data.title.y);
      applyReveal(mottoRef.current, data.motto.opacity, data.motto.y);
    };

    const playThree = (mod: typeof import('./introScene')) => {
      const cv = canvasRef.current;
      if (!cv) {
        playStatic();
        return;
      }
      scene = mod.playIntroScene(cv, onFrame, () => endIntro(false));
    };

    const startIntro = () => {
      try {
        window.sessionStorage.setItem(INTRO_KEY, '1');
      } catch {
        /* storage blocked */
      }
      onKey = (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          skipButtonRef.current?.focus({ preventScroll: true });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          endIntro(true);
        }
      };
      window.addEventListener('keydown', onKey);

      if (prefersReducedMotion() || !hasWebGL()) {
        playStatic();
        return;
      }

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled || ending || disposed) return;
        settled = true;
        if (loadTimer !== null) window.clearTimeout(loadTimer);
        fn();
      };
      // A slow network never holds the visitor on a blank screen waiting for three.
      loadTimer = window.setTimeout(() => settle(playStatic), INTRO_LOAD_BUDGET_MS);
      import('./introScene')
        .then((mod) =>
          settle(() => {
            try {
              playThree(mod);
            } catch {
              disposeThree();
              playStatic();
            }
          }),
        )
        .catch(() => settle(playStatic));
    };

    startIntro();
    return disposeIntro;
    // `phase` is read once, before first paint; the lifecycle then owns itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      ref={rootRef}
      className="app-chrome"
      role="dialog"
      aria-modal="true"
      aria-label="Introduction to The Molten Pour"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflow: 'hidden',
        opacity: 1,
        background: APP_GROUND,
      }}
    >
      {phase === 'pending' && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', opacity: 0 }}
        />
      )}

      {phase === 'static' && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '36%',
              width: 'min(44vmin, 56vh - 60px, 340px)',
              aspectRatio: '1 / 1',
              transform: 'translate(-50%,-50%)',
              border: '1px dashed rgba(201,146,46,.32)',
              borderRadius: '50%',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '36%',
              width: 'min(24vmin, 30vh, 180px)',
              aspectRatio: '1 / 1',
              transform: 'translate(-50%,-50%)',
              borderRadius: '50%',
              background: 'radial-gradient(circle at 42% 36%, #FFF6D8 0%, #F5D67A 20%, #C9922E 56%, #3D2410 100%)',
              boxShadow: '0 0 90px 10px rgba(245,214,122,.22)',
            }}
          />
        </>
      )}

      {/* Grain and vignette sit under the type, over the canvas. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.14,
          mixBlendMode: 'overlay',
          backgroundImage: GRAIN_URL,
        }}
      />
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 140px 50px rgba(10,6,13,.75)' }}
      />

      <div
        ref={eyebrowRef}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '8%',
          display: 'flex',
          justifyContent: 'center',
          opacity: 0,
          fontFamily: FONT.instrument,
          fontSize: 11,
          letterSpacing: '4.5px',
          textIndent: '4.5px',
          textTransform: 'uppercase',
          color: COLOR.goldLabel,
          pointerEvents: 'none',
        }}
      >
        Office of Disbursement
      </div>

      <div
        ref={spoutRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '50%',
          top: '20%',
          width: 180,
          marginLeft: -90,
          height: 1,
          background: 'linear-gradient(90deg, transparent, #F5D67A 30%, #F5D67A 70%, transparent)',
          boxShadow: '0 0 14px rgba(245,214,122,.6)',
          opacity: 0,
          transform: 'scaleX(0)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '66%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '0 24px',
          pointerEvents: 'none',
          textAlign: 'center',
        }}
      >
        <div
          ref={titleRef}
          style={{
            opacity: 0,
            fontFamily: FONT.display,
            fontWeight: 400,
            fontSize: 'clamp(40px, 8.4vw, 76px)',
            lineHeight: 0.95,
            letterSpacing: '-1px',
            color: COLOR.goldCream,
            textShadow: '0 0 44px rgba(201,146,46,.4)',
          }}
        >
          The Molten Pour
        </div>
        <div ref={mottoRef} style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 14, width: 'min(300px, 72vw)' }}>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,146,46,.6))' }} />
          <span
            style={{
              fontFamily: FONT.display,
              fontStyle: 'italic',
              fontSize: 19,
              letterSpacing: '2px',
              color: COLOR.goldHot,
              whiteSpace: 'nowrap',
            }}
          >
            non revertitur
          </span>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(201,146,46,.6), transparent)' }} />
        </div>
      </div>

      <button
        ref={skipButtonRef}
        type="button"
        className="mp-skip"
        onClick={() => skipRef.current()}
        style={{
          position: 'absolute',
          right: 'max(18px, env(safe-area-inset-right))',
          bottom: 'max(18px, env(safe-area-inset-bottom))',
          minHeight: 44,
          padding: '0 18px',
          background: 'rgba(12,7,15,.4)',
          border: '1px solid rgba(201,146,46,.28)',
          color: COLOR.goldLabel,
          fontFamily: FONT.instrument,
          fontSize: 11,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          transition: 'color .2s, border-color .2s',
        }}
      >
        Skip intro
      </button>
    </div>
  );
}
