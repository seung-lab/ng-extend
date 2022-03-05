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
import {SubmitDialog} from './seg_management';

export class CellIdDialog extends SubmitDialog {
  infoField: HTMLInputElement|HTMLTextAreaElement;
  constructor(
      public viewer: Viewer, public sid: string, public timestamp: number,
      public userID: number) {
    super(viewer, sid, timestamp, userID);
  }

  AddContent() {
    const br = () => document.createElement('br');
    const apiURL =
        `https://prod.flywire-daf.com/neurons/api/v1/submit_cell_identification`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Submit cell identification.',
      click: () => {
        if (this.infoField.value.length) {
          window.open(`${apiURL}?valid_id=${this.sid}&location=${
              this.coords.join(
                  ',')}&tag=${encodeURIComponent(this.infoField.value)}`);
          StatusMessage.showTemporaryMessage(`Thank you for your assessment!`);
          this.dispose();
        } else {
          StatusMessage.showError(`Text cannot be empty!`);
        }
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

    this.isCoordInRoot()
        .then(valid => {
          if (valid) {
            this.title.innerText = 'Submit Cell Identification';
            this.description.innerHTML = `Submit Cell Indentification`;
            this.infoField = this.insertField({
              content: '',
              fieldTitle: 'Enter Cell Identification',
              type: 'textarea'
            });
            this.infoField.classList.add('rounded-input', 'large');
            this.form.append(
                this.title, this.description, br(), this.infoField, br(), br(),
                sub, ' ', cancel, br(), br(), this.infoTab, br(),
                this.infoView);
          } else {
            this.title.innerText = 'Error';
            this.description.innerHTML =
                `The crosshairs are not centered inside the selected cell.`;
            this.form.append(
                this.title, this.description, br(), cancel, br(), br(),
                this.infoTab, br(), this.infoView);
          }

          let modal = document.createElement('div');
          this.content.appendChild(modal);
          modal.appendChild(this.form);
          modal.onblur = () => this.dispose();
          modal.focus();
        })
        .catch(() => {
          StatusMessage.showError(
              `Error: Submit Cell Identification is not available. Please check your network connection or refresh the page.`);
          this.dispose();
        });
  }
}