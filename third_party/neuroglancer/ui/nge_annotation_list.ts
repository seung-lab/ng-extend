/**
 * nge: the annotation list's folder headings, dragging and picking (Ames
 * 2026-10-19). The look and the words follow the Segments panel's folders
 * (segment_list.ts, drag_reorder.ts); the model is nge_annotation_folders.ts.
 *
 * Drag an annotation by its number: between rows to reorder it (it joins the
 * folder of the row it lands beside), onto a folder's heading to put it in
 * that folder, below the last row to take it out of every folder. Drag a
 * folder by its heading: its top edge puts it above, its bottom edge below,
 * the middle inside. A picked annotation carries every picked one with it.
 */
import {AnnotationSource} from 'neuroglancer/annotation';
import {pickedAnnotations} from 'neuroglancer/ui/nge_annotation_folders';
import {ngeChoose, ngeConfirm} from 'neuroglancer/ui/nge_confirm';
import {openColorPalette, SegmentFolder, SegmentFolders} from 'neuroglancer/ui/nge_segment_folders';

const DRAG_THRESHOLD_PX = 4;
const ROW_SEL = '.neuroglancer-annotation-list-entry[data-nge-pickable], .nge-ann-folder';

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

/** Everything the list's local annotations and folders need from the view. */
export interface AnnotationListHost {
  list: HTMLElement;
  source(): AnnotationSource|undefined;
  folders(): SegmentFolders|undefined;
  /** Annotation ids in display order (the visible rows, and those folded away). */
  displayIds(): string[];
  /** The rows have changed: draw the list again. */
  refresh(): void;
}

/** A folder's heading row in the annotation list. */
export function makeFolderHeading(
    folder: SegmentFolder, depth: number, count: number, folders: SegmentFolders,
    source: AnnotationSource, startRename: boolean): HTMLElement {
  const heading = document.createElement('div');
  heading.className = 'nge-ann-folder' + (folder.collapsed ? ' nge-ann-folder--collapsed' : '');
  heading.dataset.ngeFolder = folder.id;
  heading.style.setProperty('--nge-ann-depth', String(depth));
  heading.style.setProperty('--nge-folder-color', folder.color ?? '#8cb4eb');
  const current = () => folders.value.find(f => f.id === folder.id);

  const caret = document.createElement('button');
  caret.className = 'nge-seg-folder-caret';
  caret.textContent = folder.collapsed ? '▸' : '▾';
  caret.title = 'Fold or unfold';
  caret.addEventListener('click', event => {
    event.stopPropagation();
    const f = current();
    if (f) folders.setCollapsed(f.id, !f.collapsed);
  });

  const swatch = document.createElement('button');
  swatch.className = 'nge-seg-folder-color';
  swatch.style.background = folder.color ?? '#8cb4eb';
  swatch.title = folder.paint ?
      'This folder colors its annotations. Click to pick another color.' :
      'Folder color. Turn on "Color its annotations" to draw them in it.';
  swatch.addEventListener('click', event => {
    event.stopPropagation();
    const f = current();
    if (!f) return;
    openColorPalette(swatch, f.color, hex => {
      const cur = current();
      if (cur && cur.color !== hex) folders.setColor(cur.id, hex);
    }, `Color for ${f.name}`, {
      label: 'Color its annotations',
      value: !!f.paint,
      onChange: on => {
        const cur = current();
        if (cur) folders.setPaint(cur.id, on);
      },
    });
  });

  const name = document.createElement('span');
  name.className = 'nge-seg-folder-name';
  name.textContent = folder.name;
  name.title = `${folder.name}\nDouble click to rename. Drag the folder to move it, or onto another folder to put it inside.`;
  const rename = () => {
    name.contentEditable = 'true';
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const finish = (save: boolean) => {
    if (name.contentEditable !== 'true') return;
    name.contentEditable = 'false';
    const f = current();
    if (!f) return;
    if (save && name.textContent && name.textContent.trim() !== f.name) {
      folders.rename(f.id, name.textContent);
    } else {
      name.textContent = f.name;
    }
    name.scrollLeft = 0;
  };
  name.addEventListener('dblclick', event => { event.stopPropagation(); rename(); });
  name.addEventListener('blur', () => finish(true));
  name.addEventListener('keydown', (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });

  const countEl = document.createElement('span');
  countEl.className = 'nge-ann-folder-count';
  countEl.textContent = count.toLocaleString();
  countEl.title = plural(count, 'annotation');

  const icon = (text: string, title: string, onClick: () => void, extra = '') => {
    const b = document.createElement('button');
    b.className = 'nge-seg-folder-icon' + (extra ? ' ' + extra : '');
    b.textContent = text;
    b.title = title;
    b.addEventListener('mousedown', event => event.stopPropagation());
    b.addEventListener('click', event => { event.stopPropagation(); onClick(); });
    return b;
  };
  const actions = document.createElement('span');
  actions.className = 'nge-ann-folder-actions';
  actions.append(
      icon('+', 'Make a folder inside this one', () => {
        const f = current();
        if (!f) return;
        const child = folders.create('New folder', f.id);
        ngeRenameNext = child.id;
        if (f.collapsed) folders.setCollapsed(f.id, false);
      }),
      icon('✕', 'Delete this folder (it asks whether its annotations stay)', async () => {
        const f = current();
        if (!f) return;
        const ids = folders.cellsIn(f.id).filter(id => source.get(id) !== undefined);
        const inner = folders.subtree(f.id).length - 1;
        if (!ids.length && !inner) {
          folders.remove(f.id);
          return;
        }
        const what = [ids.length ? plural(ids.length, 'annotation') : '',
                      inner ? plural(inner, 'folder') : ''].filter(Boolean).join(' and ');
        type Pick = 'keep'|'all';
        const choices: {label: string, value: Pick, danger?: boolean}[] =
            [{label: 'Keep the annotations', value: 'keep'}];
        if (ids.length) choices.push({label: 'Delete the annotations too', value: 'all', danger: true});
        const pick = await ngeChoose(`It holds ${what}.`, {
          title: `Delete the folder "${f.name}"?`, choices, defaultValue: 'keep',
        });
        if (pick === null) return;
        if (pick === 'all') {
          deleteAnnotations(source, ids);
          for (const id of folders.subtree(f.id).reverse()) folders.remove(id);
          return;
        }
        folders.remove(f.id);
      }, 'nge-seg-folder-ungroup'));

  heading.append(caret, swatch, name, countEl, actions);
  if (startRename) setTimeout(() => { if (name.isConnected) rename(); }, 0);
  return heading;
}

/** The folder to name as soon as its heading is drawn (a new folder). */
export let ngeRenameNext: string|undefined;
export function takeRenameNext(id: string) {
  if (ngeRenameNext !== id) return false;
  ngeRenameNext = undefined;
  return true;
}
export function setRenameNext(id: string) {
  ngeRenameNext = id;
}

export function deleteAnnotations(source: AnnotationSource, ids: string[]) {
  for (const id of ids) {
    if (source.get(id) === undefined) continue;
    const ref = source.getReference(id);
    try {
      source.delete(ref);
    } finally {
      ref.dispose();
    }
  }
}

/** Put `moving` (in the order given) next to `target` in the layer's order:
 *  before or after it, or at the end when there is no target. */
function placeIds(source: AnnotationSource, moving: string[], target: string|undefined, where: 'before'|'after') {
  const order = Array.from(source, a => a.id).filter(id => !moving.includes(id));
  let at = target === undefined ? -1 : order.indexOf(target);
  if (at < 0) at = order.length; else if (where === 'after') ++at;
  order.splice(at, 0, ...moving);
  source.ngeReorder(order);
}

interface Drag {
  kind: 'annotation'|'folder';
  id: string;
  startX: number;
  startY: number;
  active: boolean;
  line: HTMLElement;
  /** Where it would land now. */
  drop?: {el: HTMLElement|null, zone: 'before'|'after'|'inside'|'end'};
}

/**
 * Dragging and picking in one annotation list. Returns a function that
 * removes the listeners.
 */
export function bindAnnotationListDrag(host: AnnotationListHost): () => void {
  const {list} = host;
  let drag: Drag|undefined;
  let scrollTimer = 0;
  let lastX = 0, lastY = 0;

  const clearMarks = () => {
    for (const el of list.querySelectorAll('.nge-folder-drop-target, .nge-folder-drop-before, .nge-folder-drop-after')) {
      el.classList.remove('nge-folder-drop-target', 'nge-folder-drop-before', 'nge-folder-drop-after');
    }
  };
  const stop = () => {
    if (!drag) return;
    drag.line.remove();
    clearMarks();
    list.classList.remove('nge-ann-dragging');
    for (const el of list.querySelectorAll('.nge-drag-source')) el.classList.remove('nge-drag-source');
    document.body.style.cursor = '';
    window.clearInterval(scrollTimer);
    scrollTimer = 0;
    drag = undefined;
  };

  /** The row (or folder heading) under the pointer, and which part of it. */
  const locate = (x: number, y: number): Drag['drop'] => {
    const rect = list.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
    const el = (document.elementFromPoint(x, y) as HTMLElement|null)?.closest(ROW_SEL) as HTMLElement|null;
    if (el === null || !list.contains(el)) {
      // past the last row: the end of the list, out of every folder
      return {el: null, zone: 'end'};
    }
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    if (el.classList.contains('nge-ann-folder')) {
      if (drag?.kind === 'annotation') return {el, zone: 'inside'};
      return {el, zone: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside'};
    }
    return {el, zone: f < 0.5 ? 'before' : 'after'};
  };

  const show = () => {
    if (!drag) return;
    clearMarks();
    const d = drag.drop;
    const listRect = list.getBoundingClientRect();
    drag.line.style.display = 'none';
    if (!d) return;
    if (d.el && d.el.classList.contains('nge-ann-folder')) {
      d.el.classList.add(d.zone === 'inside' ? 'nge-folder-drop-target' : `nge-folder-drop-${d.zone}`);
      return;
    }
    let top: number;
    if (d.el) {
      const r = d.el.getBoundingClientRect();
      top = d.zone === 'before' ? r.top : r.bottom;
    } else {
      const rows = list.querySelectorAll(ROW_SEL);
      const last = rows[rows.length - 1] as HTMLElement|undefined;
      top = last ? last.getBoundingClientRect().bottom : listRect.top;
    }
    top = Math.max(listRect.top, Math.min(listRect.bottom - 2, top));
    drag.line.style.display = '';
    drag.line.style.top = `${top - 1}px`;
    drag.line.style.left = `${listRect.left}px`;
    drag.line.style.width = `${listRect.width}px`;
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement|null;
    if (!t || host.source() === undefined) return;
    const num = t.closest('.nge-ann-num') as HTMLElement|null;
    const row = num?.closest('.neuroglancer-annotation-list-entry[data-nge-pickable]') as HTMLElement|null;
    if (num && row?.dataset.ngeId) {
      drag = {kind: 'annotation', id: row.dataset.ngeId, startX: e.clientX, startY: e.clientY, active: false, line: makeLine()};
      return;
    }
    const heading = t.closest('.nge-ann-folder') as HTMLElement|null;
    if (heading?.dataset.ngeFolder && !t.closest('button, [contenteditable="true"]')) {
      drag = {kind: 'folder', id: heading.dataset.ngeFolder, startX: e.clientX, startY: e.clientY, active: false, line: makeLine()};
      // no text selection while dragging a heading
      e.preventDefault();
    }
  };

  const onMove = (e: MouseEvent) => {
    if (!drag) return;
    if (!drag.active) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      drag.active = true;
      document.body.appendChild(drag.line);
      document.body.style.cursor = 'grabbing';
      list.classList.add('nge-ann-dragging');
      markSource();
      // the list scrolls while the pointer is held near its top or bottom
      scrollTimer = window.setInterval(() => {
        if (!drag?.active) return;
        const r = list.getBoundingClientRect();
        const edge = 28;
        if (lastY < r.top + edge) list.scrollTop -= 12;
        else if (lastY > r.bottom - edge) list.scrollTop += 12;
        else return;
        drag.drop = locate(lastX, lastY);
        markSource();
        show();
      }, 30);
    }
    e.preventDefault();
    lastY = e.clientY;
    const r = list.getBoundingClientRect();
    lastX = Math.min(Math.max(e.clientX, r.left + 4), r.right - 4);
    drag.drop = locate(e.clientX, e.clientY);
    show();
  };

  const markSource = () => {
    if (!drag) return;
    const sel = drag.kind === 'folder' ?
        `.nge-ann-folder[data-nge-folder="${CSS.escape(drag.id)}"]` :
        `.neuroglancer-annotation-list-entry[data-nge-id="${CSS.escape(drag.id)}"]`;
    for (const el of list.querySelectorAll(sel)) el.classList.add('nge-drag-source');
  };

  const onUp = (e: MouseEvent) => {
    if (!drag) return;
    const d = drag;
    if (!d.active) {
      drag = undefined;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const drop = d.drop;
    stop();
    // the click that ends a drag does not also pin the annotation
    const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, {capture: true, once: true});
    setTimeout(() => window.removeEventListener('click', swallow, {capture: true}), 0);
    if (!drop) return;
    const source = host.source(), folders = host.folders();
    if (!source || !folders) return;
    const targetFolder = drop.el?.dataset.ngeFolder;
    const targetAnn = drop.el?.dataset.ngeId;
    if (d.kind === 'folder') {
      if (targetFolder === d.id) return;
      if (targetFolder === undefined) folders.setParent(d.id, undefined);
      else if (drop.zone === 'inside') folders.setParent(d.id, targetFolder);
      else folders.placeFolder(d.id, targetFolder, drop.zone as 'before'|'after');
      return;
    }
    // A picked annotation carries every picked one, in the list's order.
    const order = host.displayIds();
    const moving = pickedAnnotations.ids.has(d.id) ?
        order.filter(id => pickedAnnotations.ids.has(id)) : [d.id];
    if (targetAnn !== undefined && moving.includes(targetAnn)) return;
    if (targetFolder !== undefined) {
      folders.move(moving, targetFolder);
      // after the folder's last annotation
      const f = folders.value.find(x => x.id === targetFolder);
      const members = Array.from(source, a => a.id).filter(id => f?.ids.includes(id) && !moving.includes(id));
      if (members.length) placeIds(source, moving, members[members.length - 1], 'after');
    } else if (targetAnn !== undefined) {
      folders.move(moving, folders.folderOf(targetAnn)?.id ?? '');
      placeIds(source, moving, targetAnn, drop.zone === 'before' ? 'before' : 'after');
    } else {
      folders.move(moving, '');
      placeIds(source, moving, undefined, 'after');
    }
    pickedAnnotations.clear();
    host.refresh();
    flash(list, moving[0]);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (drag) {
      e.stopPropagation();
      stop();
      return;
    }
    // Esc lets the picked annotations go, while this list is on screen
    const t = e.target as HTMLElement|null;
    if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
    if (pickedAnnotations.ids.size && list.isConnected && list.offsetHeight > 0) pickedAnnotations.clear();
  };

  // Ctrl+click (Cmd+click on a Mac) picks an annotation; Shift+click picks
  // every one between the last clicked and this one. Row buttons keep theirs.
  const pickRow = (e: MouseEvent) => {
    const t = e.target as HTMLElement|null;
    if (!t || t.closest('button, .neuroglancer-icon, input')) return undefined;
    const row = t.closest('.neuroglancer-annotation-list-entry[data-nge-pickable]') as HTMLElement|null;
    return row?.dataset.ngeId;
  };
  const onPickDown = (e: MouseEvent) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey) || e.altKey) return;
    if (!pickRow(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onPickClick = (e: MouseEvent) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey) || e.altKey) return;
    const id = pickRow(e);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && pickedAnnotations.anchor) {
      const ids = host.displayIds();
      const a = ids.indexOf(pickedAnnotations.anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        pickedAnnotations.set([...pickedAnnotations.ids, ...ids.slice(lo, hi + 1)]);
        return;
      }
    }
    pickedAnnotations.toggle(id);
  };

  list.addEventListener('mousedown', onPickDown, true);
  list.addEventListener('click', onPickClick, true);
  list.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    stop();
    list.removeEventListener('mousedown', onPickDown, true);
    list.removeEventListener('click', onPickClick, true);
    list.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
  };
}

function makeLine() {
  const el = document.createElement('div');
  el.className = 'nge-drop-line';
  return el;
}

function flash(list: HTMLElement, id: string|undefined, tries = 30) {
  if (id === undefined) return;
  const row = list.querySelector<HTMLElement>(`.neuroglancer-annotation-list-entry[data-nge-id="${CSS.escape(id)}"]`);
  if (!row) {
    if (tries > 0) requestAnimationFrame(() => flash(list, id, tries - 1));
    return;
  }
  row.classList.remove('nge-drop-flash');
  void row.offsetWidth;
  row.classList.add('nge-drop-flash');
  window.setTimeout(() => row.classList.remove('nge-drop-flash'), 2500);
}

/** The bar under the list while annotations are picked: move them to a
 *  folder, delete them, or let them go. */
export function makePickBar(host: AnnotationListHost): {element: HTMLElement, update: () => void} {
  const bar = document.createElement('div');
  bar.className = 'nge-pick-bar nge-ann-pick-bar';
  const update = () => {
    const source = host.source(), folders = host.folders();
    const ids = source ? [...pickedAnnotations.ids].filter(id => source.get(id) !== undefined) : [];
    bar.style.display = ids.length ? '' : 'none';
    if (!ids.length || !source || !folders) return;
    bar.textContent = '';
    const count = document.createElement('span');
    count.className = 'nge-pick-count';
    count.textContent = `${ids.length.toLocaleString()} picked`;
    const move = document.createElement('select');
    move.className = 'nge-pick-move';
    move.title = 'Put the picked annotations in a folder';
    const option = (value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    move.append(option('', 'Move to…'));
    for (const {folder, depth} of folders.ordered()) {
      move.append(option(folder.id, `${'  '.repeat(depth)}${folder.name}`));
    }
    move.append(option('__new', 'New folder'), option('__none', 'No folder'));
    move.addEventListener('change', () => {
      const v = move.value;
      if (!v) return;
      const order = host.displayIds().filter(id => ids.includes(id));
      if (v === '__new') {
        const f = folders.create('New folder');
        setRenameNext(f.id);
        folders.move(order, f.id);
      } else {
        folders.move(order, v === '__none' ? '' : v);
      }
      pickedAnnotations.clear();
    });
    const del = document.createElement('button');
    del.className = 'nge-pick-btn nge-pick-remove';
    del.textContent = 'Delete';
    del.title = 'Delete the picked annotations';
    del.addEventListener('click', async () => {
      if (ids.length > 1) {
        if (!await ngeConfirm(`Delete ${plural(ids.length, 'annotation')}?`, {title: 'Delete annotations'})) return;
      }
      deleteAnnotations(source, ids);
      pickedAnnotations.clear();
    });
    const clear = document.createElement('button');
    clear.className = 'nge-pick-btn nge-pick-clear';
    clear.textContent = 'Clear';
    clear.title = 'Unpick them (Esc)';
    clear.addEventListener('click', () => pickedAnnotations.clear());
    bar.append(count, move, del, clear);
  };
  update();
  return {element: bar, update};
}
