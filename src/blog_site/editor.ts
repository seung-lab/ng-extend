/**
 * The blog editor on connectome.quest (Ames 2026-10-28: "can we please have a
 * normal blog editor in the blog page?", with an Edit button on each post).
 *
 * This is Pyr's own editor (components/BlogEditor.vue), packaged on its own by
 * scripts/build-blog-site-editor.cjs into the site's assets/blog-editor.js.
 * The blog loads it only when an author presses Edit or Write a post
 * (assets/blog-edit.js on the site), and calls
 *   window.PyrBlogEditor.open(host, slug)   slug '' for a new post
 *
 * Signing in is the same Google sign in Pyr uses: the CAVE sign in popup
 * hands back a token, kept in this site's storage under the same name Pyr
 * uses, so the editor's saving and picture upload work unchanged. Who may
 * write is decided by the server (blog_authors), as in the game.
 */
import { createApp, type App } from 'vue';
import BlogEditor from '../components/BlogEditor.vue';
import { caveToken } from '../secure_write';
import { functionUrl } from '../functions_base';

const AUTH_URL = 'https://global.daf-apis.com/sticky_auth';
const TOKEN_KEY = `auth_token_v2_${AUTH_URL}`;

/** Sign in through the CAVE popup, if this browser is not signed in yet. */
function signIn(): Promise<void> {
  if (caveToken()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const w = 420, h = 680;
    const popup = window.open(`${AUTH_URL}/api/v1/authorize`, 'pyr-sign-in',
      `toolbar=no,menubar=no,width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)}`);
    if (!popup) { reject(new Error('The sign in window was blocked. Allow pop ups for connectome.quest and try again.')); return; }
    const closed = setInterval(() => {
      if (popup.closed) { cleanup(); reject(new Error('The sign in window was closed before signing in.')); }
    }, 800);
    function cleanup() { clearInterval(closed); window.removeEventListener('message', onMessage); }
    function onMessage(ev: MessageEvent) {
      if (ev.source !== popup) return;
      const data = ev.data || {};
      if (typeof data.token !== 'string' || !data.token) return;
      cleanup();
      try { popup.close(); } catch { /* already closed */ }
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ tokenType: 'Bearer', accessToken: data.token, url: AUTH_URL, appUrls: Array.isArray(data.app_urls) ? data.app_urls : [] }));
      resolve();
    }
    window.addEventListener('message', onMessage);
  });
}

/** Is the signed in person a blog author? (Readable for their own row only.) */
async function isAuthor(): Promise<boolean | null> {
  const token = caveToken();
  if (!token) return false;
  try {
    const r = await fetch(functionUrl('ewCommunityData'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'blog_authors', method: 'GET', query: 'select=user_id&limit=1', token }),
    });
    if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); return false; }   // the sign in ran out
    const env = await r.json();
    const rows = typeof env.body === 'string' ? JSON.parse(env.body) : env.body;
    return Array.isArray(rows) && rows.length > 0;
  } catch { return null; }   // could not ask: let the editor try
}

let app: App | null = null;

async function open(host: HTMLElement, slug: string, onClose: () => void): Promise<void> {
  await signIn();
  const author = await isAuthor();
  if (author === false) throw new Error('Only blog authors can write and edit posts. Ask Ames to add you.');
  try { localStorage.setItem('pyr-blog-author', '1'); } catch { /* storage blocked */ }
  if (app) { app.unmount(); app = null; }
  app = createApp(BlogEditor, { site: true, startSlug: slug, onClose: () => { close(); onClose(); } });
  app.mount(host);
}
function close() { if (app) { app.unmount(); app = null; } }
function signOut() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('pyr-blog-author'); } catch { /* storage blocked */ } }

(window as any).PyrBlogEditor = { open, close, signOut, isAuthor };
