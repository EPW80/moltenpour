/**
 * Gallery.tsx — the collection entry
 *
 * A two-column grid of sigil thumbnails with a quiet header row. Restraint is the
 * point: small monospace, no emphasis, no totals shouted at the user.
 *
 * The thumbnails render through the same SigilSvg the certificate uses, from the
 * same stored seed, so the tile and the sheet cannot disagree.
 */

import { COLOR, FONT, RARITY_PRESENTATION } from '../design/tokens';
import { SigilSvg } from '../sigil/SigilSvg';
import { formatUSD } from '../ceremony/tiers';
import { formatOrdinal, type PourRecord } from '../pour/record';

type Props = {
  pours: PourRecord[];
  onSelect: (pour: PourRecord) => void;
};

export function Gallery({ pours, onSelect }: Props) {
  const totalCents = pours.reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 16px 40px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          fontSize: 12,
          letterSpacing: '2.2px',
          textTransform: 'uppercase',
          color: '#C97AD8',
          paddingBottom: 10,
          borderBottom: `1px solid ${COLOR.rule}`,
        }}
      >
        <span>Your pours · {pours.length}</span>
        {/* A sum, not a price: an empty collection reads USD 0.00, never "Free". */}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUSD(totalCents)}</span>
      </header>

      {pours.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '1.8px', textTransform: 'uppercase', color: COLOR.goldLabel }}>
          No disbursements on record.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {pours.map((p, i) => {
            const presentation = RARITY_PRESENTATION[p.rarity] ?? RARITY_PRESENTATION.Common;
            // The freshly minted pour is first in the list and gets a thin border.
            // That is the only difference between tiles: no badge, no ornament, and
            // nothing that would make a Common tile read as a lesser object.
            const fresh = i === 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: 10,
                    background: 'transparent',
                    border: `1px solid ${fresh ? presentation.accent : COLOR.ruleRow}`,
                    cursor: 'pointer',
                    fontFamily: FONT.instrument,
                  }}
                >
                  <div style={{ width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <SigilSvg seed={p.seed} accent={presentation.accent} secondary={presentation.secondary} maxWidthPx={160} />
                  </div>
                  <span style={{ fontSize: 12, letterSpacing: '1.8px', color: presentation.secondary, fontVariantNumeric: 'tabular-nums' }}>
                    {formatOrdinal(p.ledgerPosition)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
