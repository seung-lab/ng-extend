/**
 * nge: a player's own note on a cell in the Seg panel (annkri, report 303:
 * "could it be possible to write comments on segments, like you can on
 * annotations"). Notes are written in the cell's Δ menu and read under its ID.
 * They are saved in the segmentation layer's state (`ngeNotes`, {id: text}),
 * so they go with autosave, Save view and share links, the way an annotation's
 * description does. There is no table and no moderation. A shared link carries
 * the text to someone else's screen, so it is only ever put on the page as
 * plain text (textContent, title, value).
 */
import {NullarySignal} from 'neuroglancer/util/signal';

export const NOTES_JSON_KEY = 'ngeNotes';

/** What a player can type. */
export const NOTE_MAX_LENGTH = 300;
/** What a cell can hold: more than one note's worth, as a merge joins them. */
const NOTE_STORED_MAX_LENGTH = 1000;
const JOIN = ' / ';

/** One line of text: no line breaks, control characters or the invisible
 *  marks that reverse text, which could disguise what a shared note says. */
function cleanNote(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]+/g, ' ')
      .trim()
      .slice(0, NOTE_STORED_MAX_LENGTH);
}

export class SegmentNotes {
  private notes = new Map<string, string>();
  changed = new NullarySignal();

  get(id: string): string|undefined {
    return this.notes.get(id);
  }

  /** Empty text removes the note. */
  set(id: string, text: string) {
    const clean = cleanNote(text);
    if (clean === (this.notes.get(id) ?? '')) return;
    if (clean) this.notes.set(id, clean); else this.notes.delete(id);
    this.changed.dispatch();
  }

  /**
   * A cut or merge gives a cell new IDs, and the note goes with them. A merge
   * joins the notes of the cells it joined. A cut leaves every piece with the
   * note, as nothing says which piece the player meant.
   */
  replace(gone: string[], came: string[]) {
    const texts = [...new Set(gone.map(id => this.notes.get(id)).filter(t => t !== undefined))] as string[];
    if (!texts.length) return;
    for (const id of gone) this.notes.delete(id);
    for (const id of came) {
      const all = [...new Set([this.notes.get(id), ...texts].filter(t => t !== undefined))];
      this.notes.set(id, cleanNote(all.join(JOIN)));
    }
    this.changed.dispatch();
  }

  restoreState(json: unknown) {
    this.notes.clear();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      for (const [id, text] of Object.entries(json)) {
        if (!/^\d+$/.test(id) || typeof text !== 'string') continue;
        const clean = cleanNote(text);
        if (clean) this.notes.set(id, clean);
      }
    }
    this.changed.dispatch();
  }

  /** Only the cells still in the list are written, as with folders. Nothing is
   *  written without notes, so other views stay as they were. */
  toJSON(inList: (id: string) => boolean) {
    const out: {[id: string]: string} = {};
    let any = false;
    for (const [id, text] of this.notes) {
      if (!inList(id)) continue;
      out[id] = text;
      any = true;
    }
    return any ? out : undefined;
  }
}

/** Put a row's note in step with the notes. */
export function updateNoteRow(row: HTMLElement, notes: SegmentNotes) {
  const id = row.dataset.id;
  if (id === undefined) return;
  const text = notes.get(id);
  let el = row.querySelector<HTMLElement>(':scope > .nge-seg-note');
  if (text === undefined) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'nge-seg-note';
    row.appendChild(el);
  }
  el.textContent = text;
  el.title = text;
}

const notesOfRow = new WeakMap<HTMLElement, SegmentNotes>();

/** A row of cells in the list can hold a note. Search results cannot: they
 *  are not in the view, so a note on one would not be saved. */
export function addNoteToRow(row: HTMLElement, notes: SegmentNotes) {
  notesOfRow.set(row, notes);
  updateNoteRow(row, notes);
}

/** The Δ menu's note section for the cell on this row, if it can hold one. It
 *  saves as you type, so closing the menu never loses anything. */
export function makeNoteEditor(row: HTMLElement|null, id: string, onEscape: () => void): HTMLElement|undefined {
  const notes = row ? notesOfRow.get(row) : undefined;
  if (notes === undefined) return undefined;
  const section = document.createElement('div');
  section.className = 'nge-lb-section nge-lb-note';
  const title = document.createElement('div');
  title.className = 'nge-lb-section-title';
  title.textContent = 'Your note';
  const box = document.createElement('textarea');
  box.className = 'nge-lb-note-box';
  box.rows = 2;
  box.placeholder = 'Add a note on this cell';
  box.value = notes.get(id) ?? '';
  // a note joined by a merge can be longer than what can be typed
  box.maxLength = Math.max(NOTE_MAX_LENGTH, box.value.length);
  const foot = document.createElement('div');
  foot.className = 'nge-lb-note-foot';
  const hint = document.createElement('span');
  hint.textContent = 'Saved with this view. Anyone you share it with can read it.';
  const count = document.createElement('span');
  count.className = 'nge-lb-note-count';
  const showCount = () => { count.textContent = `${box.value.length} / ${NOTE_MAX_LENGTH}`; };
  showCount();
  box.addEventListener('input', () => {
    showCount();
    notes.set(id, box.value);
  });
  // Typing here is not a shortcut for the game behind it.
  for (const type of ['keyup', 'keypress']) {
    box.addEventListener(type, e => e.stopPropagation());
  }
  box.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      onEscape();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      box.blur();
    }
  });
  foot.append(hint, count);
  section.append(title, box, foot);
  return section;
}
