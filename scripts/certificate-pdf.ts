/**
 * certificate-pdf.ts — export one pour's Certificate of Waste as a PDF
 *
 * The handoff's stated delivery path is "a headless-Chrome print at A4 with
 * background graphics enabled reproduces it exactly". This is that, driven from
 * the command line, for the email-delivery and in-app-download cases.
 *
 * The sheet is rendered by the same Certificate component the app renders, fed a
 * real record from the API — not a second implementation that could drift.
 *
 * Usage:
 *   npm run certificate:pdf -- <pourId>
 *
 * The ledger is owner-scoped, so exporting someone's certificate needs their
 * session cookie. That is the point rather than an inconvenience: this tool has
 * no more access to a pour than its owner does.
 *
 *   MOLTENPOUR_COOKIE='mp_owner=<value>' npm run certificate:pdf -- <pourId>
 *
 * Copy the cookie out of the browser's devtools, or from the Set-Cookie header
 * on any API response.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const API = process.env.MOLTENPOUR_API ?? 'http://localhost:8787';
const OUT_DIR = 'artifacts/certificate';
const PORT = 5195;

const pourId = process.argv[2];
if (!pourId) {
  console.error('usage: npm run certificate:pdf -- <pourId>');
  process.exit(2);
}

async function findChrome(): Promise<string> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = `${process.env.HOME}/.cache/puppeteer/chrome`;
  if (existsSync(base)) {
    for (const v of (await readdir(base)).sort().reverse()) {
      const p = `${base}/${v}/chrome-linux64/chrome`;
      if (existsSync(p)) return p;
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (existsSync(p)) return p;
  }
  throw new Error('no Chrome found; set CHROME_PATH');
}

const res = await fetch(`${API}/api/pours/${encodeURIComponent(pourId)}`, {
  headers: process.env.MOLTENPOUR_COOKIE ? { cookie: process.env.MOLTENPOUR_COOKIE } : {},
});

if (res.status === 404) {
  console.error(
    `No pour ${pourId} visible to this session.\n` +
      `The ledger is owner-scoped — set MOLTENPOUR_COOKIE to the owner's mp_owner cookie.`,
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(`${API} returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const record = await res.json();
console.log(`${record.serial} · ${record.rarity} · No. ${record.ledgerPosition}`);

await mkdir(OUT_DIR, { recursive: true });
const server = await createServer({ server: { port: PORT }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  args: ['--no-sandbox', '--font-render-hinting=none'],
  protocolTimeout: 120000,
});

let out = '';
try {
  const page = await browser.newPage();
  await page.goto(
    `http://localhost:${PORT}/proof.html?record=${encodeURIComponent(JSON.stringify(record))}`,
    { waitUntil: 'networkidle0' },
  );
  // Self-hosted, so this resolves without a network round trip — but the print
  // must not start before the face is applied, or the metrics shift.
  await page.waitForFunction(() => document.fonts.status === 'loaded', { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.certificate-page', { timeout: 20000 });

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  const pages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (pages !== 1) {
    // The sheet clips rather than reflowing, so more than one page means the
    // stack overflowed the box and something has been silently cut off.
    console.error(`refusing to write: rendered ${pages} pages, the certificate is a single sheet`);
    process.exit(1);
  }

  out = `${OUT_DIR}/${record.serial}.pdf`;
  await writeFile(out, pdf);
} finally {
  await browser.close();
  await server.close();
}

console.log(`wrote ${out}`);
