import { ContextMenu } from 'neuroglancer/unstable/ui/context_menu.js';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/unstable/util/special_protocol_request.js';
import { defaultCredentialsManager } from "neuroglancer/unstable/credentials_provider/default_manager.js";
import { makeIcon } from 'neuroglancer/unstable/widget/icon.js';
import JSONbigInt from 'json-bigint';


import './bulb.css';
import lightbulb_base_svg from '!svg-inline-loader!#src/images/lightbulb-base.svg';
import { NullarySignal } from 'neuroglancer/unstable/util/signal.js';

const br = () => document.createElement('br');
const JSONBS = JSONbigInt({storeAsString: true});

/* Alternate to responseJson, which would break segmetn IDs */
function responseJsonString(response: Response): Promise<any> {
  return response.text()
}

export class LightBulbService {

  timeout = 0;
  checkTime = 120000;
  statuses: {
    [key: string]: {
      sid: string; //root id
      element: HTMLElement; //svg image
      button: HTMLButtonElement; //button containing element with svg image
      //error: something is wrong
      //deselected: not sure yet
      //outdated: placeholder or not proofread or identified
      //incomplete: not proofread but identified
      //unlabeled: proofread but not identified
      //complete: both
      status: 'error' | 'deselected' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  checkNodeStatuses(): void {

    var sidstring = "";
    Object.values(this.statuses).forEach((segments) => {
      const {sid} = segments;
      sidstring += sid + ',';
    });

    if(sidstring.length == 0)
      return;

    sidstring = sidstring.slice(0,-1);


    (async () => { //proofreading status
      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring,
          defaultCredentialsManager,
      );  
      try {
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));

        //for each node returned from the service
        for(let nodeIndex in nodeStatuses["index"]) {
          let rootid = nodeStatuses["pt_root_id"][nodeIndex]

          if (nodeStatuses["proofread"][nodeIndex] === "t" 
                  && this.statuses[rootid]["status"] === 'outdated') {

            //if proofread and marked as outdated, mark as unlabeled
            this.statuses[rootid]["status"] = "unlabeled";
          } else if(nodeStatuses["proofread"][nodeIndex] === "t" 
                  && this.statuses[rootid]["status"] === 'incomplete'){

            //if proofread and marked as incomplete, mark as complete
            this.statuses[rootid]["status"] = "complete";
          
          } else if(nodeStatuses["proofread"][nodeIndex] !== "t" 
                  && this.statuses[rootid]["status"] === "unlabeled"){
            
            //if not proofread and marked as unlabeled, mark as outdated (our info has changed)
            this.statuses[rootid]["status"] = 'outdated'
          }
        }
      } catch(e) {
        console.log("Failed to fetch info" + e.message)
      }
      //update colors based on new information
      this.colorBulbs();
    })();

    (async () => { //cell identification status
      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/cell_identification?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring,
          defaultCredentialsManager,
      );  
      try {
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));

        //for each node returned from the service
        for(let nodeIndex in nodeStatuses["index"]) {
          let rootid = nodeStatuses["pt_root_id"][nodeIndex]

          if (nodeStatuses["valid"][nodeIndex] === "t" 
                  && this.statuses[rootid]["status"] === 'outdated') {

            //if cell is identified and marked as outdated, mark as incomplete
            this.statuses[rootid]["status"] = "incomplete";
          } else if(nodeStatuses["valid"][nodeIndex] === "t" 
                  && this.statuses[rootid]["status"] === 'unlabeled'){

            //if cell is identified and marked as unlabeled, mark as complete
            this.statuses[rootid]["status"] = "complete";
          } else if(nodeStatuses["valid"][nodeIndex] !== "t" 
                  && this.statuses[rootid]["status"] === "incomplete"){
            
            //if cell is not identified and marked as incomplete, mark as outdated (our info has changed)
            this.statuses[rootid]["status"] = 'outdated'
          }
        }
      } catch(e) {
        console.log("Failed to fetch info" + e.message)
      }

      //update colors based on new information
      this.colorBulbs();
    })();

    //check to see if our info has changed after waiting <timeout> seconds
    this.checkTimeout();
  }

  colorBulbs() {
    Object.values(this.statuses).forEach((segments) => {
      //for each root id that is selected, color it's bulb based on its status
      const {sid} = segments;
      switch(this.statuses[sid]["status"]) {
        case 'error':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb red";
          break;
        case 'outdated':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb";
          break;
        case 'incomplete':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb yellow";
          break;
        case 'unlabeled':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb purple";
          break;
        case 'complete':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb green";
          break;
        //TODO??? case unselected
      }
      
    });
  }


  checkTimeout(time: number = this.checkTime) {
    clearTimeout(this.timeout);
    const boundCheck = this.checkNodeStatuses.bind(this);
    this.timeout = window.setTimeout(boundCheck, time);
  }

  stopTimeout() {
    clearTimeout(this.timeout);
  }


  createButton(segmentIDString: string): HTMLButtonElement {

    //don't recreate existing buttons
    if(segmentIDString in this.statuses) {
      return this.statuses[segmentIDString]["button"]
    }

    // button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    bulb.style.backgroundColor = 'transparent';
    bulb.style.color = 'green'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";
    bulb.style.height = '16px'
    bulb.style.width = '16px'

    //set button's lightbulb icon to the initial one
    let iconElement: HTMLElement;
    iconElement = makeIcon({svg: lightbulb_base_svg});
    iconElement.className = "neuroglancer-icon bulb";
    //fix svg icon to allow for css based styling
    (iconElement.firstElementChild as SVGElement).style.fill = "unset";
    bulb.appendChild(iconElement);

    //add event listner :)
    bulb.addEventListener('click', (event: MouseEvent) => {
      // TODO: Make sure we destroy the menu as well
      let menu = this.makeMenu(bulb, segmentIDString)
      menu.show(
          <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY}
      )
    });

    this.statuses[segmentIDString] = {sid: segmentIDString , element: iconElement,button: bulb, status: "outdated"};
    this.checkTimeout(0);

    return bulb;
  };

  generateSection(segmentIDString : string, queryURL: string) : HTMLDivElement{
    const popup_body = document.createElement('div');

    (async () => {
        const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
            queryURL + segmentIDString,
            defaultCredentialsManager,
        );
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));
        popup_body.textContent = "Segment infoirmation: " + JSONBS.stringify(nodeStatuses);
    })();

    return popup_body;
  }

  makeMenu(parent: HTMLElement, segmentIDString: string): ContextMenu {
    let contextMenu : ContextMenu | undefined = new ContextMenu(parent);
    const menu = contextMenu.element;
    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    menu.append(
        br(),
        this.generateSection(segmentIDString, 'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/'),
        br(),
        br(),
        this.generateSection(segmentIDString, 'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/cell_identification?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string='),
        br(),
        br());
    
    const signal = new NullarySignal();
    signal.add(() => {contextMenu = undefined}) //absolutely no idea if this will work but this is my best guess for right now???
    contextMenu.closed = signal;
    return contextMenu;
  }
}

export function liveNeuroglancerInjection(lightbulb : LightBulbService) {
  const watchNode = document.querySelector('#content');
  if (!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode, lightbulb);
}

function observeSegmentSelect(targetNode : Element, lightbulb : LightBulbService) {  
  // Select the node that will be observed for mutations
  if (!targetNode) {
    return;
  }

  // Options for the observer (which mutations to observe)
  const config = {childList: true, subtree: true};
  let datasetElement = (<HTMLElement>targetNode.querySelector('.neuroglancer-layer-item-label'));
  let dataset = ""
  if (dataset) {
    dataset = datasetElement.innerText;
  }

  const placeLightbulb = function(item: HTMLElement) {
    if (item.classList) {
      let buttonList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-segment-list-entry")) {
        buttonList = [item];
      }

      buttonList.forEach(item => {
        const segmentIDString =
            item.getAttribute('data-id');

        if (segmentIDString) {
          let bulb = item.querySelector('.nge-lightbulb-section.menu');
          if (bulb == null) {
            bulb = lightbulb.createButton(segmentIDString);
            
            bulb.classList.add('error')
            item.appendChild(bulb);
            (<HTMLButtonElement>bulb).title = 'Click for opening context menu';
          }
        }
      })
    }
  };

  // Callback function to execute when mutations are observed
  const detectMutation = function(mutationsList: MutationRecord[]) {

    mutationsList.forEach(mutation => {
      mutation.addedNodes.forEach(placeLightbulb)
    });
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(detectMutation);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
}