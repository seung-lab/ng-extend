/**
 * Where the 2D images load from: the usual copy in the Americas, or a copy
 * hosted in Asia (Ames 2026-10-22; Kim_OZ in Australia saw slow 2D).
 *
 * Asia copies exist for three datasets. Each covers the same voxels as the
 * usual copy (same voxel size, extent and offset at every scale, checked
 * 2026-10-22); only the chunking and compression differ. The Asia buckets
 * answer fastest from Taipei (about 40 ms) and are slow from Europe (about
 * 1.7 s to the first byte), so Europe stays on the Americas.
 *
 * Settings > 2D images > "2D images load from" holds the choice
 * (userPrefs.imageSource): Automatic, Americas or Asia. Automatic times one
 * small file from each copy, once per browser every 30 days, and only for
 * a browser whose time zone is outside the Americas; until then it guesses
 * from the time zone. The choice is applied to every image layer as it
 * appears, so a shared link or saved view made on either copy opens on the
 * player's own.
 *
 * A player still on the Americas whose 2D panel stays unfilled for 8 s twice
 * in a session (or 16 s at a stretch) is offered the Asia copy, but only when the timing shows Asia
 * is clearly faster for them.
 */
import { ref, watch } from 'vue';
import { useUserPreferencesStore } from '../store';

export type ImageRegion = 'americas' | 'asia';
export type ImageSourceChoice = 'auto' | ImageRegion;

interface Mirror { americas: string; asia: string }
export const IMAGE_MIRRORS: Mirror[] = [
  // EyeWire II Retina
  { americas: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2',
    asia: 'precomputed://gs://stroeh_sem_mouse_retina_asia/image/v2' },
  // MEC
  { americas: 'precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2',
    asia: 'precomputed://gs://princeton-eric-medial-entorhinal-cortex-asia' },
  // Sandbox (pinky)
  { americas: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em',
    asia: 'precomputed://gs://pinky_asia/em' },
];

/** One spelling per source: "precomputed://<url>", no trailing slash. Also
 *  reads neuroglancer's newer "gs://x/|neuroglancer-precomputed:" form. */
export function normalizeSourceUrl(url: string): string {
  let s = (url || '').trim();
  const piped = /^(.*?)\|neuroglancer-precomputed:?$/.exec(s);
  if (piped) s = 'precomputed://' + piped[1];
  return s.replace(/\/+$/, '');
}

export function mirrorFor(url: string): Mirror | undefined {
  const n = normalizeSourceUrl(url);
  return IMAGE_MIRRORS.find(m => normalizeSourceUrl(m.americas) === n || normalizeSourceUrl(m.asia) === n);
}

function infoUrl(source: string): string {
  const u = source.replace(/^precomputed:\/\//, '');
  const gs = /^gs:\/\/(.*)$/.exec(u);
  return (gs ? 'https://storage.googleapis.com/' + gs[1] : u) + '/info';
}

// ── The timing ─────────────────────────────────────────────────────────────
const RACE_KEY = 'nge_image_race_v1';
const RACE_DAYS = 30;
interface RaceResult { region: ImageRegion; americasMs: number; asiaMs: number; at: number }

function storedRace(): RaceResult | null {
  try {
    const r = JSON.parse(localStorage.getItem(RACE_KEY) || 'null') as RaceResult | null;
    if (r && (r.region === 'americas' || r.region === 'asia') && Date.now() - r.at < RACE_DAYS * 864e5) return r;
  } catch { /* */ }
  return null;
}
/** The timing's answer, once known (reactive, so Automatic follows it). */
const raceRegion = ref<ImageRegion | null>(storedRace()?.region ?? null);

async function timeOnce(url: string): Promise<number> {
  const t = performance.now();
  try {
    const r = await fetch(url, { cache: 'no-store' });
    await r.arrayBuffer();
    return r.ok ? performance.now() - t : Infinity;
  } catch { return Infinity; }
}

let racing: Promise<RaceResult | null> | null = null;
/** Times the retina info file on both copies, three rounds side by side, and
 *  keeps the best of each. Asia wins only when clearly faster. A timing from
 *  the last 30 days on this browser is used as it is. */
export function raceImageCopies(): Promise<RaceResult | null> {
  if (racing) return racing;
  const stored = storedRace();
  if (stored) return (racing = Promise.resolve(stored));
  racing = (async () => {
    const m = IMAGE_MIRRORS[0];
    const a = infoUrl(m.americas), b = infoUrl(m.asia);
    let am = Infinity, as = Infinity;
    for (let i = 0; i < 3; i++) {
      const [x, y] = await Promise.all([timeOnce(a), timeOnce(b)]);
      am = Math.min(am, x); as = Math.min(as, y);
    }
    if (!isFinite(am) && !isFinite(as)) return null;
    const region: ImageRegion = as < am * 0.7 && am - as > 60 ? 'asia' : 'americas';
    const res: RaceResult = { region, americasMs: Math.round(am), asiaMs: Math.round(as), at: Date.now() };
    try { localStorage.setItem(RACE_KEY, JSON.stringify(res)); } catch { /* */ }
    console.info(`[2D] image copies timed: Americas ${res.americasMs} ms, Asia ${res.asiaMs} ms; faster: ${region}`);
    raceRegion.value = region;
    return res;
  })();
  return racing;
}

function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

export function imageSourceChoice(): ImageSourceChoice {
  try {
    const c = useUserPreferencesStore().prefs.imageSource;
    return c === 'americas' || c === 'asia' ? c : 'auto';
  } catch { return 'auto'; }
}

/** What Automatic resolves to right now. */
export function automaticRegion(): ImageRegion {
  return raceRegion.value ?? (timeZone().startsWith('Asia/') ? 'asia' : 'americas');
}

export function effectiveRegion(): ImageRegion {
  const c = imageSourceChoice();
  return c === 'auto' ? automaticRegion() : c;
}

// ── Applying it to the viewer ──────────────────────────────────────────────
function imageDataSources(v: any): { ml: any; ds: any }[] {
  const out: { ml: any; ds: any }[] = [];
  for (const ml of (v.layerManager?.managedLayers || []) as any[]) {
    const layer = ml.layer;
    if (!layer || layer.constructor?.type !== 'image') continue;
    for (const ds of layer.dataSources || []) out.push({ ml, ds });
  }
  return out;
}

function applyRegion(v: any) {
  const region = effectiveRegion();
  for (const { ml, ds } of imageDataSources(v)) {
    const url = ds.spec?.url;
    if (!url) continue;
    const m = mirrorFor(url);
    if (!m) continue;
    const want = m[region];
    if (normalizeSourceUrl(url) === normalizeSourceUrl(want)) continue;
    console.info(`[2D] image layer "${ml.name}" loads from the ${region === 'asia' ? 'Asia' : 'Americas'} copy`);
    ds.spec = { ...ds.spec, url: want };
  }
}

// ── The slow 2D note ───────────────────────────────────────────────────────
const NOTE_KEY = 'nge_image_note_v1';
const SLOW_MS = 8000;
const SLOW_EPISODES = 2;

function noteSnoozed(): boolean {
  try { return Date.now() < (JSON.parse(localStorage.getItem(NOTE_KEY) || '{}').until || 0); } catch { return false; }
}
function snoozeNote(days: number) {
  try { localStorage.setItem(NOTE_KEY, JSON.stringify({ until: Date.now() + days * 864e5 })); } catch { /* */ }
}

function showNote() {
  if (document.querySelector('.nge-image-note')) return;
  const bar = document.createElement('div');
  bar.className = 'nge-image-note';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span class="nge-in-text">2D images are loading slowly. A copy hosted in Asia may be faster for you.</span>`
    + `<button type="button" class="nge-in-yes">Use Asia</button>`
    + `<button type="button" class="nge-in-no">Not now</button>`;
  bar.querySelector('.nge-in-yes')!.addEventListener('click', () => {
    try { useUserPreferencesStore().save({ imageSource: 'asia' }); } catch { /* */ }
    snoozeNote(RACE_DAYS);
    bar.remove();
  });
  bar.querySelector('.nge-in-no')!.addEventListener('click', () => { snoozeNote(30); bar.remove(); });
  document.body.appendChild(bar);
}

const CSS = `
.nge-image-note { position: fixed; top: 58px; left: 50%; transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px); flex-wrap: wrap;
  padding: 8px 10px 8px 14px; border-radius: 8px; font: 13px/1.35 'Inter', system-ui, sans-serif;
  color: #dce6f5; background: rgba(8, 14, 28, 0.94); border: 1px solid rgba(100, 200, 255, 0.4);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
.nge-image-note .nge-in-text { overflow-wrap: anywhere; }
.nge-image-note button { flex-shrink: 0; padding: 5px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
.nge-image-note .nge-in-yes { font-weight: 600; color: #06121f; background: #7fd4ff; border: 0; }
.nge-image-note .nge-in-yes:hover { background: #a9e3ff; }
.nge-image-note .nge-in-no { color: rgba(220, 230, 245, 0.8); background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); }
`;

function startSlowWatch(v: any) {
  let since = 0, episodes = 0, done = false;
  const timer = setInterval(() => {
    if (done || document.hidden) return;
    if (effectiveRegion() !== 'americas' || noteSnoozed()) { since = 0; return; }
    let need = 0, have = 0;
    for (const { ml, ds } of imageDataSources(v)) {
      if (!ml.visible || ml.archived || !mirrorFor(ds.spec?.url || '')) continue;
      for (const rl of ml.layer.renderLayers || []) {
        const p = rl.layerChunkProgressInfo;
        if (!p) continue;
        need += p.numVisibleChunksNeeded || 0;
        have += Math.min(p.numVisibleChunksAvailable || 0, p.numVisibleChunksNeeded || 0);
      }
    }
    // Each 8 s the panel stays unfilled counts once: two separate waits, or
    // one that lasts 16 s.
    if (need > 0 && have < need) {
      if (!since) since = Date.now();
      else if (Date.now() - since > SLOW_MS) { episodes++; since = Date.now(); }
    } else since = 0;
    if (episodes >= SLOW_EPISODES) {
      done = true;
      clearInterval(timer);
      void raceImageCopies().then(r => {
        if (r?.region === 'asia' && effectiveRegion() === 'americas' && !noteSnoozed()) showNote();
      });
    }
  }, 1000);
}

/** Call once the viewer exists. */
export function startImageSource(v: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const hooked = new WeakSet<object>();
  const onLayers = () => {
    for (const ml of (v.layerManager?.managedLayers || []) as any[]) {
      if (!hooked.has(ml) && ml.layerChanged) { hooked.add(ml); ml.layerChanged.add(onLayers); }
    }
    applyRegion(v);
  };
  v.layerManager.layersChanged.add(onLayers);
  onLayers();
  // A change of the setting, the account's copy arriving, or the timing's answer.
  setTimeout(() => watch(() => effectiveRegion(), () => applyRegion(v)), 0);
  // Automatic outside the Americas: time both copies once (stored 30 days).
  if (imageSourceChoice() === 'auto' && !raceRegion.value && !timeZone().startsWith('America/')) {
    setTimeout(() => void raceImageCopies(), 3000);
  }
  startSlowWatch(v);
}

export const imageRegionLabel = (r: ImageRegion) => (r === 'asia' ? 'Asia' : 'Americas');
