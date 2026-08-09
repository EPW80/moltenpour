/**
 * Gallery.tsx — the collection
 *
 * The register of everything already rendered irrecoverable. A ruled header, a
 * grid of specimen tiles, and an empty state that reads as an open ledger rather
 * than a failure.
 *
 * The thumbnails render through the same SigilSvg the certificate uses, from the
 * same stored seed, so the tile and the sheet cannot disagree.
 */

import { COLOR, FONT, RARITY_PRESENTATION } from "../design/tokens";
import { SigilSvg } from "../sigil/SigilSvg";
import { formatConsideration, formatUSD } from "../ceremony/tiers";
import { formatOrdinal, type PourRecord } from "../pour/record";

type Props = {
  pours: PourRecord[];
  /** The sheet currently open, if any. The only tile that is marked. */
  current: PourRecord | null;
  wide: boolean;
  onSelect: (pour: PourRecord) => void;
};

export function Gallery({ pours, current, wide, onSelect }: Props) {
  const totalCents = pours.reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 20,
          fontSize: 11,
          letterSpacing: "3.2px",
          textTransform: "uppercase",
          color: COLOR.goldLabel,
          paddingBottom: 10,
          borderBottom: `1px solid ${COLOR.ruleMid}`,
        }}
      >
        <span>Disbursements on record</span>
        {/* A sum, not a price: an empty register reads USD 0.00, never "Free". */}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatUSD(totalCents)} rendered irrecoverable
        </span>
      </div>

      {pours.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "90px 20px",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              border: `1px solid ${COLOR.leader}`,
              background:
                "repeating-linear-gradient(135deg, transparent 0 5px, rgba(201,146,46,.14) 5px 6px)",
            }}
          />
          <span
            style={{
              fontSize: 11,
              letterSpacing: "3.2px",
              textTransform: "uppercase",
              color: COLOR.goldLabel,
              textAlign: "center",
            }}
          >
            The register is open and empty
          </span>
          <span
            style={{
              fontFamily: FONT.display,
              fontStyle: "italic",
              fontSize: 22,
              letterSpacing: ".6px",
              color: COLOR.goldFaint,
              textWrap: "pretty",
            }}
          >
            nothing has yet been given for nothing
          </span>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${wide ? 210 : 150}px, 1fr))`,
            gap: "clamp(14px, 1.6vw, 22px)",
          }}
        >
          {pours.map((p, i) => {
            const presentation =
              RARITY_PRESENTATION[p.rarity] ?? RARITY_PRESENTATION.Common;
            // The sheet being viewed carries its own accent. That is the only
            // difference between tiles: no badge, no ornament, and nothing that
            // would make a Common tile read as a lesser object.
            const open = current?.id === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    // Chrome's UA stylesheet centres a button's flex children,
                    // so the index/ordinal and rarity/price rows shrank to their
                    // text and their space-between did nothing. Asserted, not
                    // inherited.
                    alignItems: "stretch",
                    gap: 10,
                    width: "100%",
                    padding: 14,
                    background: COLOR.panel,
                    border: `1px solid ${open ? presentation.accent : COLOR.ruleRow}`,
                    cursor: "pointer",
                    fontFamily: FONT.instrument,
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      fontSize: 11,
                      letterSpacing: "1.8px",
                      color: COLOR.goldFaint,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <span>{formatOrdinal(p.ledgerPosition)}</span>
                  </span>
                  <span
                    style={{
                      display: "block",
                      width: "100%",
                      aspectRatio: "1 / 1",
                    }}
                  >
                    <SigilSvg
                      seed={p.seed}
                      accent={presentation.accent}
                      secondary={presentation.secondary}
                      maxWidthPx={220}
                    />
                  </span>
                  <span
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: "2.4px",
                        textTransform: "uppercase",
                        color: presentation.secondary,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.rarity}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT.display,
                        fontSize: 16,
                        color: COLOR.bronze,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatConsideration(p.amountCents)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
