/**
 * Shared toolbar-icon definitions.
 *
 * ExtensionBar (the actual toolbar) and SettingsPanel (the per-user
 * customization list) BOTH render the same set of icons, so we keep
 * one source of truth here. Each entry has:
 *   - id     stable string referenced from prefs.toolbarIcons
 *   - label  tooltip / settings-list label
 *   - emoji  fallback if svg/img can't render
 *   - svg    inline SVG markup (uses currentColor + 1em sizing — set
 *            font-size on the parent to scale; e.g. font-size: 18px in
 *            the toolbar, 14px in settings)
 *   - img    static asset URL — preferred when present (Cell Library
 *            uses the neuron PNG which doesn't fit a single-color SVG)
 *
 * Action handlers live in ExtensionBar; this file is purely visual
 * metadata.
 */
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';

export interface ToolbarIconDef {
  id: string;
  emoji: string;
  svg?: string;
  img?: string;
  label: string;
}

// ── Color palette ──────────────────────────────────────────────────
const NEUTRAL_COLOR = '#cfdcef';        // muted blue-white
const ACCENT_RED    = '#e06060';
const ACCENT_GREEN  = '#60c060';
const ACCENT_PURPLE = '#c8a4ff';
const ACCENT_AMBER  = '#f5d142';

// SVGs use width:1em / height:1em so the consumer's font-size controls
// the rendered size. Consistent stroke width (1.6px) and currentColor.
const S = 'width:1em;height:1em;vertical-align:middle;';

const SPLIT_SVG     = `<svg viewBox="-0.05 -0.3 16.1 16.1" fill="none" style="${S}color:${ACCENT_RED}"><path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="2.5" r="1.4" fill="currentColor"/><circle cx="4" cy="13" r="1.4" fill="currentColor"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/><path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const MERGE_SVG     = `<svg viewBox="-0.05 -0.3 16.1 16.1" fill="none" style="${S}color:${ACCENT_GREEN}"><path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="4" cy="2.5" r="1.4" fill="currentColor"/><circle cx="12" cy="2.5" r="1.4" fill="currentColor"/><circle cx="8" cy="13" r="1.4" fill="currentColor"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const FINDPATH_SVG  = `<svg viewBox="0.0 0.0 16.0 16.0" fill="none" style="${S}color:${ACCENT_PURPLE}"><circle cx="3" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="3" r="1.6" fill="currentColor"/><path d="M5 12 Q7 9 8 8 Q9 7 11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.4 1.8"/></svg>`;
// Stacked sheets — the neuroglancer layer-list toggle, brought into our toolbar
// so it's reorderable and toggleable like every other icon (the native button
// is hidden in ng-override.css). A flat top diamond over two offset sheets, kept
// distinct from the batch cube.
const LAYERS_SVG    = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M8 1.7 14.4 5 8 8.3 1.6 5 8 1.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2.2 8 8 11 13.8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 11 8 14 13.8 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// A week (calendar frame with day ticks) containing a rising trend line, so the
// icon says "your week" + "progress" rather than the generic bar chart it was,
// which was indistinguishable from any other stats/analytics glyph.
const RECAP_SVG       = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><rect x="1.6" y="2.9" width="12.8" height="11.5" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M1.6 6.1h12.8" stroke="currentColor" stroke-width="1.3"/><path d="M4.8 1.5v2.6M11.2 1.5v2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.2 12.1l2.5-2.7 2.1 1.6 2.9-3.3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.7" cy="7.7" r="1.05" fill="currentColor"/></svg>`;
const LEADERBOARD_SVG = `<svg viewBox="1.1 0.6 13.8 13.8" fill="none" style="${S}color:${ACCENT_AMBER}"><path d="M5 2h6v3.5a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 3H3v.8a2 2 0 0 0 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 3h2v.8a2 2 0 0 1-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 13h5l-.5-1.4h-4z" fill="currentColor"/></svg>`;
const BATCH_SVG       = `<svg viewBox="0.6 0.4 14.8 14.8" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M8 1.8L13.5 4.6V11L8 13.8L2.5 11V4.6L8 1.8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.5 4.6L8 7.4L13.5 4.6M8 7.4V13.8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const HELP_SVG        = `<svg viewBox="1.4 1.4 13.4 13.4" fill="none" style="${S}color:${NEUTRAL_COLOR}"><circle cx="6.6" cy="6.6" r="3.8" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 9.6l3.8 3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const NOTIF_SVG       = `<svg viewBox="0.85 1.6 14.3 14.3" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M3.7 11.5h8.6c.5 0 .8-.5.5-.95L11.5 8.8V6.5a3.5 3.5 0 0 0-7 0v2.3L3.2 10.55c-.3.45 0 .95.5.95z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const CHAT_SVG        = `<svg viewBox="1.1 1.6 13.8 13.8" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M2.5 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7L4.5 14v-2.5a2 2 0 0 1-2-2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
// Heroicons cog-6-tooth — proper teeth, not radial lines.
const SETTINGS_SVG    = `<svg viewBox="1.6 1.6 20.8 20.8" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.213-1.281Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" stroke-width="1.5"/></svg>`;
const QUEST_SVG       = `<svg viewBox="0.85 1.1 14.3 14.3" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M8 2.5C5.2 2.5 3 4.7 3 7.4c0 1.4.6 2.7 1.6 3.6.5.4.7 1 .7 1.6V14h5.4v-1.4c0-.6.2-1.2.7-1.6 1-.9 1.6-2.2 1.6-3.6 0-2.7-2.2-4.9-5-4.9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.8 14h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const FEED_SVG        = `<svg viewBox="0.4 2.6 13.0 13.0" fill="none" style="${S}color:${NEUTRAL_COLOR}"><circle cx="3.2" cy="12.8" r="1.4" fill="currentColor"/><path d="M2 8.5a5.5 5.5 0 0 1 5.5 5.5M2 4a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const TOOLBAR_ICON_DEFS: ToolbarIconDef[] = [
  { id: 'split',       emoji: '✂️', svg: SPLIT_SVG,       label: 'Cut Mode (C)' },
  { id: 'merge',       emoji: '🔗', svg: MERGE_SVG,       label: 'Merge Mode (M)' },
  { id: 'findPath',    emoji: '🛤️', svg: FINDPATH_SVG,    label: 'Find Path (F)' },
  { id: 'layers',      emoji: '🗂️', svg: LAYERS_SVG,      label: 'Layers' },
  { id: 'recap',       emoji: '📊', svg: RECAP_SVG,       label: 'Your Week in Science' },
  { id: 'leaderboard', emoji: '🏆', svg: LEADERBOARD_SVG, label: 'Leaderboard' },
  { id: 'quest',       emoji: '🧠', svg: QUEST_SVG,       label: 'Brain Quest' },
  { id: 'cells',       emoji: '🧬', img: neuronIcon,      label: 'Cell Library' },
  { id: 'batch',       emoji: '📦', svg: BATCH_SVG,       label: 'Batch Processor' },
  { id: 'help',        emoji: '🔍', svg: HELP_SVG,        label: 'Second Opinion Requests' },
  { id: 'feed',        emoji: '📡', svg: FEED_SVG,        label: 'Activity Feed' },
  { id: 'notif',       emoji: '🔔', svg: NOTIF_SVG,       label: 'Notifications' },
  { id: 'chat',        emoji: '💬', svg: CHAT_SVG,        label: 'Chat' },
  { id: 'settings',    emoji: '⚙️', svg: SETTINGS_SVG,    label: 'Profile Settings' },
];

export function getToolbarIconDef(id: string): ToolbarIconDef | undefined {
  return TOOLBAR_ICON_DEFS.find(d => d.id === id);
}

/**
 * Icon ids that are still defined (they keep their action/label) but are no
 * longer shown in the toolbar. Single source of truth so the actual toolbar
 * (ExtensionBar) and the Settings customization grid stay in sync — the grid
 * must only offer icons that can really appear in the top bar.
 */
export const RETIRED_TOOLBAR_ICON_IDS = ['quest', 'feed'];

/**
 * Default toolbar icon order for a user with no saved preference. Shared by the
 * actual toolbar (ExtensionBar) and the Settings "Reset to defaults" grid so
 * the two never drift — a mismatch here is exactly what left the Layers icon
 * in the top bar but absent from Settings.
 */
export const DEFAULT_TOOLBAR_ORDER = [
  'split', 'merge', 'findPath', 'layers', 'recap', 'leaderboard',
  'cells', 'batch', 'help', 'notif', 'chat', 'settings',
];

/**
 * Icons added after this feature shipped, so they're missing from older saved
 * prefs. Auto-injected at a sensible slot by resolveToolbarOrder. Position is
 * relative to an anchor so they land where they belong rather than at the end.
 */
const AUTO_INJECT_TOOLBAR_ICONS: { id: string; after?: string; beforeFallback?: string }[] = [
  { id: 'batch',    beforeFallback: 'settings' },
  { id: 'notif',    beforeFallback: 'settings' },
  { id: 'chat',     beforeFallback: 'settings' },
  { id: 'findPath', after: 'merge' },
  { id: 'layers',   after: 'findPath', beforeFallback: 'settings' },
];

/**
 * Canonical toolbar order for a given saved preference. The ONE place that
 * turns a user's stored `toolbarIcons` into what actually renders: fall back to
 * the default when empty, inject icons added since the prefs were saved, and
 * drop retired ids. Both the live toolbar (ExtensionBar) and the Settings grid
 * call this, so what you toggle in Settings is exactly what the top bar shows.
 *
 * `findPath` is injected before `layers` in this list, because `layers` anchors
 * itself after `layers`' own anchor `findPath`.
 *
 * `injected` is the per-user list of ids that have ALREADY been auto-injected
 * once (prefs.toolbarIconsInjected). An id absent from `saved` but present in
 * `injected` means the user removed it deliberately, so it stays removed.
 * Array membership alone can't make that distinction, which was Celia's
 * "icons don't get removed" bug (approved triage spec, 2026-08-11). Callers
 * that persist prefs should also persist markInjected() to record the ids
 * this call injected.
 */
export function resolveToolbarOrder(saved: string[], injected: string[] = []): string[] {
  const order = saved.length > 0 ? [...saved] : [...DEFAULT_TOOLBAR_ORDER];
  for (const spec of AUTO_INJECT_TOOLBAR_ICONS) {
    if (order.includes(spec.id)) continue;
    if (saved.length > 0 && injected.includes(spec.id)) continue; // user removed it
    let at = order.length;
    if (spec.after && order.indexOf(spec.after) >= 0) {
      at = order.indexOf(spec.after) + 1;
    } else if (spec.beforeFallback && order.indexOf(spec.beforeFallback) >= 0) {
      at = order.indexOf(spec.beforeFallback);
    }
    order.splice(at, 0, spec.id);
  }
  return order.filter(id => !RETIRED_TOOLBAR_ICON_IDS.includes(id));
}

/** Union of previously-injected ids with everything injectable, for callers
 *  persisting prefs: once saved, every auto-inject id counts as offered. */
export function markInjected(injected: string[] = []): string[] {
  return [...new Set([...injected, ...AUTO_INJECT_TOOLBAR_ICONS.map(s => s.id)])];
}
