/**
 * Quest reviews (Celia and Ames 2026-11-05): a reviewer's feedback on a
 * submitted Cilia Quest cell arrives in the bell, and the player sends back
 * an updated link and notes, which go to the quest sheet (Player Link,
 * Player Notes, Review status "Reviewed"). Every rule is on the server
 * (functions/quest-review.js, ewQuestReview); this only asks it.
 */
import { functionUrl } from './functions_base';
import { caveToken } from './secure_write';

/** The start of a review notification's title (the server writes it). */
export const QUEST_REVIEW_TITLE = '📝 A review of your Cilia Quest cell';
/** The cell a review notification is about: its body ends "segment <id>". */
export const reviewSegment = (body: string | null | undefined) => (String(body || '').match(/segment (\d{1,20})\s*$/) || [])[1] || '';
export const isQuestReview = (n: any) => !!n && typeof n.title === 'string' && n.title.startsWith(QUEST_REVIEW_TITLE) && !!reviewSegment(n.body);
/** The reviewer's link in the notification ("**Celia's link:** [open it](...)"). */
export const reviewLinkIn = (body: string | null | undefined) => (String(body || '').match(/link:\*\* \[open it\]\((https:\/\/[^\s)]+)\)/) || [])[1] || '';

export interface ReviewState { status: string; accepted: string; playerLink: string; playerNotes: string; reviewer: string; index: string;
  /** The cell's Start Link and soma, for Jump to cell. */
  startLink?: string; soma?: string }

const call = async <T>(action: string, body: Record<string, unknown>): Promise<T> => (await post({ ...body, action })).data as T;
async function post(body: Record<string, unknown>): Promise<any> {
  const token = caveToken();
  if (!token) throw new Error('Sign in to Pyr first.');
  const res = await fetch((window as any).__NGE_QUEST_REVIEW_URL || functionUrl('ewQuestReview'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ ...body, token }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'The review sheet could not be reached.');
  return out;
}
export interface CheckResult { checked: number; results: { row: number; index: string; annotator: string; sent: boolean; why?: string }[] }
/** Admins: send every review marked "Send Review" now, without waiting for the timer. */
export const sendWaitingReviews = () => post({ action: 'check' }) as Promise<CheckResult>;
/** Admins: rewrite our own Pyr Users sheet now (functions/users-sheet.js; it also runs every hour). */
export const updateUsersSheet = () => call<{ people: number; url: string }>('usersSheet', {});
export const USERS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/10VW3cSrtK8y0pLlivJnQIuMAp65_B-eDJAVb3DbpKBs/edit';
export const getReview =(segmentId: string) => call<ReviewState>('get', { segmentId });
export const replyToReview = (segmentId: string, link: string, notes: string) =>
  call<{ status: string; playerLink: string; playerNotes: string }>('reply', { segmentId, link, notes });
