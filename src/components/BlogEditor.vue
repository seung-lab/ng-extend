<script setup lang="ts">
/**
 * Write and publish posts for connectome.quest/blog (Ames 2026-10-02).
 * Shown as the Blog tab of your own profile, only to the people listed in
 * blog_authors. The server enforces that list (functions/community-data.js);
 * this panel is just the editor. Posts are stored in Supabase blog_posts and
 * the public site reads the published ones.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { supabase } from '../supabase';
import { secureUpload } from '../secure_upload';
import { blogSlug, renderBlogMarkdown } from '../util/blog_markdown';

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
const body = ref('');
const coverUrl = ref('');
const status = ref<'draft' | 'published'>('draft');
const publishedAt = ref<string | null>(null);
const showPreview = ref(false);
const bodyEl = ref<HTMLTextAreaElement | null>(null);
const confirmDelete = ref(false);

const preview = computed(() => renderBlogMarkdown(body.value));
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

function open(p: Post | null) {
  id.value = p?.id ?? null;
  title.value = p?.title ?? '';
  slug.value = p?.slug ?? '';
  slugTouched.value = !!p;
  summary.value = p?.summary ?? '';
  body.value = p?.body ?? '';
  coverUrl.value = p?.cover_url ?? '';
  status.value = p?.status ?? 'draft';
  publishedAt.value = p?.published_at ?? null;
  showPreview.value = false;
  confirmDelete.value = false;
  message.value = '';
  problem.value = '';
  editing.value = true;
}
function back() { editing.value = false; message.value = ''; problem.value = ''; void load(); }

async function save(next: 'draft' | 'published') {
  problem.value = ''; message.value = '';
  if (!title.value.trim()) { problem.value = 'Give the post a title.'; return; }
  if (!body.value.trim()) { problem.value = 'Write something first.'; return; }
  const s = blogSlug(slug.value || title.value);
  if (!s) { problem.value = 'The web address needs at least one letter or number.'; return; }
  slug.value = s;
  busy.value = true;
  const row: Record<string, unknown> = {
    slug: s, title: title.value.trim(), summary: summary.value.trim() || null, body: body.value,
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

async function pickImage(): Promise<string | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  const file = await new Promise<File | null>(resolve => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return null;
  problem.value = ''; busy.value = true;
  try { return await secureUpload(file, 'blog'); }
  catch (e: any) { problem.value = e?.message || 'Image upload failed.'; return null; }
  finally { busy.value = false; }
}
async function addImage() {
  const url = await pickImage();
  if (!url) return;
  const el = bodyEl.value;
  const at = el ? el.selectionStart : body.value.length;
  const before = body.value.slice(0, at), after = body.value.slice(at);
  const snippet = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}![Describe the image](${url})\n\n`;
  body.value = before + snippet + after.replace(/^\n+/, '');
}
async function addCover() {
  const url = await pickImage();
  if (url) coverUrl.value = url;
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
        <span>Cover image <em>(optional)</em></span>
        <div class="nge-blog-cover">
          <img v-if="coverUrl" :src="coverUrl" alt="Cover image" />
          <button class="nge-blog-btn" :disabled="busy" @click="addCover">{{ coverUrl ? 'Replace' : 'Upload an image' }}</button>
          <button v-if="coverUrl" class="nge-blog-btn" @click="coverUrl = ''">Remove</button>
        </div>
      </div>

      <div class="nge-blog-field">
        <div class="nge-blog-bodybar">
          <span>Post</span>
          <div>
            <button class="nge-blog-btn" :disabled="busy || showPreview" @click="addImage">Add image</button>
            <button class="nge-blog-btn" :class="{ 'nge-blog-btn--on': showPreview }" @click="showPreview = !showPreview">{{ showPreview ? 'Keep writing' : 'Preview' }}</button>
          </div>
        </div>
        <textarea v-show="!showPreview" ref="bodyEl" v-model="body" rows="16" class="nge-blog-body"
          placeholder="Write here. Leave a blank line between paragraphs."></textarea>
        <div v-if="showPreview" class="nge-blog-preview" v-html="preview"></div>
        <p v-show="!showPreview" class="nge-blog-help">
          <code>## Heading</code> · <code>**bold**</code> · <code>*italic*</code> · <code>- list item</code> · <code>[link text](https://...)</code> · a link on a line by itself becomes a button.
        </p>
      </div>

      <p v-if="problem" class="nge-blog-problem" role="alert">{{ problem }}</p>
      <p v-if="message" class="nge-blog-ok" role="status">
        {{ message }} <a v-if="status === 'published'" :href="postUrl" target="_blank" rel="noopener noreferrer">View it</a>
      </p>

      <div class="nge-blog-actions">
        <button class="nge-blog-btn nge-blog-btn--primary" :disabled="busy" @click="save('published')">{{ status === 'published' ? 'Publish changes' : 'Publish' }}</button>
        <button class="nge-blog-btn" :disabled="busy" @click="save('draft')">{{ status === 'published' ? 'Unpublish (back to draft)' : 'Save draft' }}</button>
        <span class="nge-blog-spacer"></span>
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
  font-size: var(--nge-fs-base, 14px); color: #dce6f5; }
.nge-blog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.nge-blog-head h3 { margin: 0 0 2px; font-size: 1.25em; color: #eaf6ff; }
.nge-blog-head p { margin: 0; color: rgba(220, 230, 245, 0.7); }
.nge-blog a { color: #7fd4ff; }
.nge-blog-btn { padding: 6px 12px; border-radius: 7px; cursor: pointer; font: inherit; color: #dce6f5;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-blog-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-blog-btn:disabled { opacity: 0.5; cursor: default; }
.nge-blog-btn:focus-visible, .nge-blog-row:focus-visible { outline: 2px solid #7fd4ff; outline-offset: 1px; }
.nge-blog-btn--primary { color: #06121f; background: #7fd4ff; border-color: #7fd4ff; font-weight: 600; }
.nge-blog-btn--primary:hover:not(:disabled) { background: #a9e3ff; }
.nge-blog-btn--on { border-color: #7fd4ff; color: #7fd4ff; }
.nge-blog-btn--danger { color: #ff9aa8; border-color: rgba(255, 120, 140, 0.45); }
.nge-blog-row { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 14px; border-radius: 9px; cursor: pointer;
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.10); }
.nge-blog-row:hover { background: rgba(255, 255, 255, 0.08); }
.nge-blog-row-title { font-weight: 600; color: #eaf6ff; overflow-wrap: anywhere; }
.nge-blog-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.9em; color: rgba(220, 230, 245, 0.65); }
.nge-blog-pill { padding: 1px 8px; border-radius: 999px; font-size: 0.85em; border: 1px solid rgba(255, 255, 255, 0.25); color: rgba(220, 230, 245, 0.8); }
.nge-blog-pill--published { color: #8ef0b8; border-color: rgba(120, 230, 170, 0.5); }
.nge-blog-field { display: flex; flex-direction: column; gap: 6px; }
.nge-blog-field > span, .nge-blog-bodybar > span { font-size: 0.9em; color: rgba(220, 230, 245, 0.7); }
.nge-blog-field em { font-style: normal; opacity: 0.7; }
.nge-blog input, .nge-blog textarea { width: 100%; padding: 8px 10px; border-radius: 7px; font: inherit; color: #eaf6ff;
  background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-blog input:focus, .nge-blog textarea:focus { outline: none; border-color: #7fd4ff; }
.nge-blog textarea { resize: vertical; line-height: 1.5; }
.nge-blog-body { min-height: 260px; }
.nge-blog-slug { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nge-blog-slug code { color: rgba(220, 230, 245, 0.6); font-size: 0.9em; overflow-wrap: anywhere; }
.nge-blog-slug input { flex: 1 1 180px; width: auto; }
.nge-blog-cover { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nge-blog-cover img { height: 64px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-blog-bodybar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nge-blog-bodybar > div { display: flex; gap: 6px; }
.nge-blog-help { margin: 0; font-size: 0.85em; color: rgba(220, 230, 245, 0.6); line-height: 1.7; }
.nge-blog-help code { background: rgba(255, 255, 255, 0.08); padding: 1px 4px; border-radius: 4px; }
.nge-blog-preview { padding: 14px 16px; border-radius: 9px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.12);
  min-height: 260px; line-height: 1.7; overflow-wrap: anywhere; }
.nge-blog-preview :deep(h2) { margin: 22px 0 8px; font-size: 1.3em; color: #eaf6ff; }
.nge-blog-preview :deep(h3) { margin: 18px 0 6px; font-size: 1.1em; color: #eaf6ff; }
.nge-blog-preview :deep(p) { margin: 0 0 12px; }
.nge-blog-preview :deep(ul), .nge-blog-preview :deep(ol) { margin: 0 0 12px; padding-left: 22px; }
.nge-blog-preview :deep(img) { max-width: 100%; border-radius: 8px; }
.nge-blog-preview :deep(figure) { margin: 0 0 12px; }
.nge-blog-preview :deep(blockquote) { margin: 0 0 12px; padding-left: 12px; border-left: 3px solid rgba(127, 212, 255, 0.5); }
.nge-blog-preview :deep(.blog-post__button) { display: inline-block; padding: 8px 14px; border-radius: 9px; background: #e6c760; color: #10131c; font-weight: 700; text-decoration: none; }
.nge-blog-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-blog-spacer { flex: 1; }
.nge-blog-note { color: rgba(220, 230, 245, 0.7); margin: 0; }
.nge-blog-problem { margin: 0; color: #ff9aa8; }
.nge-blog-ok { margin: 0; color: #8ef0b8; }
</style>
