import { ContextMenu } from 'neuroglancer/unstable/ui/context_menu.js';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/unstable/util/special_protocol_request.js';
import { defaultCredentialsManager } from "neuroglancer/unstable/credentials_provider/default_manager.js";
import { makeIcon } from 'neuroglancer/unstable/widget/icon.js';
// import { responseJson } from 'neuroglancer/unstable/util/http_request.js';
import JSONbigInt from 'json-bigint';

/* TODO: Can we set color by adjusting the fill of an element in the SVG? */
import './bulb.css';

import lightbulb_base_svg from '!svg-inline-loader!#src/images/lightbulb-base.svg';
// import lightbulb_purple_svg from '!svg-inline-loader!#src/images/lightbulb-purple.svg';
// import lightbulb_green_svg from '!svg-inline-loader!#src/images/lightbulb-green.svg';
// import lightbulb_yellow_svg from '!svg-inline-loader!#src/images/lightbulb-yellow.svg';

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
      sid: string;
      element: HTMLElement;
      button: HTMLButtonElement;
      // state?: any;
      status: 'error' | 'deselected' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  colorBulbs(): void {

    var sidstring = "";
    Object.values(this.statuses).forEach((segments) => {
      const {sid} = segments;
      sidstring += sid + ',';

    });

    if(sidstring.length == 0) {
      return;
    };

    sidstring = sidstring.slice(0,-1);

    //swap icon
    (async () => {
      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring,
          defaultCredentialsManager,
      );  

      try {
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString).then((val : string) => {
          return val;
        })));

        console.log(nodeStatuses)

        for(let nodeIndex in nodeStatuses["index"]) {
          let elem = this.statuses[nodeStatuses["pt_root_id"][nodeIndex]]["element"]
          // let button = this.statuses[nodeStatuses["pt_root_id"][nodeIndex]]["button"]
          if (nodeStatuses["proofread"][nodeIndex] === "t") {
            elem.className = "neuroglancer-icon bulb green";

          } else {
            console.log("Setting " + nodeStatuses["pt_root_id"][nodeIndex] + " to yellow")
            // button.appendChild(makeIcon({svg: lightbulb_yellow_svg}))
            elem.className = "neuroglancer-icon bulb yellow"
          }
        }

      } catch(e) {
        console.log("Failed to fetch value" + e.message)
      }
    })();

    this.checkTimeout();
  }


  checkTimeout(time: number = this.checkTime) {
    clearTimeout(this.timeout);
    const boundCheck = this.colorBulbs.bind(this);
    this.timeout = window.setTimeout(boundCheck, time);
  }

  stopTimeout() {
    clearTimeout(this.timeout);
  }


  createButton(segmentIDString: string): HTMLButtonElement {
    if(segmentIDString in this.statuses) {
      return this.statuses[segmentIDString]["button"]
    }
    // Button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    // bulb.className = 'lightbulb menu';
    bulb.style.backgroundColor = 'transparent';
    bulb.style.color = 'green'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";
    bulb.style.height = '16px'
    bulb.style.width = '16px'

    //set default icon
    let iconElement: HTMLElement;
    iconElement = makeIcon({svg: lightbulb_base_svg});
    // for a CSS-based approach?
    iconElement.className = "neuroglancer-icon bulb";
    (iconElement.firstElementChild as SVGElement).style.fill = "unset";
    
    bulb.appendChild(iconElement);

    bulb.addEventListener('click', (event: MouseEvent) => {
      // TODO: Make sure we destroy the menu as well
      let menu = this.makeMenu(bulb, segmentIDString)
      menu.show(
          <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY}
      )
    });

    if(!(segmentIDString in this.statuses)) {
      this.statuses[segmentIDString] = {sid: segmentIDString , element: iconElement,button: bulb, status: "error"};
    }

    this.checkTimeout(0);

    return bulb;
  };

  generateSection(segmentIDString : string) : HTMLDivElement{
    const popup_body = document.createElement('div');

    // const url = "https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/";
    // https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=<COMMA SEPERATED VALUES>

    (async () => {
        const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
            'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString,
            defaultCredentialsManager,
        );
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString).then((val : string) => {
          return val;
        })));

        popup_body.textContent = "Segment infoirmation: " + JSONBS.stringify(nodeStatuses);
    })();

    return popup_body;
  }

  makeMenu(parent: HTMLElement, segmentIDString: string): ContextMenu {
    const contextMenu = new ContextMenu(parent);
    const menu = contextMenu.element;
    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    menu.append(
        br(),
        this.generateSection(segmentIDString),
        br(),
        br());
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