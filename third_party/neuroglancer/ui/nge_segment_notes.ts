/**
 * nge: a player's own note on a cell in the Seg panel (annkri, report 303:
 * "could it be possible to write comments on segments, like you can on
 * annotations"). Notes are saved in the segmentation layer's state
 * (`ngeNotes`, {id: text}), so they go with autosave, Save view and share
 * links, the way an annotation's description does. There is no table and no
 * moderation. A shared link carries the text to someone else's screen, so it
 * is only ever put on the page as plain text (textContent, title, value).
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
function cleanNote(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]+/g, ' ')
      .trim()
      .slice(0, max);
}

export class SegmentNotes {
  private notes = new Map<string, string>();
  changed = new NullarySignal();

  get(id: string): string|undefined {
    return this.notes.get(id);
  }

  /** Empty text removes the note. */
  set(id: string, text: string) {
    const clean = cleanNote(text, NOTE_MAX_LENGTH);
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
      this.notes.set(id, cleanNote(all.join(JOIN), NOTE_STORED_MAX_LENGTH));
    }
    this.changed.dispatch();
  }

  restoreState(json: unknown) {
    this.notes.clear();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      for (const [id, text] of Object.entries(json)) {
        if (!/^\d+$/.test(id) || typeof text !== 'string') continue;
        const clean = cleanNote(text, NOTE_STORED_MAX_LENGTH);
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

/** Put a row's note and pencil in step with the notes. */
export function updateNoteRow(row: HTMLElement, notes: SegmentNotes) {
  const id = row.dataset.id;
  if (id === undefined) return;
  const text = notes.get(id);
  row.classList.toggle('nge-seg-has-note', text !== undefined);
  const pencil = row.querySelector<HTMLElement>('.nge-seg-note-edit');
  if (pencil) pencil.title = text === undefined ? 'Add a note' : 'Edit your note';
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

/** The pencil on a row, and the row's note if it has one. */
export function addNoteToRow(row: HTMLElement, notes: SegmentNotes) {
  const pencil = document.createElement('button');
  pencil.type = 'button';
  pencil.className = 'nge-seg-note-edit';
  pencil.textContent = '✎';
  // the row selects, drags and picks on these: the pencil only opens the note
  pencil.addEventListener('mousedown', e => e.stopPropagation());
  pencil.addEventListener('pointerdown', e => e.stopPropagation());
  pencil.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    const id = row.dataset.id;
    if (id !== undefined) openNoteEditor(pencil, notes, id);
  });
  row.children[0].appendChild(pencil);
  updateNoteRow(row, notes);
}

function openNoteEditor(anchor: HTMLElement, notes: SegmentNotes, id: string) {
  document.querySelector('.nge-seg-note-popup')?.remove();
  const pop = document.createElement('div');
  pop.className = 'nge-seg-note-popup';
  const head = document.createElement('div');
  head.className = 'nge-seg-note-popup-title';
  head.textContent = 'Your note on this cell';
  const box = document.createElement('textarea');
  box.maxLength = NOTE_MAX_LENGTH;
  box.rows = 3;
  box.spellcheck = true;
  // a note joined by a merge can be longer than what can be typed
  box.value = (notes.get(id) ?? '').slice(0, NOTE_MAX_LENGTH);
  const hint = document.createElement('div');
  hint.className = 'nge-seg-note-popup-hint';
  hint.textContent = 'Saved with this view. Anyone you share the view with can read it.';
  const foot = document.createElement('div');
  foot.className = 'nge-seg-note-popup-foot';
  const count = document.createElement('span');
  count.className = 'nge-seg-note-popup-count';
  const showCount = () => { count.textContent = `${box.value.length} / ${NOTE_MAX_LENGTH}`; };
  showCount();
  box.addEventListener('input', showCount);
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  const save = () => {
    notes.set(id, box.value);
    close();
  };
  const outside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const makeButton = (text: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  const saveButton = makeButton('Save', save);
  saveButton.classList.add('nge-seg-note-popup-save');
  foot.append(count);
  if (notes.get(id) !== undefined) {
    foot.append(makeButton('Remove', () => {
      notes.set(id, '');
      close();
    }));
  }
  foot.append(saveButton);
  // Typing here is not a shortcut for the game behind it.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    pop.addEventListener(type, e => e.stopPropagation());
  }
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  });
  pop.append(head, box, hint, foot);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const {width, height} = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`;
  const below = r.bottom + 4;
  pop.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below}px`;
  document.addEventListener('mousedown', outside, true);
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}
