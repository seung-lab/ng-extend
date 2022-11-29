
import JSONbigInt from 'json-bigint';

import {authFetch} from 'neuroglancer/authentication/frontend';
import {SegmentationUserLayerWithGraph, SegmentationUserLayerWithGraphDisplayState} from 'neuroglancer/segmentation_user_layer_with_graph';
import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {CellIdDialog} from './cell_identification';

import {CellReviewDialog} from './cell_review';
import {Loader} from './loader';
import {PartnersDialog} from './partners';
import {SubmitDialog} from './seg_management';
import {SummaryDialog} from './summary';

const JSONBS = JSONbigInt({storeAsString: true});
const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void))[][];

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

  checkBulbs(force?: boolean) {
    const rawList = Object.keys(this.statuses);
    let querylist = force ? rawList : rawList.filter(sid => {
      const view = this.statuses[sid].element.getBoundingClientRect();
      return view.height && view.width;
    });
    if (!querylist.length) {
      return;
    }

    const menuText = 'Click for Cell Information menu.';
    const rawTS = this.getUserDefinedTimestamp();
    const timestamp = rawTS ? `&timestamp=${rawTS}` : '';

    const host = 'https://prod.flywire-daf.com';
    const basepath = '/neurons/api/v1';
    const defaultParameters = 'filter_by=root_id&as_json=1&ignore_bad_ids=True';

    authFetch(
        `${host}${basepath}/cell_identification?${defaultParameters}${
            timestamp}&filter_string=${querylist.join(',')}`,
        {credentials: 'same-origin'})
        .then((response: any) => response.text())
        .then((data: any) => this.process(data, querylist, 'complete'))
        .then((secondList: any) => {
          querylist = secondList;
          return authFetch(
              `${host}${basepath}/proofreading_status?${defaultParameters}${
                  timestamp}&filter_string=${querylist.join(',')}`,
              {credentials: 'same-origin'});
        })
        .then((response: any) => response.text())
        .then((data: any) => this.process(data, querylist, 'unlabeled'))
        .then((remaining: any) => {
          querylist = remaining;
          const mLayer = (<any>window).viewer.selectedLayer.layer;
          // if (mLayer == null) return;
          const layer = <SegmentationUserLayerWithGraph>mLayer.layer;

          return authFetch(`${layer.chunkedGraphUrl}/is_latest_roots`, {
            method: 'POST',
            body: JSON.stringify({node_ids: querylist}),
          });
        })
        .then((response: any) => response.json())
        .then((data: any) => {
          return querylist.forEach((sid, i) => {
            this.statuses[sid].status =
                (data.is_latest[i]) ? 'incomplete' : 'outdated';
          });
        })
        .then(() => {
          Object.values(this.statuses).forEach((segments) => {
            const {sid, element, status} = segments;
            let title = 'This segment is ';
            switch (status) {
              case 'error':
                title += 'not available.';
                break;
              case 'outdated':
                title += 'outdated.';
                break;
              case 'incomplete':
                title += 'not marked as proofread.';
                break;
              case 'unlabeled':
                title += 'marked as proofread but unlabeled.';
                break;
              case 'complete':
                title += 'marked as proofread.';
                break;
            }
            element.classList.remove(
                'error', 'outdated', 'unlabeled', 'complete');
            if (status !== 'incomplete') element.classList.add(status);
            element.title = `${title} ${menuText}`;
            // We need to recreate the menu
            const {dataset} = element.dataset;
            let cmenu = this.makeChangelogMenu(element, sid, dataset!, status);
            element.removeEventListener('click', <any>element.onclick);
            element.addEventListener('click', (event: MouseEvent) => {
              cmenu.show(<MouseEvent>{
                clientX: event.clientX - 200,
                clientY: event.clientY
              });
            });
          });
        })
        .catch((e: any) => console.error(e))
        .finally(() => this.checkTimeout());
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
      section.appendChild(sectionContent);
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
      status: 'error'|'outdated'|'incomplete'|'unlabeled'|
      'complete'): ContextMenu {
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

    let cellIDButtons = status === 'complete' ?
        [
          [
            'Details', 'blue',
            `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
                paramStr}${linkTS}`
          ],
          ['Add New Id', 'purple', identify[2]]
        ] :
        [['Identify', 'purple', identify[2]]];
    let proofreadingButtons = status === 'incomplete' ?
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
            true),
        br(), br());
    return contextMenu;
  };
}