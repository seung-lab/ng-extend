/**
 * Tutorial boxes admins can reword in the game (Ames 2026-10-25: "a pencil
 * icon so admins can edit the tutorial, but I still want to approve or at
 * least see the changes").
 *
 * Kept in site texts (src/site_texts.ts: anyone reads, admins write), so it
 * needs no table of its own:
 * - tutorial.<tutorial>.<box>        the wording players see
 * - tutorial-draft.<tutorial>.<box>  a suggestion waiting for approval
 * Each body is JSON: the new title and words, and the code's own wording when
 * the edit was made. A box shows an edit only while the code still has that
 * wording, so a box rewritten or moved in code never shows a stale edit.
 *
 * The approvers' own edits go straight to players (Ames: "my own edits skip
 * review"); anyone else's wait in Admin Hub > Tutorial edits, and the
 * approvers get a notification. Only the title and words change: where a box
 * points, its view and when it shows stay in code.
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Step } from './store-pyr';
import { siteTexts, loadSiteTexts, saveSiteText, resetSiteText } from './site_texts';
import { supabase } from './supabase';

/** Pyr accounts whose tutorial edits need no approval, and who approve. */
export const TUTORIAL_APPROVER_EMAILS = ['amylr@princeton.edu', 'amyleerobinson@gmail.com'];

export const TUTORIAL_NAMES: Record<number, string> = {
  1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut',
  6: 'Meet the cells of MEC', 7: 'Meet the cells of the retina', 8: 'Meet the cells of the fly brain',
  9: 'Merger Sandbox', 10: 'Meet the cells of CA3', 11: 'Proofreading Test', 13: 'Extension Sandbox',
};

export interface Wording { title: string; words: string }
export interface TutorialEdit extends Wording {
  /** The code's wording when the edit was made. */
  from: Wording;
  /** Markdown (a step with text) or HTML (a step with html). */
  kind: 'text' | 'html';
  by: string;
  at: string;
}

const liveKey = (tutorial: number, box: number) => `tutorial.${tutorial}.${box}`;
const draftKey = (tutorial: number, box: number) => `tutorial-draft.${tutorial}.${box}`;

export function isApprover(email: string | null | undefined): boolean {
  return !!email && TUTORIAL_APPROVER_EMAILS.includes(email.trim().toLowerCase());
}

/** The code's own wording of a box. */
export function codeWording(step: Step): Wording & { kind: 'text' | 'html' } {
  return step.text != null
    ? { title: step.title || '', words: step.text, kind: 'text' }
    : { title: step.title || '', words: step.html || '', kind: 'html' };
}

function parse(key: string): TutorialEdit | null {
  const saved = siteTexts[key];
  if (!saved) return null;
  try {
    const e = JSON.parse(saved.body);
    if (!e || typeof e.title !== 'string' || typeof e.words !== 'string' || !e.from) return null;
    return { title: e.title, words: e.words, from: { title: String(e.from.title ?? ''), words: String(e.from.words ?? '') },
      kind: e.kind === 'html' ? 'html' : 'text', by: saved.by, at: saved.at };
  } catch { return null; }
}

const sameWording = (a: Wording, b: Wording) => a.title === b.title && a.words === b.words;

/** The approved edit of this box, if the code still has the wording it replaced. */
export function liveEdit(tutorial: number, box: number, step: Step): TutorialEdit | null {
  const e = parse(liveKey(tutorial, box));
  return e && sameWording(e.from, codeWording(step)) ? e : null;
}
export function draftEdit(tutorial: number, box: number): TutorialEdit | null {
  return parse(draftKey(tutorial, box));
}

/** Words as the box shows them: links open a new tab; edited words are cleaned. */
export function wordsToHtml(words: string, kind: 'text' | 'html'): string {
  const html = kind === 'text' ? (marked.parse(words, { async: false }) as string) : words;
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] });
  return clean.replace(/<a\s+(?![^>]*\btarget=)([^>]*href="https?:[^>]*)>/gi, '<a target="_blank" rel="noopener" $1>');
}

export { loadSiteTexts };

/**
 * Save an edit of a box. An approver's goes to players at once; anyone else's
 * is a suggestion, and the approvers are told. Returns which it was.
 */
export async function saveTutorialEdit(tutorial: number, box: number, step: Step, next: Wording, myEmail: string | null | undefined,
  notify: (approverUserIds: string[], title: string, body: string) => Promise<void>): Promise<'live' | 'draft'> {
  const code = codeWording(step);
  const body = JSON.stringify({ title: next.title, words: next.words, from: { title: code.title, words: code.words }, kind: code.kind });
  if (body.length > 20000) throw new Error('That is too long for one box.');
  if (isApprover(myEmail)) {
    await saveSiteText(liveKey(tutorial, box), body);
    if (siteTexts[draftKey(tutorial, box)]) await resetSiteText(draftKey(tutorial, box));
    return 'live';
  }
  await saveSiteText(draftKey(tutorial, box), body);
  try {
    const { data } = await supabase.from('admins').select('user_id,email');
    const ids = ((data as any[]) || []).filter(a => a.user_id && isApprover(a.email)).map(a => String(a.user_id));
    const name = TUTORIAL_NAMES[tutorial] ?? `Tutorial ${tutorial}`;
    if (ids.length) await notify(ids, `📋 Tutorial edit to approve: ${name}, box ${box + 1}`,
      `"${next.title || code.title}" has new wording waiting for you in Admin Hub > Tutorial edits.`);
  } catch (e) { console.warn('[tutorial edits] could not tell the approvers:', e); }
  return 'draft';
}

/** Approve a suggestion: it becomes what players see. */
export async function approveDraft(tutorial: number, box: number): Promise<void> {
  const d = siteTexts[draftKey(tutorial, box)];
  if (!d) return;
  await saveSiteText(liveKey(tutorial, box), d.body);
  await resetSiteText(draftKey(tutorial, box));
}
export async function rejectDraft(tutorial: number, box: number): Promise<void> {
  await resetSiteText(draftKey(tutorial, box));
}
/** Put a box back to the code's wording. */
export async function restoreBox(tutorial: number, box: number): Promise<void> {
  await resetSiteText(liveKey(tutorial, box));
}

export interface EditRow { tutorial: number; box: number; name: string; edit: TutorialEdit }
/** Every saved edit or suggestion, newest first. */
export function allEdits(kind: 'live' | 'draft'): EditRow[] {
  const prefix = kind === 'live' ? 'tutorial.' : 'tutorial-draft.';
  const rows: EditRow[] = [];
  for (const key of Object.keys(siteTexts)) {
    if (!key.startsWith(prefix)) continue;
    const m = /^[a-z-]+\.(\d+)\.(\d+)$/.exec(key);
    const edit = parse(key);
    if (!m || !edit) continue;
    const tutorial = Number(m[1]), box = Number(m[2]);
    rows.push({ tutorial, box, name: TUTORIAL_NAMES[tutorial] ?? `Tutorial ${tutorial}`, edit });
  }
  return rows.sort((a, b) => b.edit.at.localeCompare(a.edit.at));
}
