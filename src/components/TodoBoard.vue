<script setup lang="ts">
/**
 * TodoBoard.vue
 * The admins' own To do board (Ames 2026-10-19: "I want this to live in
 * ToDo, not in the bug report world. It's more for our own planning"). Lists
 * To do, Doing and Done; drag cards along and between them. A card has notes,
 * a checklist, a size, an owner and comments, and "@" tags an admin: they get
 * the bell in Pyr and a Slack ping (functions/todos.js).
 *
 * Reads once when opened (todo.list); every change writes only its own card.
 * It lives on the triage page ("?triage=board&todo"), where it is opened from
 * the board's header, the Admin Hub's "To do" tab, or a tag's link.
 */
import { ref, shallowRef, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { secureWrite } from '../secure_write';
import { secureUpload } from '../secure_upload';
import { renderSafeMarkdown } from '../util/safe_markdown';
import { useProofreadingBackendStore } from '../store';
import imgNurroHome from '../images/nurro-at-home600.png';
import imgNurroBravo from '../images/bravo-nurro.png';
import imgNurroWhere from '../images/wheres-nurro.png';

const props = defineProps<{ light?: boolean; focusId?: string | null; reportNumbers?: Record<string, number>; standalone?: boolean }>();
const emit = defineEmits<{ (e: 'back'): void }>();

type ListKey = 'todo' | 'doing' | 'done';
type Size = 'S' | 'M' | 'L';
interface Card {
  id: string; title: string; notes: string; list: ListKey; rank: number; size: Size | null;
  owner_id: string | null; checklist: { text: string; done: boolean }[];
  comments: { by: string; text: string; at: string }[];
  triage_id: string | null; created_by: string | null; created_at: string; updated_at: string; done_at: string | null;
  // Optional (supabase-admin-todos-fields.sql).
  links?: Link[]; status?: string; due_on?: string | null; images?: string[];
}
interface Person { id: string; name: string }

const LISTS: { key: ListKey; title: string; hint: string; empty: string }[] = [
  { key: 'todo', title: 'To do', hint: 'What we mean to do', empty: 'Nothing waiting.' },
  { key: 'doing', title: 'Doing', hint: 'Someone is on it', empty: 'Nothing under way.' },
  { key: 'done', title: 'Done', hint: 'Finished', empty: 'Nothing finished yet.' },
];
const SIZE_WORDS: Record<Size, string> = { S: 'Small, an hour or so', M: 'Medium, a session or two', L: 'Large, days' };
const SIZES: Size[] = ['S', 'M', 'L'];
const DONE_DAYS = 14;

const cards = ref<Card[]>([]);
const people = ref<Person[]>([]);
const loading = ref(true);
const error = ref('');
const notInstalled = ref(false);
const showAllDone = ref(false);
const openId = ref<string | null>(props.focusId || null);
const busy = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await secureWrite<any>('todo.list');
    if (data?.installed === false) { notInstalled.value = true; return; }
    cards.value = data.cards || [];
    people.value = data.people || [];
    if (pendingFocus) {
      const c = cards.value.find(x => x.id === pendingFocus);
      pendingFocus = null;
      if (c) openUp(c);
    }
    if (openId.value && !cards.value.some(c => c.id === openId.value)) openId.value = null;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const nameOf = (id: string | null) => people.value.find(p => p.id === id)?.name || '';
const initialOf = (id: string | null) => (nameOf(id) || '?').slice(0, 1).toUpperCase();
const doneOld = (c: Card) => c.list === 'done' && !!c.done_at && Date.now() - Date.parse(c.done_at) > DONE_DAYS * 864e5;
const columns = computed(() => LISTS.map(l => {
  const byDue = (a: Card, b: Card) => (a.due_on || '9999').localeCompare(b.due_on || '9999') || a.rank - b.rank;
  const all = cards.value.filter(c => c.list === l.key && (!mineOnly.value || isMine(c))).sort(l.key === 'todo' && todoByDue.value ? byDue : (a, b) => a.rank - b.rank);
  const rows = l.key === 'done' && !showAllDone.value ? all.filter(c => !doneOld(c)) : all;
  return { ...l, rows, hidden: all.length - rows.length };
}));
const sizeSummary = computed(() => {
  const todo = cards.value.filter(c => c.list === 'todo');
  return SIZES.map(s => ({ s, n: todo.filter(c => c.size === s).length })).filter(x => x.n);
});
const openCard = computed(() => cards.value.find(c => c.id === openId.value) || null);
const checkCount = (c: Card) => ({ done: c.checklist.filter(i => i.done).length, all: c.checklist.length });
const reportHref = (id: string) => `${window.location.origin}${window.location.pathname}?triage=board&report=${id}`;
const reportLabel = (id: string) => (props.reportNumbers?.[id] ? `Report #${props.reportNumbers[id]}` : 'From a report');
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ── @ tags ──
// A tag is "@" and the person's Pyr name, picked from a list as you type.
// Only names newly added to a text tag anyone, so editing old notes never
// pings people twice.
// An @ tag is the person's full Pyr name (the picker writes that) or just
// their first name, typed by hand, any case (Ames 2026-10-22: "@Marissa" and
// "@Celia" typed in the notes tagged nobody).
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// What the admins call each other, beside their Pyr names (Ames
// 2026-10-22: Marissa's Pyr name is "M Sorek", so "@Mar" found no one).
// The same people functions/todos.js pings in Slack.
const NICKNAMES: [RegExp, string[]][] = [
  [/^(amy|ames)\b|^amy/i, ['Amy', 'Ames']],
  [/^celia/i, ['Celia']],
  [/^(marissa|m sorek|sorek)/i, ['Marissa', 'Sorek']],
];
function namesOf(p: Person): string[] {
  const full = String(p.name || '').trim();
  if (!full) return [];
  const out = [full, full.split(/\s+/)[0]];
  for (const [re, nick] of NICKNAMES) if (re.test(full)) out.push(...nick);
  // A one letter first name ("M Sorek") is too easy to type by chance.
  return [...new Set(out)].filter(n => n.length > 1);
}
const tagsIn = (text: string) => people.value.filter(p => {
  const names = namesOf(p);
  if (!names.length) return false;
  const re = new RegExp(`(^|[^\\w@])@(${names.map(escapeRe).join('|')})(?![\\w])`, 'i');
  return re.test(text);
}).map(p => p.id);
const newTags = (before: string, after: string) => { const old = new Set(tagsIn(before)); return tagsIn(after).filter(id => !old.has(id)); };
/** This board's own address, to keep or share (Ames 2026-10-22). */
const boardLink = `${window.location.origin}${window.location.pathname}?triage=board&todo`;
/** One card's own address: opens the board on that card (Ames 2026-10-23). */
const cardLink = (c: Card) => `${boardLink}=${c.id}`;
const linkCopied = ref<string | null>(null);
async function copyCardLink(c: Card) {
  const url = cardLink(c);
  try { await navigator.clipboard.writeText(url); linkCopied.value = c.id; setTimeout(() => { linkCopied.value = null; }, 1600); }
  catch { window.prompt('The link to this card:', url); }
}
// ── People: colors, checklist owners, waiting on, Mine (Ames 2026-10-22) ──
const PERSON_COLORS = ['#4f8cff', '#2ec4b6', '#f5c542', '#ff6fae', '#38bdf8', '#7c9cff', '#14b8a6'];
const colorOf = (id: string | null | undefined) => {
  const i = people.value.findIndex(p => p.id === id);
  return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length];
};
const firstName = (name: string) => {
  for (const [re, nick] of NICKNAMES) if (re.test(name)) return nick[0];
  return String(name || '').split(/\s+/)[0];
};
/** Whose a checklist item is: the first admin tagged in it. */
function itemOwner(text: string): Person | null {
  const ids = tagsIn(text);
  return ids.length ? people.value.find(p => p.id === ids[0]) || null : null;
}
const itemName = (text: string) => itemOwner(text)?.name || '';
const itemColor = (text: string) => colorOf(itemOwner(text)?.id);
/** Ticks per person, for items that have an owner. */
function perPerson(c: Card): { id: string; name: string; done: number; all: number }[] {
  const out = new Map<string, { id: string; name: string; done: number; all: number }>();
  for (const it of c.checklist) {
    const p = itemOwner(it.text);
    if (!p) continue;
    const row = out.get(p.id) || { id: p.id, name: p.name, done: 0, all: 0 };
    row.all++; if (it.done) row.done++;
    out.set(p.id, row);
  }
  return [...out.values()];
}
/** Who still has items to tick, while the card is not done. */
const waitingOn = (c: Card) => c.list === 'done' ? [] : perPerson(c).filter(r => r.done < r.all);
/** You, among the board's people: by your Pyr name, or a nickname. */
const backend: any = useProofreadingBackendStore();
const myId = computed(() => {
  const me = String(backend.userName || '').trim().toLowerCase();
  const mail = String(backend.userEmail || '').toLowerCase();
  if (!me && !mail) return null;
  const hit = people.value.find(p => p.name.toLowerCase() === me)
    || people.value.find(p => namesOf(p).some(n => n.toLowerCase() === me.split(/\s+/)[0] || (mail && mail.startsWith(n.toLowerCase()))));
  return hit?.id || null;
});
function isMine(c: Card): boolean {
  const id = myId.value;
  if (!id) return true;
  if (c.owner_id === id) return true;
  if (c.checklist.some(it => tagsIn(it.text).includes(id))) return true;
  return tagsIn(`${c.title} ${c.notes} ${c.comments.map(x => x.text).join(' ')}`).includes(id);
}
const MINE_KEY = 'nge-todo-mine';
const mineOnly = ref((() => { try { return localStorage.getItem(MINE_KEY) === '1'; } catch { return false; } })());
function toggleMine() {
  mineOnly.value = !mineOnly.value;
  try { localStorage.setItem(MINE_KEY, mineOnly.value ? '1' : '0'); } catch { /* storage blocked */ }
}

// ── Quick add: a title and Enter makes a card at the bottom of To do ──
const quick = ref('');
async function quickAdd() {
  const title = quick.value.trim();
  if (!title || busy.value) return;
  busy.value = true;
  try {
    const { card } = await secureWrite<any>('todo.save', { fields: { title, notes: '', list: 'todo' }, tagIds: tagsIn(title) });
    if (card) put(card);
    quick.value = '';
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

// ── Nurro cheers a card into Done ──
const nurroCheer = ref('');
let cheerTimer = 0;
function cheer(c: Card) {
  const who = c.owner_id ? firstName(nameOf(c.owner_id)) : '';
  nurroCheer.value = `Done! ${c.title}${who ? `. Nice work, ${who}!` : ''}`;
  window.clearTimeout(cheerTimer);
  cheerTimer = window.setTimeout(() => { nurroCheer.value = ''; }, 3500);
}

// ── Numbers ──
const stats = computed(() => {
  const week = Date.now() - 7 * 864e5;
  const doneWeek = cards.value.filter(c => c.list === 'done' && c.done_at && Date.parse(c.done_at) >= week);
  const byPerson = people.value.map(p => ({ id: p.id, name: firstName(p.name), n: doneWeek.filter(c => c.owner_id === p.id).length }))
    .filter(x => x.n).sort((a, b) => b.n - a.n);
  const month = Date.now() - 30 * 864e5;
  const spans = cards.value.filter(c => c.list === 'done' && c.done_at && Date.parse(c.done_at) >= month && c.created_at)
    .map(c => (Date.parse(c.done_at!) - Date.parse(c.created_at)) / 864e5).filter(d => d >= 0);
  return {
    todo: cards.value.filter(c => c.list === 'todo').length,
    doing: cards.value.filter(c => c.list === 'doing').length,
    doneWeek: doneWeek.length,
    late: cards.value.filter(c => isOverdue(c)).length,
    avgDays: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length * 10) / 10 : null,
    byPerson,
  };
});

// ── Test site and live: what each card's builds are doing ──
// A test site link says whether that site serves its branch's newest commit,
// and the card says Live once that commit is in the live branch (GitHub,
// public, read without a key and cached). A card shipped straight to live
// is marked by hand: Mark live writes "✓ Live" and the day in its status.
type BuildState = { state: 'current' | 'building' | 'live' | 'unknown'; word: string; title: string; url: string };
const builds = ref<Record<string, BuildState>>({});
const LIVE_BRANCH = 'eyewire-ii-community';
const REPO = 'seung-lab/ng-extend';
const CACHE_MS = 10 * 60 * 1000;
function cached<T>(key: string): T | undefined {
  try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); if (v && Date.now() - v.at < CACHE_MS) return v.data; } catch { /* none */ }
  return undefined;
}
function keep(key: string, data: unknown) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full */ } }
async function gh(path: string): Promise<any> {
  const key = 'nge-gh:' + path;
  const hit = cached<any>(key);
  if (hit !== undefined) return hit;
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  keep(key, data);
  return data;
}
function branchOf(url: string): string | null {
  const m = url.match(/^https:\/\/([a-z0-9-]+)-dot-brain-wire-dot-seung-lab\.ue\.r\.appspot\.com/);
  return m && m[1] !== LIVE_BRANCH ? m[1] : null;
}
async function checkBuild(url: string) {
  const branch = branchOf(url);
  if (!branch || builds.value[url]) return;
  builds.value = { ...builds.value, [url]: { state: 'unknown', word: '🧪 …', title: 'Checking the test site', url } };
  let served = '';
  try {
    const base = url.match(/^https:\/\/[^/]+/)![0];
    served = (await (await fetch(`${base}/build-commit.txt?x=${Date.now()}`)).text()).trim().slice(0, 40);
  } catch { served = ''; }
  let state: BuildState;
  try {
    if (!/^[0-9a-f]{40}$/.test(served)) throw new Error('no stamp');
    const cmp = await gh(`compare/${served}...${LIVE_BRANCH}`);
    if (cmp.status === 'identical' || cmp.status === 'ahead') {
      state = { state: 'live', word: '✓ In live', title: `Its build (${served.slice(0, 8)}) is in the live site`, url };
    } else {
      // The site's branch may have moved on (the test site checked against the branch's head).
      let head = '';
      try { head = (await gh(`branches/${encodeURIComponent(branch)}`)).commit.sha; } catch { /* branch gone: a renamed test branch */ }
      state = !head || head === served
        ? { state: 'current', word: '🧪 Test site current', title: `Serving ${served.slice(0, 8)}, the newest on ${branch}`, url }
        : { state: 'building', word: '🧪 Building', title: `Serving ${served.slice(0, 8)}; ${branch} is at ${head.slice(0, 8)}`, url };
    }
  } catch {
    state = { state: 'unknown', word: '🧪 Test site', title: 'Could not read what this test site serves', url };
  }
  builds.value = { ...builds.value, [url]: state };
}
function testLinks(c: Card) { return (c.links || []).filter(l => branchOf(l.url)); }
function buildBadges(c: Card): BuildState[] {
  return testLinks(c).map(l => { void checkBuild(l.url); return builds.value[l.url]; }).filter(Boolean).filter(b => b.state !== 'live');
}
function isLive(c: Card): boolean {
  if (/^✓\s*Live\b/.test(c.status || '')) return true;
  const links = testLinks(c);
  return links.length > 0 && links.every(l => builds.value[l.url]?.state === 'live');
}
async function markLive(c: Card) {
  const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  await save(c, { status: `✓ Live ${day}` });
}

/** A click on a list's header folds it, unless it was on one of its buttons. */
function onHeadClick(e: MouseEvent, key: string) {
  if ((e.target as HTMLElement | null)?.closest?.('button, a, input, select')) return;
  toggleFold(key);
}
// A comment about one checklist item starts with that item, quoted.
const commentEl = ref<HTMLTextAreaElement | null>(null);
function commentOn(text: string) {
  const quote = `Re: "${text.length > 80 ? text.slice(0, 79) + '…' : text}" `;
  comment.value = quote + comment.value.replace(/^Re: "[^"]*" /, '');
  void nextTick(() => { const el = commentEl.value; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); el.scrollIntoView({ block: 'center' }); } });
}
const mention = shallowRef<{ el: HTMLTextAreaElement | HTMLInputElement; start: number; query: string; pick: number; set: (v: string) => void } | null>(null);
const mentionMatches = computed(() => {
  const q = (mention.value?.query || '').toLowerCase();
  return people.value.filter(p => namesOf(p).some(n => n.toLowerCase().includes(q))).slice(0, 6);
});
function onMentionInput(e: Event, set: (v: string) => void) {
  const el = e.target as HTMLTextAreaElement;
  const upto = el.value.slice(0, el.selectionStart ?? el.value.length);
  const m = upto.match(/(^|\s)@([^\s@]{0,30})$/);
  mention.value = m ? { el, start: upto.length - m[2].length - 1, query: m[2], pick: 0, set } : null;
}
function pickMention(p: Person) {
  const m = mention.value;
  if (!m) return;
  const caret = m.el.selectionStart ?? m.el.value.length;
  const value = m.el.value.slice(0, m.start) + '@' + p.name + ' ' + m.el.value.slice(caret);
  m.set(value);
  const at = m.start + p.name.length + 2;
  mention.value = null;
  void nextTick(() => { m.el.focus(); m.el.setSelectionRange(at, at); });
}
function onMentionKey(e: KeyboardEvent) {
  e.stopPropagation();
  const m = mention.value;
  if (!m || !mentionMatches.value.length) return;
  const n = mentionMatches.value.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); mention.value = { ...m, pick: (m.pick + 1) % n }; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mention.value = { ...m, pick: (m.pick + n - 1) % n }; }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches.value[m.pick]); }
  else if (e.key === 'Escape') { e.preventDefault(); mention.value = null; }
}

// ── Saving ──
function put(card: Card) {
  const i = cards.value.findIndex(c => c.id === card.id);
  if (i >= 0) cards.value.splice(i, 1, card); else cards.value.push(card);
}
async function save(c: Card, fields: Partial<Card>, extra: Record<string, any> = {}) {
  const before = { ...c };
  Object.assign(c, fields);   // shows at once; put back if the save fails
  try {
    const { card } = await secureWrite<any>('todo.save', { id: c.id, fields, ...extra });
    if (card) put(card);
  } catch (e: any) {
    Object.assign(c, before);
    error.value = e?.message ?? String(e);
  }
}

// A new card, at the bottom of its list.
const adding = ref<ListKey | null>(null);
const newDraft = () => ({ title: '', notes: '', size: null as Size | null, status: '', owner_id: '', due_on: '',
  links: [] as Link[], checklist: [] as { text: string; done: boolean }[], images: [] as string[] });
const draft = ref(newDraft());
async function addCard(list: ListKey) {
  const title = draft.value.title.trim();
  if (!title || busy.value) return;
  busy.value = true;
  try {
    const d = draft.value;
    const fields: Record<string, any> = { title, notes: d.notes, size: d.size, list };
    // Only what was filled in, so a board without the new columns still adds.
    if (d.status.trim()) fields.status = d.status.trim();
    if (d.owner_id) fields.owner_id = d.owner_id;
    if (d.due_on) fields.due_on = d.due_on;
    if (d.links.length) fields.links = d.links;
    if (d.checklist.length) fields.checklist = d.checklist;
    if (d.images.length) fields.images = d.images;
    const { card } = await secureWrite<any>('todo.save', { fields,
      tagIds: tagsIn(title + ' ' + d.notes + ' ' + d.checklist.map(i => i.text).join(' ')) });
    if (card) put(card);
    draft.value = newDraft();
    adding.value = null;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

// ── Dragging, along a list and between lists ──
// The card takes a rank between its new neighbours, so only it is written.
const dragId = ref<string | null>(null);
const dropAt = ref<{ list: ListKey; id: string | null; after: boolean } | null>(null);
function onDragStart(e: DragEvent, c: Card) {
  dragId.value = c.id;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }
}
function onDragOverCard(e: DragEvent, list: ListKey, c: Card) {
  if (!dragId.value) return;
  e.preventDefault();
  e.stopPropagation();
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropAt.value = c.id === dragId.value ? null : { list, id: c.id, after: e.clientY > box.top + box.height / 2 };
}
function onDragOverList(e: DragEvent, list: ListKey) {
  if (!dragId.value) return;
  e.preventDefault();
  if (!dropAt.value || dropAt.value.list !== list) dropAt.value = { list, id: null, after: true };
}
function onDragEnd() { dragId.value = null; dropAt.value = null; }
async function onDrop(e: DragEvent, list: ListKey) {
  e.preventDefault();
  const id = dragId.value, at = dropAt.value;
  onDragEnd();
  const c = cards.value.find(x => x.id === id);
  if (!c || !at || at.list !== list) return;
  const rest = columns.value.find(col => col.key === list)!.rows.filter(x => x.id !== c.id);
  const i = at.id ? rest.findIndex(x => x.id === at.id) + (at.after ? 1 : 0) : rest.length;
  const above = rest[i - 1]?.rank, below = rest[i]?.rank;
  const rank = above == null && below == null ? 1 : above == null ? (below as number) - 1 : below == null ? above + 1 : (above + below) / 2;
  await moveTo(c, list, rank);
}
/** Moving to Done can close the report behind the card too. */
async function moveTo(c: Card, list: ListKey, rank?: number) {
  const fields: Partial<Card> = { list };
  if (rank !== undefined) fields.rank = rank;
  else if (list !== c.list) fields.rank = Math.max(0, ...cards.value.filter(x => x.list === list).map(x => x.rank)) + 1;
  let closeReport = false;
  if (list === 'done' && c.list !== 'done' && c.triage_id) {
    closeReport = window.confirm(`Also close ${reportLabel(c.triage_id).toLowerCase()}? It moves to Done on the triage board and its Slack thread is told.`);
  }
  await save(c, fields, closeReport ? { closeReport: true } : {});
  if (list === 'done' && fields.list === 'done') cheer(c);
}

// ── The open card ──
const editTitle = ref('');
const editNotes = ref('');
const newItem = ref('');
const comment = ref('');
function openUp(c: Card) {
  connectOpen.value = false;
  openId.value = c.id;
  editTitle.value = c.title;
  editNotes.value = c.notes;
  newItem.value = '';
  comment.value = '';
  notesEditing.value = false;
  editStatus.value = c.status || '';
  linkDraft.value = null;
}
// The card a link names opens as soon as the cards are in.
let pendingFocus = props.focusId || null;
async function saveTitle(c: Card) {
  const t = editTitle.value.trim();
  if (!t || t === c.title) { editTitle.value = c.title; return; }
  await save(c, { title: t }, { tagIds: newTags(c.title, t) });
}
const notesEditing = ref(false);
async function saveNotes(c: Card) {
  if (editNotes.value === c.notes) return;
  await save(c, { notes: editNotes.value }, { tagIds: newTags(c.notes, editNotes.value) });
}
async function addItem(c: Card) {
  const t = newItem.value.trim();
  if (!t) return;
  newItem.value = '';
  await save(c, { checklist: [...c.checklist, { text: t, done: false }] }, { tagIds: tagsIn(t) });
}
const toggleItem = (c: Card, i: number) => save(c, { checklist: c.checklist.map((x, k) => (k === i ? { ...x, done: !x.done } : x)) });
const removeItem = (c: Card, i: number) => save(c, { checklist: c.checklist.filter((_, k) => k !== i) });
/** A checklist item becomes a card of its own, under this one. */
async function itemToCard(c: Card, i: number) {
  const item = c.checklist[i];
  try {
    const { card } = await secureWrite<any>('todo.save', { fields: { title: item.text.slice(0, 200), notes: `From the checklist of "${c.title}".`, list: 'todo' } });
    if (card) put(card);
    await removeItem(c, i);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}
async function sendComment(c: Card) {
  const t = comment.value.trim();
  if (!t || busy.value) return;
  busy.value = true;
  try {
    const { card } = await secureWrite<any>('todo.comment', { id: c.id, text: t, tagIds: tagsIn(t) });
    if (card) put(card);
    comment.value = '';
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}
async function deleteCard(c: Card) {
  if (!window.confirm(`Delete "${c.title}" for good? Its notes, checklist and comments go with it.`)) return;
  try {
    await secureWrite('todo.delete', { id: c.id });
    cards.value = cards.value.filter(x => x.id !== c.id);
    openId.value = null;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}
/** Text with "@Name" tags lit up, and links. Never HTML. */
function parts(text: string): { t: string; tag?: boolean; href?: string }[] {
  const names = people.value.map(p => p.name).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(https?://[^\\s<>"]+)${names.length ? `|@(?:${names.join('|')})` : ''}`, 'g');
  const out: { t: string; tag?: boolean; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index) });
    out.push(m[1] ? { t: m[0], href: m[0] } : { t: m[0], tag: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

const onListChange = (c: Card, e: Event) => moveTo(c, (e.target as HTMLSelectElement).value as ListKey);
const onOwnerChange = (c: Card, e: Event) => save(c, { owner_id: (e.target as HTMLSelectElement).value || null });
/** Enter in the title saves it, unless it is picking a tag. */
function onTitleKey(e: KeyboardEvent) {
  if (mention.value && mentionMatches.value.length) return onMentionKey(e);
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
}


// ── Connect your AI (Ames 2026-10-20) ──
// Each admin's own connector address for Claude or ChatGPT (functions/
// todo-connector.js). The address is shown once, when it is made; making a
// new one switches the old one off.
const connectOpen = ref(false);
const connect = ref<{ connected: boolean; created_at: string | null; last_used_at: string | null } | null>(null);
const connectUrl = ref('');
const connectBusy = ref(false);
const connectCopied = ref(false);
async function openConnect() {
  openId.value = null;
  connectOpen.value = true;
  connectUrl.value = '';
  try {
    const data = await secureWrite<any>('todo.keyStatus');
    connect.value = data?.installed === false ? null : data;
    if (data?.installed === false) error.value = 'The connector needs its table: run supabase-admin-todo-keys.sql in the Supabase SQL editor.';
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}
async function makeConnectUrl(off = false) {
  if (connectBusy.value) return;
  if (connect.value?.connected && !window.confirm(off
    ? 'Switch your connector off? Your AI loses the To do board until you make a new address.'
    : 'Make a new address? The old one stops working, so update it in your AI.')) return;
  connectBusy.value = true;
  try {
    const data = await secureWrite<any>('todo.key', off ? { off: true } : {});
    connectUrl.value = data?.url || '';
    connect.value = { connected: !!data?.connected, created_at: data?.connected ? new Date().toISOString() : null, last_used_at: null };
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    connectBusy.value = false;
  }
}
async function copyConnectUrl() {
  try { await navigator.clipboard.writeText(connectUrl.value); connectCopied.value = true; setTimeout(() => { connectCopied.value = false; }, 2000); }
  catch { /* the address is on screen to copy by hand */ }
}


// ── Links, a status line, a due day, images and formatting (Ames 2026-10-21:
// "we need some more options here, like test server link", "all optional",
// "need optional images and text formatting") ──
type LinkKind = 'test' | 'live' | 'pr' | 'doc' | 'other';
interface Link { kind: LinkKind; url: string; label: string }
const LINK_KINDS: { key: LinkKind; icon: string; word: string }[] = [
  { key: 'test', icon: '🧪', word: 'Test site' }, { key: 'live', icon: '🌐', word: 'Live' },
  { key: 'pr', icon: '🔀', word: 'Pull request' }, { key: 'doc', icon: '📄', word: 'Doc' }, { key: 'other', icon: '🔗', word: 'Link' },
];
const linkIcon = (l: Link) => LINK_KINDS.find(k => k.key === l.kind)?.icon || '🔗';
const linkWord = (l: Link) => l.label || LINK_KINDS.find(k => k.key === l.kind)?.word || 'Link';
/** What a pasted address most likely is. A Pyr test site is recognized. */
function guessKind(url: string): LinkKind {
  if (/^https:\/\/eyewire-ii-community-dot-brain-wire-dot-seung-lab\.ue\.r\.appspot\.com/.test(url)) return 'live';
  if (/-dot-brain-wire-dot-seung-lab\.ue\.r\.appspot\.com/.test(url)) return 'test';
  if (/github\.com\/[^/]+\/[^/]+\/(pull|tree|compare|commit)\//.test(url)) return 'pr';
  if (/docs\.google\.com|claude\.ai\/|notion\.so/.test(url)) return 'doc';
  return 'other';
}
/** The link being typed: for the new card ('new') or an open card (its id). */
const linkDraft = ref<{ for: string; kind: LinkKind | ''; url: string; label: string } | null>(null);
function linkFromDraft(): Link | null {
  const d = linkDraft.value;
  if (!d) return null;
  const url = d.url.trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) { error.value = 'A link must be one https address.'; return null; }
  const kind = d.kind || guessKind(url);
  return { kind, url, label: kind === 'other' ? d.label.trim().slice(0, 40) : '' };
}
function addDraftLink() {
  const l = linkFromDraft();
  if (!l) return;
  draft.value.links.push(l);
  linkDraft.value = null;
}
async function addCardLink(c: Card) {
  const l = linkFromDraft();
  if (!l) return;
  linkDraft.value = null;
  await save(c, { links: [...(c.links || []), l] });
}
const removeCardLink = (c: Card, i: number) => save(c, { links: (c.links || []).filter((_, k) => k !== i) });

/** Today, on this computer's calendar, as 2026-10-21. */
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const isOverdue = (c: Card) => !!c.due_on && c.list !== 'done' && c.due_on < todayKey();
function dueWords(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const when = new Date(y, m - 1, d);
  const days = Math.round((when.getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1 && days < 7) return 'due ' + when.toLocaleDateString(undefined, { weekday: 'short' });
  return 'due ' + when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const onDueChange = (c: Card, e: Event) => save(c, { due_on: (e.target as HTMLInputElement).value || null });
const editStatus = ref('');
async function saveStatus(c: Card) {
  const s = editStatus.value.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (s !== (c.status || '')) await save(c, { status: s });
}

// To do in your own order, or by due day (remembered).
const SORT_KEY = 'nge_todo_sort_v1';
const todoByDue = ref((() => { try { return localStorage.getItem(SORT_KEY) === 'due'; } catch { return false; } })());
function toggleTodoSort() {
  todoByDue.value = !todoByDue.value;
  try { localStorage.setItem(SORT_KEY, todoByDue.value ? 'due' : 'order'); } catch { /* not remembered */ }
}
// Any list folds to a narrow strip (Ames 2026-10-21: "a way to collapse
// Done"; 2026-10-23: "why can't I collapse To Do").
const FOLD_KEY = 'nge_todo_done_folded_v1';
const FOLDS_KEY = 'nge_todo_folded_v2';
const folded = ref<Record<string, boolean>>((() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDS_KEY) || 'null');
    if (saved && typeof saved === 'object') return saved;
    return { done: localStorage.getItem(FOLD_KEY) === '1' };
  } catch { return {}; }
})());
const isFolded = (key: string) => !!folded.value[key];
function toggleFold(key: string) {
  // Never all three: the last open list stays open.
  if (!folded.value[key] && LISTS.filter(l => !folded.value[l.key]).length <= 1) return;
  folded.value = { ...folded.value, [key]: !folded.value[key] };
  try { localStorage.setItem(FOLDS_KEY, JSON.stringify(folded.value)); } catch { /* not remembered */ }
}
const listColumns = computed(() => LISTS.map(l => (folded.value[l.key] ? '44px' : 'minmax(0, 1fr)')).join(' '));
const LIST_ICONS: Record<string, string> = { todo: '🎯', doing: '⚡', done: '🏆' };
/** The start of a card's notes, as plain words, for its face. */
function excerpt(notes: string): string {
  return String(notes || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/^\s*(?:[-•]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(.{0,260})(\s.*)?$/, (m, head, rest) => head + (rest ? '…' : ''));
}

// Formatting in notes, as in the reply box: bold, bullets, numbers. Notes
// show through renderSafeMarkdown, never as raw HTML.
type TextBox = { el: HTMLTextAreaElement | null; get: () => string; set: (v: string) => void };
function fmtBold(box: TextBox) {
  const el = box.el; if (!el) return;
  const v = box.get(), a = el.selectionStart, b = el.selectionEnd;
  const inner = v.slice(a, b) || 'bold text';
  box.set(v.slice(0, a) + '**' + inner + '**' + v.slice(b));
  void nextTick(() => { el.focus(); el.setSelectionRange(a + 2, a + 2 + inner.length); });
}
/** The whole lines the selection touches: [start, end) in the text. */
function selectedLines(el: HTMLTextAreaElement, v: string) {
  const a = el.selectionStart, b = Math.max(el.selectionStart, el.selectionEnd - (el.selectionEnd > el.selectionStart && v[el.selectionEnd - 1] === '\n' ? 1 : 0));
  const start = v.lastIndexOf('\n', a - 1) + 1;
  let end = v.indexOf('\n', b);
  if (end < 0) end = v.length;
  return { start, end };
}
const LIST_MARK = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/;
function fmtList(box: TextBox, numbered: boolean) {
  const el = box.el; if (!el) return;
  const v = box.get(), { start, end } = selectedLines(el, v);
  const lines = v.slice(start, end).split('\n').map((l, i) => (numbered ? `${i + 1}. ` : '- ') + l.replace(LIST_MARK, ''));
  box.set(v.slice(0, start) + lines.join('\n') + v.slice(end));
}
/** The selected lines leave the text and come back as checklist items (Ames
 *  2026-10-21: "I highlight some rows and click checklist and it becomes
 *  things they can check off"). With nothing selected, the line the cursor
 *  is on. */
function takeLines(box: TextBox): string[] {
  const el = box.el; if (!el) return [];
  const v = box.get(), { start, end } = selectedLines(el, v);
  const items = v.slice(start, end).split('\n').map(l => l.replace(LIST_MARK, '').trim()).filter(Boolean);
  if (!items.length) return [];
  box.set((v.slice(0, start) + v.slice(end + 1)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, ''));
  return items;
}
const draftNotesEl = ref<HTMLTextAreaElement | null>(null);
const cardNotesEl = ref<HTMLTextAreaElement | null>(null);
// The add form sits inside the lists' v-for, where a plain ref becomes a list.
const setDraftNotesEl = (el: unknown) => { if (el) draftNotesEl.value = el as HTMLTextAreaElement; };
const draftBox: TextBox = { get el() { return draftNotesEl.value; }, get: () => draft.value.notes, set: v => { draft.value.notes = v; } } as TextBox;
const cardBox: TextBox = { get el() { return cardNotesEl.value; }, get: () => editNotes.value, set: v => { editNotes.value = v; } } as TextBox;
function draftToChecklist() {
  const items = takeLines(draftBox);
  if (!items.length) { error.value = 'Select the lines that should become checklist items.'; return; }
  draft.value.checklist.push(...items.map(text => ({ text, done: false })));
}
async function cardToChecklist(c: Card) {
  const items = takeLines(cardBox);
  if (!items.length) { error.value = 'Select the lines that should become checklist items.'; return; }
  await save(c, { notes: editNotes.value, checklist: [...c.checklist, ...items.map(text => ({ text, done: false }))] }, { tagIds: tagsIn(items.join(' ')) });
}
/** Notes with formatting and lit @tags; renderSafeMarkdown escapes the rest. */
function notesHtml(text: string) {
  const html = renderSafeMarkdown(text, true);
  const tags = [...people.value].map(p => '@' + p.name).filter(t => t.length > 1).sort((a, b) => b.length - a.length);
  if (!tags.length || !tags.some(t => text.includes(t))) return html;
  // Mark the @names in the text only, never inside a link's address or title.
  const t = document.createElement('template');
  t.innerHTML = html;
  const walker = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const s = node.data;
    if (!tags.some(tag => s.includes(tag))) continue;
    const frag = document.createDocumentFragment();
    let i = 0, from = 0;
    while (i < s.length) {
      const tag = tags.find(x => s.startsWith(x, i));
      if (!tag) { i++; continue; }
      if (i > from) frag.append(s.slice(from, i));
      const b = document.createElement('b');
      b.className = 'nge-todo-tag';
      b.textContent = tag;
      frag.append(b);
      i += tag.length; from = i;
    }
    if (from < s.length) frag.append(s.slice(from));
    node.replaceWith(frag);
  }
  return t.innerHTML;
}

// Images on a card: added with the button, pasted, or dropped on the notes.
// Kept (admin-uploads/todo-images/), not cleaned up like reply images.
const imageBusy = ref(0);
async function uploadImage(file: File): Promise<string | null> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { error.value = 'Use a PNG, JPEG, GIF or WebP image.'; return null; }
  imageBusy.value++;
  try { return await secureUpload(file, 'todo'); }
  catch (e: any) { error.value = e?.message || 'The image did not upload.'; return null; }
  finally { imageBusy.value--; }
}
async function addImages(files: FileList | File[] | null | undefined, to: 'new' | Card) {
  for (const f of [...(files || [])]) {
    const url = await uploadImage(f);
    if (!url) continue;
    if (to === 'new') draft.value.images.push(url);
    else await save(to, { images: [...(to.images || []), url] });
  }
}
const removeCardImage = (c: Card, i: number) => save(c, { images: (c.images || []).filter((_, k) => k !== i) });
function imageFiles(e: ClipboardEvent | DragEvent): File[] {
  const items = 'clipboardData' in e ? [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()) : [...(e.dataTransfer?.files || [])];
  return items.filter((f): f is File => !!f && f.type.startsWith('image/'));
}
function onNotesPaste(e: ClipboardEvent, to: 'new' | Card) {
  const files = imageFiles(e);
  if (files.length) { e.preventDefault(); void addImages(files, to); }
}
function onNotesDrop(e: DragEvent, to: 'new' | Card) {
  const files = imageFiles(e);
  if (files.length) { e.preventDefault(); void addImages(files, to); }
}
const pickFor = ref<'new' | Card | null>(null);
const imagePicker = ref<HTMLInputElement | null>(null);
function pickImages(to: 'new' | Card) { pickFor.value = to; imagePicker.value?.click(); }
function onPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  if (pickFor.value) void addImages(input.files, pickFor.value);
  input.value = '';
}
const onDraftOwner = (e: Event) => { draft.value.owner_id = (e.target as HTMLSelectElement).value; };

// Delete straight from the list, and edit a card's title from the list.
const titleEl = ref<HTMLInputElement | null>(null);
function editCard(c: Card) { openUp(c); void nextTick(() => titleEl.value?.focus()); }

const blurOf = (e: Event) => (e.target as HTMLElement).blur();

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest?.('textarea, input')) return;
  if (openId.value) openId.value = null;
  else connectOpen.value = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
// A pasted image goes wherever you are (Ames 2026-10-23: "I want to be able
// to paste an image as well"): the card that is open (from its comment box,
// checklist or anywhere on it), the card being added, or, on the board
// itself, a new card in To do holding the picture, opened so you can name it.
// The notes boxes handle their own paste (onNotesPaste), so they are skipped.
async function onPagePaste(e: ClipboardEvent) {
  if ((e.target as HTMLElement | null)?.closest?.('[data-nge-notes-paste]')) return;
  const files = imageFiles(e);
  if (!files.length) return;
  e.preventDefault();
  if (openCard.value) { await addImages(files, openCard.value); return; }
  if (adding.value) { await addImages(files, 'new'); return; }
  if (busy.value) return;
  busy.value = true;
  try {
    const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const { card } = await secureWrite<any>('todo.save', { fields: { title: `Pasted picture, ${day}`, notes: '', list: 'todo' } });
    if (!card) return;
    put(card);
    const c = cards.value.find(x => x.id === card.id);
    if (c) { await addImages(files, c); openUp(c); }
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    busy.value = false;
  }
}
onMounted(() => document.addEventListener('paste', onPagePaste));
onUnmounted(() => document.removeEventListener('paste', onPagePaste));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="nge-todo" :class="{ 'nge-todo--light': light }">
    <div class="nge-todo-head">
      <button class="nge-todo-btn" @click="emit('back')" title="Back to the triage board">← Triage</button>
      <span class="nge-todo-heading nge-todo-heading--home" title="Back to the board" @click="openId = null"><svg class="nge-todo-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> To do board</span>
      <span class="nge-todo-sub">Our own planning, apart from player reports. Type @ to tag an admin: they get the bell in Pyr and a ping in Slack. Start a checklist item with @name to make it theirs. Paste a picture anywhere.</span>
      <button class="nge-todo-btn nge-todo-mine" :class="{ 'nge-todo-mine--on': mineOnly }" :disabled="!myId" @click="toggleMine"
              :title="myId ? 'Only cards you own, are tagged on, or have checklist items on' : 'Your Pyr name is not on the board yet'">{{ mineOnly ? '★ Mine' : '☆ Mine' }}</button>
      <button class="nge-todo-btn" @click="openConnect" title="Let your own Claude or ChatGPT work this board">🔌 Connect your AI</button>
      <button class="nge-todo-btn" :disabled="loading" @click="load">{{ loading ? 'Loading…' : '↻ Refresh' }}</button>
    </div>
    <div v-if="!openCard && !notInstalled" class="nge-todo-stats" aria-label="Board numbers">
      <img :src="imgNurroHome" alt="" class="nge-todo-nurro" />
      <div class="nge-todo-stat nge-todo-stat--todo"><b>{{ stats.todo }}</b><span>to do</span></div>
      <div class="nge-todo-stat nge-todo-stat--doing"><b>{{ stats.doing }}</b><span>doing</span></div>
      <div class="nge-todo-stat nge-todo-stat--done"><b>{{ stats.doneWeek }}</b><span>done this week</span></div>
      <div class="nge-todo-stat nge-todo-stat--late" v-if="stats.late"><b>{{ stats.late }}</b><span>overdue</span></div>
      <div class="nge-todo-stat" v-if="stats.avgDays !== null"><b>{{ stats.avgDays }}</b><span>days to done, on average</span></div>
      <div class="nge-todo-stat nge-todo-stat--people" v-if="stats.byPerson.length">
        <span v-for="p in stats.byPerson" :key="p.id" class="nge-todo-personstat" :style="{ '--pc': colorOf(p.id) }">{{ p.name }} <b>{{ p.n }}</b></span>
        <span class="nge-todo-stat-word">done this week</span>
      </div>
    </div>
    <div v-if="nurroCheer" class="nge-todo-cheer" role="status"><img :src="imgNurroBravo" alt="" /><span>{{ nurroCheer }}</span></div>
    <div v-if="error" class="nge-todo-error" role="alert">⚠ {{ error }} <button class="nge-todo-x" @click="error = ''" aria-label="Close">×</button></div>
    <div v-if="notInstalled" class="nge-todo-empty">The To do board needs its table: run supabase-admin-todos.sql in the Supabase SQL editor, then Refresh.</div>

    <div v-else class="nge-todo-body">
      <div v-if="!openCard" class="nge-todo-lists" :style="{ gridTemplateColumns: listColumns }">
        <section v-for="col in columns" :key="col.key" class="nge-todo-list" :class="[`nge-todo-list--${col.key}`, { 'nge-todo-list--folded': isFolded(col.key) }]"
                 @dragover="onDragOverList($event, col.key)" @drop="onDrop($event, col.key)">
          <button v-if="isFolded(col.key)" type="button" class="nge-todo-rail" :title="'Open ' + col.title" @click="toggleFold(col.key)">
            <span class="nge-todo-list-icon">{{ LIST_ICONS[col.key] }}</span><span class="nge-todo-list-title">{{ col.title }}</span><span class="nge-todo-count">{{ col.rows.length }}</span>
          </button>
          <template v-else>
          <header class="nge-todo-list-head nge-todo-list-head--fold" :title="'Click to fold ' + col.title + ' away'"
                  @click="onHeadClick($event, col.key)">
            <button type="button" class="nge-todo-mini nge-todo-fold" :title="'Fold ' + col.title + ' away'" @click="toggleFold(col.key)">◂</button>
            <span class="nge-todo-list-icon">{{ LIST_ICONS[col.key] }}</span>
            <span class="nge-todo-list-title">{{ col.title }}</span>
            <span class="nge-todo-count">{{ col.rows.length }}</span>
            <span v-if="col.key === 'todo' && sizeSummary.length" class="nge-todo-sizes" title="Sizes waiting in To do">
              <template v-for="(x, i) in sizeSummary" :key="x.s">{{ i ? ' · ' : '' }}{{ x.n }} {{ x.s }}</template>
            </span>
            <span class="nge-todo-list-hint">{{ col.hint }}</span>
            <button v-if="col.key === 'todo'" type="button" class="nge-todo-mini nge-todo-sort" :title="todoByDue ? 'Showing by due day. Click for your own order.' : 'Showing your own order. Click to sort by due day.'"
                    @click="toggleTodoSort">{{ todoByDue ? '⇅ By due day' : '⇅ My order' }}</button>
          </header>

          <form v-if="col.key === 'todo'" class="nge-todo-quick" @submit.prevent="quickAdd">
            <input v-model="quick" class="nge-todo-input" maxlength="200" placeholder="Quick add: type and press Enter" aria-label="Quick add a card"
                   @input="onMentionInput($event, v => quick = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop />
          </form>
          <div v-if="col.key !== 'done'" class="nge-todo-add">
            <button v-if="adding !== col.key" class="nge-todo-btn nge-todo-add-btn" @click="adding = col.key; draft = newDraft(); linkDraft = null">＋ Add a card</button>
            <form v-else class="nge-todo-form" @submit.prevent="addCard(col.key)">
              <input v-model="draft.title" class="nge-todo-input" maxlength="200" placeholder="What needs doing" aria-label="Title"
                     @input="onMentionInput($event, v => draft.title = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop />
              <input v-model="draft.status" class="nge-todo-input nge-todo-status-input" maxlength="200" placeholder="Status, in a line (optional)" aria-label="Status"
                     @keydown.stop @keyup.stop @keypress.stop />
              <div class="nge-todo-fmtbar" role="toolbar" aria-label="Formatting">
                <button type="button" title="Bold" @click="fmtBold(draftBox)"><b>B</b></button>
                <button type="button" title="Bulleted list" @click="fmtList(draftBox, false)">• Bullets</button>
                <button type="button" title="Numbered list" @click="fmtList(draftBox, true)">1. Numbers</button>
                <button type="button" title="Select some lines, then click: they become checklist items" @click="draftToChecklist">☑ Checklist</button>
                <button type="button" title="Add an image. You can also paste or drop one into the notes." @click="pickImages('new')">🖼 Image</button>
              </div>
              <textarea :ref="setDraftNotesEl" v-model="draft.notes" class="nge-todo-input" rows="4" maxlength="8000" placeholder="Notes (optional). Type @ to tag someone. Select lines and click Checklist to turn them into items." aria-label="Notes"
                        @input="onMentionInput($event, v => draft.notes = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop
                        data-nge-notes-paste @paste="onNotesPaste($event, 'new')" @dragover.prevent @drop="onNotesDrop($event, 'new')"></textarea>
              <ul v-if="draft.checklist.length" class="nge-todo-check">
                <li v-for="(it, i) in draft.checklist" :key="i"><label><input type="checkbox" disabled /> <span>{{ it.text }}</span></label>
                  <button type="button" class="nge-todo-mini" aria-label="Remove" @click="draft.checklist.splice(i, 1)">×</button></li>
              </ul>
              <div v-if="draft.images.length || imageBusy" class="nge-todo-images">
                <span v-for="(u, i) in draft.images" :key="u" class="nge-todo-image"><img :src="u" alt="" /><button type="button" class="nge-todo-image-x" aria-label="Remove image" @click="draft.images.splice(i, 1)">×</button></span>
                <span v-if="imageBusy" class="nge-todo-warn">Uploading…</span>
              </div>
              <div v-if="draft.links.length" class="nge-todo-links">
                <span v-for="(l, i) in draft.links" :key="i" class="nge-todo-linkchip">{{ linkIcon(l) }} {{ linkWord(l) }}<button type="button" class="nge-todo-mini" aria-label="Remove link" @click="draft.links.splice(i, 1)">×</button></span>
              </div>
              <div v-if="linkDraft?.for === 'new'" class="nge-todo-row nge-todo-linkform">
                <select v-model="linkDraft.kind" class="nge-todo-select" aria-label="Kind of link">
                  <option value="">Guess from the address</option>
                  <option v-for="k in LINK_KINDS" :key="k.key" :value="k.key">{{ k.icon }} {{ k.word }}</option>
                </select>
                <input v-model="linkDraft.url" class="nge-todo-input nge-todo-grow" placeholder="https://..." aria-label="Address" @keydown.stop @keyup.stop @keypress.stop @keydown.enter.prevent="addDraftLink" />
                <input v-if="linkDraft.kind === 'other'" v-model="linkDraft.label" class="nge-todo-input nge-todo-short" maxlength="40" placeholder="Name" aria-label="Link name" @keydown.stop @keyup.stop @keypress.stop />
                <button type="button" class="nge-todo-btn" @click="addDraftLink">Add link</button>
                <button type="button" class="nge-todo-mini" @click="linkDraft = null">Cancel</button>
              </div>
              <div class="nge-todo-row">
                <span class="nge-todo-sizepick" role="radiogroup" aria-label="Size">
                  <button v-for="s in SIZES" :key="s" type="button" role="radio" class="nge-todo-size" :class="{ 'nge-todo-size--on': draft.size === s }"
                          :aria-checked="draft.size === s ? 'true' : 'false'" :title="SIZE_WORDS[s]" @click="draft.size = draft.size === s ? null : s">{{ s }}</button>
                </span>
                <select class="nge-todo-select" :value="draft.owner_id" aria-label="Owner" @change="onDraftOwner($event)">
                  <option value="">Owner (optional)</option>
                  <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <input v-model="draft.due_on" type="date" class="nge-todo-select" aria-label="Due day (optional)" title="Due day (optional)" />
                <button v-if="linkDraft?.for !== 'new'" type="button" class="nge-todo-btn" @click="linkDraft = { for: 'new', kind: '', url: '', label: '' }">＋ Link</button>
              </div>
              <div class="nge-todo-row">
                <button type="submit" class="nge-todo-btn nge-todo-btn--primary" :disabled="busy || !!imageBusy || !draft.title.trim()">{{ busy ? 'Adding…' : 'Add' }}</button>
                <button type="button" class="nge-todo-btn" @click="adding = null">Cancel</button>
              </div>
            </form>
          </div>

          <article v-for="c in col.rows" :key="c.id" class="nge-todo-card" draggable="true"
                   :class="{ 'nge-todo-card--open': openId === c.id, 'nge-todo-card--dragging': dragId === c.id,
                             'nge-todo-card--drop-above': dropAt?.id === c.id && !dropAt.after, 'nge-todo-card--drop-below': dropAt?.id === c.id && dropAt.after }"
                   tabindex="0" @click="openUp(c)" @keydown.enter="openUp(c)"
                   @dragstart="onDragStart($event, c)" @dragend="onDragEnd" @dragover="onDragOverCard($event, col.key, c)">
            <div class="nge-todo-card-tools" @click.stop>
              <button type="button" class="nge-todo-mini" title="Edit" aria-label="Edit" @click="editCard(c)">✎</button>
              <button type="button" class="nge-todo-mini" title="Delete" aria-label="Delete" @click="deleteCard(c)">🗑</button>
            </div>
            <div class="nge-todo-card-title">{{ c.title }}</div>
            <div v-if="isLive(c) || buildBadges(c).length" class="nge-todo-badges" @click.stop>
              <span v-if="isLive(c)" class="nge-todo-badge nge-todo-badge--live" :title="c.status || 'Its test site build is in the live site'">✓ Live</span>
              <span v-for="b in buildBadges(c)" :key="b.url" class="nge-todo-badge" :class="'nge-todo-badge--' + b.state" :title="b.title">{{ b.word }}</span>
            </div>
            <div v-if="c.status" class="nge-todo-card-status">{{ c.status }}</div>
            <div v-if="excerpt(c.notes)" class="nge-todo-card-excerpt">{{ excerpt(c.notes) }}</div>
            <div v-if="(c.links || []).length" class="nge-todo-links" @click.stop>
              <a v-for="(l, i) in c.links" :key="i" class="nge-todo-linkchip" :href="l.url" target="_blank" rel="noopener noreferrer" :title="l.url" draggable="false">{{ linkIcon(l) }} {{ linkWord(l) }}</a>
            </div>
            <div class="nge-todo-card-meta">
              
              <span v-if="c.due_on" class="nge-todo-chip" :class="{ 'nge-todo-chip--late': isOverdue(c) }" :title="'Due ' + c.due_on">{{ dueWords(c.due_on) }}</span>
              <span v-if="c.checklist.length && !perPerson(c).length" class="nge-todo-chip" :class="{ 'nge-todo-chip--all': checkCount(c).done === checkCount(c).all }" title="Checklist">☑ {{ checkCount(c).done }}/{{ checkCount(c).all }}</span>
              <span v-for="pp in perPerson(c)" :key="pp.id" class="nge-todo-chip nge-todo-chip--person" :class="{ 'nge-todo-chip--all': pp.done === pp.all }"
                    :style="{ '--pc': colorOf(pp.id) }" :title="`${pp.name}: ${pp.done} of ${pp.all} done`">{{ firstName(pp.name) }} {{ pp.done }}/{{ pp.all }}</span>
              <span v-if="(c.images || []).length" class="nge-todo-chip" title="Images">🖼 {{ c.images.length }}</span>
              <span v-if="c.comments.length" class="nge-todo-chip" title="Comments">💬 {{ c.comments.length }}</span>
              <span v-if="c.triage_id" class="nge-todo-chip" title="Made from a player report">{{ reportLabel(c.triage_id) }}</span>
              <span v-if="c.owner_id" class="nge-todo-avatar" :style="{ background: colorOf(c.owner_id) }" :title="'Owner: ' + nameOf(c.owner_id)">{{ initialOf(c.owner_id) }}</span>
            </div>
            <div class="nge-todo-card-by">{{ c.owner_id ? nameOf(c.owner_id) : (c.created_by || '') }}<template v-if="c.updated_at"> · {{ ago(c.updated_at) }}</template></div>
            <div v-if="waitingOn(c).length" class="nge-todo-waiting">Waiting on {{ waitingOn(c).map(p => firstName(p.name)).join(', ') }}</div>
          </article>
          <div v-if="dropAt?.list === col.key && !dropAt.id" class="nge-todo-drop-end"></div>
          <div v-if="!col.rows.length && !loading" class="nge-todo-list-empty"><img :src="imgNurroWhere" alt="" class="nge-todo-nurro-empty" />{{ mineOnly ? 'Nothing of yours here.' : col.empty }}</div>
          <button v-if="col.key === 'done' && (col.hidden || showAllDone)" class="nge-todo-btn nge-todo-more" @click="showAllDone = !showAllDone">
            {{ showAllDone ? `Hide finished more than ${DONE_DAYS} days ago` : `Show ${col.hidden} finished more than ${DONE_DAYS} days ago` }}
          </button>
          </template>
        </section>
      </div>

      <!-- Connect your AI: the same narrow side panel as an open card. -->
      <aside v-if="connectOpen && !openCard" class="nge-todo-panel" aria-label="Connect your AI">
        <div class="nge-todo-panel-top">
          <span class="nge-todo-heading">🔌 Connect your AI</span>
          <button class="nge-todo-x" @click="connectOpen = false" aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <div class="nge-todo-notes">Let your own Claude or ChatGPT read and work this board: list cards, add them, move them, tick checklists, comment and tag. Everything it writes is signed with your name and "(via AI)". It cannot delete cards.</div>

        <template v-if="connectUrl">
          <div class="nge-todo-label">Your private address</div>
          <div class="nge-todo-key">{{ connectUrl }}</div>
          <div class="nge-todo-row">
            <button class="nge-todo-btn nge-todo-btn--primary" @click="copyConnectUrl">{{ connectCopied ? 'Copied' : 'Copy' }}</button>
          </div>
          <div class="nge-todo-warn">Shown only now. Keep it to yourself: anyone with it can work the board as you. If it leaks, make a new one here.</div>
        </template>
        <template v-else-if="connect?.connected">
          <div class="nge-todo-notes">You are connected since {{ ago(connect.created_at || '') }}<template v-if="connect.last_used_at">, last used {{ ago(connect.last_used_at) }}</template>.</div>
        </template>

        <div class="nge-todo-row">
          <button class="nge-todo-btn" :class="{ 'nge-todo-btn--primary': !connect?.connected && !connectUrl }" :disabled="connectBusy" @click="makeConnectUrl()">
            {{ connectBusy ? 'Working…' : connect?.connected ? 'Make a new address' : 'Make my address' }}
          </button>
          <button v-if="connect?.connected" class="nge-todo-btn nge-todo-delete" :disabled="connectBusy" @click="makeConnectUrl(true)">Switch off</button>
        </div>

        <div class="nge-todo-label">In Claude</div>
        <ol class="nge-todo-steps">
          <li>Settings, then Connectors, then Add custom connector.</li>
          <li>Name it "Pyr To do board" and paste your address. Leave the advanced settings empty.</li>
          <li>In a chat, turn it on from the tools menu, then ask, for example, "What's on my plate on the Pyr To do board?"</li>
        </ol>
        <div class="nge-todo-label">In ChatGPT</div>
        <ol class="nge-todo-steps">
          <li>Not every plan can add custom connectors. Where yours can, add one in ChatGPT's settings with your address and no sign in.</li>
        </ol>
      </aside>

      <!-- Focus view (Ames 2026-10-22: "why not have the card I clicked expand
           and the work there?"): the open card takes the middle of the
           screen, and the lists shrink to a strip of titles on the left, so
           another card is still one click away. Esc or Board goes back. -->
      <nav v-if="openCard" class="nge-todo-strip" aria-label="All cards">
        <section v-for="col in columns" :key="col.key" class="nge-todo-strip-list">
          <div class="nge-todo-strip-head nge-todo-heading--home" title="Back to the board" @click="openId = null">{{ col.title }} <span class="nge-todo-count">{{ col.rows.length }}</span></div>
          <button v-for="c in col.rows" :key="c.id" type="button" class="nge-todo-strip-card" :class="{ 'nge-todo-strip-card--on': c.id === openId }"
                  :aria-current="c.id === openId ? 'true' : undefined" @click="openUp(c)">
            <span class="nge-todo-strip-title">{{ c.title }}</span>
            <span class="nge-todo-strip-meta">
              
              <span v-if="c.checklist.length">☑ {{ checkCount(c).done }}/{{ checkCount(c).all }}</span>
              <span v-if="c.due_on" :class="{ 'nge-todo-strip-late': isOverdue(c) }">{{ dueWords(c.due_on) }}</span>
              <span v-if="c.owner_id" class="nge-todo-avatar nge-todo-avatar--small">{{ initialOf(c.owner_id) }}</span>
            </span>
          </button>
          <div v-if="!col.rows.length" class="nge-todo-strip-empty">{{ col.empty }}</div>
        </section>
      </nav>
      <div v-if="openCard" class="nge-todo-focus">
      <aside class="nge-todo-panel nge-todo-panel--focus" :key="openCard.id" aria-label="Card">
        <div class="nge-todo-panel-top">
          <button type="button" class="nge-todo-btn" title="Back to the board (Esc)" @click="openId = null">← Board</button>
          <button type="button" class="nge-todo-btn nge-todo-cardlink" :title="cardLink(openCard)" @click="copyCardLink(openCard)">{{ linkCopied === openCard.id ? '✓ Link copied' : '🔗 Copy link to this card' }}</button>
          <select class="nge-todo-select" :value="openCard.list" aria-label="List" @change="onListChange(openCard, $event)">
            <option v-for="l in LISTS" :key="l.key" :value="l.key">{{ l.title }}</option>
          </select>
        </div>
        <input ref="titleEl" v-model="editTitle" class="nge-todo-input nge-todo-title-edit" maxlength="200" aria-label="Title" title="Click to edit the title"
               @input="onMentionInput($event, v => editTitle = v)" @keydown="onTitleKey"
               @blur="saveTitle(openCard)" @keyup.stop @keypress.stop />
        <a v-if="openCard.triage_id" class="nge-todo-link" :href="reportHref(openCard.triage_id)" target="_blank" rel="noopener">{{ reportLabel(openCard.triage_id) }}: open it on the triage board ↗</a>

        <div class="nge-todo-field">
          <span class="nge-todo-label">Size</span>
          <span class="nge-todo-sizepick" role="radiogroup" aria-label="Size">
            <button v-for="s in SIZES" :key="s" type="button" role="radio" class="nge-todo-size" :class="{ 'nge-todo-size--on': openCard.size === s }"
                    :aria-checked="openCard.size === s ? 'true' : 'false'" :title="SIZE_WORDS[s]"
                    @click="save(openCard, { size: openCard.size === s ? null : s })">{{ s }}</button>
          </span>
          <span class="nge-todo-label">Owner</span>
          <select class="nge-todo-select" :value="openCard.owner_id || ''" aria-label="Owner"
                  @change="onOwnerChange(openCard, $event)">
            <option value="">Nobody yet</option>
            <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <input v-model="editStatus" class="nge-todo-input nge-todo-status-input" maxlength="200" placeholder="Status, in a line (optional)" aria-label="Status"
               @keydown.stop @keydown.enter="blurOf($event)" @keyup.stop @keypress.stop @blur="saveStatus(openCard)" />
        <div class="nge-todo-row">
          <button v-if="!isLive(openCard)" type="button" class="nge-todo-btn nge-todo-live-btn" title="Shipped straight to the live site: say so on the card" @click="markLive(openCard)">✓ Mark live</button>
          <span v-for="b in testLinks(openCard).map(l => builds[l.url]).filter(Boolean)" :key="b.url" class="nge-todo-badge" :class="'nge-todo-badge--' + b.state" :title="b.title">{{ b.word }}</span>
        </div>
        <div class="nge-todo-field">
          <span class="nge-todo-label">Due</span>
          <input type="date" class="nge-todo-select" :value="openCard.due_on || ''" aria-label="Due day" @change="onDueChange(openCard, $event)" />
          <button v-if="openCard.due_on" type="button" class="nge-todo-mini" @click="save(openCard, { due_on: null })">Clear</button>
        </div>

        <div class="nge-todo-label">Links</div>
        <div v-if="(openCard.links || []).length" class="nge-todo-links">
          <span v-for="(l, i) in openCard.links" :key="i" class="nge-todo-linkchip"><a :href="l.url" target="_blank" rel="noopener noreferrer" :title="l.url">{{ linkIcon(l) }} {{ linkWord(l) }}</a><button type="button" class="nge-todo-mini" aria-label="Remove link" @click="removeCardLink(openCard, i)">×</button></span>
        </div>
        <div v-if="linkDraft?.for === openCard.id" class="nge-todo-row nge-todo-linkform">
          <select v-model="linkDraft.kind" class="nge-todo-select" aria-label="Kind of link">
            <option value="">Guess from the address</option>
            <option v-for="k in LINK_KINDS" :key="k.key" :value="k.key">{{ k.icon }} {{ k.word }}</option>
          </select>
          <input v-model="linkDraft.url" class="nge-todo-input nge-todo-grow" placeholder="https://..." aria-label="Address" @keydown.stop @keyup.stop @keypress.stop @keydown.enter.prevent="addCardLink(openCard)" />
          <input v-if="linkDraft.kind === 'other'" v-model="linkDraft.label" class="nge-todo-input nge-todo-short" maxlength="40" placeholder="Name" aria-label="Link name" @keydown.stop @keyup.stop @keypress.stop />
          <button type="button" class="nge-todo-btn" @click="addCardLink(openCard)">Add link</button>
          <button type="button" class="nge-todo-mini" @click="linkDraft = null">Cancel</button>
        </div>
        <button v-else type="button" class="nge-todo-btn nge-todo-add-btn" @click="linkDraft = { for: openCard.id, kind: '', url: '', label: '' }">＋ Link, like the test site</button>

        <div class="nge-todo-label nge-todo-label-row">Notes
          <button v-if="!notesEditing && openCard.notes" type="button" class="nge-todo-mini" @click="notesEditing = true">✎ Edit</button></div>
        <template v-if="notesEditing">
          <div class="nge-todo-fmtbar" role="toolbar" aria-label="Formatting">
            <button type="button" title="Bold" @click="fmtBold(cardBox)"><b>B</b></button>
            <button type="button" title="Bulleted list" @click="fmtList(cardBox, false)">• Bullets</button>
            <button type="button" title="Numbered list" @click="fmtList(cardBox, true)">1. Numbers</button>
            <button type="button" title="Select some lines, then click: they become checklist items" @click="cardToChecklist(openCard)">☑ Checklist</button>
            <button type="button" title="Add an image. You can also paste or drop one into the notes." @click="pickImages(openCard)">🖼 Image</button>
          </div>
          <textarea ref="cardNotesEl" v-model="editNotes" class="nge-todo-input" rows="7" maxlength="8000" placeholder="Type @ to tag someone. Select lines and click Checklist to turn them into items." aria-label="Notes"
                    @input="onMentionInput($event, v => editNotes = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop
                    data-nge-notes-paste @paste="onNotesPaste($event, openCard)" @dragover.prevent @drop="onNotesDrop($event, openCard)"></textarea>
          <div class="nge-todo-row">
            <button class="nge-todo-btn nge-todo-btn--primary" @click="saveNotes(openCard); notesEditing = false">Save notes</button>
            <button class="nge-todo-btn" @click="editNotes = openCard.notes; notesEditing = false">Cancel</button>
          </div>
        </template>
        <button v-else-if="!openCard.notes" class="nge-todo-btn nge-todo-add-btn" @click="notesEditing = true">＋ Add notes</button>
        <div v-else class="nge-todo-notes nge-todo-notes--edit nge-todo-md" title="Click to edit" @click="notesEditing = true" v-html="notesHtml(openCard.notes)"></div>

        <template v-if="(openCard.images || []).length || imageBusy">
          <div class="nge-todo-label">Images</div>
          <div class="nge-todo-images">
            <span v-for="(u, i) in openCard.images" :key="u" class="nge-todo-image"><a :href="u" target="_blank" rel="noopener" title="Open full size"><img :src="u" alt="" loading="lazy" /></a><button type="button" class="nge-todo-image-x" aria-label="Remove image" @click="removeCardImage(openCard, i)">×</button></span>
            <span v-if="imageBusy" class="nge-todo-warn">Uploading…</span>
          </div>
        </template>
        <button v-if="!notesEditing" type="button" class="nge-todo-btn nge-todo-add-btn" @click="pickImages(openCard)">🖼 Add an image</button>

        <div class="nge-todo-label">Checklist<template v-if="openCard.checklist.length"> · {{ checkCount(openCard).done }}/{{ checkCount(openCard).all }}</template></div>
        <ul class="nge-todo-check">
          <li v-for="(it, i) in openCard.checklist" :key="i" :class="{ 'nge-todo-check--done': it.done }">
            <label><input type="checkbox" :checked="it.done" @change="toggleItem(openCard, i)" /> <span v-if="itemOwner(it.text)" class="nge-todo-avatar nge-todo-avatar--small" :style="{ background: itemColor(it.text) }" :title="'For ' + itemName(it.text)">{{ itemName(it.text).slice(0, 1).toUpperCase() }}</span> <span><template v-for="(pt, k) in parts(it.text)" :key="k"><b v-if="pt.tag" class="nge-todo-tag">{{ pt.t }}</b><template v-else>{{ pt.t }}</template></template></span></label>
            <button class="nge-todo-mini" title="Comment on this item" @click="commentOn(it.text)">💬 Comment</button>
            <button class="nge-todo-mini" title="Remove this item" aria-label="Remove" @click="removeItem(openCard, i)">×</button>
          </li>
        </ul>
        <form class="nge-todo-row" @submit.prevent="addItem(openCard)">
          <input v-model="newItem" class="nge-todo-input nge-todo-grow" maxlength="300" placeholder="Add an item" aria-label="New checklist item"
                 @input="onMentionInput($event, v => newItem = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop />
          <button type="submit" class="nge-todo-btn" :disabled="!newItem.trim()">Add</button>
        </form>

        <div class="nge-todo-label">Comments</div>
        <div v-for="(cm, i) in openCard.comments" :key="i" class="nge-todo-comment">
          <div class="nge-todo-comment-by">{{ cm.by }} · {{ ago(cm.at) }}</div>
          <div class="nge-todo-notes"><template v-for="(pt, k) in parts(cm.text)" :key="k"><a v-if="pt.href" :href="pt.href" target="_blank" rel="noopener noreferrer">{{ pt.t }}</a><b v-else-if="pt.tag" class="nge-todo-tag">{{ pt.t }}</b><template v-else>{{ pt.t }}</template></template></div>
        </div>
        <textarea ref="commentEl" v-model="comment" class="nge-todo-input" rows="2" maxlength="2000" placeholder="Write a comment. Type @ to tag someone." aria-label="Comment"
                  @input="onMentionInput($event, v => comment = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop></textarea>
        <div class="nge-todo-row">
          <button class="nge-todo-btn nge-todo-btn--primary" :disabled="busy || !comment.trim()" @click="sendComment(openCard)">Comment</button>
        </div>

        <div class="nge-todo-foot">
          Added by {{ openCard.created_by || 'someone' }}, {{ ago(openCard.created_at) }}
          <button class="nge-todo-btn nge-todo-delete" @click="deleteCard(openCard)">Delete card</button>
        </div>
      </aside>
      </div>
    </div>

    <input ref="imagePicker" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden @change="onPicked" />
    <!-- The list of admins while typing a tag. -->
    <Teleport to="body">
      <ul v-if="mention && mentionMatches.length" class="nge-todo-mention" :class="{ 'nge-todo-mention--light': light }" role="listbox"
          :style="{ left: mention.el.getBoundingClientRect().left + 'px', top: mention.el.getBoundingClientRect().bottom + 4 + 'px' }">
        <li v-for="(p, i) in mentionMatches" :key="p.id" role="option" :aria-selected="i === mention.pick ? 'true' : 'false'"
            :class="{ 'nge-todo-mention--pick': i === mention.pick }" @mousedown.prevent="pickMention(p)">@{{ p.name }}</li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.nge-todo {
  --bg: #070b14; --col: rgba(255, 255, 255, 0.025); --line: rgba(124, 156, 255, 0.18); --card: #0f1626; --card-hi: #16203a;
  --text: #e6eefc; --dim: rgba(220, 230, 250, 0.62); --accent: #7c9cff; --accent-strong: #5b7cf0; --input: rgba(0, 0, 0, 0.3);
  display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; color: var(--text);
}
.nge-todo--light {
  --bg: #ffffff; --col: #f4f6fb; --line: #d3dae6; --card: #ffffff; --card-hi: #eef2fd;
  --text: #18212f; --dim: #5a6780; --accent: #4a63d6; --accent-strong: #3f5bd0; --input: #ffffff;
}
.nge-todo-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nge-todo-heading { font-size: 16px; font-weight: 700; }
.nge-todo-sub { font-size: 12.5px; color: var(--dim); flex: 1 1 260px; }
.nge-todo-status-input { font-size: 12.5px; }
.nge-todo-fmtbar { display: flex; gap: 4px; flex-wrap: wrap; }
.nge-todo-fmtbar button {
  font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 5px; cursor: pointer;
  background: transparent; border: 1px solid var(--line); color: var(--text);
}
.nge-todo-fmtbar button:hover { border-color: var(--accent); }
.nge-todo-card { position: relative; }
.nge-todo-card-tools { position: absolute; top: 4px; right: 4px; display: none; gap: 2px; background: var(--card); border-radius: 6px; }
.nge-todo-card:hover .nge-todo-card-tools, .nge-todo-card:focus-within .nge-todo-card-tools { display: flex; }
.nge-todo-card-status { font-size: 12px; color: var(--dim); margin-top: 3px; overflow-wrap: anywhere; }
.nge-todo-links { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.nge-todo-linkchip {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--accent); text-decoration: none; background: var(--card-hi);
}
.nge-todo-linkchip a { color: inherit; text-decoration: none; }
a.nge-todo-linkchip:hover, .nge-todo-linkchip a:hover { text-decoration: underline; }
.nge-todo-linkform { align-items: center; }
.nge-todo-short { width: 110px; }
.nge-todo-chip--late { color: #ff8b8b; border-color: rgba(255, 120, 120, 0.5); }
.nge-todo--light .nge-todo-chip--late { color: #b4231a; border-color: #e3aaa5; }
.nge-todo-images { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.nge-todo-image { position: relative; }
.nge-todo-image img { width: 84px; height: 62px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); display: block; }
.nge-todo-image-x {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 12px; line-height: 18px; padding: 0;
}
.nge-todo-label-row { display: flex; align-items: center; gap: 8px; }
.nge-todo-md :deep(p) { margin: 0 0 6px; }
.nge-todo-md :deep(ul), .nge-todo-md :deep(ol) { margin: 0 0 6px; padding-left: 20px; }
.nge-todo-md { white-space: normal; }
.nge-todo-list--folded { padding: 0; overflow: hidden; }
.nge-todo-rail {
  width: 100%; height: 100%; border: none; background: transparent; color: var(--text); cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0;
}
.nge-todo-rail .nge-todo-list-title { writing-mode: vertical-rl; }
.nge-todo-fold, .nge-todo-sort { font-size: 12px; }
.nge-todo-sort { margin-left: auto; }
/* Focus view: a strip of titles, and the open card in the middle. */
.nge-todo-strip {
  flex: 0 0 clamp(200px, 15vw, 280px); min-height: 0; overflow-y: auto; scrollbar-width: thin;
  display: flex; flex-direction: column; gap: 10px; padding-right: 2px;
}
.nge-todo-strip-list { display: flex; flex-direction: column; gap: 3px; }
.nge-todo-strip-head { font-size: 11.5px; font-weight: 700; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 4px; display: flex; gap: 6px; align-items: center; }
.nge-todo-strip-card {
  text-align: left; font: inherit; cursor: pointer; padding: 6px 8px; border-radius: 6px;
  background: transparent; border: 1px solid transparent; color: var(--text); display: flex; flex-direction: column; gap: 3px;
}
.nge-todo-strip-card:hover { background: var(--card); border-color: var(--line); }
.nge-todo-strip-card--on { background: var(--card-hi); border-color: var(--accent); }
.nge-todo-strip-title { font-size: 12.5px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.nge-todo-strip-meta { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--dim); flex-wrap: wrap; }
.nge-todo-strip-meta:empty { display: none; }
.nge-todo-strip-late { color: #ff8b8b; }
.nge-todo--light .nge-todo-strip-late { color: #b4231a; }
.nge-todo-strip-empty { font-size: 11.5px; color: var(--dim); padding: 2px 8px; }
.nge-todo-avatar--small { width: 16px; height: 16px; font-size: 9.5px; margin-left: 0; }
.nge-todo-focus { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; justify-content: center; }
.nge-todo-panel.nge-todo-panel--focus { flex: 1 1 auto; max-width: 920px; width: 100%; padding: 18px 22px; }
.nge-todo-panel--focus .nge-todo-panel-top { justify-content: flex-start; gap: 10px; }
.nge-todo-panel--focus .nge-todo-title-edit { font-size: 18px; }
.nge-todo-key {
  font: 12px/1.45 'Consolas', 'SF Mono', monospace; word-break: break-all; user-select: all;
  padding: 8px 10px; border-radius: 6px; border: 1px solid var(--accent); background: var(--card-hi);
}
.nge-todo-warn { font-size: 12px; color: var(--dim); }
.nge-todo-steps { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.5; display: flex; flex-direction: column; gap: 4px; }
.nge-todo-btn {
  background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--text);
  font: inherit; font-size: 12.5px; padding: 5px 10px; cursor: pointer;
}
.nge-todo-btn:hover:not(:disabled) { border-color: var(--accent); }
.nge-todo-btn:disabled { opacity: 0.5; cursor: default; }
.nge-todo-btn--primary { background: var(--accent-strong); border-color: var(--accent-strong); color: #fff; font-weight: 600; }
.nge-todo-x { background: none; border: none; color: var(--dim); font-size: 18px; cursor: pointer; line-height: 1; }
.nge-todo-error { font-size: 13px; color: #ff9b9b; }
.nge-todo--light .nge-todo-error { color: #a8271e; }
.nge-todo-empty { font-size: 13.5px; color: var(--dim); padding: 20px 0; }
.nge-todo-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; }
.nge-todo-lists { flex: 1 1 auto; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; min-height: 0; }
.nge-todo-list {
  min-height: 0; overflow-y: auto; padding: 0 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--col);
  scrollbar-width: thin;
}
.nge-todo-list--todo { border-top: 3px solid var(--accent); }
.nge-todo-list--doing { border-top: 3px solid #4fcfff; }
.nge-todo-list--done { border-top: 3px solid #5ee8a8; }
.nge-todo--light .nge-todo-list--doing { border-top-color: #2f8fd6; }
.nge-todo--light .nge-todo-list--done { border-top-color: #2e9e68; }
.nge-todo-list-head {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  padding: 10px 8px 8px; margin: 0 -8px; background: var(--col); backdrop-filter: blur(6px);
}
.nge-todo-list-title { font-weight: 700; font-size: 14px; }
.nge-todo-count { font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 9px; background: rgba(124, 156, 255, 0.16); }
.nge-todo-sizes { font: 600 11.5px 'Consolas', 'SF Mono', monospace; color: var(--accent); }
.nge-todo-list-hint { font-size: 11.5px; color: var(--dim); }
.nge-todo-list-empty { font-size: 12.5px; color: var(--dim); padding: 10px 4px; }
.nge-todo-add { margin: 2px 0 8px; }
.nge-todo-add-btn { width: 100%; border-style: dashed; }
.nge-todo-more { width: 100%; margin-top: 6px; }
.nge-todo-form { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); }
.nge-todo-input {
  background: var(--input); border: 1px solid var(--line); border-radius: 6px; color: var(--text);
  font: inherit; font-size: 13px; padding: 6px 9px; resize: vertical; box-sizing: border-box; width: 100%;
}
.nge-todo-input:focus { outline: none; border-color: var(--accent); }
.nge-todo-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nge-todo-grow { flex: 1 1 auto; width: auto; }
.nge-todo-card {
  background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
  cursor: grab; transition: border-color 0.12s, background 0.12s;
}
.nge-todo-card:hover { border-color: var(--accent); }
.nge-todo-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.nge-todo-card--open { background: var(--card-hi); border-color: var(--accent); }
.nge-todo-card--dragging { opacity: 0.4; }
.nge-todo-card--drop-above { box-shadow: 0 -3px 0 0 var(--accent); }
.nge-todo-card--drop-below { box-shadow: 0 3px 0 0 var(--accent); }
.nge-todo-drop-end { height: 3px; border-radius: 2px; background: var(--accent); margin: 2px 0 8px; }
.nge-todo-card-title { font-size: 13.5px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.nge-todo-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.nge-todo-card-meta:empty { display: none; }
.nge-todo-chip { font-size: 11.5px; color: var(--dim); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); }
.nge-todo-chip--all { color: #5ee8a8; border-color: rgba(94, 232, 168, 0.4); }
.nge-todo--light .nge-todo-chip--all { color: #1d7038; border-color: #9fd3b0; }
.nge-todo-avatar {
  margin-left: auto; width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center;
  background: var(--accent-strong); color: #fff; font-size: 11.5px; font-weight: 700;
}
.nge-todo-size {
  font: 700 11px/1 'Consolas', 'SF Mono', monospace; min-width: 22px; padding: 3px 7px; border-radius: 4px; cursor: pointer;
  display: inline-block; text-align: center; box-sizing: border-box;
  background: transparent; border: 1px solid var(--line); color: var(--accent);
}
.nge-todo-size--on { background: var(--accent-strong); border-color: var(--accent-strong); color: #fff; }
.nge-todo-sizepick { display: inline-flex; gap: 4px; }
.nge-todo-panel {
  flex: 0 0 360px; max-width: 42%; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); scrollbar-width: thin;
}
.nge-todo-panel-top { display: flex; justify-content: space-between; align-items: center; }
.nge-todo-title-edit { font-size: 15px; font-weight: 700; }
.nge-todo-select {
  background: var(--input); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font: inherit; font-size: 12.5px; padding: 4px 8px;
}
.nge-todo-field { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-todo-label { font-size: 11.5px; font-weight: 700; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.nge-todo-notes { font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-todo-notes a, .nge-todo-link { color: var(--accent); }
.nge-todo-notes--edit { cursor: text; border-radius: 6px; padding: 4px 6px; margin: 0 -6px; }
.nge-todo-notes--edit:hover { background: var(--card-hi); }
.nge-todo-link { font-size: 12.5px; }
.nge-todo-tag { color: var(--accent); font-weight: 700; }
.nge-todo-check { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.nge-todo-check li { display: flex; align-items: flex-start; gap: 6px; font-size: 13px; }
.nge-todo-check label { flex: 1 1 auto; display: flex; gap: 6px; align-items: flex-start; cursor: pointer; overflow-wrap: anywhere; }
.nge-todo-check input { accent-color: var(--accent-strong); margin-top: 3px; }
.nge-todo-check--done span { text-decoration: line-through; color: var(--dim); }
.nge-todo-mini { background: none; border: none; color: var(--dim); font-size: 11.5px; cursor: pointer; white-space: nowrap; }
.nge-todo-mini:hover { color: var(--accent); }
.nge-todo-comment { border-left: 2px solid var(--line); padding-left: 8px; }
.nge-todo-comment-by { font-size: 11.5px; color: var(--dim); }
.nge-todo-foot { margin-top: auto; padding-top: 10px; font-size: 11.5px; color: var(--dim); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.nge-todo-delete { color: #ff9b9b; border-color: rgba(255, 120, 120, 0.35); }
.nge-todo--light .nge-todo-delete { color: #a8271e; border-color: #e3aaa5; }
@media (max-width: 900px) {
  .nge-todo-body { flex-direction: column; }
  .nge-todo-lists { grid-template-columns: 1fr; }
  .nge-todo-panel { flex-basis: auto; max-width: none; }
  /* A narrow screen gives the card all of it. */
  .nge-todo-strip { display: none; }
}
</style>

<style>
/* Teleported to the body, so not scoped. */
.nge-todo-mention {
  position: fixed; z-index: 10050; list-style: none; margin: 0; padding: 4px; min-width: 180px;
  background: #0f1626; border: 1px solid rgba(124, 156, 255, 0.4); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font: 13px 'Inter', 'Roboto', system-ui, sans-serif; color: #e6eefc;
}
.nge-todo-mention li { padding: 5px 9px; border-radius: 5px; cursor: pointer; }
.nge-todo-mention--pick, .nge-todo-mention li:hover { background: #5b7cf0; color: #fff; }
.nge-todo-mention--light { background: #fff; border-color: #c9d2f2; color: #18212f; }
/* The To do board's own mark: a blue checked box, apart from the clipboard
   that means Copy everywhere else (Ames 2026-10-22). */
.nge-todo-icon { color: #7c9cff; vertical-align: -2px; margin-right: 4px; }
/* Round 2 (Ames 2026-10-22): blues, teal, golden yellow and pink. */
.nge-todo { --blue: #4f8cff; --teal: #2ec4b6; --gold: #f5c542; --pink: #ff6fae; --sky: #38bdf8; }
.nge-todo-list--todo { border-top: 3px solid var(--blue); }
.nge-todo-list--doing { border-top: 3px solid var(--teal); }
.nge-todo-list--done { border-top: 3px solid var(--gold) !important; }
.nge-todo-list--todo .nge-todo-list-title { color: var(--blue); }
.nge-todo-list--doing .nge-todo-list-title { color: var(--teal); }
.nge-todo-list--done .nge-todo-list-title { color: var(--gold); }
.nge-todo-list--todo .nge-todo-count { background: rgba(79, 140, 255, 0.2); }
.nge-todo-list--doing .nge-todo-count { background: rgba(46, 196, 182, 0.2); }
.nge-todo-list--done .nge-todo-count { background: rgba(245, 197, 66, 0.22); }
.nge-todo-list--todo .nge-todo-card { border-left: 3px solid rgba(79, 140, 255, 0.55); }
.nge-todo-list--doing .nge-todo-card { border-left: 3px solid rgba(46, 196, 182, 0.6); }
.nge-todo-list--done .nge-todo-card { border-left: 3px solid rgba(245, 197, 66, 0.55); }
.nge-todo-size--on { color: #fff !important; }
.nge-todo-card-meta .nge-todo-size--on { border: none; }
.nge-todo-size--on:is([title^="Small"]) { background: var(--teal); }
.nge-todo-size--on:is([title^="Medium"]) { background: var(--blue); }
.nge-todo-size--on:is([title^="Large"]) { background: var(--pink); }
.nge-todo-chip--person { color: var(--pc); border-color: color-mix(in srgb, var(--pc) 55%, transparent); }
.nge-todo-chip--person.nge-todo-chip--all { background: color-mix(in srgb, var(--pc) 18%, transparent); }
.nge-todo-waiting { margin-top: 5px; font-size: 11.5px; font-weight: 600; color: var(--pink); }
.nge-todo-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
.nge-todo-badge { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--line); color: var(--dim); }
.nge-todo-badge--live { color: #0b1a12; background: #5ee8a8; border-color: #5ee8a8; }
.nge-todo-badge--current { color: var(--teal); border-color: color-mix(in srgb, var(--teal) 60%, transparent); }
.nge-todo-badge--building { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 60%, transparent); }
.nge-todo-live-btn { color: #5ee8a8; }
.nge-todo-mine--on { border-color: var(--gold) !important; color: var(--gold); }
.nge-todo-quick { margin: 0 0 8px; }
.nge-todo-quick .nge-todo-input { width: 100%; box-sizing: border-box; border-color: rgba(79, 140, 255, 0.45); }
.nge-todo-stats { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px;
  background: linear-gradient(90deg, rgba(79, 140, 255, 0.08), rgba(46, 196, 182, 0.06), rgba(255, 111, 174, 0.06)); }
.nge-todo-nurro { width: 38px; height: 38px; object-fit: contain; }
.nge-todo-stat { display: flex; align-items: baseline; gap: 5px; font-size: 12px; color: var(--dim); padding: 0 8px; border-right: 1px solid var(--line); }
.nge-todo-stat:last-child { border-right: none; }
.nge-todo-stat b { font-size: 18px; color: var(--text); }
.nge-todo-stat--todo b { color: var(--blue); }
.nge-todo-stat--doing b { color: var(--teal); }
.nge-todo-stat--done b { color: var(--gold); }
.nge-todo-stat--late b { color: var(--pink); }
.nge-todo-personstat { color: var(--pc); font-weight: 600; margin-right: 6px; }
.nge-todo-personstat b { font-size: 14px; color: var(--pc); }
.nge-todo-stat-word { color: var(--dim); }
.nge-todo-cheer { position: fixed; right: 24px; bottom: 24px; z-index: 10060; display: flex; align-items: center; gap: 10px; padding: 10px 14px 10px 10px;
  border-radius: 12px; background: #0f1626; border: 1px solid var(--gold); color: #fff; font-weight: 600; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  animation: nge-todo-cheer-in 0.35s ease-out; }
.nge-todo-cheer img { width: 54px; height: 54px; object-fit: contain; }
@keyframes nge-todo-cheer-in { from { transform: translateY(20px) scale(0.9); opacity: 0; } to { transform: none; opacity: 1; } }
.nge-todo-list-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.nge-todo-nurro-empty { width: 54px; height: 54px; object-fit: contain; opacity: 0.85; }
/* Round 3 (Ames 2026-10-23): cards like the triage board's, and more fun. */
/* Wide lists show their cards two across, as the triage board does. */
.nge-todo-list:not(.nge-todo-list--folded) { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); column-gap: 10px; align-content: start; }
.nge-todo-list:not(.nge-todo-list--folded) > :not(.nge-todo-card) { grid-column: 1 / -1; }
.nge-todo-card { padding: 12px 14px; border-radius: 12px; transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
.nge-todo-card:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(46, 90, 200, 0.18); }
.nge-todo-card-title { font-size: 16.5px; font-weight: 700; line-height: 1.3; margin-right: 44px; }
.nge-todo-card-excerpt {
  margin-top: 6px; font-size: 13.5px; line-height: 1.45; color: var(--text); opacity: 0.85;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.nge-todo-card-by { margin-top: 8px; font-size: 12px; color: var(--dim); }
.nge-todo-list-icon { font-size: 15px; }
.nge-todo-list-title { font-size: 16px; }
.nge-todo-rail { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.nge-todo-list--doing { background: linear-gradient(180deg, rgba(46, 196, 182, 0.07), var(--col) 140px); }
.nge-todo-list--todo { background: linear-gradient(180deg, rgba(79, 140, 255, 0.07), var(--col) 140px); }
.nge-todo-list--done { background: linear-gradient(180deg, rgba(245, 197, 66, 0.08), var(--col) 140px); }
.nge-todo-head { padding: 8px 12px; border-radius: 12px;
  background: linear-gradient(90deg, rgba(79, 140, 255, 0.14), rgba(46, 196, 182, 0.12) 45%, rgba(245, 197, 66, 0.1) 75%, rgba(255, 111, 174, 0.12)); }
.nge-todo-heading { font-size: 19px; }
.nge-todo-nurro { width: 52px; height: 52px; animation: nge-todo-bob 6s ease-in-out infinite; }
/* A gentle breath, no tilt (Ames 2026-10-23: "more subtle animation"). */
@keyframes nge-todo-bob { 50% { transform: translateY(-1.5px); } }
@media (prefers-reduced-motion: reduce) { .nge-todo-nurro { animation: none; } .nge-todo-card:hover { transform: none; } }
/* Round 4 (Ames 2026-10-23). */
.nge-todo-list-head--fold { cursor: pointer; }
.nge-todo-list-head--fold:hover .nge-todo-list-title { text-decoration: underline; text-underline-offset: 3px; }
.nge-todo-nurro-empty { width: 110px; height: 110px; }
.nge-todo-nurro { width: 64px; height: 64px; }
/* An open card reads at a comfortable size: it was 13px and below. */
.nge-todo-panel--focus { font-size: 16px; }
.nge-todo-panel--focus .nge-todo-title-edit { font-size: 22px; font-weight: 700; }
.nge-todo-panel--focus .nge-todo-notes, .nge-todo-panel--focus .nge-todo-md { font-size: 16px; line-height: 1.55; }
.nge-todo-panel--focus .nge-todo-label { font-size: 13px; }
.nge-todo-panel--focus .nge-todo-check li, .nge-todo-panel--focus .nge-todo-check label { font-size: 15.5px; }
.nge-todo-panel--focus .nge-todo-input, .nge-todo-panel--focus .nge-todo-select, .nge-todo-panel--focus .nge-todo-btn { font-size: 14.5px; }
.nge-todo-panel--focus .nge-todo-comment-by { font-size: 13px; }
.nge-todo-panel.nge-todo-panel--focus { max-width: 1040px; }
.nge-todo-heading--home { cursor: pointer; }
.nge-todo-heading--home:hover { text-decoration: underline; text-underline-offset: 4px; }
</style>
