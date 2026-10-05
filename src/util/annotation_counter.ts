/**
 * Annotations counter (Ames 2026-10-01).
 *
 * People can place hundreds of annotations an hour, so nothing is sent per
 * annotation. Each one is tallied in this browser (localStorage, so a reload
 * or a closed tab loses nothing) and the tally is sent about once an hour, and
 * when the tab is put away, as ONE edit_log row ('annotate', metadata.count)
 * plus one bump of users.total_annotations.
 *
 * What counts: an annotation a person places in an annotation layer (point,
 * line, box, ellipsoid). What does not: annotations the app draws itself (tag
 * and AI layers, practice lines, anything inside quietly()), the merge and
 * cut tools' own points (their sources are not a layer's), and anything that
 * arrives without a recent click or key press (a restored view).
 */
import {AnnotationSource, LocalAnnotationSource} from 'neuroglancer/annotation';
import {ref} from 'vue';
import {supabase} from '../supabase';
import {secureWrite} from '../secure_write';

const FLUSH_MS = 60 * 60 * 1000;
const GESTURE_MS = 3000;
const KEY = 'nge-annotations-pending';

/** Placed here and not yet sent. Reactive, so the profile counts live. */
export const pendingAnnotations = ref(0);
/** users.total_annotations as last read or written. */
export const sentAnnotations = ref(0);

let userId: string | null = null;
let loadedFor: string | null = null;
let getDataset: () => string | null = () => null;
let quiet = 0;
let lastGesture = 0;
let flushing = false;
const begun = new WeakMap<object, Set<string>>();

const keyFor = () => `${KEY}:${userId}`;
function readPending(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(keyFor()) || '0', 10) || 0); } catch { return pendingAnnotations.value; }
}
function writePending(n: number) {
  pendingAnnotations.value = n;
  try { localStorage.setItem(keyFor(), String(n)); } catch {}
}

/** Run app code that adds annotations of its own, uncounted. */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try { return fn(); } finally { quiet--; }
}

/** One thing the person made that the app draws as several annotations (a cube's twelve edges). */
export function countAsOne<T>(fn: () => T): T {
  const r = quietly(fn);
  tally();
  return r;
}

function tally() {
  if (!userId) return;
  if (loadedFor !== userId) pendingAnnotations.value = readPending();
  // Another tab may have counted or sent since; the stored number is the truth.
  writePending(readPending() + 1);
}

function isLayerSource(source: any): boolean {
  const layers = (window as any).viewer?.layerManager?.managedLayers;
  if (!layers) return false;
  for (const ml of layers) if (ml?.layer?.localAnnotations === source) return true;
  return false;
}

function placedByPerson(source: any): boolean {
  return quiet === 0 && !!userId && Date.now() - lastGesture < GESTURE_MS &&
    source instanceof LocalAnnotationSource && isLayerSource(source);
}

/** Send the tally. Keeps it if anything fails, and tries again next time. */
export async function flushAnnotations(): Promise<void> {
  if (!userId || flushing) return;
  const n = readPending();
  if (n <= 0) return;
  flushing = true;
  try {
    const uid = userId;
    // The server adds the tally to the total itself (at most 500 a time);
    // the browser never writes the total (leaderboard audit, 2026-10-05).
    const send = Math.min(n, 500);
    let logged = false;
    try {
      const r: any = await secureWrite('activity.log', { row: { operation: 'annotate', metadata: { count: send }, dataset: getDataset(), success: true } });
      if (r?.counted) {
        writePending(Math.max(0, readPending() - send));
        if (typeof r.total_annotations === 'number') sentAnnotations.value = r.total_annotations;
        return;
      }
      logged = true;   // recorded, but the database does not count yet
    } catch (e: any) {
      if (!/unknown action/i.test(e?.message ?? '')) return;   // kept for next time
    }
    // A server or database from before that change: as it always was.
    const { data: row, error: readErr } = await supabase.from('users').select('total_annotations').eq('id', uid).single();
    if (readErr || !row) return;                      // column not there yet, or offline
    const total = (Number((row as any).total_annotations) || 0) + send;
    const { error } = await supabase.from('users').update({ total_annotations: total }).eq('id', uid);
    if (error) return;
    // Sent: take exactly what was sent off the tally (more may have been placed meanwhile).
    writePending(Math.max(0, readPending() - send));
    sentAnnotations.value = total;
    if (!logged) supabase.from('edit_log').insert({ user_id: uid, operation: 'annotate', metadata: { count: send }, dataset: getDataset(), success: true })
      .then(({ error: e }) => { if (e) console.warn('[annotations] log row failed:', e.message); }, () => {});
  } catch (e: any) {
    console.warn('[annotations] send failed, kept for next time:', e?.message);
  } finally {
    flushing = false;
  }
}

let installed = false;
/** Patch the annotation source once. Counting starts when a user is set. */
export function installAnnotationCounter() {
  if (installed) return;
  installed = true;
  const proto: any = AnnotationSource.prototype;
  const add = proto.add, commit = proto.commit;
  proto.add = function (annotation: any, isCommit: boolean = true) {
    const ref = add.call(this, annotation, isCommit);
    try {
      if (placedByPerson(this)) {
        if (isCommit) tally();
        else {                                         // a line or box in progress: counts when finished
          let s = begun.get(this);
          if (!s) begun.set(this, s = new Set());
          s.add(ref.id);
        }
      }
    } catch {}
    return ref;
  };
  proto.commit = function (reference: any) {
    const r = commit.call(this, reference);
    try { if (begun.get(this)?.delete(reference.id) && quiet === 0) tally(); } catch {}
    return r;
  };
  const gesture = () => { lastGesture = Date.now(); };
  for (const ev of ['pointerdown', 'pointerup', 'keydown']) window.addEventListener(ev, gesture, true);
  setInterval(() => { void flushAnnotations(); }, FLUSH_MS);
  // Putting the tab away: try to send. If the browser cuts it short, the
  // tally is still in localStorage and goes out next session.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAnnotations(); });
}

/** Called once the signed-in user is known. Sends anything left from last time. */
export function setAnnotationCounterUser(id: string | null, datasetOf?: () => string | null) {
  if (datasetOf) getDataset = datasetOf;
  if (id === loadedFor && id === userId) return;
  userId = id;
  loadedFor = id;
  if (!id) return;
  pendingAnnotations.value = readPending();
  void supabase.from('users').select('total_annotations').eq('id', id).single().then(({ data }) => {
    if (data) sentAnnotations.value = Number((data as any).total_annotations) || 0;
    void flushAnnotations();
  }, () => {});
}

/** Someone else's total, or null when it can't be read. */
export async function loadAnnotationTotal(id: string): Promise<number | null> {
  const { data, error } = await supabase.from('users').select('total_annotations').eq('id', id).single();
  return error || !data ? null : Number((data as any).total_annotations) || 0;
}
