import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {RETINAL_CELL_TYPES} from '../config';
import {getCellStatus, setCellComplete, saveCellType, CellStatus} from './lightbulb_service';

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

    return button;
  }

  /** Fetches the current cell status and updates the button's pip CSS class. */
  private async _refreshButtonStatus(
      button: HTMLButtonElement, localServerURL: string,
      segmentIDString: string): Promise<void> {
    try {
      const status = await getCellStatus(localServerURL, segmentIDString);
      button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete');
      if (status === null) {
        button.classList.add('nge-lb-incomplete');
      } else if (status.isComplete && status.cellType) {
        button.classList.add('nge-lb-complete');
      } else if (status.isComplete && !status.cellType) {
        button.classList.add('nge-lb-done-unlabeled');
      } else {
        button.classList.add('nge-lb-incomplete');
      }
      // Stash status on the element so the menu can read it without re-fetching
      (button as any)._cellStatus = status;
      // Sync the label-column badge
      const row = button.closest('.neuroglancer-segment-list-entry') as HTMLElement | null;
      if (row) this.updateLabelBadge(row, status);
    } catch {
      button.classList.remove('nge-lb-incomplete', 'nge-lb-done-unlabeled', 'nge-lb-complete');
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
    const nameSpan =
        row.querySelector('.neuroglancer-segment-list-entry-name') as HTMLElement|null;
    if (!nameSpan) return;

    let badge = nameSpan.querySelector('.nge-label-badge') as HTMLElement|null;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nge-label-badge';
      nameSpan.prepend(badge);
    }

    if (!status || !status.isComplete) {
      badge.className = 'nge-label-badge nge-label-badge--incomplete';
      badge.textContent = '—';
      badge.title = status === null ? 'Fetching status…' : 'Incomplete';
    } else if (status.isComplete && status.cellType) {
      badge.className = 'nge-label-badge nge-label-badge--complete';
      badge.textContent = `✓ ${status.cellType}`;
      badge.title = `Complete: ${status.cellType}`;
    } else {
      badge.className = 'nge-label-badge nge-label-badge--unlabeled';
      badge.textContent = '⚠ No type';
      badge.title = 'Complete but no cell type set';
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
        toggleBtn.textContent = 'Error — try again';
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
      saveTypeBtn.textContent = ok ? 'Saved ✓' : 'Error — retry';
      saveTypeBtn.disabled = false;
      if (ok && cachedStatus) cachedStatus.cellType = cellType;
    });
    cellTypeSection.appendChild(saveTypeBtn);

    // ── Section 3: Links ──────────────────────────────────────────────────
    const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
    const linksSection = this.generateSection(
        'Links', [],
        [['Change Log', `${localServerURL}/progress/api/v1/query?rootid=${paramStr}`,
          undefined]]);

    menu.append(br(), completionSection, br(), cellTypeSection, br(), linksSection, br());
    return contextMenu;
  }
}
