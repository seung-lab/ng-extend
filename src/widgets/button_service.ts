import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {RETINAL_CELL_TYPES} from '../config';
import {getCellStatus, setCellComplete, saveCellType, CellStatus} from './lightbulb_service';
import {useHelpRequestStore} from '../store';

const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void)|undefined)[][];

export class ButtonService {
  createButton(
      localServerURL: string, segmentIDString: string,
      dataset: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'nge-segment-button nge-lb-btn nge-lb-incomplete menu';
    button.title = `Cell ${segmentIDString}`;
    button.style.cssText =
        'background:transparent;border:none;box-shadow:none;cursor:pointer;padding:0 2px;display:flex;align-items:center;justify-content:center;';

    // Dots icon (visible on hover) + status pip
    button.innerHTML = '<span class="nge-lb-dots">⋯</span><span class="nge-lb-pip"></span>';

    // Async: fetch CAVE status and update the pip accordingly
    this._refreshButtonStatus(button, localServerURL, segmentIDString);

    button.addEventListener('click', (event: MouseEvent) => {
      const menu = this.makeMenu(button, localServerURL, segmentIDString, dataset);
      menu.show(<MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY});
    });

    // Listen for annotation changes from AnnotationPanel (or anywhere).
    // The event carries the current status directly so we don't need to
    // re-fetch from CAVE (which might miss localStorage-only annotations).
    document.addEventListener('nge:seg-status-changed', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.segId === segmentIDString) {
        if (detail.status) {
          // Use the status from the event directly
          this._applyStatus(button, detail.status as CellStatus);
        } else {
          // No status provided — re-fetch as fallback
          this._refreshButtonStatus(button, localServerURL, segmentIDString);
        }
      }
    });

    return button;
  }

  /** Apply a known status to the button pip + label badge (no fetch). */
  private _applyStatus(button: HTMLButtonElement, status: CellStatus): void {
    button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete', 'nge-lb-annotated');
    if (status.isComplete) {
      button.classList.add('nge-lb-complete');
    } else if (status.cellType) {
      button.classList.add('nge-lb-annotated');
    } else {
      button.classList.add('nge-lb-incomplete');
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
      // Insert after nickname (if exists) or after ID element
      const nickname = row.querySelector('.nge-segment-nickname');
      const idEl = row.querySelector('.neuroglancer-segment-list-entry-id');
      const anchor = nickname || idEl;
      if (anchor && anchor.nextSibling) {
        anchor.parentNode!.insertBefore(badge, anchor.nextSibling);
      } else if (anchor) {
        anchor.parentNode!.appendChild(badge);
      } else {
        // Fallback: put in name column
        const nameSpan = row.querySelector('.neuroglancer-segment-list-entry-name');
        if (nameSpan) nameSpan.prepend(badge);
        else return;
      }
    }

    if (!status) {
      badge.className = 'nge-label-badge nge-label-badge--incomplete';
      badge.textContent = '—';
      badge.title = 'Fetching status…';
    } else if (status.isComplete && status.cellType) {
      badge.className = 'nge-label-badge nge-label-badge--complete';
      badge.textContent = `✓ ${status.cellType}`;
      badge.title = `Complete: ${status.cellType}`;
    } else if (status.isComplete) {
      badge.className = 'nge-label-badge nge-label-badge--complete';
      badge.textContent = '✓ Complete';
      badge.title = 'Complete (no cell type set)';
    } else if (status.cellType) {
      badge.className = 'nge-label-badge nge-label-badge--annotated';
      badge.textContent = `⊙ ${status.cellType}`;
      badge.title = `Annotated: ${status.cellType}`;
    } else {
      badge.className = 'nge-label-badge nge-label-badge--incomplete';
      badge.textContent = '—';
      badge.title = 'Incomplete';
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
    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add('neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    const cachedStatus: CellStatus|null = (parent as any)._cellStatus ?? null;

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
        (cachedStatus.isComplete ? '✓ Complete' : '○ In Progress') :
        '… Loading';
    completionSection.appendChild(statusLine);

    const toggleBtn = document.createElement('button');
    toggleBtn.classList.add('nge-lb-section-button', 'nge-lb-toggle-btn');
    toggleBtn.textContent = cachedStatus?.isComplete ? 'Unmark Complete' : 'Mark Complete';
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      toggleBtn.textContent = 'Saving…';
      const willBeComplete = !(cachedStatus?.isComplete ?? false);
      const ok = await setCellComplete(
          localServerURL, segmentIDString, willBeComplete, cachedStatus?.annotationId);
      if (ok) {
        statusLine.textContent = willBeComplete ? '✓ Complete' : '○ In Progress';
        toggleBtn.textContent = willBeComplete ? 'Unmark Complete' : 'Mark Complete';
        if (cachedStatus) cachedStatus.isComplete = willBeComplete;
        this._refreshButtonStatus(parent as HTMLButtonElement, localServerURL, segmentIDString);
      } else {
        toggleBtn.textContent = !localServerURL ? 'No CAVE server configured' : 'Error — try again';
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

    for (const ct of RETINAL_CELL_TYPES) {
      const opt = document.createElement('option');
      opt.value = ct;
      opt.textContent = ct;
      if (cachedStatus?.cellType === ct) opt.selected = true;
      select.appendChild(opt);
    }
    cellTypeSection.appendChild(select);

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

    // ── Section 3: Links ──────────────────────────────────────────────────
    const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
    const linksSection = this.generateSection(
        'Links', [],
        [['Change Log', `${localServerURL}/progress/api/v1/query?rootid=${paramStr}`,
          undefined]]);

    // ── Section 4: Ask for Help ───────────────────────────────────────────
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
      });
      helpBtn.textContent = '✓ Help Requested';
      helpBtn.disabled = true;
      helpBtn.style.color = '#7f8';
      helpBtn.style.borderColor = 'rgba(127,255,136,0.3)';
    });
    helpSection.appendChild(helpBtn);

    menu.append(br(), completionSection, br(), cellTypeSection, br(), helpSection, br(), linksSection, br());
    return contextMenu;
  }
}
