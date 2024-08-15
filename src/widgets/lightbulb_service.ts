import { ContextMenu } from 'neuroglancer/unstable/ui/context_menu.js';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/unstable/util/special_protocol_request.js';
import { defaultCredentialsManager } from "neuroglancer/unstable/credentials_provider/default_manager.js";
import { makeIcon } from 'neuroglancer/unstable/widget/icon.js';
// import {vec3} from 'neuroglancer/unstable/util/geom.js';
import JSONbigInt from 'json-bigint';
// import {Position} from 'neuroglancer/unstable/navigation_state.js'


import './bulb.css';
import './menu.css';
import lightbulb_base_svg from '!svg-inline-loader!#src/images/lightbulb-base.svg';
import { Viewer } from 'neuroglancer/unstable/viewer.js';

const br = () => document.createElement('br');
const JSONBS = JSONbigInt({storeAsString: true});

/* Alternate to responseJson, which would break segmetn IDs */
function responseJsonString(response: Response): Promise<any> {
  return response.text()
}


// https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/info
// {"cell_identification":true,"proofreading_status":true}


//https://global.daf-apis.com/info/api/v2/ngl_info

//cave.fancy-fly.com/ +neurons/api/v1/datastack      name = brain and nerve cord

//https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/


export class LightBulbService {

  timeout = 0;
  checkTime = 120000;
  //'graphene://middleauth+https://cave.fanc-fly.com/segmentation/table/wclee_fly_cns_001'
  dataset_url = ""//= "https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/";
  // dataset_url = "https://cave.fanc-fly.com/neurons/api/v1/datastack/brain_and_nerve_cord/";
  viewer : Viewer;
  statuses: {
    [key: string]: {
      sid: string; //root id
      element: HTMLElement; //svg image
      button: HTMLButtonElement; //button containing element with svg image
      menu: ContextMenu | null;
      identification_menu: ContextMenu | null;
      proofreading_menu: ContextMenu | null; //maybe revert to a single meny for the whole class?
      //error: something is wrong
      //noinfo: neither proofread or identified
      //outdated: placeholder or not proofread or identified
      //incomplete: not proofread but identified
      //unlabeled: proofread but not identified
      //complete: both
      status: 'error' | 'noinfo' | 'outdated' | 'incomplete' | 'unlabeled' | 'complete'
    }
  } = {};

  constructor(viewer : Viewer, segmentation_name : string) {
    this.viewer = viewer;
    (async () =>  {
      // this.dataset_url = this.getDatasetURL(segmentation_name);
      const name = await this.getDatasetName(segmentation_name);
      this.dataset_url = "https://cave.fanc-fly.com/neurons/api/v1/datastack/" + name + "/";
      
      this.checkTimeout(0);
    })();
  }

  async findDatasetURL(dataset_name : string) : Promise<string>{

    const dataset_name_query_url = "https://global.daf-apis.com/info/api/v2/ngl_info";
    
    const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
      'middleauth+'+ dataset_name_query_url,
      defaultCredentialsManager,
    );

    const all_response_datasets = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));
    return all_response_datasets[dataset_name]["segmentation_layers"][0]["name"];
  
  }

  async getDatasetName(segmentation_name : string) : Promise<string>{
    const json_query_url = "https://global.daf-apis.com/sticky_auth/api/v1/service/pychunkedgraph/table/" + segmentation_name + "/dataset?middle_auth_url=global.daf-apis.com%2Fsticky_auth";

    let {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
      'middleauth+'+ json_query_url,
      defaultCredentialsManager,
    );
    const dataset_name = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));

    return this.findDatasetURL(dataset_name)
  }

  checkNodeStatuses(): void {
    if(this.dataset_url === "") {
      return;
    }

    var sidstring = "";
    Object.values(this.statuses).forEach((segments) => {
      const {sid} = segments;
      sidstring += sid + ',';
    });

    if(sidstring.length == 0)
      return;

    sidstring = sidstring.slice(0,-1);


    (async () => { //proofreading status

      if(!await(this.checkServiceExists("proofreading_status"))) {
        return;
      }

      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+'+ this.dataset_url +'proofreading_status?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring,
          defaultCredentialsManager,
      );  
      try {
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));
        //for each node returned from the service
        for(let nodeIndex in nodeStatuses["index"]) {
          let rootid = nodeStatuses["pt_root_id"][nodeIndex]

          if (nodeStatuses["proofread"][nodeIndex] === "t" 
                  && (this.statuses[rootid]["status"] === 'outdated' 
                  || this.statuses[rootid]["status"] === 'noinfo')) {

            //if proofread and marked as outdated, mark as unlabeled
            this.statuses[rootid]["status"] = "unlabeled";
          } else if(nodeStatuses["proofread"][nodeIndex] === "t" 
                  && this.statuses[rootid]["status"] === 'incomplete'){

            //if proofread and marked as incomplete, mark as complete
            this.statuses[rootid]["status"] = "complete";
          
          } else if(nodeStatuses["proofread"][nodeIndex] !== "t" 
                  && this.statuses[rootid]["status"] === "unlabeled"){
            
            //if not proofread and marked as unlabeled, mark as outdated (our info has changed)
            this.statuses[rootid]["status"] = 'outdated';
          } else if(nodeStatuses["proofread"][nodeIndex] !== "t" 
                  && this.statuses[rootid]["status"] === "outdated") {

            //if not proofread or identified
            this.statuses[rootid]["status"] = 'noinfo';
          }
        }
      } catch(e) {
        console.log("Failed to fetch info" + e.message)
      }
      //update colors based on new information

      Object.values(this.statuses).forEach((segments) => {
        const {sid} = segments;
        console.log(this.statuses[sid]["status"] + ", " + sid)
        if(this.statuses[sid]["status"] === "outdated") {
          this.statuses[sid]["status"] = "noinfo";
        }
      });
      this.colorBulbs();
    })();

    (async () => { //cell identification status

      if(!await(this.checkServiceExists("cell_identification"))) {
        return;
      }

      const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
          'middleauth+'+ this.dataset_url +'cell_identification?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=' + sidstring,
          defaultCredentialsManager,
      );  
      try {

        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));
        //for each node returned from the service

        for(let nodeIndex in nodeStatuses["id"]) {
          let rootid = nodeStatuses["pt_root_id"][nodeIndex]
          if (nodeStatuses["valid"][nodeIndex] === "t" 
                  && (this.statuses[rootid]["status"] === 'outdated'
                  || this.statuses[rootid]["status"] === 'noinfo')) {

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
          } else if(nodeStatuses["valid"][nodeIndex] !== "t" 
                  && this.statuses[rootid]["status"] === "outdated"){
            
            //if cell is not identified and marked as incomplete, mark as outdated (our info has changed)
            this.statuses[rootid]["status"] = 'noinfo'
          } 
        }
      } catch(e) {
        console.log("Failed to fetch info " + e)
      }

      Object.values(this.statuses).forEach((segments) => {
        const {sid} = segments;
        if(this.statuses[sid]["status"] === "outdated") {
          this.statuses[sid]["status"] = "noinfo";
        }
      });

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
        case 'noinfo':
          this.statuses[sid]["element"].className = "neuroglancer-icon bulb gray";
          break;
        //TODO??? case unselected
      }
      
    });
  }

  
  async checkServiceExists(service_name : string) : Promise<boolean> {
    // return true;
    const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
      'middleauth+'+ this.dataset_url +'info',
      defaultCredentialsManager,
    );

    return JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)))[service_name];
  }

  async getFromInfoJson(information_json_link : string) : Promise<string> {

    const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
      'middleauth+'+ this.dataset_url +'info',
      defaultCredentialsManager,
    );

    return JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJsonString)))[information_json_link];
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

        
    // const pos = new Position("a");

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

    this.statuses[segmentIDString] = {sid: segmentIDString , element: iconElement,button: bulb, menu: null, identification_menu:null, proofreading_menu:null, status: "outdated"};

    if(this.dataset_url !== "") {
      this.checkTimeout(0);
    }

    return bulb;
  };

  generateSection(sectionTitle : string, segmentIDString : string, queryURL: string, parseJson : Function) : HTMLDivElement{
    const popup_body = document.createElement('div');
    const title_div = document.createElement('div');
    title_div.className = "neuroglancer-layer-group-viewer-context-menu-title-label"
    title_div.textContent = sectionTitle;
    const content_body = document.createElement('div');
    content_body.className = "neuroglancer-layer-group-viewer-context-menu-body-element";

    (async () => {
        const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(
            queryURL + segmentIDString,
            defaultCredentialsManager,
        );
        const nodeStatuses = JSONBS.parse(await(cancellableFetchSpecialOk(credentialsProvider,parsedUrl,{},responseJsonString)));
        content_body.textContent = parseJson(nodeStatuses);
    })();

    popup_body.appendChild(title_div).appendChild(content_body);
    return popup_body;
  }

  // dataset_url/mark_completion?location=500,500,700&valid_id=123455

  generateButtonLink(parent : HTMLElement,segmentIDString : string, menuType : string, makeMenuSections : Function, makeSubmitableContent : Function, buttonMessage : string, color: string) : HTMLDivElement {
    const button_holder = document.createElement('div');
    const button_link = document.createElement('button');
    button_link.textContent = buttonMessage;
    button_link.style.backgroundColor = color;

    button_link.className = "neuroglancer-layer-group-viewer-context-menu-button-element"
    button_link.addEventListener("click", (event: MouseEvent) => {

      // const coords = this.viewer.navigationState.position.value;
      // let coordsString = ""
      // coords.forEach(coord => {
      //   coordsString += Math.round(coord) + ","
      // });
      // coordsString = coordsString.slice(0,-1);

      // const url = linkStart + "location=" + coordsString + "&valid_id=" + segmentIDString;
      // window.open(url, '_blank');
      let menu = this.makeSubmissionMenu(this, parent, segmentIDString, menuType, makeMenuSections, makeSubmitableContent);
      menu.show(<MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY});

    });

    


    // const link = document.createElement('a');
    // link.href = linkStart + "location=" + coordsString + "&valid_id=" + segmentIDString;
    // link.text = linkMessage;
    // link.target = "_blank";
    button_holder.appendChild(button_link);
    return button_holder;
  }

  makeMenu(parent: HTMLElement, segmentIDString: string): ContextMenu {

    let contextMenu : ContextMenu;
    if(this.statuses[segmentIDString]["menu"] === null) {
      contextMenu = new ContextMenu(parent);
      this.statuses[segmentIDString]["menu"] = contextMenu;
    } else {
      contextMenu = (this.statuses[segmentIDString]["menu"] as ContextMenu);
    }
    
    const menu = contextMenu.element;
    menu.innerHTML = "";

    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    const parseCompletion = function(response : any) : String {
      if(response["valid"]["0"] === "t" && response["proofread"]["0"] === "t") {
        return "proofread"
      }
      return "not proofread";
    }

    const parseIdentification = function(response : any) : String {
      if(response["valid"]["0"] === "t") {
        return  response["tag"]["0"] + ", " + response["tag2"]["0"];
      }
      return "not identified"
    }

    menu.append(
        br(),
        this.generateSection("Cell Identification",segmentIDString, 'middleauth+' + this.dataset_url + 'cell_identification?filter_by=root_id&as_json=1&ignore_bad_ids=True&filter_string=',parseIdentification),
        this.generateButtonLink(parent,segmentIDString, "identification_menu", this.generateIdentificationSection, this.generateIdentificationButtons,"identify cell", "purple"),
        br(),
        br(),
        br(),
        this.generateSection("Completion Status",segmentIDString, 'middleauth+' + this.dataset_url + 'proofreading_status/root_id/', parseCompletion),
        this.generateButtonLink(parent, segmentIDString, "proofreading_menu", this.generateProofreadingSection, this.generateProofreadingButtons, "mark completion", "green"),
        br(),
        br());

    return contextMenu;
  }


  generateIdentificationSection(self : LightBulbService) : HTMLDivElement{
    const text_holder = document.createElement('div');
    const title_div = document.createElement('div');
    title_div.className = "neuroglancer-layer-group-viewer-context-menu-title-label";
    title_div.textContent = "Submit Cell Identification";

    const content_body = document.createElement('form');
    content_body.style.maxWidth = "480px";
    content_body.className = "neuroglancer-layer-group-viewer-context-menu-body-element";

    const content_str = "Enter name(s) of this cell including any synonyms or abbreviations "
              + "and source of name, if known.\nAll information is helpful; if you're not certain,"
              + " just add \"putative\" or \"resembles\" or describe your level of certainty."
              + "\nExample 1: putative giant fiber neuron, giant fibre neuron (Power 1948), GF,"
              + " GFN.\nExample 2: X9238J (new cell type named in ongoing Smith lab project)";

    const alternate_content_str = "Enter the name of this cell and press submit.\nFor more information on how to submit"
              + " cell identification, please review the guide:";

    

    (async () => {
      const betterContent = await self.getFromInfoJson("cell_identification_help");
      if(betterContent != null) {
        content_body.innerHTML = "";
        self.generateSubmissionSectionHTML(alternate_content_str, content_body);

        const link_elem = document.createElement('a');
        link_elem.href = betterContent
        link_elem.text = "guide";
        link_elem.target = "_blank";

        content_body.appendChild(link_elem);
      }
    })();
    self.generateSubmissionSectionHTML(content_str, content_body);

    // text_holder.appendChild(title_div).appendChild(content_body);
    text_holder.appendChild(title_div);
    text_holder.appendChild(content_body);
    return text_holder;
  }

  generateIdentificationButtons(parent : ContextMenu) : HTMLDivElement{
    const content = document.createElement('div')
    const button_holder = document.createElement('div');
    button_holder.style.display = "flex";

    const text_box = document.createElement('textarea');
    text_box.style.width = "480px";
    text_box.style.height = "120px";
    content.appendChild(text_box);

    const button_submit = document.createElement('button');
    const button_cancel = document.createElement('button');

    button_submit.textContent = "submit";
    button_submit.style.backgroundColor = "rgb(15 177 139)";
    button_cancel.textContent = "cancel";
    button_cancel.style.backgroundColor = "rgb(15 177 139)";

    button_submit.className = "neuroglancer-layer-group-viewer-context-menu-button-element"
    button_submit.addEventListener("click", () => {
      console.log("THIS WILL SUBMIT " + text_box.value);
    });

    button_cancel.className = "neuroglancer-layer-group-viewer-context-menu-button-element"
    button_cancel.addEventListener("click", () => {
      parent.hide();
    });
    button_cancel.style.marginLeft = "5px";

    button_holder.appendChild(button_submit);
    button_holder.appendChild(button_cancel);
    content.appendChild(button_holder)

    return content;
  }


  generateProofreadingSection(self : LightBulbService) : HTMLDivElement{
    const text_holder = document.createElement('div');
    const title_div = document.createElement('div');
    title_div.className = "neuroglancer-layer-group-viewer-context-menu-title-label";
    title_div.textContent = "Mark Complete";

    const content_str = "To mark proofreading of this cell as complete:"
              +"\n - 1: Are the crosshairs centered inside a distinctive"
              + "backbone?\n - 2: Has each backbone been examined or proofread, "
              + "showing no remaining obvious truncations or accidental mergers?";

    const alternate_content_str = "Before marking a cell as complete, make sure each backbone has been thoroughly examined\n for more information, please review the guide:"

          
    const content_body = document.createElement('form');
    content_body.style.maxWidth = "480px";
    content_body.className = "neuroglancer-layer-group-viewer-context-menu-body-element";

    (async () => {
      const betterContent = await self.getFromInfoJson("proofreading_help");
      if(betterContent != null) {
        content_body.innerHTML = "";
        self.generateSubmissionSectionHTML(alternate_content_str, content_body);

        const link_elem = document.createElement('a');
        link_elem.href = betterContent
        link_elem.text = "guide";
        link_elem.target = "_blank";

        content_body.appendChild(link_elem);
      }
    })();

    self.generateSubmissionSectionHTML(content_str, content_body);

    text_holder.appendChild(title_div).appendChild(content_body);
    text_holder.appendChild(title_div);
    text_holder.appendChild(content_body);
    return text_holder;
  }

  generateProofreadingButtons(parent : ContextMenu) : HTMLDivElement{
    const button_holder = document.createElement('div');
    button_holder.style.display = "flex";

    const button_submit = document.createElement('button');
    const button_cancel = document.createElement('button');

    button_submit.textContent = "submit";
    button_submit.style.backgroundColor = "rgb(15 177 139)";
    button_cancel.textContent = "cancel";
    button_cancel.style.backgroundColor = "rgb(15 177 139)";

    button_submit.className = "neuroglancer-layer-group-viewer-context-menu-button-element"
    button_submit.addEventListener("click", () => {
      console.log("THIS WILL SUBMIT");
    });

    button_cancel.className = "neuroglancer-layer-group-viewer-context-menu-button-element"
    button_cancel.addEventListener("click", () => {
      parent.hide();
    });
    button_cancel.style.marginLeft = "5px";

    button_holder.appendChild(button_submit);
    button_holder.appendChild(button_cancel);
    return button_holder;
  }

  generateSubmissionSectionHTML(content : string, content_body : HTMLFormElement) : HTMLFormElement{

    let nextLine = -1;
    while(true) {

      const paragraph = document.createElement("p");
      paragraph.className = "neuroglancer-layer-group-viewer-context-menu-body-element";

      const newNextLine = content.indexOf("\n", nextLine+1);
      
      if(newNextLine == -1) {
        paragraph.textContent = content.substring(nextLine);
        content_body.appendChild(paragraph);
        break;
      }
      paragraph.textContent = content.substring(nextLine, newNextLine);
      content_body.appendChild(paragraph);
      nextLine = newNextLine;
    }

    return content_body
  }

  makeSubmissionMenu(self : LightBulbService, parent: HTMLElement, segmentIDString : string, menuType : string, makeSection : Function, createSubmissionContent: Function) : ContextMenu{
    console.log("STATUS: SID" + segmentIDString);

    let contextMenu : ContextMenu;
    if(menuType !== "proofreading_menu" && menuType !== "identification_menu") {
      throw new Error("this menu does not exist and cannot be created");
    }
    if(this.statuses[segmentIDString][menuType] === null) {
      contextMenu = new ContextMenu(parent);
      this.statuses[segmentIDString][menuType] = contextMenu;
    } else {
      contextMenu = (this.statuses[segmentIDString][menuType] as ContextMenu);
    }
    
    const menu = contextMenu.element;
    menu.innerHTML = "";

    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');

    menu.append(
        br(),
        makeSection(self),
        br(),
        br(),
        createSubmissionContent(contextMenu),
        br(),);

    return contextMenu;
  }

  // async isCoordInRoot(rootID : string): Promise<Boolean> {
  //   const source = Uint64.parseString(rootID);
  //   const mLayer = this.viewer.selectedLayer.layer;
  //   if (mLayer == null) return false;
  //   const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
  //   const {viewer} = this;
  
  //   const selection = layer.getValueAt(
  //       viewer.navigationState.position.spatialCoordinates,
  //       new MouseSelectionState());
  
  //   // get root of supervoxel
  //   const response = await authFetch(`${layer.chunkedGraphUrl}/node/${
  //       String(selection)}/root?int64_as_str=1`);
  //   const jsonResp = await response.json();
  //   const root_id = Uint64.parseString(jsonResp['root_id']);
  //   // compare this root id with the one that initiated the check
  //   return !Uint64.compare(source, root_id);
  // }
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