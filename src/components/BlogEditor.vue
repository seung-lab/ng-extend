<script setup lang="ts">
/**
 * Write and publish posts for connectome.quest/blog (Ames 2026-10-02).
 * Shown as the Blog tab of your own profile, only to the people listed in
 * blog_authors. The server enforces that list (functions/community-data.js);
 * this panel is just the editor. Posts are stored in Supabase blog_posts and
 * the public site reads the published ones.
 *
 * The post is written like a document (Ames 2026-10-03: "we don't want to
 * write in HTML ... normal document formatting that can be applied with
 * buttons"). The page is an editable area; the toolbar formats what is
 * selected. On save the document becomes the blog's safe stored text
 * (util/blog_document.ts), so nothing an author pastes can carry code.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { supabase } from '../supabase';
import { secureUpload } from '../secure_upload';
import { blogSlug, renderBlogMarkdown } from '../util/blog_markdown';
import { documentToMarkdown, tidyLink, youtubeId } from '../util/blog_document';

interface Post {
  id: number; slug: string; title: string; summary: string | null; body: string; cover_url: string | null;
  status: 'draft' | 'published'; author_name: string; published_at: string | null; updated_at: string;
}

const SITE = 'https://connectome.quest/blog/';
const posts = ref<Post[]>([]);
const loading = ref(true);
const message = ref('');
const problem = ref('');
const busy = ref(false);

// The post being edited. id null = a new post.
const editing = ref(false);
const id = ref<number | null>(null);
const title = ref('');
const slug = ref('');
const slugTouched = ref(false);
const summary = ref('');
const coverUrl = ref('');
const status = ref<'draft' | 'published'>('draft');
const publishedAt = ref<string | null>(null);
const showPreview = ref(false);
const previewHtml = ref('');
const docEl = ref<HTMLElement | null>(null);
const confirmDelete = ref(false);

const postUrl = computed(() => `${SITE}post.html?p=${encodeURIComponent(slug.value)}`);
watch(title, t => { if (!slugTouched.value && id.value === null) slug.value = blogSlug(t); });

async function load() {
  loading.value = true;
  const { data, error } = await supabase.from('blog_posts')
    .select('id,slug,title,summary,body,cover_url,status,author_name,published_at,updated_at')
    .order('updated_at', { ascending: false }).limit(200);
  loading.value = false;
  if (error) { problem.value = 'Could not load posts: ' + error.message; return; }
  posts.value = (data ?? []) as Post[];
}
onMounted(load);

const EMPTY = '<p><br></p>';
async function open(p: Post | null) {
  id.value = p?.id ?? null;
  title.value = p?.title ?? '';
  slug.value = p?.slug ?? '';
  slugTouched.value = !!p;
  summary.value = p?.summary ?? '';
  coverUrl.value = p?.cover_url ?? '';
  status.value = p?.status ?? 'draft';
  publishedAt.value = p?.published_at ?? null;
  showPreview.value = false;
  confirmDelete.value = false;
  ask.value = null;
  message.value = '';
  problem.value = '';
  editing.value = true;
  await nextTick();
  if (docEl.value) {
    // Safe: renderBlogMarkdown escapes everything and adds a short list of tags.
    docEl.value.innerHTML = renderBlogMarkdown(p?.body ?? '', true) || EMPTY;
    // Every picture gets a caption line to type in (empty ones are not saved).
    docEl.value.querySelectorAll('figure').forEach(f => { if (!f.querySelector('figcaption')) f.appendChild(document.createElement('figcaption')); });
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, 'false'); } catch { /* old browser */ }
  }
}
function back() { editing.value = false; message.value = ''; problem.value = ''; void load(); }

const bodyText = () => docEl.value ? documentToMarkdown(docEl.value) : '';
function togglePreview() {
  if (!showPreview.value) previewHtml.value = renderBlogMarkdown(bodyText());
  showPreview.value = !showPreview.value;
}

async function save(next: 'draft' | 'published') {
  problem.value = ''; message.value = '';
  const body = bodyText();
  if (!title.value.trim()) { problem.value = 'Give the post a title.'; return; }
  if (!body.trim()) { problem.value = 'Write something first.'; return; }
  const s = blogSlug(slug.value || title.value);
  if (!s) { problem.value = 'The web address needs at least one letter or number.'; return; }
  slug.value = s;
  busy.value = true;
  const row: Record<string, unknown> = {
    slug: s, title: title.value.trim(), summary: summary.value.trim() || null, body,
    cover_url: coverUrl.value || '', status: next,
  };
  if (next === 'published' && publishedAt.value) row.published_at = publishedAt.value;
  const q = id.value === null
    ? supabase.from('blog_posts').insert(row).select('id,status,published_at').single()
    : supabase.from('blog_posts').update(row).eq('id', id.value).select('id,status,published_at').single();
  const { data, error } = await q;
  busy.value = false;
  if (error || !data) {
    problem.value = /duplicate|unique|409/i.test(error?.message || '') || (error as any)?.code === '23505'
      ? 'Another post already uses that web address. Change it and try again.'
      : 'Could not save: ' + (error?.message || 'no answer from the server');
    return;
  }
  id.value = (data as any).id;
  status.value = (data as any).status;
  publishedAt.value = (data as any).published_at ?? null;
  slugTouched.value = true;
  message.value = next === 'published' ? 'Published. It is on the blog now.' : 'Saved as a draft. Only authors can see it.';
}

async function remove() {
  if (id.value === null) { back(); return; }
  busy.value = true;
  const { error } = await supabase.from('blog_posts').delete().eq('id', id.value);
  busy.value = false;
  if (error) { problem.value = 'Could not delete: ' + error.message; return; }
  back();
}

// ── The document: selection, formatting, blocks ─────────────────────────
let savedRange: Range | null = null;
const inDoc = (n: Node | null) => !!n && !!docEl.value && docEl.value.contains(n);
function keepSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && inDoc(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSelection() {
  const el = docEl.value;
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  if (!savedRange || !inDoc(savedRange.startContainer)) {
    savedRange = document.createRange();
    savedRange.selectNodeContents(el);
    savedRange.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(savedRange);
}
const cmd = (name: string, value?: string) => { restoreSelection(); document.execCommand(name, false, value); keepSelection(); refreshState(); };

/** The top-level block of the document that holds the caret. */
function currentBlock(): HTMLElement | null {
  const el = docEl.value;
  let n: Node | null = savedRange?.startContainer ?? null;
  if (!el || !n || !inDoc(n)) return null;
  while (n && n.parentNode !== el) n = n.parentNode;
  return n && n.nodeType === Node.ELEMENT_NODE ? n as HTMLElement : null;
}
function caretInto(node: Node, atEnd = false) {
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  savedRange = r.cloneRange();
}
/** Put a block after the one holding the caret, with a fresh paragraph to carry on in. */
function insertBlock(node: HTMLElement) {
  const el = docEl.value;
  if (!el) return;
  el.focus();
  const here = currentBlock();
  const emptyHere = here && here.tagName === 'P' && !here.textContent?.trim() && !here.querySelector('img');
  if (here) here.after(node); else el.appendChild(node);
  if (emptyHere) here!.remove();
  let next = node.nextElementSibling as HTMLElement | null;
  if (!next || next.tagName !== 'P') {
    next = document.createElement('p');
    next.appendChild(document.createElement('br'));
    node.after(next);
  }
  caretInto(next);
  refreshState();
}

// What the selection is, for the toolbar's lit buttons and the style menu.
const isBold = ref(false), isItalic = ref(false), isUl = ref(false), isOl = ref(false), isQuote = ref(false), isCallout = ref(false);
const blockStyle = ref<'p' | 'h2' | 'h3'>('p');
function refreshState() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !inDoc(sel.anchorNode)) return;
  try {
    isBold.value = document.queryCommandState('bold');
    isItalic.value = document.queryCommandState('italic');
    isUl.value = document.queryCommandState('insertUnorderedList');
    isOl.value = document.queryCommandState('insertOrderedList');
  } catch { /* not supported */ }
  const at = sel.anchorNode!.nodeType === Node.ELEMENT_NODE ? sel.anchorNode as HTMLElement : sel.anchorNode!.parentElement;
  isQuote.value = !!at?.closest('blockquote');
  isCallout.value = !!at?.closest('aside');
  const h = at?.closest('h1,h2,h3,h4');
  blockStyle.value = !h || !inDoc(h) ? 'p' : /^H[12]$/.test(h.tagName) ? 'h2' : 'h3';
}
const onSelection = () => { keepSelection(); refreshState(); };
onMounted(() => document.addEventListener('selectionchange', onSelection));
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelection));

// Clicking a tool must not take the selection out of the document.
function toolsMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement).tagName !== 'SELECT') e.preventDefault();
}
function setStyle(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  cmd('formatBlock', v);
}
function toggleQuote() {
  if (isQuote.value) cmd('outdent'); else cmd('formatBlock', 'blockquote');
}
function toggleCallout() {
  restoreSelection();
  const here = currentBlock();
  if (!here) return;
  if (here.tagName === 'ASIDE') {                       // take the box away, keep the words
    const last = here.lastElementChild;
    here.replaceWith(...Array.from(here.childNodes));
    if (last) caretInto(last, true);
  } else {
    const box = document.createElement('aside');
    box.className = 'blog-post__callout';
    here.replaceWith(box);
    if (/^(P|H1|H2|H3|H4)$/.test(here.tagName)) box.appendChild(here);
    else { const p = document.createElement('p'); p.textContent = here.textContent || ''; if (!p.textContent) p.appendChild(document.createElement('br')); box.appendChild(p); }
    caretInto(box.lastElementChild!, true);
    if (!box.nextElementSibling) { const p = document.createElement('p'); p.appendChild(document.createElement('br')); box.after(p); }
  }
  refreshState();
}
function addDivider() {
  restoreSelection();
  insertBlock(document.createElement('hr'));
}

// Small questions asked under the toolbar (a link, a button, a video).
const ask = ref<null | 'link' | 'button' | 'video'>(null);
const askUrl = ref('');
const askText = ref('');
const askError = ref('');
const askEl = ref<HTMLInputElement | null>(null);
async function openAsk(kind: 'link' | 'button' | 'video') {
  keepSelection();
  askError.value = '';
  askText.value = kind === 'button' ? (savedRange && !savedRange.collapsed ? savedRange.toString().slice(0, 60) : '') : '';
  const sel = window.getSelection();
  const at = sel?.anchorNode ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode as HTMLElement : sel.anchorNode.parentElement) : null;
  askUrl.value = kind === 'link' ? (at?.closest('a')?.getAttribute('href') || '') : '';
  ask.value = ask.value === kind ? null : kind;
  await nextTick();
  askEl.value?.focus();
}
function applyAsk() {
  askError.value = '';
  if (ask.value === 'video') {
    const vid = youtubeId(askUrl.value);
    if (!vid) { askError.value = 'Paste a YouTube link, like https://youtu.be/...'; return; }
    restoreSelection();
    const holder = document.createElement('div');
    holder.innerHTML = renderBlogMarkdown(`@[youtube](${vid})`, true);
    insertBlock(holder.firstElementChild as HTMLElement);
  } else {
    const url = tidyLink(askUrl.value);
    if (!url) { askError.value = 'That does not look like a web address.'; return; }
    if (ask.value === 'button') {
      const text = askText.value.trim();
      if (!text) { askError.value = 'Say what the button should read.'; return; }
      restoreSelection();
      const p = document.createElement('p');
      p.className = 'blog-post__cta';
      const a = document.createElement('a');
      a.className = 'blog-post__button';
      a.href = url;
      a.textContent = text;
      p.appendChild(a);
      insertBlock(p);
    } else {
      restoreSelection();
      if (savedRange && savedRange.collapsed) {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url.replace(/^https:\/\//, '');
        savedRange.insertNode(a);
        caretInto(a, true);
      } else document.execCommand('createLink', false, url);
    }
  }
  ask.value = null;
  keepSelection();
}
function removeLink() { cmd('unlink'); ask.value = null; }

async function pickImages(many: boolean): Promise<string[]> {
  keepSelection();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.multiple = many;
  const files = await new Promise<File[]>(resolve => {
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
  if (!files.length) return [];
  problem.value = ''; busy.value = true;
  try {
    const urls: string[] = [];
    for (const f of files.slice(0, many ? 2 : 1)) urls.push(await secureUpload(f, 'blog'));
    return urls;
  } catch (e: any) { problem.value = e?.message || 'Image upload failed.'; return []; }
  finally { busy.value = false; }
}
function figure(url: string): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'blog-post__figure';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  fig.append(img, document.createElement('figcaption'));
  return fig;
}
async function addImage() {
  const [url] = await pickImages(false);
  if (!url) return;
  restoreSelection();
  insertBlock(figure(url));
}
async function addImagePair() {
  const urls = await pickImages(true);
  if (!urls.length) return;
  if (urls.length < 2) { problem.value = 'Pick two images to put them side by side. One was added on its own.'; restoreSelection(); insertBlock(figure(urls[0])); return; }
  const pair = document.createElement('div');
  pair.className = 'blog-post__pair';
  pair.append(figure(urls[0]), figure(urls[1]));
  restoreSelection();
  insertBlock(pair);
}
async function addCover() {
  const [url] = await pickImages(false);
  if (url) coverUrl.value = url;
}

// Pasting brings in words only, never another page's styling or code.
function onPaste(e: ClipboardEvent) {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const paras = text.replace(/\r\n?/g, '\n').split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (!paras.length) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (paras.length === 1) document.execCommand('insertText', false, paras[0]);
  else document.execCommand('insertHTML', false, paras.map(x => `<p>${esc(x)}</p>`).join(''));
}
// Click a picture or a video to select it, so Delete removes it.
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const block = t.closest('.blog-post__video') || (t.tagName === 'IMG' ? t.closest('figure') : null);
  if (!block || !inDoc(block)) return;
  const r = document.createRange();
  r.selectNode(block);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
function onDocKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); void openAsk('link'); }
  else if (k === 's') { e.preventDefault(); void save(status.value); }
}

const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
</script>

<template>
  <div class="nge-blog">
    <!-- List -->
    <template v-if="!editing">
      <div class="nge-blog-head">
        <div>
          <h3>Blog</h3>
          <p>Posts appear on <a :href="SITE" target="_blank" rel="noopener noreferrer">connectome.quest/blog</a> as soon as you publish.</p>
        </div>
        <button class="nge-blog-btn nge-blog-btn--primary" @click="open(null)">Write a post</button>
      </div>
      <p v-if="problem" class="nge-blog-problem" role="alert">{{ problem }}</p>
      <p v-if="loading" class="nge-blog-note">Loading posts...</p>
      <p v-else-if="!posts.length && !problem" class="nge-blog-note">No posts yet. Write the first one.</p>
      <button v-for="p in posts" :key="p.id" class="nge-blog-row" @click="open(p)">
        <span class="nge-blog-row-title">{{ p.title }}</span>
        <span class="nge-blog-row-meta">
          <span class="nge-blog-pill" :class="'nge-blog-pill--' + p.status">{{ p.status === 'published' ? 'Published' : 'Draft' }}</span>
          {{ p.author_name }} · {{ p.status === 'published' ? when(p.published_at) : 'edited ' + when(p.updated_at) }}
        </span>
      </button>
    </template>

    <!-- Editor -->
    <template v-else>
      <div class="nge-blog-head">
        <button class="nge-blog-btn" @click="back">← All posts</button>
        <span class="nge-blog-pill" :class="'nge-blog-pill--' + status">{{ id === null ? 'New post' : status === 'published' ? 'Published' : 'Draft' }}</span>
      </div>

      <label class="nge-blog-field">
        <span>Title</span>
        <input v-model="title" maxlength="160" placeholder="What is the post about?" />
      </label>
      <label class="nge-blog-field">
        <span>Web address</span>
        <div class="nge-blog-slug">
          <code>connectome.quest/blog/post.html?p=</code>
          <input v-model="slug" maxlength="80" placeholder="made-from-the-title" @input="slugTouched = true" />
        </div>
      </label>
      <label class="nge-blog-field">
        <span>Summary <em>(shown in the list of posts)</em></span>
        <textarea v-model="summary" rows="2" maxlength="400" placeholder="One or two sentences."></textarea>
      </label>

      <div class="nge-blog-field">
        <span>Feature image <em>(optional, shown in the list and at the top of the post)</em></span>
        <div class="nge-blog-cover">
          <img v-if="coverUrl" :src="coverUrl" alt="Feature image" />
          <button class="nge-blog-btn" :disabled="busy" @click="addCover">{{ coverUrl ? 'Replace' : 'Upload an image' }}</button>
          <button v-if="coverUrl" class="nge-blog-btn" @click="coverUrl = ''">Remove</button>
        </div>
      </div>

      <div class="nge-blog-field">
        <span>Post</span>
        <div class="nge-blog-editor">
          <div class="nge-blog-tools" role="toolbar" aria-label="Formatting" @mousedown="toolsMouseDown">
            <button class="nge-blog-tool" title="Undo (Ctrl+Z)" aria-label="Undo" :disabled="showPreview" @click="cmd('undo')">↶</button>
            <button class="nge-blog-tool" title="Redo (Ctrl+Y)" aria-label="Redo" :disabled="showPreview" @click="cmd('redo')">↷</button>
            <span class="nge-blog-sep"></span>
            <select class="nge-blog-style" aria-label="Text style" :value="blockStyle" :disabled="showPreview" @mousedown="keepSelection" @change="setStyle">
              <option value="p">Normal text</option>
              <option value="h2">Heading</option>
              <option value="h3">Small heading</option>
            </select>
            <button class="nge-blog-tool nge-blog-tool--b" :class="{ on: isBold }" title="Bold (Ctrl+B)" aria-label="Bold" :disabled="showPreview" @click="cmd('bold')">B</button>
            <button class="nge-blog-tool nge-blog-tool--i" :class="{ on: isItalic }" title="Italic (Ctrl+I)" aria-label="Italic" :disabled="showPreview" @click="cmd('italic')">I</button>
            <span class="nge-blog-sep"></span>
            <button class="nge-blog-tool" :class="{ on: isUl }" title="Bulleted list" :disabled="showPreview" @click="cmd('insertUnorderedList')">• List</button>
            <button class="nge-blog-tool" :class="{ on: isOl }" title="Numbered list" :disabled="showPreview" @click="cmd('insertOrderedList')">1. List</button>
            <button class="nge-blog-tool" :class="{ on: isQuote }" title="Quote" :disabled="showPreview" @click="toggleQuote">Quote</button>
            <button class="nge-blog-tool" :class="{ on: isCallout }" title="A highlighted box for a tip or a warning" :disabled="showPreview" @click="toggleCallout">Callout</button>
            <span class="nge-blog-sep"></span>
            <button class="nge-blog-tool" :class="{ on: ask === 'link' }" title="Link (Ctrl+K)" :disabled="showPreview" @click="openAsk('link')">Link</button>
            <button class="nge-blog-tool" :class="{ on: ask === 'button' }" title="A big button that opens a link" :disabled="showPreview" @click="openAsk('button')">Button</button>
            <span class="nge-blog-sep"></span>
            <button class="nge-blog-tool" title="Add an image" :disabled="busy || showPreview" @click="addImage">Image</button>
            <button class="nge-blog-tool" title="Two images side by side" :disabled="busy || showPreview" @click="addImagePair">2 images</button>
            <button class="nge-blog-tool" :class="{ on: ask === 'video' }" title="A YouTube video" :disabled="showPreview" @click="openAsk('video')">Video</button>
            <button class="nge-blog-tool" title="A line between sections" :disabled="showPreview" @click="addDivider">Divider</button>
            <span class="nge-blog-grow"></span>
            <button class="nge-blog-tool" :class="{ on: showPreview }" title="See the post as readers will" @click="togglePreview">{{ showPreview ? 'Keep writing' : 'Preview' }}</button>
          </div>

          <form v-if="ask && !showPreview" class="nge-blog-ask" @submit.prevent="applyAsk">
            <input v-if="ask === 'button'" v-model="askText" maxlength="60" placeholder="What the button says" aria-label="Button text" @keydown.stop @keydown.esc.prevent="ask = null" />
            <input ref="askEl" v-model="askUrl" :placeholder="ask === 'video' ? 'Paste a YouTube link' : 'Paste or type a web address'"
                   :aria-label="ask === 'video' ? 'YouTube link' : 'Web address'" @keydown.stop @keydown.esc.prevent="ask = null" />
            <button class="nge-blog-btn nge-blog-btn--primary" type="submit">{{ ask === 'video' ? 'Add video' : ask === 'button' ? 'Add button' : 'Add link' }}</button>
            <button v-if="ask === 'link'" class="nge-blog-btn" type="button" @click="removeLink">Remove link</button>
            <button class="nge-blog-btn" type="button" @click="ask = null">Cancel</button>
            <span v-if="askError" class="nge-blog-problem" role="alert">{{ askError }}</span>
          </form>

          <div v-show="!showPreview" ref="docEl" class="nge-blog-doc" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Post"
               spellcheck="true" @paste="onPaste" @click="onDocClick" @keydown.stop="onDocKey" @keyup.stop @keypress.stop></div>
          <div v-if="showPreview" class="nge-blog-doc nge-blog-doc--preview" v-html="previewHtml"></div>
        </div>
        <p v-show="!showPreview" class="nge-blog-help">Write as you would in any document. Select text and use the buttons to format it. Click a picture or video and press Delete to remove it.</p>
      </div>

      <p v-if="problem" class="nge-blog-problem" role="alert">{{ problem }}</p>
      <p v-if="message" class="nge-blog-ok" role="status">
        {{ message }} <a v-if="status === 'published'" :href="postUrl" target="_blank" rel="noopener noreferrer">View it</a>
      </p>

      <div class="nge-blog-actions">
        <button class="nge-blog-btn nge-blog-btn--primary" :disabled="busy" @click="save('published')">{{ status === 'published' ? 'Publish changes' : 'Publish' }}</button>
        <button class="nge-blog-btn" :disabled="busy" @click="save('draft')">{{ status === 'published' ? 'Unpublish (back to draft)' : 'Save draft' }}</button>
        <span class="nge-blog-grow"></span>
        <template v-if="id !== null">
          <button v-if="!confirmDelete" class="nge-blog-btn nge-blog-btn--danger" :disabled="busy" @click="confirmDelete = true">Delete</button>
          <template v-else>
            <span class="nge-blog-note">Delete this post for good?</span>
            <button class="nge-blog-btn nge-blog-btn--danger" :disabled="busy" @click="remove">Yes, delete</button>
            <button class="nge-blog-btn" @click="confirmDelete = false">Keep it</button>
          </template>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nge-blog { display: flex; flex-direction: column; gap: 14px; padding: 18px 24px 24px; overflow-y: auto; max-height: calc(90vh - 100px);
  /* A page width of its own: long lines of text must not stretch the profile window. */
  width: min(900px, calc(100vw - 48px)); max-width: 100%; box-sizing: border-box;
  font-size: var(--nge-fs-base, 14px); color: #dce6f5; }
.nge-blog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.nge-blog-head h3 { margin: 0 0 2px; font-size: 1.25em; color: #eaf6ff; }
.nge-blog-head p { margin: 0; color: rgba(220, 230, 245, 0.7); }
.nge-blog a { color: #7fd4ff; }
.nge-blog-btn { padding: 6px 12px; border-radius: 7px; cursor: pointer; font: inherit; color: #dce6f5;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-blog-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-blog-btn:disabled { opacity: 0.5; cursor: default; }
.nge-blog-btn:focus-visible, .nge-blog-row:focus-visible, .nge-blog-tool:focus-visible { outline: 2px solid #7fd4ff; outline-offset: 1px; }
.nge-blog-btn--primary { color: #06121f; background: #7fd4ff; border-color: #7fd4ff; font-weight: 600; }
.nge-blog-btn--primary:hover:not(:disabled) { background: #a9e3ff; }
.nge-blog-btn--danger { color: #ff9aa8; border-color: rgba(255, 120, 140, 0.45); }
.nge-blog-row { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 14px; border-radius: 9px; cursor: pointer;
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.10); }
.nge-blog-row:hover { background: rgba(255, 255, 255, 0.08); }
.nge-blog-row-title { font-weight: 600; color: #eaf6ff; overflow-wrap: anywhere; }
.nge-blog-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.9em; color: rgba(220, 230, 245, 0.65); }
.nge-blog-pill { padding: 1px 8px; border-radius: 999px; font-size: 0.85em; border: 1px solid rgba(255, 255, 255, 0.25); color: rgba(220, 230, 245, 0.8); }
.nge-blog-pill--published { color: #8ef0b8; border-color: rgba(120, 230, 170, 0.5); }
.nge-blog-field { display: flex; flex-direction: column; gap: 6px; }
.nge-blog-field > span { font-size: 0.9em; color: rgba(220, 230, 245, 0.7); }
.nge-blog-field em { font-style: normal; opacity: 0.7; }
.nge-blog input, .nge-blog textarea { width: 100%; padding: 8px 10px; border-radius: 7px; font: inherit; color: #eaf6ff;
  background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-blog input:focus, .nge-blog textarea:focus { outline: none; border-color: #7fd4ff; }
.nge-blog textarea { resize: vertical; line-height: 1.5; }
.nge-blog-slug { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nge-blog-slug code { color: rgba(220, 230, 245, 0.6); font-size: 0.9em; overflow-wrap: anywhere; }
.nge-blog-slug input { flex: 1 1 180px; width: auto; }
.nge-blog-cover { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nge-blog-cover img { height: 64px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.18); }

.nge-blog-editor { border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 9px; background: #070a12; }
.nge-blog-editor:focus-within { border-color: #7fd4ff; }
.nge-blog-tools { position: sticky; top: -18px; z-index: 2; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px 9px 0 0; background: #0d1526; }
.nge-blog-tool { min-width: 30px; padding: 4px 8px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 0.92em; line-height: 1.4;
  color: #dce6f5; background: transparent; border: 1px solid transparent; white-space: nowrap; }
.nge-blog-tool:hover:not(:disabled) { background: rgba(255, 255, 255, 0.10); }
.nge-blog-tool:disabled { opacity: 0.4; cursor: default; }
.nge-blog-tool.on { color: #7fd4ff; border-color: rgba(127, 212, 255, 0.6); background: rgba(127, 212, 255, 0.10); }
.nge-blog-tool--b { font-weight: 800; }
.nge-blog-tool--i { font-style: italic; font-family: Georgia, 'Times New Roman', serif; font-weight: 600; }
.nge-blog-style { padding: 4px 6px; border-radius: 6px; font: inherit; font-size: 0.92em; color: #dce6f5; background: #0d1526;
  border: 1px solid rgba(255, 255, 255, 0.18); color-scheme: dark; }
.nge-blog-sep { width: 1px; align-self: stretch; margin: 3px 3px; background: rgba(255, 255, 255, 0.14); }
.nge-blog-grow { flex: 1; }
.nge-blog-ask { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
.nge-blog-ask input { flex: 1 1 200px; width: auto; }

/* The page itself: styled like the published post, so what you see is what readers get. */
.nge-blog-doc { min-height: 320px; padding: 16px 18px; line-height: 1.7; font-size: 1.08em; color: rgba(255, 255, 255, 0.82); overflow-wrap: anywhere; outline: none; }
.nge-blog-doc :deep(h2) { margin: 22px 0 8px; font-size: 1.4em; line-height: 1.25; color: #eaf6ff; }
.nge-blog-doc :deep(h3) { margin: 18px 0 6px; font-size: 1.15em; color: #eaf6ff; }
.nge-blog-doc :deep(p) { margin: 0 0 12px; }
.nge-blog-doc :deep(ul), .nge-blog-doc :deep(ol) { margin: 0 0 12px; padding-left: 24px; }
/* !important: the game's own stylesheet resets every list. */
.nge-blog-doc :deep(ul) { list-style: disc outside !important; }
.nge-blog-doc :deep(ol) { list-style: decimal outside !important; }
.nge-blog-doc :deep(ul), .nge-blog-doc :deep(ol) { padding-left: 24px !important; margin: 0 0 12px !important; }
.nge-blog-doc :deep(li) { display: list-item; margin: 4px 0; }
.nge-blog-doc :deep(strong), .nge-blog-doc :deep(b) { color: #fff; }
.nge-blog-doc :deep(a) { color: #42d5ec; }
.nge-blog-doc :deep(hr) { margin: 22px 0; border: 0; border-top: 1px solid rgba(255, 255, 255, 0.2); }
.nge-blog-doc :deep(blockquote) { margin: 0 0 12px; padding: 2px 0 2px 14px; border-left: 3px solid #42d5ec; }
.nge-blog-doc :deep(aside) { margin: 0 0 14px; padding: 12px 14px 1px; border-radius: 10px; border: 1px solid rgba(230, 199, 96, 0.5); background: rgba(230, 199, 96, 0.08); }
.nge-blog-doc :deep(pre) { margin: 0 0 12px; padding: 10px 12px; overflow-x: auto; border-radius: 8px; background: rgba(0, 0, 0, 0.4); }
.nge-blog-doc :deep(figure) { margin: 14px 0; }
.nge-blog-doc :deep(img) { display: block; max-width: 100%; border-radius: 8px; cursor: pointer; }
.nge-blog-doc :deep(figcaption) { min-height: 1.5em; margin-top: 6px; font-size: 0.88em; color: rgba(255, 255, 255, 0.6); }
.nge-blog-doc[contenteditable='true'] :deep(figcaption:empty)::before { content: 'Caption (optional)'; opacity: 0.5; }
.nge-blog-doc :deep(.blog-post__pair) { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
.nge-blog-doc :deep(.blog-post__pair figure) { margin: 0; }
.nge-blog-doc :deep(.blog-post__video) { position: relative; margin: 14px 0; border-radius: 10px; overflow: hidden; aspect-ratio: 16 / 9; background: #000; cursor: pointer; }
.nge-blog-doc :deep(.blog-post__video img), .nge-blog-doc :deep(.blog-post__video iframe) { width: 100%; height: 100%; object-fit: cover; border: 0; border-radius: 0; }
.nge-blog-doc[contenteditable='true'] :deep(.blog-post__video)::after { content: '▶ Video'; position: absolute; left: 10px; bottom: 10px; padding: 2px 10px; border-radius: 999px;
  font-size: 0.85em; color: #fff; background: rgba(0, 0, 0, 0.7); }
.nge-blog-doc :deep(.blog-post__button) { display: inline-block; padding: 8px 14px; border-radius: 9px; background: #e6c760; color: #10131c; font-weight: 700; text-decoration: none; }
.nge-blog-doc :deep(::selection) { background: rgba(127, 212, 255, 0.35); }

.nge-blog-help { margin: 0; font-size: 0.85em; color: rgba(220, 230, 245, 0.6); }
.nge-blog-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-blog-note { color: rgba(220, 230, 245, 0.7); margin: 0; }
.nge-blog-problem { margin: 0; color: #ff9aa8; }
.nge-blog-ok { margin: 0; color: #8ef0b8; }
</style>
