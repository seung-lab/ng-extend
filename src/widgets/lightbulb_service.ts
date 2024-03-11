import {ContextMenu} from 'neuroglancer/ui/context_menu';
// import {SubmitDialog} from './seg_management';

const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void))[][];

export interface Point3D {
    x: string;
    y: string;
    z: string;
}

export class LightBulbService {
  createButton(segmentIDString: string, dataset: string):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const button = document.createElement('button');
    button.className = 'nge-segment-button menu';
    button.title = `Open Segment: ${segmentIDString} in Synapse Proofreading System`;
    button.style.backgroundColor = 'transparent';
    button.style.border = 'none';
    button.style.boxShadow = 'none';
    button.style.cursor = "pointer";

    // Create an SVG element for the star icon source: http://svgicons.sparkk.fr/
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('viewBox', '0 0 20 20');

    // Create a path element for the star shape
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', "M3.936,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021S5.957,11.116,5.957,10S5.052,7.979,3.936,7.979z M3.936,11.011c-0.558,0-1.011-0.452-1.011-1.011s0.453-1.011,1.011-1.011S4.946,9.441,4.946,10S4.494,11.011,3.936,11.011z M16.064,7.979c-1.116,0-2.021,0.905-2.021,2.021s0.905,2.021,2.021,2.021s2.021-0.905,2.021-2.021S17.181,7.979,16.064,7.979z M16.064,11.011c-0.559,0-1.011-0.452-1.011-1.011s0.452-1.011,1.011-1.011S17.075,9.441,17.075,10S16.623,11.011,16.064,11.011z M10,7.979c-1.116,0-2.021,0.905-2.021,2.021S8.884,12.021,10,12.021s2.021-0.905,2.021-2.021S11.116,7.979,10,7.979z M10,11.011c-0.558,0-1.011-0.452-1.011-1.011S9.442,8.989,10,8.989S11.011,9.441,11.011,10S10.558,11.011,10,11.011z");
    path.setAttribute('stroke', 'white'); // Set the outline color to white
    path.setAttribute('stroke-width', '1'); // Set the outline thickness

    // Append the path element to the SVG
    icon.appendChild(path);

    // Append the SVG to the button
    button.appendChild(icon);

    // Add a click event listener to the button
    button.addEventListener('click', (event: MouseEvent) => {
        // Redirect to Google.com when the button is clicked
        // window.open('https://www.google.com', '_blank');
      let menu = this.makeMenu(button, segmentIDString, dataset)
      menu.show(
          <MouseEvent>{clientX: event.clientX - 200, clientY: event.clientY}
      )
    });

    return button;
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

  // getUserDefinedTimestamp() {
  //   const mLayer = (<any>window).viewer.selectedLayer.layer;
  //   console.log(mLayer)
  //   if (mLayer == null) return;
  //   return mLayer.layer.displayState.timestamp.value;
  // };

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

    // const cleanOverlays = () => {
    //   const overlays = document.getElementsByClassName('nge-overlay');
    //   [...overlays].forEach(function(element) {
    //     try {
    //       (<any>element).dispose();
    //     } catch {
    //     }
    //   });
    // };
    // const handleDialogOpen = async (e: MouseEvent) => { // callback: Function
    //   e.preventDefault();
    //   // let spinner = new Loader();
    //   // if (timestamp == undefined) {
    //   //   timestamp = await this.getTimeStamp(segmentIDString);
    //   // }
    //   cleanOverlays();
    //   // spinner.dispose();
    //   // callback(parent.classList.contains('error'));
    // };
    // const currentTimeStamp = () => "timestamp";//timestamp;
    // timestamp will change but because the menu opt is static, if it
    // already exists then the user has defined a timestamp to use and the
    // field should be added
    // const linkTS = timestamp ? `&timestamp=${timestamp}` : '';
    // const dashTS = timestamp ? `&timestamp_field=${timestamp}` : '';

    let changelog =
        ['Change Log', `${host}/progress/api/v1/query?rootid=${paramStr}`];
    // If production data set
    // if (dataset == 'fly_v31') {
    //   optGroup.proofreading.push(SummaryDialog.generateMenuOption(
    //       handleDialogOpen, host, segmentIDString, currentTimeStamp));
    //   optGroup.analysis.push([
    //     'Connectivity',
    //     `${host}/dash/datastack/flywire_fafb_production/apps/fly_connectivity/?input_field=${
    //         segmentIDString}&cleft_thresh_field=50${dashTS}`,
    //   ]);
    //   optGroup.proofreading.push(changelog);
    //   optGroup.proofreading.push([
    //     'Cell Completion Details',
    //     `${host}/neurons/api/v1/lookup_info?filter_by=root_id&filter_string=${
    //         paramStr}${linkTS}`
    //   ]);
    //   /*
    //   optGroup.proofreading.push([
    //     'Cell Identification',
    //     `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
    //         paramStr}${linkTS}`
    //   ]);
    //   */
    //   optGroup.analysis.push(PartnersDialog.generateMenuOption(
    //       handleDialogOpen, host, segmentIDString, currentTimeStamp));
    //
    //   // the timestamp parameter is falsy if the user has defined a
    //   // timestamp
    //   if (!timestamp) {
    //     /*
    //     optGroup.proofreading.push(SubmitDialog.generateMenuOption(
    //         handleDialogOpen, host, segmentIDString, currentTimeStamp));
    //     optGroup.proofreading.push(CellIdDialog.generateMenuOption(
    //         handleDialogOpen, host, segmentIDString, currentTimeStamp));
    //     */
    //     if (parent.classList.contains('complete') ||
    //         parent.classList.contains('unlabeled')) {
    //       optGroup.proofreading.push(
    //           CellReviewDialog.generateMenuOption(
    //               handleDialogOpen, host, segmentIDString, currentTimeStamp),
    //       );
    //     }
    //   }
    // } else {
    // optGroup.proofreading.push(changelog);
    // }
      //
    optGroup.proofreading.push(changelog);
    // optGroup.proofreading.push(SubmitDialog.generateMenuOption(
    //     handleDialogOpen, host, segmentIDString));
    // optGroup.proofreading.push(changelog);
    // optGroup.proofreading.push([
    // 'Cell Identification',
    // `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
    //     paramStr}`
    // ]);
    // optGroup.synapseProofreading.push([
    //     'Synapse Proofreading',
    //     `https://www.google.com/search?q=${segmentIDString}`
    // ])

    // let markComplete = SubmitDialog.generateMenuOption(
    //     handleDialogOpen, host, segmentIDString);
    // console.log("markcomplete: =======", markComplete)
    // let identify = CellIdDialog.generateMenuOption(
    //     handleDialogOpen, host, segmentIDString, currentTimeStamp);
    // let details = CellDetailDialog.generateMenuOptionv2(
    //     handleDialogOpen, host, segmentIDString, currentTimeStamp,
    //     {...state, paramStr, linkTS});
    //
    // const {cell_id} = <any>(state || {});
    // let cellIDButtons = cell_id && cell_id.length ?
    //     [
    //       ['Details', 'blue', details[2]],
    //       ['Add New Identification', 'purple', identify[2]]
    //     ] :
    //     [['Identify', 'purple', identify[2]]];
    // let proofreadingButtons =
    //     ['incomplete', 'unlabeled', 'complete'].includes(status) ?
    //     [['Mark as Complete', 'green', markComplete[2]]] : // :
    //     [];

    // if (timestamp) {
    //   menu.append(
    //       br(),
    //       this.generateSection(
    //           'Timestamp Segmentation Active', [], [],
    //           () => `Certain Cell ID functions are
    //               disabled when a timestamp is active.`));
    //   // cellIDButtons = [];
    //   proofreadingButtons = [];
    // }
    menu.append(
        // br(), this.generateSection('Cell Identification', cellIDButtons, []),
        // br(), this.generateSection('Analysis', [], optGroup.analysis), br(),
        // this.generateSection(
        //     'Proofreading', proofreadingButtons, optGroup.proofreading,
        //     () => {
        //       switch (status) {
        //         case 'error':
        //           return 'Unknown';
        //         case 'outdated':
        //           return 'Outdated';
        //         case 'unlabeled':
        //         case 'complete':
        //           return 'Complete';
        //         default:
        //           return '';
        //       }
        //     },
        //     false), br(),
        this.generateSection('Proofreading', [], optGroup.proofreading),
        br(),
        // this.generateSection('Synapses', [], optGroup.synapseProofreading),
        // br(),
        br());
    return contextMenu;
  };
}