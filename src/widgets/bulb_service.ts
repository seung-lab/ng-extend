
import JSONbigInt from 'json-bigint';
import {authFetch} from 'neuroglancer/authentication/frontend';
import {SegmentationUserLayerWithGraph, SegmentationUserLayerWithGraphDisplayState} from 'neuroglancer/segmentation_user_layer_with_graph';
import {ContextMenu} from 'neuroglancer/ui/context_menu';

import {CellDetailDialog} from './cell_detail';
import {CellIdDialog} from './cell_identification';
import {CellReviewDialog} from './cell_review';
import {Loader} from './loader';
import {PartnersDialog} from './partners';
import {SubmitDialog} from './seg_management';
import {SummaryDialog} from './summary';

const JSONBS = JSONbigInt({storeAsString: true});
const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void))[][];
const allSettled = function(promises: Promise<any>[]) {
  let mappedPromises = promises.map((p) => {
    return p
        .then((value) => {
          return {
            status: 'fulfilled',
            value,
          };
        })
        .catch((reason) => {
          return {
            status: 'rejected',
            reason,
          };
        });
  });
  return Promise.all(mappedPromises);
};

export class BulbService {
  timeout = 0;
  checkTime = 120000;
  statuses: {
    [key: string]: {
      sid: string; element: HTMLButtonElement;
      state?: any;
      status: 'error' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  addBulbToDict(bulb: HTMLButtonElement, sid: string) {
    this.statuses[sid] = {element: bulb, status: 'error', sid};
    this.checkTimeout(0);
  };

  checkTimeout(time: number = this.checkTime) {
    clearTimeout(this.timeout);
    const boundCheck = this.checkBulbs.bind(this);
    this.timeout = setTimeout(boundCheck, time);
  }

  stopTimeout() {
    clearTimeout(this.timeout);
  }

  process(
      raw: any, querylist: any,
      status: 'error'|'outdated'|'incomplete'|'unlabeled'|'complete') {
    const data = JSONBS.parse(raw);
    if (!data.pt_root_id || JSON.stringify(data.pt_root_id) === '{}') {
      return querylist;
    }
    const indicies = Object.keys(data.pt_root_id);
    const values = Object.values(data.pt_root_id);
    indicies.map((key: any) => {
      const sid = data.pt_root_id[key];
      this.statuses[sid].state =
          Object.keys(data).reduce((prev: any, curr: string) => {
            prev[curr] = data[curr][key];
            return prev;
          }, {});
      this.statuses[sid].status = status;
    });
    return querylist.filter((sid: string) => {
      return !values.includes(sid);
    });
  }

  updateStatuses() {
    const menuText = 'Click for Cell Information menu.';
    Object.values(this.statuses).forEach((segments) => {
      const {sid, element, status, state} = segments;
      let title;
      switch (status) {
        case 'error':
          title = 'Status cannot be determined.';
          break;
        case 'outdated':
          title =
              'Black: Outdated cell segment. Remove and re-add it to get latest reconstruction.'
          break;
        case 'incomplete':
          title = 'Yellow: This neuron has not been proofread.';
          break;
        case 'unlabeled':
          title =
              'Purple: This cell is proofread but unlabeled. Click to add an annotation.';
          break;
        case 'complete':
          title = 'Green: This cell has been proofread and labeled.';
          break;
      }
      element.classList.remove('error', 'outdated', 'unlabeled', 'complete');
      if (status !== 'incomplete') element.classList.add(status);
      element.title = `${title} ${menuText}`;
      // We need to recreate the menu
      const {dataset} = element.dataset;
      let cmenu = this.makeChangelogMenu(element, sid, dataset!, status, state);
      element.removeEventListener('click', <any>element.onclick);
      element.addEventListener('click', (event: MouseEvent) => {
        cmenu.show(
            <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY});
      });
    });
  }

  async checkBulbs(force?: boolean) {
    const rawList = Object.keys(this.statuses);
    let querylist = force ? rawList : rawList.filter(sid => {
      const view = this.statuses[sid].element.getBoundingClientRect();
      return view.height && view.width;
    });
    if (!querylist.length) {
      return;
    }

    const rawTS = this.getUserDefinedTimestamp();
    const timestamp = rawTS ? `&timestamp=${rawTS}` : '';

    const host = 'https://prod.flywire-daf.com';
    const basepath = '/neurons/api/v1';
    const defaultParameters = 'filter_by=root_id&as_json=1&ignore_bad_ids=True';

    let ternaryIds: any[] = [];

    try {
      // TODO: this should be split into its own function later on
      const chunkSize = 30;
      const batches = [];
      for (let i = 0; i < querylist.length; i += chunkSize) {
        const chunk = querylist.slice(i, i + chunkSize);
        batches.push(chunk);
      }

      for (const batch of batches) {
        const cellInfo = await allSettled([
          authFetch(
              `${host}${basepath}/cell_identification?${defaultParameters}${
                  timestamp}&filter_string=${batch.join(',')}`,
              {credentials: 'same-origin'}),
          authFetch(
              `${host}${basepath}/proofreading_status?${defaultParameters}${
                  timestamp}&filter_string=${batch.join(',')}`,
              {credentials: 'same-origin'})
        ]);

        // const dataState: BulbService['statuses'] = {};
        const rawCells: BulbService['statuses'] = {};

        const keylist = ['cell_id', 'proofreading'];
        const mappedResponse: any = {};
        for (let i = 0; i < cellInfo.length; i++) {
          const cell = cellInfo[i];
          if (cell.status === 'fulfilled') {
            mappedResponse[keylist[i]] = JSONBS.parse(
                await (<{status: string; value: any;}>cell).value.text());
          }
        }

        Object.entries(mappedResponse).forEach((pkvp: any) => {
          const key = pkvp[0];
          const data = pkvp[1];

          if (data.pt_root_id) {
            const states: any = {};
            const props = Object.keys(data);
            Object.entries(data.pt_root_id).forEach((kvp: any) => {
              const obj: any = {};
              const sid = kvp[1];
              props.forEach((prop: string) => {
                obj[prop] = data[prop][kvp[0]];
              });
              if (states[sid]) {
                states[sid][key].push(obj);
              } else {
                states[sid] = {[key]: [obj]};
              }
            });
            Object.entries(states).forEach((kvp: any) => {
              const sid = kvp[0];
              const state: any = kvp[1];
              if (!rawCells[sid]) rawCells[sid] = this.statuses[sid];
              rawCells[sid].state = {...rawCells[sid].state, ...state};
              let tag = rawCells[sid].state.cell_id;
              let proofread = rawCells[sid].state.proofreading;
              if (tag && tag.length) {
                tag = tag[tag.length - 1].tag;
              }
              if (proofread && proofread.length) {
                proofread = proofread[proofread.length - 1].proofread;
              }

              rawCells[sid].status = proofread === 't' ?
                  (tag ? 'complete' : 'unlabeled') :
                  'incomplete';
            });
          }
        });



        this.statuses = {...this.statuses, ...rawCells};
        const values = Object.keys(rawCells);

        ternaryIds = [
          ...ternaryIds, ...batch.filter((sid: string) => {
            return !values.includes(sid);
          })
        ];
        this.updateStatuses();
      }

      if (ternaryIds.length) {
        const mLayer = (<any>window).viewer.selectedLayer.layer;
        // if (mLayer == null) return;
        const layer = <SegmentationUserLayerWithGraph>mLayer.layer;

        const outdatedStatusRequest =
            await authFetch(`${layer.chunkedGraphUrl}/is_latest_roots`, {
              method: 'POST',
              body: JSON.stringify({node_ids: ternaryIds}),
            });
        const outdatedStatus = await outdatedStatusRequest.json();
        ternaryIds.forEach((sid: string, i: number) => {
          this.statuses[sid].status =
              (outdatedStatus.is_latest[i]) ? 'incomplete' : 'outdated';
        });
        this.updateStatuses();
      }
    } catch (e) {
      console.error(e);
    }

    this.checkTimeout();
  };

  createChangelogButton(segmentIDString: string, dataset: DOMStringMap):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const changelogButton = document.createElement('button');
    changelogButton.className = 'nge-segment-changelog-button lightbulb';
    changelogButton.title = `Show changelog for Segment: ${segmentIDString}`;
    changelogButton.innerHTML = '⠀';
    let cmenu = this.makeChangelogMenu(
        changelogButton, segmentIDString, dataset.dataset!, 'error');
    changelogButton.addEventListener('click', (event: MouseEvent) => {
      cmenu.show(
          <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY});
    });
    changelogButton.dataset.dataset = dataset.dataset!;
    return changelogButton;
  };

  // Given an HTMLDivElement, generate a section with the title given by the
  // title parameter and a button under the title with the text given by the
  // button parameter
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
          sectionButton.addEventListener('click', () => {
            window.open(action, '_blank');
          });
        } else {
          sectionButton.addEventListener('click', <any>action!);
        }
      }
      section.appendChild(sectionButton);
      section.appendChild(br());
    };
    if (extraPadding) section.appendChild(br());

    for (const [name, model, action] of menuOpt) {
      const label = document.createElement('a');
      label.style.display = 'flex';
      label.style.flexDirection = 'row';
      label.style.whiteSpace = 'nowrap';
      label.textContent = `${name}`;
      label.style.color = 'white';
      label.href = `${model}`;
      label.target = '_blank';
      if (action) {
        label.addEventListener('click', <any>action!);
      }
      section.appendChild(label);
    }
    return section;
  };

  async getTimeStamp(segmentIDString: string) {
    const mLayer = (<any>window).viewer.selectedLayer.layer;
    if (mLayer == null) return;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    const displayState =
        <SegmentationUserLayerWithGraphDisplayState>layer.displayState;

    if (displayState.timestamp) return parseInt(displayState.timestamp.value);

    const timestamps = await authFetch(
        `${layer.chunkedGraphUrl}/root_timestamps`,
        {method: 'POST', body: JSON.stringify({node_ids: [segmentIDString]})});
    const ts = await timestamps.json();
    return ts.timestamp[0];
  };

  getUserDefinedTimestamp() {
    const mLayer = (<any>window).viewer.selectedLayer.layer;
    if (mLayer == null) return;
    return mLayer.layer.displayState.timestamp.value;
  };

  // this function needs to be refactored
  makeChangelogMenu(
      parent: HTMLElement, segmentIDString: string, dataset: string,
      status: 'error'|'outdated'|'incomplete'|'unlabeled'|'complete',
      state?: any): ContextMenu {
    console.log(status);
    const contextMenu = new ContextMenu(parent);
    const menu = contextMenu.element;
    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');
    const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
    const host = 'https://prod.flywire-daf.com';
    let timestamp: number|undefined = this.getUserDefinedTimestamp();
    let optGroup: any = {analysis: [], proofreading: []};

    const cleanOverlays = () => {
      const overlays = document.getElementsByClassName('nge-overlay');
      [...overlays].forEach(function(element) {
        try {
          (<any>element).dispose();
        } catch {
        }
      });
    };
    const handleDialogOpen = async (e: MouseEvent, callback: Function) => {
      e.preventDefault();
      let spinner = new Loader();
      if (timestamp == undefined) {
        timestamp = await this.getTimeStamp(segmentIDString);
      }
      cleanOverlays();
      spinner.dispose();
      callback(parent.classList.contains('error'));
    };
    const currentTimeStamp = () => timestamp;
    // timestamp will change but because the menu opt is static, if it
    // already exists then the user has defined a timestamp to use and the
    // field should be added
    const linkTS = timestamp ? `&timestamp=${timestamp}` : '';
    const dashTS = timestamp ? `&timestamp_field=${timestamp}` : '';

    let changelog =
        ['Change Log', `${host}/progress/api/v1/query?rootid=${paramStr}`];
    // If production data set
    if (dataset == 'fly_v31') {
      optGroup.proofreading.push(SummaryDialog.generateMenuOption(
          handleDialogOpen, host, segmentIDString, currentTimeStamp));
      optGroup.analysis.push([
        'Connectivity',
        `${host}/dash/datastack/flywire_fafb_production/apps/fly_connectivity/?input_field=${
            segmentIDString}&cleft_thresh_field=50${dashTS}`,
      ]);
      optGroup.proofreading.push(changelog);
      optGroup.proofreading.push([
        'Cell Completion Details',
        `${host}/neurons/api/v1/lookup_info?filter_by=root_id&filter_string=${
            paramStr}${linkTS}`
      ]);
      /*
      optGroup.proofreading.push([
        'Cell Identification',
        `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
            paramStr}${linkTS}`
      ]);
      */
      optGroup.analysis.push(PartnersDialog.generateMenuOption(
          handleDialogOpen, host, segmentIDString, currentTimeStamp));

      // the timestamp parameter is falsy if the user has defined a
      // timestamp
      if (!timestamp) {
        /*
        optGroup.proofreading.push(SubmitDialog.generateMenuOption(
            handleDialogOpen, host, segmentIDString, currentTimeStamp));
        optGroup.proofreading.push(CellIdDialog.generateMenuOption(
            handleDialogOpen, host, segmentIDString, currentTimeStamp));
        */
        if (parent.classList.contains('complete') ||
            parent.classList.contains('unlabeled')) {
          optGroup.proofreading.push(
              CellReviewDialog.generateMenuOption(
                  handleDialogOpen, host, segmentIDString, currentTimeStamp),
          );
        }
      }
    } else {
      optGroup.proofreading.push(changelog);
    }

    let markComplete = SubmitDialog.generateMenuOption(
        handleDialogOpen, host, segmentIDString, currentTimeStamp);
    let identify = CellIdDialog.generateMenuOption(
        handleDialogOpen, host, segmentIDString, currentTimeStamp);
    let details = CellDetailDialog.generateMenuOptionv2(
        handleDialogOpen, host, segmentIDString, currentTimeStamp,
        {...state, paramStr, linkTS});

    const {cell_id} = <any>(state || {});
    let cellIDButtons = cell_id && cell_id.length ?
        [
          ['Details', 'blue', details[2]],
          ['Add New Identification', 'purple', identify[2]]
        ] :
        [['Identify', 'purple', identify[2]]];
    let proofreadingButtons =
        ['incomplete', 'unlabeled', 'complete'].includes(status) ?
        [['Mark as Complete', 'green', markComplete[2]]] :
        [];

    if (timestamp) {
      menu.append(
          br(),
          this.generateSection(
              'Timestamp Segmentation Active', [], [],
              () => `Certain Cell ID functions are
                  disabled when a timestamp is active.`));
      cellIDButtons = [];
      proofreadingButtons = [];
    }
    menu.append(
        br(), this.generateSection('Cell Identification', cellIDButtons, []),
        br(), this.generateSection('Analysis', [], optGroup.analysis), br(),
        this.generateSection(
            'Proofreading', proofreadingButtons, optGroup.proofreading,
            () => {
              switch (status) {
                case 'error':
                  return 'Unknown';
                case 'outdated':
                  return 'Outdated';
                case 'unlabeled':
                case 'complete':
                  return 'Complete';
                default:
                  return '';
              }
            },
            false),
        br(), br());
    return contextMenu;
  };
}