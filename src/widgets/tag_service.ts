/**
 * tag_service.ts
 * Supabase CRUD for the segment_tags table.
 * NEVER writes to CAVE / pychunkgraph — all data goes to our own Supabase DB.
 */

import {supabase} from '../supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SegmentTag {
  id: number;
  segment_id: string;
  tag: string;
  notes: string;
  source: 'spreadsheet_import' | 'user_created';
  created_by: string | null;
  dataset: string;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

// ─── Known tag values (from the spreadsheet) ───────────────────────────────

export const KNOWN_TAGS = [
  'OFF-SAC',
  'ON-SAC',
  'SAC',
  'Bipolar',
  'Amacrine',
  'Horizontal',
  'dRGC',
  'Muller',
  'Glia',
  'Unknown',
  'NEW-Other',
] as const;

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Fetch the tag record for a segment. Returns null if not in our DB.
 */
export async function fetchTagForSegment(segmentId: string): Promise<SegmentTag | null> {
  const {data, error} = await supabase
      .from('segment_tags')
      .select('*')
      .eq('segment_id', segmentId)
      .order('created_at', {ascending: false})
      .limit(1)
      .maybeSingle();

  if (error) {
    console.warn('[tag_service] fetchTagForSegment error:', error.message);
    return null;
  }
  return data as SegmentTag | null;
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Set or update the tag for a segment. If a record exists, update it.
 * If not, insert a new one.
 */
export async function setTag(
    segmentId: string,
    tag: string,
    userId?: string,
    notes?: string,
): Promise<SegmentTag | null> {
  // Check if record exists
  const existing = await fetchTagForSegment(segmentId);

  if (existing) {
    const updates: Record<string, any> = {tag, updated_at: new Date().toISOString()};
    if (notes !== undefined) updates.notes = notes;
    if (userId) updates.created_by = userId;

    const {data, error} = await supabase
        .from('segment_tags')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();

    if (error) {
      console.error('[tag_service] setTag update error:', error.message);
      return null;
    }
    console.info(`[tag_service] Updated tag for ${segmentId}: "${tag}"`);
    return data as SegmentTag;
  }

  // Insert new
  const row: Record<string, any> = {
    segment_id: segmentId,
    tag,
    notes: notes ?? '',
    source: 'user_created',
    created_by: userId ?? null,
  };

  const {data, error} = await supabase
      .from('segment_tags')
      .insert(row)
      .select()
      .single();

  if (error) {
    console.error('[tag_service] setTag insert error:', error.message);
    return null;
  }
  console.info(`[tag_service] Created tag for ${segmentId}: "${tag}"`);
  return data as SegmentTag;
}

/**
 * Clear the tag for a segment (mark as unlabeled).
 */
export async function clearTag(segmentId: string): Promise<boolean> {
  const existing = await fetchTagForSegment(segmentId);
  if (!existing) return false;

  const {error} = await supabase
      .from('segment_tags')
      .update({tag: '', updated_at: new Date().toISOString()})
      .eq('id', existing.id);

  if (error) {
    console.error('[tag_service] clearTag error:', error.message);
    return false;
  }
  console.info(`[tag_service] Cleared tag for ${segmentId}`);
  return true;
}

// ─── Spreadsheet import ─────────────────────────────────────────────────────

/**
 * Import segments + tags from a Google Sheet CSV.
 * Column B ("Segment") → segment_id
 * Column C ("Tag") → tag (stored as-is, empty string if blank)
 */
export async function importFromSheet(
    sheetUrl: string,
    dataset: string = 'eyewire_ii',
): Promise<ImportResult> {
  // Convert to CSV export URL
  let csvUrl = sheetUrl;
  const match = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const gidMatch = sheetUrl.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
  }

  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching sheet`);
  const text = await res.text();

  // Parse CSV
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) throw new Error('Sheet is empty');

  // Find header row (look for "segment" in first 10 rows)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].toLowerCase().includes('segment')) {headerIdx = i; break;}
  }

  const header = lines[headerIdx].split(',').map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (name: string) => header.findIndex(h => h.includes(name));
  const iSeg = col('segment');
  const iTag = col('tag');

  if (iSeg < 0) throw new Error('No "Segment" column found in header');

  const toInsert: any[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < lines.length; r++) {
    const fields = lines[r].split(',').map(f => f.trim());
    const segId = fields[iSeg] || '';
    if (!segId || !/^\d+$/.test(segId)) {skipped++; continue;}

    toInsert.push({
      segment_id: segId,
      tag: iTag >= 0 ? (fields[iTag] || '') : '',
      source: 'spreadsheet_import',
      dataset,
    });
  }

  if (toInsert.length === 0) throw new Error('No valid segments found');

  // Batch insert (500 rows at a time)
  const batchSize = 500;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const {error} = await supabase.from('segment_tags').insert(batch);
    if (error) throw new Error(`Batch insert error at row ${i}: ${error.message}`);
    console.info(`[tag_service] Imported batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toInsert.length / batchSize)}`);
  }

  console.info(`[tag_service] Import complete: ${toInsert.length} segments, ${skipped} skipped`);
  return {imported: toInsert.length, skipped};
}
