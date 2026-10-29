/**
 * Asking for access to one dataset (Ames 2026-10-28: "can we make this have a
 * button to request access?"). The note on a view the player can't load and
 * the locked cards in the dataset switcher both ask here. The server files a
 * report, tells every admin and posts to Slack (functions/access-request.js,
 * access.dataset); an admin adds the player in CAVE, then marks it Granted or
 * Not now in Admin Hub, Access requests, and the player gets a bell.
 * Retina has its own request with examples (access_request.ts): its button
 * opens that panel instead.
 */
import { ref } from 'vue';
import { secureWrite } from './secure_write';
import type { DatasetEntry } from './datasets';
import { datasetAccess } from './util/dataset_access';
import { useProofreadingBackendStore } from './store';

export type DatasetRequestMark = 'granted' | 'declined' | null;
export interface DatasetRequestState { at: string; mark: DatasetRequestMark }
export interface DatasetRequestRow {
  id: string; userId: string | null; name: string | null; dataset: string | null; label: string;
  cave: string; email: string; note: string; at: string;
  /** What they can already do in CAVE, by CAVE dataset, and their groups;
   *  null when not read (answered, or CAVE could not say). */
  access: { edit: string[]; view: string[]; groups: string[] } | null;
  /** When they joined Pyr, and their first and latest edit in each dataset
   *  (by Pyr dataset tag). null when not read. */
  history: { joined: string | null; datasets: { dataset: string; first: string; last: string }[] } | null;
  /** The CAVE group Granted adds them to, or '' when that is done by hand. */
  caveGroup: string;
  mark: DatasetRequestMark; markedAt: string | null; markedBy: string;
}

export const RETINA_ID = 'stroeh_mouse_retina';
const RETINA_CAVE = 'stroeh-mouse-retina';

/** This player's requests, by dataset id; null until read. */
export const myDatasetRequests = ref<Record<string, DatasetRequestState> | null>(null);
let reading: Promise<void> | null = null;

export function loadMyDatasetRequests(force = false): Promise<void> {
  if (myDatasetRequests.value && !force) return Promise.resolve();
  if (reading) return reading;
  reading = secureWrite<{ requests: Record<string, DatasetRequestState> }>('access.datasetStatus')
    .then(r => { myDatasetRequests.value = r?.requests || {}; })
    .catch(() => { /* stays unknown: the button still works */ })
    .finally(() => { reading = null; });
  return reading;
}

/**
 * Tiers (Ames 2026-10-28): a Sandbox player can't ask for another dataset
 * straight away. First they earn edit access on the retina by sending their
 * edits (the retina request, access_request.ts); with that, they may ask for
 * MEC and the rest. True when CAVE says they can't edit the retina yet. While
 * CAVE has not answered, nothing is held back.
 */
export function needsRetinaFirst(ds: DatasetEntry | undefined): boolean {
  if (!ds || ds.id === RETINA_ID) return false;
  try { if (useProofreadingBackendStore().isAdmin) return false; } catch { /* no store yet */ }
  const retina = datasetAccess(RETINA_CAVE);
  return retina !== 'edit' && retina !== 'unknown';
}

/** Where this player's request for a dataset stands. */
export function requestStateOf(ds: DatasetEntry | undefined): 'none' | 'open' | 'granted' | 'declined' {
  const r = ds ? myDatasetRequests.value?.[ds.id] : undefined;
  if (!r) return 'none';
  return r.mark === 'granted' ? 'granted' : r.mark === 'declined' ? 'declined' : 'open';
}

/** Ask for access. Retina opens its own request panel. Throws a sentence. */
export async function requestDatasetAccess(ds: DatasetEntry, note = ''): Promise<void> {
  if (ds.id === RETINA_ID || needsRetinaFirst(ds)) {
    document.dispatchEvent(new CustomEvent('nge:access-open'));
    return;
  }
  const r = await secureWrite<{ requests: Record<string, DatasetRequestState> }>('access.dataset', {
    datasetId: ds.id, label: ds.label, caveDataset: ds.caveDataset || '', note,
  });
  myDatasetRequests.value = r?.requests || myDatasetRequests.value || {};
}

/** Admins: every request, newest first. */
export function listDatasetRequests(): Promise<DatasetRequestRow[]> {
  return secureWrite<DatasetRequestRow[]>('access.datasetList');
}
/** Admins: Granted, Not now, or back to waiting. The player is told. */
export function decideDatasetRequest(id: string, mark: 'granted' | 'declined' | 'waiting', note = '', byHand = false): Promise<DatasetRequestRow[]> {
  return secureWrite<DatasetRequestRow[]>('access.datasetDecide', { id, mark, note, byHand });
}
