/**
 * "How did it end?" for completions made outside the Cell Library.
 *
 * The Cell Library's Complete form asks how the cell ended (Retina's sheet has
 * four endings) and for notes. The Delta menu and the Cell Profile completed
 * the same cells and wrote the sheet with neither, so the Status column got
 * no ending and the notes were lost (annkri 2026-10-06: "Different info
 * needed when you complete a cell from delta menu or cell library").
 *
 * This asks the same two things, in the same words, before such a completion
 * goes ahead. A dataset with one ending (no entry in COMPLETE_STATUSES) is not
 * asked anything, as in the Cell Library. The last ending picked is offered
 * again, shared with the Cell Library's own memory of it.
 */
import { completeStatusesFor } from '../sheet_sync';
import { canonicalDataset } from '../datasets';

export interface CompletionDetails { status?: string; notes?: string; }

// The Cell Library's key (CellLibraryPanel.vue), so both remember one choice.
const STATUS_KEY = 'nge_cl_complete_status';

function remembered(dataset: string, options: { value: string }[]): string {
  try {
    const last = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}')[canonicalDataset(dataset)];
    return options.some(o => o.value === last) ? last : '';
  } catch { return ''; }
}
function remember(dataset: string, status: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
    all[canonicalDataset(dataset)] = status;
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
}

const CSS = `
.nge-cd-backdrop { position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(2, 6, 14, 0.55); }
.nge-cd { width: min(380px, 100%); padding: 16px; border-radius: 10px; font: 13px/1.4 'Inter', system-ui, sans-serif; color: #dce6f5;
  background: rgba(10, 16, 30, 0.98); border: 1px solid rgba(100, 200, 255, 0.35); box-shadow: 0 14px 44px rgba(0, 0, 0, 0.6); }
.nge-cd-title { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.nge-cd-sub { color: rgba(220, 230, 245, 0.65); margin-bottom: 12px; overflow-wrap: anywhere; }
.nge-cd-label { display: block; margin: 10px 0 6px; font-weight: 600; }
.nge-cd-options { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-cd-option { padding: 6px 11px; border-radius: 999px; cursor: pointer; font: inherit; color: #dce6f5;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(140, 170, 220, 0.4); }
.nge-cd-option:hover { border-color: #7fd4ff; }
.nge-cd-option--on { color: #06121f; font-weight: 600; background: #7fd4ff; border-color: #7fd4ff; }
.nge-cd-notes { width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical; padding: 7px 9px; border-radius: 6px; font: inherit;
  color: #dce6f5; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(140, 170, 220, 0.35); }
.nge-cd-option:focus-visible, .nge-cd-notes:focus-visible, .nge-cd-btn:focus-visible { outline: 2px solid #7fd4ff; outline-offset: 2px; }
.nge-cd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.nge-cd-btn { padding: 7px 14px; border-radius: 6px; cursor: pointer; font: inherit; color: #dce6f5;
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); }
.nge-cd-btn--go { color: #06121f; font-weight: 600; background: #7fd4ff; border-color: #7fd4ff; }
.nge-cd-btn--go:disabled { opacity: 0.45; cursor: not-allowed; }
`;
let styled = false;

/**
 * Ask how the cell ended and for notes. Resolves with the answers, with {}
 * when this dataset has nothing to ask, or with null when the player cancels
 * (the completion must then not go ahead).
 */
export function askCompletionDetails(dataset: string, cellLabel = ''): Promise<CompletionDetails | null> {
  const options = completeStatusesFor(dataset);
  if (!options.length) return Promise.resolve({});
  if (!styled) {
    styled = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  return new Promise(resolve => {
    let status = remembered(dataset, options);
    const backdrop = document.createElement('div');
    backdrop.className = 'nge-cd-backdrop';
    const box = document.createElement('div');
    box.className = 'nge-cd';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Complete this cell');
    box.innerHTML = `<div class="nge-cd-title">Complete this cell</div><div class="nge-cd-sub"></div>`
      + `<span class="nge-cd-label" id="nge-cd-how">How did it end?</span><div class="nge-cd-options" role="radiogroup" aria-labelledby="nge-cd-how"></div>`
      + `<label class="nge-cd-label" for="nge-cd-notes">Notes (optional)</label><textarea class="nge-cd-notes" id="nge-cd-notes" maxlength="500"></textarea>`
      + `<div class="nge-cd-actions"><button type="button" class="nge-cd-btn nge-cd-btn--cancel">Cancel</button>`
      + `<button type="button" class="nge-cd-btn nge-cd-btn--go">Complete</button></div>`;
    (box.querySelector('.nge-cd-sub') as HTMLElement).textContent = cellLabel
      ? `${cellLabel}. This is written to the Cell Library sheet.` : 'This is written to the Cell Library sheet.';
    const group = box.querySelector('.nge-cd-options') as HTMLElement;
    const go = box.querySelector('.nge-cd-btn--go') as HTMLButtonElement;
    const notes = box.querySelector('.nge-cd-notes') as HTMLTextAreaElement;
    const paint = () => {
      group.querySelectorAll<HTMLButtonElement>('.nge-cd-option').forEach(b => {
        const on = b.dataset.value === status;
        b.classList.toggle('nge-cd-option--on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      go.disabled = !status;
    };
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nge-cd-option';
      b.setAttribute('role', 'radio');
      b.dataset.value = o.value;
      b.title = o.hint;
      b.textContent = o.value;
      b.addEventListener('click', () => { status = o.value; paint(); });
      group.appendChild(b);
    }
    paint();

    const done = (answer: CompletionDetails | null) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(answer);
    };
    const submit = () => {
      if (!status) return;
      remember(dataset, status);
      const text = notes.value.trim();
      done({ status, ...(text ? { notes: text } : {}) });
    };
    // Keys typed here must not reach the viewer's shortcuts.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target !== notes)) {
        if ((e.target as HTMLElement)?.classList?.contains('nge-cd-option') || (e.target as HTMLElement)?.classList?.contains('nge-cd-btn--cancel')) return;
        e.preventDefault(); e.stopPropagation(); submit();
        return;
      }
      if (box.contains(e.target as Node)) e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    for (const type of ['keyup', 'keypress'] as const) box.addEventListener(type, e => e.stopPropagation());
    go.addEventListener('click', submit);
    box.querySelector('.nge-cd-btn--cancel')!.addEventListener('click', () => done(null));
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) done(null); });
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    ((group.querySelector('.nge-cd-option--on') || group.querySelector('.nge-cd-option')) as HTMLElement)?.focus();
  });
}
