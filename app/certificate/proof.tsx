/**
 * proof.tsx — the certificate proof sheet
 *
 * Renders one certificate per rarity from synthetic records, with no API and no
 * pour. Two jobs:
 *
 *  1. The comparison the handoff asks for by name: a Common sheet beside a
 *     Singular one. If Common reads as a consolation prize, that is a bug, and
 *     this is where it is visible.
 *  2. A fixed target for the print-geometry check in scripts/verify-certificate,
 *     which measures the rendered stack against the 794x1123 page box.
 *
 * Served at /proof.html. Not part of the app bundle.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Certificate } from "./Certificate";
import { RARITIES, type Rarity } from "../sigil/rarity";
import { COLOR, FONT } from "../design/tokens";
import type { PourRecord } from "../pour/record";

// proof.html loads nothing but this module, so these two imports are the only
// path by which the page gets a typeface and a ground. Without the first, the
// sheet renders in a fallback serif — silently, and both scripts that drive this
// page then measure the wrong metrics. Not print.css: see below.
import "./fonts/bodoni.css";
import "../global.css";

/** One representative record per rarity, at a plausible tier for that outcome. */
function specimen(rarity: Rarity, i: number): PourRecord {
  const tierIndex = [0, 2, 4, 5][i] ?? 0;
  const amountCents = [0, 999, 4999, 9999][i] ?? 0;
  const seed = 1284 + i * 7919;
  const droplets = 82 + i * 37;
  return {
    id: `proof-${rarity}`,
    ledgerPosition: 1284 + i,
    tierIndex,
    amountCents,
    timestampMs: 1_785_000_000_000,
    telemetry: {
      dropletsLanded: droplets,
      peakVelocity: 1980.61,
      tiltEnergy: 12.5,
      holdMs: 7085,
    },
    violations: [],
    seed,
    rarity,
    rarityScore: 300 + i * 150,
    serial: `MP-${String(1284 + i).padStart(7, "0")}-${(seed & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`,
    batch: `${String((1284 + i) % 1000).padStart(3, "0")}-T`,
    massGrams: droplets * 3.79,
    issued: "2026-08-02",
  };
}

/**
 * A real pour, passed in the query string.
 *
 * scripts/certificate-pdf.ts fetches a record from the API and hands it here so
 * the exported sheet is rendered by the same component the app renders, rather
 * than a second implementation that could drift from it.
 */
function recordFromQuery(): PourRecord | null {
  const raw = new URLSearchParams(window.location.search).get("record");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PourRecord;
  } catch {
    console.error("proof: ?record= is not valid JSON");
    return null;
  }
}

function Proof() {
  const single = recordFromQuery();
  if (single) {
    // One sheet, no chrome, no caption — this is what gets printed.
    //
    // Deliberately outside the app's print shell: this page never loads
    // print.css, and both scripts/certificate-pdf.ts and verify-certificate.ts
    // isolate the sheet and pass their own page margins. Importing print.css
    // here would put a second, differently-configured @page rule in their way.
    return (
      <div data-proof-sheet="single">
        <Certificate pour={single} />
      </div>
    );
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: FONT.instrument,
        color: COLOR.goldBody,
      }}
    >
      <h1
        style={{
          fontSize: 12,
          letterSpacing: "3px",
          textTransform: "uppercase",
          color: COLOR.goldLabel,
          fontWeight: 400,
          margin: "0 0 20px",
        }}
      >
        Certificate proof · all classifications · A4 794×1123
      </h1>
      <div
        style={{
          display: "flex",
          gap: 32,
          alignItems: "flex-start",
          overflowX: "auto",
        }}
      >
        {RARITIES.map((rarity, i) => (
          <figure
            key={rarity}
            style={{
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div data-proof-sheet={rarity}>
              <Certificate pour={specimen(rarity, i)} />
            </div>
            <figcaption
              style={{
                fontSize: 12,
                letterSpacing: "2.4px",
                textTransform: "uppercase",
                color: COLOR.goldLabel,
              }}
            >
              {rarity}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from proof.html");
createRoot(root).render(
  <StrictMode>
    <Proof />
  </StrictMode>,
);
