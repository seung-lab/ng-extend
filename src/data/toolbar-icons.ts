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

const SPLIT_SVG     = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${ACCENT_RED}"><path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="2.5" r="1.4" fill="currentColor"/><circle cx="4" cy="13" r="1.4" fill="currentColor"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/><path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const MERGE_SVG     = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${ACCENT_GREEN}"><path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="4" cy="2.5" r="1.4" fill="currentColor"/><circle cx="12" cy="2.5" r="1.4" fill="currentColor"/><circle cx="8" cy="13" r="1.4" fill="currentColor"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const FINDPATH_SVG  = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${ACCENT_PURPLE}"><circle cx="3" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="3" r="1.6" fill="currentColor"/><path d="M5 12 Q7 9 8 8 Q9 7 11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.4 1.8"/></svg>`;
const RECAP_SVG       = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><rect x="2" y="10" width="2.4" height="4" rx="0.5" fill="currentColor" opacity="0.45"/><rect x="5.5" y="7" width="2.4" height="7" rx="0.5" fill="currentColor" opacity="0.65"/><rect x="9" y="4" width="2.4" height="10" rx="0.5" fill="currentColor" opacity="0.85"/><rect x="12.5" y="1.5" width="2" height="12.5" rx="0.5" fill="currentColor"/></svg>`;
const LEADERBOARD_SVG = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${ACCENT_AMBER}"><path d="M5 2h6v3.5a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 3H3v.8a2 2 0 0 0 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 3h2v.8a2 2 0 0 1-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 13h5l-.5-1.4h-4z" fill="currentColor"/></svg>`;
const BATCH_SVG       = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M8 1.8L13.5 4.6V11L8 13.8L2.5 11V4.6L8 1.8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.5 4.6L8 7.4L13.5 4.6M8 7.4V13.8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const HELP_SVG        = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><circle cx="6.6" cy="6.6" r="3.8" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 9.6l3.8 3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const NOTIF_SVG       = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M3.7 11.5h8.6c.5 0 .8-.5.5-.95L11.5 8.8V6.5a3.5 3.5 0 0 0-7 0v2.3L3.2 10.55c-.3.45 0 .95.5.95z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const CHAT_SVG        = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M2.5 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7L4.5 14v-2.5a2 2 0 0 1-2-2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
// Heroicons cog-6-tooth — proper teeth, not radial lines.
const SETTINGS_SVG    = `<svg viewBox="0 0 24 24" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.213-1.281Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" stroke-width="1.5"/></svg>`;
const QUEST_SVG       = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><path d="M8 2.5C5.2 2.5 3 4.7 3 7.4c0 1.4.6 2.7 1.6 3.6.5.4.7 1 .7 1.6V14h5.4v-1.4c0-.6.2-1.2.7-1.6 1-.9 1.6-2.2 1.6-3.6 0-2.7-2.2-4.9-5-4.9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.8 14h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const FEED_SVG        = `<svg viewBox="0 0 16 16" fill="none" style="${S}color:${NEUTRAL_COLOR}"><circle cx="3.2" cy="12.8" r="1.4" fill="currentColor"/><path d="M2 8.5a5.5 5.5 0 0 1 5.5 5.5M2 4a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const TOOLBAR_ICON_DEFS: ToolbarIconDef[] = [
  { id: 'split',       emoji: '✂️', svg: SPLIT_SVG,       label: 'Cut Mode (C)' },
  { id: 'merge',       emoji: '🔗', svg: MERGE_SVG,       label: 'Merge Mode (M)' },
  { id: 'findPath',    emoji: '🛤️', svg: FINDPATH_SVG,    label: 'Find Path (F)' },
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
