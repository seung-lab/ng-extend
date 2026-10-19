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

const props = defineProps<{ light?: boolean; focusId?: string | null; reportNumbers?: Record<string, number>; standalone?: boolean }>();
const emit = defineEmits<{ (e: 'back'): void }>();

type ListKey = 'todo' | 'doing' | 'done';
type Size = 'S' | 'M' | 'L';
interface Card {
  id: string; title: string; notes: string; list: ListKey; rank: number; size: Size | null;
  owner_id: string | null; checklist: { text: string; done: boolean }[];
  comments: { by: string; text: string; at: string }[];
  triage_id: string | null; created_by: string | null; created_at: string; updated_at: string; done_at: string | null;
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
  const all = cards.value.filter(c => c.list === l.key).sort((a, b) => a.rank - b.rank);
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
const draft = ref({ title: '', notes: '', size: null as Size | null });
async function addCard(list: ListKey) {
  const title = draft.value.title.trim();
  if (!title || busy.value) return;
  busy.value = true;
  try {
    const { card } = await secureWrite<any>('todo.save', { fields: { title, notes: draft.value.notes, size: draft.value.size, list },
      tagIds: tagsIn(title + ' ' + draft.value.notes) });
    if (card) put(card);
    draft.value = { title: '', notes: '', size: null };
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
  openId.value = c.id;
  editTitle.value = c.title;
  editNotes.value = c.notes;
  newItem.value = '';
  comment.value = '';
  notesEditing.value = false;
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

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && openId.value && !(e.target as HTMLElement)?.closest?.('textarea, input')) openId.value = null;
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
      <button class="nge-todo-btn" :disabled="loading" @click="load">{{ loading ? 'Loading…' : '↻ Refresh' }}</button>
    </div>
    <div v-if="error" class="nge-todo-error" role="alert">⚠ {{ error }} <button class="nge-todo-x" @click="error = ''" aria-label="Close">×</button></div>
    <div v-if="notInstalled" class="nge-todo-empty">The To do board needs its table: run supabase-admin-todos.sql in the Supabase SQL editor, then Refresh.</div>

    <div v-else class="nge-todo-body">
      <div class="nge-todo-lists">
        <section v-for="col in columns" :key="col.key" class="nge-todo-list" :class="`nge-todo-list--${col.key}`"
                 @dragover="onDragOverList($event, col.key)" @drop="onDrop($event, col.key)">
          <header class="nge-todo-list-head">
            <span class="nge-todo-list-title">{{ col.title }}</span>
            <span class="nge-todo-count">{{ col.rows.length }}</span>
            <span v-if="col.key === 'todo' && sizeSummary.length" class="nge-todo-sizes" title="Sizes waiting in To do">
              <template v-for="(x, i) in sizeSummary" :key="x.s">{{ i ? ' · ' : '' }}{{ x.n }} {{ x.s }}</template>
            </span>
            <span class="nge-todo-list-hint">{{ col.hint }}</span>
          </header>

          <div v-if="col.key !== 'done'" class="nge-todo-add">
            <button v-if="adding !== col.key" class="nge-todo-btn nge-todo-add-btn" @click="adding = col.key; draft = { title: '', notes: '', size: null }">＋ Add a card</button>
            <form v-else class="nge-todo-form" @submit.prevent="addCard(col.key)">
              <input v-model="draft.title" class="nge-todo-input" maxlength="200" placeholder="What needs doing" aria-label="Title"
                     @input="onMentionInput($event, v => draft.title = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop />
              <textarea v-model="draft.notes" class="nge-todo-input" rows="3" maxlength="8000" placeholder="Notes (optional). Type @ to tag someone." aria-label="Notes"
                        @input="onMentionInput($event, v => draft.notes = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop></textarea>
              <div class="nge-todo-row">
                <span class="nge-todo-sizepick" role="radiogroup" aria-label="Size">
                  <button v-for="s in SIZES" :key="s" type="button" role="radio" class="nge-todo-size" :class="{ 'nge-todo-size--on': draft.size === s }"
                          :aria-checked="draft.size === s ? 'true' : 'false'" :title="SIZE_WORDS[s]" @click="draft.size = draft.size === s ? null : s">{{ s }}</button>
                </span>
                <button type="submit" class="nge-todo-btn nge-todo-btn--primary" :disabled="busy || !draft.title.trim()">{{ busy ? 'Adding…' : 'Add' }}</button>
                <button type="button" class="nge-todo-btn" @click="adding = null">Cancel</button>
              </div>
            </form>
          </div>

          <article v-for="c in col.rows" :key="c.id" class="nge-todo-card" draggable="true"
                   :class="{ 'nge-todo-card--open': openId === c.id, 'nge-todo-card--dragging': dragId === c.id,
                             'nge-todo-card--drop-above': dropAt?.id === c.id && !dropAt.after, 'nge-todo-card--drop-below': dropAt?.id === c.id && dropAt.after }"
                   tabindex="0" @click="openUp(c)" @keydown.enter="openUp(c)"
                   @dragstart="onDragStart($event, c)" @dragend="onDragEnd" @dragover="onDragOverCard($event, col.key, c)">
            <div class="nge-todo-card-title">{{ c.title }}</div>
            <div class="nge-todo-card-meta">
              <span v-if="c.size" class="nge-todo-size nge-todo-size--on" :title="SIZE_WORDS[c.size]">{{ c.size }}</span>
              <span v-if="c.checklist.length" class="nge-todo-chip" :class="{ 'nge-todo-chip--all': checkCount(c).done === checkCount(c).all }" title="Checklist">☑ {{ checkCount(c).done }}/{{ checkCount(c).all }}</span>
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
        </section>
      </div>

      <!-- The open card: a narrow panel at the side, the lists stay in view. -->
      <aside v-if="openCard" class="nge-todo-panel" :key="openCard.id" aria-label="Card">
        <div class="nge-todo-panel-top">
          <select class="nge-todo-select" :value="openCard.list" aria-label="List" @change="onListChange(openCard, $event)">
            <option v-for="l in LISTS" :key="l.key" :value="l.key">{{ l.title }}</option>
          </select>
          <button class="nge-todo-x" @click="openId = null" aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <input v-model="editTitle" class="nge-todo-input nge-todo-title-edit" maxlength="200" aria-label="Title"
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

        <div class="nge-todo-label">Notes</div>
        <template v-if="notesEditing">
          <textarea v-model="editNotes" class="nge-todo-input" rows="5" maxlength="8000" placeholder="Type @ to tag someone." aria-label="Notes"
                    @input="onMentionInput($event, v => editNotes = v)" @keydown="onMentionKey" @keyup.stop @keypress.stop></textarea>
          <div class="nge-todo-row">
            <button class="nge-todo-btn nge-todo-btn--primary" @click="saveNotes(openCard); notesEditing = false">Save notes</button>
            <button class="nge-todo-btn" @click="editNotes = openCard.notes; notesEditing = false">Cancel</button>
          </div>
        </template>
        <button v-else-if="!openCard.notes" class="nge-todo-btn nge-todo-add-btn" @click="notesEditing = true">＋ Add notes</button>
        <div v-else class="nge-todo-notes nge-todo-notes--edit" title="Click to edit" @click="notesEditing = true"><template v-for="(pt, i) in parts(openCard.notes)" :key="i"><a v-if="pt.href" :href="pt.href" target="_blank" rel="noopener noreferrer">{{ pt.t }}</a><b v-else-if="pt.tag" class="nge-todo-tag">{{ pt.t }}</b><template v-else>{{ pt.t }}</template></template></div>

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
