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

export class SummaryDialog extends SubmitDialog {
  sidsList: Set<string>;
  sidContainer: HTMLDivElement;
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
    const br = () => document.createElement('br');
    const apiURL =
        `${this.host}/dash/datastack/flywire_fafb_production/apps/fly_summary/`;
    const sub = this.makeButton({
      innerText: 'Submit',
      classList: ['nge_segment'],
      title: 'Query Cell Summary.',
      click: () => {
        if (this.sidsList.size > 0) {
          window.open(
              `${apiURL}?timestamp_field=${this.timestamp}&input_field=${
                  Array.from(this.sidsList).slice(0, 20).join(',')}`);
          this.dispose();
        } else {
          StatusMessage.showTemporaryMessage(`Please select at least one ID!`);
        }
      }
    });

    const mLayer = this.viewer.selectedLayer.layer;
    if (mLayer == null) return;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    const changeDetect = (e: Event) => {
      const value = (<HTMLInputElement>e.target).value;
      const checked = (<HTMLInputElement>e.target).checked;
      if (checked) {
        this.sidsList.add(value);
      } else {
        this.sidsList.delete(value);
      }
    };
    const sidEntry = (sid: string, initial: boolean = false) => {
      const entry = document.createElement('div');
      const label = document.createElement('label');
      label.innerText = sid;
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = sid;
      check.checked = initial;
      check.addEventListener('change', changeDetect);
      entry.append(label, ' ', check);
      return entry;
    };
    const selectAll = (e: Event) => {
      e.preventDefault();
      Array.from(layer.displayState.rootSegments)
          .forEach(x => this.sidsList.add(x.toString()));
      Array.from(this.sidContainer.querySelectorAll('input'))
          .splice(0, 20)
          .forEach((x: HTMLInputElement) => x.checked = true);
    };
    const selectNone = (e: Event) => {
      e.preventDefault();
      this.sidsList.clear();
      Array.from(this.sidContainer.querySelectorAll('input'))
          .forEach((x: HTMLInputElement) => x.checked = false);
    };

    // make two buttons that allow you to select all or none
    const selectAllButton = this.makeButton({
      innerText: 'Select All',
      classList: ['nge_segment'],
      title: 'Select All',
      click: selectAll,
    });
    const selectNoneButton = this.makeButton({
      innerText: 'Select None',
      classList: ['nge_segment'],
      title: 'Select None',
      click: selectNone,
    });

    this.sidsList = new Set<string>();
    this.sidContainer = document.createElement('div');
    this.sidContainer.classList.add('nge-sum-container');
    for (const x of layer.displayState.rootSegments) {
      const isSelector = x.toString() == this.sid;
      const entry = sidEntry(x.toString(), isSelector);
      if (isSelector) {
        this.sidContainer.insertBefore(entry, this.sidContainer.firstChild);
        this.sidsList.add(x.toString());
      } else {
        this.sidContainer.appendChild(entry);
      }
    }

    this.title.innerText = 'Cell Summary';
    this.description.innerHTML =
        `<p>Query summary information for one or more cells (Maximum of 20).</p>`;
    this.form.append(
        this.title, this.description, br(), selectAllButton, ' ',
        selectNoneButton, br(), this.sidContainer, br(), br(), sub, ' ', cancel,
        br(), br(), this.infoTab, br(), this.infoView);

    let modal = document.createElement('div');
    this.content.appendChild(modal);
    modal.className = 'nge-overlay';
    modal.appendChild(this.form);
    (<any>modal).dispose = () => this.dispose();
    modal.onblur = () => this.dispose();
    modal.focus();
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