/**
 * @license
 * Copyright 2021 The Neuroglancer Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// import 'neuroglancer/save_state/save_state.css';

// import {authFetch} from 'neuroglancer/authentication/frontend';
// import {MouseSelectionState} from 'neuroglancer/layer';
import {Overlay} from 'neuroglancer/overlay';
// import {SegmentationUserLayerWithGraph} from 'neuroglancer/segmentation_user_layer_with_graph';
import {vec3} from 'neuroglancer/util/geom';
// import {Uint64} from 'neuroglancer/util/uint64';
import {Viewer} from 'neuroglancer/viewer';
// import {storeProxy} from '../state';

export class SubmitDialog extends Overlay {
  protected form: HTMLFormElement;
  protected title: HTMLHeadingElement;
  protected description: HTMLDivElement;
  protected infoView: HTMLDivElement;
  protected coords: vec3;
  protected infoTab: HTMLButtonElement;
  constructor(
      public viewer: Viewer, public host: string, public sid: string,
      // public timestamp: number,
      public userID: number, public error = false) {
    super();
    const br = () => document.createElement('br');

    const existingDialog = document.getElementById('nge-submit');
    if (existingDialog) {
      return;
    }

    let {content} = this;
    this.coords = vec3.fromValues(0, 0, 0);
    // viewer.navigationState.position.getVoxelCoordinates(this.coords);
    content.style.overflow = 'visible';
    content.classList.add('ng-dark');
    this.form = document.createElement('form');
    this.title = document.createElement('h1');
    this.description = document.createElement('div');
    this.description.style.paddingBottom = '10px';
    this.description.style.maxWidth = '480px';

    this.infoView = document.createElement('div');
    let advancedViewToggle = () => {
      this.infoView.classList.toggle('ng-hidden');
    };
    {
      this.infoView.classList.add('ng-hidden');
      let id = this.insertField(
          {content: sid, fieldTitle: 'segmentID', disabled: true});
      let x = this.insertField(
          {content: this.coords[0], fieldTitle: 'x', disabled: true});
      let y = this.insertField(
          {content: this.coords[1], fieldTitle: 'y', disabled: true});
      let z = this.insertField(
          {content: this.coords[2], fieldTitle: 'z', disabled: true});
      // let updateView = () => {
      //   viewer.navigationState.position.setVoxelCoordinates(
      //       this.htmlToVec3(x, y, z));
      // };
      // x.addEventListener('change', updateView);
      // y.addEventListener('change', updateView);
      // z.addEventListener('change', updateView);

      this.infoView.append(
          'Segment: ', id, br(), br(), 'x: ', x, ' y: ', y, ' z: ', z, br());
    }

    this.infoTab = this.makeButton({
      innerHTML: '▼ Info',
      classList: ['special-button'],
      click: advancedViewToggle,
    });
    this.AddContent();
  }

  protected AddContent() {
    const cancel = this.makeButton({
      innerText: 'Cancel',
      classList: ['nge_segment'],
      title: 'Cancel',
      click: () => {
        this.dispose();
      },
    });
    if (this.error) {
      this.erroredPopup(
          `Mark Complete is not available. Please re-select the segment for the most updated version.`,
          cancel);
      return;
    }
    const br = () => document.createElement('br');
    const apiURL = `${this.host}/neurons/api/v1/mark_completion`;
    const sub = this.makeButton({
      innerText: 'Yes',
      classList: ['nge_segment'],
      title: 'Submit cell as complete.',
      click: () => {
        window.open(`${apiURL}?valid_id=${this.sid}&location=${
            this.coords.join(',')}&submit=1`);

        // storeProxy.showSubmittedCongrats = true;
        this.dispose();
      }
    });

    this.isCoordInRoot()
        .then(valid => {
          if (valid) {
            this.title.innerText = 'Mark Complete';
            this.description.innerHTML =
                `To mark proofreading of this cell as complete:
    <ol>
    <li>Are the crosshairs centered inside a distinctive backbone?</li>
    <li>Has each backbone been examined or proofread, showing no remaining obvious truncations or accidental mergers? (For more information about proofreading, see <a class="nge-sm-link" target='_blank' href="https://drive.google.com/open?id=1GF4Nh8UPsECMAicaaTOqxxM5u1taO4fW">this tutorial</a>.)</li>
    </ol>
    <p>If you disagree that this cell's backbones have been completed, please email <a class="nge-sm-link" href="mailto:flywire@princeton.edu">flywire@princeton.edu</a>.</p>`;
            this.form.append(
                this.title, this.description, br(), sub, ' ', cancel, br(),
                br(), this.infoTab, br(), this.infoView);

            let modal = document.createElement('div');
            this.content.appendChild(modal);
            modal.className = 'nge-overlay';
            modal.appendChild(this.form);
            (<any>modal).dispose = () => this.dispose();
            modal.onblur = () => this.dispose();
            modal.focus();
          } else
            this.erroredPopup(
                `The crosshairs are not centered inside the selected cell.`,
                cancel);
        })
        .catch(() => {
          /*StatusMessage.showError(
              `Error: Mark Complete is not available. Please check your network
          connection or refresh the page.`); this.dispose();*/
          this.erroredPopup(
              `Mark Complete is not available. Please check your network connection or refresh the page.`,
              cancel);
        });
  }

  // private htmlToVec3(
  //     x: HTMLInputElement|HTMLTextAreaElement,
  //     y: HTMLInputElement|HTMLTextAreaElement,
  //     z: HTMLInputElement|HTMLTextAreaElement) {
  //   let xv = parseInt(x.value, 10);
  //   let yv = parseInt(y.value, 10);
  //   let zv = parseInt(z.value, 10);
  //   return vec3.fromValues(xv, yv, zv);
  // }

  /*private hiddenInput = (form: HTMLElement, key: string, value: string) => {
    let input = document.createElement('input');
    input.value = value;
    input.name = key;
    input.type = 'hidden';
    form.appendChild(input);
  };*/

  protected erroredPopup = (msg: string, cancel: HTMLButtonElement) => {
    const br = () => document.createElement('br');
    this.title.innerText = 'Error';
    this.description.innerHTML = msg;

    this.form.append(
        this.title, this.description, br(), cancel, br(), br(), this.infoTab,
        br(), this.infoView);

    let modal = document.createElement('div');
    this.content.appendChild(modal);
    modal.appendChild(this.form);
    modal.onblur = () => this.dispose();
    modal.focus();
  };

  protected makeButton = (config: any) => {
    const button = document.createElement('button');
    button.type = 'button';
    let {innerHTML, innerText, classList, click, title} = config;
    if (innerHTML) button.innerHTML = innerHTML;
    if (innerText) button.innerText = innerText;
    if (classList) button.classList.add(classList);
    if (click) button.addEventListener('click', click);
    if (title) button.title = title;
    return button;
  };

  protected insertField(config: FieldConfig) {
    // const {form} = config;
    let {content, fieldTitle, disabled, type} = config;

    let text =
        document.createElement(type == 'textarea' ? 'textarea' : 'input');
    if (type != 'textarea') {
      (<HTMLInputElement>text).type = type || 'number';
      (<HTMLInputElement>text).size = 33;
    }
    text.value = `${content || ''}`;
    text.title = fieldTitle || '';
    text.disabled = !!disabled;


    // form.append(label || '', ': ', text);
    return text;
  }

  protected async isCoordInRoot(): Promise<Boolean> {
    // const source = Uint64.parseString(this.sid);
    const mLayer = this.viewer.selectedLayer.layer;
    if (mLayer == null) return false;
    // const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    // const {viewer} = this;

    // const selection = layer.getValueAt(
    //     viewer.navigationState.position.spatialCoordinates,
    //     new MouseSelectionState());
    // const selection = "selection"

    // get root of supervoxel
    // const response = await authFetch(`/node/${
    //     String(selection)}/root?int64_as_str=1`); //${layer.chunkedGraphUrl}
    // const jsonResp = await response.json();
    // const root_id = Uint64.parseString(jsonResp['root_id']);
    // // compare this root id with the one that initiated the check
    // return !Uint64.compare(source, root_id);
    return false
  }

  // protected dsTimestamp =
  //     () => {
  //       const mLayer: any = this.viewer.selectedLayer.layer;
  //       if (mLayer == null || mLayer.layer == null) return '';
  //       return `&timestamp_field=${mLayer.layer.displayState.timestamp.value}`;
  //     }

  public static generateMenuOption =
      (dialogOpen: Function, host: string, sis: string,
       // timeCB: Function
      ) => {
    // console.log(storeProxy)
        return [
          'Mark Cell As Complete',
          ``,
          (e: MouseEvent) => {
            dialogOpen(e, (err: boolean) => {
              new SubmitDialog(
                  (<any>window).viewer, host, sis,
                  // timeCB(),
                  1234, err); //storeProxy.loggedInUser!.id
            });
          },
        ];
      }
}

/*form: HTMLElement, popupID?: string, content?:
string, textId?: string, disabled = false, fieldTitle = '', btnName?: string,
btnTitle?: string, btnAct?: EventListener, btnClass?: string, readonly = true,
newLine = true */

type FieldConfig = {
  content?: string|number,
  fieldTitle?: string,
  disabled?: boolean
  type?: string
};
