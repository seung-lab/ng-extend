/**
 * Every key a player can press, for the Keys list in the Ctrl+K / Cmd+K dock
 * (type "keys" or "?", or press ? anywhere) and the command search.
 *
 * Read from the live bindings wherever they can be read, so the list cannot
 * go stale (Ames 2026-10-23: players only learned new keys from the
 * changelog):
 *  - neuroglancer's viewer.inputEventBindings (global, 2D, 3D), which already
 *    hold Pyr's own changes: config/custom-keybinds.json (M, C, T, F) and
 *    SLICE_KEYS in util/three_d_controls.ts (Q, W);
 *  - the tool slots bound to Shift+letter (viewer.globalToolBinder);
 *  - the shortcut fields of the command palette's commands.
 * PYR_KEYS hand lists only the keydown handlers Pyr adds on the window or
 * document, which nothing can read. A new global key handler goes there.
 *
 * warnKeyClashes() runs on dev and test sites and warns in the console when
 * two handlers take the same key: Z went to slice stepping over neuroglancer's
 * snap without anyone noticing (Ames 2026-10-23).
 */
// @ts-ignore: JSON import (esbuild bundles it), as assistant/knowledge.ts does.
import CUSTOM_KEYBINDS from '../../config/custom-keybinds.json';
import { isMac } from './platform';
import { UNDELETE_KEYS } from './undelete';

export type KeyGroup = 'Moving around' | 'Editing' | 'Tools' | 'Panels';
export const KEY_GROUPS: KeyGroup[] = ['Moving around', 'Editing', 'Tools', 'Panels'];

export interface KeyEntry {
  id: string;
  label: string;
  group: KeyGroup;
  /** As shown, e.g. ['Q', ','] or ['Shift+Delete']. */
  keys: string[];
  /** The same keys in neuroglancer's form ('shift+delete'), to press one. */
  strokes: string[];
  /** Where the key works, when not everywhere: '2D', '3D', 'In Highlight mode'. */
  where?: string;
  /** A command to run when the row is clicked (CommandPalette ids). */
  runId?: string;
}

/** A Pyr handler on the window or document. `keys` are neuroglancer style
 *  strokes ('shift+delete'); 'mod' is Ctrl, or Cmd on a Mac. `scoped` keys
 *  only act inside a mode or a panel, so they never clash. `hidden` keys are
 *  left out of the list but still checked for clashes. */
export interface PyrKey {
  keys: string[];
  label: string;
  group: KeyGroup;
  owner: string;
  where?: string;
  scoped?: boolean;
  hidden?: boolean;
  /** Shown instead of the formatted stroke, e.g. '?' for shift+slash. */
  shown?: string;
}

export const PYR_KEYS: PyrKey[] = [
  { keys: ['mod+keyk'], label: 'Ask Nurro, or search for a command', group: 'Panels', owner: 'ExtensionBar' },
  { keys: ['shift+slash'], shown: '?', label: 'This list of keys', group: 'Panels', owner: 'ExtensionBar' },
  { keys: ['shift+keyt'], label: 'Scout Tag mode', group: 'Tools', owner: 'ExtensionBar' },
  { keys: ['shift+keyh'], label: 'Highlight mode', group: 'Tools', owner: 'ExtensionBar' },
  { keys: ['keyh'], label: 'Hold to place a point', group: 'Tools', owner: 'HighlightModePanel', where: 'In Highlight mode', scoped: true },
  { keys: ['shift+keyn'], label: 'Lantern on or off', group: 'Tools', owner: 'ExtensionBar' },
  { keys: ['shift+keyl'], label: 'Cell Library', group: 'Panels', owner: 'ExtensionBar' },
  { keys: ['shift+keys'], label: 'Settings', group: 'Panels', owner: 'ExtensionBar' },
  { keys: ['backslash'], label: 'Show or hide the top bar', group: 'Panels', owner: 'ExtensionBar', where: 'With Magic Top Bar on in Settings' },
  // Found, not labeled (ExtensionBar).
  { keys: ['shift+keyf'], label: 'Flight mode', group: 'Tools', owner: 'ExtensionBar', hidden: true },
  { keys: ['keyp'], label: 'Send a pulse along the cell under the mouse', group: 'Tools', owner: 'pulse_key', where: '3D' },
  { keys: ['escape'], label: 'Leave the merge or cut tool', group: 'Tools', owner: 'main' },
  ...UNDELETE_KEYS.map(k => ({ ...k, group: 'Editing' as const, owner: 'undelete' })),
  { keys: ['delete', 'backspace'], label: 'Remove the cells picked in the list', group: 'Editing', owner: 'drag_reorder', where: 'Cells picked in the list', scoped: true },
  { keys: ['control+shift+keyc'], label: 'Mark the selected cell complete', group: 'Editing', owner: 'CommandPalette' },
  { keys: ['control+shift+keyp'], label: 'Your profile', group: 'Panels', owner: 'CommandPalette' },
  { keys: ['control+shift+keyl'], label: 'Leaderboard', group: 'Panels', owner: 'CommandPalette' },
  { keys: ['control+keyd'], label: 'Switch dataset', group: 'Panels', owner: 'CommandPalette' },
];

/** neuroglancer's actions, in Pyr's words. null leaves one out of the list. */
const ACTIONS: Record<string, [string, KeyGroup] | null> = {
  'x-': ['Move left, right, up and down', 'Moving around'],
  'x+': ['Move left, right, up and down', 'Moving around'],
  'y-': ['Move left, right, up and down', 'Moving around'],
  'y+': ['Move left, right, up and down', 'Moving around'],
  'z-': ['Back a slice', 'Moving around'],
  'z+': ['Forward a slice', 'Moving around'],
  'snap': ['Snap the view straight', 'Moving around'],
  'zoom-in': ['Zoom in', 'Moving around'],
  'zoom-out': ['Zoom out', 'Moving around'],
  'rotate-relative-z-': ['Turn the view', 'Moving around'],
  'rotate-relative-z+': ['Turn the view', 'Moving around'],
  'rotate-relative-x-': ['Tilt the view', 'Moving around'],
  'rotate-relative-x+': ['Tilt the view', 'Moving around'],
  'rotate-relative-y-': ['Tilt the view', 'Moving around'],
  'rotate-relative-y+': ['Tilt the view', 'Moving around'],
  'depth-range-decrease': ['Show less depth', 'Moving around'],
  'depth-range-increase': ['Show more depth', 'Moving around'],
  't-': null,
  't+': null,
  'select-previous': ['Previous cell in the list', 'Editing'],
  'select-next': ['Next cell in the list', 'Editing'],
  'clear-segments': ['Clear every cell from the view', 'Editing'],
  'tool-grapheneMergeSegments': ['Merge tool', 'Tools'],
  'tool-grapheneMulticutSegments': ['Cut tool', 'Tools'],
  'tool-grapheneFindPath': ['Find Path', 'Tools'],
  'tool-freeRotateCubeAnnotationTool': ['Free rotate the box', 'Tools'],
  'recolor': ['New colors for the cells', 'Panels'],
  'toggle-show-slices': ['Show or hide the slices in 3D', 'Panels'],
  'toggle-scale-bar': ['Show or hide the scale bar', 'Panels'],
  'toggle-default-annotations': ['Show or hide the volume outline', 'Panels'],
  'toggle-axis-lines': ['Show or hide the axis lines', 'Panels'],
  'toggle-orthographic-projection': ['3D in perspective or flat', 'Panels'],
  'toggle-layout': ['Change the view layout', 'Panels'],
  'toggle-layout-alternative': ['Change the view layout', 'Panels'],
  'toggle-show-statistics': ['Show or hide loading statistics', 'Panels'],
  'help': ["Neuroglancer's own key panel", 'Panels'],
  'add-layer': ['Add a layer', 'Panels'],
};
/** Families of nine (keys 1 to 9), shown as one row. */
const LAYER_FAMILIES: [RegExp, string][] = [
  [/^nge-number-layer-\d$/, 'Make layer 1 to 9 the active one (with Classic Layers in Settings: show or hide it)'],
  [/^toggle-layer-\d$/, 'Show or hide layer 1 to 9'],
  [/^select-layer-\d$/, 'Open layer 1 to 9 in the side panel'],
  [/^toggle-pick-layer-\d$/, 'Picking on or off for layer 1 to 9'],
];

const KEY_NAMES: Record<string, string> = {
  comma: ',', period: '.', slash: '/', backslash: '\\', bracketleft: '[', bracketright: ']',
  equal: '=', minus: '-', space: 'Space', delete: 'Delete', backspace: 'Backspace',
  escape: 'Esc', enter: 'Enter', tab: 'Tab',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
};
const MOD_ORDER = ['control', 'alt', 'meta', 'shift'];

/** 'Shift+keyt' or 'at:shift+keyt' to neuroglancer's normal form 'shift+keyt'. */
export function normalStroke(s: string): string {
  const parts = s.toLowerCase().replace(/^(at|bubble|capture):/, '').split('+');
  const key = parts.pop()!;
  const mods = parts.map(p => (p === 'mod' || p === 'ctrl') ? 'control' : p === 'cmd' ? 'meta' : p);
  return [...MOD_ORDER.filter(m => mods.includes(m)), key].join('+');
}

/** 'control+shift+keyc' to 'Ctrl+Shift+C'; 'mod' to Cmd on a Mac. */
export function showStroke(s: string): string {
  const parts = s.toLowerCase().split('+');
  const key = parts.pop()!;
  const mods = parts.map(p => p === 'mod' ? (isMac() ? 'Cmd' : 'Ctrl')
    : p === 'control' ? 'Ctrl' : p === 'meta' ? 'Cmd' : p.charAt(0).toUpperCase() + p.slice(1));
  const k = /^key[a-z]$/.test(key) ? key.slice(3).toUpperCase()
    : /^digit\d$/.test(key) ? key.slice(5)
    : KEY_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  return [...mods, k].join('+');
}

/** 'Ctrl+Shift+C' (a palette shortcut field) to 'control+shift+keyc'. */
function strokeFromShown(shown: string): string {
  const parts = shown.split('+');
  const key = parts.pop()!;
  const named = Object.entries(KEY_NAMES).find(([, v]) => v.toLowerCase() === key.toLowerCase())?.[0];
  const code = /^[a-z]$/i.test(key) ? 'key' + key.toLowerCase() : /^\d$/.test(key) ? 'digit' + key : named ?? key.toLowerCase();
  return normalStroke([...parts, code].join('+'));
}

const isKeyStroke = (s: string) => !/(mouse|wheel|click|touch|drag)/.test(s);
const isToolSlot = (action: string) => /^tool-[A-Z]$/.test(action);

/** Letters whose tool also sits on a plain key (custom-keybinds.json), so its
 *  Shift+letter slot is a second way to the same tool, not a key of its own. */
function customToolLetters(): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(CUSTOM_KEYBINDS as Record<string, any>)) {
    if (v && typeof v === 'object' && /^key[a-z]$/.test(k)) out.add(k.slice(3).toUpperCase());
  }
  return out;
}
/** Keys custom-keybinds.json turns off on purpose ("keyx": false). */
function turnedOff(): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(CUSTOM_KEYBINDS as Record<string, any>)) if (v === false) out.add(normalStroke(k));
  return out;
}

interface Live { stroke: string; action: string; where: '2D' | '3D' | ''; direct: boolean; replaced?: string }

/** Each key in neuroglancer's three live maps and the action that wins it. */
function liveBindings(viewer: any): Live[] {
  const b = viewer?.inputEventBindings;
  if (!b) return [];
  const scopes: [any, Live['where']][] = [[b.global, ''], [b.sliceView, '2D'], [b.perspectiveView, '3D']];
  const out: Live[] = [];
  for (const [map, where] of scopes) {
    if (!map?.bindings) continue;
    // Every stroke anywhere in the chain, then neuroglancer's own lookup.
    const strokes = new Map<string, string>();   // stroke -> normalized id
    const parentActions = new Map<string, string>();
    const walk = (m: any, top: boolean) => {
      for (const [id, ea] of m.bindings ?? []) {
        if (!/^at:/.test(id)) continue;
        const s = id.slice(3);
        if (!isKeyStroke(s)) continue;
        if (!strokes.has(s)) strokes.set(s, id);
        if (!top && !parentActions.has(s)) parentActions.set(s, ea?.action ?? ea);
      }
      for (const p of m.parents ?? []) walk(p, false);
    };
    walk(map, true);
    for (const [s, id] of strokes) {
      const action = map.get(id)?.action;
      if (!action) continue;
      const direct = map.bindings.get(id)?.action === action;
      const before = parentActions.get(s);
      out.push({ stroke: s, action, where, direct, ...(direct && before && before !== action ? { replaced: before } : {}) });
    }
  }
  return out;
}

/** A command from the palette that shows a key (its shortcut field). */
export interface CommandKey { id: string; label: string; shortcut: string; category: string }

/** The whole list, grouped and ordered as KEY_GROUPS. */
export function collectKeys(viewer: any, commands: CommandKey[] = []): KeyEntry[] {
  const rows = new Map<string, KeyEntry>();     // by group + label + where
  const taken = new Set<string>();              // strokes already shown
  const commandFor = new Map<string, string>(); // stroke -> command id
  for (const c of commands) commandFor.set(strokeFromShown(c.shortcut), c.id);
  const add = (label: string, group: KeyGroup, stroke: string, shown: string, where = '', runId?: string, claim = true) => {
    const k = `${group}|${label}|${where}`;
    let row = rows.get(k);
    if (!row) {
      const slug = `${label} ${where}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      row = { id: `key-${slug}`, label, group, keys: [], strokes: [], ...(where ? { where } : {}) };
      rows.set(k, row);
    }
    if (!row.keys.includes(shown)) { row.keys.push(shown); row.strokes.push(stroke); }
    // A palette command for the same key runs it best (Merge selects the layer first).
    const run = commandFor.get(stroke) ?? runId;
    if (run && !row.runId) row.runId = run;
    if (claim) taken.add(stroke);
  };

  for (const p of PYR_KEYS) {
    if (p.hidden) continue;
    // A key that only acts inside a mode leaves the key free elsewhere (H).
    for (const s of p.keys) add(p.label, p.group, normalStroke(s), p.shown ?? showStroke(s), p.where, undefined, !p.scoped);
  }

  const pyrRows = rows.size;
  const actionOf = new Map<KeyEntry, string>();
  // A key bound the same way in 2D and 3D is one row with no "where".
  const live = liveBindings(viewer).filter(l => !l.action.startsWith('tool-undefined') && !isToolSlot(l.action));
  const both = new Set<string>();
  const in2d = new Set(live.filter(l => l.where === '2D').map(l => l.stroke + '>' + l.action));
  for (const l of live) if (l.where === '3D' && in2d.has(l.stroke + '>' + l.action)) both.add(l.stroke + '>' + l.action);
  const families = new Map<string, { group: KeyGroup; digits: string[]; mods: string }>();
  for (const l of live) {
    const dual = both.has(l.stroke + '>' + l.action);
    if (dual && l.where === '3D') continue;
    const where = dual ? '' : l.where;
    if (taken.has(l.stroke)) continue;
    const fam = LAYER_FAMILIES.find(([re]) => re.test(l.action));
    if (fam) {
      const mods = l.stroke.replace(/digit\d$/, '');
      const f = families.get(fam[1]) ?? { group: 'Panels' as KeyGroup, digits: [], mods };
      f.digits.push(l.stroke.slice(-1));
      families.set(fam[1], f);
      continue;
    }
    const known = ACTIONS[l.action];
    if (known === null) continue;
    const label = known?.[0] ?? l.action.replace(/^tool-/, '').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
    const group = known?.[1] ?? (l.action.startsWith('toggle') ? 'Panels' : 'Editing');
    add(label, group, l.stroke, showStroke(l.stroke), where ? where : undefined);
    const row = rows.get(`${group}|${label}|${where}`)!;
    if (!actionOf.has(row)) actionOf.set(row, l.action);
  }
  for (const [label, f] of families) {
    const d = f.digits.sort();
    const shown = showStroke(f.mods + 'digit' + d[0]) + (d.length > 1 ? ' to ' + d[d.length - 1] : '');
    add(label, f.group, f.mods + 'digit' + d[0], shown);
  }

  // Tools on Shift+letter that are not already on a plain key.
  try {
    const plain = customToolLetters();
    for (const [letter, tool] of viewer?.globalToolBinder?.bindings ?? []) {
      if (plain.has(letter) || taken.has('shift+key' + letter.toLowerCase())) continue;
      add(String(tool?.description || 'Layer tool'), 'Tools', 'shift+key' + letter.toLowerCase(), `Shift+${letter}`, undefined, `tool-binding-${letter}`);
    }
  } catch { /* no tool binder yet */ }

  // Palette commands that show a key nobody above has listed.
  const GROUP_OF: Record<string, KeyGroup> = { action: 'Editing', navigate: 'Panels', tool: 'Tools' };
  for (const c of commands) {
    const s = strokeFromShown(c.shortcut);
    if (taken.has(s)) continue;
    add(c.label, GROUP_OF[c.category] ?? 'Tools', s, c.shortcut, undefined, c.id);
  }

  // By group; inside one, Pyr's keys first, then neuroglancer's in the order
  // of ACTIONS, then the rest as found.
  const actionOrder = Object.keys(ACTIONS);
  const rank = (r: KeyEntry, i: number) => {
    const a = actionOf.has(r) ? actionOrder.indexOf(actionOf.get(r)!) : -1;
    return a >= 0 ? 1000 + a : i < pyrRows ? i : 2000 + i;
  };
  const list = [...rows.values()].map((r, i) => ({ r, k: rank(r, i) }));
  const order = (g: KeyGroup) => KEY_GROUPS.indexOf(g);
  return list.sort((a, b) => order(a.r.group) - order(b.r.group) || a.k - b.k).map(x => x.r);
}

/** Dev and test sites, or a player who asks with localStorage nge_key_check=1. */
function checkHere(): boolean {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost') || h.includes('-dot-')) return true;
  try { return localStorage.getItem('nge_key_check') === '1'; } catch { return false; }
}

/** The clashes, as console lines. Exported for a test. */
export function findKeyClashes(viewer: any, commands: CommandKey[] = []): string[] {
  const out: string[] = [];
  const live = liveBindings(viewer);
  const off = turnedOff();
  const plain = customToolLetters();
  const toolLetters = new Set<string>([...(viewer?.globalToolBinder?.bindings?.keys?.() ?? [])]);
  const handled = new Set<string>();

  // 1. Pyr's own window handlers against each other.
  const owners = new Map<string, PyrKey>();
  for (const p of PYR_KEYS) {
    for (const k of p.keys) {
      const s = normalStroke(k);
      handled.add(s);
      if (p.scoped) continue;
      const first = owners.get(s);
      if (first && first.owner !== p.owner) out.push(`${showStroke(s)}: "${first.label}" (${first.owner}) and "${p.label}" (${p.owner}) both take it.`);
      else if (!first) owners.set(s, p);
    }
  }
  // 2. Pyr's window handlers against neuroglancer's maps. A Shift+letter tool
  //    slot only counts when a tool of its own is bound there.
  for (const l of live) {
    handled.add(l.stroke);
    if (l.action.startsWith('tool-undefined')) continue;
    if (isToolSlot(l.action)) {
      const letter = l.action.slice(5);
      if (!toolLetters.has(letter) || plain.has(letter)) continue;
    }
    const p = owners.get(l.stroke);
    if (p) out.push(`${showStroke(l.stroke)}: "${p.label}" (${p.owner}) and neuroglancer's ${l.action}${l.where ? ' in ' + l.where : ''} both take it.`);
  }
  // 3. A key Pyr set in neuroglancer's maps over one neuroglancer had (the Z case).
  const seen = new Set<string>();
  for (const l of live) {
    if (!l.replaced || off.has(l.stroke)) continue;
    if (isToolSlot(l.replaced) && !toolLetters.has(l.replaced.slice(5))) continue;
    const k = `${l.stroke}|${l.action}|${l.replaced}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`${showStroke(l.stroke)}: Pyr binds it to ${l.action}${l.where ? ' in ' + l.where : ''}, over neuroglancer's ${l.replaced}.`);
  }
  // 4. A command that shows a key nothing handles.
  for (const c of commands) {
    const s = strokeFromShown(c.shortcut);
    if (!handled.has(s)) {
      out.push(`${c.shortcut}: the command "${c.label}" shows it, but nothing handles it.`);
    }
  }
  return out;
}

/** Warn once in the console on dev and test sites, a few seconds after the
 *  viewer is up (the custom bindings and the tool slots go in after it). */
export function warnKeyClashes(viewer: () => any, commands: () => CommandKey[] = () => []) {
  if (!checkHere()) return;
  // To check again by hand after a change: __ngeKeyCheck() in the console.
  (window as any).__ngeKeyCheck = () => findKeyClashes(viewer(), commands());
  let tries = 0;
  const run = () => {
    const v = viewer();
    if (!v?.inputEventBindings) { if (++tries < 30) setTimeout(run, 2000); return; }
    setTimeout(() => {
      try {
        for (const line of findKeyClashes(v, commands())) console.warn('[keys] ' + line);
      } catch (e) {
        console.warn('[keys] check failed', e);
      }
    }, 4000);
  };
  run();
}

/** Is this search asking for the list of keys? */
export function isKeysQuery(q: string): boolean {
  return /^\s*(\?|keys?|key list|shortcuts?|hotkeys?|keyboard( shortcuts)?|keybindings?)\s*$/i.test(q);
}
