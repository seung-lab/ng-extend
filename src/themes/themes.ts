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

import {SubmitDialog} from '../widgets/seg_management';

export class Theming {
  setting: string;
  themes: {[key: string]: {style: string, description: string}} = {
    'Default': {style: '', description: 'Default FlyWire Theme'},
    'Nebula Mode': {
      style: require('./custom/KrzystofKruk.tcss').default,
      description: 'Originally designed by Krzystof Kruk'
    }
  };
  constructor() {
    this.setting = localStorage.getItem('nge-theme_set') || 'Default';
    let style = document.getElementById('nge-custom-theme');
    const lsSetting = this.themes[this.setting];
    if (style && lsSetting) {
      style.innerHTML = lsSetting.style;
    }
  }
}

export class ThemesDialog extends SubmitDialog {
  themesList: HTMLSelectElement;
  constructor(
      public viewer: Viewer, public host: string, public sid: string,
      public timestamp: number, public userID: number, public error = true) {
    super(viewer, host, sid, timestamp, userID, error);
  }

  AddContent() {
    const theme = (<any>this.viewer).theme;
    const cancel = this.makeButton({
      innerText: 'Cancel',
      classList: ['nge_segment'],
      title: 'Cancel',
      click: () => {
        this.dispose();
      },
    });

    const br = () => document.createElement('br');
    const sub = this.makeButton({
      innerText: 'Apply',
      classList: ['nge_segment'],
      title: 'Apply CSS file.',
      click: () => {
        const cssKey = this.themesList.value;
        let style = document.getElementById('nge-custom-theme');
        if (style) {
          localStorage.setItem('nge-theme_set', cssKey);
          style.innerHTML = theme.themes[cssKey].style;
        }
        StatusMessage.showTemporaryMessage(`${cssKey} style Applied.`, 5000);
        this.dispose();
      }
    });

    this.themesList = document.createElement('select');
    this.themesList.style.fontSize = 'inherit';
    for (const x of Object.entries(theme.themes)) {
      const option = document.createElement('option');
      option.value = x[0];
      option.innerText = x[0];
      this.themesList.appendChild(option);
    }
    this.themesList.value = theme.setting || 'Default';
    this.themesList.onchange = () => {
      const cssKey = this.themesList.value;
      let description = theme.themes[cssKey].description;
      this.description.innerHTML = `<p>${description}</p>`;
    };

    this.title.innerText = 'Themes';
    this.description.innerHTML =
        `<p>${theme.themes[theme.setting].description}</p>`;

    const instructions = document.createElement('div');
    instructions.innerHTML = `<p>Change FlyWire Styling</p>`;

    this.form.append(
        this.title, instructions, br(), 'Selected: ', this.themesList, br(),
        this.description, br(), sub, ' ', cancel, br(), br());

    let modal = document.createElement('div');
    this.content.appendChild(modal);
    modal.className = 'nge-overlay';
    modal.appendChild(this.form);
    (<any>modal).dispose = () => this.dispose();
    modal.onblur = () => this.dispose();
    modal.focus();
  }
}