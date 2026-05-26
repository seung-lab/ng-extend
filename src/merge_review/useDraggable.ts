// Drag-by-header + resize behaviour for the floating review panels,
// ported from the original demo's makeDraggable().
//
// Two quirks carried over: (1) we pin the panel to absolute left/top
// on drag start (cancelling any right/bottom anchor) so it follows the
// mouse from any starting corner, and (2) while dragging or resizing
// we mute pointer-events on the embedded neuroglancer canvas so the
// viewer doesn't capture the mouse (the original muted the spelunker
// iframe for the same reason).

import { onBeforeUnmount, onMounted, type Ref } from "vue";

const TOP_BAR_PX = 40; // ng-extend ExtensionBar height
const HEADER_MARGIN = 4; // breathing room beneath it
const RESIZE_GRIP_PX = 16; // CSS resize handle hit region (bottom-right)

function viewerEl(): HTMLElement | null {
  return document.getElementById("neuroglancer-container");
}

function muteViewer(mute: boolean) {
  const el = viewerEl();
  if (el) el.style.pointerEvents = mute ? "none" : "";
}

export function useDraggable(
  panel: Ref<HTMLElement | null>,
  handle: Ref<HTMLElement | null>,
) {
  let dragging = false;
  let ox = 0;
  let oy = 0;

  function onHandleDown(e: MouseEvent) {
    // Don't start a drag when clicking nested buttons.
    if ((e.target as HTMLElement).closest("button")) return;
    const el = panel.value;
    if (!el) return;
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = r.left + "px";
    el.style.top = r.top + "px";
    muteViewer(true);
    e.preventDefault();
  }

  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const el = panel.value;
    if (!el) return;
    const w = el.offsetWidth;
    let x = e.clientX - ox;
    let y = e.clientY - oy;
    x = Math.max(2, Math.min(window.innerWidth - w - 2, x));
    // Top edge clamps to BELOW the top bar so the grip can't slide
    // under it; bottom edge keeps a strip of header reachable.
    const minY = TOP_BAR_PX + HEADER_MARGIN;
    const maxY = window.innerHeight - TOP_BAR_PX - HEADER_MARGIN;
    y = Math.max(minY, Math.min(maxY, y));
    el.style.left = x + "px";
    el.style.top = y + "px";
  }

  function onUp() {
    dragging = false;
    muteViewer(false);
  }

  // Mute the viewer while the user drags the bottom-right resize grip.
  function onPanelDown(e: MouseEvent) {
    const el = panel.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (
      e.clientX >= r.right - RESIZE_GRIP_PX &&
      e.clientY >= r.bottom - RESIZE_GRIP_PX
    ) {
      muteViewer(true);
    }
  }

  onMounted(() => {
    handle.value?.addEventListener("mousedown", onHandleDown);
    panel.value?.addEventListener("mousedown", onPanelDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  onBeforeUnmount(() => {
    handle.value?.removeEventListener("mousedown", onHandleDown);
    panel.value?.removeEventListener("mousedown", onPanelDown);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  });
}
