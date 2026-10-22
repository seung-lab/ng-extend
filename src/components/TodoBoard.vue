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
  const all = cards.value.filter(c => c.list === l.key).sort(l.key === 'todo' && todoByDue.value ? byDue : (a, b) => a.rank - b.rank);
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
const tagsIn = (text: string) => people.value.filter(p => text.includes('@' + p.name)).map(p => p.id);
const newTags = (before: string, after: string) => { const old = new Set(tagsIn(before)); return tagsIn(after).filter(id => !old.has(id)); };
const mention = shallowRef<{ el: HTMLTextAreaElement | HTMLInputElement; start: number; query: string; pick: number; set: (v: string) => void } | null>(null);
const mentionMatches = computed(() => {
  const q = (mention.value?.query || '').toLowerCase();
  return people.value.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6);
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
if (props.focusId) {
  const stop = setInterval(() => {
    const c = cards.value.find(x => x.id === props.focusId);
    if (c) { openUp(c); clearInterval(stop); }
    else if (!loading.value) clearInterval(stop);
  }, 200);
}
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
// Done folds to a narrow strip (Ames 2026-10-21: "a way to collapse Done").
const FOLD_KEY = 'nge_todo_done_folded_v1';
const doneFolded = ref((() => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } })());
function toggleDoneFold() {
  doneFolded.value = !doneFolded.value;
  try { localStorage.setItem(FOLD_KEY, doneFolded.value ? '1' : '0'); } catch { /* not remembered */ }
}
const listColumns = computed(() => (doneFolded.value ? 'minmax(0, 1fr) minmax(0, 1fr) 44px' : 'repeat(3, minmax(0, 1fr))'));

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
  let html = renderSafeMarkdown(text, true);
  for (const p of [...people.value].sort((a, b) => b.name.length - a.name.length)) {
    const esc = ('@' + p.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.split(esc).join(`<b class="nge-todo-tag">${esc}</b>`);
  }
  return html;
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
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="nge-todo" :class="{ 'nge-todo--light': light }">
    <div class="nge-todo-head">
      <button class="nge-todo-btn" @click="emit('back')" title="Back to the triage board">← Triage</button>
      <span class="nge-todo-heading">📋 To do board</span>
      <span class="nge-todo-sub">Our own planning, apart from player reports. Type @ to tag an admin: they get the bell in Pyr and a ping in Slack.</span>
      <button class="nge-todo-btn" @click="openConnect" title="Let your own Claude or ChatGPT work this board">🔌 Connect your AI</button>
      <button class="nge-todo-btn" :disabled="loading" @click="load">{{ loading ? 'Loading…' : '↻ Refresh' }}</button>
    </div>
    <div v-if="error" class="nge-todo-error" role="alert">⚠ {{ error }} <button class="nge-todo-x" @click="error = ''" aria-label="Close">×</button></div>
    <div v-if="notInstalled" class="nge-todo-empty">The To do board needs its table: run supabase-admin-todos.sql in the Supabase SQL editor, then Refresh.</div>

    <div v-else class="nge-todo-body">
      <div class="nge-todo-lists" :style="{ gridTemplateColumns: listColumns }">
        <section v-for="col in columns" :key="col.key" class="nge-todo-list" :class="[`nge-todo-list--${col.key}`, { 'nge-todo-list--folded': col.key === 'done' && doneFolded }]"
                 @dragover="onDragOverList($event, col.key)" @drop="onDrop($event, col.key)">
          <button v-if="col.key === 'done' && doneFolded" type="button" class="nge-todo-rail" title="Open Done" @click="toggleDoneFold">
            <span class="nge-todo-list-title">{{ col.title }}</span><span class="nge-todo-count">{{ col.rows.length }}</span>
          </button>
          <template v-else>
          <header class="nge-todo-list-head">
            <button v-if="col.key === 'done'" type="button" class="nge-todo-mini nge-todo-fold" title="Fold Done away" @click="toggleDoneFold">◂</button>
            <span class="nge-todo-list-title">{{ col.title }}</span>
            <span class="nge-todo-count">{{ col.rows.length }}</span>
            <span v-if="col.key === 'todo' && sizeSummary.length" class="nge-todo-sizes" title="Sizes waiting in To do">
              <template v-for="(x, i) in sizeSummary" :key="x.s">{{ i ? ' · ' : '' }}{{ x.n }} {{ x.s }}</template>
            </span>
            <span class="nge-todo-list-hint">{{ col.hint }}</span>
            <button v-if="col.key === 'todo'" type="button" class="nge-todo-mini nge-todo-sort" :title="todoByDue ? 'Showing by due day. Click for your own order.' : 'Showing your own order. Click to sort by due day.'"
                    @click="toggleTodoSort">{{ todoByDue ? '⇅ By due day' : '⇅ My order' }}</button>
          </header>

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
                        @paste="onNotesPaste($event, 'new')" @dragover.prevent @drop="onNotesDrop($event, 'new')"></textarea>
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
            <div v-if="c.status" class="nge-todo-card-status">{{ c.status }}</div>
            <div v-if="(c.links || []).length" class="nge-todo-links" @click.stop>
              <a v-for="(l, i) in c.links" :key="i" class="nge-todo-linkchip" :href="l.url" target="_blank" rel="noopener noreferrer" :title="l.url" draggable="false">{{ linkIcon(l) }} {{ linkWord(l) }}</a>
            </div>
            <div class="nge-todo-card-meta">
              <span v-if="c.size" class="nge-todo-size nge-todo-size--on" :title="SIZE_WORDS[c.size]">{{ c.size }}</span>
              <span v-if="c.due_on" class="nge-todo-chip" :class="{ 'nge-todo-chip--late': isOverdue(c) }" :title="'Due ' + c.due_on">{{ dueWords(c.due_on) }}</span>
              <span v-if="c.checklist.length" class="nge-todo-chip" :class="{ 'nge-todo-chip--all': checkCount(c).done === checkCount(c).all }" title="Checklist">☑ {{ checkCount(c).done }}/{{ checkCount(c).all }}</span>
              <span v-if="(c.images || []).length" class="nge-todo-chip" title="Images">🖼 {{ c.images.length }}</span>
              <span v-if="c.comments.length" class="nge-todo-chip" title="Comments">💬 {{ c.comments.length }}</span>
              <span v-if="c.triage_id" class="nge-todo-chip" title="Made from a player report">{{ reportLabel(c.triage_id) }}</span>
              <span v-if="c.owner_id" class="nge-todo-avatar" :title="'Owner: ' + nameOf(c.owner_id)">{{ initialOf(c.owner_id) }}</span>
            </div>
          </article>
          <div v-if="dropAt?.list === col.key && !dropAt.id" class="nge-todo-drop-end"></div>
          <div v-if="!col.rows.length && !loading" class="nge-todo-list-empty">{{ col.empty }}</div>
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

      <!-- The open card: a narrow panel at the side, the lists stay in view. -->
      <aside v-if="openCard" class="nge-todo-panel" :key="openCard.id" aria-label="Card">
        <div class="nge-todo-panel-top">
          <select class="nge-todo-select" :value="openCard.list" aria-label="List" @change="onListChange(openCard, $event)">
            <option v-for="l in LISTS" :key="l.key" :value="l.key">{{ l.title }}</option>
          </select>
          <button class="nge-todo-x" @click="openId = null" aria-label="Close" title="Close (Esc)">×</button>
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
                    @paste="onNotesPaste($event, openCard)" @dragover.prevent @drop="onNotesDrop($event, openCard)"></textarea>
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
            <label><input type="checkbox" :checked="it.done" @change="toggleItem(openCard, i)" /> <span><template v-for="(pt, k) in parts(it.text)" :key="k"><b v-if="pt.tag" class="nge-todo-tag">{{ pt.t }}</b><template v-else>{{ pt.t }}</template></template></span></label>
            <button class="nge-todo-mini" title="Make this its own card in To do" @click="itemToCard(openCard, i)">↗ Card</button>
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
        <textarea v-model="comment" class="nge-todo-input" rows="2" maxlength="2000" placeholder="Write a comment. Type @ to tag someone." aria-label="Comment"
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
</style>
