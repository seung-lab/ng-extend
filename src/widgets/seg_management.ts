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

import 'neuroglancer/save_state/save_state.css';

import {authFetch} from 'neuroglancer/authentication/frontend';
import {MouseSelectionState} from 'neuroglancer/layer';
import {Overlay} from 'neuroglancer/overlay';
import {SegmentationUserLayerWithGraph} from 'neuroglancer/segmentation_user_layer_with_graph';
import {StatusMessage} from 'neuroglancer/status';
import {vec3} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {Viewer} from 'neuroglancer/viewer';

export class SubmitDialog extends Overlay {
  constructor(
      public viewer: Viewer, public sid: string, public timestamp: number,
      public userID: number) {
    super();
    const br = () => document.createElement('br');
    const apiURL =
        `https://prod.flywire-daf.com/neurons/api/v1/mark_completion`;

    const existingDialog = document.getElementById('nge-submit');
    if (existingDialog) {
      return;
    }

    let {content} = this;
    let out = vec3.fromValues(0, 0, 0);
    viewer.navigationState.position.getVoxelCoordinates(out);
    content.style.overflow = 'visible';
    content.classList.add('ng-dark');
    let formMain = document.createElement('form');
    const title = document.createElement('h1');
    const descr = document.createElement('div');
    descr.style.paddingBottom = '10px';
    descr.style.maxWidth = '480px';

    const viewAdvanc = document.createElement('div');
    let advancedViewToggle = () => {
      viewAdvanc.classList.toggle('ng-hidden');
    };
    {
      viewAdvanc.classList.add('ng-hidden');
      let id = this.insertField(
          {content: sid, fieldTitle: 'segmentID', disabled: true});
      let x =
          this.insertField({content: out[0], fieldTitle: 'x', disabled: true});
      let y =
          this.insertField({content: out[1], fieldTitle: 'y', disabled: true});
      let z =
          this.insertField({content: out[2], fieldTitle: 'z', disabled: true});
      let updateView = () => {
        viewer.navigationState.position.setVoxelCoordinates(
            this.htmlToVec3(x, y, z));
      };
      x.addEventListener('change', updateView);
      y.addEventListener('change', updateView);
      z.addEventListener('change', updateView);


      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'nge_segment';
      cancel.addEventListener('click', () => {
        this.dispose();
      });
      cancel.innerText = 'Submit';
      cancel.title = 'Submit';
      viewAdvanc.append(
          'Segment: ', id, br(), br(), 'x: ', x, ' y: ', y, ' z: ', z, br());
    }

    const advanceTab = this.makeButton({
      innerHTML: '▼ Info',
      classList: ['special-button'],
      click: advancedViewToggle,
    });

    const sub = this.makeButton({
      innerText: 'Yes',
      classList: ['nge_segment'],
      title: 'Submit neuron as complete.',
      click: () => {
        window.open(`${apiURL}?valid_id=${sid}&location=${out.join(',')}`);
        StatusMessage.showMessage(`Thank you for your assessment!`);
        this.dispose();
      }
    });

    const cancel = this.makeButton({
      innerText: 'Cancel',
      classList: ['nge_segment'],
      title: 'Cancel',
      click: () => {
        this.dispose();
      },
    });

    this.isCoordInRoot().then(valid => {
      if (valid) {
        title.innerText = 'Mark Complete';
        descr.innerHTML = `To mark proofreading of this neuron as complete:
    <ol>
    <li>Are the crosshairs centered inside the nucleus? (Or if no soma is present, in a distinctive backbone?)</li>
    <li>Has each backbone been examined or proofread, showing no remaining obvious truncations or accidental mergers? (For more information about proofreading, see <a class="nge-sm-link" target='_blank' href="https://drive.google.com/open?id=1GF4Nh8UPsECMAicaaTOqxxM5u1taO4fW">this tutorial</a>.)</li>
    </ol>`;
        formMain.append(
            title, descr, br(), sub, ' ', cancel, br(), br(), advanceTab, br(),
            viewAdvanc);
      } else {
        title.innerText = 'Error';
        descr.innerHTML =
            `The crosshairs are not centered inside the selected neuron`;
        formMain.append(
            title, descr, br(), cancel, br(), br(), advanceTab, br(),
            viewAdvanc);
      }

      let modal = document.createElement('div');
      content.appendChild(modal);
      modal.appendChild(formMain);
      modal.onblur = () => this.dispose();
      modal.focus();
    });
  }

  private htmlToVec3(
      x: HTMLInputElement, y: HTMLInputElement, z: HTMLInputElement) {
    let xv = parseInt(x.value, 10);
    let yv = parseInt(y.value, 10);
    let zv = parseInt(z.value, 10);
    return vec3.fromValues(xv, yv, zv);
  }

  /*private hiddenInput = (form: HTMLElement, key: string, value: string) => {
    let input = document.createElement('input');
    input.value = value;
    input.name = key;
    input.type = 'hidden';
    form.appendChild(input);
  };*/

  private makeButton = (config: any) => {
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

  private insertField(config: FieldConfig) {
    // const {form} = config;
    let {content, fieldTitle, disabled, type} = config;

    let text = document.createElement('input');
    text.type = type || 'number';
    text.value = `${content || ''}`;
    text.size = 33;
    text.title = fieldTitle || '';
    text.disabled = !!disabled;

    // form.append(label || '', ': ', text);
    return text;
  }

  async isCoordInRoot(): Promise<Boolean> {
    const source = Uint64.parseString(this.sid);
    const timestamp = this.timestamp;
    const mLayer = this.viewer.selectedLayer.layer;
    if (mLayer == null) return false;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    const {viewer} = this;

    const selection = layer.getValueAt(
        viewer.navigationState.position.spatialCoordinates,
        new MouseSelectionState());

    // get root of supervoxel
    const response = await authFetch(`${layer.chunkedGraphUrl}/node/${
        String(selection)}/root?int64_as_str=1&timestamp=${timestamp}`);
    const jsonResp = await response.json();
    const root_id = Uint64.parseString(jsonResp['root_id']);
    // compare this root id with the one that initiated the check
    return !Uint64.compare(source, root_id);
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
