/**
 * nge: folders in the Seg panel (Ames 2026-10-14: "how could we add a folders
 * or grouping system here? There exists a prototype in Batch Processor but
 * it's separate from this all-important menu"). A folder is a named, foldable
 * section of the list; a cell sits in at most one. Folders are saved in the
 * segmentation layer's state (`ngeFolders`), so a saved view or a shared link
 * opens with the same folders. Only membership is kept here: the order of the
 * cells inside a folder is the list's own order, which drag still changes.
 */
import {NullarySignal} from 'neuroglancer/util/signal';

export interface SegmentFolder {
  id: string;
  name: string;
  ids: string[];
  collapsed?: boolean;
  /** The folder this one sits in (nesting); none = top level. */
  parent?: string;
  /** The colour last given to the whole folder ('#rrggbb'). */
  color?: string;
  /** True once a colour was picked for the folder's cells: cells that join
   *  the folder later take it too. */
  paint?: boolean;
}

/** nge: cells picked with Ctrl+click or Shift+click, to move, show, hide,
 *  recolour or remove together (Ames 2026-10-14: "there needs to be a way to
 *  easily select and move batches of segIDs"). */
export const pickedSegments = {
  ids: new Set<string>(),
  /** The last cell clicked, where a Shift+click range starts. */
  anchor: undefined as string | undefined,
  changed: new NullarySignal(),
  set(ids: Iterable<string>) {
    this.ids = new Set(ids);
    this.changed.dispatch();
  },
  toggle(id: string) {
    const next = new Set(this.ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.ids = next;
    this.anchor = id;
    this.changed.dispatch();
  },
  clear() {
    if (!this.ids.size) return;
    this.ids = new Set();
    this.changed.dispatch();
  },
};

export const FOLDERS_JSON_KEY = 'ngeFolders';

export class SegmentFolders {
  value: SegmentFolder[] = [];
  changed = new NullarySignal();

  restoreState(json: unknown) {
    const out: SegmentFolder[] = [];
    if (Array.isArray(json)) {
      for (const f of json) {
        if (!f || typeof f !== 'object') continue;
        const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 60) : 'Folder';
        const ids = Array.isArray(f.ids) ? f.ids.filter((s: unknown) => typeof s === 'string' && /^\d+$/.test(s)) : [];
        out.push({
          id: typeof f.id === 'string' && f.id ? f.id : newFolderId(), name, ids,
          collapsed: f.collapsed === true,
          parent: typeof f.parent === 'string' && f.parent ? f.parent : undefined,
          color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : undefined,
          paint: f.paint === true,
        });
      }
    }
    // A parent that is missing, or a loop, puts the folder at the top level.
    const known = new Set(out.map(f => f.id));
    for (const f of out) if (f.parent !== undefined && !known.has(f.parent)) f.parent = undefined;
    this.value = out;
    for (const f of out) if (f.parent !== undefined && this.isInside(f.parent, f.id)) f.parent = undefined;
    this.changed.dispatch();
  }

  /** Only the cells still in the list are written, so a folder never carries
   *  cells that were removed. Nothing is written when there are no folders. */
  toJSON(inList?: (id: string) => boolean) {
    if (!this.value.length) return undefined;
    return this.value.map(f => ({
      id: f.id,
      name: f.name,
      ids: inList ? f.ids.filter(inList) : f.ids,
      ...(f.collapsed ? {collapsed: true} : {}),
      ...(f.parent ? {parent: f.parent} : {}),
      ...(f.color ? {color: f.color} : {}),
      ...(f.paint ? {paint: true} : {}),
    }));
  }

  /** True when folder `id` is `ancestor` or sits somewhere inside it. */
  isInside(id: string, ancestor: string): boolean {
    let cur: string|undefined = id;
    for (let guard = 0; cur !== undefined && guard < 100; ++guard) {
      if (cur === ancestor) return true;
      cur = this.value.find(f => f.id === cur)?.parent;
    }
    return false;
  }

  /** The folder and every folder inside it. */
  subtree(id: string): string[] {
    const out = [id];
    for (let i = 0; i < out.length; ++i) {
      for (const f of this.value) if (f.parent === out[i]) out.push(f.id);
    }
    return out;
  }

  /** The cells in a folder and in every folder inside it. */
  cellsIn(id: string): string[] {
    const ids = new Set(this.subtree(id));
    return this.value.filter(f => ids.has(f.id)).flatMap(f => f.ids);
  }

  /** Folders in display order, each under its parent, with its depth. */
  ordered(): {folder: SegmentFolder, depth: number, hidden: boolean}[] {
    const out: {folder: SegmentFolder, depth: number, hidden: boolean}[] = [];
    const walk = (parent: string|undefined, depth: number, hidden: boolean) => {
      for (const f of this.value) {
        if (f.parent !== parent) continue;
        out.push({folder: f, depth, hidden});
        walk(f.id, depth + 1, hidden || !!f.collapsed);
      }
    };
    walk(undefined, 0, false);
    return out;
  }

  /** Put a folder inside another (undefined = top level); never inside itself. */
  setParent(id: string, parent: string|undefined) {
    if (parent !== undefined && this.isInside(parent, id)) return;
    this.value = this.value.map(f => f.id === id ? {...f, parent} : f);
    this.changed.dispatch();
  }

  setColor(id: string, color: string, paint = false) {
    this.value = this.value.map(f => f.id === id ? {...f, color, paint: paint || f.paint} : f);
    this.changed.dispatch();
  }

  folderOf(segId: string): SegmentFolder|undefined {
    return this.value.find(f => f.ids.includes(segId));
  }

  memberIds(): Set<string> {
    const s = new Set<string>();
    for (const f of this.value) for (const id of f.ids) s.add(id);
    return s;
  }

  create(name = 'New folder', parent?: string): SegmentFolder {
    // Each new folder gets its own colour (Ames 2026-10-14), the first of
    // these not yet used, for its dot and its rail. The cells keep theirs
    // until a colour is picked on the dot.
    const used = new Set(this.value.map(f => f.color));
    const color = FOLDER_COLORS.find(c => !used.has(c)) ??
        FOLDER_COLORS[this.value.length % FOLDER_COLORS.length];
    const f: SegmentFolder = {id: newFolderId(), name, ids: [], parent, color};
    this.value = [...this.value, f];
    this.changed.dispatch();
    return f;
  }

  rename(id: string, name: string) {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    this.value = this.value.map(f => f.id === id ? {...f, name: clean} : f);
    this.changed.dispatch();
  }

  setCollapsed(id: string, collapsed: boolean) {
    this.value = this.value.map(f => f.id === id ? {...f, collapsed} : f);
    this.changed.dispatch();
  }

  /** Ungroup: the folder goes, its cells go back to the main list and the
   *  folders inside it move up a level. */
  remove(id: string) {
    const gone = this.value.find(f => f.id === id);
    this.value = this.value.filter(f => f.id !== id)
                     .map(f => f.parent === id ? {...f, parent: gone?.parent} : f);
    this.changed.dispatch();
  }

  /** Put cells in a folder ('' = no folder), taking them out of any other. */
  move(segIds: string[], folderId: string) {
    this.value = this.value.map(f => {
      const kept = f.ids.filter(id => !segIds.includes(id));
      return f.id === folderId ? {...f, ids: [...kept, ...segIds]} : {...f, ids: kept};
    });
    this.changed.dispatch();
  }
}

export const FOLDER_COLORS = ['#4a9eff', '#7cffb2', '#f5d142', '#c084fc', '#fb923c', '#2dd4bf', '#f472b6', '#e06060'];

/**
 * When a cell's ID is replaced (an out of date ID updated to its current
 * pieces, a merge, a split), the new IDs take the old one's place: in its
 * folder (Ames 2026-10-14: "shouldn't those pieces stay in the folder they
 * were in?"). Every path that replaces an ID removes the old and adds the new
 * in one go, so a removal and an addition in the same moment are a
 * replacement; a cell added later on its own is not.
 */
export function followReplacements(
    selectedSegments: {changed: {add(fn: (x: any, add: boolean) => void): () => void}},
    folders: SegmentFolders, pasted?: () => {ids: string[], changed: NullarySignal}) {
  let removed: string[] = [];
  let added: string[] = [];
  let pending = false;
  const flush = () => {
    pending = false;
    const gone = removed, came = added;
    removed = [];
    added = [];
    if (!gone.length || !came.length) return;
    const fresh = came.filter(id => !gone.includes(id) && !folders.folderOf(id));
    if (!fresh.length) return;
    const home = gone.map(id => folders.folderOf(id)).find(f => f !== undefined);
    if (home !== undefined) folders.move(fresh, home.id);
    const p = pasted?.();
    if (p && gone.some(id => p.ids.includes(id))) {
      const at = Math.min(...gone.map(id => p.ids.indexOf(id)).filter(i => i >= 0));
      p.ids = [...p.ids.slice(0, at), ...fresh.filter(id => !p.ids.includes(id)), ...p.ids.slice(at)];
      p.changed.dispatch();
    }
  };
  return selectedSegments.changed.add((x: any, add: boolean) => {
    if (x == null) return;
    const ids = (Array.isArray(x) ? x : [x]).map((u: any) => u.toString());
    (add ? added : removed).push(...ids);
    if (!pending) {
      pending = true;
      Promise.resolve().then(flush);
    }
  });
}

/**
 * A small palette under a colour dot (Ames 2026-10-14: "currently I have to
 * move the color to make it recolor them"; the browser's picker only acts
 * when the colour changes). One click on a colour, the current one too,
 * applies it; Custom opens the full picker, which applies as it moves.
 */
export function openColorPalette(
    anchor: HTMLElement, current: string|undefined, onPick: (hex: string) => void,
    title = 'Colour') {
  document.querySelector('.nge-color-palette')?.remove();
  const pop = document.createElement('div');
  pop.className = 'nge-color-palette';
  const head = document.createElement('div');
  head.className = 'nge-color-palette-title';
  head.textContent = title;
  pop.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'nge-color-palette-grid';
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc, true);
  };
  for (const c of FOLDER_COLORS) {
    const b = document.createElement('button');
    b.className = 'nge-color-palette-chip' + (current && c.toLowerCase() === current.toLowerCase() ? ' nge-current' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { onPick(c); close(); });
    grid.appendChild(b);
  }
  pop.appendChild(grid);
  const custom = document.createElement('label');
  custom.className = 'nge-color-palette-custom';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#8cb4eb';
  input.addEventListener('input', () => onPick(input.value));
  input.addEventListener('change', () => { onPick(input.value); close(); });
  custom.append(input, document.createTextNode(' Custom\u2026'));
  pop.appendChild(custom);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  pop.style.top = `${r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  const outside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && e.target !== anchor) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc, true);
  }, 0);
}

function newFolderId() {
  return 'f' + Math.random().toString(36).slice(2, 9);
}
