import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {SubmitDialog} from './seg_management';

const br = () => document.createElement('br');
type InteracblesArray = (string|((e: MouseEvent) => void))[][];

export class ButtonService {
  createButton(segmentIDString: string):
      HTMLButtonElement {
    // Button for the user to copy a segment's ID
    const button = document.createElement('button');
    button.className = 'nge-segment-synapse-proofread-button link';
    button.title = `Open Segment: ${segmentIDString} in Synapse Proofreading System`;
    button.style.backgroundColor = 'transparent';
    button.style.border = 'none';
    button.style.boxShadow = 'none';
    button.style.cursor = "pointer";

    // Create an SVG element for the star icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 16 16');

    // Create a path element for the star shape
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', "M16.469,8.924l-2.414,2.413c-0.156,0.156-0.408,0.156-0.564,0c-0.156-0.155-0.156-0.408,0-0.563l2.414-2.414c1.175-1.175,1.175-3.087,0-4.262c-0.57-0.569-1.326-0.883-2.132-0.883s-1.562,0.313-2.132,0.883L9.227,6.511c-1.175,1.175-1.175,3.087,0,4.263c0.288,0.288,0.624,0.511,0.997,0.662c0.204,0.083,0.303,0.315,0.22,0.52c-0.171,0.422-0.643,0.17-0.52,0.22c-0.473-0.191-0.898-0.474-1.262-0.838c-1.487-1.485-1.487-3.904,0-5.391l2.414-2.413c0.72-0.72,1.678-1.117,2.696-1.117s1.976,0.396,2.696,1.117C17.955,5.02,17.955,7.438,16.469,8.924 M10.076,7.825c-0.205-0.083-0.437,0.016-0.52,0.22c-0.083,0.205,0.016,0.437,0.22,0.52c0.374,0.151,0.709,0.374,0.997,0.662c1.176,1.176,1.176,3.088,0,4.263l-2.414,2.413c-0.569,0.569-1.326,0.883-2.131,0.883s-1.562-0.313-2.132-0.883c-1.175-1.175-1.175-3.087,0-4.262L6.51,9.227c0.156-0.155,0.156-0.408,0-0.564c-0.156-0.156-0.408-0.156-0.564,0l-2.414,2.414c-1.487,1.485-1.487,3.904,0,5.391c0.72,0.72,1.678,1.116,2.696,1.116s1.976-0.396,2.696-1.116l2.414-2.413c1.487-1.486,1.487-3.905,0-5.392C10.974,8.298,10.55,8.017,10.076,7.825");
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
      let menu = this.makeMenu(button, segmentIDString, 'error')
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
      // dataset: string,
      status: 'error'|'outdated'|'incomplete'|'unlabeled'|'complete',
      // state?: any
    ): ContextMenu {
    // console.log(status);
    const contextMenu = new ContextMenu(parent);
    const menu = contextMenu.element;
    menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
    menu.classList.add(
        'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');
    // const paramStr = `${segmentIDString}`//&dataset=${dataset}&submit=true`;
    const host = 'https://local.brain-wire-test.org';
    // let timestamp: number|undefined = this.getUserDefinedTimestamp();
    // console.log("timestamp:", timestamp)
    let optGroup: any = {analysis: [], proofreading: [], synapseProofreading: []};

    const cleanOverlays = () => {
      const overlays = document.getElementsByClassName('nge-overlay');
      [...overlays].forEach(function(element) {
        try {
          (<any>element).dispose();
        } catch {
        }
      });
    };
    const handleDialogOpen = async (e: MouseEvent) => { // callback: Function
      e.preventDefault();
      // let spinner = new Loader();
      // if (timestamp == undefined) {
      //   timestamp = await this.getTimeStamp(segmentIDString);
      // }
      cleanOverlays();
      // spinner.dispose();
      // callback(parent.classList.contains('error'));
    };
    // const currentTimeStamp = () => "timestamp";//timestamp;
    // timestamp will change but because the menu opt is static, if it
    // already exists then the user has defined a timestamp to use and the
    // field should be added
    // const linkTS = timestamp ? `&timestamp=${timestamp}` : '';
    // const dashTS = timestamp ? `&timestamp_field=${timestamp}` : '';

    // let changelog =
    //     ['Change Log', `${host}/progress/api/v1/query?rootid=${paramStr}`];
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
    optGroup.proofreading.push(SubmitDialog.generateMenuOption(
        handleDialogOpen, host, segmentIDString));
    // optGroup.proofreading.push(changelog);
    // optGroup.proofreading.push([
    // 'Cell Identification',
    // `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
    //     paramStr}`
    // ]);
    optGroup.synapseProofreading.push([
        'Synapse Proofreading',
        `https://www.google.com/search?q=${segmentIDString}`
    ])

    let markComplete = SubmitDialog.generateMenuOption(
        handleDialogOpen, host, segmentIDString);
    console.log("markcomplete: =======", markComplete)
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
    let proofreadingButtons =
        ['incomplete', 'unlabeled', 'complete'].includes(status) ?
        [['Mark as Complete', 'green', markComplete[2]]] : // :
        [];

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
            false), br(),
        this.generateSection('Synapses', [], optGroup.synapseProofreading),
        br(), br());
    return contextMenu;
  };
}