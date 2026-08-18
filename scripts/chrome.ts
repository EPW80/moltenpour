/**
 * chrome.ts — locates a Chrome binary for Puppeteer
 *
 * Shared by verify-certificate.ts and certificate-pdf.ts so the two scripts
 * cannot drift on where they'll look for Chrome — CI sets CHROME_PATH
 * explicitly (see .github/workflows/ci.yml), but a local run without it
 * should still find Puppeteer's own cached download, or fall back to a
 * system install.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

export async function findChrome(): Promise<string> {
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
