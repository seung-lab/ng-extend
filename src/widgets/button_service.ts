import { explainCellType } from '../data/cell_type_glossary';
import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {Uint64} from 'neuroglancer/util/uint64';
import {setStatedColor} from './widget_utils';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {currentCellTypes} from '../datasets';
import {planMenuCompletion, finishMenuCompletion, needsCompletionDetails} from '../util/menu_complete';
import {askCompletionDetails, type CompletionDetails} from '../util/completion_details';
import {getCellStatus, setCellComplete, saveCellType, CellStatus, getLastCompletionProblem} from './lightbulb_service';
import {getDatasetCaveConfig} from '../config';
import {currentSegLayerName} from '../datasets';
import {useHelpRequestStore, useProofreadingBackendStore, type ClaimPoint} from '../store';
import {getSelectedSupervoxelId} from './pcg_service';
import {startLinkForSegment, openStartLink} from '../util/start_link';

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

    button.addEventListener('click', (_event: MouseEvent) => {
      const menu = this.makeMenu(button, localServerURL, segmentIDString, dataset);
      // Horizontal: open to the LEFT of the lightbulb button with a 32px gap
      // so the popup has clear breathing room from the seg panel edge.
      // Vertical: center in the viewport so a tall menu doesn't bleed off
      // the bottom or feel pinned to wherever the user happened to click.
      const rect = button.getBoundingClientRect();
      const menuWidth = 290; // matches .nge_lbmenu min-width
      const margin = 12;
      const gap = 32;
      const desired = rect.left - menuWidth - gap;
      const x = Math.max(margin, Math.min(desired, window.innerWidth - menuWidth - margin));
      menu.show(<MouseEvent>{clientX: x, clientY: 0});
      // Override vertical positioning to center the menu in the viewport
      const el = menu.element as HTMLElement;
      el.style.top = '50%';
      el.style.transform = 'translateY(-50%)';
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
    (button as any)._cellStatus = status;
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
        button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete', 'nge-lb-annotated');
        button.classList.add('nge-lb-incomplete');
      }
    } catch {
      button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete', 'nge-lb-annotated');
      button.classList.add('nge-lb-incomplete');
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
    const label = status?.cellType
      ? (status.classificationSystem ? `${status.classificationSystem} - ${status.cellType}` : status.cellType)
      : '';
    if (idEl) {
      const segId = (idEl.textContent || '').trim();
      if (label) {
        idEl.dataset.ngeLabel = label;
        // Abbreviations written out (Ames: "hover tips to write out acronyms").
        const spelled = explainCellType(label);
        idEl.title = [label, ...spelled, '', `ID ${segId} (copy button on the left)`].join(String.fromCharCode(10));
      } else {
        delete idEl.dataset.ngeLabel;
        idEl.removeAttribute('title');
      }
    }
    row.classList.toggle('nge-seg-labelled', !!label);

    if (!status) {
      badge.className = 'nge-label-badge';
      badge.textContent = '';
      badge.title = '';
    } else if (status.cellType) {
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
    menu.appendChild(header);

    let cachedStatus: CellStatus|null = (parent as any)._cellStatus ?? null;

    // ── Section 1: Completion Status ──────────────────────────────────────
    const completionSection = document.createElement('div');
    completionSection.classList.add('nge-lb-section');

    const completionTitle = document.createElement('div');
    completionTitle.classList.add('nge-lb-section-title');
    completionTitle.textContent = 'Completion Status';
    completionSection.appendChild(completionTitle);

    const statusLine = document.createElement('div');
    statusLine.classList.add('nge-lb-status-line');
    statusLine.textContent = cachedStatus ?
        (cachedStatus.isComplete ? '✓ Proofread' : '○ In Progress') :
        '… Loading';
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
          statusLine.textContent = st?.isComplete ? '✓ Proofread' : '○ In Progress';
          if (!toggleBtn.disabled) toggleBtn.textContent = st?.isComplete ? 'Unmark Proofread' : 'Mark as Proofread';
          if (st?.cellType && !select.value) select.value = st.cellType;
          if (typeLine) typeLine.textContent = st?.cellType || 'No type yet';
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
        statusLine.textContent = willBeComplete ? '✓ Proofread' : '○ In Progress';
        toggleBtn.textContent = willBeComplete ? 'Unmark Proofread' : 'Mark as Proofread';
        if (cachedStatus) cachedStatus.isComplete = willBeComplete;
        this._refreshButtonStatus(parent as HTMLButtonElement, localServerURL, segmentIDString);

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
    });
    completionSection.appendChild(toggleBtn);

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
      saveTypeBtn.textContent = ok ? 'Saved ✓' :
          (!localServerURL ? 'No CAVE server configured' : 'Error — retry');
      saveTypeBtn.disabled = false;
      if (ok && cachedStatus) {
        cachedStatus.cellType = cellType;
        // Update pip/badge in the sidebar row
        this._applyStatus(parent as HTMLButtonElement, cachedStatus);
        // Notify AnnotationPanel and other listeners
        document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
          detail: { segId: segmentIDString, status: cachedStatus },
        }));
      }
    });
    cellTypeSection.appendChild(saveTypeBtn);
    if (roCfg.cellTypeReadOnly) { freeText.style.display = 'none'; saveTypeBtn.style.display = 'none'; }

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
      ['#44ff44', 0.27, 1, 0.27],   // green
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
    colorInput.value = '#44ff44';
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

    if (backend.userId) {
      if (!claimInfo.claimed) {
        // Claim button
        const claimBtn = document.createElement('button');
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
          const supervoxelId = getSelectedSupervoxelId();
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
      menu.append(br(), completionSection, br(), cellTypeSection, br(), colorSection, br(), claimSection, br(), helpSection, br());
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
