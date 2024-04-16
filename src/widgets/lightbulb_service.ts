import {ContextMenu} from 'neuroglancer/ui/context_menu';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'third_party/neuroglancer/util/special_protocol_request';
import { defaultCredentialsManager } from "neuroglancer/credentials_provider/default_manager";
import { responseJson } from "neuroglancer/util/http_request";
import {makeIcon} from 'neuroglancer/widget/icon';


import JSONbigInt from 'json-bigint';
import './bulb.css';
import lightbulbBase from "../images/lightbulb-base.svg";

const br = () => document.createElement('br');
const JSONBS = JSONbigInt({storeAsString: true});

// function responseJsonCustom(response: Response): Promise<any> {
//   return JSONBS.parse(JSON.stringify(response.json()));
// }

export class LightBulbService {

  statuses: {
    [key: string]: {
      sid: string; element: HTMLButtonElement;
      // state?: any;
      // status: 'error' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  wipeSegments(): void {
    this.statuses = {};
  }

  colorBulbs(): void {
    var sidstring = ""
    Object.values(this.statuses).forEach((segments) => {
      const {sid} = segments
      sidstring += sid + ','

    });

    // console.log("SIDSTRING:" + sidstring);

    if(sidstring.length == 0) {
      return;
    };

    sidstring = sidstring.slice(0,-1);

    //swap icon
    (async () => {
      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + 	'720575941614811349,720575941575526745', //720575941553301220
          // 'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + '720575941575526745', //720575941553301220
          defaultCredentialsManager,
      );  

      // JSONBS.parse(await (  < {status: string; value: any;} >cell) .value.text())
      try {
        const value = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJson).then((val : string) => {
          console.log("val: ");
          console.log(val)
          console.log(typeof (val))
          return val;
        }) ));
        console.log("GOT VALUE")
        console.log(value)
      } catch(e) {
        console.log("FALIED TO GET VALUE")
        console.log(e.message)
      }
      
      
      /*await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
        
        console.log(res)
        const json = JSON.stringify(res) //parse me :)
        // console.log(res)
        console.log(json + " JSON <-----------" + ", SID" + sidstring);
        console.log(res["index"]);
        console.log(res[""])

        // for(let index in res["index"]) {
          // console.log("TEST: + " + res["pt_root_id"][index]);
          // const element = this.statuses[res["pt_root_id"][index]]["element"]
          // if (res["proofread"][index] === "t") {
          //   element.className = "neuroglancer-icon-bulb-base green"//purple - proofread but unlabeled
          // } else {
          //   element.className = "neuroglancer-icon-bulb-base"
          // }
        // }
      });*/
    })();
  }

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

    if(!(segmentIDString in this.statuses)) {
      this.statuses[segmentIDString] = {sid: segmentIDString , element: bulb};
    }

    //swap icon
    // (async () => {
    //   const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
    //       'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
    //       defaultCredentialsManager,
    //   );  
    //   await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
    //     if (res["proofread"]["0"] === "t") { //green - proofread and cell identified, black - outdated, 
    //       element.className += " green"//purple - proofread but unlabeled
    //     } else {
    //       element.className += " yellow"
    //     }
    //   });
    // })();

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
    //https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=<COMMA SEPERATED VALUES>

    // (async () => {
    //     const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
    //         'middleauth+https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/proofreading_status/root_id/' + segmentIDString, //720575941553301220
    //         defaultCredentialsManager,
    //     );  
    //     await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson).then((res) => {
    //         popup_body.textContent = "Segment information: " + JSON.stringify(res); //replace with json bigint
    //     });
    // })();
    
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