/** Intro regressions in a real browser, with isolated sessions and no real ledger. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { findChrome } from './chrome';

declare global {
  interface Window {
    introTrace: {
      contexts: WebGLRenderingContext[];
      frames: Set<number>;
      resize: Set<EventListenerOrEventListenerObject>;
      keys: Set<EventListenerOrEventListenerObject>;
    };
    introHarness: { unmount(): void; events: string[] };
  }
}

// A test-only entrypoint lets us unmount the real component without production hooks.
const server = await createServer({
  server: { port: 5202, strictPort: true }, logLevel: 'error',
  plugins: [{
    name: 'intro-test-harness',
    resolveId(id) { if (id === '/__intro_harness.tsx') return id; },
    load(id) {
      if (id !== '/__intro_harness.tsx') return;
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Intro } from '/app/intro/Intro.tsx';
        const root = createRoot(document.getElementById('root'));
        const events = [];
        window.introHarness = { unmount: () => root.unmount(), events };
        root.render(React.createElement(React.StrictMode, null, React.createElement(Intro, {
          onBusyChange: (busy) => events.push('busy:' + busy),
          onDismiss: () => events.push('dismiss'),
        })));
      `;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== '/__intro_harness') { next(); return; }
        res.setHeader('Content-Type', 'text/html');
        void vite.transformIndexHtml(req.url,
          '<!doctype html><div id="root"></div><script type="module" src="/__intro_harness.tsx"></script>',
        ).then((html) => res.end(html)).catch(next);
      });
    },
  }],
});
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Mode = 'normal' | 'seen' | 'reduced' | 'no-webgl' | 'slow' | 'reject' | 'setup-failure';

async function open(mode: Mode, harness = false, width = 1280) {
  const page = await browser!.newPage();
  await page.setViewport({ width, height: 900 });
  const errors: string[] = [];
  const modules: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  if (mode === 'reduced') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((mode) => {
    if (mode === 'seen') sessionStorage.setItem('molten-pour:intro-seen', '1');
    const trace = window.introTrace = {
      contexts: [] as WebGLRenderingContext[], frames: new Set<number>(),
      resize: new Set<EventListenerOrEventListenerObject>(), keys: new Set<EventListenerOrEventListenerObject>(),
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      if (mode === 'no-webgl' && type.startsWith('webgl')) return null;
      if (mode === 'setup-failure' && type === '2d' && this.width === 64 && this.height === 64) return null;
      const result = getContext.call(this, type, ...args);
      if (result && type.startsWith('webgl') && this.closest('[role="dialog"]')) {
        const gl = result as WebGLRenderingContext;
        if (!trace.contexts.includes(gl)) trace.contexts.push(gl);
      }
      return result;
    } as typeof getContext;
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => { trace.frames.delete(id); callback(time); });
      trace.frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { trace.frames.delete(id); cancel(id); };
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = function(type, listener, options) {
      if (type === 'resize') trace.resize.add(listener);
      if (type === 'keydown') trace.keys.add(listener);
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function(type, listener, options) {
      if (type === 'resize') trace.resize.delete(listener);
      if (type === 'keydown') trace.keys.delete(listener);
      return remove.call(this, type, listener, options);
    };
  }, mode);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void (async () => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('.ts') || path.endsWith('.tsx')) modules.push(path);
      if (path === '/api/config' || path === '/api/pours') {
        await request.respond({ status: 200, contentType: 'application/json', body: path === '/api/config' ? '{"maxTierIndex":2}' : '[]' });
      } else if (path.endsWith('/introScene.ts') && mode === 'reject') {
        await request.abort();
      } else {
        if (path.endsWith('/introScene.ts') && mode === 'slow') await gate;
        await request.continue();
      }
    })().catch((error) => { if (!page.isClosed()) errors.push(String(error)); });
  });
  await page.goto(`http://localhost:5202/${harness ? '__intro_harness' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(mode === 'seen' ? 'nav' : '.mp-skip');
  return { page, errors, modules, release };
}

const started = (page: Page) => page.waitForFunction(() => document.querySelector('[role="dialog"] canvas')?.getAttribute('style')?.includes('opacity: 1'));
const staticFallback = (page: Page) => page.waitForFunction(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return dialog && !dialog.querySelector('canvas') && [...dialog.querySelectorAll('div')].some((el) => el.textContent === 'The Molten Pour' && el.style.opacity === '1');
});
const fading = (page: Page, ms: number) => page.waitForFunction((ms) => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  return dialog && getComputedStyle(dialog).transitionDuration === `${ms / 1000}s` && dialog.style.opacity === '0';
}, {}, ms);
const dismissed = (page: Page) => page.waitForFunction(() => !document.querySelector('.mp-skip'));
const lost = (page: Page) => page.waitForFunction(() => window.introTrace.contexts.every((gl) => gl.isContextLost()));

async function assertBlocked(page: Page) {
  // Read atomically: several protocol round trips can outlast the short skip fade.
  assert.deepEqual(await page.evaluate(() => ({
    inert: !!document.querySelector('nav')?.closest('[inert]'),
    focused: document.querySelector('.mp-skip') === document.activeElement,
    view: document.querySelector('nav [aria-current="page"]')?.textContent,
    disabled: document.querySelector('[aria-label="Hold to pour"]')?.getAttribute('aria-disabled'),
  })), { inert: true, focused: true, view: 'The ceremony', disabled: 'true' });
}

try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath: await findChrome(), args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });

  // Exercise full App integration at desktop and phone widths, under StrictMode.
  for (const width of [1280, 390]) {
    const { page, errors, modules } = await open('normal', false, width);
    await started(page);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('molten-pour:intro-seen')), '1');
    assert.equal(await page.evaluate(() => window.introTrace.contexts.length), 1, 'StrictMode spawned duplicate scenes');
    for (const key of ['a', 'Tab', 'Tab', 'ArrowDown'] as const) await page.keyboard.press(key);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    await page.mouse.click(20, 20);
    await page.keyboard.press('Tab');
    await assertBlocked(page);
    assert.equal(await page.$('.mp-bg'), null, 'background mounted during the intro');
    assert(!modules.some((path) => path.endsWith('/MoltenBackground.tsx')), 'background imported before GPU handoff');
    const tier = await page.$eval('.mp-tier-row', (row) => (row as HTMLElement).style.color);
    if (width === 1280) await page.keyboard.press('Escape');
    else await page.click('.mp-skip');
    await fading(page, 380);
    await page.keyboard.press('ArrowDown');
    await assertBlocked(page);
    assert.equal(await page.$eval('.mp-tier-row', (row) => (row as HTMLElement).style.color), tier, 'shortcut changed tier during fade');
    await dismissed(page);
    await lost(page);
    assert(await page.$eval('nav [aria-current="page"]', (button) => button === document.activeElement), 'dismissal did not focus ceremony');
    assert(await page.$eval('nav', (nav) => !nav.closest('[inert]')));
    await page.waitForSelector('.mp-bg canvas');
    await page.waitForFunction(() => document.querySelector('[aria-label="Hold to pour"]')?.getAttribute('aria-disabled') === 'false');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.$eval('.mp-tier-row', (row) => (row as HTMLElement).style.color), tier, 'shortcuts did not resume');
    const reloadModules: string[] = [];
    page.on('request', (request) => reloadModules.push(request.url()));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$('.mp-skip'), null, 'session reload replayed intro');
    assert(!reloadModules.some((url) => url.includes('/introScene.ts')), 'returning visit imported intro scene');
    assert(await page.evaluate(() => document.activeElement === document.body), 'skipped intro stole focus');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}px: GPU handoff, focus containment, skip, session reload passed`);
  }

  // Every fallback uses the same accessible overlay; static intros can also be skipped.
  for (const mode of ['reduced', 'no-webgl', 'slow', 'reject', 'setup-failure'] as const) {
    const { page, errors, modules, release } = await open(mode);
    await staticFallback(page);
    await assertBlocked(page);
    if (mode === 'reduced' || mode === 'no-webgl') assert(!modules.some((path) => path.endsWith('/introScene.ts')));
    if (mode === 'setup-failure') {
      assert.equal(await page.evaluate(() => window.introTrace.contexts.length), 1);
      await lost(page);
    }
    if (mode === 'slow') {
      const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/introScene.ts'));
      release();
      await response;
      await pause(150);
      assert.equal(await page.evaluate(() => window.introTrace.contexts.length), 0, 'late import replaced fallback');
    }
    if (mode === 'no-webgl') {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
    }
    await fading(page, mode === 'no-webgl' ? 380 : 650);
    await page.keyboard.press('Tab');
    await assertBlocked(page);
    await dismissed(page);
    assert(await page.$eval('nav [aria-current="page"]', (el) => el === document.activeElement));
    assert.deepEqual(errors, []);
    release();
    await page.close();
    console.log(`${mode}: static fallback and delayed interaction handoff passed`);
  }

  for (const finish of ['complete', 'unmount', 'unmount-during-fade'] as const) {
    const { page, errors } = await open('normal', true);
    await started(page);
    if (finish === 'unmount-during-fade') {
      await page.keyboard.press('Enter');
      await fading(page, 380);
    }
    if (finish !== 'complete') {
      await page.evaluate(() => window.introHarness.unmount());
      // A canceled fade must never deliver a delayed dismissal callback.
      if (finish === 'unmount-during-fade') await pause(500);
    } else {
      await fading(page, 650);
      await dismissed(page);
    }
    await lost(page);
    const trace = await page.evaluate(() => ({
      contexts: window.introTrace.contexts.length,
      frames: window.introTrace.frames.size,
      resize: window.introTrace.resize.size,
      keys: window.introTrace.keys.size,
      events: window.introHarness.events,
    }));
    const events = finish === 'complete' ? ['busy:false', 'dismiss'] : finish === 'unmount' ? [] : ['busy:false'];
    assert.deepEqual(trace, { contexts: 1, frames: 0, resize: 0, keys: 0, events });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${finish}: scene, frames, listeners, and callbacks passed`);
  }

  // Resolve imports after both dismissal and unmount; neither may create a scene.
  for (const unmount of [false, true]) {
    const { page, errors, release } = await open('slow', true);
    if (unmount) await page.evaluate(() => window.introHarness.unmount());
    else { await page.keyboard.press('Escape'); await dismissed(page); }
    const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/introScene.ts'));
    release();
    await response;
    await pause(150);
    assert.deepEqual(await page.evaluate(() => ({
      contexts: window.introTrace.contexts.length, frames: window.introTrace.frames.size,
      resize: window.introTrace.resize.size, keys: window.introTrace.keys.size,
      events: window.introHarness.events,
    })), { contexts: 0, frames: 0, resize: 0, keys: 0, events: unmount ? [] : ['busy:false', 'dismiss'] });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`late import after ${unmount ? 'unmount' : 'skip'}: no scene or orphaned work`);
  }
} finally {
  await browser?.close();
  await server.close();
}
