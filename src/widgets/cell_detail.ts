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

import {Overlay} from 'neuroglancer/overlay';
import {Viewer} from 'neuroglancer/viewer';
import {storeProxy} from '../state';

export class CellDetailDialog extends Overlay {
  protected form: HTMLFormElement;
  protected title: HTMLHeadingElement;
  protected description: HTMLDivElement;
  infoField: HTMLInputElement|HTMLTextAreaElement;

  constructor(
      public viewer: Viewer, public host: string, public sid: string,
      public timestamp: number, public userID: number, public stateInfo?: any,
      public error = true) {
    super();
    this.AddContent();
  }

  protected erroredPopup = (msg: string, cancel: HTMLButtonElement) => {
    const br = () => document.createElement('br');
    this.title.innerText = 'Error';
    this.description.innerHTML = msg;

    this.form.append(this.title, this.description, br(), cancel);

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

  AddContent() {
    let {content} = this;
    content.style.overflow = 'visible';
    content.classList.add('ng-dark');
    this.form = document.createElement('form');
    this.title = document.createElement('h1');
    this.description = document.createElement('div');
    this.description.style.paddingBottom = '10px';
    this.description.style.maxWidth = '480px';

    const cancel = this.makeButton({
      innerText: 'Close',
      classList: ['nge_segment'],
      title: 'Close',
      click: () => {
        this.dispose();
      },
    });
    if (this.error) {
      this.erroredPopup(
          `No existing identification can be found for this cell.`, cancel);
      return;
    }
    const {tag, paramStr, linkTS} = <any>(this.stateInfo || {});
    const br = () => document.createElement('br');
    const apiURL = `${this.host}/neurons/api/v1/cell_identification`;
    const sub = this.makeButton({
      innerText: 'More Details',
      classList: ['nge_segment'],
      title: 'See more Cell Identification information.',
      click: () => {
        window.open(`${apiURL}?filter_by=root_id&filter_string=${
            paramStr || ''}${linkTS || ''}`);
        this.dispose();
      }
    });

    if (tag) {
      this.title.innerText = 'Cell Identification';
      this.infoField =
          this.insertField({content: tag, type: 'textarea', disabled: true});
      this.infoField.classList.add('rounded-input', 'large');
      this.form.append(
          this.title, this.infoField, br(), br(), sub, ' ', cancel);

      let modal = document.createElement('div');
      this.content.appendChild(modal);
      modal.className = 'nge-overlay';
      modal.appendChild(this.form);
      (<any>modal).dispose = () => this.dispose();
      modal.onblur = () => this.dispose();
      modal.focus();
    } else {
      this.erroredPopup(
          `No existing identification can be found for this cell.`, cancel);
    }
  }

  public static generateMenuOption: any =
      (dialogOpen: Function, host: string, sis: string, timeCB: Function) => {
        console.log({dialogOpen, host, sis, timeCB});
        throw new Error('Not implemented.');
      };

  public static generateMenuOptionv2 =
      (dialogOpen: Function, host: string, sis: string, timeCB: Function,
       state: any) => {
        return [
          'View Cell Identification',
          ``,
          (e: MouseEvent) => {
            dialogOpen(e, (err: boolean) => {
              new CellDetailDialog(
                  (<any>window).viewer, host, sis, timeCB(),
                  storeProxy.loggedInUser!.id, state, err);
            });
          },
        ];
      }
}

type FieldConfig = {
  content?: string|number,
  fieldTitle?: string,
  disabled?: boolean
  type?: string
};
