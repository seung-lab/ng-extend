/**
 * Preferred colour families (Nseraf, report 359; Ames 2026-11-04: "a settings
 * in profile for preferred color families? users can click to open and toggle
 * the families on"). Settings, 3D Looks: pick the families you like (reds,
 * pinks, purples...). Every cell that comes into view, including the new
 * pieces of a merge or a cut, then takes a colour from those families only,
 * so annotations in other colours stay readable. L picks again, within them.
 * With no family picked, colours are neuroglancer's own, as before.
 *
 * Neuroglancer works a cell's colour out from its ID on the graphics card, so
 * a family is given as a chosen colour per cell (segmentStatedColors). The
 * ones given here are remembered and taken back when the families change or
 * are turned off; a colour a player chose for a cell is never touched.
 */
import { watch } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { useUserPreferencesStore } from '../store';
import { currentSegLayer } from '../datasets';

export interface ColorFamily { id: string; label: string; swatch: string; hues: [number, number] }
/** Hue ranges in degrees; red wraps past 360. */
export const COLOR_FAMILIES: ColorFamily[] = [
  { id: 'red', label: 'Reds', swatch: '#ff4d4d', hues: [350, 372] },
  { id: 'orange', label: 'Oranges', swatch: '#ff9a3d', hues: [18, 38] },
  { id: 'yellow', label: 'Yellows', swatch: '#ffd84d', hues: [45, 60] },
  { id: 'green', label: 'Greens', swatch: '#5fe07a', hues: [95, 150] },
  { id: 'cyan', label: 'Cyans', swatch: '#4dd8ff', hues: [175, 200] },
  { id: 'blue', label: 'Blues', swatch: '#4d7dff', hues: [210, 240] },
  { id: 'purple', label: 'Purples', swatch: '#a66bff', hues: [258, 285] },
  { id: 'pink', label: 'Pinks', swatch: '#ff6fcf', hues: [300, 335] },
];

/** IDs this module coloured, so they can be let go again, after a refresh
 *  too: the colours are in the saved view (Nseraf, report 375). */
const GIVEN_KEY = 'nge-family-colors';
const given = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(GIVEN_KEY) || '[]'); } catch { return []; } })());
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveGiven() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { localStorage.setItem(GIVEN_KEY, JSON.stringify([...given].slice(-3000))); } catch { /* this visit only */ } }, 1000);
}
let seed = 0;

function hash(s: string): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
/** A colour for this ID from the families picked, packed as neuroglancer keeps it. */
function colorFor(id: string, families: ColorFamily[]): Uint64 {
  const h = hash(id);
  const fam = families[h % families.length];
  const [lo, hi] = fam.hues;
  const hue = (lo + ((h >>> 8) % 1000) / 1000 * (hi - lo)) % 360;
  const sat = 0.65 + ((h >>> 18) % 100) / 100 * 0.3;
  const val = 0.85 + ((h >>> 25) % 16) / 100;
  const [r, g, b] = hsvToRgb(hue, sat, val);
  return new Uint64((Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16)) >>> 0, 0);
}

function picked(): ColorFamily[] {
  const ids = useUserPreferencesStore().prefs.colorFamilies ?? [];
  return COLOR_FAMILIES.filter(f => ids.includes(f.id));
}
function colorState(): any {
  try { return currentSegLayer()?.layer?.displayState?.segmentationColorGroupState?.value ?? null; } catch { return null; }
}
/** Take back every colour given here (families changed, or turned off). */
function letGo() {
  const st = colorState();
  if (st) for (const id of given) { try { st.segmentStatedColors.delete(Uint64.parseString(id)); } catch { /* not an ID */ } }
  given.clear();
  saveGiven();
}
/** Colour the cells in view that have no colour of their own yet. */
function paint() {
  const families = picked();
  if (!families.length) return;
  const st = colorState();
  const vis = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!st || !vis) return;
  const tmp = new Uint64();
  for (const seg of vis) {
    const id = seg.toString();
    if (given.has(id)) continue;
    // A colour already chosen for it (by the player, or kept through an edit) stays.
    if (st.segmentStatedColors.get(seg, tmp)) continue;
    st.segmentStatedColors.set(seg.clone(), colorFor(id, families));
    given.add(id);
    saveGiven();
  }
}

let started = false;
export function startColorFamilies() {
  if (started) return;
  started = true;
  const prefs = useUserPreferencesStore();
  watch(() => (prefs.prefs.colorFamilies ?? []).join(','), () => { letGo(); paint(); });
  // L (re-colour): a new pick within the families (segmentation_user_layer.ts).
  window.addEventListener('nge-recolor', () => { if (!picked().length) return; seed = (seed + 0x9e3779b1) >>> 0; letGo(); paint(); });
  setInterval(() => { if (!document.hidden) paint(); }, 700);
}
