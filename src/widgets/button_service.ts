import { explainCellType } from '../data/cell_type_glossary';
import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {Uint64} from 'neuroglancer/util/uint64';
import {addPastedSegments, segmentLabels, segmentLabelsChanged, setPlaceCellLoader, setSegmentLabelRequester} from 'neuroglancer/ui/nge_pasted_segments';
import {StatusMessage} from 'neuroglancer/status';
import {cellAtCrosshair} from '../util/crosshair_cell';
import {getPcgInfo} from './pcg_service';
import {setStatedColor} from './widget_utils';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {currentCellTypes} from '../datasets';
import {planMenuCompletion, finishMenuCompletion, needsCompletionDetails, reopenAfterUnmark} from '../util/menu_complete';
import {askCompletionDetails, type CompletionDetails} from '../util/completion_details';
import {getCellStatus, setCellComplete, saveCellType, CellStatus, getLastCompletionProblem, getLastCellTypeProblem, activeCaveServer} from './lightbulb_service';

/** The name Pyr shows for a cell: its type, with its classification. */
function cellLabel(status: CellStatus|null|undefined): string {
  return status?.cellType
    ? (status.classificationSystem ? `${status.classificationSystem} - ${status.cellType}` : status.cellType)
    : (status?.classificationSystem || '');
}

// A pasted coordinate: once that spot has loaded, the cell there (its current
// ID, after any edits) joins the list under Pasted. Empty space says so.
let placeLoad = 0;
setPlaceCellLoader(async (group: any) => {
  const mine = ++placeLoad;
  let found: Awaited<ReturnType<typeof cellAtCrosshair>> | null = null;
  for (let i = 0; i < 16; ++i) {
    await new Promise(r => setTimeout(r, 500));
    if (mine !== placeLoad) return;  // a newer paste took over
    found = await cellAtCrosshair();
    if (found.supervoxel) break;
  }
  if (!found || !found.supervoxel) {
    StatusMessage.showTemporaryMessage('Nothing has loaded at that place yet. Look at the 2D view, then paste again.', 4000);
    return;
  }
  if (found.supervoxel === '0') {
    StatusMessage.showTemporaryMessage('That place is empty space, not inside a cell.', 4000);
    return;
  }
  const id = found.root ?? (getPcgInfo() ? null : found.supervoxel);
  if (!id) {
    StatusMessage.showTemporaryMessage(found.problem || 'Could not look up the cell there.', 4000);
    return;
  }
  addPastedSegments(group, [Uint64.parseString(id)]);
  StatusMessage.showTemporaryMessage(`Added the cell there: ${id}`, 4000);
});

// A search by name in the Seg panel asks for the names of the cells whose rows
// are not drawn yet: each cell is looked up once, four at a time.
const labelAsked = new Set<string>();
// Names are for one dataset: a switch starts them afresh, so an ID that
// exists in two datasets never shows the other one's name.
let labelScope = '';
function inLabelScope() {
  const scope = currentSegLayerName();
  if (scope !== labelScope) {
    labelScope = scope;
    segmentLabels.clear();
    labelAsked.clear();
  }
}
setSegmentLabelRequester(ids => {
  inLabelScope();
  const todo = ids.filter(id => !labelAsked.has(id) && !segmentLabels.has(id)).slice(0, 300);
  if (!todo.length) return;
  todo.forEach(id => labelAsked.add(id));
  const server = activeCaveServer();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      try {
        const label = cellLabel(await getCellStatus(server, id));
        if (label && currentSegLayerName() === labelScope) {
          segmentLabels.set(id, label);
          segmentLabelsChanged.dispatch();
        }
      } catch { /* that cell stays unnamed */ }
    }
  };
  for (let i = 0; i < 4; ++i) void worker();
});
import {getDatasetCaveConfig} from '../config';
import {currentSegLayerName} from '../datasets';
import {useHelpRequestStore, useProofreadingBackendStore, type ClaimPoint} from '../store';
import {getRootFromSupervoxel, getSelectedSupervoxelId} from './pcg_service';
import {startLinkForSegment, openStartLink} from '../util/start_link';
import {isCurrentId, updateToCurrentId, currentIdsOf} from '../util/outdated_ids';
import {labSheetRowsFor, labSheetLines, labSheetSummary, type LabSheetRow} from '../util/lab_sheet';

const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void)|undefined)[][];

export class ButtonService {
  createButton(
      localServerURL: string, segmentIDString: string,
      dataset: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'nge-segment-button nge-lb-btn nge-lb-incomplete menu';
    button.title = 'Click for proofreading and annotation status';
    button.dataset.segmentId = segmentIDString;
    button.style.cssText =
        'background:transparent;border:none;box-shadow:none;cursor:pointer;padding:0 2px;display:flex;align-items:center;justify-content:center;';

    // Dots icon (visible on hover) + status pip
    button.innerHTML = '<span class="nge-lb-dots">⋯</span><span class="nge-lb-pip"></span>';

    // Async: fetch CAVE status and update the pip accordingly
    this._refreshButtonStatus(button, localServerURL, segmentIDString);

    // Retina: what the lab's sheet says about this cell fills in its mark and
    // its label (see _paint). Kept beside _cellStatus, never inside it.
    void labSheetRowsFor(segmentIDString).then(rows => {
      if (!rows.length) return;
      (button as any)._labSheet = rows;
      this._paint(button, (button as any)._cellStatus ?? null);
    }).catch(() => { /* nothing to show */ });

    // Is this ID still the cell's current one? An edit by anyone gives the
    // cell a new ID, and an old one in the list kept looking fine. The old
    // lightbulb said so; this marks the button amber and the menu offers to
    // update it (Ames 2026-10-08).
    void isCurrentId(segmentIDString).then(current => {
      if (current !== false) return;
      button.classList.add('nge-lb-outdated');
      button.title = 'This ID is out of date: the cell has been edited since. Click to update it.';
    });

    button.addEventListener('click', (_event: MouseEvent) => {
      const menu = this.makeMenu(button, localServerURL, segmentIDString, dataset);
      menu.show(<MouseEvent>{clientX: 0, clientY: 0});
      const el = menu.element as HTMLElement;
      // Docked to the right edge of the page, under the top bar, like a side
      // panel: floating, it covered the cells being looked at, and placed by a
      // width guess it left the side panel's X showing beside it, which read
      // as its own close (player report and Ames, 2026-10-14). It has its own X.
      const panel = button.closest('.neuroglancer-side-panel') as HTMLElement | null;
      const top = panel ? Math.max(0, panel.getBoundingClientRect().top) : 0;
      el.classList.add('nge-lb-docked');
      el.style.left = 'auto';
      el.style.right = '0px';
      el.style.top = top + 'px';
      el.style.bottom = '0px';
      el.style.maxHeight = 'none';
      el.style.transform = 'none';
    });

    // Listen for annotation changes from AnnotationPanel (or anywhere).
    // The event carries the current status directly so we don't need to
    // re-fetch from CAVE (which might miss localStorage-only annotations).
    document.addEventListener('nge:seg-status-changed', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Support both 'segId' and 'segmentId' keys for backwards compat
      const eventSegId = detail.segId || detail.segmentId;
      if (eventSegId === segmentIDString) {
        if (detail.status === 'claimed') {
          // Claim event — just add the claimed class, don't refetch CAVE
          button.classList.add('nge-lb-claimed');
        } else if (detail.status === 'released') {
          // Release event — remove claimed class
          button.classList.remove('nge-lb-claimed');
          this._refreshButtonStatus(button, localServerURL, segmentIDString);
        } else if (detail.status && typeof detail.status === 'object') {
          // Full or PARTIAL CellStatus from annotation changes — merge with
          // the cached status so partial events (e.g. setCellComplete only
          // knows isComplete, not cellType) don't drop other fields.
          const cached = (button as any)._cellStatus || {};
          this._applyStatus(button, { ...cached, ...detail.status } as CellStatus);
        } else {
          // No status provided — re-fetch as fallback
          this._refreshButtonStatus(button, localServerURL, segmentIDString);
        }
      }
    });

    return button;
  }

  /** Apply a known status to the button pip + label badge (no fetch).
   *  States:
   *    - incomplete (gray): no type, not complete
   *    - annotated (green): cell type set but NOT complete
   *    - done-unlabeled (blue): complete but NO cell type
   *    - complete (purple): complete AND cell type set
   */
  private _applyStatus(button: HTMLButtonElement, status: CellStatus): void {
    (button as any)._cellStatus = status;
    this._paint(button, status);
  }

  /**
   * What a cell is SHOWN as: its status saved in the game, with the gaps
   * filled in from the lab's sheet (Ames 2026-10-12: "Lab sheet should FILL
   * IN the delta menu - like populate it with proofread, typed, done and
   * replace segID with class"). The game's own answer always wins.
   *
   * Drawn only. The saved status (_cellStatus, the menu's cachedStatus) is
   * never changed by the sheet, so nothing here is written to the game's
   * tables or counted for a player.
   */
  static shownStatus(status: CellStatus|null, sheet: LabSheetRow[]|null|undefined): CellStatus|null {
    const lab = labSheetSummary(sheet);
    if (!lab) return status;
    const fromSheet = !status?.cellType;
    return {
      ...(status ?? {isComplete: false}),
      isComplete: !!status?.isComplete || lab.proofread,
      cellType: status?.cellType || lab.cellType || undefined,
      classificationSystem: fromSheet ? (lab.cellClass || undefined) : status?.classificationSystem,
    };
  }

  /** Draw the pip and the label for a saved status (or none yet). */
  private _paint(button: HTMLButtonElement, saved: CellStatus|null): void {
    const status = ButtonService.shownStatus(saved, (button as any)._labSheet) ?? {isComplete: false};
    button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete', 'nge-lb-annotated', 'nge-lb-claimed');
    if (status.isComplete && status.cellType) {
      button.classList.add('nge-lb-complete');        // green: done (proofread AND typed)
    } else if (status.isComplete) {
      button.classList.add('nge-lb-done-unlabeled');  // blue: proofread but not typed
    } else if (status.cellType) {
      button.classList.add('nge-lb-annotated');        // yellow: typed but not proofread
    } else {
      button.classList.add('nge-lb-incomplete');        // gray: nothing set
    }
    // Check claim status
    const backend = useProofreadingBackendStore();
    const segId = button.dataset.segmentId || '';
    const claim = backend.isClaimedSegment(segId);
    if (claim.claimed) {
      button.classList.add('nge-lb-claimed');
    }
    const row = button.closest('.neuroglancer-segment-list-entry') as HTMLElement | null;
    if (row) this.updateLabelBadge(row, status);
  }

  /** Fetches the current cell status and updates the button's pip CSS class. */
  private async _refreshButtonStatus(
      button: HTMLButtonElement, localServerURL: string,
      segmentIDString: string): Promise<void> {
    try {
      const status = await getCellStatus(localServerURL, segmentIDString);
      if (status) {
        this._applyStatus(button, status);
      } else {
        this._paint(button, null);
      }
    } catch {
      this._paint(button, null);
    }
  }

  /**
   * Injects or updates the coloured label badge in the neuroglancer
   * segment-name cell for the given segment row.
   *
   * Call immediately after appending the button to the DOM (with status=null
   * to show a loading placeholder), and again once the status fetch resolves.
   */
  updateLabelBadge(row: HTMLElement, status: CellStatus|null): void {
    // Place badge directly after the segment ID (or nickname) for tight alignment,
    // rather than in the name column which floats far right.
    let badge = row.querySelector('.nge-label-badge') as HTMLElement|null;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nge-label-badge';
      // Insert as a direct child of the row (sibling to .sticky and the
      // lightbulb button) so it can flex-wrap onto its own row below the
      // segment ID, instead of squishing inline next to the chip.
      const sticky = row.querySelector('.neuroglancer-segment-list-entry-sticky');
      if (sticky && sticky.nextSibling) {
        row.insertBefore(badge, sticky.nextSibling);
      } else if (sticky) {
        row.appendChild(badge);
      } else {
        row.appendChild(badge);
      }
    }

    // A typed cell shows its LABEL in the ID chip instead of the long root id
    // (Ames 2026-09-29); the id stays in the tooltip and on the row's copy
    // button. CSS draws data-nge-label over the chip (ng-override.css).
    const idEl = row.querySelector('.neuroglancer-segment-list-entry-id') as HTMLElement|null;
    const label = cellLabel(status);
    if (idEl) {
      const segId = (idEl.textContent || '').trim();
      // The Seg panel's box finds cells by this name.
      inLabelScope();
      if (label) segmentLabels.set(segId, label); else segmentLabels.delete(segId);
      if (label) {
        idEl.dataset.ngeLabel = label;
        // Abbreviations written out (Ames: "hover tips to write out acronyms").
        const spelled = explainCellType(label);
        idEl.title = [label, ...spelled, '', `ID ${segId} (copy button on the left)`].join(String.fromCharCode(10));
        // Drawn under the label only with "Show the segment ID under a cell's
        // label" on (body.nge-seg-show-id, ng-override.css).
        badge.dataset.segId = segId;
      } else {
        delete badge.dataset.segId;
        delete idEl.dataset.ngeLabel;
        idEl.removeAttribute('title');
      }
    }
    const wasLabelled = row.classList.contains('nge-seg-labelled');
    row.classList.toggle('nge-seg-labelled', !!label);
    // With the segment ID shown under the label, a row that gains or loses
    // its label changes height: tell its virtual list (move_to_segment_patch.ts).
    if (wasLabelled !== !!label && document.body.classList.contains('nge-seg-show-id')) {
      for (let el = row.parentElement; el; el = el.parentElement) {
        const vl = (el as any).__nge_virtualList;
        if (vl) { vl.remeasureItem?.(row); break; }
      }
    }

    if (!status) {
      badge.className = 'nge-label-badge';
      badge.textContent = '';
      badge.title = '';
    } else if (label) {
      // The label now lives in the chip: no second badge row. The pip still
      // shows done (green) vs typed only (yellow).
      badge.className = 'nge-label-badge';
      badge.textContent = '';
      badge.title = '';
    } else {
      // No cell type — the pip color is sufficient, no text needed
      badge.className = 'nge-label-badge';
      badge.textContent = '';
      badge.title = status.isComplete ? 'Proofread' : '';
    }
  }

  /**
   * Generates a labelled section div for a ContextMenu.
   * Kept public for backward compatibility.
   */
  generateSection(
      title: string, buttons: InteracblesArray, menuOpt: InteracblesArray,
      contentCB?: Function, extraPadding?: boolean): HTMLDivElement {
    const section = document.createElement('div');
    section.classList.add('nge-lb-section');
    const sectionTitle = document.createElement('div');
    sectionTitle.classList.add('nge-lb-section-title');
    sectionTitle.innerText = title;
    section.appendChild(sectionTitle);

    if (contentCB) {
      const sectionContent = document.createElement('div');
      sectionContent.classList.add('nge-lb-section-content');
      sectionContent.innerText = contentCB() || '';
      if (sectionContent.innerText !== '') section.appendChild(sectionContent);
    }

    for (const [name, classNames, action] of buttons) {
      const sectionButton = document.createElement('button');
      sectionButton.classList.add('nge-lb-section-button');
      sectionButton.innerText = <string>name;
      sectionButton.className += ' ' + classNames;
      if (action) {
        if (typeof action === 'string') {
          sectionButton.addEventListener('click', () => window.open(action as string, '_blank'));
        } else {
          sectionButton.addEventListener('click', <any>action);
        }
      }
      section.appendChild(sectionButton);
      section.appendChild(br());
    }

    if (extraPadding) section.appendChild(br());

    for (const [name, model, action] of menuOpt) {
      const label = document.createElement('a');
      label.style.cssText = 'display:flex;flex-direction:row;white-space:nowrap;color:white;';
      label.textContent = `${name}`;
      label.href = `${model}`;
      label.target = '_blank';
      if (action) label.addEventListener('click', <any>action);
      section.appendChild(label);
    }

    return section;
  }

  makeMenu(
      parent: HTMLElement, localServerURL: string, segmentIDString: string,
      dataset: string): ContextMenu {
    const contextMenu = new ContextMenu(parent);
    const menu = contextMenu.element;
    menu.classList.add('neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    // ── Title bar ─────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'nge-lb-header';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'nge-lb-header-eyebrow';
    eyebrow.textContent = 'Cell Profile';
    const segIdLabel = document.createElement('div');
    segIdLabel.className = 'nge-lb-header-segid';
    segIdLabel.textContent = segmentIDString;
    segIdLabel.title = segmentIDString;
    header.appendChild(eyebrow);
    header.appendChild(segIdLabel);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'nge-lb-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close the Cell Profile';
    closeBtn.setAttribute('aria-label', 'Close the Cell Profile');
    closeBtn.addEventListener('click', () => contextMenu.hide());
    header.appendChild(closeBtn);
    menu.appendChild(header);

    // ── Out of date ID ────────────────────────────────────────────────────
    // Shown only when the graph says this ID has been replaced by an edit.
    // An error state, but a calm one: what is wrong, what the cell is now,
    // and one button that puts it right (Ames 2026-10-10: "it should still
    // be an elegant and satisfying error state").
    const stale = document.createElement('div');
    stale.className = 'nge-lb-stale';
    stale.setAttribute('role', 'status');
    stale.hidden = true;
    const shortId = (id: string) => (id.length > 9 ? '…' + id.slice(-7) : id);
    stale.innerHTML =
        '<div class="nge-lb-stale-head"><span class="nge-lb-stale-mark" aria-hidden="true"></span>' +
        '<span class="nge-lb-stale-eyebrow">ID out of date</span></div>' +
        '<div class="nge-lb-stale-text">This cell has been edited since, so it has a new ID.</div>' +
        '<div class="nge-lb-stale-swap"><span class="nge-lb-stale-old"></span>' +
        '<span class="nge-lb-stale-arrow" aria-hidden="true">→</span>' +
        '<span class="nge-lb-stale-new">looking it up…</span></div>';
    const staleText = stale.querySelector('.nge-lb-stale-text') as HTMLElement;
    const staleOld = stale.querySelector('.nge-lb-stale-old') as HTMLElement;
    const staleNew = stale.querySelector('.nge-lb-stale-new') as HTMLElement;
    staleOld.textContent = shortId(segmentIDString);
    staleOld.title = segmentIDString;
    const staleBtn = document.createElement('button');
    staleBtn.className = 'nge-lb-stale-btn';
    staleBtn.textContent = 'Update to the current ID';
    stale.appendChild(staleBtn);
    const showCurrent = (ends: string[] | null) => {
      if (!ends) { staleNew.textContent = 'not found yet'; return; }
      staleNew.textContent = ends.length === 1 ? shortId(ends[0]) : `${ends.length} pieces`;
      staleNew.title = ends.join(', ');
      staleNew.classList.add('nge-lb-stale-new--known');
      if (ends.length > 1) staleBtn.textContent = `Show all ${ends.length} pieces`;
    };
    staleBtn.addEventListener('click', async () => {
      staleBtn.disabled = true;
      stale.classList.add('nge-lb-stale--working');
      const now = await updateToCurrentId(segmentIDString).catch(() => null);
      stale.classList.remove('nge-lb-stale--working');
      if (!now) {
        staleBtn.disabled = false;
        staleText.textContent = 'Could not find the current ID just now. Try again in a moment.';
        return;
      }
      // Put right: say so for a moment, then the old row and this menu go.
      stale.classList.add('nge-lb-stale--done');
      stale.querySelector('.nge-lb-stale-eyebrow')!.textContent = 'Up to date';
      staleText.textContent = now.length === 1 ? 'Now showing the current ID.' : `Now showing all ${now.length} pieces.`;
      staleBtn.hidden = true;
      setTimeout(() => contextMenu.hide(), 900);
    });
    menu.appendChild(stale);
    void isCurrentId(segmentIDString).then(current => {
      if (current !== false) return;
      stale.hidden = false;
      void currentIdsOf(segmentIDString).then(showCurrent);
    });

    let cachedStatus: CellStatus|null = (parent as any)._cellStatus ?? null;
    // What the lab's sheet says, for the lines below. Shown, never saved:
    // cachedStatus stays the game's own answer, and every button acts on that.
    let lab = labSheetSummary((parent as any)._labSheet);
    const progressText = () => cachedStatus?.isComplete ? '✓ Proofread'
        : lab?.proofread ? "✓ Proofread, from the lab's sheet" : '○ In Progress';
    // The title reads as the row does: class and type in place of the ID
    // (which stays in the tooltip and on the row's copy button).
    const showTitle = () => {
      const st = ButtonService.shownStatus(cachedStatus, (parent as any)._labSheet);
      const label = st?.cellType
        ? (st.classificationSystem ? `${st.classificationSystem} - ${st.cellType}` : st.cellType)
        : (st?.classificationSystem || '');
      segIdLabel.textContent = label || segmentIDString;
      segIdLabel.title = label ? `${label}. ID ${segmentIDString}` : segmentIDString;
      segIdLabel.classList.toggle('nge-lb-header-label', !!label);
    };
    showTitle();
    // A cell the lab has completed is not offered for proofreading in the
    // game (Ames 2026-10-12: "if lab completed, it should not be offered for
    // proofreading in the game"): no Mark as Proofread and no Claim. A cell
    // already completed in Pyr keeps its Unmark, and a claim someone already
    // holds keeps its Release. Filled in at the end, once the buttons exist.
    const labDone = () => !!lab?.proofread && !cachedStatus?.isComplete;
    let showLabDone = () => {};

    // ── Section 1: Completion Status ──────────────────────────────────────
    const completionSection = document.createElement('div');
    completionSection.classList.add('nge-lb-section');

    const completionTitle = document.createElement('div');
    completionTitle.classList.add('nge-lb-section-title');
    completionTitle.textContent = 'Completion Status';
    completionSection.appendChild(completionTitle);

    const statusLine = document.createElement('div');
    statusLine.classList.add('nge-lb-status-line');
    statusLine.textContent = cachedStatus ? progressText() : '… Loading';
    completionSection.appendChild(statusLine);
    // The menu used to show only a status fetched earlier for the pip, so if
    // that fetch had not finished (or found nothing) it said Loading forever.
    // Fetch it here too and fill in whatever the menu shows.
    if (!cachedStatus) {
      if (!localServerURL) {
        statusLine.textContent = 'Status not available for this dataset';
      } else {
        getCellStatus(localServerURL, segmentIDString).then(st => {
          if (!statusLine.isConnected) return;
          cachedStatus = st;
          if (st) {
            (parent as any)._cellStatus = st;
            this._applyStatus(parent as HTMLButtonElement, st);
          }
          statusLine.textContent = progressText();
          if (!toggleBtn.disabled) toggleBtn.textContent = st?.isComplete ? 'Unmark Proofread' : 'Mark as Proofread';
          if (st?.cellType && !select.value) select.value = st.cellType;
          if (typeLine) typeLine.textContent = st?.cellType || 'No type yet';
          showLabType();
          showTitle();
          showLabDone();
        }).catch(() => {
          if (statusLine.isConnected) statusLine.textContent = 'Could not load status. Reopen to retry.';
        });
      }
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.classList.add('nge-lb-section-button', 'nge-lb-toggle-btn');
    toggleBtn.textContent = cachedStatus?.isComplete ? 'Unmark Proofread' : 'Mark as Proofread';
    // Datasets whose own tables players cannot write (BANC): show, never save.
    const roCfg = getDatasetCaveConfig(currentSegLayerName());
    if (roCfg.cellStatusReadOnly) {
      toggleBtn.disabled = true;
      toggleBtn.style.display = 'none';
      const note = document.createElement('div');
      note.classList.add('nge-lb-readonly-note');
      note.textContent = roCfg.cellStatusTable
        ? `Shown from ${roCfg.cellStatusTable}. Marking cells here is not open to players yet.`
        : 'This dataset has no proofread list yet, so there is nothing to mark here.';
      completionSection.appendChild(note);
    }
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      toggleBtn.textContent = 'Saving…';
      const willBeComplete = !(cachedStatus?.isComplete ?? false);
      if (willBeComplete && labDone()) { toggleBtn.disabled = false; toggleBtn.textContent = 'Mark as Proofread'; showLabDone(); return; }
      // The Delta menu is where cells get completed (Amy 2026-09-28): a Cell
      // Library sheet cell is also claimed, completed and written to the sheet.
      // Plan first, so a cell someone else holds stops before CAVE is written.
      const plan = willBeComplete ? await planMenuCompletion(segmentIDString) : null;
      if (plan?.blocked) {
        statusLine.textContent = plan.blocked;
        toggleBtn.textContent = 'Mark as Proofread';
        toggleBtn.disabled = false;
        return;
      }
      // A Cell Library cell: ask how it ended and for notes, as the Cell
      // Library's own form does, before anything is written (annkri
      // 2026-10-06). Cancel leaves the cell untouched.
      let details: CompletionDetails = {};
      if (plan && needsCompletionDetails(plan)) {
        const asked = await askCompletionDetails(plan.dataset, plan.row?.index || '');
        if (!asked) {
          toggleBtn.textContent = 'Mark as Proofread';
          toggleBtn.disabled = false;
          return;
        }
        details = asked;
      }
      // plan.cellRoot: opened on a MEC nucleus, so the cell around it is marked.
      const ok = await setCellComplete(
          localServerURL, plan?.cellRoot ?? segmentIDString, willBeComplete, plan?.cellRoot ? undefined : cachedStatus?.annotationId,
          undefined, undefined, plan?.cellRoot ? [segmentIDString] : []);
      if (ok) {
        if (cachedStatus) cachedStatus.isComplete = willBeComplete;
        statusLine.textContent = willBeComplete ? '✓ Proofread' : progressText();
        toggleBtn.textContent = willBeComplete ? 'Unmark Proofread' : 'Mark as Proofread';
        this._refreshButtonStatus(parent as HTMLButtonElement, localServerURL, segmentIDString);

        if (!willBeComplete) {
          // Your own completed Cell Library cell: it becomes your claim again.
          const note = await reopenAfterUnmark(segmentIDString).catch(() => '');
          if (note) {
            statusLine.textContent = '○ In Progress. ' + note;
            document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: segmentIDString, status: 'reopened' } }));
          }
        }
        if (plan?.row) {
          statusLine.textContent = '✓ Proofread. Writing to the sheet…';
          try {
            statusLine.textContent = '✓ Proofread. ' + await finishMenuCompletion(plan, details);
          } catch (e: any) {
            statusLine.textContent = '✓ Proofread. ' + (e?.message || 'The sheet could not be updated.');
          }
          document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: segmentIDString, status: 'completed' } }));
        } else if (willBeComplete) {
          // Not a sheet cell: a claim on it is released, as before.
          const backend = useProofreadingBackendStore();
          const claimInfo = backend.isClaimedSegment(segmentIDString);
          if (claimInfo.claimed && claimInfo.byMe) {
            await backend.releaseBySegment(segmentIDString);
            parent.classList.remove('nge-lb-claimed');
            this._resetSegmentColor(segmentIDString);
            document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: segmentIDString, status: 'released' } }));
          }
        }
      } else if (getLastCompletionProblem()) {
        // Refused before saving (crosshairs not in the cell): say why.
        statusLine.textContent = getLastCompletionProblem();
        toggleBtn.textContent = 'Mark as Proofread';
      } else {
        toggleBtn.textContent = !localServerURL ? 'No CAVE server configured' : 'Error, try again';
      }
      toggleBtn.disabled = false;
      showLabDone();
    });
    completionSection.appendChild(toggleBtn);
    const labDoneNote = document.createElement('div');
    labDoneNote.classList.add('nge-lb-readonly-note');
    labDoneNote.textContent = 'The lab has already proofread this cell, so there is nothing to mark here.';
    labDoneNote.hidden = true;
    completionSection.appendChild(labDoneNote);

    // ── Section 2: Cell Type ──────────────────────────────────────────────
    const cellTypeSection = document.createElement('div');
    cellTypeSection.classList.add('nge-lb-section');

    const cellTypeTitle = document.createElement('div');
    cellTypeTitle.classList.add('nge-lb-section-title');
    cellTypeTitle.textContent = 'Cell Type';
    cellTypeSection.appendChild(cellTypeTitle);

    // Preset dropdown
    const select = document.createElement('select');
    select.classList.add('nge-lb-select');
    // Prevent Neuroglancer from stealing keystrokes when interacting with the select
    const stopKeys = (e: Event) => e.stopPropagation();
    select.addEventListener('keydown', stopKeys);
    select.addEventListener('keyup', stopKeys);
    select.addEventListener('keypress', stopKeys);

    const blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '— select type —';
    select.appendChild(blankOpt);

    for (const ct of currentCellTypes()) {
      const opt = document.createElement('option');
      opt.value = ct;
      opt.textContent = ct;
      { const spelled = explainCellType(ct); if (spelled.length) opt.title = spelled.join(String.fromCharCode(10)); }
      if (cachedStatus?.cellType === ct) opt.selected = true;
      select.appendChild(opt);
    }
    cellTypeSection.appendChild(select);
    const labTypeLine = document.createElement('div');
    labTypeLine.classList.add('nge-lb-status-line', 'nge-lb-lab-type');
    labTypeLine.hidden = true;
    cellTypeSection.insertBefore(labTypeLine, select);
    const showLabType = () => {
      const text = lab && !cachedStatus?.cellType
        ? (lab.cellType ? (lab.cellClass ? `${lab.cellClass} - ${lab.cellType}` : lab.cellType) : lab.cellClass) : '';
      labTypeLine.textContent = text ? `${text}, from the lab's sheet` : '';
      labTypeLine.hidden = !text;
    };
    showLabType();
    let typeLine: HTMLDivElement | null = null;
    if (roCfg.cellTypeReadOnly) {
      select.style.display = 'none';
      typeLine = document.createElement('div');
      typeLine.classList.add('nge-lb-status-line');
      typeLine.textContent = cachedStatus ? (cachedStatus.cellType || 'No type yet') : '… Loading';
      cellTypeSection.appendChild(typeLine);
      const note = document.createElement('div');
      note.classList.add('nge-lb-readonly-note');
      note.textContent = `From ${roCfg.cellTypeTable}, read only here.`;
      cellTypeSection.appendChild(note);
    }

    // Free-text input for unlisted types
    const freeText = document.createElement('input');
    freeText.type = 'text';
    freeText.placeholder = 'Or type custom…';
    freeText.classList.add('nge-lb-text-input');
    freeText.addEventListener('keydown', stopKeys);
    freeText.addEventListener('keyup', stopKeys);
    freeText.addEventListener('keypress', stopKeys);
    freeText.addEventListener('input', () => {
      if (freeText.value.trim()) select.value = '';
    });
    cellTypeSection.appendChild(freeText);

    // Why a type was not saved (crosshairs outside the cell), above the button.
    const typeNote = document.createElement('div');
    typeNote.classList.add('nge-lb-status-line', 'nge-lb-type-note');
    typeNote.style.display = 'none';
    const saveTypeBtn = document.createElement('button');
    saveTypeBtn.classList.add('nge-lb-section-button', 'nge-lb-save-btn');
    saveTypeBtn.textContent = 'Save Cell Type';
    saveTypeBtn.addEventListener('click', async () => {
      const cellType = (freeText.value.trim() || select.value).trim();
      if (!cellType) return;
      saveTypeBtn.disabled = true;
      saveTypeBtn.textContent = 'Saving…';
      const ok = await saveCellType(
          localServerURL, segmentIDString, cellType, cachedStatus?.cellTypeAnnotationId);
      const typeProblem = ok ? '' : getLastCellTypeProblem();
      saveTypeBtn.textContent = ok ? 'Saved ✓' : typeProblem ? 'Save Cell Type' :
          (!localServerURL ? 'No CAVE server configured' : 'Error, try again');
      typeNote.textContent = typeProblem;
      typeNote.style.display = typeProblem ? '' : 'none';
      saveTypeBtn.disabled = false;
      if (ok && cachedStatus) {
        cachedStatus.cellType = cellType;
        showLabType();
        showTitle();
        // Update pip/badge in the sidebar row
        this._applyStatus(parent as HTMLButtonElement, cachedStatus);
        // Notify AnnotationPanel and other listeners
        document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
          detail: { segId: segmentIDString, status: cachedStatus },
        }));
      }
    });
    cellTypeSection.appendChild(typeNote);
    cellTypeSection.appendChild(saveTypeBtn);
    if (roCfg.cellTypeReadOnly) { freeText.style.display = 'none'; saveTypeBtn.style.display = 'none'; }

    // ── From the lab's sheet (Retina) ────────────────────────────────────
    // What the lab's own sheet says about this cell (src/util/lab_sheet.ts),
    // in full. Shown, never saved: it does not touch cachedStatus or anything
    // a player's numbers are counted from. Hidden unless the sheet has a row
    // for this cell. Sheet text goes in as textContent.
    const sheetSection = document.createElement('div');
    sheetSection.classList.add('nge-lb-section', 'nge-lb-sheet');
    sheetSection.hidden = true;
    const sheetTitle = document.createElement('div');
    sheetTitle.classList.add('nge-lb-section-title');
    sheetTitle.textContent = "From the lab's sheet";
    sheetSection.appendChild(sheetTitle);
    void labSheetRowsFor(segmentIDString).then(rows => {
      const shown = rows.map(r => ({r, lines: labSheetLines(r)})).filter(x => x.lines.length);
      if (!shown.length) return;
      lab = labSheetSummary(rows);
      if (cachedStatus || lab?.proofread) statusLine.textContent = progressText();
      showLabType();
      if (!(parent as any)._labSheet) {
        (parent as any)._labSheet = rows;
        this._paint(parent as HTMLButtonElement, (parent as any)._cellStatus ?? null);
      }
      showTitle();
      showLabDone();
      for (const {r, lines} of shown) {
        const card = document.createElement('div');
        card.classList.add('nge-lb-sheet-row');
        for (const [label, value] of lines) {
          const line = document.createElement('div');
          line.classList.add('nge-lb-sheet-line');
          const k = document.createElement('span');
          k.classList.add('nge-lb-sheet-key');
          k.textContent = label;
          const v = document.createElement('span');
          v.classList.add('nge-lb-sheet-value');
          v.textContent = value;
          v.title = value;
          line.append(k, v);
          card.appendChild(line);
        }
        if (shown.length > 1) {
          const which = document.createElement('div');
          which.classList.add('nge-lb-sheet-which');
          which.textContent = `Row ${r.sheet_index}`;
          card.prepend(which);
        }
        sheetSection.appendChild(card);
      }
      const note = document.createElement('div');
      note.classList.add('nge-lb-readonly-note');
      note.textContent = (shown.length > 1
          ? `This cell has ${shown.length} rows in the lab's retina sheet. `
          : `Row ${shown[0].r.sheet_index} of the lab's retina sheet. `) +
          'It fills in the lines above where nothing is saved in Pyr yet, and does not count toward your stats.';
      sheetSection.appendChild(note);
      sheetSection.hidden = false;
    }).catch(() => { /* nothing to show */ });

    // ── Section 3: Segment Color ─────────────────────────────────────────
    const colorSection = document.createElement('div');
    colorSection.classList.add('nge-lb-section');

    const colorTitle = document.createElement('div');
    colorTitle.classList.add('nge-lb-section-title');
    colorTitle.textContent = 'Segment Color';
    colorSection.appendChild(colorTitle);

    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';

    // Preset color swatches
    const PRESET_COLORS: [string, number, number, number][] = [
      ['#ff4444', 1, 0.27, 0.27],   // red
      ['#ff8800', 1, 0.53, 0],       // orange
      ['#ffdd00', 1, 0.87, 0],       // yellow
      ['#7cffb2', 0.49, 1, 0.70],   // green: Highlight mode's (Ames 2026-10-14: the old one was too neon)
      ['#00ddff', 0, 0.87, 1],       // cyan
      ['#4488ff', 0.27, 0.53, 1],   // blue
      ['#aa44ff', 0.67, 0.27, 1],   // purple
      ['#ff44aa', 1, 0.27, 0.67],   // pink
      ['#ffffff', 1, 1, 1],          // white
    ];

    for (const [hex, r, g, b] of PRESET_COLORS) {
      const swatch = document.createElement('button');
      swatch.className = 'nge-color-swatch';
      swatch.style.cssText = `background:${hex};width:22px;height:22px;border-radius:4px;border:2px solid rgba(255,255,255,0.2);cursor:pointer;padding:0;`;
      swatch.title = hex;
      swatch.addEventListener('click', () => {
        this._setSegmentColor(segmentIDString, r, g, b);
        colorRow.querySelectorAll('.nge-color-swatch').forEach(s =>
          (s as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)');
        swatch.style.borderColor = '#fff';
      });
      colorRow.appendChild(swatch);
    }

    // Custom color input
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = '#7cffb2';
    colorInput.className = 'nge-color-picker-rainbow';
    colorInput.title = 'Custom color';
    colorInput.addEventListener('input', () => {
      const hex = colorInput.value;
      const ri = parseInt(hex.slice(1, 3), 16) / 255;
      const gi = parseInt(hex.slice(3, 5), 16) / 255;
      const bi = parseInt(hex.slice(5, 7), 16) / 255;
      this._setSegmentColor(segmentIDString, ri, gi, bi);
    });
    colorRow.appendChild(colorInput);

    colorSection.appendChild(colorRow);

    // Reset button
    const resetColorBtn = document.createElement('button');
    resetColorBtn.classList.add('nge-lb-section-button');
    resetColorBtn.textContent = 'Reset to Default';
    resetColorBtn.style.cssText = 'margin-top:6px;font-size:11px;color:#888;';
    resetColorBtn.addEventListener('click', () => {
      this._resetSegmentColor(segmentIDString);
      colorRow.querySelectorAll('.nge-color-swatch').forEach(s =>
        (s as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)');
    });
    colorSection.appendChild(resetColorBtn);

    // ── Section 4: Claim Cell ────────────────────────────────────────────
    const claimSection = document.createElement('div');
    claimSection.classList.add('nge-lb-section');

    const claimTitle = document.createElement('div');
    claimTitle.classList.add('nge-lb-section-title');
    claimTitle.textContent = 'Claim Cell';
    claimSection.appendChild(claimTitle);

    const backend = useProofreadingBackendStore();
    const claimInfo = backend.isClaimedSegment(segmentIDString);

    const claimStatus = document.createElement('div');
    claimStatus.classList.add('nge-lb-status-line');
    if (claimInfo.claimed) {
      claimStatus.textContent = claimInfo.byMe ? '🔒 Claimed by you' : '🔒 Claimed by another player';
    } else {
      const remaining = backend.claimLimitFor() - backend.myActiveClaimCount();
      claimStatus.textContent = backend.userId
        ? `Available · ${remaining} claim${remaining !== 1 ? 's' : ''} left`
        : 'Log in to claim cells';
    }
    claimSection.appendChild(claimStatus);
    let claimOpenText = claimStatus.textContent;
    let claimBtnEl: HTMLButtonElement | null = null;
    // The count above comes from the claims the game has in hand, which
    // leaves out ones made through the Cell Library and ones on another
    // dataset: with all ten held it still said "10 claims left" (Nseraf
    // 2026-10-12, report 120). The server knows them all, so ask it and put
    // the line right. Never fewer held than the game already knows of.
    if (backend.userId && !claimInfo.claimed) {
      void backend.loadMyActiveClaims().then(held => {
        const limit = backend.claimLimitFor();
        const count = Math.max(held.length, backend.myActiveClaimCount());
        const remaining = Math.max(0, limit - count);
        const line = `Available · ${remaining} of ${limit} claim${limit !== 1 ? 's' : ''} left`;
        if (claimStatus.textContent === claimOpenText) claimStatus.textContent = line;
        claimOpenText = line;
        if (claimBtnEl && count >= limit && !claimBtnEl.disabled) {
          claimBtnEl.disabled = true;
          claimBtnEl.textContent = `Max ${limit} claims reached`;
        }
      }).catch(() => { /* the first count stays */ });
    }

    if (backend.userId) {
      if (!claimInfo.claimed) {
        // Claim button
        const claimBtn = document.createElement('button');
        claimBtnEl = claimBtn;
        claimBtn.classList.add('nge-lb-section-button', 'nge-lb-claim-btn');
        claimBtn.textContent = '🔒 Claim Cell';
        if (backend.myActiveClaimCount() >= backend.claimLimitFor()) {
          claimBtn.disabled = true;
          claimBtn.textContent = `Max ${backend.claimLimitFor()} claims reached`;
        }
        claimBtn.addEventListener('click', async () => {
          claimBtn.disabled = true;
          claimBtn.textContent = 'Claiming…';
          // Capture viewer position as the spatial claim anchor
          const viewer = (window as any)['viewer'];
          const vp = viewer?.navigationState?.position?.value;
          const claimPoint: ClaimPoint = vp
            ? [Math.round(vp[0]), Math.round(vp[1]), Math.round(vp[2])]
            : [0, 0, 0];
          // The selected supervoxel is whatever the mouse last pointed at,
          // which can be a neighbouring cell. It becomes the claim's anchor
          // for good, so keep it only when it is this cell (annkri, report
          // 150); otherwise the claim is anchored later, at its soma.
          const selected = getSelectedSupervoxelId();
          const supervoxelId = selected && await getRootFromSupervoxel(selected).catch(() => null) === segmentIDString ? selected : null;
          const result = await backend.claimCell(claimPoint, segmentIDString, supervoxelId || undefined);
          if (result.ok) {
            claimBtn.textContent = '✓ Claimed!';
            claimBtn.style.color = '#fa4';
            claimStatus.textContent = '🔒 Claimed by you';
            // The cell keeps its own colour: claiming used to repaint it gold
            // (#FFD700), which hid which cell was which (Ames 2026-09-30).
            // Immediately update pip so it reflects claimed state without waiting for CAVE
            parent.classList.add('nge-lb-claimed');
            // Notify other UI (e.g. Brain Quest panel) about the status change
            document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: segmentIDString, status: 'claimed' } }));
            // A Cell Library cell: open its Start link too, so its annotation
            // layers (Soma, True End, Can't Fix...) load, as claiming from the
            // library does. Also mark it as the claim being worked on, so the
            // library saves this view when you switch to another claim.
            void (async () => {
              const link = await startLinkForSegment(segmentIDString);
              if (!link) return;
              try {
                await backend.loadTasks();
                const mine = backend.tasks.find(t => t.assigned_to === backend.userId
                  && (t.status === 'assigned' || t.status === 'in_progress')
                  && (t.segment_id === segmentIDString || link === (t as any).start_link));
                if (mine) localStorage.setItem('nge_cl_working_task', String(mine.id));
              } catch { /* the view still opens */ }
              openStartLink(link);
            })();
          } else {
            claimBtn.textContent = result.reason || 'Claim failed';
            claimBtn.disabled = false;
          }
        });
        claimSection.appendChild(claimBtn);
      } else if (claimInfo.byMe) {
        // Release button
        const releaseBtn = document.createElement('button');
        releaseBtn.classList.add('nge-lb-section-button', 'nge-lb-release-btn');
        releaseBtn.textContent = 'Release Claim';
        releaseBtn.addEventListener('click', async () => {
          releaseBtn.disabled = true;
          releaseBtn.textContent = 'Releasing…';
          await backend.releaseBySegment(segmentIDString);
          releaseBtn.textContent = '✓ Released';
          claimStatus.textContent = 'Available';
          this._resetSegmentColor(segmentIDString);
          parent.classList.remove('nge-lb-claimed');
          document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: segmentIDString, status: 'released' } }));
        });
        claimSection.appendChild(releaseBtn);
      }
    }

    // ── Section 5: Ask for Help ───────────────────────────────────────────
    const helpSection = document.createElement('div');
    helpSection.classList.add('nge-lb-section');

    const helpTitle = document.createElement('div');
    helpTitle.classList.add('nge-lb-section-title');
    helpTitle.textContent = 'Second Opinion';
    helpSection.appendChild(helpTitle);

    // Issue type chips
    const issueTypes = ['Extension', 'Merge', 'Black Spill', 'Doublecheck'];
    let selectedIssue = '';

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;';

    for (const issue of issueTypes) {
      const chip = document.createElement('button');
      chip.className = 'nge-lb-chip';
      chip.textContent = issue;
      chip.addEventListener('click', () => {
        chipRow.querySelectorAll('.nge-lb-chip').forEach(c =>
          c.classList.remove('nge-lb-chip--active'));
        chip.classList.add('nge-lb-chip--active');
        selectedIssue = issue;
      });
      chipRow.appendChild(chip);
    }
    helpSection.appendChild(chipRow);

    // Note input
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Optional note…';
    noteInput.classList.add('nge-lb-text-input');
    const stopK = (e: Event) => e.stopPropagation();
    noteInput.addEventListener('keydown', stopK);
    noteInput.addEventListener('keyup', stopK);
    noteInput.addEventListener('keypress', stopK);
    helpSection.appendChild(noteInput);

    // Which annotation layers hold the marks: all of them unless unticked, in
    // one dropdown, the same as the Cell Library's help form (Ames 2026-10-07).
    const annotationLayerNames = (): string[] => {
      try {
        return ((window as any)['viewer']?.layerManager?.managedLayers ?? [])
          .filter((l: any) => l.layer?.type === 'annotation' && !l.archived).map((l: any) => String(l.name));
      } catch { return []; }
    };
    let allLayers = true;
    const pickedLayers = new Set<string>();
    const layerOn = (name: string) => allLayers || pickedLayers.has(name);
    const layerSummary = (): string => {
      const have = annotationLayerNames();
      if (allLayers) return have.length === 1 ? 'Annotation layer: ' + have[0] : `All ${have.length} annotation layers`;
      const picked = have.filter(n => pickedLayers.has(n));
      if (!picked.length) return 'No annotation layers';
      return picked.length === 1 ? 'Annotation layer: ' + picked[0] : `${picked.length} of ${have.length} annotation layers`;
    };
    const pickedLayerText = (): string => {
      const have = annotationLayerNames();
      if (allLayers) return have.length > 1 ? 'All annotation layers' : (have[0] || '');
      return have.filter(n => pickedLayers.has(n)).join(', ');
    };
    if (annotationLayerNames().length > 0) {
      const wrap = document.createElement('div');
      wrap.classList.add('nge-lb-layers');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.classList.add('nge-lb-layers-toggle');
      toggle.title = 'Choose which annotation layers to point the helper at';
      toggle.setAttribute('aria-haspopup', 'true');
      const list = document.createElement('div');
      list.classList.add('nge-lb-layers-menu');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Annotation layers to point the helper at');
      list.hidden = true;
      const draw = () => {
        toggle.textContent = '';
        const label = document.createElement('span');
        label.classList.add('nge-lb-layers-summary');
        label.textContent = '📐 ' + layerSummary();
        const caret = document.createElement('span');
        caret.textContent = '▾';
        caret.setAttribute('aria-hidden', 'true');
        toggle.append(label, caret);
        toggle.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
        list.textContent = '';
        const row = (text: string, on: boolean, change: () => void, bold = false) => {
          const item = document.createElement('label');
          item.classList.add('nge-lb-layers-item');
          if (bold) item.classList.add('nge-lb-layers-item--all');
          item.title = text;
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = on;
          box.addEventListener('change', () => { change(); draw(); });
          const name = document.createElement('span');
          name.textContent = text;
          item.append(box, name);
          list.appendChild(item);
        };
        const have = annotationLayerNames();
        row('All annotation layers', allLayers, () => { allLayers = !allLayers; pickedLayers.clear(); }, true);
        for (const name of have) {
          row(name, layerOn(name), () => {
            // Leaving "all": start from every layer ticked, then change this one.
            const picked = new Set(allLayers ? have : have.filter(n => pickedLayers.has(n)));
            if (picked.has(name)) picked.delete(name); else picked.add(name);
            allLayers = have.length > 0 && have.every(n => picked.has(n));
            pickedLayers.clear();
            if (!allLayers) for (const n of picked) pickedLayers.add(n);
          });
        }
      };
      toggle.addEventListener('click', e => { e.stopPropagation(); list.hidden = !list.hidden; draw(); });
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); list.hidden = true; draw(); toggle.focus(); } });
      wrap.append(toggle, list);
      draw();
      helpSection.appendChild(wrap);
    }

    const helpBtn = document.createElement('button');
    helpBtn.classList.add('nge-lb-section-button', 'nge-lb-help-btn');
    helpBtn.textContent = '🔍 Ask for Help';
    helpBtn.addEventListener('click', () => {
      const helpStore = useHelpRequestStore();
      // Get viewer position if available
      let pos: [number, number, number] = [0, 0, 0];
      try {
        const viewer = (window as any)['viewer'];
        if (viewer?.navigationState?.position) {
          const p = viewer.navigationState.position.value;
          pos = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
        }
      } catch {}
      helpStore.add({
        segId: segmentIDString,
        position: pos,
        note: noteInput.value.trim(),
        issueType: selectedIssue || 'Doublecheck',
        cellType: cachedStatus?.cellType,
        dataset,
        annotationLayer: pickedLayerText() || undefined,
      });
      helpBtn.textContent = '✓ Help Requested';
      helpBtn.disabled = true;
      helpBtn.style.color = '#7f8';
      helpBtn.style.borderColor = 'rgba(127,255,136,0.3)';
    });
    helpSection.appendChild(helpBtn);

    showLabDone = () => {
      if (roCfg.cellStatusReadOnly) return;   // nothing is offered there anyway
      const off = labDone();
      // The menu's stylesheet sets display with !important, so a plain
      // style.display = 'none' would leave the button showing.
      const hide = (el: HTMLElement) => off ? el.style.setProperty('display', 'none', 'important') : el.style.removeProperty('display');
      hide(toggleBtn);
      labDoneNote.hidden = !off;
      // Only an unclaimed cell: a claim already held keeps its line and Release.
      if (!backend.isClaimedSegment(segmentIDString).claimed) {
        if (claimBtnEl) hide(claimBtnEl);
        claimStatus.textContent = off ? 'Proofread by the lab, so there is nothing to claim.' : claimOpenText;
      }
    };
    showLabDone();

    if (roCfg.exploreOnly) {
      // Published files, no CAVE: nothing to proofread, label, claim or ask
      // about here. Say so, and keep the one thing that works: colour.
      const exploreSection = document.createElement('div');
      exploreSection.classList.add('nge-lb-section');
      const exploreTitle = document.createElement('div');
      exploreTitle.classList.add('nge-lb-section-title');
      exploreTitle.textContent = 'Explore only';
      const exploreNote = document.createElement('div');
      exploreNote.classList.add('nge-lb-readonly-note');
      exploreNote.textContent = 'This dataset is here to look around. There is nothing to proofread, label or claim in it.';
      exploreSection.append(exploreTitle, exploreNote);
      menu.append(br(), exploreSection, br(), colorSection, br());
    } else {
      menu.append(br(), completionSection, br(), cellTypeSection, br(), sheetSection, colorSection, br(), claimSection, br(), helpSection, br());
    }
    return contextMenu;
  }

  /** Set a custom color for a segment via neuroglancer's segmentStatedColors map. */
  private _setSegmentColor(segIdStr: string, r: number, g: number, b: number): void {
    try {
      const viewer: any = (window as any)['viewer'];
      if (!viewer) return;
      const segLayer = viewer.layerManager.managedLayers.find(
        (x: any) => x.layer instanceof SegmentationUserLayer,
      );
      if (!segLayer?.layer) return;
      const colorGroupState = (segLayer.layer as SegmentationUserLayer)
        .displayState.segmentationColorGroupState.value;
      const segmentStatedColors = colorGroupState.segmentStatedColors;
      const segId = Uint64.parseString(segIdStr);
      // Pack RGB into 24-bit integer (neuroglancer format: 0xBBGGRR)
      const packed = (Math.round(r * 255)) |
                     (Math.round(g * 255) << 8) |
                     (Math.round(b * 255) << 16);
      setStatedColor(segmentStatedColors, segId, packed);
    } catch (e) {
      console.warn('[buttonService] Failed to set segment color:', e);
    }
  }

  /** Reset a segment's color back to the default hash-based color. */
  private _resetSegmentColor(segIdStr: string): void {
    try {
      const viewer: any = (window as any)['viewer'];
      if (!viewer) return;
      const segLayer = viewer.layerManager.managedLayers.find(
        (x: any) => x.layer instanceof SegmentationUserLayer,
      );
      if (!segLayer?.layer) return;
      const colorGroupState = (segLayer.layer as SegmentationUserLayer)
        .displayState.segmentationColorGroupState.value;
      const segId = Uint64.parseString(segIdStr);
      colorGroupState.segmentStatedColors.delete(segId);
    } catch (e) {
      console.warn('[buttonService] Failed to reset segment color:', e);
    }
  }

  /**
   * Creates a "jump to segment" button (↗ icon, matching CellLibraryPanel).
   * On click, computes the segment's mesh-bbox centroid and centers the view
   * on it, then briefly blooms the segment so the user can identify which
   * one they jumped to when many are visible.
   */
  createJumpButton(segmentIDString: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'nge-segment-button nge-jump-btn';
    btn.title = 'Jump to segment';
    btn.dataset.segmentId = segmentIDString;
    btn.textContent = '↗'; // ↗
    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      this._jumpToSegment(segmentIDString);
    });
    return btn;
  }

  /** Center the viewer on a segment's mesh-bbox centroid + bloom it. */
  private _jumpToSegment(segIdStr: string): void {
    try {
      const viewer: any = (window as any)['viewer'];
      if (!viewer) return;
      const segLayer: any = viewer.layerManager.managedLayers.find(
        (x: any) => x.layer instanceof SegmentationUserLayer,
      )?.layer;
      if (!segLayer) return;

      const segId = Uint64.parseString(segIdStr);

      // A hidden cell has no mesh loaded, so there is nowhere to go yet and
      // the jump only said "No position information loaded" (Ames
      // 2026-10-14). Show it, wait for its mesh, then go.
      const positionNow = () => {
        for (const layer of (segLayer.renderLayers || []) as any[]) {
          const pos = layer?.getObjectPosition?.(segId);
          if (pos !== undefined) return true;
        }
        return false;
      };
      if (!positionNow()) {
        const group = segLayer.displayState?.segmentationGroupState?.value;
        if (group && !group.visibleSegments.has(segId)) {
          group.selectedSegments.add(segId);
          group.visibleSegments.add(segId);
        }
        let tries = 0;
        const wait = () => {
          if (positionNow() || ++tries > 30) {
            segLayer.moveToSegment?.(segId);
            this._bloomSegment(segIdStr);
            return;
          }
          setTimeout(wait, 300);
        };
        setTimeout(wait, 300);
        return;
      }

      // Use neuroglancer's built-in moveToSegment — it walks render layers,
      // calls getObjectPosition on the first MultiscaleMeshLayer that has
      // the manifest, and applies the per-layer transform via
      // setLayerPosition (which we'd skip if we set navigationState.position
      // directly). It also shows a temporary status message if no mesh
      // position is loaded yet, which we want.
      if (typeof segLayer.moveToSegment === 'function') {
        segLayer.moveToSegment(segId);
      } else {
        // Fallback for layer types without moveToSegment
        const renderLayers: any[] = segLayer.renderLayers || [];
        for (const layer of renderLayers) {
          if (layer && typeof layer.getObjectPosition === 'function') {
            const pos = layer.getObjectPosition(segId);
            if (pos) {
              viewer.navigationState.position.value = Float32Array.from(pos);
              break;
            }
          }
        }
      }

      // Bloom regardless — even if the position didn't move (mesh not loaded),
      // the user gets visual feedback that the click registered.
      this._bloomSegment(segIdStr);
    } catch (e) {
      console.warn('[jumpToSegment] Failed:', e);
    }
  }

  /**
   * Briefly flashes the segment white so the user can spot which one they
   * jumped to when many segments are in view. Restores the segment's prior
   * color override (or default hash color if none) when the bloom completes.
   */
  private _bloomSegment(segIdStr: string): void {
    try {
      const viewer: any = (window as any)['viewer'];
      if (!viewer) return;
      const segLayer: any = viewer.layerManager.managedLayers.find(
        (x: any) => x.layer instanceof SegmentationUserLayer,
      )?.layer;
      if (!segLayer) return;

      const colorGroupState = segLayer.displayState
        .segmentationColorGroupState.value;
      const segmentStatedColors = colorGroupState.segmentStatedColors;
      const segId = Uint64.parseString(segIdStr);

      // Capture the prior stated color (if any) so we can restore it after
      // the bloom. Uint64Map.get(key, valueOut) writes into the `valueOut`
      // buffer and returns a boolean indicating whether the key was found.
      const priorColor = new Uint64();
      const hadOverride = segmentStatedColors.get(segId, priorColor);
      // Snapshot as primitives so we don't mutate the saved value via later set/get.
      // Colors are 24-bit, so only the low word is meaningful.
      const priorLow = hadOverride ? priorColor.low : 0;

      // Two-pulse bloom: white → cyan-blue accent → white → restore.
      const whitePacked = 0xFFFFFF;
      const accentPacked = 0x99CCFF; // soft cyan-blue mid-pulse

      const setColor = (packed: number) => {
        setStatedColor(segmentStatedColors, segId, packed);
      };

      setColor(whitePacked);
      setTimeout(() => setColor(accentPacked), 250);
      setTimeout(() => setColor(whitePacked), 500);
      setTimeout(() => {
        if (hadOverride) {
          setStatedColor(segmentStatedColors, segId, priorLow);
        } else {
          segmentStatedColors.delete(segId);
        }
      }, 900);
    } catch (e) {
      console.warn('[bloomSegment] Failed:', e);
    }
  }
}
