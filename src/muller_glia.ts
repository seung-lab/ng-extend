/**
 * Muller Glia Quest client (Ames 2026-11-19). Every read and write goes
 * through ewMullerGlia (functions/muller-glia.js), which knows the player from
 * their CAVE token; the tables are supabase-muller-glia.sql.
 */
import { functionUrl } from './functions_base';

export interface GliaCell { id: number; index: string; segmentId: string; soma: string; guess: string; yes: number; no: number; unsure: number; verdict: string }
export interface GliaPair { segmentId: string; glia: { index: string; at: string }[] }
export interface GliaStatus { installed: boolean; answered: number; unlockAfter: number; unlocked: boolean; split: number; confirmed: number; flagged: number; splitAll: number }
export type GliaAnswer = 'yes' | 'no' | 'unsure';

async function call<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { /* signed out */ }
  if (!token) throw new Error('Sign in to take a quest.');
  const response = await fetch(functionUrl('ewMullerGlia'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ action, token, ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The quest could not be reached. Try again in a moment.');
  return result.data as T;
}

export const gliaStatus = () => call<GliaStatus>('glia.status');
export const gliaNext = (n = 5) => call<{ cells: GliaCell[] }>('glia.next', { n });
export const gliaAnswer = (cellId: number, answer: GliaAnswer) => call<{ cell: GliaCell; answered: number }>('glia.answer', { cellId, answer });
export const gliaUndo = (cellId: number) => call<{ answered: number }>('glia.undo', { cellId });
export const gliaMine = () => call<{ answers: { cellId: number; answer: GliaAnswer; at: string; index: string; segmentId: string }[] }>('glia.mine');
export const gliaPairs = () => call<{ pairs: GliaPair[]; split: number }>('glia.pairs');
export const gliaCheck = (pairSegment: string) => call<{ split: boolean; already?: boolean; unreadable?: boolean; roots: (string | null)[] }>('glia.check', { pairSegment });
