/**
 * App.tsx — the three artifacts one purchase yields
 *
 * The sigil (in the ceremony preview and the gallery), the Certificate of Waste,
 * and the collection entry.
 *
 * IMPORTANT: there is no "Pour again" call to action on the certificate view, no
 * celebratory copy anywhere, and nothing that frames a pour as a randomized
 * outcome. Those are hard constraints from the product brief, not preferences.
 */

import { useCallback, useEffect, useState } from 'react';

import { PourScreen } from './ceremony/PourScreen';
import { Gallery } from './collection/Gallery';
import { Certificate } from './certificate/Certificate';
import { COLOR, FONT, PAGE_GROUND } from './design/tokens';
import { listPours, type PourRecord } from './pour/record';

import './certificate/fonts/bodoni.css';
import './certificate/print.css';

type View = { name: 'pour' } | { name: 'collection' } | { name: 'certificate'; pour: PourRecord };

export function App() {
  const [view, setView] = useState<View>({ name: 'pour' });
  const [pours, setPours] = useState<PourRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPours(await listPours());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onMinted = useCallback(
    (record: PourRecord) => {
      setView({ name: 'certificate', pour: record });
      void refresh();
    },
    [refresh],
  );

  return (
    <div
      style={{
        minHeight: '100%',
        background: PAGE_GROUND,
        color: COLOR.goldBody,
        fontFamily: FONT.instrument,
      }}
    >
      <nav
        className="app-chrome"
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          padding: '14px 12px',
          borderBottom: `1px solid ${COLOR.rule}`,
        }}
      >
        {(
          [
            [{ name: 'pour' }, 'The ceremony'],
            [{ name: 'collection' }, 'The collection'],
          ] as const satisfies readonly (readonly [View, string])[]
        ).map(([target, label]) => (
          <button
            key={target.name}
            type="button"
            onClick={() => setView(target)}
            style={{
              padding: '8px 14px',
              background: view.name === target.name ? 'rgba(201,146,46,.14)' : 'transparent',
              border: `1px solid ${view.name === target.name ? COLOR.ruleStrong : COLOR.ruleRow}`,
              color: view.name === target.name ? COLOR.goldCream : COLOR.goldLabel,
              fontFamily: FONT.instrument,
              fontSize: 12,
              letterSpacing: '2.2px',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {loadError && (
        <p role="alert" style={{ margin: 0, padding: '10px 16px', fontSize: 12, letterSpacing: '1.6px', color: COLOR.goldHot, textAlign: 'center' }}>
          Ledger unavailable: {loadError}
        </p>
      )}

      {view.name === 'pour' && <PourScreen onMinted={onMinted} />}

      {view.name === 'collection' && (
        <Gallery pours={pours} onSelect={(pour) => setView({ name: 'certificate', pour })} />
      )}

      {view.name === 'certificate' && (
        <>
          <div className="app-chrome" style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: '14px 12px' }}>
            <button
              type="button"
              onClick={() => setView({ name: 'collection' })}
              style={chromeButton}
            >
              Back to collection
            </button>
            <button type="button" onClick={() => window.print()} style={chromeButton}>
              Print certificate
            </button>
          </div>
          {/* The print stylesheet hides everything outside .print-root, so the
              sheet is the only thing that reaches the paper. */}
          <div className="print-root">
            <Certificate pour={view.pour} />
          </div>
        </>
      )}
    </div>
  );
}

const chromeButton: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  border: `1px solid ${COLOR.ruleRow}`,
  color: COLOR.goldLabel,
  fontFamily: FONT.instrument,
  fontSize: 12,
  letterSpacing: '2.2px',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
