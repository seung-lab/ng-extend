import {ContextMenu} from 'neuroglancer/ui/context_menu';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'third_party/neuroglancer/util/special_protocol_request';
import { defaultCredentialsManager } from "neuroglancer/credentials_provider/default_manager";
import { responseJson } from "neuroglancer/util/http_request";

import * as lightbulbBase from "../images/lightbulb-base.svg"

// import {SubmitDialog} from './seg_management';

const br = () => document.createElement('br');
//type InteracblesArray = (string|((e: MouseEvent) => void))[][];

export class LightBulbService {

  status : string;

  constructor() {
  //   (async () => {
  //     const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
  //         'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
  //         defaultCredentialsManager,
  //     );  
  //     await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
  //       this.status = JSON.stringify(res);
  //     });
  // })();
  }

  createButton(segmentIDString: string, dataset: string):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    bulb.className = 'nge-lightbulb menu';
    bulb.style.backgroundColor = 'transparent';
    bulb.style.color = 'red'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";


    // const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // icon.setAttribute('width', '20');
    // icon.setAttribute('height', '20');
    // icon.setAttribute('viewBox', '0 0 20 20');

    console.log("BULB "+lightbulbBase)
    console.log("BULBBUOBUBO")
    const icon = document.createElement("img") as HTMLImageElement//('http://www.w3.org/2000/svg', 'svg');
    // icon.src = lightbulbBase.default
    icon.src = "../images/bulb.png"

    // const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // const path = document.createElement("img")//('http://www.w3.org/2000/svg', 'svg');
    // path.src = "images/lightbulb-base.svg"
    // path.setAttribute('d', "M3.936,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021S5.957,11.116,5.957,10S5.052,7.979,3.936,7.979z M3.936,11.011c-0.558,0-1.011-0.452-1.011-1.011s0.453-1.011,1.011-1.011S4.946,9.441,4.946,10S4.494,11.011,3.936,11.011z M16.064,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021s2.021-0.905,2.021-2.021S17.181,7.979,16.064,7.979z M16.064,11.011c-0.559,0-1.011-0.452-1.011-1.011s0.452-1.011,1.011-1.011S17.075,9.441,17.075,10S16.623,11.011,16.064,11.011z M10,7.979c-1.116,0-2.021,0.905-2.021,2.021S8.884,12.021,10,12.021s2.021-0.905,2.021-2.021S11.116,7.979,10,7.979z M10,11.011c-0.558,0-1.011-0.452-1.011-1.011S9.442,8.989,10,8.989S11.011,9.441,11.011,10S10.558,11.011,10,11.011z");
    // path.setAttribute('stroke', 'white'); // Set the outline color to white
    // path.setAttribute('stroke-width', '1'); // Set the outline thickness

    // Append the path element to the SVG, SVG to button
    // icon.appendChild(path);
    bulb.appendChild(icon);

    bulb.addEventListener('click', (event: MouseEvent) => {
      let menu = this.makeMenu(bulb, segmentIDString, dataset)
      menu.show(
          <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY}
      )
    });

    return bulb;
  };

  generateSection(segmentIDString : string) : HTMLDivElement{
    const popup_body = document.createElement('div');

    // const url = "https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/";

    (async () => {
        const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
            'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
            defaultCredentialsManager,
        );  
        await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
            popup_body.textContent = "Segment information: " + JSON.stringify(res); //replace with json bigint
        });
    })();
    
    // popup_body.textContent = "loading";
    return popup_body;
  }

  makeMenu(
    parent: HTMLElement, segmentIDString: string,
    dataset: string,
    // status: 'error'|'outdated'|'incomplete'|'unlabeled'|'complete',
    // state?: any
  ): ContextMenu {
  // console.log(status);
  const contextMenu = new ContextMenu(parent);
  const menu = contextMenu.element;
  menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
  menu.classList.add(
      'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');
  // let timestamp: number|undefined = this.getUserDefinedTimestamp();
  // console.log("timestamp:", timestamp)
  menu.append(
      br(),
      this.generateSection(segmentIDString),
      br(),
      br());
  return contextMenu;
  }
}