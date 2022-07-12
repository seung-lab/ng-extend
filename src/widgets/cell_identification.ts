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

import {StatusMessage} from 'neuroglancer/status';
import {Viewer} from 'neuroglancer/viewer';
import {storeProxy} from '../state';
import {SubmitDialog} from './seg_management';

export class CellIdDialog extends SubmitDialog {
  infoField: HTMLInputElement|HTMLTextAreaElement;
  constructor(
      public viewer: Viewer, public sid: string, public timestamp: number,
      public userID: number, public error = true) {
    super(viewer, sid, timestamp, userID, error);
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
    if (this.error) {
      this.erroredPopup(
          `Submit Cell Identification is not available. Please re-select the segment for the most updated version.`,
          cancel);
      return;
    }
    const br = () => document.createElement('br');
    const apiURL =
        `https://prod.flywire-daf.com/neurons/api/v1/submit_cell_identification`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Submit Cell Identification.',
      click: () => {
        if (this.infoField.value.length) {
          window.open(`${apiURL}?valid_id=${this.sid}&submit=1&location=${
              this.coords.join(
                  ',')}&tag=${encodeURIComponent(this.infoField.value)}`);
          StatusMessage.showTemporaryMessage(`Thank you for your assessment!`);
          this.dispose();
        } else {
          // StatusMessage.showError(`Text cannot be empty!`);
          StatusMessage.showTemporaryMessage(`Text cannot be empty!`);
        }
      }
    });

    this.isCoordInRoot()
        .then(valid => {
          if (valid) {
            this.title.innerText = 'Submit Cell Identification';
            this.description.innerHTML =
                `<p>Enter name(s) of this cell including any synonyms or abbreviations and source of name, if known.</p>
            <p>All information is helpful; if you're not certain, just add "putative" or "resembles" or describe your level of certainty.</p>
            <p>Example 1: putative giant fiber neuron, giant fibre neuron (Power 1948), GF, GFN.</p>
            <p>Example 2: X9238J (new cell type named in ongoing Smith lab project)</p>`;
            this.infoField = this.insertField({content: '', type: 'textarea'});
            this.infoField.classList.add('rounded-input', 'large');
            this.form.append(
                this.title, this.description, br(), this.infoField, br(), br(),
                sub, ' ', cancel, br(), br(), this.infoTab, br(),
                this.infoView);

            let modal = document.createElement('div');
            this.content.appendChild(modal);
            modal.className = 'nge-overlay';
            modal.appendChild(this.form);
            (<any>modal).dispose = () => this.dispose();
            modal.onblur = () => this.dispose();
            modal.focus();
          } else {
            this.erroredPopup(
                `The crosshairs are not centered inside the selected cell.`,
                cancel);
          }
        })
        .catch(() => {
          /*StatusMessage.showError(
              `Error: Submit Cell Identification is not available. Please check
          your network connection or refresh the page.`); this.dispose();*/
          this.title.innerText = 'Error';
          this.description.innerHTML =
              `Submit Cell Identification is not available. Please check your network connection or refresh the page.`;
          this.form.append(
              this.title, this.description, br(), cancel, br(), br(),
              this.infoTab, br(), this.infoView);

          let modal = document.createElement('div');
          this.content.appendChild(modal);
          modal.appendChild(this.form);
          modal.onblur = () => this.dispose();
          modal.focus();
        });
  }

  public static generateMenuOption =
      (dialogOpen: Function, sis: string, timeCB: Function) => {
        return [
          'Submit Cell Identification',
          ``,
          (e: MouseEvent) => {
            dialogOpen(e, (err: boolean) => {
              new CellIdDialog(
                  (<any>window).viewer, sis, timeCB(),
                  storeProxy.loggedInUser!.id, err);
            });
          },
        ];
      }
}