import {ContextMenu} from 'neuroglancer/ui/context_menu';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'third_party/neuroglancer/util/special_protocol_request';
import { defaultCredentialsManager } from "neuroglancer/credentials_provider/default_manager";
import { responseJson } from "neuroglancer/util/http_request";
import {makeIcon} from 'neuroglancer/widget/icon';

import './bulb.css';


import lightbulbBase from "../images/lightbulb-base.svg";

const br = () => document.createElement('br');

export class LightBulbService {


  createButton(segmentIDString: string):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    bulb.className = 'nge-lightbulb menu';
    bulb.style.backgroundColor = 'transparent';
    bulb.style.color = 'green'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";

    //set default icon
    let element: HTMLElement;
    element = makeIcon({svg: lightbulbBase});
    element.className = "neuroglancer-icon-bulb-base" //spacign between lines is changing
    
    bulb.appendChild(element);

    //swap icon
    (async () => {
      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
          defaultCredentialsManager,
      );  
      await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
        if (res["proofread"]["0"] === "t") {
          element.className += " green"
        } else {
          element.className += " yellow"
        }
      });
    })();

    bulb.addEventListener('click', (event: MouseEvent) => {
      let menu = this.makeMenu(bulb, segmentIDString)
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