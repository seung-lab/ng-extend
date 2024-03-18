import {ContextMenu} from 'neuroglancer/ui/context_menu';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'third_party/neuroglancer/util/special_protocol_request';
import { defaultCredentialsManager } from "neuroglancer/credentials_provider/default_manager";
import { responseJson } from "neuroglancer/util/http_request";

// import {SubmitDialog} from './seg_management';

const br = () => document.createElement('br');
//type InteracblesArray = (string|((e: MouseEvent) => void))[][];

export class LightBulbService {
  createButton(segmentIDString: string, dataset: string):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const bulb = document.createElement('button');

    bulb.textContent = "Hello World!!!!!!!!! :D " + segmentIDString + ", " + dataset + "|";

    bulb.className = 'nge-lightbulb menu';
    bulb.style.backgroundColor = 'white';
    bulb.style.color = 'red'
    bulb.style.border = 'none';
    bulb.style.boxShadow = 'none';
    bulb.style.cursor = "pointer";

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
            popup_body.textContent = "Segment information: " + JSON.stringify(res);
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
  const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
  const host = 'https://local.brain-wire-test.org';
  // let timestamp: number|undefined = this.getUserDefinedTimestamp();
  // console.log("timestamp:", timestamp)
  let optGroup: any = {analysis: [], proofreading: [], synapseProofreading: []};

  let changelog =
      ['Change Log', `${host}/progress/api/v1/query?rootid=${paramStr}`];

  optGroup.proofreading.push(changelog);
  menu.append(
      br(),
      this.generateSection(segmentIDString),
      br(),
      br());
  return contextMenu;
  }
}