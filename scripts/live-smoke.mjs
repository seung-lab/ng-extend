#!/usr/bin/env node
/**
 * live-smoke.mjs: does the live Pyr site actually draw? Loads it in headless
 * Chromium the way a player would and checks what health-watch.mjs cannot:
 *
 *   1. build-commit.txt answers with a commit.
 *   2. The app mounts (#app has content and the viewer exists).
 *   3. The 3D panel draws something. Signed out players see the sign in box,
 *      so this taps BYPASS and opens a public dataset (FlyEM FIB-25 meshes,
 *      no sign in needed), then counts the pixels its meshes draw in the 3D panel.
 *   4. No page errors and no Vue errors in the first 60 s. Those are also
 *      what src/util/error_reporting.ts would write to client_errors; the
 *      writes are caught here and dropped, so smoke runs never fill that table.
 *
 * A failing check is tried once more before it counts (the site, the public
 * bucket or the runner can blip). Alerting is the same as health-watch.mjs:
 * the bot's own recent "[smoke]" message in the channel says whether this
 * was already raised, so a failure posts once, repeats at most every 6 hours,
 * and a recovery posts once. The process exits 1 when the site fails, so the
 * run is red in GitHub too.
 *
 * Env: SMOKE_URL (default the live site), EXPECT_COMMIT (after a deploy: wait
 *      for build-commit.txt to say this first), SLACK_BOT_TOKEN,
 *      SLACK_CHANNEL_ID, ALERT_SLACK_ID, DRY_RUN=true to print instead of
 *      post, SHOT_DIR (where to save screenshots), PLAYWRIGHT_MODULE (path
 *      to playwright if it is not installed next to this script),
 *      GITHUB_TOKEN (to tell a superseded deploy from one that did not land).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const DRY = env.DRY_RUN === 'true';
const URL_ = (env.SMOKE_URL || 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/').replace(/\/?$/, '/');
const CHANNEL = env.SLACK_CHANNEL_ID || 'C0BG5CN71C3';
const TAG = env.ALERT_SLACK_ID || 'U02FH1DRC';
const SHOT_DIR = env.SHOT_DIR || 'smoke-shots';
const MARK = '[smoke]';
const REPEAT_MS = 6 * 3600 * 1000;
const WATCH_MS = 60000;
const DEPLOY_WAIT_MS = 15 * 60 * 1000;
// Pixels the test meshes must draw in the 3D panel. FIB-25 at this zoom
// draws a few thousand; with no meshes the count is 0.
const MIN_LIT = 300;

// A public dataset with meshes, so the check needs no sign in.
const PUBLIC_VIEW = {
  dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [8e-9, 'm'] },
  position: [2914.5, 3088.5, 4045],
  projectionScale: 2048,
  showAxisLines: false,
  showScaleBar: false,
  showDefaultAnnotations: false,
  layout: '3d',
  layers: [{
    type: 'segmentation',
    name: 'smoke',
    source: 'precomputed://gs://neuroglancer-public-data/flyem_fib-25/ground_truth',
    segments: ['158571', '21894', '22060', '24436', '2515'],
  }],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const timed = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) });

async function servedCommit() {
  const r = await timed(`${URL_}build-commit.txt?t=${Date.now()}`, { cache: 'no-store' });
  const text = (await r.text()).trim();
  return { status: r.status, text };
}

/** Is `sha` still the tip of eyewire-ii-community? False when a newer push
 *  replaced it before it went live; null when that cannot be told. */
async function stillTip(sha) {
  if (!env.GITHUB_TOKEN) return null;
  try {
    const r = await timed('https://api.github.com/repos/seung-lab/ng-extend/commits/eyewire-ii-community', {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.sha', 'User-Agent': 'eyewire-live-smoke' },
    });
    return r.ok ? (await r.text()).trim() === sha : null;
  } catch { return null; }
}

/** After a deploy: wait for App Engine to serve the new build. */
async function waitForDeploy(sha) {
  const until = Date.now() + DEPLOY_WAIT_MS;
  let last = '';
  while (Date.now() < until) {
    try { last = (await servedCommit()).text; } catch (e) { last = e.message; }
    if (last === sha) { console.log(`[smoke] ${sha.slice(0, 8)} is live`); return { ok: true }; }
    if (await stillTip(sha) === false) {
      console.log(`[smoke] ${sha.slice(0, 8)} was replaced by a newer push; checking whatever is live`);
      return { ok: true };
    }
    await sleep(20000);
  }
  return { ok: false, detail: `the deploy of ${sha.slice(0, 8)} did not go live in 15 minutes (build-commit.txt says ${last.slice(0, 60) || 'nothing'})` };
}

async function checkBuildCommit() {
  try {
    const { status, text } = await servedCommit();
    if (status === 200 && /^[0-9a-f]{40}$/.test(text)) return { ok: true, detail: text.slice(0, 8) };
    return { ok: false, detail: `build-commit.txt answered ${status}: ${text.slice(0, 80) || '(empty)'}` };
  } catch (e) { return { ok: false, detail: `build-commit.txt unreachable: ${e.message}` }; }
}

async function loadPlaywright() {
  if (env.PLAYWRIGHT_MODULE) return import(pathToFileURL(env.PLAYWRIGHT_MODULE).href);
  return import('playwright');
}

/** One visit to the site. Returns the problems found (empty when fine). */
async function visit(chromium, attempt) {
  const problems = [];
  const errors = [];
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(`page error: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && m.text().startsWith('[vue error]')) errors.push(`Vue error: ${m.text().slice(0, 300)}`);
    });
    // What error_reporting.ts would have sent; drop it so the table stays clean.
    await page.route(/\/rest\/v1\/client_errors/, route => {
      try {
        const rows = [].concat(JSON.parse(route.request().postData() || '[]'));
        for (const row of rows) {
          if (['vue', 'window', 'promise'].includes(row.source)) {
            errors.push(`reported ${row.source} error${row.component ? ` in ${row.component}` : ''}: ${String(row.message).slice(0, 300)}`);
          }
        }
      } catch { /* not ours to judge */ }
      return route.fulfill({ status: 201, body: '' });
    });

    const started = Date.now();
    const res = await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!res || res.status() >= 400) problems.push(`the page answered ${res ? res.status() : 'nothing'}`);

    // 2. The app mounts.
    const mounted = await page.waitForFunction(
      () => (document.querySelector('#app')?.children.length || 0) > 0 && !!(window).viewer && !!document.querySelector('.neuroglancer-viewer'),
      null, { timeout: 30000 },
    ).then(() => true, () => false);
    if (!mounted) problems.push('the app did not mount in 30 s (#app empty or no viewer)');

    // 3. The 3D panel draws.
    if (mounted) {
      const skip = page.locator('.nge-login-skip');
      if (await skip.isVisible({ timeout: 15000 }).catch(() => false)) await skip.click();
      await page.evaluate(view => (window).viewer.state.restoreState(view), PUBLIC_VIEW);
      // The celebration sparkles twinkle over the 3D panel and would count as drawn.
      await page.addStyleTag({ content: '.nge-confetti-canvas { display: none !important; }' });
      let lit = 0;
      const until = Date.now() + 40000;
      while (Date.now() < until) {
        await sleep(3000);
        lit = await drawnPixels(page);
        if (lit >= MIN_LIT) break;
      }
      console.log(`[smoke] attempt ${attempt}: 3D panel pixels drawn by the test meshes ${lit}`);
      if (lit < MIN_LIT) problems.push(`the 3D panel stayed blank (the test meshes drew ${lit} pixels in 40 s, needs ${MIN_LIT})`);
    }

    // 4. Keep watching for errors until 60 s after load.
    const left = WATCH_MS - (Date.now() - started);
    if (left > 0) await sleep(left);
    const unique = [...new Set(errors)];
    if (unique.length) problems.push(`${unique.length} error(s) in the first minute: ${unique.slice(0, 3).join(' | ')}`);

    try {
      mkdirSync(SHOT_DIR, { recursive: true });
      writeFileSync(join(SHOT_DIR, `attempt-${attempt}.png`), await page.screenshot());
    } catch (e) { console.warn('[smoke] screenshot not saved:', e.message); }
  } catch (e) {
    problems.push(`the visit failed: ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close().catch(() => {});
  }
  return problems;
}

/** Pixels in the 3D panel that the test layer draws: a screenshot of the
 *  panel with the layer's meshes shown, compared with one with them see-through (the WebGL
 *  canvas itself cannot be read back after it is drawn). Comparing, rather
 *  than counting bright pixels, leaves out Pyr's chat box, side panels and
 *  tours, which sit over the panel. */
async function drawnPixels(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.nge-3d-panel') || document.querySelector('.neuroglancer-rendered-data-panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 20 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });
  if (!box) return 0;
  // Mesh opacity, not the layer: with no cell shown Pyr fills the view with stars.
  const show = on => page.evaluate(on => {
    const alpha = (window).viewer.layerManager.getLayerByName('smoke')?.layer?.displayState?.objectAlpha;
    if (alpha) alpha.value = on ? 1 : 0;
  }, on);
  const shot = async () => (await page.screenshot({ clip: box })).toString('base64');
  await show(true);
  await sleep(1000);
  const on = await shot();
  await show(false);
  await sleep(1500);
  const off = await shot();
  await show(true);
  return page.evaluate(async ([a, b]) => {
    const pixels = async b64 => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [p, q] = [await pixels(a), await pixels(b)];
    let n = 0;
    for (let i = 0; i < p.length && i < q.length; i += 4) {
      if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 90) n++;
    }
    return n;
  }, [on, off]);
}

async function slack(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`slack ${method}: ${j.error}`);
  return j;
}

/** The bot's most recent [smoke] message in the channel, if any. */
async function lastSmokeMessage() {
  if (!env.SLACK_BOT_TOKEN) throw new Error('no Slack token, history not read');
  const r = await fetch(`https://slack.com/api/conversations.history?channel=${CHANNEL}&limit=200`, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`slack history: ${j.error}`);
  return (j.messages || []).find(m => m.bot_id && (m.text || '').includes(MARK)) || null;
}

(async () => {
  console.log(`[smoke] checking ${URL_}${DRY ? ' (dry run)' : ''}`);
  const results = {};
  if (env.EXPECT_COMMIT) results['Deploy went live'] = await waitForDeploy(env.EXPECT_COMMIT.trim());

  results['build-commit.txt'] = await checkBuildCommit();

  const { chromium } = await loadPlaywright();
  let problems = await visit(chromium, 1);
  if (problems.length) {
    console.log(`[smoke] attempt 1 found: ${problems.join('; ')}. Trying again in 30 s.`);
    await sleep(30000);
    problems = await visit(chromium, 2);
  }
  results['Site loads and draws'] = problems.length
    ? { ok: false, detail: problems.join('; ') }
    : { ok: true, detail: 'app mounted, 3D panel drew, no errors in the first minute' };

  for (const [name, r] of Object.entries(results)) console.log(`[smoke] ${r.ok ? 'OK  ' : 'FAIL'} ${name}: ${r.detail || ''}`);
  const failing = Object.entries(results).filter(([, r]) => !r.ok);
  const signature = failing.map(([n]) => n).sort().join('|');

  const last = await lastSmokeMessage().catch(e => { console.warn(`[smoke] ${e.message}`); return null; });
  const lastSig = last?.text?.match(/\{sig:([^}]*)\}/)?.[1] ?? '';
  const lastWasFailure = !!last && lastSig !== '';
  const lastAt = last ? Number(last.ts) * 1000 : 0;

  let text = null;
  if (failing.length) {
    const fresh = !lastWasFailure || lastSig !== signature || Date.now() - lastAt > REPEAT_MS;
    if (fresh) {
      const run = env.GITHUB_RUN_ID ? ` Screenshots: ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
      text = `🚨 ${MARK} <@${TAG}> Pyr is not drawing for players (${URL_}):\n`
        + failing.map(([n, r]) => `• *${n}*: ${r.detail}`).join('\n')
        + `\nI check every hour and after each deploy, and will say here when it recovers.${run} {sig:${signature}}`;
    }
  } else if (lastWasFailure) {
    text = `✅ ${MARK} Recovered: Pyr loads, the 3D view draws and no errors show in the first minute. {sig:}`;
  }

  if (!text) console.log('[smoke] nothing to post');
  else if (DRY) console.log('[smoke] DRY RUN, would post:\n' + text);
  else { await slack('chat.postMessage', { channel: CHANNEL, text, unfurl_links: false }); console.log('[smoke] posted to Slack'); }

  process.exit(failing.length ? 1 : 0);
})().catch(e => { console.error('[smoke] fatal:', e.message); process.exit(1); });
