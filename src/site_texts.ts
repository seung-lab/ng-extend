/**
 * Instructions the lab edits in the game, without a deploy (Celia
 * 2026-10-20: "an admin-only edit option for instructions ... for making
 * quick changes to task/Quest instructions").
 *
 * Each text has a key. The code keeps the original wording; a saved text
 * (supabase-site-texts.sql, through ewCommunityData: anyone reads, admins
 * write) is shown in its place. Restoring the original deletes the saved one.
 *
 * Saved texts are plain words with two marks, so nothing an editor types can
 * run as HTML: **bold** and [link words](https://...). One step per line.
 * A link to #examples opens the Cilia Quest's example cells.
 */
import { reactive } from 'vue';
import { supabase } from './supabase';

export interface SavedText { body: string; by: string; at: string }

/** Saved texts by key. A key not here shows the code's own text. */
export const siteTexts = reactive<Record<string, SavedText>>({});
let loading: Promise<void> | null = null;

export function loadSiteTexts(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from('site_texts').select('key,body,updated_by_name,updated_at');
    // Before the table exists, or offline: the code's own texts stay.
    if (error || !Array.isArray(data)) { loading = null; return; }
    for (const k of Object.keys(siteTexts)) delete siteTexts[k];
    for (const r of data as any[]) siteTexts[r.key] = { body: String(r.body ?? ''), by: r.updated_by_name || '', at: r.updated_at || '' };
  })();
  return loading;
}

export async function saveSiteText(key: string, body: string): Promise<void> {
  const { error } = await supabase.from('site_texts').upsert({ key, body }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  siteTexts[key] = { body, by: 'you', at: new Date().toISOString() };
}

export async function resetSiteText(key: string): Promise<void> {
  const { error } = await supabase.from('site_texts').delete().eq('key', key);
  if (error) throw new Error(error.message);
  delete siteTexts[key];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One line of saved text as safe HTML: escaped, then **bold** and links. */
export function textToHtml(line: string): string {
  let h = escapeHtml(line);
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  h = h.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|#examples)\)/g, (_m, words: string, url: string) =>
    url === '#examples'
      ? `<a href="#" data-nge-action="examples">${words}</a>`
      : `<a href="${url}" target="_blank" rel="noopener">${words}</a>`);
  return h;
}

/** A saved list: one step per line, blank lines and leading numbers dropped. */
export function textToSteps(body: string): string[] {
  return body.split(/\r?\n/).map(l => l.trim().replace(/^(\d+[.)]|[-*•])\s+/, '')).filter(Boolean).map(textToHtml);
}

/** The code's HTML back into the editor's marks, for a first edit. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*data-nge-action="examples"[^>]*>(.*?)<\/a>/g, '[$1](#examples)')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<\/?(b|strong)>/g, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/&Delta;/g, 'Δ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
