/**
 * PourScreen.tsx — the ceremony
 *
 * A graduated instrument on the left, a ruled ledger on the right. Hold the
 * vessel to open the stream, lean to steer it, release and let it settle, then
 * seal the pour into a certificate.
 *
 * The vessel is not an illustration of the pour. It IS the pour: app/ceremony/rig.ts
 * counts the blobs the shader draws, and those counts are what gets hashed into
 * the sigil. See the invariants at the top of rig.ts before touching the loop.
 *
 * TWO THINGS RUN AT SIXTY HERTZ AND NEITHER MAY RENDER:
 *
 *   1. The rig steps on its own requestAnimationFrame, independent of WebGL.
 *      The renderer is attached and detached by a callback ref and only ever
 *      draws. A machine that cannot give us a GL context loses the picture and
 *      keeps the pour.
 *   2. The readout is painted straight into DOM nodes through refs — bar widths
 *      via style.width, values via textContent, each guarded by an equality
 *      check. setState fires only on real transitions: a phase change, or a
 *      rarity band change. Driving the bars through state makes the pour stutter
 *      visibly.
 *
 * Register: restrained, institutional, faintly funereal. No celebration, no
 * "Pour again", no mystery-box framing, no flame imagery. If a choice here feels
 * playful, it is wrong.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { backingSize, createRenderer, type Renderer } from "./metaball";
import {
  createRig,
  FLOOR_Y,
  isSettled,
  MAX_BLOBS,
  resetRig,
  SPOUT_Y,
  stepRig,
  telemetryOf,
} from "./rig";
import { formatConsideration, reachableRarity, TIERS, tierAt } from "./tiers";
import { classify, scoreParts, THRESHOLDS, type Rarity } from "../sigil/rarity";
import { COLOR, FONT, GRAIN_URL, RARITY_PRESENTATION } from "../design/tokens";
import type { MintRequest } from "../pour/record";

export type Phase = "idle" | "pouring" | "settling" | "settled";

/**
 * The tier row height, and the step the illuminated marker slides by.
 *
 * IMPORTANT: one constant for both. A marker that steps by a different number
 * than the rows are tall drifts a row out of register by the bottom of the
 * table, and it drifts silently.
 */
const ROW_H = 52;

/** How often the readout is repainted. Ten times a second reads as continuous. */
const READOUT_MS = 100;

const HARD_STOP_NOTICE =
  "Hard stop reached at fifteen seconds. The vessel accepts no more.";
const NO_WEBGL_NOTICE =
  "The vessel could not be lit — WebGL is unavailable in this context.";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Hold to pour",
  pouring: "Stream open",
  settling: "Settling",
  settled: "Stream closed",
};

const NOW_LABEL: Record<Phase, string> = {
  idle: "Selected for disbursement",
  pouring: "Now pouring",
  settling: "Now pouring",
  settled: "Poured · awaiting seal",
};

/** The four components of the rarity score, in weight order. */
const SPEC_ROWS = ["Fill", "Force", "Commitment", "Steadiness"] as const;

/**
 * The ceremony's graduations. They mark the fifteen-second hard stop, NOT
 * volume — the vessel has no volume, only a clock.
 */
const GRADUATIONS = ["15 s —", "12 s —", "9 s —", "6 s —", "3 s —", "0 —"];

const LABEL_11: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  color: COLOR.goldLabel,
};

type Props = {
  tierIndex: number;
  onTierIndex: (index: number) => void;
  phase: Phase;
  onPhase: (phase: Phase) => void;
  rarity: Rarity;
  onRarity: (rarity: Rarity) => void;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  sealing: boolean;
  wide: boolean;
  onMint: (request: MintRequest) => void;
};

export function PourScreen({
  tierIndex,
  onTierIndex,
  phase,
  onPhase,
  rarity,
  onRarity,
  notice,
  onNotice,
  sealing,
  wide,
  onMint,
}: Props) {
  const tier = tierAt(tierIndex);
  const { accent } = RARITY_PRESENTATION[rarity];
  const poured = phase !== "idle";
  const settled = phase === "settled";

  const rigRef = useRef(createRig(tier));
  const rendererRef = useRef<Renderer | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The vessel has no picture, because this context could not give us a GL
   * context.
   *
   * Held apart from the shell's notice on purpose. A standing condition and a
   * transient message are different things: the shell's notice is cleared every
   * time the stream opens, and routing this through it meant the warning
   * vanished the instant the user did the thing it was warning them about.
   */
  const [unlit, setUnlit] = useState(false);

  // Everything the loop reads, held in refs so a frame never depends on a render
  // having happened first.
  const pouringRef = useRef(false);
  const leanRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const liveRef = useRef({
    tier,
    tierIndex,
    phase,
    rarity,
    onPhase,
    onRarity,
    onNotice,
  });
  liveRef.current = {
    tier,
    tierIndex,
    phase,
    rarity,
    onPhase,
    onRarity,
    onNotice,
  };

  // The nodes the loop writes to directly.
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const dropsRef = useRef<HTMLSpanElement | null>(null);
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const scoreBarRef = useRef<HTMLDivElement | null>(null);
  const specBarRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const specValRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const openStream = useCallback(() => {
    const rig = rigRef.current;
    const { phase: at } = liveRef.current;
    if (at === "settled" || rig.finished || pouringRef.current) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    pouringRef.current = true;
    if (at !== "pouring") {
      liveRef.current.onPhase("pouring");
      liveRef.current.onNotice(null);
    }
  }, []);

  const closeStream = useCallback(() => {
    if (!pouringRef.current) return;
    pouringRef.current = false;
    liveRef.current.onPhase("settling");
  }, []);

  const discard = useCallback(() => {
    pouringRef.current = false;
    startedAtRef.current = null;
    resetRig(rigRef.current);
    liveRef.current.onPhase("idle");
    liveRef.current.onRarity("Common");
    liveRef.current.onNotice(null);
  }, []);

  /**
   * The renderer's whole lifecycle, on a callback ref.
   *
   * IMPORTANT: this cannot be a mount-keyed effect. The canvas unmounts every
   * time the user changes view, and an effect that sets GL up on mount leaves a
   * live context attached to a detached canvas — measured as a leaked frame loop
   * drawing into nothing.
   */
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasElRef.current = el;
    if (!el) {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      return;
    }
    const renderer = createRenderer(el);
    rendererRef.current = renderer;
    setUnlit(!renderer);
  }, []);

  /**
   * The pour loop. Started once, on mount, and deliberately not keyed to the
   * tier, the phase or the canvas — restarting it mid-pour would drop the frames
   * the rig is integrating over, and the telemetry would show it.
   */
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let readoutAcc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtMs = last ? Math.min(now - last, 100) : 16;
      last = now;

      const rig = rigRef.current;
      const canvas = canvasElRef.current;
      if (!canvas) return;
      const { width, height } = rendererRef.current ?? backingSize(canvas);

      const wasFinished = rig.finished;
      stepRig(
        rig,
        {
          pouring: pouringRef.current,
          lean: leanRef.current,
          tier: liveRef.current.tier,
        },
        dtMs,
        width,
        height,
      );
      rendererRef.current?.draw(rig);

      // The hard stop closes the stream on the ceremony's behalf. The rig
      // enforces it too, so this is the announcement rather than the mechanism.
      if (rig.finished && !wasFinished) {
        if (pouringRef.current) {
          pouringRef.current = false;
          liveRef.current.onPhase("settling");
        }
        liveRef.current.onNotice(HARD_STOP_NOTICE);
      }

      if (
        liveRef.current.phase === "settling" &&
        isSettled(rig, pouringRef.current)
      ) {
        liveRef.current.onPhase("settled");
      }

      readoutAcc += dtMs;
      if (readoutAcc >= READOUT_MS) {
        readoutAcc = 0;
        paintReadout();
      }
    };

    /** Straight to the DOM. Nothing in here may call setState unconditionally. */
    const paintReadout = () => {
      const rig = rigRef.current;
      const telemetry = telemetryOf(rig);
      const parts = scoreParts(telemetry, liveRef.current.tierIndex);

      const text = (node: HTMLElement | null, value: string) => {
        if (node && node.textContent !== value) node.textContent = value;
      };
      const width = (node: HTMLElement | null, permille: number) => {
        const value = `${(permille / 10).toFixed(1)}%`;
        if (node && node.style.width !== value) node.style.width = value;
      };

      text(elapsedRef.current, `${(rig.holdMs / 1000).toFixed(2)} s`);
      text(
        dropsRef.current,
        `${rig.dropletsLanded} drops · ${rig.alive}/${MAX_BLOBS}`,
      );

      const values = [
        String(telemetry.dropletsLanded),
        String(Math.round(telemetry.peakVelocity)),
        `${(rig.holdMs / 1000).toFixed(1)}s`,
        `${(parts.steadiness / 10).toFixed(0)}%`,
      ];
      const permilles = [
        parts.fill,
        parts.force,
        parts.commitment,
        parts.steadiness,
      ];
      for (let i = 0; i < SPEC_ROWS.length; i++) {
        width(specBarRefs.current[i], permilles[i]);
        text(specValRefs.current[i], values[i]);
      }

      text(scoreRef.current, `${parts.score} / 1000`);
      width(scoreBarRef.current, parts.score);

      // The one genuine transition in here: a new band recolours every accent on
      // the page, so it has to be state.
      const band = classify(telemetry, liveRef.current.tierIndex);
      if (band !== liveRef.current.rarity) liveRef.current.onRarity(band);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Real device tilt where it exists. No permission prompt on load: iOS gates
  // this behind a user gesture, and asking before the user has chosen to pour is
  // the kind of thing that reads as a dark pattern.
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      if (typeof e.gamma === "number")
        leanRef.current = Math.max(-1, Math.min(1, e.gamma / 45));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  // Traverse the schedule from the keyboard, wrapping, and only while the vessel
  // is still free to change.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "idle" || (e.key !== "ArrowUp" && e.key !== "ArrowDown"))
        return;
      e.preventDefault();
      onTierIndex(
        (tierIndex + (e.key === "ArrowDown" ? 1 : TIERS.length - 1)) %
          TIERS.length,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, tierIndex, onTierIndex]);

  const stageHeight = wide
    ? "min(70vh, 720px, (100vw - 720px) * 1.7778)"
    : "min(58vh, 520px)";

  return (
    <div
      style={{
        display: "grid",
        gap: "clamp(26px, 3vw, 44px)",
        alignItems: "start",
        gridTemplateColumns: wide
          ? "minmax(260px, 1fr) minmax(340px, 440px)"
          : "minmax(0, 1fr)",
      }}
    >
      {/* ── The vessel ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          justifySelf: "center",
          display: "flex",
          alignItems: "center",
          gap: 16,
          maxWidth: "100%",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: stageHeight,
            padding: "2px 0",
            fontSize: 11,
            letterSpacing: "1.6px",
            color: COLOR.goldFaint,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {GRADUATIONS.map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Hold to pour"
          onPointerDown={(e) => {
            // Captured so a drag that leaves the stage still steers the stream
            // rather than silently closing it.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Not every pointer can be captured; the pour does not depend on it.
            }
            openStream();
          }}
          onPointerUp={closeStream}
          onPointerLeave={closeStream}
          onPointerCancel={closeStream}
          onPointerMove={(e) => {
            if (!pouringRef.current) return;
            const box = e.currentTarget.getBoundingClientRect();
            leanRef.current = Math.max(
              -1,
              Math.min(1, ((e.clientX - box.left) / box.width - 0.5) * 2),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              openStream();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") closeStream();
          }}
          style={{
            position: "relative",
            aspectRatio: "9 / 16",
            height: stageHeight,
            width: "auto",
            maxWidth: "100%",
            background: COLOR.panel,
            border: `1px solid ${phase === "pouring" ? "rgba(245,214,122,.6)" : COLOR.ruleStage}`,
            boxShadow:
              "0 0 120px 10px rgba(201,146,46,.09), inset 0 0 0 1px rgba(12,7,15,.9)",
            overflow: "hidden",
            touchAction: "none",
            userSelect: "none",
            cursor: settled ? "default" : "pointer",
            transition: "border-color .4s linear",
          }}
        >
          <canvas
            ref={attachCanvas}
            style={{ display: "block", width: "100%", height: "100%" }}
          />

          {/* Everything below this line is instrument marking, and none of it may
              take a pointer event away from the vessel. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: 0.16,
              mixBlendMode: "overlay",
              backgroundImage: GRAIN_URL,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: "inset 0 0 100px 34px rgba(10,6,13,.8)",
            }}
          />

          {/* The spout and pool callouts read their positions from the rig, so a
              label can never end up naming a line the fluid does not use. */}
          <Callout label="Spout" top={SPOUT_Y} ruleFirst />
          <Callout label="Pool line" top={FLOOR_Y} />

          {(["top", "bottom"] as const).map((v) =>
            (["left", "right"] as const).map((h) => (
              <div
                key={`${v}-${h}`}
                style={{
                  position: "absolute",
                  [v]: 9,
                  [h]: 9,
                  width: 16,
                  height: 16,
                  pointerEvents: "none",
                  [v === "top" ? "borderTop" : "borderBottom"]:
                    `1px solid ${COLOR.tickStage}`,
                  [h === "left" ? "borderLeft" : "borderRight"]:
                    `1px solid ${COLOR.tickStage}`,
                }}
              />
            )),
          )}

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "46%",
              pointerEvents: "none",
              display: "flex",
              justifyContent: "center",
              fontSize: 11,
              letterSpacing: "3.4px",
              textTransform: "uppercase",
              color: COLOR.goldHot,
              textShadow: "0 0 20px rgba(10,6,13,.9)",
              opacity: settled ? 0.45 : 1,
            }}
          >
            {PHASE_LABEL[phase]}
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              padding: "16px 26px 14px",
              ...LABEL_11,
              letterSpacing: "1.8px",
              background:
                "linear-gradient(to top, rgba(10,6,13,.9), transparent)",
            }}
          >
            <span
              ref={elapsedRef}
              style={{
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              0.00 s
            </span>
            <span
              ref={dropsRef}
              style={{
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              0 drops · 0/{MAX_BLOBS}
            </span>
          </div>
        </div>
      </div>

      {/* ── The ledger ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          minWidth: 0,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              ...LABEL_11,
              letterSpacing: "3.2px",
              paddingBottom: 10,
              borderBottom: `1px solid ${COLOR.ruleMid}`,
            }}
          >
            <span>Tier</span>
            <span>Consideration</span>
          </div>

          <div style={{ position: "relative" }}>
            {/* The marker. Bleeds past the table on both sides so the illuminated
                edge reads as a rule in the margin rather than a selected cell. */}
            <div
              style={{
                position: "absolute",
                left: -16,
                right: -16,
                top: 0,
                height: ROW_H,
                pointerEvents: "none",
                background:
                  "linear-gradient(90deg, rgba(201,146,46,.2), rgba(201,146,46,.02) 70%)",
                borderLeft: `2px solid ${accent}`,
                boxShadow: "-2px 0 22px rgba(245,214,122,.25)",
                transform: `translateY(${tierIndex * ROW_H}px)`,
                transition: "transform .45s cubic-bezier(.22,1,.36,1)",
              }}
            />

            {TIERS.map((t) => {
              const selected = t.index === tierIndex;
              return (
                <button
                  key={t.index}
                  type="button"
                  disabled={poured}
                  onClick={() => onTierIndex(t.index)}
                  style={{
                    position: "relative",
                    display: "flex",
                    width: "100%",
                    height: ROW_H,
                    alignItems: "center",
                    gap: 12,
                    padding: 0,
                    background: "transparent",
                    border: 0,
                    borderBottom: `1px solid ${COLOR.ruleHair}`,
                    color: selected ? COLOR.goldCream : COLOR.goldLabel,
                    fontFamily: FONT.instrument,
                    textAlign: "left",
                    // The tier is fixed the moment the stream opens.
                    cursor: poured ? "not-allowed" : "pointer",
                    opacity: poured && !selected ? 0.28 : 1,
                    transition: "color .2s, opacity .3s",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      letterSpacing: "1.6px",
                      color: COLOR.goldFaint,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {String(t.index + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      letterSpacing: "2.8px",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flex: 1,
                      minWidth: 12,
                      height: 1,
                      background: `repeating-linear-gradient(90deg, rgba(201,146,46,.35) 0 1px, transparent 1px 5px)`,
                    }}
                  />
                  {/* What this tier can reach at best, computed from the real
                      clamp and classifier — so Sample reads as its own ceiling
                      rather than a broken Full Pour. */}
                  <span
                    style={{
                      fontSize: 11,
                      letterSpacing: "1.4px",
                      textTransform: "uppercase",
                      color: COLOR.goldFaint,
                      whiteSpace: "nowrap",
                    }}
                  >
                    to {reachableRarity(t.index)}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.display,
                      fontSize: 17,
                      letterSpacing: ".2px",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatConsideration(t.amountCents)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            paddingBottom: 22,
            borderBottom: `1px solid ${COLOR.ruleMid}`,
          }}
        >
          <span style={{ ...LABEL_11, letterSpacing: "3.2px" }}>
            {NOW_LABEL[phase]}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <span
              style={{
                fontFamily: FONT.display,
                fontSize: "clamp(30px, 3.4vw, 42px)",
                lineHeight: 0.92,
                color: COLOR.goldCream,
              }}
            >
              {tier.name}
            </span>
            <span
              style={{
                fontFamily: FONT.display,
                fontSize: "clamp(30px, 3.4vw, 42px)",
                lineHeight: 0.92,
                color: COLOR.bronze,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatConsideration(tier.amountCents)}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: FONT.display,
              fontStyle: "italic",
              fontSize: 17,
              lineHeight: 1.45,
              color: COLOR.goldFaint,
              textWrap: "pretty",
            }}
          >
            {tier.note}
          </p>
        </div>

        {/* The spec sheet: the four components of the score, in weight order.
            Painted from the loop; never rendered from state. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          {SPEC_ROWS.map((label, i) => (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "104px 1fr 62px",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ ...LABEL_11, letterSpacing: "2.2px" }}>
                {label}
              </span>
              <span
                style={{
                  position: "relative",
                  display: "block",
                  height: 6,
                  background:
                    "repeating-linear-gradient(90deg, rgba(201,146,46,.22) 0 1px, transparent 1px 7px)",
                }}
              >
                <span
                  ref={(el) => {
                    specBarRefs.current[i] = el;
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 2,
                    bottom: 2,
                    width: 0,
                    background: `linear-gradient(90deg, ${COLOR.goldLabel}, ${COLOR.goldHot})`,
                    boxShadow: "0 0 12px rgba(245,214,122,.45)",
                  }}
                />
              </span>
              <span
                ref={(el) => {
                  specValRefs.current[i] = el;
                }}
                style={{
                  fontSize: 11,
                  letterSpacing: "1.2px",
                  color: COLOR.goldLabel,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                0
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 11,
            paddingTop: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              ...LABEL_11,
              letterSpacing: "2.2px",
            }}
          >
            <span>Classification</span>
            <span
              ref={scoreRef}
              style={{ fontVariantNumeric: "tabular-nums", color: accent }}
            >
              0 / 1000
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 8,
              background: COLOR.ruleHair,
            }}
          >
            <div
              ref={scoreBarRef}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 0,
                background: `linear-gradient(90deg, ${COLOR.goldLabel}, ${accent})`,
                boxShadow: "0 0 14px rgba(245,214,122,.4)",
              }}
            />
            {/* Derived from the thresholds themselves. A re-tuned band moves its
                own tick; a hardcoded percentage here would quietly lie. */}
            {[THRESHOLDS.uncommon, THRESHOLDS.rare, THRESHOLDS.singular].map(
              (t) => (
                <span
                  key={t}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -3,
                    bottom: -3,
                    left: `${t / 10}%`,
                    width: 1,
                    background: "rgba(201,146,46,.55)",
                  }}
                />
              ),
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: COLOR.goldFaint,
            }}
          >
            <span>Common</span>
            <span>Uncommon</span>
            <span>Rare</span>
            <span>Singular</span>
          </div>
        </div>

        {/* One band, two sources. A transient notice — the hard stop, a failed
            seal — speaks over the standing one, which comes back when it clears. */}
        {(notice ?? (unlit ? NO_WEBGL_NOTICE : null)) && (
          <div
            role="alert"
            style={{
              padding: "12px 0",
              borderTop: `1px solid rgba(245,214,122,.5)`,
              borderBottom: `1px solid rgba(245,214,122,.5)`,
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <span
              style={{
                fontSize: 11,
                letterSpacing: "2.8px",
                textTransform: "uppercase",
                color: COLOR.goldHot,
              }}
            >
              Notice
            </span>
            <span
              style={{
                fontSize: 12,
                letterSpacing: "1.2px",
                color: COLOR.goldLabel,
                textWrap: "pretty",
              }}
            >
              {notice ?? NO_WEBGL_NOTICE}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, paddingBottom: 8 }}>
          <button
            type="button"
            disabled={!settled || sealing}
            onClick={() => {
              if (!settled || sealing) return;
              onMint({
                tierIndex,
                // The pour's real start, not the mint time: it feeds the seed
                // hash, so a later figure would mint a sigil the user never saw.
                timestampMs: startedAtRef.current ?? Date.now(),
                telemetry: telemetryOf(rigRef.current),
              });
            }}
            style={{
              position: "relative",
              flex: 1,
              padding: "17px 12px",
              background: settled ? "rgba(201,146,46,.16)" : "transparent",
              border: `1px solid ${settled ? COLOR.ruleEnabled : COLOR.ruleDisabled}`,
              color: settled ? COLOR.goldCream : COLOR.goldFaint,
              fontFamily: FONT.instrument,
              fontSize: 11,
              letterSpacing: "3px",
              textTransform: "uppercase",
              cursor: settled && !sealing ? "pointer" : "not-allowed",
              transition: "background .3s, border-color .3s, color .3s",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 3,
                pointerEvents: "none",
                border: `1px solid ${settled ? "rgba(201,146,46,.22)" : "transparent"}`,
              }}
            />
            {sealing
              ? "Disbursing…"
              : phase === "settling"
                ? "Settling…"
                : phase === "pouring"
                  ? "Stream open"
                  : settled
                    ? `Complete disbursement · ${rarity}`
                    : "Complete disbursement"}
          </button>
          {poured && (
            <button
              type="button"
              onClick={discard}
              style={{
                padding: "17px 20px",
                background: "transparent",
                border: `1px solid ${COLOR.ruleDisabled}`,
                color: COLOR.goldFaint,
                fontFamily: FONT.instrument,
                fontSize: 11,
                letterSpacing: "2.4px",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Discard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A dashed rule and a label, naming one of the two lines the rig actually uses. */
function Callout({
  label,
  top,
  ruleFirst = false,
}: {
  label: string;
  top: number;
  ruleFirst?: boolean;
}) {
  const rule = (
    <span
      style={{
        flex: 1,
        height: 1,
        background:
          "repeating-linear-gradient(90deg, rgba(245,214,122,.3) 0 3px, transparent 3px 8px)",
      }}
    />
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${top * 100}%`,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px",
      }}
    >
      {ruleFirst && rule}
      <span
        style={{
          fontSize: 11,
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "rgba(245,214,122,.72)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {!ruleFirst && rule}
    </div>
  );
}
