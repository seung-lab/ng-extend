/**
 * nge: numbered annotations in folders, dragged into any order (Ames
 * 2026-10-19: "can we modify annotations so they are numbered and add folders
 * to them, and let me drag and drop to reorder?"). The folders are the Seg
 * panel's (nge_segment_folders.ts) holding annotation IDs, saved in the
 * annotation layer's state as `ngeAnnFolders`, so a saved view, a shared link
 * and the workspace autosave keep them. The order is the layer's own
 * `annotations` list (AnnotationSource.ngeReorder). The numbers are worked out
 * from the order and never saved.
 *
 * A folder can also color its annotations, as an option (Ames 2026-10-19: "we
 * want to be able to recolor with a folder, as an option"): the checkbox in the
 * folder's color palette. The color is kept per annotation in the hidden
 * `ngecolor` property (annotation/index.ts) and worked out again from the
 * folders whenever they or the annotations change.
 */
import {Annotation, AnnotationSource, isNgeColorProperty} from 'neuroglancer/annotation';
import {SegmentFolder, SegmentFolders} from 'neuroglancer/ui/nge_segment_folders';
import {packColor, parseRGBColorSpecification} from 'neuroglancer/util/color';
import {NullarySignal} from 'neuroglancer/util/signal';
import {vec4} from 'neuroglancer/util/geom';

export const ANN_FOLDERS_JSON_KEY = 'ngeAnnFolders';

export function makeAnnotationFolders() {
  return new SegmentFolders({
    validId: id => id.length > 0 && id.length <= 200,
    paintKey: 'nge-ann-folder-paint-default',
  });
}

/** Annotations picked with Ctrl+click or Shift+click, to move or delete
 *  together. Page only: never saved. */
export const pickedAnnotations = {
  ids: new Set<string>(),
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
    this.anchor = undefined;
    this.changed.dispatch();
  },
};

export type AnnotationListItem =
    {kind: 'folder', folder: SegmentFolder, depth: number, hidden: boolean}|
    {kind: 'annotation', annotation: Annotation, depth: number, hidden: boolean, folder?: string};

/**
 * The list in display order: each folder's heading, its own annotations (in
 * the layer's order), then the folders inside it; the annotations in no
 * folder come last. Items inside a folded folder are there with `hidden`
 * set, so the numbers do not change when a folder is folded.
 */
export function displayOrder(annotations: Annotation[], folders: SegmentFolders): AnnotationListItem[] {
  const out: AnnotationListItem[] = [];
  const present = new Set(annotations.map(a => a.id));
  const home = new Map<string, string>();
  for (const f of folders.value) for (const id of f.ids) if (present.has(id) && !home.has(id)) home.set(id, f.id);
  const byFolder = new Map<string, Annotation[]>();
  const loose: Annotation[] = [];
  for (const a of annotations) {
    const f = home.get(a.id);
    if (f === undefined) { loose.push(a); continue; }
    let list = byFolder.get(f);
    if (list === undefined) byFolder.set(f, list = []);
    list.push(a);
  }
  for (const {folder, depth, hidden} of folders.ordered()) {
    out.push({kind: 'folder', folder, depth, hidden});
    const inside = hidden || !!folder.collapsed;
    for (const annotation of byFolder.get(folder.id) ?? []) {
      out.push({kind: 'annotation', annotation, depth: depth + 1, hidden: inside, folder: folder.id});
    }
  }
  for (const annotation of loose) out.push({kind: 'annotation', annotation, depth: 0, hidden: false});
  return out;
}

/** The color a folder gives an annotation: that of the nearest folder, its
 *  own or one it sits inside, with "Color its annotations" on. */
function paintFor(folders: SegmentFolders, folderId: string|undefined): string|undefined {
  for (let cur = folderId, guard = 0; cur !== undefined && guard < 100; ++guard) {
    const f = folders.value.find(x => x.id === cur);
    if (f === undefined) return undefined;
    if (f.paint && f.color) return f.color;
    cur = f.parent;
  }
  return undefined;
}

function packHex(hex: string) {
  const rgb = parseRGBColorSpecification(hex);
  return packColor(vec4.fromValues(rgb[0], rgb[1], rgb[2], 1));
}

/** Give every annotation its folder's color, or the layer's (0). */
export function applyFolderPaint(source: AnnotationSource, folders: SegmentFolders) {
  if (!source.properties.some(isNgeColorProperty)) return;
  const home = new Map<string, string>();
  for (const f of folders.value) for (const id of f.ids) if (!home.has(id)) home.set(id, f.id);
  const colors = new Map<string, number>();
  for (const a of source) {
    const hex = paintFor(folders, home.get(a.id));
    colors.set(a.id, hex === undefined ? 0 : packHex(hex));
  }
  source.ngeSetColors(colors);
}

/**
 * Keep the colors right while the layer is open: when the folders change,
 * and when annotations arrive (a view restored, an undo). Coalesced to one
 * pass per moment; a pass that changes nothing sends no signal, so it ends.
 */
export function followFolderPaint(source: AnnotationSource, folders: SegmentFolders) {
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    Promise.resolve().then(() => {
      pending = false;
      applyFolderPaint(source, folders);
    });
  };
  const a = folders.changed.add(schedule);
  const b = source.changed.add(schedule);
  schedule();
  return () => { a(); b(); };
}
