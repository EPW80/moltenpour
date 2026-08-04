/**
 * Certificate.tsx — the Certificate of Waste, one A4 sheet
 *
 * Ported from docs/handoffs/certificate-of-waste/. The colours, type scale,
 * spacing and copy there are final and print-exact; this is a rebuild in the
 * codebase's own primitives, not a copy of the prototype's shell.
 *
 * READ THE PRINT GEOMETRY NOTES BEFORE CHANGING ANY SIZE.
 *
 * The page is explicitly paginated: exactly one A4 sheet, full bleed, printed at
 * a fixed box with overflow:hidden. Content that misses the box is CLIPPED, not
 * pushed to a second sheet. Total content height at 794px wide must stay at or
 * under 1123px, and the current stack lands exactly on it:
 *
 *   52 top padding + 39 header + 20 title gap + ~104 title block
 *   + sigil (flexes, <=300) + 16 caption + 8 rows x ~26 + 30 "for nothing"
 *   + 39 footer + 46 bottom padding
 *
 * The sigil is the ONLY flexible element. If content is added, it shrinks first,
 * and it is the thing that should. Everything else is fixed.
 *
 * Two rules that look cosmetic and are not:
 *   - print-color-adjust: exact, or browsers drop the plum ground and this prints
 *     as gold text on white.
 *   - no viewport units anywhere. They track the window, not the sheet, and
 *     mis-size at print.
 *
 * This component does not author @page rules or paper dimensions. The print/PDF
 * setup owns page geometry — see printCertificate() in print.ts.
 */

import { SigilSvg } from '../sigil/SigilSvg';
import { COLOR, FONT, GRAIN_URL, PAGE_GROUND, RARITY_PRESENTATION } from '../design/tokens';
import { formatConsideration } from '../ceremony/tiers';
import { formatLedgerPosition, formatMass, type PourRecord } from '../pour/record';

/** A4 at 96dpi. ISO 216 portrait is specified by the product. */
export const PAGE_W = 794;
export const PAGE_H = 1123;

type Props = {
  pour: PourRecord;
  /**
   * The feTurbulence overlay. Cheapest thing to drop: consider false for the
   * print/PDF path if the printer muddies it, and on low-end devices, since
   * mix-blend-mode is the expensive part.
   */
  grain?: boolean;
};

const CORNERS = [
  ['top', 'left'],
  ['top', 'right'],
  ['bottom', 'left'],
  ['bottom', 'right'],
] as const satisfies readonly (readonly ['top' | 'bottom', 'left' | 'right'])[];

const LABEL: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '2.4px',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  margin: 0,
};

export function Certificate({ pour, grain = true }: Props) {
  // IMPORTANT: unknown rarity falls back to Common and logs. Silently upgrading
  // someone to the rarest tier is worse than a wrong colour, and the prototype's
  // Singular fallback was a design-time convenience, not the production rule.
  let rarity = pour.rarity;
  if (!RARITY_PRESENTATION[rarity]) {
    console.error(`certificate: unknown rarity ${JSON.stringify(rarity)}, falling back to Common`);
    rarity = 'Common';
  }
  const { accent, secondary, substance } = RARITY_PRESENTATION[rarity];

  const rows: [string, string][] = [
    ['Serial', pour.serial],
    ['Ledger position', formatLedgerPosition(pour.ledgerPosition)],
    ['Substance', substance],
    ['Classification', rarity],
    ['Mass rendered irrecoverable', formatMass(pour.massGrams)],
    ['Batch', pour.batch],
    ['Consideration', formatConsideration(pour.amountCents)],
    ['Issued', pour.issued],
  ];

  return (
    <section
      className="certificate-page"
      aria-label="Certificate of Waste"
      style={{
        position: 'relative',
        width: PAGE_W,
        height: PAGE_H,
        overflow: 'hidden',
        background: PAGE_GROUND,
        color: COLOR.goldBody,
        fontFamily: FONT.instrument,
        // Without this the dark ground is dropped at print and the certificate
        // comes out as gold text on white paper.
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    >
      {grain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: 0.14,
            mixBlendMode: 'overlay',
            backgroundImage: GRAIN_URL,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          boxShadow: `inset 0 0 120px 40px ${COLOR.shade}`,
        }}
      />

      {/* Double rule and corner registration ticks. */}
      <div style={{ position: 'absolute', inset: 26, pointerEvents: 'none', border: `1px solid ${COLOR.ruleStrong}` }} />
      <div style={{ position: 'absolute', inset: 33, pointerEvents: 'none', border: `1px solid ${COLOR.ruleMid}` }} />
      {/* Each tick is 15x15 with only the two borders that face the corner. */}
      {CORNERS.map(([vertical, horizontal]) => {
        const edge = `1px solid ${COLOR.tick}`;
        return (
          <div
            key={`${vertical}-${horizontal}`}
            style={{
              position: 'absolute',
              [vertical]: 40,
              [horizontal]: 40,
              width: 15,
              height: 15,
              pointerEvents: 'none',
              [vertical === 'top' ? 'borderTop' : 'borderBottom']: edge,
              [horizontal === 'left' ? 'borderLeft' : 'borderRight']: edge,
            }}
          />
        );
      })}

      <div
        style={{
          position: 'relative',
          height: '100%',
          boxSizing: 'border-box',
          padding: '52px 62px 46px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 1. Header strip */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 20,
            fontSize: 12,
            letterSpacing: '2.6px',
            textTransform: 'uppercase',
            color: secondary,
            paddingBottom: 14,
            borderBottom: `1px solid ${COLOR.rule}`,
          }}
        >
          {/* Both nowrap rules are load-bearing. Shorten or ellipsis the office
              label; a serial broken across two lines reads as a document defect. */}
          <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Molten Pour · Office of Disbursement
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pour.serial}</span>
        </header>

        {/* 2. Title block */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, paddingTop: 20 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONT.display,
              fontWeight: 400,
              fontSize: 34,
              lineHeight: 1,
              // text-indent cancels the trailing letterspace so the centring is true.
              letterSpacing: '8px',
              textIndent: '8px',
              color: COLOR.goldCream,
              textShadow: '0 0 40px rgba(201,146,46,.3)',
            }}
          >
            CERTIFICATE OF WASTE
          </h1>
          <span style={{ fontSize: 12, letterSpacing: '3.4px', textTransform: 'uppercase', color: COLOR.goldLabel, textAlign: 'center' }}>
            Issued upon irreversible disbursement
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: 290, paddingTop: 6 }}>
            <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(201,146,46,.55))' }} />
            <span style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 17, letterSpacing: '2px', color: accent, whiteSpace: 'nowrap' }}>
              non revertitur
            </span>
            <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(201,146,46,.55),transparent)' }} />
          </div>
        </div>

        {/* 3. Sigil — the only flexible element in the page budget. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0 2px' }}>
          <SigilSvg seed={pour.seed} accent={accent} secondary={secondary} maxWidthPx={300} />
        </div>

        {/* 4. Sigil caption */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 16 }}>
          <span style={{ fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase', color: secondary, fontVariantNumeric: 'tabular-nums' }}>
            {`Pour №${pour.ledgerPosition.toLocaleString('en-US')} · ${rarity} · ${substance}`}
          </span>
        </div>

        {/* 5. Ledger table.
            A real <dl> rather than the prototype's flex rows: visually this is a
            label/leader/value set, but a screen reader needs the pairs, and the
            sigil is aria-hidden so this text is the only record of them. */}
        <dl style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 16,
                padding: '5px 2px 4px',
                borderBottom: `1px solid ${COLOR.ruleRow}`,
              }}
            >
              <dt style={{ ...LABEL, color: secondary }}>{label}</dt>
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 1,
                  background: `repeating-linear-gradient(90deg, ${COLOR.leader} 0 1px, transparent 1px 5px)`,
                }}
              />
              <dd
                style={{
                  margin: 0,
                  fontFamily: FONT.display,
                  fontSize: 17,
                  letterSpacing: '.4px',
                  color: accent,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {/* 6. Inscription */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 14px' }}>
          <span style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 22, letterSpacing: '1.5px', color: COLOR.goldCream }}>
            for nothing
          </span>
        </div>

        {/* 7. Footer */}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 20,
            paddingTop: 14,
            borderTop: `1px solid ${COLOR.rule}`,
            fontSize: 12,
            letterSpacing: '1.9px',
            textTransform: 'uppercase',
            color: COLOR.goldLabel,
          }}
        >
          {/* Required to be clearly legible. Never decorative, never dimmed further. */}
          <span style={{ maxWidth: '70%' }}>This instrument confers no right, claim, or residual value.</span>
          <span
            style={{
              fontFamily: FONT.display,
              fontStyle: 'italic',
              fontSize: 14,
              letterSpacing: '.5px',
              textTransform: 'none',
              color: secondary,
              whiteSpace: 'nowrap',
            }}
          >
            rev. vii — mmxxvi
          </span>
        </footer>
      </div>
    </section>
  );
}
