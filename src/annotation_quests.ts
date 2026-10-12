/**
 * Annotation Quests (Ames 2026-10-12): annotating a cell as a quest, apart
 * from completing it. Retina first: find and mark every cilium on a
 * starburst amacrine cell.
 *
 * The quest's record is a tab of the lab's Cilia sheet. Only the server
 * reads or writes it (ewSheetSync, functions/sheet-policy.js): the Start
 * Link and the cell's names are read for the list; the player's name is
 * written when they take a cell; their chosen status, split or merged, share
 * link, date and notes are written when they submit. Nothing here touches
 * the game's tables, stats or Achievements.
 */
import { functionUrl } from './functions_base';

export const QUEST_KEY = 'retina_cilia';
export const QUEST_DATASET = 'stroeh_mouse_retina';
export const QUEST_TITLE = 'Cilia on starburst amacrine cells';

/** The sheet's own dropdown options, character for character (read
 *  2026-10-12). The server keeps the same list and refuses anything else. */
export const QUEST_STATUSES = [
  'Cilium annotated',
  'Cilium annotated (fixation artifact)',
  'Need help',
  'Need help: One centriole missing',
  'No cilium',
  'No cilium (BB & DC clear)',
  'No cilium (BB & DC unclear; internal centriole pair)',
  'No cilium (one centriole)',
  'Skipped (low quality)',
];
export const QUEST_SPLIT_MERGED = ['Split', 'Merged'];

export interface QuestRow {
  index: string;
  segmentId: string;
  soma: string;
  cellClass: string;
  cellType: string;
  startLink: string;
  status: string;
  splitMerged: string;
  link: string;
  annotator: string;
  date: string;
  notes: string;
}

/** Letters and digits only, lower case: the server matches names the same way. */
export const nameKey = (v: string | null | undefined) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function call(action: string, body: Record<string, unknown> = {}): Promise<any> {
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { /* signed out */ }
  if (!token) throw new Error('Sign in to take a quest.');
  const response = await fetch(functionUrl('ewSheetSync'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ quest: QUEST_KEY, action, token, ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The quest sheet could not be reached.');
  return result;
}

export async function listQuests(): Promise<QuestRow[]> {
  const r = await call('quest_list');
  return Array.isArray(r.rows) ? r.rows : [];
}
export async function claimQuest(segmentId: string) { return call('quest_claim', { segmentId }); }
export async function releaseQuest(segmentId: string) { return call('quest_release', { segmentId }); }
export async function submitQuest(segmentId: string, done: { status: string; splitMerged: string; link: string; notes: string }) {
  return call('quest_submit', { segmentId, ...done });
}

/** Annotation points in the view right now: the local annotation layers'
 *  points, lines and the rest, counted. A share link carries exactly these. */
export function annotationCountInView(): number {
  try {
    const viewer: any = (window as any)['viewer'];
    let n = 0;
    // The layers as they are, from the viewer itself.
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const layer = ml?.layer;
      if (!layer || layer.type !== 'annotation') continue;
      const local = layer.localAnnotations?.toJSON?.();
      const pending = Array.isArray(layer.localAnnotationsJson) ? layer.localAnnotationsJson.length : 0;
      n += Array.isArray(local) && local.length ? local.length : pending;
    }
    if (n > 0) return n;
    // Otherwise what a share link would carry: the saved state.
    const layers: any[] = viewer?.state?.toJSON?.()?.layers ?? [];
    return layers.filter(l => l && l.type === 'annotation' && Array.isArray(l.annotations))
      .reduce((m, l) => m + l.annotations.length, 0);
  } catch { return 0; }
}
