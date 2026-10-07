import { startViewAutosave } from './util/view_autosave';
import { startSegmentationServerWatch } from './util/segmentation_server_watch';
import { startImageLoadingHint } from './util/image_loading_hint';
import { hideCellsOfKind, showHiddenCells, type HideResult, type CellKind } from './util/hide_completed';
import GrowingCell from 'components/GrowingCell.vue';
import { watchPhoneEmptyView } from './widgets/widget_utils';
import { startUndelete } from './util/undelete';
import { Uint64 as Uint64ForUndelete } from 'neuroglancer/util/uint64';
import { isMobileRef as phoneRef } from './util/mobile';
import { installScriptApi } from './script_api';
import { startHighlightTint } from './util/highlight';
import {createApp, nextTick} from 'vue';
import {createPinia} from 'pinia';
import {installConsoleBuffer} from './util/console_buffer';
import {installAnnotationCounter} from './util/annotation_counter';
import {installBottomBarWatch} from './util/bottom_bar';
installConsoleBuffer();
installAnnotationCounter();
installBottomBarWatch();
import {installErrorReporting} from './util/error_reporting';
import {installMobileMode, isMobileRef} from './util/mobile';

import 'neuroglancer/ui/default_viewer.css';
import './widgets/lightbulb_menu.css';
import './widgets/help_panel_restyle.css';
import './widgets/render_tab_restyle.css';
import './widgets/annotations_restyle.css';
import './widgets/find_path_restyle.css';
import './tutorial_kit.css';

import {installShowcase} from './showcase';
import {runPendingDatasetTour} from './dataset_tour';
import App from 'components/App.vue';
import TriagePage from 'components/TriagePage.vue';
import {useIssueTagStore, useLayersStore, useProofreadingBackendStore, useSegmentAnnotationStore, useSplitMergeOverlayStore, useVolumesStore} from 'src/store';
import {useStatsStore} from './store-pyr';
import {exitGrapheneTool} from './widgets/graphene_tool_utils';
import {Viewer} from 'neuroglancer/viewer';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {disableContextMenu, disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import 'neuroglancer/sliceview/chunk_format_handlers';
import './move_to_segment_patch';
import './jump_to_list';
import './split_screen_tip';
import {installNoFourPanel} from './no_four_panel';
import './find_path_status';
import './drag_reorder';
import {ButtonService} from "./widgets/button_service";
import {AnnotationService, Point3D} from "./widgets/annotation_service";
import {UrlHashBinding} from "neuroglancer/ui/url_hash_binding";
import {bindTitle} from "neuroglancer/ui/title";
import {UserLayer, UserLayerConstructor, layerTypes} from "neuroglancer/layer";
import {Tool, restoreTool} from 'neuroglancer/ui/tool';
import {verifyObject, verifyObjectProperty, verifyString} from 'neuroglancer/util/json';
import {getLayerScales} from "./widgets/widget_utils";
import {registerFreeRotateCubeAnnotationTool} from "./widgets/free_rotate_cube_annotation";
import pyrIconUrl from './images/pyr-icon.png';

declare var NEUROGLANCER_DEFAULT_STATE_FRAGMENT: string|undefined;
// Injected by scripts/build-prod.js as the short git sha. Guarded with typeof
// at the use site because the CI workflow has its own build command that may
// not define it.
declare const NGE_BUILD: string|undefined;

type CustomBinding = {
  layer: string, tool: unknown, provider?: string,
}

type CustomBindings = {
  [key: string]: CustomBinding|string
};

declare const CUSTOM_BINDINGS: CustomBindings|undefined;

declare const DATASETS: { [key: string]: string};
export const hasCustomBindings = typeof CUSTOM_BINDINGS !== 'undefined' && Object.keys(CUSTOM_BINDINGS).length > 0;

function mergeTopBars() {
  const ngTopBar = document.querySelector('.neuroglancer-viewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
  // Two NG-native buttons live at the far right instead (Amy 2026-08-17):
  // the ? help toggle, then the layer side panel toggle LAST so it hugs the
  // panel it opens. Titles flip between Show/Hide, so match the suffix.
  const farRight = document.getElementById('ngFarRight');
  if (farRight) {
    for (const suffix of ['help panel', 'layer side panel']) {
      const btn = topBarVueParent.querySelector(`[title$="${suffix}"]`);
      if (btn) farRight.appendChild(btn);
    }
  }
}

/* ── Hover readout sits beside the position chip (Amy 2026-09-29) ──
   The orange mouse coordinates floated where the chat's bottom edge sits and
   covered it. They now share the blue chip's line, just to its right, so the
   chip's live right edge (it widens with the digits) is kept in a CSS var. */
function trackPositionChipEdge() {
  const root = document.documentElement;
  let observed: Element | null = null;
  const ro = new ResizeObserver(() => {
    if (observed) root.style.setProperty('--nge-pos-chip-right', `${Math.round(observed.getBoundingClientRect().right)}px`);
  });
  const attach = () => {
    const el = Array.from(document.querySelectorAll('.neuroglancer-position-widget'))
      .find(e => !e.closest('.neuroglancer-layer-item')) ?? null;
    if (el && el !== observed) { if (observed) ro.unobserve(observed); observed = el; ro.observe(el); }
  };
  attach();
  // Cheap re-check: the chip can be rebuilt (dataset switch). A MutationObserver
  // would fire on every mouse move, since the readout text changes constantly.
  setInterval(attach, 2000);
}

/* ── Pyr Favicon ── */
function injectNeuronFavicon() {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = pyrIconUrl;
  document.head.appendChild(link);
  // Also set the page title
  document.title = 'EyeWire II — neuroglancer';
}

/** "?triage=board": the admin triage board on its own, without the game. */
function isTriagePage(): boolean {
  try { return new URLSearchParams(window.location.search).has('triage'); } catch { return false; }
}

window.addEventListener('DOMContentLoaded', () => {
  injectNeuronFavicon();
  if (isTriagePage()) {
    // No viewer, no layers, no data: just the board.
    const page = createApp(TriagePage);
    installErrorReporting(page);
    page.use(createPinia());
    page.mount('#app');
    return;
  }
  // Before mount: components read isMobileRef during setup (chat default,
  // welcome sheet) and mobile.css keys off body.nge-mobile.
  installMobileMode();
  trackPositionChipEdge();
  const pinia = createPinia();
  const app = createApp(App);
  // Installed before mount so a failure during initial render is captured.
  // Vue swallows component errors into console.error, so without its
  // errorHandler nothing records them — that's how a ReferenceError in a
  // <script setup> block took chat down unnoticed.
  (window as any).__ngeBuild =
      typeof NGE_BUILD !== 'undefined' ? NGE_BUILD : null;
  installErrorReporting(app);
  app.use(pinia);
  const {initializeWithViewer} = useLayersStore();
  const {loadVolumes} = useVolumesStore();
  app.directive('visible', function(el, binding) {
    el.style.visibility = !!binding.value ? 'visible' : 'hidden';
  });
  app.mount('#app');
  const viewer = setupViewer();
  // const viewer = setupDefaultViewer();
  initializeWithViewer(viewer);
  loadVolumes(viewer);
  installShowcase();
  runPendingDatasetTour();
  nextTick(() => {
    mergeTopBars();
    liveNeuroglancerInjection();
  });

  const {loopUpdateLeaderboard} = useStatsStore();
  loopUpdateLeaderboard();

  // Start the scout tag store now, not on first use: its layer watcher is
  // what strips "⚑ Scout tags" / "⚑ Scout pins" layers that arrive in a saved
  // view or shared link. Lazily created, it never ran for someone who did not
  // open the Cell Library or tag mode, so those layers stayed (Amy
  // 2026-09-28: "loading for some users on default").
  useIssueTagStore();

  // Auto-select segmentation layer after viewer loads (fallback for when
  // LoginModal doesn't fire — e.g. already authenticated or bypass).
  autoSelectSegLayer(viewer);

  // Escape key handler: exit split/merge tools.
  //
  // Attached to BOTH window and document in capture phase so we win against
  // NG's own keybinder no matter how the bubbling resolves. We also check the
  // DOM for the tool overlay since some NG versions don't immediately update
  // layer.tool.value on activation, leaving store.toolActive stale.
  const escHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const store = useSplitMergeOverlayStore();
    const toolDomPresent = !!(
      document.querySelector('.graphene-multicut') ||
      document.querySelector('.graphene-merge-segments')
    );
    console.debug('[esc]', e.key, 'toolActive=', store.toolActive, 'toolDom=', toolDomPresent);
    if (!store.toolActive && !toolDomPresent) return;
    exitGrapheneTool();
    if (toolDomPresent && !store.toolActive) {
      store.setToolState(null);
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  // capture phase on both window AND document — whichever NG listens on, we
  // intercept first.
  window.addEventListener('keydown', escHandler, true);
  document.addEventListener('keydown', escHandler, true);

  /**
   * Re-enable the native context menu inside text fields.
   *
   * Neuroglancer calls `disableContextMenu()`, which registers a document-level
   * `contextmenu` listener that unconditionally `preventDefault()`s — right
   * click is bound to viewer navigation. The side effect is that the browser's
   * native menu is dead EVERYWHERE, including our own inputs, so a user can't
   * right-click a red-underlined word to get spellcheck corrections (or use
   * copy/paste) in the feedback box, chat input, notes, or search fields.
   *
   * Fix it here rather than by editing vendored neuroglancer: a capture-phase
   * listener runs before NG's document-level (bubble) handler, so stopping
   * propagation for editable targets means NG never gets to preventDefault. The
   * viewer canvas is untouched, so right-click navigation still works.
   */
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
      e.stopPropagation();
      return;
    }
    // Chat, and any text you've selected outside the viewer, get the normal
    // menu too, so Copy works there (Ames 2026-09-29: "I need to be able to
    // copy + paste in chat!"). Right-click on the viewer still navigates.
    const inViewer = !!target.closest('.neuroglancer-rendered-data-panel, .neuroglancer-panel canvas');
    const hasSelection = String(window.getSelection() || '').trim().length > 0;
    if (!inViewer && (target.closest('.nge-chat-float') || hasSelection)) {
      e.stopPropagation();
    }
  }, true);
});

/**
 * Try to select the segmentation layer and open the Seg. tab.
 * Retries a few times since layers may still be initializing.
 */
function autoSelectSegLayer(viewer: any, attempt = 0) {
  // Mobile: the seg side panel stays closed (Amy 2026-08-18), it would
  // cover most of the screen. Users open it deliberately via its toggle.
  if (isMobileRef.value) return;
  if (attempt > 5) return; // give up after ~10s
  setTimeout(() => {
    try {
      // Don't override if user already selected a layer
      if (viewer.selectedLayer.layer && viewer.selectedLayer.visible) return;

      const segLayer = viewer.layerManager.managedLayers.find(
        (l: any) => {
          const typeName = l.layer?.constructor?.name ?? '';
          if (typeName.includes('Segmentation') || l.layer?.type === 'segmentation') return true;
          const url = l.layer?.dataSources?.[0]?.spec?.url ?? '';
          return url.includes('graphene') || url.includes('segmentation');
        },
      );
      if (!segLayer) {
        autoSelectSegLayer(viewer, attempt + 1);
        return;
      }
      viewer.selectedLayer.layer = segLayer;
      viewer.selectedLayer.visible = true;

      // Click the Seg. tab after panel renders
      setTimeout(() => {
        const tabs = document.querySelectorAll(
          '.neuroglancer-layer-side-panel-tab, .neuroglancer-tab-label, [data-tab]'
        );
        for (const tab of tabs) {
          const text = tab.textContent?.trim();
          if (text === 'Seg.' || text === 'Seg' || text === 'Segments') {
            (tab as HTMLElement).click();
            return;
          }
        }
      }, 600);
    } catch { autoSelectSegLayer(viewer, attempt + 1); }
  }, 2000 * (attempt + 1)); // 2s, 4s, 6s, 8s, 10s
}

function setupViewer() {
  const viewer = (<any>window)['viewer'] = makeExtendViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);
  // The "?" (neuroglancer controls) button is off unless Settings turns it on.
  try {
    const prefs = JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}');
    viewer.uiConfiguration.showHelpButton.value = prefs.showNgControlsButton === true;
  } catch { viewer.uiConfiguration.showHelpButton.value = false; }

  // borrowed from setupDefaultViewer()
  const bindNonLayerSpecificTool = (obj: unknown, toolKey: string, desiredLayerType: UserLayerConstructor, desiredProvider?: string) => {
    let previousTool: Tool<Object>|undefined;
    let previousLayer: UserLayer|undefined;
    if (typeof obj === 'string') {
      obj = {'type': obj};
    }
    verifyObject(obj);
    const type = verifyObjectProperty(obj, 'type', verifyString);
    viewer.bindAction(`tool-${type}`, () => {
      const acceptableLayers = viewer.layerManager.managedLayers.filter((managedLayer) => {
        const correctLayerType = managedLayer.layer instanceof desiredLayerType;
        if (desiredProvider && correctLayerType) {
          for (const dataSource of managedLayer.layer?.dataSources || []) {
            const protocol = viewer.dataSourceProvider.getProvider(dataSource.spec.url)[2];
            if (protocol === desiredProvider) {
              return true;
            }
          }
          return false;
        } else {
          return correctLayerType;
        }
      });
      if (acceptableLayers.length > 0) {
        const firstLayer = acceptableLayers[0].layer;
        if (firstLayer) {
          if (firstLayer !== previousLayer) {
            previousTool = restoreTool(firstLayer, obj);
            previousLayer = firstLayer;
          }
          if (previousTool) {
            viewer.activateTool(toolKey, previousTool);
          }
        }
      }
    });
  }

  if (hasCustomBindings) {
    for (const [key, val] of Object.entries(CUSTOM_BINDINGS!)) {
      if (typeof val === 'string') {
        viewer.inputEventBindings.global.set(key, val);
      } else {
        viewer.inputEventBindings.global.set(key, `tool-${val.tool}`);
        const layerConstructor = layerTypes.get(val.layer);
        if (layerConstructor) {
          const toolKey = key.charAt(key.length - 1).toUpperCase();
          bindNonLayerSpecificTool(val.tool, toolKey, layerConstructor, val.provider);
        }
      }
    }
  }

  const hashBinding = viewer.registerDisposer(
      new UrlHashBinding(viewer.state, viewer.dataSourceProvider.credentialsManager, {
        defaultFragment: typeof NEUROGLANCER_DEFAULT_STATE_FRAGMENT !== 'undefined' ?
            NEUROGLANCER_DEFAULT_STATE_FRAGMENT :
            undefined
      }));
  viewer.registerDisposer(hashBinding.parseError.changed.add(() => {
    const {value} = hashBinding.parseError;
    if (value !== undefined) {
      const status = new StatusMessage();
      status.setErrorMessage(`Error parsing state: ${value.message}`);
      console.log('Error parsing state', value);
    }
    hashBinding.parseError;
  }));
  hashBinding.updateFromUrlHash();
  // Autosave the view to the player's account and offer it back (user_views).
  startViewAutosave(viewer, () => useProofreadingBackendStore().userId || null);
  startSegmentationServerWatch(viewer);
  startImageLoadingHint(viewer);
  // Phones: never leave the 3D only view with nothing in it.
  watchPhoneEmptyView(() => phoneRef.value);
  // Undelete: remember the cells that leave the view, to bring them back.
  startUndelete(Uint64ForUndelete);
  installNoFourPanel(viewer);
  // window.eyewire, the stable API for player scripts (static/scripts.html).
  installScriptApi(viewer, {
    user: () => {
      const b = useProofreadingBackendStore();
      return b.userId ? { id: b.userId, username: b.username || '' } : null;
    },
    myCells: () => {
      const b = useProofreadingBackendStore();
      if (!b.userId) return [];
      return b.tasks.filter(t => t.assigned_to === b.userId).map(t => ({
        taskId: t.id, cellId: String(t.final_segment_id || t.segment_id || ''), status: t.status, dataset: t.dataset,
      }));
    },
  });
  startHighlightTint(viewer);
  viewer.registerDisposer(bindTitle(viewer.title));

  bindDefaultCopyHandler(viewer);
  bindDefaultPasteHandler(viewer);

  registerFreeRotateCubeAnnotationTool();

  return viewer;
}

function makeExtendViewer() {
  disableContextMenu();
  disableWheel();
  try {
    let display =
        new DisplayContext(document.getElementById('neuroglancer-container')!);
    return new ExtendViewer(display);
  } catch (error) {
    StatusMessage.showMessage(`Error: ${error.message}`);
    throw error;
  }
}

/** The legend under the segment list is also its filter (Ames 2026-10-07: "yes
 *  brilliant, clickable legend"). Clicking a kind takes those cells out of the
 *  list; clicking it again puts them back. While its cells are out, the word
 *  is dimmed and struck through. No button is added for a job only some
 *  people need. See util/hide_completed.ts. */
// `means` says what the word is, in the tip: players asked what "Done" and
// "Typed" are (annkri 2026-10-07), and the legend never said.
const LEGEND_KINDS: { kind: CellKind; pip: string; label: string; plural: string; means: string }[] = [
  { kind: 'todo', pip: 'incomplete', label: 'Todo', plural: 'cells still to do', means: 'Todo: not proofread and no cell type yet.' },
  { kind: 'proofread', pip: 'complete', label: 'Proofread', plural: 'proofread cells', means: 'Proofread: marked proofread, no cell type yet.' },
  { kind: 'typed', pip: 'annotated', label: 'Typed', plural: 'typed cells', means: 'Typed: has a cell type, not proofread yet.' },
  { kind: 'done', pip: 'done', label: 'Done', plural: 'done cells', means: 'Done: proofread and has a cell type.' },
];
/** The line just above the legend: what a kind does when the pointer is on it,
 *  and the count while cells are being checked, with the game's growing cell.
 *  It floats over the foot of the list, so the legend itself never changes
 *  size or moves (Ames 2026-10-07: "checking moves the legend up"), and it is
 *  inside the panel, where the browser's own tooltip fell below the window. */
interface LegendNote { tip(words: string | null): void; checking(done: number, total: number): void; done(words?: string): void; }
function makeLegendNote(legend: HTMLElement): LegendNote {
  const el = document.createElement('div');
  el.className = 'nge-seg-legend-note';
  el.setAttribute('role', 'status');
  const cell = document.createElement('span');
  cell.className = 'nge-seg-legend-note-cell';
  const words = document.createElement('span');
  el.append(cell, words);
  legend.appendChild(el);
  let app: ReturnType<typeof createApp> | null = null;
  let busy = false, tipWords: string | null = null, sayTimer = 0;
  const show = (text: string | null) => {
    words.textContent = text ?? '';
    el.classList.toggle('nge-seg-legend-note--on', !!text);
  };
  const stopCell = () => { try { app?.unmount(); } catch { /* already gone */ } app = null; cell.replaceChildren(); el.classList.remove('nge-seg-legend-note--busy'); };
  return {
    tip(text) { tipWords = text; if (!busy && !sayTimer) show(text); },
    checking(done, total) {
      if (!busy) {
        busy = true;
        clearTimeout(sayTimer); sayTimer = 0;
        el.classList.add('nge-seg-legend-note--busy');
        app = createApp(GrowingCell, { size: 26, named: false });
        app.mount(cell);
      }
      show(total ? `Checking ${done} of ${total}` : 'Checking…');
    },
    done(text) {
      busy = false;
      stopCell();
      clearTimeout(sayTimer); sayTimer = 0;
      if (text) { show(text); sayTimer = window.setTimeout(() => { sayTimer = 0; show(tipWords); }, 3200); }
      else show(tipWords);
    },
  };
}

function makeLegendItem(legend: HTMLElement, note: LegendNote, spec: typeof LEGEND_KINDS[number]): HTMLElement {
  const item = document.createElement('span');
  item.className = 'nge-seg-legend-item';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.dataset.kind = spec.kind;
  const pip = document.createElement('span');
  pip.className = `nge-legend-pip nge-legend-pip--${spec.pip}`;
  const text = document.createElement('span');
  text.className = 'nge-seg-legend-text';
  item.append(pip, text);

  text.textContent = spec.label;      // the word itself never changes

  let hidden: HideResult | null = null;
  let busy = false;
  let over = false;
  const tipWords = () => {
    const n = hidden?.hidden.length ?? 0;
    return hidden
      ? `${spec.means} ${n} hidden. Click to bring ${n === 1 ? 'it' : 'them'} back.`
      : `${spec.means} Click to hide these from the list.`;
  };
  const rest = () => {
    item.classList.toggle('nge-seg-legend-item--off', !!hidden);
    item.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    item.setAttribute('aria-label', `${spec.label}. ${tipWords()}`);
    // The legend stays up while anything is hidden, even if that emptied the list.
    legend.dataset.hiding = legend.querySelector('.nge-seg-legend-item--off') ? '1' : '';
    if (over) note.tip(tipWords());
  };
  rest();
  const enter = () => { over = true; note.tip(tipWords()); };
  const leave = () => { over = false; note.tip(null); };
  item.addEventListener('mouseenter', enter);
  item.addEventListener('mouseleave', leave);
  item.addEventListener('focus', enter);
  item.addEventListener('blur', leave);

  const toggle = async () => {
    if (busy || legend.dataset.checking) return;     // one check at a time
    if (hidden) {                       // bring them back
      showHiddenCells(hidden);
      hidden = null;
      rest();
      return;
    }
    busy = true;
    legend.dataset.checking = '1';
    item.classList.add('nge-seg-legend-item--busy');
    note.checking(0, 0);
    const result = await hideCellsOfKind(useLayersStore().getCaveServerUrl(), spec.kind,
      (done, total) => note.checking(done, total)).catch(() => null);
    busy = false;
    delete legend.dataset.checking;
    item.classList.remove('nge-seg-legend-item--busy');
    if (!result || !result.checked) { note.done('No cells in the list to check.'); return; }
    if (!result.hidden.length) {
      note.done(result.unread === result.checked ? 'Cells are not marked on this dataset.' : `None of these are ${spec.label.toLowerCase()}.`);
      return;
    }
    hidden = result;
    const n = result.hidden.length;
    rest();
    note.done(`${n} ${n === 1 ? spec.plural.replace(/cells/, 'cell') : spec.plural} hidden.`);
  };
  item.addEventListener('click', () => { void toggle(); });
  return item;
}
// Enter or Space on a focused legend item works it like a click. Listened for
// on the window, at capture: another handler there takes Enter before it can
// reach the item itself.
window.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = document.activeElement as HTMLElement | null;
  if (!item?.classList?.contains('nge-seg-legend-item') || item.getAttribute('role') !== 'button') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  item.click();
}, true);

/** Injects a small pip legend as the last child of the seg display tab so
 *  it sits at the bottom of the panel as a sticky footer. Idempotent —
 *  safe to call repeatedly; existing legends get reused (and shown/hidden
 *  based on whether any segment entries are currently in the tab). */
function injectSegmentLegend() {
  const tabs = document.querySelectorAll('.neuroglancer-segment-display-tab');
  tabs.forEach(tab => {
    let legend = tab.querySelector(':scope > .nge-seg-legend') as HTMLElement | null;
    const hasEntries = !!tab.querySelector('.neuroglancer-segment-list-entry');
    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'nge-seg-legend';
      // Ordered as the workflow actually progresses: Todo -> Proofread ->
      // Typed -> Done. The pip CLASS names are unchanged (they're set from
      // CAVE status in button_service and referenced by the restyle CSS);
      // only the labels and their order change. "Complete" was relabelled
      // "Proofread" to say what the user actually did to the cell.
      const note = makeLegendNote(legend);
      for (const spec of LEGEND_KINDS) legend.appendChild(makeLegendItem(legend, note, spec));
      tab.appendChild(legend);
    } else if (legend.parentElement !== tab) {
      // Move to the end of the tab if it ended up somewhere else
      tab.appendChild(legend);
    }
    // Stays up while a kind is hidden, even if hiding emptied the list: it is
    // the only way to bring those cells back.
    legend.style.display = hasEntries || legend.dataset.hiding ? '' : 'none';
  });
}

function observeSegmentSelect(targetNode: Element) {
  const viewer: ExtendViewer = (<any>window)['viewer'];
  const buttonService = viewer.buttonService;
  const annotationService = viewer.annotationService;
  // Select the node that will be observed for mutations
  if (!targetNode) {
    return;
  }

  // Options for the observer (which mutations to observe)
  const config = {childList: true, subtree: true};

  // Derives the CAVE server base URL from the active layers, with fallback
  // to per-dataset config and global override. Keeps UI buttons working even
  // when the layer URL lacks a middleauth+ prefix (e.g. in dev).
  const getLocalServerURL = (): string => {
    const {getCaveServerUrl} = useLayersStore();
    return getCaveServerUrl();
  };

  // Tells the row's virtual list its real height after we add our buttons
  // (remeasureItem in move_to_segment_patch.ts).
  const remeasureListRow = (row: HTMLElement) => {
    for (let el = row.parentElement; el; el = el.parentElement) {
      const vl = (el as any).__nge_virtualList;
      if (vl) {
        vl.remeasureItem?.(row);
        return;
      }
    }
  };

  const updateSegmentSelectItem = function(item: HTMLElement) {
    if (item.classList) {
      let buttonList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-segment-list-entry")) {
        buttonList = [item];
      }
      const localServerURL = getLocalServerURL();
      buttonList.forEach(item => {
        const segmentIDString =
            item.getAttribute('data-id');
        if (segmentIDString) {
          // Track this as the active segment for the annotation panel
          useSegmentAnnotationStore().setActiveSegId(segmentIDString, localServerURL);

          let injected = false;
          let button = item.querySelector('.nge-segment-button.menu');
          if (button == null) {
            injected = true;
            const viewer: ExtendViewer = (<any>window)['viewer'];
            const layerName = viewer.selectedLayer.layer?.name || 'default';
            const dataset = (typeof DATASETS !== 'undefined' && DATASETS) ? (DATASETS[layerName] ?? '') : '';

            button = buttonService.createButton(localServerURL, segmentIDString, dataset);
            button.classList.add('error')
            item.appendChild(button);
            // Inject a placeholder badge immediately; it will be updated once the
            // async CAVE status fetch completes inside _refreshButtonStatus.
            buttonService.updateLabelBadge(item as HTMLElement, null);
          }

          // Jump-to-segment button (centers view + blooms the segment)
          if (!item.querySelector('.nge-jump-btn')) {
            injected = true;
            const jumpBtn = buttonService.createJumpButton(segmentIDString);
            // Place jump button just before the lightbulb (delta) button so the
            // row reads: chip … jump … delta.
            if (button && button.parentElement === item) {
              item.insertBefore(jumpBtn, button);
            } else {
              item.appendChild(jumpBtn);
            }
          }

          // Clean up any leftover nickname labels (feature removed)
          const nameLabel = item.querySelector('.nge-segment-nickname');
          if (nameLabel) nameLabel.remove();
          const idSpan = item.querySelector('.neuroglancer-segment-list-entry-id') as HTMLElement | null;
          if (idSpan) idSpan.classList.remove('nge-id-collapsed');

          if (injected) remeasureListRow(item as HTMLElement);
        }
      })
    }
  };

  const updateSelectionDetailsBody = function(item: HTMLElement) {
    if (item.classList) {
      let selectionList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-annotation-list-entry")) {
        selectionList = [item];
      }
      selectionList.forEach(item => {
        const positionGrid = item.querySelector(".neuroglancer-annotation-position")
        const isDataBounds = item.querySelector(".neuroglancer-annotation-description")?.textContent === "Data Bounds" ? true : false;

        if (positionGrid && !isDataBounds) {
          const icon = item.querySelector(".neuroglancer-annotation-icon")?.textContent;
          let type = "unknown";
          if (icon == '❑') { // box
            type = 'box';
          } else if (icon == 'ꕹ') { // line
            type = "line";
          } else if (icon == '⚬') { // point
            type = "point";
          } else if (icon == '◎') { // ellipsoid
            type = "ellipsoid";
          }
          const coordElements = item.querySelectorAll(' .neuroglancer-annotation-coordinate');

          let coordinates: Point3D[] = [];

          for (let i = 0; i < coordElements?.length; i += 3){
            const dimCoord: Point3D = {
              x: coordElements[i].textContent?.trim() || '',
              y: coordElements[i+1].textContent?.trim() || '',
              z: coordElements[i+2].textContent?.trim() || ''
            }
            coordinates.push(dimCoord)
          }

          let distance = item.querySelector(".nge-selected-annotation.distance")
          if (distance == null) {
            const viewer: ExtendViewer = (<any>window)['viewer'];
            const scales = getLayerScales(viewer.coordinateSpace)
            distance = annotationService.calculateDistance(type, coordinates, scales);
            item.appendChild(distance);
          }
        }
      })
    }
  }

  // Callback function to execute when mutations are observed
  const detectMutation = function(mutationsList: MutationRecord[]) {
    //console.log('Segment ID Added');
    // replaceIcons();
    // TODO: this is not ideal, but it works for now  (maybe)
    /*Array.from(document.querySelectorAll('.top-buttons .segment-checkbox'))
        .forEach((item: any) => {
          CustomCheck.convertCheckbox(item);
        });
*/
    mutationsList.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        updateSegmentSelectItem(node as HTMLElement);
        // Also process any segment entries nested inside a newly-added container
        // (the whole panel can be added at once, so the entry itself may not be
        //  a direct addedNode).
        if ((node as Element).querySelectorAll) {
          (node as Element)
              .querySelectorAll('.neuroglancer-segment-list-entry')
              .forEach(el => updateSegmentSelectItem(el as HTMLElement));
        }
      });
      mutation.addedNodes.forEach(node => {
        updateSelectionDetailsBody(node as HTMLElement);
        if ((node as Element).querySelectorAll) {
          (node as Element)
              .querySelectorAll('.neuroglancer-annotation-list-entry')
              .forEach(el => updateSelectionDetailsBody(el as HTMLElement));
        }
      });
    });
    // Inject the status legend after the segment list when segments are present
    injectSegmentLegend();
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(detectMutation);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);

  // Convert existing items
  targetNode.querySelectorAll('.neuroglancer-segment-list-entry').forEach(updateSegmentSelectItem);
  targetNode.querySelectorAll('.neuroglancer-annotation-list-entry').forEach(updateSelectionDetailsBody);
}

function liveNeuroglancerInjection() {
  const watchNode = document.querySelector('#content');
  if (!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode);
  observeSplitMergeTools();
}

/**
 * After exiting multicut/merge, restore 3D segmentation rendering.
 * The multicut tool sets useTemporaryVisibleSegments which can leave
 * the segmentation layer in a state where 3D meshes are not rendered.
 */
function restoreSegmentation3D() {
  try {
    const viewer = (window as any)['viewer'];
    if (!viewer) return;
    for (const ml of viewer.layerManager?.managedLayers ?? []) {
      const layer = ml.layer;
      if (!layer || !layer.displayState) continue;
      const segState = layer.displayState?.segmentationGroupState?.value;
      if (!segState) continue;
      // Reset temporary visible segments state that multicut mode uses
      if (segState.useTemporaryVisibleSegments?.value) {
        segState.useTemporaryVisibleSegments.value = false;
      }
      if (segState.useTemporarySegmentEquivalences?.value) {
        segState.useTemporarySegmentEquivalences.value = false;
      }
      if (segState.temporaryVisibleSegments?.clear) {
        segState.temporaryVisibleSegments.clear();
      }
      if (segState.temporarySegmentEquivalences?.clear) {
        segState.temporarySegmentEquivalences.clear();
      }
      // Reset 2D temp colors
      if (layer.displayState.useTempSegmentStatedColors2d) {
        layer.displayState.useTempSegmentStatedColors2d.value = false;
      }
      if (layer.displayState.tempSegmentStatedColors2d?.value?.clear) {
        layer.displayState.tempSegmentStatedColors2d.value.clear();
      }
      if (layer.displayState.tempSegmentDefaultColor2d) {
        layer.displayState.tempSegmentDefaultColor2d.value = undefined;
      }
    }
  } catch (e) {
    console.warn('[restoreSegmentation3D] Failed:', e);
  }
}

/**
 * Watch for graphene multicut / merge tool activation in neuroglancer's DOM.
 * Updates useSplitMergeOverlayStore so Vue components can react.
 */
function observeSplitMergeTools() {
  const store = useSplitMergeOverlayStore();
  let rafId: number | null = null;
  // Track previous merge statuses so we only fire flash on change
  let prevMergeStatuses: string[] = [];
  // Track previous point counts for multicut submit detection
  let prevSinkCount = 0;
  let prevSourceCount = 0;
  let wasMulticutActive = false;
  let wasMergeActive = false;
  // True once we've seen a genuine split SUBMIT this session (Enter pressed:
  // NG starts "Splitting..." and/or the placed points reset to 0 without a
  // Clear). Only a real submit should show the "Split complete" success bar on
  // exit — plain Cancel/Clear/toggle-off must close silently.
  let splitSubmitted = false;

  // Track NG status bar messages to capture split/merge errors
  let lastStatusText = '';
  let lastStatusTime = 0;
  const STATUS_COOLDOWN_MS = 3000;

  /** Scan #statusContainer for split/merge related errors/info */
  function checkStatusMessages() {
    if (!store.toolActive && !store.pendingClose) return;
    if (store.resultFlash) return; // already showing a result

    const statusContainer = document.getElementById('statusContainer');
    if (!statusContainer) return;

    for (const child of Array.from(statusContainer.children)) {
      const el = child as HTMLElement;
      if (el.style.display === 'none') continue;

      const text = el.textContent?.trim() || '';
      if (!text) continue;

      // Cooldown: don't re-trigger same message within window
      if (text === lastStatusText && Date.now() - lastStatusTime < STATUS_COOLDOWN_MS) continue;

      const lower = text.toLowerCase();
      // Only capture messages related to split/merge operations
      const isRelevant = lower.includes('split') || lower.includes('merge') ||
        lower.includes('multicut') || lower.includes('supervoxel') ||
        lower.includes('segment');
      if (!isRelevant) continue;

      const cleanText = text.replace(/\s*dismiss\s*$/i, '').trim();
      lastStatusText = text;
      lastStatusTime = Date.now();

      if (lower.includes('failed') || lower.includes('error')) {
        store.showResult('error', cleanText, 10000);  // long enough to read, or ask the guide
        store.submitting = false;
      } else if (lower.includes('splitting') || lower.includes('finding split')) {
        // Neuroglancer shows "Splitting source from sink..." during processing —
        // the authoritative signal that a split was actually submitted.
        splitSubmitted = true;
        store.submitting = true;
        store.setStatusMessage('Splitting...');
      }
      return; // one message per scan cycle
    }
  }

  function scanToolState() {
    // Don't scan during success-hold close animation
    if (store.pendingClose) return;

    const multicutEl = document.querySelector('.graphene-multicut');
    const mergeEl = document.querySelector('.graphene-merge-segments');

    if (multicutEl) {
      store.setToolState('multicut');

      // Detect active group from the indicator div
      const indicator = multicutEl.querySelector('.activeGroupIndicator');
      if (indicator) {
        store.setActiveGroup(indicator.classList.contains('blueGroup') ? 'blue' : 'red');
      }

      // Read point counts from internal multicut state (sinks = red, sources = blue)
      const viewer: any = (<any>window)['viewer'];
      try {
        const segLayer = viewer?.selectedLayer?.layer?.layer;
        const gc = segLayer?.graphConnection?.value;
        if (gc?.state?.multicutState) {
          const ms = gc.state.multicutState;
          const sinkCount = ms.sinks?.size ?? 0;
          const sourceCount = ms.sources?.size ?? 0;
          store.updatePointCounts(sinkCount, sourceCount);

          // Points reset from >0 to 0 — either the user pressed Enter (submit)
          // or clicked Clear. Clear stamps store.clearedAt just before wiping
          // the points, so we treat a reset inside that window as a Clear (bar
          // returns to its normal look) and everything else as a submit.
          if (wasMulticutActive &&
              (prevSinkCount > 0 || prevSourceCount > 0) &&
              sinkCount === 0 && sourceCount === 0) {
            const justCleared = Date.now() - store.clearedAt < 1500;
            if (justCleared) {
              store.submitting = false;
              store.setStatusMessage('');
            } else {
              splitSubmitted = true;
              store.submitting = true;
              store.setStatusMessage('Submitting split...');
            }
          }
          prevSinkCount = sinkCount;
          prevSourceCount = sourceCount;
        }
      } catch { /* non-critical: internal multicut state unavailable */ }

      if (!wasMulticutActive) splitSubmitted = false;
      wasMulticutActive = true;
      wasMergeActive = false;

    } else if (mergeEl) {
      store.setToolState('merge');
      wasMulticutActive = false;
      wasMergeActive = true;

      // Count merge submissions and scrape segment IDs
      const submissions = mergeEl.querySelectorAll('.graphene-merge-segments-submission');
      store.mergeSubmissionCount = submissions.length;

      // Scrape segment IDs from each submission pair
      const segments: string[][] = [];
      submissions.forEach(sub => {
        const points = sub.querySelectorAll('.graphene-merge-segments-point');
        const pair: string[] = [];
        points.forEach(pt => {
          // Segment ID is in the text of the widget (first line of the double-line entry)
          const text = (pt.textContent || '').trim().split('\n')[0].trim();
          if (text) pair.push(text);
        });
        if (pair.length > 0) segments.push(pair);
      });
      store.mergeSegments = segments;

      // Scrape auto-submit checkbox state
      const autoSubmitCheckbox = mergeEl.querySelector('label input[type="checkbox"]') as HTMLInputElement | null;
      store.autoSubmit = autoSubmitCheckbox?.checked ?? false;

      // Scrape per-submission status from .graphene-merge-segments-submission-status
      const statusEls = mergeEl.querySelectorAll('.graphene-merge-segments-submission-status');
      const currentStatuses: string[] = [];
      statusEls.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text) currentStatuses.push(text);
      });

      // Detect new status changes
      if (currentStatuses.length > 0) {
        const latest = currentStatuses[currentStatuses.length - 1];
        const prevLatest = prevMergeStatuses.length > 0
          ? prevMergeStatuses[prevMergeStatuses.length - 1] : '';

        if (latest !== prevLatest) {
          const lower = latest.toLowerCase();
          if (lower === 'trying...' || lower === 'trying') {
            store.submitting = true;
            store.setStatusMessage('Merging segments...');
          } else if (lower === 'done') {
            store.showResult('success', 'Merge complete', 1500);
          } else if (latest && lower !== 'trying...' && lower !== 'done') {
            store.showResult('error', `Merge failed: ${latest}`, 5000);
          }
        }
      }
      prevMergeStatuses = currentStatuses;

    } else {
      // Tool DOM disappeared
      if (wasMulticutActive) {
        const recentError = store.resultFlash === 'error';
        if (splitSubmitted && !recentError) {
          // A split was actually submitted (saw "Splitting..." / points cleared
          // via Enter) and the tool closed — celebrate the completion.
          store.beginSuccessClose('Split complete');
        } else {
          // Cancelled, cleared, or toggled off without submitting (also the
          // error case) — just close the bar silently.
          store.setToolState(null);
        }
        wasMulticutActive = false;
        splitSubmitted = false;
      } else if (wasMergeActive) {
        // Merge tool exited — just close silently
        // (merge successes/errors were already shown inline during session)
        store.setToolState(null);
        wasMergeActive = false;
      } else {
        store.setToolState(null);
      }
      prevSinkCount = 0;
      prevSourceCount = 0;
      prevMergeStatuses = [];
      lastStatusText = '';

      // Restore 3D segmentation after tool exit.
      // Multicut mode uses temporaryVisibleSegments which can leave the
      // segmentation layer in a state where 3D meshes are hidden.
      restoreSegmentation3D();
    }

    // Check NG status bar for errors during tool use
    checkStatusMessages();
  }

  // Debounce with requestAnimationFrame to avoid thrashing
  function debouncedScan() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      scanToolState();
    });
  }

  // Observe the entire content area for tool status changes
  const container = document.querySelector('#content') || document.body;
  const observer = new MutationObserver(debouncedScan);
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // Also poll periodically for point-count updates (annotations added
  // inside the tool don't always trigger DOM mutations we can observe)
  setInterval(scanToolState, 500);
}

class ExtendViewer extends Viewer {
  // theme = new Theming();
  buttonService = new ButtonService();
  annotationService = new AnnotationService();
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      showPanelBorders: true,
      // defaultLayoutSpecification: 'xy-3d',
      // minSidePanelSize: 310  // not in ViewerOptions type
    });
  }
    // storeProxy.loadedViewer = true;
    // authTokenShared!.changed.add(() => {
    //   storeProxy.fetchLoggedInUser();
    // });
    // storeProxy.fetchLoggedInUser();

    // if (!this.jsonStateServer.value) {
    //   this.jsonStateServer.value = config.linkShortenerURL;
    // }


  // promptJsonStateServer(message: string): void {
  //   let json_server_input = prompt(message, config.linkShortenerURL);
  //   if (json_server_input !== null) {
  //     this.jsonStateServer.value = json_server_input;
  //   } else {
  //     this.jsonStateServer.reset();
  //   }
  // }
}
