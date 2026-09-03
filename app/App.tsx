/**
 * App.tsx — the index
 *
 * A schedule of disbursements. The page is a ledger sheet: a hairline column
 * grid, a vertical folio rail down the left edge, a ruled head, and three views
 * beneath it — the ceremony, the collection, the certificate.
 *
 * The shell owns everything that changes between views and everything two views
 * both need. Phase and rarity live here rather than in the ceremony because the
 * header's status lamp and the footer's hint read them, but nothing that moves
 * at sixty hertz reaches this file: the rig keeps that in refs, and the readout
 * is painted straight into the DOM. See app/ceremony/PourScreen.tsx.
 *
 * IMPORTANT: there is no "Pour again" call to action on the certificate view, no
 * celebratory copy anywhere, and nothing that frames a pour as a randomized
 * outcome. Those are hard constraints from the product brief, not preferences.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PourScreen, type Phase } from './ceremony/PourScreen';
import { TIERS } from './ceremony/tiers';
import { Gallery } from './collection/Gallery';
import { CertificateView } from './certificate/CertificateView';
import { APP_GROUND, COLOR, COLUMN_RULE, FONT, RARITY_PRESENTATION } from './design/tokens';
import { useIsWide } from './design/viewport';
import type { Rarity } from './sigil/rarity';
import { getConfig, listPours, mintPour, type MintRequest, type PourRecord } from './pour/record';

import './certificate/fonts/bodoni.css';
import './certificate/print.css';

type View = 'ceremony' | 'collection' | 'certificate';

/**
 * How long the seal is held before the certificate appears.
 *
 * The pause is the ceremony's last act, not a loading spinner — the record is
 * already minted by the time it ends. Reduced motion takes the short path.
 */
const SEAL_MS = 1400;
const SEAL_REDUCED_MS = 260;

const STATUS_LINE: Record<Phase, string> = {
  idle: 'Live · vessel ready',
  pouring: 'Live · stream open',
  settling: 'Live · settling',
  settled: 'Live · stream closed',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function App() {
  const [view, setView] = useState<View>('ceremony');
  const [pours, setPours] = useState<PourRecord[]>([]);
  const [current, setCurrent] = useState<PourRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);

  const [tierIndex, setTierIndex] = useState(3);
  /**
   * The highest tier this deployment will mint. Optimistic until the server
   * answers: the whole tier table is what the ceremony has always shown, and
   * blanking it for one round trip would flash the ledger empty.
   */
  const [maxTierIndex, setMaxTierIndex] = useState(TIERS.length - 1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [rarity, setRarity] = useState<Rarity>('Common');

  const wide = useIsWide();
  const sealTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPours(await listPours());
    } catch (e) {
      setNotice(`The ledger is unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The ceiling, not the ledger: a deployment that cannot charge refuses the
  // paid tiers, and the picker greys them out rather than letting someone pour
  // for fifteen seconds to be told no. A failure here leaves the optimistic
  // default — the server still refuses, and says so in the notice band.
  useEffect(() => {
    void (async () => {
      try {
        const { maxTierIndex: max } = await getConfig();
        setMaxTierIndex(max);
        // The default selection may sit above the ceiling.
        setTierIndex((current) => Math.min(current, max));
      } catch {
        // Deliberately silent. The tier picker is not where a config fetch
        // failure should be announced.
      }
    })();
  }, []);

  useEffect(() => () => {
    if (sealTimer.current !== null) window.clearTimeout(sealTimer.current);
  }, []);

  /**
   * Seal, then show.
   *
   * The mint and the pause run together rather than in sequence: the seal is a
   * fixed beat of the ceremony and should not stretch to whatever the network
   * costs. A failure clears the seal, states itself in the notice band, and
   * leaves the pour settled so it can be sent again — losing a completed pour to
   * a dropped connection is not a thing this product may do.
   */
  const mint = useCallback(
    (request: MintRequest) => {
      setSealing(true);
      setNotice(null);

      const held = new Promise<void>((resolve) => {
        sealTimer.current = window.setTimeout(resolve, prefersReducedMotion() ? SEAL_REDUCED_MS : SEAL_MS);
      });

      void (async () => {
        try {
          const [record] = await Promise.all([mintPour(request), held]);
          setSealing(false);
          setCurrent(record);
          setView('certificate');
          // The ceremony unmounts with the view, taking its rig with it. Reset
          // the shell's half so the vessel is empty when the user comes back.
          setPhase('idle');
          setRarity('Common');
          void refresh();
        } catch (e) {
          await held;
          setSealing(false);
          setNotice(`The record could not be sealed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [refresh],
  );

  const { accent } = RARITY_PRESENTATION[rarity];
  const poured = phase !== 'idle';

  const footerHint =
    view !== 'ceremony'
      ? 'All disbursements are irreversible'
      : poured
        ? 'Release to settle · discard to begin again'
        : '↑ ↓ traverse tiers · hold the vessel to pour';

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100%',
        boxSizing: 'border-box',
        background: APP_GROUND,
        color: COLOR.goldBody,
        fontFamily: FONT.instrument,
        padding: 'clamp(18px, 3vw, 30px) clamp(16px, 3vw, 34px) 0',
        display: 'grid',
        gap: '0 clamp(16px, 2.4vw, 30px)',
        // The 36px track is the folio rail, which spans every row.
        gridTemplateColumns: wide ? '36px minmax(0, 1fr)' : 'minmax(0, 1fr)',
        // IMPORTANT: rows are content-sized, and must stay that way. The default
        // align-content stretches auto rows to fill a grid taller than its
        // content, which this one is whenever a view is short — the collection
        // with a couple of tiles. That pulled the header down the page and left
        // the active tab's rule floating an inch under its own label.
        alignContent: 'start',
      }}
    >
      {/* The ledger-paper ground. Decorative, and never in the way of a pointer. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5, backgroundImage: COLUMN_RULE }} />

      {wide && (
        <aside
          className="app-chrome"
          aria-hidden="true"
          style={{
            position: 'relative',
            gridRow: '1 / span 4',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 26,
            borderRight: `1px solid ${COLOR.ruleRail}`,
          }}
        >
          <span style={{ writingMode: 'vertical-rl', fontSize: 11, letterSpacing: '4.5px', textTransform: 'uppercase', color: COLOR.goldLabel, whiteSpace: 'nowrap' }}>
            Office of Disbursement · Folio {pours.length > 0 ? pours[0].ledgerPosition.toLocaleString('en-US') : '—'}
          </span>
          <span style={{ writingMode: 'vertical-rl', fontFamily: FONT.display, fontStyle: 'italic', fontSize: 14, letterSpacing: '1px', color: COLOR.goldFaint, whiteSpace: 'nowrap' }}>
            non revertitur
          </span>
        </aside>
      )}

      <header
        className="app-chrome"
        style={{
          position: 'relative',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '16px 24px',
          borderBottom: `1px solid ${COLOR.ruleMid}`,
          paddingBottom: 18,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 11, letterSpacing: '3.6px', textTransform: 'uppercase', color: COLOR.goldLabel }}>
            A schedule of disbursements, rendered in liquid
          </span>
          <h1
            style={{
              margin: 0,
              fontFamily: FONT.display,
              fontWeight: 400,
              fontSize: 'clamp(38px, 5.2vw, 62px)',
              lineHeight: 0.92,
              letterSpacing: '-1px',
              color: COLOR.goldCream,
              textShadow: '0 0 44px rgba(201,146,46,.35)',
            }}
          >
            The Molten Pour
          </h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, fontSize: 11, letterSpacing: '2.6px', textTransform: 'uppercase', color: COLOR.goldLabel, whiteSpace: 'nowrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* The only continuous motion on the page, and the only circle in a
                document system that otherwise has no radius at all. */}
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, border: '1px solid rgba(201,146,46,.35)', borderRadius: '50%' }}>
              <span className="mp-breathe" style={{ width: 4, height: 4, borderRadius: '50%', background: accent }} />
            </span>
            <span>{view === 'ceremony' ? STATUS_LINE[phase] : 'Live · register open'}</span>
          </span>
          <span style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 15, letterSpacing: '.5px', textTransform: 'none', color: COLOR.goldFaint }}>
            rev. vii — mmxxvi
          </span>
        </div>
      </header>

      <nav className="app-chrome" style={{ position: 'relative', display: 'flex', gap: 26, padding: '14px 0 0' }}>
        <Tab active={view === 'ceremony'} onClick={() => setView('ceremony')}>
          The ceremony
        </Tab>
        <Tab active={view === 'collection'} onClick={() => setView('collection')}>
          The collection · {pours.length}
        </Tab>
        {current && (
          <Tab active={view === 'certificate'} onClick={() => setView('certificate')}>
            The certificate
          </Tab>
        )}
      </nav>

      <main style={{ position: 'relative', paddingTop: 'clamp(20px, 2.6vw, 32px)' }}>
        {view === 'ceremony' && (
          <PourScreen
            tierIndex={tierIndex}
            onTierIndex={setTierIndex}
            maxTierIndex={maxTierIndex}
            phase={phase}
            onPhase={setPhase}
            rarity={rarity}
            onRarity={setRarity}
            notice={notice}
            onNotice={setNotice}
            sealing={sealing}
            wide={wide}
            onMint={mint}
          />
        )}

        {view === 'collection' && (
          <Gallery
            pours={pours}
            current={current}
            wide={wide}
            onSelect={(pour) => {
              setCurrent(pour);
              setView('certificate');
            }}
          />
        )}

        {view === 'certificate' && current && <CertificateView pour={current} />}
      </main>

      <footer
        className="app-chrome"
        style={{
          position: 'relative',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px 20px',
          marginTop: 26,
          padding: '14px 0 18px',
          borderTop: `1px solid ${COLOR.ruleFooter}`,
          fontSize: 11,
          letterSpacing: '2.4px',
          textTransform: 'uppercase',
          color: COLOR.goldFaint,
        }}
      >
        <span>All pours final · gratitude non-transferable</span>
        <span>{footerHint}</span>
      </footer>

      {sealing && (
        <div
          className="app-chrome"
          role="status"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: 'rgba(10,6,13,.94)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
          }}
        >
          <span className="mp-rise" style={{ fontSize: 11, letterSpacing: '4.5px', textTransform: 'uppercase', color: COLOR.goldLabel }}>
            Sealing the record
          </span>
          <span style={{ position: 'relative', display: 'block', width: 230, height: 1, background: COLOR.ruleRow, overflow: 'hidden' }}>
            <span className="mp-seal" style={{ position: 'absolute', left: 0, top: 0, height: 1, background: COLOR.goldHot }} />
          </span>
          <span className="mp-rise" style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 26, letterSpacing: '1.5px', color: COLOR.goldCream }}>
            non revertitur
          </span>
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: '0 0 6px',
        background: 'transparent',
        border: 0,
        borderBottom: `1px solid ${active ? COLOR.goldHot : 'transparent'}`,
        color: active ? COLOR.goldCream : COLOR.goldFaint,
        fontFamily: FONT.instrument,
        fontSize: 11,
        letterSpacing: '3px',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
