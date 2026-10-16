/**
 * drag_box.ts: a floating box dragged by its header, remembering where it was
 * put (the Highlight box's way, HighlightModePanel.vue, shared). Used by the
 * retina access panel and its review bar (Ames 2026-10-16: "let me move this
 * box around"). Pointer events, so a finger drags it too.
 */
import { ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue';

export function useDragBox(key: string, el: Ref<HTMLElement | null>) {
  const pos = ref<{ x: number; y: number } | null>((() => {
    try { const p = JSON.parse(localStorage.getItem(key) || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch { return null; }
  })());
  const dragging = ref(false);
  const posStyle = computed(() => (pos.value ? { left: pos.value.x + 'px', top: pos.value.y + 'px', right: 'auto', bottom: 'auto' } : {}));

  /** Keep the header on screen, whatever the window size. */
  function clamp() {
    const box = el.value;
    if (!box || !pos.value) return;
    const x = Math.max(8, Math.min(pos.value.x, window.innerWidth - box.offsetWidth - 8));
    const y = Math.max(44, Math.min(pos.value.y, window.innerHeight - 48));
    if (x !== pos.value.x || y !== pos.value.y) pos.value = { x, y };
  }

  function startDrag(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, textarea')) return;
    const box = el.value;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    dragging.value = true;
    // A note being typed still saves on blur: preventDefault would keep focus.
    (document.activeElement as HTMLElement | null)?.blur?.();
    e.preventDefault();
    const move = (ev: PointerEvent) => { pos.value = { x: ev.clientX - dx, y: ev.clientY - dy }; clamp(); };
    const up = () => {
      dragging.value = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { if (pos.value) localStorage.setItem(key, JSON.stringify(pos.value)); } catch { /* private mode */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onMounted(() => { clamp(); window.addEventListener('resize', clamp); });
  onBeforeUnmount(() => window.removeEventListener('resize', clamp));
  return { pos, dragging, posStyle, startDrag };
}
