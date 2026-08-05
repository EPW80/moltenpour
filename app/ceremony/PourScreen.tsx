/**
 * PourScreen.tsx — the ceremony
 *
 * Hold to pour, tilt to steer. The preview updates live, and the sigil it shows
 * is computed through exactly the pipeline the server will run: clampTelemetry →
 * hashSeed → generateSigil, with the same client-chosen timestamp that will be
 * posted. That is what makes the preview honest rather than decorative.
 *
 * Register: restrained, institutional, faintly funereal. No celebration, no
 * "Pour again", no mystery-box framing, no flame imagery. If a choice here feels
 * playful, it is wrong.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SigilSvg } from '../sigil/SigilSvg';
import { hashSeed } from '../sigil/sigil';
import { classify } from '../sigil/rarity';
import { clampTelemetry, SIM } from '../sigil/telemetry';
import { COLOR, FONT, RARITY_PRESENTATION } from '../design/tokens';
import { mintPour, type PourRecord } from '../pour/record';
import { createPour, stepPour, telemetryOf, type PourState } from './sim';
import { formatConsideration, MAX_POUR_MS, reachableRarity, TIERS, tierAt } from './tiers';

/**
 * The vessel sizes itself to the viewport — the brief calls this a mobile app,
 * and a fixed 360x420 box is a desktop assumption.
 *
 * This is safe for the telemetry, which is the only reason to think twice. The
 * clamp's velocity ceiling is time-based (spawnVyMax + gravity * min(holdS, 1.2)),
 * not distance-based, so a taller vessel cannot push peak velocity past it; and
 * spawning is time-based while settling waits for every droplet to land, so the
 * droplet count is whatever the flow rate and the hold say it is. A pour of the
 * same duration earns the same rarity on a phone and on a monitor.
 */
const STAGE_MIN_W = 260;
const STAGE_MAX_W = 420;
/** Portrait, like the thing it is imitating. */
const STAGE_ASPECT = 420 / 360;
/** Inset from the bottom edge so a landed droplet's full radius stays visible. */
const FLOOR_INSET = 16;

type Props = {
  onMinted: (record: PourRecord) => void;
};

export function PourScreen({ onMinted }: Props) {
  const [tierIndex, setTierIndex] = useState(3);
  const [state, setState] = useState<PourState>(() => createPour(3));
  const [pouring, setPouring] = useState(false);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pour-start, fixed the moment the stream first opens. It feeds the hash, so it
  // must not be re-read per frame or the preview would churn.
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const inputRef = useRef({ pouring: false, tiltDeg: 0 });

  inputRef.current = { pouring, tiltDeg };

  const [stage, setStage] = useState({ w: 360, h: 420 });
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Measure the space the vessel actually has rather than assuming it.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const measure = () => {
      const available = shell.getBoundingClientRect().width;
      const w = Math.round(Math.max(STAGE_MIN_W, Math.min(STAGE_MAX_W, available)));
      setStage((prev) => (prev.w === w ? prev : { w, h: Math.round(w * STAGE_ASPECT) }));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tick = (t: number) => {
      const dt = lastRef.current ? t - lastRef.current : 16;
      lastRef.current = t;
      // Read the size through a ref so a resize does not restart the loop —
      // cancelling and re-requesting mid-pour would drop frames the sim is
      // integrating over, and the telemetry would show it.
      const { w, h } = stageRef.current;
      setState((s) => stepPour(s, inputRef.current, dt, w, h - FLOOR_INSET));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastRef.current = 0;
    };
  }, []);

  // Real device tilt where it exists. No permission prompt on load: iOS gates
  // this behind a user gesture, and asking before the user has chosen to pour is
  // the kind of thing that reads as a dark pattern.
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      if (typeof e.gamma === 'number') setTiltDeg(e.gamma);
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, []);

  const startPour = useCallback(() => {
    if (state.finished || minting) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    setPouring(true);
  }, [state.finished, minting]);

  const stopPour = useCallback(() => setPouring(false), []);

  const reset = useCallback(
    (nextTier: number) => {
      setTierIndex(nextTier);
      setState(createPour(nextTier));
      setPouring(false);
      startedAtRef.current = null;
      setError(null);
    },
    [],
  );

  // The preview. Same three calls, same order, same inputs the server will use.
  //
  // Once the pour has settled this stops moving, because telemetryOf(state) stops
  // moving — which is the point. What is on screen at that moment is what gets
  // minted, and the button below refuses to mint before then.
  const preview = useMemo(() => {
    const timestampMs = startedAtRef.current ?? Date.now();
    const raw = telemetryOf(state);
    // The wall clock the server will measure is now-minus-start; using the same
    // figure here is what keeps the preview from promising a hold the server will
    // then clamp away.
    const wallClockMs = startedAtRef.current === null ? 0 : Date.now() - startedAtRef.current;
    const { telemetry, violations } = clampTelemetry(raw, tierIndex, wallClockMs);
    const seed = hashSeed({
      tierIndex,
      amountCents: tierAt(tierIndex).amountCents,
      timestampMs,
      telemetry,
    });
    return { seed, telemetry, violations, rarity: classify(telemetry, tierIndex), timestampMs };
  }, [state, tierIndex]);

  const { accent, secondary, substance } = RARITY_PRESENTATION[preview.rarity];
  const progress = Math.min(state.holdMs / MAX_POUR_MS, 1);
  const poured = state.holdMs > 0;

  // Not merely "has poured": the pour must have settled, or the telemetry posted
  // here is not the telemetry the preview drew.
  const mintable = state.settled && !minting;

  const mint = useCallback(async () => {
    if (!mintable) return;
    setMinting(true);
    setError(null);
    try {
      const record = await mintPour({
        tierIndex,
        timestampMs: preview.timestampMs,
        telemetry: telemetryOf(state),
      });
      onMinted(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }, [mintable, tierIndex, preview.timestampMs, state, onMinted]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '28px 20px 40px' }}>
      <header style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: FONT.display,
            fontWeight: 400,
            fontSize: 28,
            letterSpacing: '6px',
            textIndent: '6px',
            color: COLOR.goldCream,
          }}
        >
          MOLTEN POUR
        </h1>
        <span style={{ fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase', color: COLOR.goldLabel }}>
          Office of Disbursement
        </span>
      </header>

      <fieldset
        style={{
          border: `1px solid ${COLOR.rule}`,
          padding: '14px 16px 16px',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: STAGE_MAX_W,
          width: '100%',
        }}
      >
        <legend style={{ fontSize: 12, letterSpacing: '2.4px', textTransform: 'uppercase', color: COLOR.goldLabel, padding: '0 6px' }}>
          Disbursement
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TIERS.map((tier) => {
            const selected = tier.index === tierIndex;
            return (
              <button
                key={tier.index}
                type="button"
                disabled={poured}
                onClick={() => reset(tier.index)}
                style={{
                  flex: '1 0 auto',
                  padding: '8px 10px',
                  background: selected ? 'rgba(201,146,46,.14)' : 'transparent',
                  border: `1px solid ${selected ? COLOR.ruleStrong : COLOR.ruleRow}`,
                  color: selected ? COLOR.goldCream : COLOR.goldLabel,
                  fontFamily: FONT.instrument,
                  fontSize: 12,
                  letterSpacing: '1.6px',
                  textTransform: 'uppercase',
                  cursor: poured ? 'not-allowed' : 'pointer',
                  opacity: poured && !selected ? 0.4 : 1,
                }}
              >
                {tier.name}
                <br />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatConsideration(tier.amountCents)}</span>
                <br />
                {/* What this tier can reach at best. Stated plainly so nobody
                    pours the free tier repeatedly waiting for a Singular that
                    the reach curve will never give them. */}
                <span style={{ fontSize: 12, letterSpacing: '1.2px', opacity: 0.75 }}>
                  to {reachableRarity(tier.index)}
                </span>
              </button>
            );
          })}
        </div>
        {poured && (
          <p style={{ margin: 0, fontSize: 12, letterSpacing: '1.4px', color: COLOR.goldLabel }}>
            The tier is fixed once the stream opens.
          </p>
        )}
      </fieldset>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
        {/* The shell is what gets measured; the vessel takes the size it reports.
            Separating them keeps the ResizeObserver off the element whose size it
            is setting, which would otherwise feed back on itself. */}
        <div
          ref={shellRef}
          style={{
            flex: `1 1 ${STAGE_MIN_W}px`,
            maxWidth: STAGE_MAX_W,
            // IMPORTANT: a flex item's default min-width is auto, which refuses
            // to shrink below its content — and its content is the vessel, whose
            // width comes from measuring this shell. Without this the two pin
            // each other at whatever size they started, and the vessel never
            // adapts. Measured: 420px at every viewport until this was set.
            minWidth: 0,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {/* The vessel */}
        <div
          onPointerDown={startPour}
          onPointerUp={stopPour}
          onPointerLeave={stopPour}
          onPointerCancel={stopPour}
          role="button"
          tabIndex={0}
          aria-label="Hold to pour"
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              startPour();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') stopPour();
          }}
          style={{
            position: 'relative',
            width: stage.w,
            height: stage.h,
            border: `1px solid ${COLOR.rule}`,
            background: 'rgba(10,6,13,.4)',
            touchAction: 'none',
            cursor: state.finished ? 'default' : 'pointer',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <svg width={stage.w} height={stage.h} style={{ display: 'block' }} aria-hidden="true">
            {state.droplets.map((d, i) => (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={d.r}
                fill={d.landed ? secondary : accent}
                fillOpacity={d.landed ? 0.75 : 0.95}
              />
            ))}
          </svg>

          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              height: 2,
              width: `${progress * 100}%`,
              background: accent,
            }}
          />

          {!poured && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                letterSpacing: '3px',
                textTransform: 'uppercase',
                color: COLOR.goldLabel,
                pointerEvents: 'none',
              }}
            >
              Hold to pour
            </span>
          )}
        </div>
        </div>

        {/* The preview */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, flex: '1 1 260px', maxWidth: 300 }}>
          <div style={{ width: '100%', aspectRatio: '1 / 1', maxHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SigilSvg seed={preview.seed} accent={accent} secondary={secondary} maxWidthPx={300} />
          </div>
          <span style={{ fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase', color: secondary, textAlign: 'center' }}>
            {`${preview.rarity} · ${substance}`}
          </span>

          <dl
            style={{
              margin: 0,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              fontSize: 12,
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              color: COLOR.goldLabel,
            }}
          >
            {(
              [
                ['Droplets', String(preview.telemetry.dropletsLanded)],
                ['Hold', `${(preview.telemetry.holdMs / 1000).toFixed(2)} s`],
                ['Peak', `${Math.round(preview.telemetry.peakVelocity)} px/s`],
                ['Tilt', preview.telemetry.tiltEnergy.toFixed(2)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', borderBottom: `1px solid ${COLOR.ruleRow}` }}>
                <dt style={{ margin: 0 }}>{k}</dt>
                <dd style={{ margin: 0, color: accent, fontVariantNumeric: 'tabular-nums' }}>{v}</dd>
              </div>
            ))}
          </dl>

          {preview.violations.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, letterSpacing: '1.4px', color: COLOR.goldLabel }}>
              Clamped: {preview.violations.join(', ')}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={mint}
          disabled={!mintable}
          style={{
            padding: '12px 22px',
            background: 'transparent',
            border: `1px solid ${mintable ? COLOR.ruleStrong : COLOR.ruleRow}`,
            color: mintable ? COLOR.goldCream : COLOR.goldLabel,
            fontFamily: FONT.instrument,
            fontSize: 12,
            letterSpacing: '2.6px',
            textTransform: 'uppercase',
            cursor: mintable ? 'pointer' : 'not-allowed',
          }}
        >
          {minting ? 'Disbursing…' : poured && !state.settled ? 'Settling…' : 'Complete disbursement'}
        </button>
        {poured && (
          <button
            type="button"
            onClick={() => reset(tierIndex)}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: `1px solid ${COLOR.ruleRow}`,
              color: COLOR.goldLabel,
              fontFamily: FONT.instrument,
              fontSize: 12,
              letterSpacing: '2.2px',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Discard
          </button>
        )}
      </div>

      {state.finished && (
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: COLOR.goldLabel }}>
          Ceremony hard stop reached at {(SIM.maxPourMs / 1000).toFixed(0)} seconds.
        </p>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, letterSpacing: '1.6px', color: COLOR.goldHot, maxWidth: 420, textAlign: 'center' }}>
          {error}
        </p>
      )}
    </div>
  );
}
