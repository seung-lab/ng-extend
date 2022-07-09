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
import {Viewer} from 'neuroglancer/viewer';

import {storeProxy} from '../state';

import {SubmitDialog} from './seg_management';

export class SummaryDialog extends SubmitDialog {
  sidsList: string[];
  selectedSID: HTMLSelectElement;
  selection: HTMLTextAreaElement;
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
    const apiURL =
        `${this.host}/dash/datastack/flywire_fafb_production/apps/fly_summary/`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Query Cell Summary.',
      click: () => {
        window.open(`${apiURL}?timestamp_field=${this.timestamp}&input_field=${
            this.sidsList.join(',')}`);
        this.dispose();
      }
    });

    const mLayer = this.viewer.selectedLayer.layer;
    if (mLayer == null) return;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    const changeDetect = () => {
      const sidsValues = Array.from(this.selectedSID.selectedOptions)
                             .map(option => option.value)
                             .filter(x => x !== '');
      sidsValues.unshift(this.sid);

      this.sidsList = sidsValues;
      const sidsString = this.sidsList.join(', ');
      this.selection.innerHTML = `Ids: ${sidsString}`;
    };
    this.selection = document.createElement('textarea');
    this.selectedSID = document.createElement('select');
    this.selectedSID.appendChild(document.createElement('option'));
    for (const x of layer.displayState.rootSegments) {
      const option = document.createElement('option');
      option.value = x.toString();
      option.innerText = x.toString();
      if (x.toString() != this.sid) {
        this.selectedSID.appendChild(option);
      }
    }
    this.selectedSID.multiple = true;
    changeDetect();
    this.selectedSID.addEventListener('change', changeDetect);

    if (this.selectedSID.options.length != 0) {
      this.title.innerText = 'Cell Summary';
      this.description.innerHTML =
          `<p>Query summary information for one or more cells (Maximum of 20).</p>
          <p>Hold the control (CTRL) key to add and remove ids.</p>`;
      this.form.append(
          this.title, this.description, br(), this.selection, br(),
          this.selectedSID, br(), br(), sub, ' ', cancel, br(), br(),
          this.infoTab, br(), this.infoView);

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
          'Cell Summary',
          ``,
          (e: MouseEvent) => {
            dialogOpen(e, (err: boolean) => {
              new SummaryDialog(
                  (<any>window).viewer, host, sis, timeCB(),
                  storeProxy.loggedInUser!.id, err);
            });
          },
        ];
      }
}