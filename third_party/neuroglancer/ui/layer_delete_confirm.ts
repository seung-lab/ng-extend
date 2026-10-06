/**
 * Deleting a layer from one of its bin buttons (EyeWire II, Ames 2026-10-06:
 * "if I am deleting image or segmentation it should have an 'are you sure'
 * popup"). The image and the segmentation are the dataset itself: losing one
 * to a stray click leaves an empty viewer and no obvious way back. Other
 * layers (annotations, scratch layers) still go at once.
 */
import {deleteLayer, ManagedUserLayer} from 'neuroglancer/layer';

const CSS = `
.nge-layerdel-veil { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
  background: rgba(2, 6, 14, 0.55); backdrop-filter: blur(3px); opacity: 0; transition: opacity 0.16s ease; }
.nge-layerdel-veil--on { opacity: 1; }
.nge-layerdel { width: min(420px, calc(100vw - 32px)); padding: 22px 24px 18px; box-sizing: border-box;
  font-family: 'Inter', system-ui, sans-serif; color: #dce6f5;
  background: linear-gradient(180deg, rgba(14, 24, 42, 0.98), rgba(7, 12, 24, 0.98));
  border: 1px solid rgba(126, 224, 255, 0.28); border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.4);
  transform: translateY(8px) scale(0.98); transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-layerdel-veil--on .nge-layerdel { transform: none; }
.nge-layerdel-ask { font-size: 15px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #eef8ff;
  text-shadow: 0 0 14px rgba(126, 224, 255, 0.35); }
.nge-layerdel-name { margin-top: 8px; font-size: 14px; font-weight: 600; color: #ffffff; overflow-wrap: anywhere; }
.nge-layerdel-sub { margin-top: 6px; font-size: 13px; line-height: 1.45; color: rgba(196, 228, 255, 0.78); }
.nge-layerdel-btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.nge-layerdel-btn { height: 32px; padding: 0 16px; font: 600 11px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.18em; text-transform: uppercase;
  color: #dce6f5; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(160, 190, 230, 0.3); border-radius: 6px; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.nge-layerdel-btn:hover, .nge-layerdel-btn:focus-visible { background: rgba(255, 255, 255, 0.1); color: #ffffff; outline: none; }
.nge-layerdel-btn--danger { color: #ffd9d9; background: rgba(255, 90, 90, 0.12); border-color: rgba(255, 120, 120, 0.55); }
.nge-layerdel-btn--danger:hover, .nge-layerdel-btn--danger:focus-visible { background: rgba(255, 90, 90, 0.28); border-color: #ff8f8f; }
@media (prefers-reduced-motion: reduce) { .nge-layerdel-veil, .nge-layerdel { transition: none; } }
`;
let styled = false;

/** 'image' or 'segmentation' when the layer is one of the two the dataset is made of. */
function coreKind(layer: ManagedUserLayer): 'image' | 'segmentation' | null {
  const type = String((layer.layer?.constructor as any)?.type || '');
  if (type === 'image') return 'image';
  if (type.startsWith('segmentation')) return 'segmentation';
  return null;
}

function ask(layer: ManagedUserLayer, kind: 'image' | 'segmentation'): Promise<boolean> {
  if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
  return new Promise(resolve => {
    const veil = document.createElement('div');
    veil.className = 'nge-layerdel-veil';
    const box = document.createElement('div');
    box.className = 'nge-layerdel';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const el = (cls: string, text: string) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
    box.appendChild(el('nge-layerdel-ask', `Delete this ${kind} layer?`));
    box.appendChild(el('nge-layerdel-name', layer.name));
    box.appendChild(el('nge-layerdel-sub', kind === 'image'
      ? 'This is the microscope image. Without it the 2D views are empty. You can get it back by picking the dataset again.'
      : 'This is the layer with the cells in it. Without it there is nothing to select or edit. You can get it back by picking the dataset again.'));
    const btns = document.createElement('div');
    btns.className = 'nge-layerdel-btns';
    const keep = document.createElement('button');
    keep.className = 'nge-layerdel-btn'; keep.textContent = 'Keep it';
    const del = document.createElement('button');
    del.className = 'nge-layerdel-btn nge-layerdel-btn--danger'; del.textContent = 'Delete layer';
    btns.append(keep, del);
    box.appendChild(btns);
    veil.appendChild(box);
    document.body.appendChild(veil);
    const done = (answer: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      veil.classList.remove('nge-layerdel-veil--on');
      setTimeout(() => veil.remove(), 170);
      resolve(answer);
    };
    // Escape keeps the layer. Enter does nothing special: the focused button
    // is "Keep it", so a reflex Enter never deletes.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    window.addEventListener('keydown', onKey, true);
    keep.addEventListener('click', () => done(false));
    del.addEventListener('click', () => done(true));
    veil.addEventListener('mousedown', e => { if (e.target === veil) done(false); });
    requestAnimationFrame(() => { veil.classList.add('nge-layerdel-veil--on'); keep.focus(); });
  });
}

/** Delete a layer because the user pressed its bin; asks first for the image and the segmentation. */
export async function deleteLayerFromUi(layer: ManagedUserLayer) {
  const kind = coreKind(layer);
  if (kind && !(await ask(layer, kind))) return;
  if (layer.wasDisposed) return;      // gone while the question was up (a dataset switch)
  deleteLayer(layer);
}
