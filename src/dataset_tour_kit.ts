/**
 * Shared machinery for dataset tours (Ames 2026-10-05): a welcome, then the
 * dataset's cell types one at a time, 3D only, each with a short description,
 * then all of them together and a pointer to the Cell Library.
 *
 * A dataset's tour file (tutorial-mec-tour.ts, tutorial-retina-tour.ts) only
 * lists its stage and its cells; makeCellTour builds the steps.
 */
import { marked } from 'marked';
import { Step } from "./store-pyr";
import { useLayersStore } from "./store";
import { setStatedColor } from "./widgets/widget_utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** projectionScale per micrometre of a cell's largest on-screen extent: fills
 *  the view with a little margin. */
const SCALE_PER_UM = 95;

/** Low and to the right, clear of the cell in the middle of the view and of
 *  chat on the left. */
const BESIDE = { element: "body", x: 0.84, y: 0.66 };
const MIDDLE = { element: "body", x: 0.5, y: 0.5 };

/** Looking straight down the z axis. */
export const VIEW_TOP = [0, 0, 0, 1];
/** Turned a quarter about x, seen from the side: high z at the top of the
 *  screen. */
export const VIEW_SIDE = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export interface TourCell {
  title: string;
  /** Markdown, one or two sentences. */
  text: string;
  /** Segment ids shown for this step (a cell, plus its nucleus where that is
   *  a separate segment). */
  ids: string[];
  color: string;
  /** The cell's bounds in micrometres. */
  min: number[];
  max: number[];
  /** Camera orientation (a quaternion). Default: the stage's own. */
  view?: number[];
  /** A picture at the top of the card (the superclass render, FlyWire). */
  image?: string;
  imageAlt?: string;
  /** Buttons under the text that load more cells: every cell of this type,
   *  or the cells around this one. Each lists how many it loads. */
  more?: TourMore[];
}

export interface TourMore {
  /** Button text, e.g. "Show all 729 T4a cells in this optic lobe". */
  label: string;
  /** Under the button, e.g. "This may take a while to load." */
  note?: string;
  ids: string[];
  /** Box to frame, micrometres. */
  min: number[];
  max: number[];
  /** One colour for all of them (default: the card's cell colour). With
   *  'own', each keeps the viewer's own colour, so neighbours tell apart. */
  color?: string | 'own';
}

export interface CellTourSpec {
  /** For console messages. */
  name: string;
  /** Text found in the segmentation layer's source, e.g. 'pni_mec'. Several
   *  when the tour plays on more than one graph of the same volume (FlyWire's
   *  public release and its live graph). */
  layerMatch: string | string[];
  /** Micrometres per voxel. */
  voxelUm: number[];
  /** The view the tour plays on: image and segmentation layers, camera. */
  stage: Record<string, any>;
  /** Name of a stage layer that stays as it is through the tour (an outline
   *  of the whole brain). The tour never clears or selects it. */
  backdropLayer?: string;
  cells: TourCell[];
  welcome: {
    title: string; hero: string; heroAlt: string; paragraphs: string[]; nextLabel?: string;
    /** Show the whole hero image uncropped (a square card), not a wide band. */
    heroWhole?: boolean;
  };
  finale: {
    title: string;
    text: string;
    /** A registered showcase link to load. Without one, every cell in the
     *  tour is shown together. */
    showcaseUrl?: string;
    view?: number[];
    /** false: the finale does not point at the Cell Library (a dataset with
     *  nothing to claim). Default true. */
    pointAtCellLibrary?: boolean;
  };
}

function viewer(): any { return (window as any)['viewer']; }

export function makeCellTour(spec: CellTourSpec): Step[] {
  const tag = `[${spec.name} tour]`;

  function segLayer(): any {
    const layers: any[] = viewer()?.layerManager?.managedLayers ?? [];
    return layers.find(l => {
      const url = l.layer?.dataSources?.[0]?.spec?.url ?? '';
      return url.includes('graphene://') && (Array.isArray(spec.layerMatch) ? spec.layerMatch : [spec.layerMatch]).some(m => url.includes(m));
    });
  }

  /** The stage: 3D only, nothing selected yet, no side panel. */
  function baseState(): Record<string, any> {
    const st = JSON.parse(JSON.stringify(spec.stage));
    st.layout = '3d';
    st.showAxisLines = false;
    st.showDefaultAnnotations = false;
    for (const l of st.layers) {
      if (l.type !== 'segmentation') continue;
      if (l.name === spec.backdropLayer) continue;
      l.segments = [];
      st.selectedLayer = { layer: l.name, visible: false };
    }
    return st;
  }

  /** Make sure the viewer is on the stage. Each step calls this, so the tour
   *  also works when it is resumed after a reload or stepped back from the
   *  final view. */
  async function ensureStage() {
    const v = viewer();
    if (!v) return;
    document.dispatchEvent(new CustomEvent('nge:close-all-panels'));
    document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
    const layers: any[] = v.layerManager?.managedLayers ?? [];
    const backdropMissing = !!spec.backdropLayer && !layers.some(l => l.name === spec.backdropLayer);
    if (segLayer() && backdropMissing) {
      // The dataset is already on screen: keep its layers, add the outline.
      try {
        const st = v.state.toJSON();
        const backdrop = spec.stage.layers.find((l: any) => l.name === spec.backdropLayer);
        if (backdrop) { st.layers = [...(st.layers || []), JSON.parse(JSON.stringify(backdrop))]; v.state.restoreState(st); }
        for (let i = 0; i < 40 && !segLayer()?.layer?.displayState; i++) await new Promise(r => setTimeout(r, 200));
      } catch (e) { console.warn(tag, 'could not add the outline:', e); }
    } else if (!segLayer()) {
      await useLayersStore().loadState(baseState());
      for (let i = 0; i < 40 && !segLayer()?.layer?.displayState; i++) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    try {
      v.layout.restoreState('3d');
      v.showAxisLines.value = false;
      v.showDefaultAnnotations.value = false;
      v.selectedLayer.visible = false;
    } catch (e) {
      console.warn(tag, 'could not set the stage:', e);
    }
  }

  /** Show only these cells, each in its colour, and frame the box that holds
   *  them all. */
  async function showCells(cells: TourCell[], view?: number[]) {
    await ensureStage();
    const v = viewer();
    const layer = segLayer()?.layer;
    const group = layer?.displayState?.segmentationGroupState?.value;
    if (!v || !group) return;
    try {
      const { Uint64 } = require('neuroglancer/util/uint64');
      const colors = layer.displayState.segmentationColorGroupState?.value?.segmentStatedColors;
      group.visibleSegments.clear();
      for (const c of cells) {
        // neuroglancer packs as 0xBBGGRR.
        const n = parseInt(c.color.slice(1), 16);
        const packed = ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
        for (const id of c.ids) {
          const seg = Uint64.parseString(id);
          try { if (colors) setStatedColor(colors, seg, packed); } catch { /* keeps its default colour */ }
          group.visibleSegments.add(seg);
        }
      }
      const min = [0, 1, 2].map(i => Math.min(...cells.map(c => c.min[i])));
      const max = [0, 1, 2].map(i => Math.max(...cells.map(c => c.max[i])));
      v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (min[i] + max[i]) / 2 / spec.voxelUm[i]));
      const orient = view ?? spec.stage.projectionOrientation;
      if (orient) v.perspectiveNavigationState.pose.orientation.restoreState(orient);
      // projectionScale counts x voxels, and SCALE_PER_UM was tuned on the
      // 16 nm retina and MEC. On FlyWire's 4 nm voxels the same number framed
      // a quarter of the cell, off to one side (Ames 2026-10-06).
      v.projectionScale.value = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * SCALE_PER_UM * (0.016 / spec.voxelUm[0]);
    } catch (e) {
      console.warn(tag, 'could not show the cell:', e);
    }
  }

  /** A card's "show all" button: add a whole group to the view and frame it. */
  function showMore(cell: TourCell, more: TourMore) {
    const v = viewer();
    const layer = segLayer()?.layer;
    const group = layer?.displayState?.segmentationGroupState?.value;
    if (!v || !group) return;
    try {
      const { Uint64 } = require('neuroglancer/util/uint64');
      const colors = layer.displayState.segmentationColorGroupState?.value?.segmentStatedColors;
      const hex = more.color === 'own' ? null : (more.color || cell.color);
      const n = hex ? parseInt(hex.slice(1), 16) : 0;
      const packed = ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
      const keep = new Set(cell.ids);
      for (const id of more.ids) {
        const seg = Uint64.parseString(id);
        if (hex && colors && !keep.has(id)) { try { setStatedColor(colors, seg, packed); } catch { /* default colour */ } }
        group.visibleSegments.add(seg);
      }
      const min = [0, 1, 2].map(i => Math.min(cell.min[i], more.min[i]));
      const max = [0, 1, 2].map(i => Math.max(cell.max[i], more.max[i]));
      v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (min[i] + max[i]) / 2 / spec.voxelUm[i]));
      v.projectionScale.value = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * SCALE_PER_UM * (0.016 / spec.voxelUm[0]);
    } catch (e) {
      console.warn(tag, 'could not show the group:', e);
    }
  }

  // One listener for every card's buttons (the card is plain HTML).
  const MORE_ATTR = `data-tour-more-${spec.name}`;
  if (typeof document !== 'undefined') {
    document.addEventListener('click', ev => {
      const btn = (ev.target as HTMLElement | null)?.closest?.(`[${MORE_ATTR}]`) as HTMLButtonElement | null;
      if (!btn) return;
      const [ci, mi] = (btn.getAttribute(MORE_ATTR) || '').split(':').map(Number);
      const cell = spec.cells[ci];
      const more = cell?.more?.[mi];
      if (!more) return;
      if (btn.dataset.shown === '1') {
        // Back to the one cell.
        btn.dataset.shown = '';
        btn.textContent = more.label;
        // Every button on this card goes back to its own label.
        btn.closest('.html')?.querySelectorAll(`[${MORE_ATTR}]`).forEach(b => {
          const el = b as HTMLElement;
          const other = cell.more?.[Number((el.getAttribute(MORE_ATTR) || '').split(':')[1])];
          el.dataset.shown = '';
          if (other) el.textContent = other.label;
        });
        void showCells([cell], cell.view);
        return;
      }
      btn.dataset.shown = '1';
      btn.textContent = 'Back to one cell';
      showMore(cell, more);
    });
  }

  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  /** A cell card: optional picture, the text, then its "show all" buttons. */
  function cellHtml(c: TourCell, ci: number): string {
    const img = c.image ? `<div class="nge-tour-cell-img"><img src="${c.image}" alt="${esc(c.imageAlt || '')}" /></div>` : '';
    const body = marked.parse(c.text, { async: false }) as string;
    const more = (c.more || []).map((m, mi) => `
<div class="nge-tour-more">
  <button type="button" class="nge-tour-more-btn" data-no-drag ${MORE_ATTR}="${ci}:${mi}">${esc(m.label)}</button>
  ${m.note ? `<div class="nge-tour-more-note">${esc(m.note)}</div>` : ''}
</div>`).join('');
    return `${img}<div class="nge-tour-cell-text">${body}</div>${more}`;
  }

  /** The finale: every cell type at once. Finishing the tour then opens the
   *  Cell Library on Available (Tutorial.vue). */
  function showAllTypes() {
    // A registered showcase link: src/showcase.ts sets the view up (3D only,
    // labels in the Seg tab, no leaderboard) once it loads.
    if (spec.finale.showcaseUrl) { window.location.hash = '#!' + spec.finale.showcaseUrl; return; }
    return showCells(spec.cells, spec.finale.view);
  }

  return [
    {
      title: spec.welcome.title,
      // Hero on top, copy below, the same frame as the Site Tour welcome.
      html: `
<div class="nge-tour-welcome">
  <div class="nge-tour-welcome-hero${spec.welcome.heroWhole ? ' nge-tour-welcome-hero--whole' : ''}">
    <img src="${spec.welcome.hero}" alt="${spec.welcome.heroAlt}" />
  </div>
  <div class="nge-tour-welcome-body">
    ${spec.welcome.paragraphs.map(p => `<p>${p}</p>`).join('\n    ')}
  </div>
</div>`,
      position: MIDDLE,
      width: "480px",
      nextLabel: spec.welcome.nextLabel ?? "Meet the cells",
      onEnter: ensureStage,
    },
    ...spec.cells.map((c, ci): Step => ({
      title: c.title,
      // Plain text cards stay markdown; a card with a picture or buttons is HTML.
      ...(c.image || c.more?.length ? { html: cellHtml(c, ci) } : { text: c.text }),
      position: BESIDE,
      width: c.image ? "380px" : "340px",
      onEnter: () => showCells([c], c.view),
    })),
    {
      title: spec.finale.title,
      text: spec.finale.text,
      ...(spec.finale.pointAtCellLibrary === false
        ? { position: BESIDE, width: "340px" }
        : { position: { element: '[data-icon-id="cells"]', side: "bottom", offset: { x: 0, y: 14 } }, highlight: true }),
      onEnter: showAllTypes,
    },
  ];
}
