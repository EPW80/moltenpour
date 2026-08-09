/**
 * viewport.ts — the one breakpoint, held in one place
 *
 * The index layout has a single responsive decision: above 900px the folio rail
 * shows, the main splits into vessel and ledger, and the tiles size up. Below it
 * everything stacks. That is read as a boolean rather than expressed as media
 * queries because three of the four things it controls are inline style values
 * computed in TypeScript, and a CSS copy of the number would be a second place
 * for it to drift.
 *
 * IMPORTANT: this is app chrome only. The certificate never reflows at any
 * width — only its fit scale changes — so nothing on the sheet may read this.
 */

import { useEffect, useState } from "react";

export const WIDE_PX = 900;

function measure(): boolean {
  return typeof window === "undefined" || window.innerWidth >= WIDE_PX;
}

/** True at or above the breakpoint. Re-renders only when the side flips. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(measure);

  useEffect(() => {
    const onResize = () =>
      setWide((prev) => (prev === measure() ? prev : !prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return wide;
}
