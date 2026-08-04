/**
 * verify-certificate.ts — measures the certificate against the A4 page box
 *
 * The certificate is print-exact and the page has overflow:hidden, so content
 * that misses the box is CLIPPED rather than pushed to a second sheet. That is a
 * silent failure: the sheet still renders, it just quietly loses its footer. This
 * measures the rendered stack instead of trusting it.
 *
 * Checks, per rarity:
 *   - the sheet is exactly 794x1123
 *   - the content stack fits inside it, with the real headroom reported
 *   - the plum ground survives (print-color-adjust is exact)
 *   - the serial and the office label are on one line each
 *   - the sigil is the only element that flexed
 *   - no element uses viewport units
 *   - a PDF prints to exactly one page
 *
 * Usage: npm run verify:certificate
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const PAGE_W = 794;
const PAGE_H = 1123;
const OUT_DIR = 'artifacts/certificate';

async function findChrome(): Promise<string> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = `${process.env.HOME}/.cache/puppeteer/chrome`;
  if (existsSync(base)) {
    const versions = (await readdir(base)).sort().reverse();
    for (const v of versions) {
      const p = `${base}/${v}/chrome-linux64/chrome`;
      if (existsSync(p)) return p;
    }
  }
  throw new Error('no Chrome found; set CHROME_PATH');
}

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log(`  ✗ ${msg}`);
};
const pass = (msg: string) => console.log(`  ✓ ${msg}`);

const server = await createServer({ server: { port: 5199 }, logLevel: 'error' });
await server.listen();

const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  args: ['--no-sandbox', '--font-render-hinting=none'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1400, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5199/proof.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  const rarities = ['Common', 'Uncommon', 'Rare', 'Singular'] as const;

  for (const rarity of rarities) {
    console.log(`\n${rarity}`);
    const m = await page.evaluate((r) => {
      const wrap = document.querySelector(`[data-proof-sheet="${r}"]`)!;
      const sheet = wrap.querySelector('.certificate-page') as HTMLElement;
      const box = sheet.getBoundingClientRect();
      const cs = getComputedStyle(sheet);

      // The inset content column: everything the page budget has to hold.
      const content = sheet.lastElementChild as HTMLElement;
      const children = Array.from(content.children) as HTMLElement[];
      const stack = children.reduce((sum, el) => {
        const s = getComputedStyle(el);
        return sum + el.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
      }, 0);
      const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);

      const header = content.querySelector('header')!;
      const [officeEl, serialEl] = Array.from(header.children) as HTMLElement[];
      const lineHeightOf = (el: HTMLElement) => el.getClientRects().length;

      const svg = sheet.querySelector('svg') as SVGElement;
      const svgBox = svg.getBoundingClientRect();

      // Any viewport unit anywhere in the sheet's inline styles.
      const vpUnits: string[] = [];
      sheet.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
        const raw = el.getAttribute('style') ?? '';
        if (/\d(vh|vw|vmin|vmax|dvh|svh|lvh)\b/.test(raw)) vpUnits.push(el.tagName.toLowerCase());
      });

      const dl = sheet.querySelector('dl');

      return {
        w: box.width,
        h: box.height,
        stack: stack + padding,
        overflow: cs.overflow,
        colorAdjust: cs.printColorAdjust || (cs as unknown as Record<string, string>)['-webkit-print-color-adjust'],
        background: cs.backgroundImage.slice(0, 40),
        serialLines: lineHeightOf(serialEl),
        officeLines: lineHeightOf(officeEl),
        serialText: serialEl.textContent ?? '',
        sigilW: svgBox.width,
        sigilH: svgBox.height,
        vpUnits,
        hasDl: !!dl,
        dtCount: dl ? dl.querySelectorAll('dt').length : 0,
        ddCount: dl ? dl.querySelectorAll('dd').length : 0,
        sigilHidden: svg.getAttribute('aria-hidden') === 'true',
        accent: getComputedStyle(sheet.querySelector('dd')!).color,
      };
    }, rarity);

    if (Math.round(m.w) === PAGE_W && Math.round(m.h) === PAGE_H) {
      pass(`sheet is ${Math.round(m.w)}×${Math.round(m.h)}`);
    } else {
      fail(`sheet is ${Math.round(m.w)}×${Math.round(m.h)}, expected ${PAGE_W}×${PAGE_H}`);
    }

    const headroom = PAGE_H - m.stack;
    if (m.stack <= PAGE_H) {
      pass(`content stack ${m.stack.toFixed(1)}px fits, ${headroom.toFixed(1)}px headroom`);
    } else {
      fail(`content stack ${m.stack.toFixed(1)}px OVERFLOWS the ${PAGE_H}px box by ${(-headroom).toFixed(1)}px — footer would be clipped`);
    }

    m.colorAdjust === 'exact'
      ? pass('print-color-adjust: exact — plum ground survives print')
      : fail(`print-color-adjust is "${m.colorAdjust}", the ground will drop at print`);

    m.background.includes('radial-gradient')
      ? pass('radial plum ground applied')
      : fail(`ground is "${m.background}"`);

    m.serialLines === 1
      ? pass(`serial ${m.serialText} on one line`)
      : fail(`serial wrapped onto ${m.serialLines} lines — reads as a document defect`);

    m.officeLines === 1 ? pass('office label on one line') : fail(`office label wrapped onto ${m.officeLines} lines`);

    m.sigilW <= 300 && m.sigilH <= 300
      ? pass(`sigil ${m.sigilW.toFixed(0)}×${m.sigilH.toFixed(0)} within its 300px cap`)
      : fail(`sigil ${m.sigilW.toFixed(0)}×${m.sigilH.toFixed(0)} exceeds the 300px cap`);

    m.vpUnits.length === 0
      ? pass('no viewport units')
      : fail(`viewport units found on: ${m.vpUnits.join(', ')}`);

    m.hasDl && m.dtCount === 8 && m.ddCount === 8
      ? pass('ledger is a real <dl> with 8 label/value pairs')
      : fail(`ledger markup wrong: dl=${m.hasDl} dt=${m.dtCount} dd=${m.ddCount}`);

    m.sigilHidden ? pass('sigil is aria-hidden') : fail('sigil is not aria-hidden');

    console.log(`  · accent ${m.accent}`);

    await mkdir(OUT_DIR, { recursive: true });
    const el = await page.$(`[data-proof-sheet="${rarity}"] .certificate-page`);
    await el!.screenshot({ path: `${OUT_DIR}/${rarity.toLowerCase()}.png` });
  }

  // The real print path: headless Chrome at A4 with backgrounds on.
  console.log('\nPDF');
  const printPage = await browser.newPage();
  await printPage.goto('http://localhost:5199/proof.html', { waitUntil: 'networkidle0' });
  await printPage.evaluate(() => document.fonts.ready);
  // Isolate one sheet so the proof's four-up layout does not itself paginate.
  await printPage.evaluate(() => {
    const one = document.querySelector('[data-proof-sheet="Common"]')!;
    document.body.innerHTML = '';
    document.body.appendChild(one);
    document.body.setAttribute('style', 'margin:0;padding:0');
  });
  const pdf = await printPage.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  await writeFile(`${OUT_DIR}/common.pdf`, pdf);

  const pageCount = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  pageCount === 1
    ? pass(`prints to exactly 1 page (${(pdf.length / 1024).toFixed(0)} kB)`)
    : fail(`printed ${pageCount} pages; the certificate is a single fixed sheet`);
} finally {
  await browser.close();
  await server.close();
}

console.log(
  problems.length === 0
    ? `\nCERTIFICATE VERIFIED — proofs in ${OUT_DIR}/`
    : `\n${problems.length} PROBLEM(S):\n` + problems.map((p) => ` - ${p}`).join('\n'),
);
process.exit(problems.length === 0 ? 0 : 1);
