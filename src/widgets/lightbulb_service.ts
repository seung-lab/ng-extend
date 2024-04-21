import {ContextMenu} from 'neuroglancer/unstable/ui/context_menu.js';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/unstable/util/special_protocol_request.js';
import { defaultCredentialsManager } from "neuroglancer/unstable/credentials_provider/default_manager.js";
import {makeIcon} from 'neuroglancer/unstable/widget/icon.js';
import {responseJson } from 'neuroglancer/unstable/util/http_request.js';
import JSONbigInt from 'json-bigint';
import './bulb.css';
import lightbulbBase from '!svg-inline-loader!#src/images/lightbulb-base.svg';

const br = () => document.createElement('br');
const JSONBS = JSONbigInt({storeAsString: true});

function responseJsonString(response: Response): Promise<any> {
  return response.text()
}

//timer refresh
export class LightBulbService {

  timeout = 0;
  checkTime = 120000;
  statuses: {
    [key: string]: {
      sid: string; element: HTMLElement; button: HTMLButtonElement;
      // state?: any;
      status: 'error' | 'deselected' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  colorBulbs(): void {

    console.log("COLORING BULBS <___---------");

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
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring, //720575941553301220
          // 'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + '720575941575526745', //720575941553301220
          defaultCredentialsManager,
      );  

      // JSONBS.parse(await (  < {status: string; value: any;} >cell) .value.text())
      try {
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString).then((val : string) => {
          return val;
        })));

        console.log(nodeStatuses)

        for(let nodeIndex in nodeStatuses["index"]) {
          // console.log("TEST: + " + nodeStatuses["pt_root_id"][nodeIndex]);
          // console.log(this.statuses)
          // const element = this.statuses[nodeStatuses["pt_root_id"][nodeIndex]]["element"]
          if (nodeStatuses["proofread"][nodeIndex] === "t") {
            console.log("SETTING " + nodeStatuses["pt_root_id"][nodeIndex] + " to green")
            this.statuses[nodeStatuses["pt_root_id"][nodeIndex]]["element"].className = "neuroglancer-icon-bulb-base green"//purple - proofread but unlabeled
          } else {
            this.statuses[nodeStatuses["pt_root_id"][nodeIndex]]["element"].className = "neuroglancer-icon-bulb-base yellow"
          }
          console.log("CHANGED CLASS NAME");
        }

      } catch(e) {
        console.log("FALIED TO GET VALUE")
        console.log(e.message)
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


  createButton(segmentIDString: string):
      HTMLButtonElement {
    

    if(segmentIDString in this.statuses) {
      return this.statuses[segmentIDString]["button"]
    }
    // Button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    bulb.className = 'nge-lightbulb menu';
    bulb.style.backgroundColor = 'transparent';
    bulb.style.color = 'green'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";

    //set default icon
    let iconElement: HTMLElement;
    iconElement = makeIcon({svg: lightbulbBase});
    iconElement.className = "neuroglancer-icon-bulb-base purple" //spacign between lines is changing
    console.log("MAKING BUTTON FOR: " + segmentIDString);
    
    bulb.appendChild(iconElement);

    bulb.addEventListener('click', (event: MouseEvent) => {
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
            'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
            defaultCredentialsManager,
        );  
        await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
            popup_body.textContent = "Segment information: " + JSON.stringify(res); //replace with json bigint
        });
    })();
    
    return popup_body;
  }

  makeMenu(
    parent: HTMLElement, segmentIDString: string,
  ): ContextMenu {
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