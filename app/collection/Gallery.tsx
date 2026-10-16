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

import { CARD_BORDER, COLOR, FONT, RARITY_PRESENTATION, RADIUS } from "../design/tokens";
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
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "10px 20px",
          fontSize: 11,
          letterSpacing: "3.2px",
          textTransform: "uppercase",
          color: COLOR.goldLabel,
          paddingBottom: 12,
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
          role="status"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "80px 20px",
            border: `1px dashed rgba(201,146,46,.24)`,
            borderRadius: RADIUS.panel,
            background: "rgba(22,11,26,.4)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              border: `1px solid ${COLOR.leader}`,
              borderRadius: 8,
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
              textAlign: "center",
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
            gridTemplateColumns: `repeat(auto-fill, minmax(${wide ? 220 : 150}px, 1fr))`,
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
                  className="mp-tile"
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
                    gap: 12,
                    width: "100%",
                    padding: 12,
                    background:
                      "linear-gradient(180deg, rgba(36,18,42,.7), rgba(18,10,22,.7))",
                    border: `1px solid ${open ? presentation.accent : CARD_BORDER}`,
                    borderRadius: RADIUS.panel,
                    boxShadow: "0 24px 50px -28px rgba(0,0,0,.8)",
                    transition:
                      "border-color .2s, transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s",
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
                      padding: "2px 4px 0",
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
                      borderRadius: RADIUS.well,
                      background:
                        "radial-gradient(70% 70% at 50% 45%, rgba(42,17,54,.9), rgba(12,7,15,.95))",
                      boxShadow: "inset 0 0 0 1px rgba(201,146,46,.12)",
                      padding: 8,
                      overflow: "hidden",
                      boxSizing: "border-box",
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
                      flexWrap: "wrap",
                      padding: "0 4px 2px",
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
