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
 
 export class FrictionDialog extends Overlay {
   protected form: HTMLFormElement;
   protected title: HTMLHeadingElement;
   protected description: HTMLDivElement;

   constructor(
       public viewer: Viewer, public sids: string, public bulb: HTMLButtonElement) {
     super(); 
     const existingDialog = document.getElementById('nge-submit');
     if (existingDialog) {
       return;
     }
 
     let {content} = this;
     content.style.overflow = 'visible';
     content.classList.add('ng-dark');
     this.form = document.createElement('form');
     this.title = document.createElement('h1');
     this.description = document.createElement('div');
     this.description.style.paddingBottom = '10px';
     this.description.style.maxWidth = '480px';
 
     this.AddContent();
   }
 
   protected AddContent() {
     const br = () => document.createElement('br');
     const space = () => document.createTextNode("\u00A0");
     this.title.innerText='Editing a segment with completion marking'
     this.description.innerText='You\'re trying to edit a neuron that has been marked as complete. Are you sure you want to continue?     Segment IDs: '+this.sids
     const accept = this.makeButton({
       innerText: 'Yes, I want to continue',
       classList: ['nge_segment'],
       title: 'accepted',
       click: () => {
        this.bulb.classList.remove('in-progress')
        this.bulb.classList.add('accepted')
        this.dispose();
       }
     });

     const deny = this.makeButton({
      innerText: 'No, I want to reconsider',
      classList: ['nge_segment'],
      title: 'deny',
      click: () => {
       this.dispose();
      }
    });

     this.form.append(
        this.title, this.description, br(), accept,space(),space(),space(),deny,
        br());
    let modal = document.createElement('div');
    this.content.appendChild(modal);
    modal.appendChild(this.form);
    modal.onblur = () => this.dispose();
    modal.focus();
   }
 

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
 }
 
 type FieldConfig = {
   content?: string|number,
   fieldTitle?: string,
   disabled?: boolean
   type?: string
 };
 