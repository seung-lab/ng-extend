/**
 * @license
 * Copyright 2022 The Neuroglancer Authors
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

export class CellReviewDialog extends SubmitDialog {
  isTrue: HTMLInputElement;
  isFalse: HTMLInputElement;
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
          `Cell Review is not available. Please re-select the segment for the most updated version.`,
          cancel);
      return;
    }
    const br = () => document.createElement('br');
    const apiURL = `https://prod.flywire-daf.com/neurons/api/v1/review_cell`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Review Cell.',
      click: () => {
        if (this.isTrue.checked || this.isFalse.checked) {
          window.open(`${apiURL}?valid_id=${this.sid}&submit=1&location=${
              this.coords.join(',')}&proofread_info=${
              this.isTrue.checked ? 'TRUE' : 'FALSE'}`);
          StatusMessage.showTemporaryMessage(`Thank you for your review!`);
          this.dispose();
        } else {
          StatusMessage.showTemporaryMessage(`Please select a value.`);
        }
      }
    });

    this.isCoordInRoot()
        .then(valid => {
          if (valid) {
            this.title.innerText = 'Submit Cell Review';
            this.description.innerHTML =
                `<ol><li>Are the crosshairs centered inside a distinctive backbone?</li>
            <li>Please select an option to indicate if the cell is complete.</li></ol>`;
            this.isTrue = <HTMLInputElement>this.insertField(
                {content: 'true', type: 'radio'});
            this.isTrue.id = 'complete';
            const isTrue = document.createElement('label');
            isTrue.innerText = 'Complete';
            isTrue.htmlFor = this.isTrue.id;

            this.isFalse = <HTMLInputElement>this.insertField(
                {content: 'false', type: 'radio'});
            this.isFalse.id = 'incomplete';
            const isFalse = document.createElement('label');
            isFalse.innerText = 'Incomplete';
            isFalse.htmlFor = this.isFalse.id;

            this.form.append(
                this.title, this.description, br(), this.isTrue, isTrue, br(),
                this.isFalse, isFalse, br(), br(), sub, ' ', cancel, br(), br(),
                this.infoTab, br(), this.infoView);

            let modal = document.createElement('div');
            this.content.appendChild(modal);
            modal.appendChild(this.form);
            modal.onblur = () => this.dispose();
            modal.focus();
          } else {
            this.erroredPopup(
                `The crosshairs are not centered inside the selected cell.`,
                cancel);
          }
        })
        .catch(() => {
          this.title.innerText = 'Error';
          this.description.innerHTML =
              `Cell Review is not available. Please check your network connection or refresh the page.`;
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
}