#!/usr/bin/env node
/**
 * measure-2d-loading.cjs: time how long a neuroglancer page (plain, or Pyr)
 * takes to fill its 2D image view, and what the network did meanwhile.
 *
 *   node scripts/measure-2d-loading.cjs --base http://localhost:3490/ --state sandbox-image --label game-sandbox --runs 3
 *   node scripts/measure-2d-loading.cjs --base https://neuroglancer-demo.appspot.com/ --state retina-image --label demo-retina
 *
 * Options
 *   --base <url>         page to load; the state goes in the #! fragment
 *   --state <name>       sandbox-image | retina-image | sandbox-full | retina-full | none (no fragment)
 *   --state-file <path>  a JSON state instead of a built in one
 *   --layout <xy|xy-3d|3d|4panel>   override the state's layout
 *   --scale <n>          override crossSectionScale
 *   --viewport 1600x900  browser viewport
 *   --runs 3             cold runs (fresh context, empty cache) per invocation
 *   --warm               after each cold run, reload in the same context (cached)
 *   --timeout 60000      give up on a run after this many ms
 *   --headless           (default is a visible window: a hidden tab never draws)
 *   --out <path.jsonl>   append one JSON line per run
 *   --shots <dir>        save a screenshot at the end of each run
 *   --label <text>       tag for the output
 *
 * A run reports, relative to navigation start: when window.viewer appeared,
 * when the first visible image chunk was available, and when every visible
 * image chunk was available for 500 ms (t_full). It also lists requests by
 * host and by scale key, bytes, protocol, concurrency, failures, Range use,
 * and main thread long tasks.
 */
const path = require('path');
const fs = require('fs');

const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/amyle/.claude/skills/gstack/node_modules/playwright-core';
const { chromium } = require(PW);

const SANDBOX_IMG = { type: 'image', source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em', name: 'img' };
const SANDBOX_SEG = { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'pinky_nf_v2' };
const RETINA_IMG = { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' };
const RETINA_SEG = { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina' };

const STATES = {
  'sandbox-image': { dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [73631, 63170, 344], crossSectionScale: 1.1, projectionScale: 2230, layers: [SANDBOX_IMG], layout: 'xy' },
  'sandbox-full': { dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [73631, 63170, 344], crossSectionScale: 1.1, projectionScale: 2230, layers: [SANDBOX_IMG, SANDBOX_SEG], layout: 'xy-3d' },
  'retina-image': { dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [32653, 23923, 583], crossSectionScale: 3, projectionScale: 15000, layers: [RETINA_IMG], layout: 'xy' },
  'retina-full': { dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [32653, 23923, 583], crossSectionScale: 3, projectionScale: 15000, layers: [RETINA_IMG, RETINA_SEG], layout: 'xy-3d' },
};

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const base = String(arg('base', 'http://localhost:3490/'));
const stateName = String(arg('state', 'retina-image'));
const stateFile = arg('state-file', null);
const layoutOverride = arg('layout', null);
const scaleOverride = arg('scale', null);
const [vw, vh] = String(arg('viewport', '1600x900')).split('x').map(Number);
const runs = Number(arg('runs', 1));
const warm = !!arg('warm', false);
const timeout = Number(arg('timeout', 60000));
const headless = !!arg('headless', false);
const out = arg('out', null);
const shots = arg('shots', null);
const label = String(arg('label', stateName));
const after = arg('after', null) ? String(arg('after')).split(',').map(x => x.trim()).filter(Boolean) : [];
// --throttle <down_kbps>[,<latency_ms>[,<up_kbps>]]: CDP network emulation on the page (checked
// against the worker's requests by the request durations it reports).
const throttle = arg('throttle', null) ? String(arg('throttle')).split(',').map(Number) : null;
// --companion <state>: a second tab in the same browser context loads this state at the same
// time and stays open, to model a player with two game tabs (shared connection pool and link).
const companion = arg('companion', null) ? String(arg('companion')) : null;
// --fake-login: push a pretend session into the game's store so the login overlay goes away and
// screenshots show the view (server calls that need CAVE auth still fail). --shots-progress: also
// save a screenshot the moment the first image chunk is available.
const fakeLogin = !!arg('fake-login', false);
const shotsProgress = !!arg('shots-progress', false);

let state = null;
if (stateFile) state = JSON.parse(fs.readFileSync(String(stateFile), 'utf8'));
else if (stateName !== 'none') {
  state = JSON.parse(JSON.stringify(STATES[stateName] || null));
  if (!state) { console.error('unknown state', stateName); process.exit(2); }
}
if (state && layoutOverride) state.layout = String(layoutOverride);
if (state && scaleOverride) state.crossSectionScale = Number(scaleOverride);
// --prefetch false / --concurrent N: neuroglancer's own URL-state knobs (viewer.ts), for A/B runs.
if (state && arg('prefetch', null) !== null) state.prefetch = String(arg('prefetch')) !== 'false';
if (state && arg('concurrent', null) !== null) state.concurrentDownloads = Number(arg('concurrent'));
const url = state ? base + '#!' + encodeURIComponent(JSON.stringify(state)) : base;

const IMAGE_HOSTS = ['bossdb-open-data.s3.amazonaws.com', 'storage.googleapis.com', 'www.googleapis.com', 'c10s.pni.princeton.edu'];
const sum = a => a.reduce((x, y) => x + y, 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Runs in the page: one sample of the viewer's own progress numbers.
function sampleInPage() {
  const v = window.viewer;
  if (!v) return { viewer: false, hidden: document.hidden, layers: [] };
  if (!window.__navHooked && v.navigationState && v.navigationState.changed) {
    window.__navHooked = true;
    window.__navChanges = { count: 0, last: 0 };
    v.navigationState.changed.add(() => { window.__navChanges.count++; window.__navChanges.last = Math.round(performance.now()); });
  }
  const layers = [];
  for (const ml of (v.layerManager && v.layerManager.managedLayers) || []) {
    const type = (ml.layer && ml.layer.constructor && ml.layer.constructor.type) || (ml.layer ? 'unknown' : 'pending');
    let need = 0, have = 0, pneed = 0, phave = 0, rls = 0;
    for (const rl of (ml.layer && ml.layer.renderLayers) || []) {
      const p = rl.layerChunkProgressInfo; if (!p) continue; rls++;
      need += p.numVisibleChunksNeeded || 0;
      have += Math.min(p.numVisibleChunksAvailable || 0, p.numVisibleChunksNeeded || 0);
      pneed += p.numPrefetchChunksNeeded || 0; phave += p.numPrefetchChunksAvailable || 0;
    }
    let rst = null; try { rst = ml.layer.sliceViewRenderScaleTarget.value; } catch (e) {}
    layers.push({ name: ml.name, type, visible: !!ml.visible && !ml.archived, need, have, pneed, phave, renderLayers: rls, renderScaleTarget: rst });
  }
  const panels = [];
  try { for (const p of v.display.panels) { const el = p.element; if (el && ('sliceView' in p)) panels.push({ w: el.offsetWidth, h: el.offsetHeight }); } } catch (e) {}
  let zoom = null; try { zoom = v.navigationState.zoomFactor.value; } catch (e) {}
  let layout = null; try { layout = v.layout.container.specification.value; } catch (e) { try { layout = v.state.toJSON().layout; } catch (e2) {} }
  let caps = null; try { const c = v.chunkQueueManager.capacities; caps = { gpu: c.gpuMemory.sizeLimit.value, sys: c.systemMemory.sizeLimit.value, dl: c.download.itemLimit.value, prefetch: v.chunkQueueManager.enablePrefetch ? v.chunkQueueManager.enablePrefetch.value : null }; } catch (e) {}
  return { viewer: true, hidden: document.hidden, layers, panels, zoom, layout, caps, longTasks: window.__lt || null, nav: window.__navChanges || null };
}

function fakeLoginInPage() {
  try {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    for (const [, st] of pinia._s) if (Array.isArray(st.sessions) && st.sessions.length === 0) st.sessions.push({ name: 'Test', email: 't@example.org', hostname: 'test' });
    return true;
  } catch (e) { return String(e); }
}

// For screenshots with --fake-login: the game's login modal is a Teleported element that stays
// up without a real session, so take it out of the way (it does not affect loading).
function hideOverlaysInPage() {
  for (const el of document.querySelectorAll('.nge-login-blocker')) el.remove();
}

function scaleKeyOf(u) {
  try { u = decodeURIComponent(u); } catch (e) {}
  const m = u.match(/\/((?:\d+(?:\.\d+)?)_(?:\d+(?:\.\d+)?)_(?:\d+(?:\.\d+)?))\//);
  return m ? m[1] : null;
}

// A step after the cold load: z+16 (slices), x+700 / y-400 (screen pixels, converted
// with the current zoom), zoom*2 (crossSectionScale multiplied).
async function applyStep(page, step) {
  const m = step.match(/^(x|y|z|zoom)([+\-*\/])(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error('bad step ' + step);
  await page.evaluate(([axis, op, n]) => {
    const v = window.viewer; const ns = v.navigationState;
    if (axis === 'zoom') { const z = ns.zoomFactor; z.value = op === '*' ? z.value * n : z.value / n; return; }
    const p = ns.position; const arr = p.value; const idx = { x: 0, y: 1, z: 2 }[axis];
    const zoom = ns.zoomFactor.value; // voxels (of the global coordinate space) per screen pixel
    const delta = axis === 'z' ? n : n * zoom;
    arr[idx] += op === '-' ? -delta : delta;
    p.changed.dispatch();
  }, [m[1], m[2], Number(m[3])]);
}

async function measure(page, cdp, tag) {
  const reqs = [];
  const byReq = new Map();
  const proto = new Map();
  const onReq = r => { const rec = { url: r.url(), method: r.method(), type: r.resourceType(), range: r.headers()['range'] || null, t0: Date.now() }; byReq.set(r, rec); reqs.push(rec); };
  const onRes = res => { const rec = byReq.get(res.request()); if (!rec) return; rec.status = res.status(); const h = res.headers(); rec.enc = h['content-encoding'] || null; rec.cl = h['content-length'] ? Number(h['content-length']) : null; rec.tResp = Date.now(); };
  const onFin = async r => { const rec = byReq.get(r); if (!rec) return; rec.t1 = Date.now(); try { const s = await r.sizes(); rec.body = s.responseBodySize; } catch (e) {} };
  const onFail = r => { const rec = byReq.get(r); if (!rec) return; rec.t1 = Date.now(); rec.failed = (r.failure() || {}).errorText || 'failed'; };
  page.on('request', onReq); page.on('response', onRes); page.on('requestfinished', onFin); page.on('requestfailed', onFail);
  const onCdp = e => { try { proto.set(e.response.url, e.response.protocol); } catch (e2) {} };
  cdp.on('Network.responseReceived', onCdp);

  const tStart = Date.now();
  if (tag === 'warm') await page.reload({ waitUntil: 'commit' });
  else if (tag === 'cold') await page.goto(url, { waitUntil: 'commit' });
  else await applyStep(page, tag);
  const samples = [];
  let tViewer = null, tFirst = null, tFull = null, fullSince = null, lastSample = null, firstNeed = null, firstHave = null;
  const deadline = tStart + timeout;
  while (Date.now() < deadline) {
    let s = null;
    try { s = await page.evaluate(sampleInPage); } catch (e) { s = null; }
    const now = Date.now() - tStart;
    if (s) {
      s.t = now; lastSample = s;
      if (samples.length < 2000) samples.push({ t: now, layers: s.layers.map(l => [l.name, l.need, l.have]) });
      if (s.viewer && tViewer == null) {
        tViewer = now;
        if (fakeLogin) await page.evaluate(fakeLoginInPage).catch(() => {});
      }
      const img = s.layers.filter(l => l.type === 'image' && l.visible);
      const need = sum(img.map(l => l.need)), have = sum(img.map(l => l.have));
      if (need > 0 && firstNeed == null) { firstNeed = need; firstHave = have; }
      if (need > 0 && have > 0 && tFirst == null) {
        tFirst = now;
        if (shots && shotsProgress) {
          if (fakeLogin) await page.evaluate(hideOverlaysInPage).catch(() => {});
          await page.screenshot({ path: path.join(String(shots), `${label}-${tag}-first.png`) }).catch(() => {});
        }
      }
      if (need > 0 && have >= need) { if (fullSince == null) fullSince = now; if (now - fullSince >= 500) { tFull = fullSince; break; } }
      else fullSince = null;
    }
    await sleep(100);
  }
  await sleep(300);
  page.off('request', onReq); page.off('response', onRes); page.off('requestfinished', onFin); page.off('requestfailed', onFail); cdp.off('Network.responseReceived', onCdp);

  // Network summary
  const hosts = {};
  const imgReqs = [];
  for (const r of reqs) {
    let host = ''; try { host = new URL(r.url).host; } catch (e) {}
    const h = hosts[host] || (hosts[host] = { count: 0, bytes: 0, failed: 0, pending: 0, durations: [], protocol: null, range: 0, info: 0, byScale: {} });
    h.count++;
    if (r.failed) h.failed++;
    if (r.t1 == null) h.pending++;
    const bytes = r.body != null ? r.body : (r.cl || 0);
    h.bytes += bytes;
    if (r.t1 != null) h.durations.push(r.t1 - r.t0);
    if (!h.protocol && proto.get(r.url)) h.protocol = proto.get(r.url);
    if (r.range) h.range++;
    if (/\/info(\?|$)/.test(r.url)) h.info++;
    const sk = scaleKeyOf(r.url);
    if (sk) { const b = h.byScale[sk] || (h.byScale[sk] = { count: 0, bytes: 0, failed: 0, pending: 0 }); b.count++; b.bytes += bytes; if (r.failed) b.failed++; if (r.t1 == null) b.pending++; }
    if (IMAGE_HOSTS.includes(host)) imgReqs.push({ t0: r.t0 - tStart, t1: r.t1 != null ? r.t1 - tStart : null, bytes, range: r.range, scale: sk, status: r.status, failed: r.failed || null, url: r.url });
  }
  for (const h of Object.values(hosts)) {
    const d = h.durations.slice().sort((a, b) => a - b);
    h.durMedian = d.length ? d[Math.floor(d.length / 2)] : null;
    h.durP90 = d.length ? d[Math.floor(d.length * 0.9)] : null;
    h.durMax = d.length ? d[d.length - 1] : null;
    delete h.durations;
  }
  // Concurrency of image requests over time, and cumulative bytes per 500 ms
  let maxConc = 0; const bins = {};
  const nowRel = Date.now() - tStart;
  for (const r of imgReqs) {
    let c = 0; for (const o of imgReqs) { const oe = o.t1 == null ? nowRel : o.t1; if (o.t0 <= r.t0 && oe > r.t0) c++; }
    maxConc = Math.max(maxConc, c);
    if (r.t1 != null) { const b = Math.floor(r.t1 / 500) * 500; bins[b] = (bins[b] || 0) + r.bytes; }
  }
  const timeline = Object.keys(bins).map(Number).sort((a, b) => a - b).map(b => [b, bins[b]]);
  const imgBytes = sum(imgReqs.map(r => r.bytes));
  const finished = imgReqs.filter(r => r.t1 != null).map(r => r.t1);
  const imgLastFinish = finished.length ? Math.max.apply(null, finished) : null;
  const imgFirstStart = imgReqs.length ? Math.min.apply(null, imgReqs.map(r => r.t0)) : null;
  return {
    label, tag, url: base, state: stateName, layout: state ? state.layout : null, viewport: [vw, vh], throttle, companion,
    t_viewer: tViewer, t_first_chunk: tFirst, t_full: tFull, timed_out: tFull == null, first_need: firstNeed, first_have: firstHave,
    final: lastSample ? { layers: lastSample.layers, panels: lastSample.panels, zoom: lastSample.zoom, layoutSeen: lastSample.layout, caps: lastSample.caps, longTasks: lastSample.longTasks, nav: lastSample.nav, hidden: lastSample.hidden } : null,
    image_requests: imgReqs.length, image_bytes: imgBytes, image_failed: imgReqs.filter(r => r.failed).length, image_pending: imgReqs.filter(r => r.t1 == null).length,
    image_max_concurrency: maxConc, image_bytes_timeline_500ms: timeline,
    image_first_start: imgFirstStart, image_last_finish: imgLastFinish,
    image_request_detail: imgReqs.map(r => ({ t0: r.t0, t1: r.t1, bytes: r.bytes, range: r.range, scale: r.scale, status: r.status, failed: r.failed, path: r.url.replace(/^https?:\/\/[^/]+/, '') })),
    hosts,
    samples,
  };
}

(async () => {
  const browser = await chromium.launch({ headless, args: ['--window-size=' + (vw + 20) + ',' + (vh + 120)] });
  const results = [];
  try {
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({ viewport: { width: vw, height: vh } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__lt = { count: 0, total: 0, max: 0 };
        try { new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__lt.count++; window.__lt.total += Math.round(e.duration); window.__lt.max = Math.max(window.__lt.max, Math.round(e.duration)); } }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
      });
      const errors = [];
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
      page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 300)));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      if (throttle) {
        const [down, lat, up] = throttle;
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: lat || 0, downloadThroughput: down * 1000 / 8, uploadThroughput: (up || down) * 1000 / 8 });
      }
      let companionPage = null;
      if (companion) {
        const cst = JSON.parse(JSON.stringify(STATES[companion] || null));
        if (!cst) { console.error('unknown companion state', companion); process.exit(2); }
        companionPage = await context.newPage();
        if (throttle) { const c2 = await context.newCDPSession(companionPage); await c2.send('Network.enable'); const [down, lat, up] = throttle; await c2.send('Network.emulateNetworkConditions', { offline: false, latency: lat || 0, downloadThroughput: down * 1000 / 8, uploadThroughput: (up || down) * 1000 / 8 }); }
        companionPage.goto(base + '#!' + encodeURIComponent(JSON.stringify(cst)), { waitUntil: 'commit' }).catch(() => {});
        await page.bringToFront();
      }
      const tags = (warm ? ['cold', 'warm'] : ['cold']).concat(after);
      for (const tag of tags) {
        const r = await measure(page, cdp, tag);
        r.run = i; r.console = errors.splice(0, errors.length).slice(0, 20);
        if (shots) { const p = path.join(String(shots), `${label}-${tag}-${i}.png`); try { if (fakeLogin) await page.evaluate(hideOverlaysInPage).catch(() => {}); await page.screenshot({ path: p }); r.shot = p; } catch (e) {} }
        results.push(r);
        const img = r.final ? r.final.layers.filter(l => l.type === 'image') : [];
        console.log(`[${label}/${tag}#${i}] viewer ${r.t_viewer} ms, first chunk ${r.t_first_chunk} ms, at first sample need ${r.first_need} have ${r.first_have}, full ${r.t_full == null ? 'TIMEOUT' : r.t_full + ' ms'} (last image byte ${r.image_last_finish} ms); need ${img.map(l => l.need).join('+')} have ${img.map(l => l.have).join('+')}; image requests ${r.image_requests} (${(r.image_bytes / 1e6).toFixed(1)} MB, max ${r.image_max_concurrency} in flight, ${r.image_failed} failed, ${r.image_pending} pending); panels ${JSON.stringify(r.final && r.final.panels)}; zoom ${r.final && r.final.zoom}; layout ${r.final && r.final.layoutSeen}; long tasks ${JSON.stringify(r.final && r.final.longTasks)}; nav changes ${JSON.stringify(r.final && r.final.nav)}; caps ${JSON.stringify(r.final && r.final.caps)}`);
        for (const [h, v] of Object.entries(r.hosts)) if (IMAGE_HOSTS.includes(h) || v.count >= 5) console.log(`    ${h}: ${v.count} req, ${(v.bytes / 1e6).toFixed(1)} MB, ${v.protocol || '?'}, median ${v.durMedian} ms, p90 ${v.durP90} ms, max ${v.durMax} ms, range ${v.range}, failed ${v.failed}, pending ${v.pending}, scales ${JSON.stringify(v.byScale)}`);
        if (r.console.length) console.log('    console:', r.console.slice(0, 5).join(' | '));
        if (out) fs.appendFileSync(String(out), JSON.stringify(r) + '\n');
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('MEASURE FAIL', e); process.exit(1); });
