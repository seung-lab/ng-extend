import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {RETINAL_CELL_TYPES} from '../config';
import {getCellStatus, setCellComplete, saveCellType, CellStatus} from './lightbulb_service';

const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void))[][];

export class ButtonService {
  createButton(
      localServerURL: string, segmentIDString: string,
      dataset: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'nge-segment-button nge-lb-btn menu nge-lb-loading';
    button.title = `Cell ${segmentIDString}`;
    button.style.cssText =
        'background:transparent;border:none;box-shadow:none;cursor:pointer;padding:0 2px;';

    // Three-dot SVG icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('viewBox', '0 0 20 20');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
        'd',
        'M3.936,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021S5.957,' +
            '11.116,5.957,10S5.052,7.979,3.936,7.979z M3.936,11.011c-0.558,0-1.011-0.452-1.011' +
            '-1.011s0.453-1.011,1.011-1.011S4.946,9.441,4.946,10S4.494,11.011,3.936,11.011z ' +
            'M16.064,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021s2.021-0.905,' +
            '2.021-2.021S17.181,7.979,16.064,7.979z M16.064,11.011c-0.559,0-1.011-0.452-1.011' +
            '-1.011s0.452-1.011,1.011-1.011S17.075,9.441,17.075,10S16.623,11.011,16.064,11.011z ' +
            'M10,7.979c-1.116,0-2.021,0.905-2.021,2.021S8.884,12.021,10,12.021s2.021-0.905,' +
            '2.021-2.021S11.116,7.979,10,7.979z M10,11.011c-0.558,0-1.011-0.452-1.011-1.011' +
            'S9.442,8.989,10,8.989S11.011,9.441,11.011,10S10.558,11.011,10,11.011z');
    path.setAttribute('fill', 'currentColor');
    icon.appendChild(path);
    button.appendChild(icon);

    // Async: fetch CAVE status and tint the button dot accordingly
    this._refreshButtonStatus(button, localServerURL, segmentIDString);

    button.addEventListener('click', (event: MouseEvent) => {
      const menu = this.makeMenu(button, localServerURL, segmentIDString, dataset);
      menu.show(<MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY});
    });

    return button;
  }

  /** Fetches the current cell status and updates the button's CSS class. */
  private async _refreshButtonStatus(
      button: HTMLButtonElement, localServerURL: string,
      segmentIDString: string): Promise<void> {
    button.classList.remove(
        'nge-lb-loading', 'nge-lb-complete', 'nge-lb-incomplete', 'nge-lb-error');
    button.classList.add('nge-lb-loading');
    try {
      const status = await getCellStatus(localServerURL, segmentIDString);
      button.classList.remove('nge-lb-loading');
      if (status === null) {
        button.classList.add('nge-lb-error');
      } else if (status.isComplete) {
        button.classList.add('nge-lb-complete');
      } else {
        button.classList.add('nge-lb-incomplete');
      }
      // Stash status on the element so the menu can read it without re-fetching
      (button as any)._cellStatus = status;
    } catch {
      button.classList.remove('nge-lb-loading');
      button.classList.add('nge-lb-error');
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
