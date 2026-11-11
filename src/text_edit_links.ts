/**
 * The two links at the end of Ames's note for an admin's edit of an in-game
 * text (functions/edit-notify.js; Ames 2026-11-09: "the notif before and
 * after is ok and I can revert or open to edit from there"):
 *
 * - #nge-text-revert=<id>  puts back the text from before that edit (its row
 *   in site_text_edits, supabase-site-text-edits.sql). Ames's own save sends
 *   no note, so putting it back is quiet.
 * - #nge-text-open=<key>   opens the window the text is in, with its editor
 *   open (EditableText listens for nge:edit-text).
 */
import { supabase } from './supabase';
import { siteTexts, loadSiteTexts, saveSiteText, resetSiteText } from './site_texts';
import { openTutorialBox } from './tutorial_box_jump';

const KEY = /^[a-z0-9_.-]{1,64}$/;

/** The text whose editor should open when its window mounts (it may not be on screen yet). */
let pending: { key: string; at: number } | null = null;
/** The text asked for, if still fresh, left for its editor to take. */
export function peekPendingEdit(): string | null {
  return pending && Date.now() - pending.at <= 20000 ? pending.key : null;
}
/** A window that holds the text listens with this: on a note's ask, and once as it mounts. */
export function onTextEditAsked(handle: (key: string) => void): () => void {
  const listener = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (typeof k === 'string') handle(k); };
  document.addEventListener('nge:edit-text', listener);
  const now = peekPendingEdit();
  if (now) handle(now);
  return () => document.removeEventListener('nge:edit-text', listener);
}
export function takePendingEdit(key: string): boolean {
  if (!pending || pending.key !== key || Date.now() - pending.at > 20000) return false;
  pending = null;
  return true;
}

/** A picture's key is its text's key plus .image: the same window. */
const baseKey = (key: string) => /^quest\.[a-z0-9_]+\.image$/.test(key) ? key.replace(/\.image$/, '.steps') : key.replace(/\.image$/, '');

export function openTextForEdit(key: string): void {
  if (!KEY.test(key)) return;
  const base = baseKey(key);
  const box = /^tutorial\.(\d{1,2})\.(\d{1,3})$/.exec(base);
  if (box) { openTutorialBox(Number(box[1]), Number(box[2])); return; }
  pending = { key: base, at: Date.now() };
  if (base === 'howto.hunt') document.dispatchEvent(new CustomEvent('nge:hunt-open', { detail: {} }));
  else if (base.startsWith('quest.')) document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'quests' } }));
  else if (base.startsWith('howto.') && base !== 'howto.2d_tools') document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: {} }));
  // Windows that are already open hear this; ones still opening take it when they mount.
  const ask = () => document.dispatchEvent(new CustomEvent('nge:edit-text', { detail: { key: base } }));
  ask();
  setTimeout(ask, 700);
}

export interface RevertResult { ok: boolean; message: string }

export async function revertTextEdit(id: number): Promise<RevertResult> {
  const { data, error } = await supabase.from('site_text_edits')
    .select('id,key,old_body,new_body,editor_name').eq('id', id).limit(1);
  const row = (data as any[] | null)?.[0];
  if (error || !row || !KEY.test(String(row.key))) return { ok: false, message: 'That edit could not be found.' };
  const key = String(row.key);
  const who = String(row.editor_name || 'the admin');
  const isPicture = /\.image$/.test(key);
  const thing = isPicture ? 'picture' : 'text';
  await loadSiteTexts(true);
  const now = siteTexts[key]?.body ?? null;
  const before = row.old_body == null ? null : String(row.old_body);
  if (now === before) return { ok: true, message: `It already shows the ${thing} from before ${who}'s edit.` };
  const changedSince = now !== (row.new_body == null ? null : String(row.new_body));
  const ask = changedSince
    ? `This ${thing} has been changed again since ${who}'s edit. Put back the ${thing} from before that edit anyway? Players see it at once.`
    : `Put back the ${thing} from before ${who}'s edit? Players see it at once.`;
  if (!window.confirm(ask)) return { ok: false, message: '' };
  try {
    if (before == null) await resetSiteText(key);
    else await saveSiteText(key, before);
  } catch (e: any) {
    return { ok: false, message: 'Not put back: ' + (e?.message || e) };
  }
  return { ok: true, message: `Put back. Players see the ${thing} from before ${who}'s edit.` };
}
