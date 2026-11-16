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

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { PourScreen, type Phase } from './ceremony/PourScreen';
import { APP_GROUND, COLOR, COLUMN_RULE, FONT, RARITY_PRESENTATION, RADIUS } from './design/tokens';
import { useIsWide } from './design/viewport';
import type { Rarity } from './sigil/rarity';
import { ApiError, getConfig, listPours, mintPour } from './pour/api';
import type { MintRequest, PourRecord } from './pour/record';

import './certificate/fonts/bodoni.css';
import './certificate/print.css';

type View = 'ceremony' | 'collection' | 'certificate';

// Views load on first use. The decorative WebGL ground waits for interaction;
// lazy alone would still download Three.js on the initial ceremony render.
const Gallery = lazy(() => import('./collection/Gallery').then((m) => ({ default: m.Gallery })));
const CertificateView = lazy(() => import('./certificate/CertificateView').then((m) => ({ default: m.CertificateView })));
const MoltenBackground = lazy(() => import('./design/MoltenBackground').then((m) => ({ default: m.MoltenBackground })));

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


/**
 * What the notice band says about a failed call, chosen by ApiError.code. A raw
 * error string never reaches the UI: the server's own sentence is shown only
 * for a refusal, where it is the explanation.
 */
function mintNotice(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.retryable)
      return 'The ledger could not be reached. The pour has been kept; seal it again.';
    if (e.code === 'expired')
      return 'This pour has lapsed and can no longer be sealed. Begin again.';
    if (e.code === 'conflict')
      return `The ledger already holds a different record for this pour. ${e.message}`;
    return `The record could not be sealed. ${e.message}`;
  }
  return 'The record could not be sealed.';
}

function readNotice(e: unknown): string {
  return e instanceof ApiError && !e.retryable
    ? `The ledger refused the listing. ${e.message}`
    : 'The ledger could not be reached. The collection may be out of date.';
}

export function App() {
  const [view, setView] = useState<View>('ceremony');
  const [pours, setPours] = useState<PourRecord[]>([]);
  const [current, setCurrent] = useState<PourRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);

  const [tierIndex, setTierIndex] = useState(0);
  const [maxTierIndex, setMaxTierIndex] = useState(0);
  const [configState, setConfigState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [collectionState, setCollectionState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [collectionNotice, setCollectionNotice] = useState<string | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [rarity, setRarity] = useState<Rarity>('Common');

  const wide = useIsWide();
  const sealTimer = useRef<number | null>(null);
  const mintPending = useRef(false);
  const listingSequence = useRef(0);
  const configSequence = useRef(0);
  const mintedRecords = useRef(new Map<string, PourRecord>());

  const refresh = useCallback(async () => {
    const sequence = ++listingSequence.current;
    setCollectionState('loading');
    setCollectionNotice(null);
    try {
      const records = await listPours();
      if (sequence !== listingSequence.current) return;
      const merged = new Map(records.map((record) => [record.id, record]));
      for (const [id, record] of mintedRecords.current) merged.set(id, record);
      setPours([...merged.values()].sort((a, b) => b.ledgerPosition - a.ledgerPosition));
      setCollectionState('ready');
    } catch (e) {
      if (sequence !== listingSequence.current) return;
      setCollectionState('error');
      setCollectionNotice(readNotice(e));
    }
  }, []);

  const loadConfig = useCallback(async () => {
    const sequence = ++configSequence.current;
    setConfigState('loading');
    try {
      const { maxTierIndex: max } = await getConfig();
      if (sequence !== configSequence.current) return;
      setMaxTierIndex(max);
      setTierIndex((current) => Math.min(current, max));
      setConfigState('ready');
    } catch {
      if (sequence === configSequence.current) setConfigState('error');
    }
  }, []);

  useEffect(() => { void refresh(); void loadConfig(); }, [refresh, loadConfig]);

  useEffect(() => {
    const activate = () => {
      setBackgroundReady(true);
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => {
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
  }, []);

  useEffect(() => () => {
    if (sealTimer.current !== null) window.clearTimeout(sealTimer.current);
    listingSequence.current++;
    configSequence.current++;
  }, []);

  const mint = useCallback((request: MintRequest) => {
    if (mintPending.current) return;
    mintPending.current = true;
    setSealing(true);
    setNotice(null);
    const held = new Promise<void>((resolve) => {
      sealTimer.current = window.setTimeout(resolve, prefersReducedMotion() ? SEAL_REDUCED_MS : SEAL_MS);
    });
    void (async () => {
      try {
        const [record] = await Promise.all([mintPour(request), held]);
        mintedRecords.current.set(record.id, record);
        setPours((records) => [record, ...records.filter((p) => p.id !== record.id)]
          .sort((a, b) => b.ledgerPosition - a.ledgerPosition));
        setCurrent(record);
        setView('certificate');
        setDraftGeneration((generation) => generation + 1);
        setPhase('idle');
        setRarity('Common');
        void refresh();
      } catch (e) {
        await held;
        setNotice(mintNotice(e));
        // A lapsed pour cannot be resealed: the server's settle window has
        // closed over its start time. Clear the retained draft so the schedule
        // returns to idle instead of offering a seal that can never succeed.
        if (e instanceof ApiError && e.code === 'expired') {
          setDraftGeneration((generation) => generation + 1);
          setPhase('idle');
          setRarity('Common');
        }
      } finally {
        mintPending.current = false;
        setSealing(false);
      }
    })();
  }, [refresh]);

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
      }}
    >
      {backgroundReady && view !== 'certificate' && (
        <Suspense fallback={null}>
          <MoltenBackground dimmed={phase === 'pouring'} />
        </Suspense>
      )}
      {/* The ledger-paper ground, full-bleed. Decorative, and never in the way
          of a pointer. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5, backgroundImage: COLUMN_RULE }} />

      {/* The centred sheet. The ground above is full-bleed; everything ruled
          lives inside this container so an ultra-wide screen cannot push the
          vessel and the ledger to opposite edges. */}
      <div
        style={{
          maxWidth: 1360,
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
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
              textShadow: `0 0 44px ${COLOR.ruleActive}`,
            }}
          >
            The Molten Pour
          </h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, fontSize: 11, letterSpacing: '2.6px', textTransform: 'uppercase', color: COLOR.goldLabel, whiteSpace: 'nowrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 12px 6px 8px', border: `1px solid ${COLOR.ruleStage}`, borderRadius: RADIUS.pill, background: 'rgba(22,11,26,.6)' }}>
            {/* The live status indicator. */}
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, border: `1px solid ${COLOR.ruleActive}`, borderRadius: '50%' }}>
              <span className="mp-breathe" style={{ width: 4, height: 4, borderRadius: '50%', background: accent }} />
            </span>
            <span>{view === 'ceremony' ? STATUS_LINE[phase] : 'Live · register open'}</span>
          </span>
          <span style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 15, letterSpacing: '.5px', textTransform: 'none', color: COLOR.goldFaint }}>
            rev. vii — mmxxvi
          </span>
        </div>
      </header>

      <nav className="app-chrome" style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, padding: '16px 0 0' }}>
        <Tab disabled={sealing} active={view === 'ceremony'} onClick={() => setView('ceremony')}>
          The ceremony
        </Tab>
        <Tab disabled={sealing} active={view === 'collection'} onClick={() => setView('collection')}>
          The collection · {pours.length}
        </Tab>
        {current && (
          <Tab disabled={sealing} active={view === 'certificate'} onClick={() => setView('certificate')}>
            The certificate
          </Tab>
        )}
      </nav>

      <main ref={(el) => { if (el) el.inert = sealing; }} style={{ position: 'relative', paddingTop: 'clamp(20px, 2.6vw, 32px)' }}>
        <div hidden={view !== 'ceremony'}>
          {configState === 'loading' && <p role="status">Checking available tiers…</p>}
          {configState === 'error' && <p role="alert">Available tiers could not be loaded. <button type="button" onClick={() => void loadConfig()}>Retry availability</button></p>}
          <PourScreen
            key={draftGeneration}
            active={view === 'ceremony'}
            enabled={configState === 'ready'}
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
        </div>

        {view === 'collection' && (
          <Suspense fallback={<p role="status">Reading the collection…</p>}>
            <Gallery
              state={collectionState}
              notice={collectionNotice}
              onRetry={() => void refresh()}
              pours={pours}
              current={current}
              wide={wide}
              onSelect={(pour) => {
                setCurrent(pour);
                setView('certificate');
              }}
            />
          </Suspense>
        )}

        {view === 'certificate' && current && (
          <Suspense fallback={null}>
            <CertificateView pour={current} />
          </Suspense>
        )}
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
          marginTop: 30,
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
      </div>

      {sealing && (
        <div
          className="app-chrome"
          role="status"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: COLOR.shadeDeep,
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

function Tab({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: '9px 16px',
        borderRadius: RADIUS.tab,
        border: `1px solid ${active ? 'rgba(245,214,122,.4)' : 'rgba(201,146,46,.14)'}`,
        background: active ? 'rgba(201,146,46,.12)' : 'transparent',
        color: active ? COLOR.goldCream : COLOR.goldLabel,
        fontFamily: FONT.instrument,
        fontSize: 11,
        letterSpacing: '3px',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'background .2s, color .2s, border-color .2s',
      }}
    >
      {children}
    </button>
  );
}
