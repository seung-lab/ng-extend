<script setup lang="ts">
/**
 * Admin Hub > Hunts (Ames 2026-10-20). Make a Hunt from a link: open the
 * link (a cell with each merger marked by a point in an annotation layer),
 * read the answer key, the cells and the view from the screen, set the dates,
 * and schedule it. Scheduling writes the three notifications (announcement,
 * start, end) at their own times; each can also be sent now. When it ends,
 * the gold, silver and bronze Achievements are given by themselves.
 * Rules on the server: functions/hunts.js.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import ConfirmDialog from 'components/ConfirmDialog.vue';
import { useProofreadingBackendStore } from '../store';
import { renderSafeMarkdown } from '../util/safe_markdown';
import { pasteFormatted, prefixLines, wrapSelection, type Composer } from '../util/text_composer';
import { huntCall, keyCandidates, readHuntFromScreen, guessKind, crosshairXyz, goToSoma, meshEdgeSpots, ON_TEST_SITE, type KeyCandidate, type KeyKind } from '../hunt';
import { openStartLink } from '../util/start_link';
import { canonicalDataset, currentDatasetTag, datasetAbbrev, findDatasetByCanonical, segLayerName } from '../datasets';
import { ET_ZONE, etNaiveToUtcIso, utcIsoToEtNaive } from '../util/et_time';

type Tier = 'gold' | 'silver' | 'bronze';
type NoteKind = 'announce' | 'start' | 'end';
interface Picture { image_url: string; thumbnail_url: string }
interface NoteInfo { id: number; send_at: string; sent: boolean; title: string; body: string; image_url: string | null; thumbnail_url: string | null }
/** A medal's Achievement: made for this Hunt (its own picture, or the game's medal), or one of the special Achievements already made. */
type PrizeArt = string | { badge_id?: number; image_url?: string; thumbnail_url?: string };
interface Prize { mode: 'own' | 'badge'; badge_id: number | ''; image: Picture | null }
interface AdminHunt {
  edge_count?: number; has_bounds?: boolean;
  id: number; title: string; description: string; dataset: string; cells: { root: string; label: string; soma?: number[] }[];
  start_gap_um?: number | null; start_on_answer?: boolean;
  target_count: number; tolerance_nm: number; max_points: number; max_submissions: number;
  tiers: Record<Tier, number>; art: Partial<Record<Tier, PrizeArt>>; status: string; phase: string; admins_only?: boolean;
  announce_at: string | null; start_at: string | null; end_at: string | null; awarded_at: string | null;
  has_view: boolean; thresholds: Record<Tier, number>; players: number;
  notes?: Partial<Record<NoteKind, NoteInfo>>;
  notif_images?: Partial<Record<NoteKind, Picture>>;
}
interface BoardRow { rank: number; name: string; user_id: string; found: number; at: string; gems: number; tier: Tier | null }
interface RunGem { id: string; at: number[] | null; hit: boolean; k: 'cut' | 'merge' | null }
interface Report { user_id: string; name: string; drop_id: string; k: 'cut' | 'merge' | null; at: number[] | null; t: string | null }

const TIERS: Tier[] = ['gold', 'silver', 'bronze'];
const TIER_WORD: Record<Tier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const PHASE_WORD: Record<string, string> = { draft: 'Draft', announced: 'Scheduled', live: 'Running', ended: 'Over', cancelled: 'Cancelled' };
const NOTE_KINDS: NoteKind[] = ['announce', 'start', 'end'];
const NOTE_WORD: Record<NoteKind, string> = { announce: 'Announcement', start: 'The start', end: 'The end and the awards' };
const backend = useProofreadingBackendStore();

const list = ref<AdminHunt[]>([]);
const loading = ref(false);
const error = ref('');
const message = ref('');
const busy = ref('');
const editing = ref<AdminHunt | null>(null);
const board = ref<BoardRow[]>([]);
const asking = ref<'' | 'cancel' | 'delete' | 'start' | 'end' | 'announce'>('');
const notInstalled = ref(false);

// The form
// Empty number fields mean "automatic" and show what that is (0 read as a real zero, Ames 2026-10-21).
const blankPrize = (): Prize => ({ mode: 'own', badge_id: '', image: null });
const blank = () => ({ title: '', description: '', link: '', tolerance_um: 3, max_points: '' as number | '', max_submissions: 10, results_hours: '' as number | '', show_answers: true,
  tiers: { gold: '', silver: '', bronze: '' } as Record<Tier, number | ''>,
  /** The most gems each medal allows (empty: Gold auto, the others no limit). */
  tierGems: { gold: '', silver: '', bronze: '' } as Record<Tier, number | ''>,
  prize: { gold: blankPrize(), silver: blankPrize(), bronze: blankPrize() } as Record<Tier, Prize>,
  announce: '', start: '', end: '', admins_only: false,
  images: { announce: null, start: null, end: null } as Record<NoteKind, Picture | null> });
const form = ref(blank());
const candidates = ref<KeyCandidate[]>([]);
/** The layers ticked for the key, each with its kind (Ames 2026-10-21: one layer for merges, one for cuts). */
const keyPick = ref<Record<string, { on: boolean; kind: KeyKind }>>({});
/** The hunt's cells with their somas (x, y, z as the coordinate bar shows them): players start at the first. */
interface CellRow { root: string; label: string; soma: (number | '')[] }
const cellRows = ref<CellRow[]>([]);
function setCells(cells: { root: string; label: string; soma?: number[] }[]) {
  const was = new Map(cellRows.value.map(c => [c.root, c]));
  cellRows.value = cells.map(c => ({ root: c.root, label: c.label || '', soma: c.soma && c.soma.length === 3 ? [...c.soma] : (was.get(c.root)?.soma ?? ['', '', '']) }));
}
/** Paste "89245, 55709, 978" (or with spaces, as the coordinate bar copies it) into any box: all three fill (Ames 2026-10-21). */
function pasteSoma(i: number, e: ClipboardEvent) {
  const nums = (e.clipboardData?.getData('text') || '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return;   // one number: an ordinary paste into that box
  e.preventDefault();
  cellRows.value[i].soma = nums.slice(0, 3).map(Number);
}
function useCrosshair(i: number) {
  const p = crosshairXyz();
  if (!p) { error.value = 'The viewer is not ready yet.'; return; }
  cellRows.value[i].soma = p;
}
const cellFields = () => cellRows.value.map(c => ({ root: c.root, label: c.label,
  ...(c.soma.every(v => v !== '' && Number.isFinite(Number(v))) ? { soma: c.soma.map(Number) } : {}) }));
// The description, with Bold, Bullets and Numbers (Ames 2026-10-21: "need formatting here").
const descEl = ref<HTMLTextAreaElement | null>(null);
const desc: Composer = { get el() { return descEl.value; }, get: () => form.value.description, set: v => { form.value.description = v; } };
const descPreview = computed(() => (form.value.description.trim() ? renderSafeMarkdown(form.value.description, true) : ''));

function setAdminsOnly(e: Event) { form.value.admins_only = (e.target as HTMLInputElement).checked; }
const somaMissing = computed(() => cellRows.value.length > 0 && !cellRows.value[0].soma.every(v => v !== '' && Number.isFinite(Number(v))));
const read = ref<null | { key: any; view: any; cells: { root: string; label: string }[]; dataset: string; count: number; kinds: { cut: number; merge: number }; edges?: number; autoEdges?: { spots: number[][]; pieces: number; loaded: number } }>(null);

/** 'YYYY-MM-DDTHH:mm' in this computer's time zone. */
// Times are Eastern, as in the Notifications tab (Ames 2026-10-21: "double check date, ET"),
// whatever zone the admin's computer is in. Players see them in their own zone.
function toLocalInput(iso: string | null | undefined): string { return iso ? utcIsoToEtNaive(iso) : ''; }
function fromLocalInput(v: string): string | null { return (v && etNaiveToUtcIso(v)) || null; }
function local(iso: string | null | undefined): string {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t)) + ' ET';
}
/** "Now" beside a time (Ames 2026-10-22): this minute, in ET. Starting now brings a later announcement to now too. */
function setNow(k: 'announce' | 'start') {
  const v = utcIsoToEtNaive(new Date().toISOString());
  form.value[k] = v;
  if (k === 'start' && form.value.announce && form.value.announce > v) form.value.announce = v;
}
/** A day from now at a time, as an Eastern datetime-local value. */
function etDay(days: number, hhmm: string): string { return utcIsoToEtNaive(new Date(Date.now() + days * 86400000).toISOString()).slice(0, 11) + hhmm; }
/** Under each time: "Wed, Oct 21, 11:56 PM ET, in 11 h 58 m", so a slip between AM and PM shows at once. */
function whenLine(v: string): string {
  const iso = fromLocalInput(v); if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return `${local(iso)}, already past`;
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return `${local(iso)}${mine(iso)}, in ${d ? `${d} d ${h} h` : h ? `${h} h ${mm} m` : `${mm} m`}`;
}
/** The admin's own time beside ET when their computer is in another zone: " (12:56 PM PDT your time)". */
const MY_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
function mine(iso: string): string {
  if (!MY_ZONE || MY_ZONE === ET_ZONE) return '';
  try { return ` (${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))} your time)`; } catch { return ''; }
}
function datasetName(canon: string) { const ds = findDatasetByCanonical(canon); return ds ? datasetAbbrev(segLayerName(ds)) : canon; }

async function refresh() {
  loading.value = true; error.value = '';
  try {
    list.value = await huntCall<AdminHunt[]>('hunt.list');
    notInstalled.value = false;
  } catch (e: any) {
    const m = e?.message || String(e);
    // No tables yet (the server says so), or no ewHunt function at all (the request never lands).
    if (/not set up yet|Failed to fetch|NetworkError|Load failed/i.test(m)) notInstalled.value = true;
    error.value = m;
  } finally { loading.value = false; }
}
onMounted(refresh);

function startNew() {
  editing.value = { id: 0 } as AdminHunt;
  form.value = { ...blank(), announce: etDay(1, '15:00'), start: etDay(2, '15:00'), end: etDay(5, '15:00') };
  read.value = null; board.value = []; message.value = ''; error.value = '';
  cellRows.value = [];
  autoRead.value = true;
  scan();
}

async function open(h: AdminHunt) {
  busy.value = 'open'; error.value = ''; message.value = '';
  try {
    const full = await huntCall<AdminHunt & { board: BoardRow[] }>('hunt.read', { id: h.id });
    editing.value = full; board.value = full.board || [];
    form.value = { title: full.title, description: full.description || '', link: keyLink(full), tolerance_um: Math.round(full.tolerance_nm / 100) / 10,
      max_points: full.max_points || '', max_submissions: full.max_submissions || 10, results_hours: (full.tiers as any)?.results_hours || '',
      show_answers: !(full.tiers as any)?.hide_answers,
      tiers: { gold: full.tiers?.gold || '', silver: full.tiers?.silver || '', bronze: full.tiers?.bronze || '' },
      tierGems: { gold: (full.tiers as any)?.gold_gems || '', silver: (full.tiers as any)?.silver_gems || '', bronze: (full.tiers as any)?.bronze_gems || '' },
      prize: { gold: prizeFrom(full.art?.gold), silver: prizeFrom(full.art?.silver), bronze: prizeFrom(full.art?.bronze) },
      announce: toLocalInput(full.announce_at), start: toLocalInput(full.start_at), end: toLocalInput(full.end_at), admins_only: !!full.admins_only,
      images: { announce: full.notif_images?.announce ?? null, start: full.notif_images?.start ?? null, end: full.notif_images?.end ?? null } };
    read.value = null;
    cellRows.value = []; setCells(full.cells || []);
    autoRead.value = false;   // a saved key stays until a link is opened
    scan();
    void loadReports(full);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

function close() { editing.value = null; read.value = null; board.value = []; message.value = ''; autoRead.value = false; void refresh(); }

// The key reads itself (Ames 2026-10-21: "it's kind of confusing that I have to click
// read from screen, shouldn't it be auto?"): for a new Hunt, or once a link is opened,
// the ticked layers are read whenever a tick, a kind or a point count changes. A saved
// Hunt keeps its key until a link is opened, so looking at it never replaces it.
const autoRead = ref(false);
let scanTimer: ReturnType<typeof setInterval> | null = null;
watch(() => !!editing.value && autoRead.value, (on) => {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (on) scanTimer = setInterval(scan, 2000);
}, { immediate: true });
onUnmounted(() => { if (scanTimer) clearInterval(scanTimer); });

function scan() {
  candidates.value = keyCandidates();
  const next: Record<string, { on: boolean; kind: KeyKind }> = {};
  // One layer of cuts and one of merges (Ames 2026-10-21): layers named so are ticked at once.
  for (const c of candidates.value) next[c.name] = keyPick.value[c.name] ?? { on: candidates.value.length === 1 || /cut|merge|extension|edge/i.test(c.name), kind: guessKind(c.name) };
  keyPick.value = next;
}
const picked = computed(() => candidates.value.filter(c => keyPick.value[c.name]?.on).map(c => ({ name: c.name, kind: keyPick.value[c.name].kind, points: c.points })));
watch(() => (autoRead.value && editing.value ? JSON.stringify(picked.value) : ''), (now) => { if (now && picked.value.length) useScreen(); });
const placesWord = (n: number, kind: KeyKind) => kind === 'edge' ? (n === 1 ? '1 edge spot' : `${n} edge spots`) : kind === 'merge' ? (n === 1 ? '1 extension' : `${n} extensions`) : (n === 1 ? '1 merger' : `${n} mergers`);

/**
 * A saved Hunt's key as a link (Ames 2026-10-23: "in duplicated hunts let's also show the link /
 * annotations"): its view with the places back as layers, named so the editor ticks and types them
 * by itself: Mergers (cut), Extensions (merge), edge. Opening it puts the key on screen to check or change.
 */
function keyLink(full: any): string {
  const view = full?.view, targets: any[] = Array.isArray(full?.targets) ? full.targets : [];
  if (!view || !targets.length) return '';
  const dims = view.dimensions || {};
  const axes = Object.keys(dims);
  const xyz = ['x', 'y', 'z'];
  if (!xyz.every(a => Array.isArray(dims[a]) && Number(dims[a][0]) > 0)) return '';
  const toVox = (p: number[]) => axes.map(a => { const i = xyz.indexOf(a); return i < 0 ? 0 : Number(p[i]) / (Number(dims[a][0]) * 1e9); });
  const scaleOf = (r: number[]) => axes.map(a => { const i = xyz.indexOf(a); return i < 0 ? 0 : Number(r[i]) / (Number(dims[a][0]) * 1e9); });
  // A place with an area comes back as its ellipsoid, line or box (Ames 2026-10-26).
  const annotationOf = (p: any, id: string) => {
    const s = p[4];
    if (s && Array.isArray(s.r)) return { type: 'ellipsoid', id, center: toVox(p), radii: scaleOf(s.r) };
    if (s && Array.isArray(s.a)) return { type: 'line', id, pointA: toVox(s.a), pointB: toVox(s.b) };
    if (s && Array.isArray(s.lo)) return { type: 'axis_aligned_bounding_box', id, pointA: toVox(s.lo), pointB: toVox(s.hi) };
    return { type: 'point', id, point: toVox(p) };
  };
  const layerOf = (name: string, pts: any[]) => ({ type: 'annotation', name, source: 'local://annotations', tool: 'annotatePoint',
    annotations: pts.map((p, i) => annotationOf(p, `${name.toLowerCase()}-${i}`)) });
  const cuts = targets.filter(t => t[3] !== 'merge'), merges = targets.filter(t => t[3] === 'merge'), edges: number[][] = full.edges || [];
  const layers = [...(view.layers || []),
    ...(cuts.length ? [layerOf('Mergers', cuts)] : []), ...(merges.length ? [layerOf('Extensions', merges)] : []), ...(edges.length ? [layerOf('edge', edges)] : [])];
  return `${location.origin}${location.pathname}#!${encodeURIComponent(JSON.stringify({ ...view, layers }))}`;
}

function openLink() {
  error.value = ''; message.value = '';
  if (!openStartLink(form.value.link.trim())) { error.value = 'That is not a view link (it needs a #! part). Copy the share link of the view.'; return; }
  message.value = 'Opening the link. The ticked layers are read as soon as they are on screen.';
  autoRead.value = true;
  setTimeout(scan, 2500); setTimeout(scan, 6000);
}

function useScreen() {
  error.value = ''; message.value = '';
  try {
    const layers = picked.value;
    if (!layers.length) throw new Error('Tick the layer (or layers) with the places marked.');
    const r = readHuntFromScreen(layers.map(l => ({ name: l.name, kind: l.kind })));
    if (!r.cells.length) throw new Error('No cell is shown. Show the cell (or cells) the places are on, then read again.');
    const kinds = { cut: 0, merge: 0 };
    let edges = 0;
    for (const l of layers) { if (l.kind === 'edge') edges += l.points; else kinds[l.kind] += l.points; }
    if (!kinds.cut && !kinds.merge) throw new Error('Tick a layer of mergers or extensions too: edge spots are not problems to find.');
    read.value = { ...r, count: kinds.cut + kinds.merge, kinds, edges };
    setCells(r.cells);
    const parts = layers.map(l => `${placesWord(l.points, l.kind)} from "${l.name}"`).join(' and ');
    const edgeNote = (r.key.bounds_nm ? ' The volume\'s edges were read too: an Extend gem within 5 µm of them is the edge of the dataset.' : '')
      + (r.autoEdges?.spots?.length ? ` Found ${r.autoEdges.spots.length} ${r.autoEdges.spots.length === 1 ? 'place' : 'places'} where the cells run out of the data; players see the cells glow teal there.`
        : r.autoEdges?.pieces && r.autoEdges.loaded < r.autoEdges.pieces ? ' The cells\' meshes are still loading: where they run out of the data is found again when you save.' : '');
    message.value = `Read ${parts}, ${r.cells.length === 1 ? '1 cell' : `${r.cells.length} cells`}, on ${datasetName(r.dataset)}.${edgeNote} Save to keep them.`;
  } catch (e: any) { error.value = e?.message || String(e); }
}

const isNew = computed(() => !editing.value?.id);
const phase = computed(() => editing.value?.phase || 'draft');
const scheduled = computed(() => phase.value === 'announced' || phase.value === 'live' || phase.value === 'ended');
const keyNeeded = computed(() => isNew.value && !read.value);
const defaultsFor = computed(() => {
  const n = read.value?.count ?? editing.value?.target_count ?? 0;
  // As the server: the problems and half again (at least two spare); Gold allows a third more gems than problems.
  return n ? { gold: n, silver: Math.ceil((2 * n) / 3), bronze: Math.ceil(n / 3), points: Math.max(n + 2, Math.ceil(1.5 * n)), goldGems: n + Math.ceil(n / 3) } : null;
});

async function save(status?: 'draft' | 'scheduled') {
  if (busy.value) return;
  busy.value = 'save'; error.value = ''; message.value = '';
  try {
    const f = form.value;
    const fields: Record<string, any> = {
      title: f.title, description: f.description, tolerance_nm: Math.round(Number(f.tolerance_um) * 1000),
      max_points: Number(f.max_points) || 0, max_submissions: Number(f.max_submissions) || 10,
      tiers: { gold: Number(f.tiers.gold) || 0, silver: Number(f.tiers.silver) || 0, bronze: Number(f.tiers.bronze) || 0,
        gold_gems: Number(f.tierGems.gold) || 0, silver_gems: Number(f.tierGems.silver) || 0, bronze_gems: Number(f.tierGems.bronze) || 0,
        results_hours: Number(f.results_hours) || 0, hide_answers: !f.show_answers },
      art: artFields(),
      announce_at: fromLocalInput(f.announce), start_at: fromLocalInput(f.start), end_at: fromLocalInput(f.end),
      notif_images: pictureFields(), admins_only: !!f.admins_only,
    };
    const args: Record<string, any> = { fields };
    if (editing.value?.id) args.id = editing.value.id;
    if (read.value) {
      // Where the cells run out of the data, again now: their meshes have had time to load since the read.
      const again = meshEdgeSpots((read.value.cells || []).map(c => c.root), read.value.key?.bounds_nm ?? null);
      if (again.spots.length >= (read.value.key?.auto_edges_nm?.length ?? 0)) read.value.key = { ...read.value.key, auto_edges_nm: again.spots };
      args.key = read.value.key; args.view = read.value.view; fields.dataset = read.value.dataset;
    }
    if (cellRows.value.length) fields.cells = cellFields();
    if (status) args.status = status;
    const h = await huntCall<AdminHunt>('hunt.save', args);
    editing.value = { ...h }; read.value = null; setCells(h.cells || []);
    const sched = (h as any).status === 'scheduled';
    message.value = status === 'scheduled' ? 'Scheduled. The notes go out at their times.' : sched ? 'Saved. It stays scheduled.' : 'Saved as a draft.';
    savedTimes.value = h.start_at && h.end_at ? { announce: h.announce_at || null, start: h.start_at, end: h.end_at } : null;
    void refresh();
  } catch (e: any) { error.value = e?.message || String(e); savedTimes.value = null; }
  finally { busy.value = ''; void showTop(); }
}
/** The saved times, confirmed under the message. */
const savedTimes = ref<null | { announce: string | null; start: string; end: string }>(null);
watch(message, (m) => { if (!m) savedTimes.value = null; });
function whenIso(iso: string | null): string { return iso ? whenLine(toLocalInput(iso)) : ''; }
const msgEl = ref<HTMLElement | null>(null);
const errEl = ref<HTMLElement | null>(null);
/** Up to the message (or the error), where the result of a save shows. */
async function showTop() {
  await nextTick();
  const el = errEl.value || msgEl.value;
  try { el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* old browser */ }
}

async function act(action: 'hunt.now' | 'hunt.cancel' | 'hunt.delete' | 'hunt.award' | 'hunt.rescore', extra: Record<string, any> = {}) {
  const h = editing.value; if (!h?.id || busy.value) return;
  asking.value = ''; busy.value = action; error.value = ''; message.value = '';
  try {
    const r = await huntCall<any>(action, { id: h.id, ...extra });
    if (action === 'hunt.delete') { close(); return; }
    if (action === 'hunt.award') message.value = `Awards: ${r?.gold ?? 0} gold, ${r?.silver ?? 0} silver, ${r?.bronze ?? 0} bronze${r?.fresh ? `, ${r.fresh} new` : ''}.`;
    else if (action === 'hunt.rescore') message.value = `Scored ${r?.rescored ?? 0} answers again; ${r?.changed ?? 0} changed.`;
    else message.value = 'Done.';
    await open(r && r.id ? r : h);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

// ── Pictures for the notes (Ames 2026-10-21) ──
// Each note can have its own picture, or share one: every picture already
// used (in this Hunt or another) can be picked again for any note.
const uploaded = ref<Picture[]>([]);
const uploading = ref<NoteKind | ''>('');
function pictureFields(): Partial<Record<NoteKind, Picture>> {
  const out: Partial<Record<NoteKind, Picture>> = {};
  for (const k of NOTE_KINDS) { const p = form.value.images[k]; if (p?.image_url) out[k] = p; }
  return out;
}
const library = computed<Picture[]>(() => {
  const seen = new Set<string>(); const out: Picture[] = [];
  const add = (p?: Picture | null) => { if (p?.image_url && !seen.has(p.image_url)) { seen.add(p.image_url); out.push({ image_url: p.image_url, thumbnail_url: p.thumbnail_url || p.image_url }); } };
  for (const k of NOTE_KINDS) add(form.value.images[k]);
  uploaded.value.forEach(add);
  for (const h of list.value) for (const k of NOTE_KINDS) add(h.notif_images?.[k]);
  return out.slice(0, 24);
});
async function addPicture(kind: NoteKind, e: Event) {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file || uploading.value) return;
  uploading.value = kind; error.value = ''; message.value = '';
  try {
    const urls = await backend.uploadAdminImage(file, 'notifications');
    const pic = { image_url: urls.fullUrl, thumbnail_url: urls.thumbUrl || urls.fullUrl };
    uploaded.value = [pic, ...uploaded.value];
    const first = NOTE_KINDS.every(k => !form.value.images[k]);
    if (first) { for (const k of NOTE_KINDS) form.value.images[k] = pic; message.value = 'Added for all three notes. Pick another picture for any of them below. Save to keep it.'; }
    else { form.value.images[kind] = pic; message.value = `Added for ${NOTE_WORD[kind].toLowerCase()}. Save to keep it.`; }
  } catch (err: any) { error.value = err?.message || String(err); }
  finally { uploading.value = ''; }
}
function sameForAll(kind: NoteKind) {
  const p = form.value.images[kind];
  for (const k of NOTE_KINDS) form.value.images[k] = p;
}
const noteWhen = (k: NoteKind) => local(fromLocalInput(k === 'announce' ? form.value.announce : k === 'start' ? form.value.start : form.value.end));
const noteSaved = (k: NoteKind) => editing.value?.notes?.[k] ?? null;
/** The note as players will see it, with the form as it is (the server writes the words). */
async function previewNote(kind: NoteKind) {
  error.value = '';
  try {
    const f = form.value;
    const fields: Record<string, any> = { title: f.title || editing.value?.title || '', announce_at: fromLocalInput(f.announce), start_at: fromLocalInput(f.start),
      end_at: fromLocalInput(f.end), notif_images: pictureFields(), ...(read.value ? { cells: read.value.cells } : {}) };
    const rows = await huntCall<{ kind: NoteKind; title: string; body: string; image_url: string | null; thumbnail_url: string | null; send_at: string }[]>('hunt.notes', {
      id: editing.value?.id || undefined, fields, target_count: read.value?.count ?? editing.value?.target_count ?? 0, ...(read.value ? { kinds: read.value.kinds } : {}) });
    const row = rows.find(r => r.kind === kind);
    if (!row) throw new Error(kind === 'announce' ? 'Set an announce time to send an announcement.' : 'This note is not sent.');
    document.dispatchEvent(new CustomEvent('nge:preview-notification', { detail: { title: row.title, body: row.body,
      image_url: row.image_url || '', thumbnail_url: row.thumbnail_url || '', send_at: row.send_at, target_type: 'all' } }));
  } catch (err: any) { error.value = err?.message || String(err); }
}

// ── The Achievements (Ames 2026-10-21: "this should pull actual special badges? we can make custom") ──
// Each medal gives either an Achievement made for this Hunt ("<title>: Gold", the game's
// medal or a picture added here) or one of the special Achievements already made in
// Admin Hub > Special Badges.
function prizeFrom(a?: PrizeArt): Prize {
  if (typeof a === 'string' && a) return { mode: 'own', badge_id: '', image: { image_url: a, thumbnail_url: a } };
  if (a && typeof a === 'object' && a.badge_id) return { mode: 'badge', badge_id: Number(a.badge_id), image: null };
  if (a && typeof a === 'object' && a.image_url) return { mode: 'own', badge_id: '', image: { image_url: a.image_url, thumbnail_url: a.thumbnail_url || a.image_url } };
  return blankPrize();
}
function artFields(): Partial<Record<Tier, PrizeArt>> {
  const out: Partial<Record<Tier, PrizeArt>> = {};
  for (const t of TIERS) {
    const p = form.value.prize[t];
    if (p.mode === 'badge' && p.badge_id) out[t] = { badge_id: Number(p.badge_id) };
    else if (p.mode === 'own' && p.image?.image_url) out[t] = { image_url: p.image.image_url, thumbnail_url: p.image.thumbnail_url };
  }
  return out;
}
/** The special Achievements an admin made (not the ones Hunts make for themselves). */
const specials = computed(() => (backend.specialBadges as any[]).filter(b => b && !String(b.slug || '').startsWith('hunt-')));
const specialById = (id: number | '') => specials.value.find(b => b.id === Number(id)) || null;
const prizeUploads = ref<Picture[]>([]);
const prizeUploading = ref<Tier | ''>('');
const prizeLibrary = computed<Picture[]>(() => {
  const seen = new Set<string>(); const out: Picture[] = [];
  const add = (p?: Picture | null) => { if (p?.image_url && !seen.has(p.image_url)) { seen.add(p.image_url); out.push(p); } };
  for (const t of TIERS) add(form.value.prize[t].image);
  prizeUploads.value.forEach(add);
  for (const h of list.value) for (const t of TIERS) { const pr = prizeFrom(h.art?.[t]); if (pr.mode === 'own') add(pr.image); }
  return out.slice(0, 24);
});
const medalSrc = (t: Tier) => `hunt/${t}-128.png`;   // Ames's medals
async function addPrizePicture(t: Tier, e: Event) {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file || prizeUploading.value) return;
  prizeUploading.value = t; error.value = ''; message.value = '';
  try {
    const urls = await backend.uploadAdminImage(file, 'badges');
    const pic = { image_url: urls.fullUrl, thumbnail_url: urls.thumbUrl || urls.fullUrl };
    prizeUploads.value = [pic, ...prizeUploads.value];
    form.value.prize[t].image = pic;
    message.value = `Picture added for ${TIER_WORD[t]}. Save to keep it.`;
  } catch (err: any) { error.value = err?.message || String(err); }
  finally { prizeUploading.value = ''; }
}
onMounted(() => { if (!(backend.specialBadges as any[]).length) void backend.loadSpecialBadges(); });

// ── Try it yourself (Ames 2026-10-21): admins play the hunt to test it ──
const canTry = computed(() => !!editing.value?.id && !!editing.value?.has_view && !!editing.value?.target_count);
function tryIt() {
  const id = editing.value?.id; if (!id) return;
  document.dispatchEvent(new CustomEvent('nge:hunt-test', { detail: { id } }));
}

// ── A hunter's gems, and Count it (Ames 2026-10-21: "a way for admins to manually correct a mistake") ──
const runOf = ref<null | { user_id: string; drops: RunGem[] }>(null);
async function showRun(b: BoardRow) {
  if (runOf.value?.user_id === b.user_id) { runOf.value = null; return; }
  try { runOf.value = await huntCall<{ user_id: string; drops: RunGem[] }>('hunt.run', { id: editing.value?.id, user_id: b.user_id }); }
  catch (e: any) { error.value = e?.message || String(e); }
}
function goToGem(d: RunGem) { if (d.at) goToSoma(d.at.slice(0, 3)); }

// Gems hunters say are on a real problem the answers missed (Ames 2026-10-26): check each, then Count it or Not real.
const reports = ref<Report[]>([]);
async function loadReports(h: AdminHunt) {
  reports.value = [];
  if (!h?.id || (h as any).status !== 'scheduled') return;
  try { reports.value = (await huntCall<{ reports: Report[] }>('hunt.reports', { id: h.id })).reports || []; } catch { /* the list is a help */ }
}
async function countReport(r: Report) {
  await countIt({ user_id: r.user_id } as BoardRow, { id: r.drop_id, at: r.at, hit: false, k: r.k });
}
async function dismissReport(r: Report) {
  const h = editing.value; if (!h?.id || busy.value) return;
  busy.value = 'dismiss'; error.value = ''; message.value = '';
  try {
    reports.value = (await huntCall<{ reports: Report[] }>('hunt.dismiss_report', { id: h.id, user_id: r.user_id, drop_id: r.drop_id })).reports || [];
    message.value = `Not counted: ${r.name}'s report is off the list, and their Hunt box says it was checked.`;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function countIt(b: BoardRow, d: RunGem) {
  const h = editing.value; if (!h?.id || busy.value) return;
  busy.value = 'count'; error.value = ''; message.value = '';
  try {
    const r = await huntCall<any>('hunt.count_it', { id: h.id, user_id: b.user_id, drop_id: d.id });
    busy.value = '';
    await open(r);
    message.value = `Counted: the key has ${r.target_count} places now. ${r.changed} ${r.changed === 1 ? 'run' : 'runs'} changed.${phase.value === 'ended' ? ' Give the awards again to hand out what changed.' : ''}`;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

// A place the key missed, by its coordinates (Ames 2026-10-26: "I want to be able to add coords for missing cut
// or merge and label them as merge or cut"): x, y, z as the coordinate bar shows them, or the crosshair.
const addAt = ref<{ x: number | ''; y: number | ''; z: number | ''; kind: 'cut' | 'merge'; size: number | '' }>({ x: '', y: '', z: '', kind: 'cut', size: '' });
function addFromCrosshair() {
  const p = crosshairXyz();
  if (p) addAt.value = { ...addAt.value, x: p[0], y: p[1], z: p[2] };
}
async function addPlace() {
  const h = editing.value; if (!h?.id || busy.value) return;
  const v = [addAt.value.x, addAt.value.y, addAt.value.z].map(Number);
  error.value = ''; message.value = '';
  if (v.some(n => !Number.isFinite(n)) || [addAt.value.x, addAt.value.y, addAt.value.z].some(n => n === '')) { error.value = 'Give x, y and z, or use the crosshair.'; return; }
  if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(h.dataset)) { error.value = 'Open the Hunt on its dataset first (Open the link above), so the coordinates are its own.'; return; }
  const scales = (window as any).viewer?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) { error.value = 'The viewer is not ready yet. Try again in a moment.'; return; }
  const nm = v.map((n, i) => n * Number(scales[i]) * 1e9);
  busy.value = 'add';
  try {
    const size = Number(addAt.value.size) || 0;
    const r = await huntCall<any>('hunt.add_place', { id: h.id, nm, kind: addAt.value.kind, radius_nm: size > 0 ? size * 500 : 0 });
    busy.value = '';
    await open(r);
    const what = addAt.value.kind === 'merge' ? 'missing extension' : 'merger';
    const after = `${r.changed} ${r.changed === 1 ? 'run' : 'runs'} changed`
      + `${r.laser ? `, and ${r.laser} ${r.laser === 1 ? 'hunter' : 'hunters'} got Laser Eyes` : ''}.${phase.value === 'ended' ? ' Give the awards again to hand out what changed.' : ''}`;
    message.value = r.enlarged ? `Made the ${what} there bigger: ${size} µm across. ${after}` : `Added a ${what}${size ? ` ${size} µm across` : ''}: the key has ${r.target_count} places now. ${after}`;
    addAt.value = { x: '', y: '', z: '', kind: addAt.value.kind, size: '' };
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

// Duplicate (Ames 2026-10-21: "let me duplicate a hunt on the test server for during testing"):
// a draft with the same key, view, cells, words and settings, and no notes or answers.
async function duplicate() {
  const h = editing.value; if (!h?.id || busy.value) return;
  busy.value = 'dup'; error.value = ''; message.value = '';
  try {
    const copy = await huntCall<AdminHunt>('hunt.duplicate', { id: h.id });
    busy.value = '';
    await open(copy);
    message.value = `Copied as "${copy.title}", a draft. Set its times, then schedule it.`;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
</script>

<template>
  <section class="nge-hunts-admin">
    <header class="nge-hunts-head">
      <h3>Hunts</h3>
      <p class="nge-hunts-lead">A timed hunt for mergers and missing extensions: players Ctrl + Click to drop gems, each judged as it lands, until they find them all or run out of gems. Gold, silver and bronze go to the best hunters when it ends.</p>
    </header>

    <p v-if="notInstalled" class="nge-hunts-warn">The Hunt is not set up on the server yet: run <code>supabase-hunts.sql</code> in Supabase, then deploy the <code>ewHunt</code> function.</p>
    <p v-if="error && !notInstalled" ref="errEl" class="nge-hunts-error" role="alert">{{ error }}</p>
    <div v-if="message" ref="msgEl" class="nge-hunts-msg" role="status">
      <span>{{ message }}</span>
      <ul v-if="savedTimes" class="nge-hunts-msg-times">
        <li v-if="savedTimes.announce"><b>Announced</b> {{ whenIso(savedTimes.announce) }}</li>
        <li><b>Starts</b> {{ whenIso(savedTimes.start) }}</li>
        <li><b>Ends</b> {{ whenIso(savedTimes.end) }}</li>
      </ul>
    </div>

    <!-- The list -->
    <template v-if="!editing">
      <button class="nge-hunts-btn nge-hunts-btn--primary" @click="startNew">New Hunt</button>
      <p v-if="loading" class="nge-hunts-muted">Loading…</p>
      <p v-else-if="!list.length && !notInstalled" class="nge-hunts-muted">No Hunts yet.</p>
      <ul class="nge-hunts-list">
        <li v-for="h in list" :key="h.id" @click="open(h)" @keydown.enter="open(h)" tabindex="0">
          <span class="nge-hunts-chip" :class="`nge-hunts-chip--${h.phase}`">{{ PHASE_WORD[h.phase] || h.phase }}</span>
          <span class="nge-hunts-name">{{ h.title }}</span>
          <span v-if="h.admins_only" class="nge-hunts-chip nge-hunts-chip--admins">Admins only</span>
          <span class="nge-hunts-meta">{{ h.target_count }} mergers · {{ h.players }} {{ h.players === 1 ? 'player' : 'players' }}<template v-if="h.start_at"> · {{ local(h.start_at) }}</template></span>
        </li>
      </ul>
    </template>

    <!-- One hunt -->
    <template v-else>
      <button class="nge-hunts-back" @click="close">← All Hunts</button>
      <div class="nge-hunts-title-row">
        <span class="nge-hunts-chip" :class="`nge-hunts-chip--${phase}`">{{ PHASE_WORD[phase] || phase }}</span>
        <!-- The title, changed right here (Ames 2026-10-23: "let me edit here to adjust the title"): the same as Title in 2. The words -->
        <label class="nge-hunts-title-edit" title="Click to change the title">
          <input v-model="form.title" class="nge-hunts-title-input" maxlength="80" placeholder="New Hunt" aria-label="The Hunt's title" />
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M11.2 2.3l2.5 2.5-7.9 7.9-3.1.6.6-3.1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </label>
      </div>

      <!-- Reported by hunters (Ames 2026-10-26): at the top, so a report during a Hunt is seen at once -->
      <fieldset v-if="reports.length" class="nge-hunts-group nge-hunts-reports" :disabled="!!busy">
        <legend>Reported by hunters ({{ reports.length }})</legend>
        <p class="nge-hunts-help">Each hunter says their gem is on a real problem the answers missed. Go there and look: <b>Count it</b> puts it in the key, judges everyone again and gives Laser Eyes; <b>Not real</b> takes it off this list.</p>
        <ul class="nge-hunts-gems">
          <li v-for="r in reports" :key="r.user_id + r.drop_id" class="nge-hunts-gem--miss">
            <span><b>{{ r.name }}</b>: {{ r.k === 'merge' ? 'Extend' : 'Cut' }} gem</span>
            <span class="nge-hunts-muted">{{ (r.at || []).slice(0, 3).map((v) => Math.round(v)).join(', ') }}</span>
            <button class="nge-hunts-btn nge-hunts-btn--small" :disabled="!r.at" title="Move the view to this gem" @click.stop="goToGem({ id: r.drop_id, at: r.at, hit: false, k: r.k })">Go there</button>
            <button class="nge-hunts-btn nge-hunts-btn--small" title="A real error the answers missed: add it to the key, judge everyone again, Laser Eyes" @click.stop="countReport(r)">Count it</button>
            <button class="nge-hunts-btn nge-hunts-btn--small" title="Not a problem the answers missed: off the list" @click.stop="dismissReport(r)">Not real</button>
          </li>
        </ul>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>1. The answer key</legend>
        <p class="nge-hunts-help">Paste a share link of the cell with each place marked by a point: mergers (to cut) in one annotation layer, extensions (to merge) in another. Open it and check the ticks and kinds: the key is read from the screen by itself, again whenever they change. Players start from the same view with every annotation layer taken out, and drop one gem on each merger or extension they find. Branches that run out of the data are no missing extensions: mark those ends in a layer named <b>edge</b> (it is picked up as edges by itself; the volume's own edges count without marking, and players see the cells glow teal there), and an Extend gem there is answered "Edge of the dataset", with no gem used.</p>
        <div class="nge-hunts-row">
          <input v-model="form.link" class="nge-hunts-input" placeholder="https://… #!…" aria-label="View link" />
          <button class="nge-hunts-btn" :disabled="!form.link.trim()" @click="openLink">Open the link</button>
        </div>
        <ul class="nge-hunts-keylayers" aria-label="Layers with the places marked">
          <li v-if="!candidates.length" class="nge-hunts-muted">No annotation layer with points on screen yet.</li>
          <li v-for="c in candidates" :key="c.name" :class="{ 'nge-hunts-keylayer--on': keyPick[c.name]?.on }">
            <label class="nge-hunts-keylayer-name"><input v-model="keyPick[c.name].on" type="checkbox" /> {{ c.name }} <span class="nge-hunts-muted">({{ c.points }} {{ c.points === 1 ? 'point' : 'points' }})</span></label>
            <select v-model="keyPick[c.name].kind" class="nge-hunts-input nge-hunts-keylayer-kind" :aria-label="`What the points in ${c.name} mark`" :disabled="!keyPick[c.name]?.on">
              <option value="cut">mergers (to cut)</option>
              <option value="merge">extensions (to merge)</option>
              <option value="edge">edge (of the dataset, not a problem)</option>
            </select>
          </li>
        </ul>
        <div class="nge-hunts-row">
          <button class="nge-hunts-btn nge-hunts-btn--quiet" :disabled="!picked.length" title="Read the ticked layers from the screen again" @click="autoRead = true; scan(); useScreen()">↻ Read again</button>
        </div>
        <p v-if="!isNew && !read && !editing.edge_count" class="nge-hunts-warnline">No places where the cells run out of the data are saved yet (a copy keeps the key as it was). <b>Open the link</b>, let the cells load in 3D, and save: they are found then.</p>
        <p v-if="!isNew && !read && form.link" class="nge-hunts-help">The saved key is in the link: <b>Open the link</b> to see its places on screen as layers (Mergers, Extensions, edge), change them, and save.</p>
        <p v-if="!isNew && !read" class="nge-hunts-muted">Saved key: {{ editing.target_count }} {{ editing.target_count === 1 ? 'place' : 'places' }}<template v-if="editing.edge_count">, {{ editing.edge_count }} edge {{ editing.edge_count === 1 ? 'spot' : 'spots' }}</template> on {{ editing.cells?.length || 0 }} {{ (editing.cells?.length || 0) === 1 ? 'cell' : 'cells' }}, {{ datasetName(editing.dataset) }}. Read again to replace it<template v-if="editing.players"> (every answer is scored again)</template>.</p>
        <div v-if="cellRows.length" class="nge-hunts-cells">
          <p class="nge-hunts-help"><b>Where players start.</b> A link is often centered on a merger, which would give it away. Move the crosshair to where players should start (the soma is a good place) and press <b>Use the crosshair</b>, or paste x, y, z as the coordinate bar shows them.</p>
          <div class="nge-hunts-cellrow nge-hunts-startrow">
            <span class="nge-hunts-cellid">Start</span>
            <input v-for="(axis, k) in ['x', 'y', 'z']" :key="axis" v-model.number="cellRows[0].soma[k]" type="number" class="nge-hunts-input nge-hunts-xyz" :placeholder="k === 0 ? 'x (or paste x, y, z)' : axis" :aria-label="`Start ${axis}`" @paste="pasteSoma(0, $event)" />
            <button class="nge-hunts-btn nge-hunts-btn--small" title="Fill in where the crosshair is now" @click="useCrosshair(0)">Use the crosshair</button>
          </div>
        </div>
        <p v-if="somaMissing" class="nge-hunts-warnline">No start yet: players would start where the link is centered.</p>
        <p v-else-if="!read && editing.start_on_answer" class="nge-hunts-warnline">The saved start is {{ editing.start_gap_um }} µm from a merger or extension, close enough to give it away. Move the crosshair, use it, and save.</p>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>2. The words</legend>
        <label>Title <input v-model="form.title" class="nge-hunts-input" maxlength="80" placeholder="The Pinky Merger Hunt" /></label>
        <div class="nge-hunts-desc-head">
          <span class="nge-hunts-desc-label">Description</span>
          <span class="nge-hunts-fmt" role="toolbar" aria-label="Format">
            <button type="button" title="Bold" @click="wrapSelection(desc, '**', 'bold')"><b>B</b></button>
            <button type="button" title="Bullets" @click="prefixLines(desc, '• ', 'A point')">• Bullets</button>
            <button type="button" title="Numbers" @click="prefixLines(desc, i => `${i + 1}. `, 'A step')">1. Numbers</button>
          </span>
        </div>
        <textarea ref="descEl" v-model="form.description" class="nge-hunts-input" rows="4" maxlength="1500" aria-label="Description"
                  placeholder="What players are looking for, and any hint. The Hunt box already shows how to play." @paste="pasteFormatted(desc, $event)"></textarea>
        <div v-if="descPreview" class="nge-hunts-desc-preview"><span class="nge-hunts-muted">What players see:</span><div v-html="descPreview"></div></div>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>3. When</legend>
        <p class="nge-hunts-help">Eastern time (ET). Players see each time in their own time zone, named.</p>
        <label class="nge-hunts-check"><input :checked="form.admins_only || ON_TEST_SITE" :disabled="ON_TEST_SITE" type="checkbox" @change="setAdminsOnly" /> <span><b>Only admins</b>: players never see it, and nothing posts in chat.</span></label>
        <p v-if="!form.admins_only && !ON_TEST_SITE" class="nge-hunts-warnline">Scheduled, the notes go to every player's bell and post in chat.</p>
        <div class="nge-hunts-grid">
          <label><span class="nge-hunts-timehead">Announce (ET) <button type="button" class="nge-hunts-nowlink" title="Announce it this minute" @click.prevent="setNow('announce')">Now</button></span><input v-model="form.announce" type="datetime-local" class="nge-hunts-input" /><span class="nge-hunts-when">{{ whenLine(form.announce) || 'no announcement' }}</span></label>
          <label><span class="nge-hunts-timehead">Start (ET) <button type="button" class="nge-hunts-nowlink" title="Start it this minute" @click.prevent="setNow('start')">Now</button></span><input v-model="form.start" type="datetime-local" class="nge-hunts-input" /><span class="nge-hunts-when">{{ whenLine(form.start) }}</span></label>
          <label>End (ET) <input v-model="form.end" type="datetime-local" class="nge-hunts-input" /><span class="nge-hunts-when">{{ whenLine(form.end) }}</span></label>
        </div>
        <label class="nge-hunts-check nge-hunts-answers"><input v-model="form.show_answers" type="checkbox" /> <span><b>Show the answers after the end</b>: players can ring every merger and extension. Untick it to use these cells in another Hunt.</span></label>
        <label class="nge-hunts-resultshours">Results in the top bar for <input v-model.number="form.results_hours" type="number" min="1" max="168" class="nge-hunts-input" placeholder="24" /> hours after the end <span class="nge-hunts-muted">(24 if empty; at most a week)</span></label>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>4. Scoring and prizes</legend>
        <div class="nge-hunts-grid">
          <label>Tolerance (µm) <input v-model.number="form.tolerance_um" type="number" min="0.1" max="100" step="0.5" class="nge-hunts-input" /></label>
          <label>Gems per player <input v-model.number="form.max_points" type="number" min="1" class="nge-hunts-input" :placeholder="defaultsFor ? `auto: ${defaultsFor.points}` : 'auto'" /></label>
        </div>
        <p class="nge-hunts-help">A gem finds a problem of its kind within the tolerance. Each player has <b>Gems per player</b> gems, one run: their Hunt ends when they find them all or the gems run out. Left empty: the problems and half again (at least 2 spare), so 30 for 20 problems.</p>
        <p class="nge-hunts-help"><b>The medals:</b> for each, the problems to find and the most gems used. Every hunter who reaches a medal wins it, so several can win Gold. Left empty: Gold for all of them, using the problems and a third more in gems; Silver two thirds and Bronze one third, with no gem limit. The Speed award goes to the fastest to find them all, or, if nobody does, the fastest of those who found the most. Medals are revealed at the end.</p>
        <div class="nge-hunts-grid">
          <div v-for="t in TIERS" :key="t" class="nge-hunts-tierbox">
            <span class="nge-hunts-tierword">{{ TIER_WORD[t] }}</span>
            <label>find at least <input v-model.number="form.tiers[t]" type="number" min="1" class="nge-hunts-input" :placeholder="defaultsFor ? `auto: ${defaultsFor[t]}` : 'auto'" /></label>
            <label>using at most <input v-model.number="form.tierGems[t]" type="number" min="1" class="nge-hunts-input" :placeholder="t === 'gold' && defaultsFor ? `auto: ${defaultsFor.goldGems} gems` : 'any gems'" /></label>
          </div>
        </div>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>5. The Achievements</legend>
        <p class="nge-hunts-help">What each medal gives. Either an Achievement made for this Hunt, named for it, with the game's medal or a picture you add; or one of the special Achievements you made in the Special Badges tab.</p>
        <div v-for="t in TIERS" :key="t" class="nge-hunts-prize">
          <div class="nge-hunts-prize-head">
            <span class="nge-hunts-medal" :class="`nge-hunts-medal--${t}`">{{ TIER_WORD[t] }}</span>
            <select v-model="form.prize[t].mode" class="nge-hunts-input nge-hunts-prize-mode" :aria-label="`${TIER_WORD[t]} Achievement`">
              <option value="own">Made for this Hunt: {{ (form.title || 'This Hunt') + ': ' + TIER_WORD[t] }}</option>
              <option value="badge">A special Achievement you made</option>
            </select>
          </div>
          <div v-if="form.prize[t].mode === 'own'" class="nge-hunts-pics" role="radiogroup" :aria-label="`Picture for ${TIER_WORD[t]}`">
            <button class="nge-hunts-pic" role="radio" :aria-checked="!form.prize[t].image" :class="{ 'nge-hunts-pic--on': !form.prize[t].image }" title="The game's medal" @click="form.prize[t].image = null">
              <img :src="medalSrc(t)" :alt="`The game's ${TIER_WORD[t]} medal`" />
            </button>
            <button v-for="(p, i) in prizeLibrary" :key="p.image_url" class="nge-hunts-pic" role="radio" :aria-checked="form.prize[t].image?.image_url === p.image_url"
                    :class="{ 'nge-hunts-pic--on': form.prize[t].image?.image_url === p.image_url }" :title="`Picture ${i + 1}`" @click="form.prize[t].image = p">
              <img :src="p.thumbnail_url" :alt="`Picture ${i + 1}`" loading="lazy" />
            </button>
            <label class="nge-hunts-pic nge-hunts-pic--add" :class="{ 'nge-hunts-pic--busy': prizeUploading === t }">
              {{ prizeUploading === t ? 'Adding…' : '+ Add' }}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="nge-hunts-file" :disabled="!!prizeUploading" @change="addPrizePicture(t, $event)" />
            </label>
          </div>
          <div v-else class="nge-hunts-row">
            <img v-if="specialById(form.prize[t].badge_id)" class="nge-hunts-special-img" :src="specialById(form.prize[t].badge_id).thumbnail_url || specialById(form.prize[t].badge_id).image_url" alt="" />
            <select v-model="form.prize[t].badge_id" class="nge-hunts-input" :aria-label="`Special Achievement for ${TIER_WORD[t]}`">
              <option value="">{{ specials.length ? 'Pick one…' : 'None made yet: make one in the Special Badges tab' }}</option>
              <option v-for="b in specials" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <p v-if="form.prize[t].mode === 'badge' && specialById(form.prize[t].badge_id)?.description" class="nge-hunts-muted nge-hunts-special-desc">{{ specialById(form.prize[t].badge_id).description }}</p>
          <p v-if="form.prize[t].mode === 'badge' && !form.prize[t].badge_id" class="nge-hunts-muted">With none picked, {{ TIER_WORD[t] }} gives the Achievement made for this Hunt.</p>
        </div>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>6. Notifications and their pictures</legend>
        <p class="nge-hunts-help">Three notes go to every player at their times. Give each a picture, or share one: any picture added here, or used in another Hunt, can be picked again for any note.</p>
        <div v-for="k in NOTE_KINDS" :key="k" class="nge-hunts-note">
          <div class="nge-hunts-note-head">
            <span class="nge-hunts-note-word">{{ NOTE_WORD[k] }}</span>
            <span v-if="noteSaved(k)" :class="noteSaved(k)?.sent ? 'nge-hunts-sent' : 'nge-hunts-due'">{{ noteSaved(k)?.sent ? 'sent' : 'goes out' }} {{ local(noteSaved(k)?.send_at) }}</span>
            <span v-else-if="k === 'announce' && !form.announce" class="nge-hunts-muted">no announce time, so no announcement</span>
            <span v-else class="nge-hunts-muted">{{ noteWhen(k) }}</span>
            <button class="nge-hunts-btn nge-hunts-btn--quiet nge-hunts-btn--small" :disabled="!form.start || !form.end" @click="previewNote(k)">Preview</button>
          </div>
          <div class="nge-hunts-pics" role="radiogroup" :aria-label="`Picture for ${NOTE_WORD[k]}`">
            <button class="nge-hunts-pic nge-hunts-pic--none" role="radio" :aria-checked="!form.images[k]" :class="{ 'nge-hunts-pic--on': !form.images[k] }" title="The Hunt's gold medal" @click="form.images[k] = null"><img src="hunt/gold-128.png" alt="Hunt default" /><span class="nge-hunts-pic-tag">Default</span></button>
            <button v-for="(p, i) in library" :key="p.image_url" class="nge-hunts-pic" role="radio" :aria-checked="form.images[k]?.image_url === p.image_url"
                    :class="{ 'nge-hunts-pic--on': form.images[k]?.image_url === p.image_url }" :title="`Picture ${i + 1}`" @click="form.images[k] = p">
              <img :src="p.thumbnail_url" :alt="`Picture ${i + 1}`" loading="lazy" />
            </button>
            <label class="nge-hunts-pic nge-hunts-pic--add" :class="{ 'nge-hunts-pic--busy': uploading === k }">
              {{ uploading === k ? 'Adding…' : '+ Add' }}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="nge-hunts-file" :disabled="!!uploading" @change="addPicture(k, $event)" />
            </label>
          </div>
          <button v-if="form.images[k] && NOTE_KINDS.some(o => form.images[o]?.image_url !== form.images[k]?.image_url)" class="nge-hunts-link" @click="sameForAll(k)">Use this picture for all three</button>
        </div>
        <p class="nge-hunts-help">PNG, JPEG, WebP or GIF, up to 3 MB. Players see the small version in the bell list and the full picture when they open the note.<template v-if="scheduled"> A changed picture reaches a note even after it was sent.</template></p>
      </fieldset>

      <div class="nge-hunts-actions">
        <button class="nge-hunts-btn" :disabled="!!busy || keyNeeded || !form.title.trim()" @click="save('draft')" v-if="!scheduled">Save draft</button>
        <button class="nge-hunts-btn nge-hunts-btn--primary" :disabled="!!busy || keyNeeded || !form.title.trim()" @click="save(scheduled ? undefined : 'scheduled')">
          {{ busy === 'save' ? 'Saving…' : scheduled ? 'Save changes' : 'Schedule' }}
        </button>
        <span v-if="keyNeeded" class="nge-hunts-muted">Read the answer key first.</span>
      </div>

      <fieldset v-if="!isNew" class="nge-hunts-group">
        <legend>Try it yourself, or copy it</legend>
        <p class="nge-hunts-help">Play this Hunt as players will, at any time, even as a draft. Only you see it. Your gems are scored against the real answer key and you see which mergers they found, but no answer is kept or awarded. You can also play a running Hunt for real, like anyone.</p>
        <div class="nge-hunts-actions">
          <button class="nge-hunts-btn" :disabled="!!busy || !canTry || !!read" @click="tryIt">Try it yourself</button>
          <button class="nge-hunts-btn nge-hunts-btn--quiet" :disabled="!!busy" title="A draft copy: the same key, view, cells, words and settings" @click="duplicate">{{ busy === 'dup' ? 'Copying…' : 'Duplicate' }}</button>
          <span v-if="read" class="nge-hunts-muted">Save first: a test uses the saved key and view.</span>
          <span v-else-if="!canTry" class="nge-hunts-muted">Read the answer key and save first.</span>
        </div>
      </fieldset>

      <!-- Notes and controls for a scheduled hunt -->
      <fieldset v-if="scheduled" class="nge-hunts-group">
        <legend>Run it</legend>
        <p class="nge-hunts-help">The notes go out on their own at their times. To move things along early:</p>
        <div class="nge-hunts-actions">
          <button v-if="phase === 'announced'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'announce'">Announce now</button>
          <button v-if="phase === 'announced'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'start'">Start now</button>
          <button v-if="phase === 'live'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'end'">End now and give the awards</button>
          <button v-if="phase === 'ended'" class="nge-hunts-btn" :disabled="!!busy" @click="act('hunt.award')">Give the awards again</button>
          <button v-if="editing.players" class="nge-hunts-btn nge-hunts-btn--quiet" :disabled="!!busy" @click="act('hunt.rescore')">Score again</button>
          <button v-if="phase !== 'ended'" class="nge-hunts-btn nge-hunts-btn--danger" :disabled="!!busy" @click="asking = 'cancel'">Cancel the Hunt</button>
        </div>
      </fieldset>
      <div v-else-if="!isNew" class="nge-hunts-actions">
        <button class="nge-hunts-btn nge-hunts-btn--danger" :disabled="!!busy" @click="asking = 'delete'">Delete</button>
      </div>

      <!-- A place the key missed, by its coordinates (Ames 2026-10-26) -->
      <fieldset v-if="!isNew && scheduled" class="nge-hunts-group nge-hunts-addplace" :disabled="!!busy">
        <legend>A place the key missed</legend>
        <p class="nge-hunts-help">A real merger or missing extension the key does not have: put the crosshair on it (or type x, y, z as the coordinate bar shows them), say which it is, and add it. For a wide face, give it a size: a gem anywhere in it counts, and at a place the key has already, that place is made bigger. (In the key layers themselves, an ellipsoid, line or box works the same way.) Everyone is judged again, and each hunter whose gem finds it gets <b>Laser Eyes</b>. A hunter's own gem on it can also be counted below with <b>Count it</b>.</p>
        <div class="nge-hunts-addrow">
          <input v-model.number="addAt.x" type="number" class="nge-hunts-input" placeholder="x" aria-label="x" />
          <input v-model.number="addAt.y" type="number" class="nge-hunts-input" placeholder="y" aria-label="y" />
          <input v-model.number="addAt.z" type="number" class="nge-hunts-input" placeholder="z" aria-label="z" />
          <button class="nge-hunts-btn nge-hunts-btn--small" title="Fill in where the crosshair is now" @click="addFromCrosshair">Use the crosshair</button>
        </div>
        <div class="nge-hunts-addrow">
          <label class="nge-hunts-addsize" title="For a wide face or a long stretch: a gem anywhere within this ball counts. At a place the key has already, it makes that place this big.">Size <input v-model.number="addAt.size" type="number" min="0" max="200" step="0.5" class="nge-hunts-input" placeholder="a point" /> µm across</label>
          <select v-model="addAt.kind" class="nge-hunts-input" aria-label="Which kind">
            <option value="cut">Merger (Cut)</option>
            <option value="merge">Missing extension (Extend)</option>
          </select>
          <button class="nge-hunts-btn" :disabled="!!busy" @click="addPlace">{{ busy === 'add' ? 'Adding…' : 'Add to the key' }}</button>
        </div>
      </fieldset>

      <!-- Results -->
      <fieldset v-if="board.length" class="nge-hunts-group">
        <legend>Hunters ({{ board.length }})</legend>
        <p class="nge-hunts-help">Click a hunter to see their gems. A miss on a real error the key missed: <b>Count it</b> adds that spot to the key and judges everyone again. After the end, Give the awards again.</p>
        <table class="nge-hunts-board">
          <thead><tr><th>#</th><th>Player</th><th>Found</th><th>Gems</th><th>{{ phase === 'ended' ? 'Medal' : 'Medal so far' }}</th></tr></thead>
          <tbody>
            <template v-for="b in board" :key="b.rank">
              <tr class="nge-hunts-hunter" :class="{ 'nge-hunts-hunter--open': runOf?.user_id === b.user_id }" tabindex="0" @click="showRun(b)" @keydown.enter="showRun(b)">
                <td>{{ b.rank }}</td><td>{{ b.name }}</td><td>{{ b.found }} / {{ editing.target_count }}</td><td>{{ b.gems }}</td><td>{{ b.tier ? TIER_WORD[b.tier] : '' }}</td>
              </tr>
              <tr v-if="runOf?.user_id === b.user_id"><td colspan="5">
                <p v-if="!runOf.drops.length" class="nge-hunts-muted">No gems yet.</p>
                <ul class="nge-hunts-gems">
                  <li v-for="(d, i) in runOf.drops" :key="d.id" :class="d.hit ? 'nge-hunts-gem--hit' : 'nge-hunts-gem--miss'">
                    <span class="nge-hunts-gem-n">{{ i + 1 }}</span>
                    <span>{{ d.k === 'merge' ? 'Extend' : 'Cut' }} gem · {{ d.hit ? 'found' : 'missed' }}</span>
                    <span class="nge-hunts-muted">{{ (d.at || []).slice(0, 3).map((v) => Math.round(v)).join(', ') }}</span>
                    <button class="nge-hunts-btn nge-hunts-btn--small" :disabled="!d.at" title="Move the view to this gem" @click.stop="goToGem(d)">Go there</button>
                    <button v-if="!d.hit" class="nge-hunts-btn nge-hunts-btn--small" :disabled="!!busy" title="A real error the key missed: add it to the key, and judge everyone again" @click.stop="countIt(b, d)">Count it</button>
                  </li>
                </ul>
              </td></tr>
            </template>
          </tbody>
        </table>
      </fieldset>

      <ConfirmDialog v-if="asking === 'announce'" title="Announce the Hunt now?" text="The announcement goes to every player now, instead of at its time." yes="Announce now" @yes="act('hunt.now', { kind: 'announce' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'start'" title="Start the Hunt now?" text="It starts for every player now, and the start notification goes out." yes="Start now" @yes="act('hunt.now', { kind: 'start' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'end'" title="End the Hunt now?" text="Answers stop now. The end notification goes out and the gold, silver and bronze Achievements are given." yes="End and award" @yes="act('hunt.now', { kind: 'end' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'cancel'" title="Cancel the Hunt?" text="Players stop seeing it. Notifications not sent yet are taken back; any already sent stay." yes="Cancel the Hunt" @yes="act('hunt.cancel')" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'delete'" title="Delete this Hunt?" text="The Hunt, its key and every answer are deleted for good." yes="Delete for good" @yes="act('hunt.delete')" @no="asking = ''" />
    </template>
  </section>
</template>

<style scoped>
.nge-hunts-admin { display: flex; flex-direction: column; gap: 12px; color: #dbe7f7; font-size: 14px; }
.nge-hunts-head h3 { margin: 0; font: 600 16px 'Inter', sans-serif; color: #fff; }
.nge-hunts-lead, .nge-hunts-help { margin: 4px 0 0; color: #a9bbd3; font-size: 13px; line-height: 1.45; }
.nge-hunts-warn { padding: 8px 10px; border-radius: 8px; background: rgba(245, 209, 66, 0.1); border: 1px solid rgba(245, 209, 66, 0.45); }
.nge-hunts-error { color: #ff9c9c; margin: 0; }
.nge-hunts-msg { color: #b8f5cf; margin: 0; }
.nge-hunts-muted { color: #8fa3bf; margin: 0; }
.nge-hunts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nge-hunts-list li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; cursor: pointer; background: rgba(90, 170, 255, 0.05); border: 1px solid rgba(90, 170, 255, 0.18); }
.nge-hunts-list li:hover, .nge-hunts-list li:focus-visible { background: rgba(90, 170, 255, 0.12); }
.nge-hunts-name { flex: 1; min-width: 0; color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-hunts-meta { color: #8fa3bf; font-size: 12.5px; white-space: nowrap; }
.nge-hunts-chip { flex: none; padding: 1px 8px; border-radius: 999px; font: 600 11px 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; background: rgba(169, 187, 211, 0.15); color: #cfdcef; }
.nge-hunts-chip--announced { background: rgba(90, 170, 255, 0.18); color: #9fd0ff; }
.nge-hunts-chip--live { background: rgba(245, 209, 66, 0.2); color: #f8e08a; }
.nge-hunts-chip--ended { background: rgba(124, 255, 178, 0.14); color: #b8f5cf; }
.nge-hunts-chip--cancelled { background: rgba(255, 120, 120, 0.14); color: #ffb3b3; }
.nge-hunts-back { align-self: flex-start; background: none; border: none; color: #9fd0ff; cursor: pointer; padding: 0; font-size: 13px; }
.nge-hunts-title-row { display: flex; gap: 10px; align-items: center; color: #fff; font-size: 16px; }
.nge-hunts-title-edit { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: rgba(159, 208, 255, 0.45); cursor: text; }
.nge-hunts-title-input { flex: 0 1 auto; field-sizing: content; min-width: 6ch; max-width: 100%; padding: 2px 4px; margin-left: -4px; border: none; border-bottom: 1px dashed transparent; border-radius: 4px 4px 0 0; background: transparent; color: #fff; font: 700 16px 'Inter', sans-serif; outline: none; transition: border-color 0.15s, background 0.15s; }
.nge-hunts-title-edit:hover .nge-hunts-title-input { border-bottom-color: rgba(90, 170, 255, 0.45); }
.nge-hunts-title-edit:hover, .nge-hunts-title-edit:focus-within { color: #9fd0ff; }
.nge-hunts-title-input:focus { border-bottom: 1px solid #9fd0ff; background: rgba(90, 170, 255, 0.08); }
.nge-hunts-title-input::placeholder { color: rgba(230, 240, 255, 0.4); }
.nge-hunts-group { min-width: 0; max-width: 100%; box-sizing: border-box; border: 1px solid rgba(90, 170, 255, 0.2); border-radius: 10px; padding: 10px 12px 12px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.nge-hunts-group legend { padding: 0 6px; color: #9fd0ff; font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; }
.nge-hunts-group label { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: #a9bbd3; }
.nge-hunts-row { display: flex; gap: 8px; align-items: center; }
.nge-hunts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.nge-hunts-input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.3); color: #e6f0ff; font: 13.5px 'Inter', sans-serif; }
.nge-hunts-row .nge-hunts-input { flex: 1; }
.nge-hunts-btn { flex: none; padding: 6px 12px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.12); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; font: 600 13px 'Inter', sans-serif; }
.nge-hunts-btn:hover:not(:disabled), .nge-hunts-btn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hunts-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hunts-btn--primary { background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.65); color: #fff3c4; align-self: flex-start; }
.nge-hunts-btn--primary:hover:not(:disabled) { background: rgba(245, 209, 66, 0.28); }
.nge-hunts-btn--quiet { background: none; }
.nge-hunts-btn--danger { border-color: rgba(255, 120, 120, 0.5); color: #ffc4c4; background: rgba(255, 120, 120, 0.08); }
.nge-hunts-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.nge-hunts-keylayers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.nge-hunts-keylayers li { display: flex; gap: 10px; align-items: center; padding: 4px 6px; border-radius: 6px; }
.nge-hunts-keylayer--on { background: rgba(245, 209, 66, 0.07); }
.nge-hunts-keylayer-name { flex: 1; min-width: 0; display: flex !important; flex-direction: row !important; gap: 6px; align-items: center; color: #e6f0ff !important; font-size: 13px !important; }
.nge-hunts-keylayer-kind { width: 210px; flex: none; }
.nge-hunts-check { display: flex !important; flex-direction: row !important; gap: 8px; align-items: flex-start; color: #cfdcef !important; font-size: 13px !important; line-height: 1.4; }
.nge-hunts-check input { margin-top: 3px; }
.nge-hunts-cells { display: flex; flex-direction: column; gap: 6px; }
.nge-hunts-cellrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.nge-hunts-cellid { min-width: 210px; color: #e6f0ff; font-size: 13px; }
.nge-hunts-xyz { width: 118px !important; flex: none; }
.nge-hunts-desc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nge-hunts-desc-label { font-size: 12.5px; color: #a9bbd3; }
.nge-hunts-fmt { display: flex; gap: 4px; }
.nge-hunts-fmt button { padding: 2px 8px; border-radius: 6px; cursor: pointer; background: rgba(90, 170, 255, 0.1); border: 1px solid rgba(90, 170, 255, 0.35); color: #cfe4ff; font: 600 12px 'Inter', sans-serif; }
.nge-hunts-fmt button:hover, .nge-hunts-fmt button:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hunts-desc-preview { padding: 8px 10px; border-radius: 8px; background: rgba(4, 8, 18, 0.6); border: 1px dashed rgba(90, 170, 255, 0.3); font-size: 13.5px; }
.nge-hunts-desc-preview :deep(p) { margin: 4px 0; }
.nge-hunts-desc-preview :deep(ol), .nge-hunts-desc-preview :deep(ul) { margin: 4px 0; padding-left: 20px; }
.nge-hunts-hunter { cursor: pointer; }
.nge-hunts-hunter:hover td, .nge-hunts-hunter--open td { background: rgba(90, 170, 255, 0.08); }
.nge-hunts-gems { list-style: none; margin: 4px 0 6px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.nge-hunts-gems li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.nge-hunts-gem-n { width: 18px; color: #8fa3bf; }
.nge-hunts-gem--hit span:nth-child(2) { color: #f8e08a; }
.nge-hunts-gem--miss span:nth-child(2) { color: #c9d2e0; }
.nge-hunts-tierbox { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 8px; background: rgba(90, 170, 255, 0.04); border: 1px solid rgba(90, 170, 255, 0.15); }
.nge-hunts-tierword { font-weight: 700; color: #fff; font-size: 13px; }
.nge-hunts-when { color: #9fd0ff; font-size: 12px; }
.nge-hunts-answers { margin-top: 8px; }
.nge-hunts-reports { border-color: rgba(95, 227, 245, 0.55); box-shadow: 0 0 14px rgba(95, 227, 245, 0.12); }
.nge-hunts-addrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.nge-hunts-addrow input.nge-hunts-input { width: 92px; }
.nge-hunts-addsize { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: #cfdcef; white-space: nowrap; }
.nge-hunts-addsize input.nge-hunts-input { width: 74px; }
.nge-hunts-addsize, .nge-hunts-addsize input { text-transform: none; }
.nge-hunts-addrow select.nge-hunts-input { width: auto; flex: 1; min-width: 180px; }
.nge-hunts-resultshours { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.nge-hunts-resultshours .nge-hunts-input { width: 72px; }
.nge-hunts-startrow { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; }
.nge-hunts-startrow .nge-hunts-xyz { flex: 1 1 0; min-width: 0; }
.nge-hunts-startrow .nge-hunts-btn { flex: none; white-space: nowrap; }
.nge-hunts-msg-times { margin: 6px 0 0; padding-left: 18px; font-size: 13px; }
.nge-hunts-msg-times b { display: inline-block; min-width: 76px; }
.nge-hunts-timehead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.nge-hunts-nowlink { padding: 0 2px; background: none; border: none; cursor: pointer; color: #9fd0ff; font: 600 11.5px 'Inter', sans-serif; text-decoration: underline; text-underline-offset: 2px; }
.nge-hunts-nowlink:hover, .nge-hunts-nowlink:focus-visible { color: #fff; }
.nge-hunts-warnline { margin: 0; color: #f8e08a; font-size: 12.5px; }
.nge-hunts-chip--admins { background: rgba(90, 170, 255, 0.18); color: #9fd0ff; }
.nge-hunts-prize { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px solid rgba(90, 170, 255, 0.12); }
.nge-hunts-prize-head { display: flex; gap: 10px; align-items: center; }
.nge-hunts-prize-mode { flex: 1; }
.nge-hunts-medal { flex: none; width: 64px; text-align: center; padding: 2px 0; border-radius: 999px; font: 700 11px 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
.nge-hunts-medal--gold { background: rgba(245, 209, 66, 0.2); color: #f8e08a; border: 1px solid rgba(245, 209, 66, 0.6); }
.nge-hunts-medal--silver { background: rgba(201, 214, 229, 0.16); color: #e3ebf5; border: 1px solid rgba(201, 214, 229, 0.55); }
.nge-hunts-medal--bronze { background: rgba(179, 144, 115, 0.2); color: #e2c9b1; border: 1px solid rgba(179, 144, 115, 0.6); }
.nge-hunts-special-img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; flex: none; border: 1px solid rgba(90, 170, 255, 0.3); }
.nge-hunts-special-desc { font-size: 12.5px; }
.nge-hunts-note { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px solid rgba(90, 170, 255, 0.12); }
.nge-hunts-note-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.nge-hunts-note-word { min-width: 150px; color: #fff; font-weight: 600; }
.nge-hunts-note-head .nge-hunts-btn--small { margin-left: auto; }
.nge-hunts-btn--small { padding: 3px 10px; font-size: 12px; }
.nge-hunts-pics { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-hunts-pic { position: relative; width: 56px; height: 56px; padding: 0; border-radius: 8px; overflow: hidden; cursor: pointer; background: rgba(4, 8, 18, 0.8);
  border: 2px solid rgba(90, 170, 255, 0.25); color: #a9bbd3; font: 600 11px 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; text-align: center; }
.nge-hunts-pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nge-hunts-pic:hover, .nge-hunts-pic:focus-visible { border-color: rgba(90, 170, 255, 0.7); }
.nge-hunts-pic--on { border-color: #f5d142; box-shadow: 0 0 0 2px rgba(245, 209, 66, 0.25); }
.nge-hunts-pic--none { line-height: 1.15; }
.nge-hunts-pic--none img { padding: 4px 4px 12px; object-fit: contain; }
.nge-hunts-pic-tag { position: absolute; left: 0; right: 0; bottom: 1px; font-size: 9px; text-align: center; color: #cfe4ff; }
.nge-hunts-pic--add { border-style: dashed; color: #9fd0ff; }
.nge-hunts-pic--busy { opacity: 0.6; cursor: progress; }
.nge-hunts-file { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.nge-hunts-link { align-self: flex-start; background: none; border: none; padding: 0; color: #9fd0ff; cursor: pointer; font-size: 12.5px; text-decoration: underline; }
.nge-hunts-sent { color: #b8f5cf; }
.nge-hunts-due { color: #9fd0ff; }
.nge-hunts-board { border-collapse: collapse; width: 100%; font-size: 13px; }
.nge-hunts-board th, .nge-hunts-board td { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(90, 170, 255, 0.12); }
.nge-hunts-board th { color: #8fa3bf; font-weight: 600; }
</style>
