/** Browser regressions with controlled ledger responses; never touches a real ledger. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { findChrome } from './chrome';
import type { MintRequest, PourRecord } from '../app/pour/record';

const server = await createServer({ server: { port: 5201, strictPort: true }, logLevel: 'error' });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const button = async (page: Page, text: string) => {
  const handles = await page.$$('button');
  for (const handle of handles) {
    if ((await handle.evaluate((el) => el.textContent ?? '')).includes(text)) return handle;
    await handle.dispose();
  }
  throw new Error(`Button not found: ${text}`);
};
const click = async (page: Page, text: string) => { const el = await button(page, text); await el.click(); await el.dispose(); };
const waitText = (page: Page, text: string) => page.waitForFunction((t) => (document.body.textContent ?? '').includes(t), {}, text);
const waitSettled = (page: Page) => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Complete disbursement') && !b.disabled));
const drops = (page: Page) => page.evaluate(() => Number((document.body.textContent ?? '').match(/(\d+) drops/)?.[1]));

try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath: await findChrome(), args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  // Exercise unsupported sensors and permission-gated touch without Puppeteer's
  // element helpers, whose evaluation can itself grant user activation.
  for (const touch of [false, true]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 900, isMobile: touch, hasTouch: touch });
    const errors: string[] = [];
    const backgrounds: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.evaluateOnNewDocument((needsPermission) => {
      const trace = { permissions: [] as boolean[], listeners: 0 };
      (window as unknown as { orientationTrace: typeof trace }).orientationTrace = trace;
      Object.defineProperty(window, 'DeviceOrientationEvent', {
        configurable: true,
        value: needsPermission ? class {
          static requestPermission() {
            const active = navigator.userActivation.isActive;
            trace.permissions.push(active);
            return active ? Promise.resolve('granted') : Promise.reject(new Error('No user activation'));
          }
        } : undefined,
      });
      const add = window.addEventListener;
      const remove = window.removeEventListener;
      window.addEventListener = function(type, ...args) {
        if (type === 'deviceorientation') trace.listeners++;
        return add.call(this, type, ...args);
      };
      window.removeEventListener = function(type, ...args) {
        if (type === 'deviceorientation') trace.listeners--;
        return remove.call(this, type, ...args);
      };
    }, touch);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/MoltenBackground.tsx')) backgrounds.push(path);
      void (path.startsWith('/api/')
        ? request.respond({ status: 200, contentType: 'application/json', body: path === '/api/config' ? '{"maxTierIndex":0}' : '[]' })
        : request.continue()).catch((err) => errors.push(String(err)));
    });
    await page.goto('http://localhost:5201/', { waitUntil: 'networkidle0' });
    assert.equal(backgrounds.length, 0, 'decorative Three.js loaded before interaction');
    const background = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith('/MoltenBackground.tsx'));
    if (touch) await page.touchscreen.tap(20, 20);
    else await page.mouse.click(20, 20);
    await background;
    if (touch) {
      await page.waitForFunction(() => (window as unknown as { orientationTrace: { listeners: number } }).orientationTrace.listeners === 1);
      assert.deepEqual(await page.evaluate(() => (window as unknown as { orientationTrace: { permissions: boolean[] } }).orientationTrace.permissions), [true]);
    } else {
      await page.mouse.click(20, 20);
    }
    assert.deepEqual(errors, [], 'orientation fallback threw a browser error');
    await page.close();
    console.log(`${touch ? 'touch permission' : 'unavailable sensors'}: deferred background and orientation passed`);
  }
  for (const width of [1280, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.evaluateOnNewDocument(() => {
      const original = WebGLRenderingContext.prototype.drawArrays;
      (window as unknown as { vesselDraws: number }).vesselDraws = 0;
      WebGLRenderingContext.prototype.drawArrays = function(...args) {
        if ((this.canvas as HTMLCanvasElement).closest('[role="button"]')) (window as unknown as { vesselDraws: number }).vesselDraws++;
        return original.apply(this, args);
      };
    });
    let configBad = true;
    let listBad = true;
    let mintBad = true;
    const requests: MintRequest[] = [];
    const records: PourRecord[] = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      void (async () => {
        const path = new URL(request.url()).pathname;
        const respond = (body: unknown, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/api/config') {
          // Keep configuration pending long enough to try opening the vessel.
          await pause(300);
          await respond(configBad ? { maxTierIndex: -1 } : { maxTierIndex: 0 });
        } else if (path === '/api/pours' && request.method() === 'GET') {
          await respond(listBad ? { error: 'test listing failure' } : records, listBad ? 400 : 200);
        } else if (path === '/api/pours' && request.method() === 'POST') {
          const body = JSON.parse(request.postData()!) as MintRequest;
          requests.push(body);
          await pause(200);
          if (mintBad) { await respond({ error: 'temporarily unavailable' }, 503); return; }
          const record: PourRecord = records[0] ?? {
            ...body, id: 'journey-1', ledgerPosition: 1, amountCents: 0,
            violations: [], seed: 42, rarity: 'Common', rarityScore: 200,
            serial: 'MP-0000001-002A', batch: '001-Q', massGrams: body.telemetry.dropletsLanded * 3.79,
            issued: '2026-11-14',
          };
          if (!records.length) records.push(record);
          await respond(record, 201);
        } else await request.continue();
      })().catch((err) => errors.push(String(err)));
    });
    await page.goto('http://localhost:5201/', { waitUntil: 'domcontentloaded' });
    const vessel = await page.waitForSelector('[role="button"][aria-label="Hold to pour"]');
    await vessel!.focus();
    await page.keyboard.down('Space'); await pause(100); await page.keyboard.up('Space');
    assert.equal(await drops(page), 0, 'configuration loading must block pouring');
    await waitText(page, 'Available tiers could not be loaded');
    configBad = false;
    await click(page, 'Retry availability');
    await page.waitForFunction(() => document.querySelector('[aria-label="Hold to pour"]')?.getAttribute('aria-disabled') === 'false');

    await click(page, 'The collection');
    await waitText(page, 'Retry collection');
    assert.equal(await page.evaluate(() => (document.body.textContent ?? '').includes('The register is open and empty')), false);
    listBad = false;
    await click(page, 'Retry collection');
    await waitText(page, 'The register is open and empty');
    await click(page, 'The ceremony');

    await vessel!.focus();
    await page.keyboard.down('Space'); await pause(600); await page.keyboard.up('Space');
    await waitSettled(page);
    const originalDrops = await drops(page);
    assert(originalDrops > 0, 'pour must land droplets');
    await click(page, 'The collection'); await pause(200); await click(page, 'The ceremony');
    await waitSettled(page);
    assert.equal(await drops(page), originalDrops, 'navigation lost telemetry');

    const before = await page.evaluate(() => (window as unknown as { vesselDraws: number }).vesselDraws);
    await page.waitForFunction(() => /0\/32/.test(document.body.textContent ?? ''), { timeout: 15000 });
    const resting = await page.evaluate(() => (window as unknown as { vesselDraws: number }).vesselDraws);
    await pause(300);
    assert.equal(await page.evaluate(() => (window as unknown as { vesselDraws: number }).vesselDraws), resting, 'idle vessel still draws');
    console.log(`${width}px: vessel draws before rest ${before}, at rest ${resting}, next 300ms 0`);
    await page.setViewport({ width, height: 850 });
    await page.waitForFunction((count) => (window as unknown as { vesselDraws: number }).vesselDraws > count, {}, resting);
    assert.equal(await drops(page), originalDrops, 'resize changed settled telemetry');

    const hasGL = await page.evaluate(() => {
      const canvas = document.querySelector('[role="button"] canvas') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      (window as unknown as { restoreVessel: () => void }).restoreVessel = () => ext.restoreContext();
      ext.loseContext();
      return true;
    });
    assert(hasGL, 'WebGL test requires a working context');
    await waitText(page, 'The vessel could not be lit');
    await page.evaluate(() => (window as unknown as { restoreVessel: () => void }).restoreVessel());
    await page.waitForFunction(() => !(document.body.textContent ?? '').includes('The vessel could not be lit'));
    assert.equal(await drops(page), originalDrops, 'context restoration changed telemetry');

    await click(page, 'Complete disbursement');
    await page.waitForFunction(() => (document.querySelector('main') as HTMLElement).inert);
    assert(await (await button(page, 'The collection')).evaluate((el) => el.disabled), 'navigation enabled during seal');
    await waitText(page, 'The pour has been kept');
    assert.equal(requests.length, 3, 'expected bounded automatic retries');
    mintBad = false;
    listBad = true;
    await click(page, 'Complete disbursement');
    await page.waitForSelector('.certificate-page');
    assert(requests.every((r) => JSON.stringify(r) === JSON.stringify(requests[0])), 'retry changed request');
    assert.equal(requests[0].telemetry.dropletsLanded, originalDrops);
    assert(requests[0].telemetry.holdMs > 0);

    for (const mode of ['fit', 'full']) {
      if (mode === 'full') await click(page, 'View at 100');
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMediaType('print');
      await page.evaluate(() => window.scrollTo(0, 0));
      const geometry = await page.$eval('.certificate-page', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, visible: getComputedStyle(el).visibility };
      });
      assert.equal(geometry.visible, 'visible');
      assert.equal(geometry.x, 0, 'printed sheet must start at left page edge');
      assert.equal(geometry.y, 0, 'printed sheet must start at top page edge');
      assert.equal(geometry.width, 794);
      assert.equal(geometry.height, 1123);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1, `${mode} printed multiple pages`);
      await page.emulateMediaType('screen');
    }
    await click(page, 'The collection');
    await waitText(page, 'Retry collection');
    assert.equal(await page.$$eval('.mp-tile', (tiles) => tiles.length), 1, 'failed refresh hid new mint');
    await page.click('.mp-tile');
    await page.waitForSelector('.certificate-page');
    await click(page, 'The ceremony');
    const freshVessel = await page.$('[aria-label="Hold to pour"]');
    assert.equal(await drops(page), 0, 'completed mint did not reset draft');
    await freshVessel!.focus();
    await page.keyboard.down('Space'); await pause(300);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('Space');
    await waitSettled(page);
    const stopped = await drops(page); await pause(300);
    assert.equal(await drops(page), stopped, 'blur did not close stream');

    await click(page, 'Discard');
    await freshVessel!.focus();
    await page.keyboard.down('Space'); await pause(300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.keyboard.up('Space'); await pause(100);
    const hiddenDraws = await page.evaluate(() => (window as unknown as { vesselDraws: number }).vesselDraws);
    await pause(200);
    assert.equal(await page.evaluate(() => (window as unknown as { vesselDraws: number }).vesselDraws), hiddenDraws);
    await page.evaluate(() => {
      delete (document as unknown as { hidden?: boolean }).hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitSettled(page);

    // Leaving while still pouring must close and preserve the draft.
    await click(page, 'Discard');
    await freshVessel!.focus();
    await page.keyboard.down('Space'); await pause(400);
    await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent?.includes('The collection'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.keyboard.up('Space'); await pause(200);
    await click(page, 'The ceremony');
    await waitSettled(page);
    assert((await drops(page)) > 0, 'navigation during pouring lost draft');
    assert.deepEqual(errors, [], 'browser errors');
    await page.close();
    console.log(`${width}px: configuration, collection, navigation, retry, context loss, print, and focus journeys passed`);
  }
} finally {
  await browser?.close();
  await server.close();
}
