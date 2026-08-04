/**
 * SigilSvg.tsx — the only place sigil geometry becomes markup
 *
 * The ceremony preview, the certificate and the gallery all render through this,
 * so a sigil cannot look like one thing on screen and another on the sheet.
 *
 * Geometry comes from generateSigil() and is never computed here. The fill spec
 * (radial gradient stops, stroke opacity, widths) is from the certificate
 * handoff and is shared for the same reason.
 */

import { useMemo } from 'react';
import { generateSigil, type SigilGeometry } from './sigil';
import { COLOR } from '../design/tokens';

type Props = {
  seed: number;
  accent: string;
  secondary: string;
  /** Caps the rendered size. The certificate's budget depends on this being 300. */
  maxWidthPx?: number;
  className?: string;
};

export function SigilSvg({ seed, accent, secondary, maxWidthPx = 300, className }: Props) {
  const g: SigilGeometry = useMemo(() => generateSigil(seed), [seed]);

  return (
    <svg
      viewBox={g.viewBox}
      width="100%"
      height="100%"
      className={className}
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        // The viewBox is square, so the element box must be too.
        //
        // IMPORTANT: without this the flex parent stretches the box to whatever
        // height is going spare — measured at 300x445 on the certificate — and
        // preserveAspectRatio quietly letterboxes the drawing inside it. Nothing
        // looks broken, but the sigil renders 300x300 with ~145px of dead space
        // and the page budget's "sigil <= 300px" line stops being true.
        aspectRatio: '1 / 1',
        maxHeight: '100%',
        maxWidth: `${maxWidthPx}px`,
        margin: '0 auto',
        // The certificate treats the sigil as the one flexible element in a fixed
        // page budget: everything else is fixed, so this is what shrinks.
        flex: '0 1 auto',
      }}
      // Decorative: every fact the sigil encodes is also in the ledger table as
      // text, so announcing it would only duplicate the record.
      aria-hidden="true"
    >
      <defs>
        {/* Seed-suffixed so several sigils on one page do not collide. */}
        <radialGradient id={g.gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="55%" stopColor={secondary} stopOpacity="0.42" />
          <stop offset="100%" stopColor={COLOR.plum} stopOpacity="0.05" />
        </radialGradient>
      </defs>

      <path
        d={g.pool}
        fill={`url(#${g.gradientId})`}
        stroke={accent}
        strokeOpacity="0.55"
        strokeWidth="0.9"
      />

      {g.tendrils.map((t, i) => (
        <line
          key={`t${i}`}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={secondary}
          strokeOpacity={t.strokeOpacity}
          strokeWidth={t.strokeWidth}
        />
      ))}

      {g.satellites.map((s, i) => (
        <circle
          key={`s${i}`}
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          fill={secondary}
          fillOpacity={s.fillOpacity}
        />
      ))}
    </svg>
  );
}
