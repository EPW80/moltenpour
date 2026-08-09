/**
 * CertificateView.tsx — the sheet on screen
 *
 * The certificate is print geometry and MUST NOT REFLOW. It is always laid out
 * at exactly 794 x 1123 and CSS-scaled to fit whatever column it has been given;
 * nothing about the sheet responds to width. This component is the toolbar and
 * that scale box, and it is the only thing between the app and Certificate.tsx.
 *
 * IMPORTANT: the scale comes from a ResizeObserver on this wrapper's own parent,
 * measured directly. Do not derive it from the viewport, and do not borrow
 * another element's width — an earlier iteration measured a sibling, came out
 * about twenty-one pixels wide, and clipped the sheet's right-hand rule clean
 * off the page without anything appearing to be broken.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { Certificate, PAGE_H, PAGE_W } from "./Certificate";
import { COLOR, FONT } from "../design/tokens";
import type { PourRecord } from "../pour/record";

type Zoom = "fit" | "full";

export function CertificateView({ pour }: { pour: PourRecord }) {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [columnW, setColumnW] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = Math.round(host.clientWidth);
    if (w > 0) setColumnW((prev) => (prev === w ? prev : w));
  }, []);

  useLayoutEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [measure]);

  // Never scale up: a sheet enlarged past 100% is a blurry sheet, and the point
  // of the fit mode is to show the whole page, not to fill the column.
  const available = columnW > 0 ? columnW : PAGE_W;
  const scale = zoom === "fit" ? Math.min(1, available / PAGE_W) : 1;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div
        className="app-chrome"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 24,
          width: "100%",
          fontSize: 11,
          letterSpacing: "2.6px",
          textTransform: "uppercase",
          color: COLOR.goldLabel,
          paddingBottom: 10,
          borderBottom: `1px solid ${COLOR.ruleMid}`,
        }}
      >
        <span>
          A4 · {PAGE_W} × {PAGE_H} · shown at {Math.round(scale * 100)} %
        </span>
        <span style={{ display: "flex", gap: 22 }}>
          <ToolbarButton
            onClick={() => setZoom(zoom === "fit" ? "full" : "fit")}
          >
            {zoom === "fit" ? "View at 100 %" : "Fit to page"}
          </ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>Print</ToolbarButton>
        </span>
      </div>

      {/* The measured host. It is a plain full-width block on purpose: it is the
          thing whose width defines the scale, so it must not be sized by its
          own contents. */}
      <div
        ref={hostRef}
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        <div
          className="print-root"
          style={{
            // Sized to the SCALED sheet, because a transform does not change how
            // much room an element takes up in flow.
            width: zoom === "fit" ? Math.floor(PAGE_W * scale) : available,
            height:
              zoom === "fit"
                ? Math.floor(PAGE_H * scale)
                : Math.min(PAGE_H, Math.round(available * 1.414)),
            overflow: zoom === "fit" ? "hidden" : "auto",
            marginBottom: 26,
          }}
        >
          <div
            className="sheet-scale"
            style={{
              width: PAGE_W,
              height: PAGE_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <Certificate pour={pour} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 0,
        background: "transparent",
        border: 0,
        color: COLOR.goldBody,
        fontFamily: FONT.instrument,
        fontSize: 11,
        letterSpacing: "2.6px",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
