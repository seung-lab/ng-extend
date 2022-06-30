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

import {SegmentationUserLayerWithGraph} from 'neuroglancer/segmentation_user_layer_with_graph';
import {StatusMessage} from 'neuroglancer/status';
import {Viewer} from 'neuroglancer/viewer';

import {storeProxy} from '../state';

import {SubmitDialog} from './seg_management';

export class PartnersDialog extends SubmitDialog {
  selectedSID: HTMLSelectElement;
  constructor(
      public viewer: Viewer, public host: string, public sid: string,
      public timestamp: number, public userID: number, public error = true) {
    super(viewer, host, sid, timestamp, userID, error);
  }

  AddContent() {
    const cancel = this.makeButton({
      innerText: 'Cancel',
      classList: ['nge_segment'],
      title: 'Cancel',
      click: () => {
        this.dispose();
      },
    });
    /*
    if (this.error) {
      this.erroredPopup(
          `Submit Cell Identification is not available. Please re-select the
    segment for the most updated version.`, cancel); return;
    }*/
    const br = () => document.createElement('br');
    const apiURL = `${
        this.host}/dash/datastack/flywire_fafb_production/apps/fly_partners/`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Submit Cell Identification.',
      click: () => {
        window.open(`${apiURL}?input_a=${this.sid}&input_b=${
            this.selectedSID.value}&cleft_thresh_input=50`);
        StatusMessage.showTemporaryMessage(`Partners test!`);
        this.dispose();
      }
    });

    const mLayer = this.viewer.selectedLayer.layer;
    if (mLayer == null) return;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;

    this.selectedSID = document.createElement('select');
    for (const x of layer.displayState.rootSegments) {
      const option = document.createElement('option');
      option.value = x.toString();
      option.innerText = x.toString();
      if (x.toString() != this.sid) {
        this.selectedSID.appendChild(option);
      }
    }

    if (this.selectedSID.options.length != 0) {
      this.title.innerText = 'Partners';
      this.description.innerHTML = `<p>Test</p>`;
      this.form.append(
          this.title, this.description, br(), 'Input A: ', this.sid, br(),
          'Input B: ', this.selectedSID, br(), br(), sub, ' ', cancel, br(),
          br(), this.infoTab, br(), this.infoView);

      let modal = document.createElement('div');
      this.content.appendChild(modal);
      modal.className = 'nge-overlay';
      modal.appendChild(this.form);
      (<any>modal).dispose = () => this.dispose();
      modal.onblur = () => this.dispose();
      modal.focus();
    } else {
      this.erroredPopup(`Must have at least two segments selected.`, cancel);
    }
  }



  public static generateMenuOption =
      (dialogOpen: Function, host: string, sis: string, timeCB: Function) => {
        return [
          'Partners',
          ``,
          (e: MouseEvent) => {
            dialogOpen(e, (err: boolean) => {
              new PartnersDialog(
                  (<any>window).viewer, host, sis, timeCB(),
                  storeProxy.loggedInUser!.id, err);
            });
          },
        ];
      }
}