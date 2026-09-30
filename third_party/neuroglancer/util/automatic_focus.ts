/**
 * @license
 * Copyright 2017 Google Inc.
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

import debounce from 'lodash/debounce';
import {RefCounted} from 'neuroglancer/util/disposable';
import {isInputTextTarget} from 'neuroglancer/util/dom';
import LinkedListOperations from 'neuroglancer/util/linked_list.0';

class AutomaticFocusList {
  next0: AutomaticallyFocusedElement|null;
  prev0: AutomaticallyFocusedElement|null;

  constructor() {
    LinkedListOperations.initializeHead(<any>this);
  }
}

const automaticFocusList = new AutomaticFocusList();

const isTopLevel = window.top === window;

// EyeWire II (Amy 2026-09-30: "I need to be able to highlight and c+p text"):
// pressing on plain text blurs the viewer, and grabbing focus back right then
// wiped the selection being made, so chat (or any panel) text could never be
// selected and copied. Wait while a button is down, and leave a non-empty
// selection alone; the next click elsewhere clears it and focus returns.
let pointerIsDown = false;
document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
document.addEventListener('pointerup', () => { pointerIsDown = false; maybeUpdateFocus(); }, true);
document.addEventListener('pointercancel', () => { pointerIsDown = false; }, true);
function hasTextSelection() {
  const s = window.getSelection();
  return !!s && s.rangeCount > 0 && !s.isCollapsed;
}

const maybeUpdateFocus = debounce(() => {
  if (!isTopLevel) return;
  if (pointerIsDown || hasTextSelection()) return;
  const {activeElement} = document;
  if (activeElement === null || activeElement === document.body) {
    const node = LinkedListOperations.front<AutomaticallyFocusedElement>(<any>automaticFocusList);
    if (node !== null) {
      node.element.focus({preventScroll: true});
    }
  }
});

window.addEventListener('focus', () => {
  maybeUpdateFocus();
}, true);

window.addEventListener('blur', () => {
  maybeUpdateFocus();
}, true);

export class AutomaticallyFocusedElement extends RefCounted {
  prev0: AutomaticallyFocusedElement|null = null;
  next0: AutomaticallyFocusedElement|null = null;

  private lastFocusedElement: Element|null = null;

  private scheduleUpdateFocus = this.registerCancellable(debounce(() => {
    const {activeElement} = document;
    const {element} = this;
    if (element.contains(activeElement) || isInputTextTarget(activeElement)) {
      // Never steal focus from descendant or from text input element.
      return;
    }
    if (activeElement != null &&
        (activeElement === this.lastFocusedElement || activeElement.contains(element))) {
      this.element.focus({preventScroll: true});
    }
    this.lastFocusedElement = null;
  }, 0));

  constructor(public element: HTMLElement) {
    super();
    element.tabIndex = -1;
    this.registerEventListener(element, 'pointerdown', event => {
      if (event.target !== element) return;
      this.lastFocusedElement = null;
      element.focus({preventScroll: true});
    });
    this.registerEventListener(element, 'mouseenter', () => {
      this.lastFocusedElement = document.activeElement;
      this.scheduleUpdateFocus();
    });
    this.registerEventListener(element, 'mouseleave', () => {
      this.scheduleUpdateFocus.cancel();
    });
    // Insert at the end of the list.
    LinkedListOperations.insertBefore(<any>automaticFocusList, this);
    this.registerEventListener(element, 'focus', () => {
      // Move to the beginning of the list.
      LinkedListOperations.pop<AutomaticallyFocusedElement>(this);
      LinkedListOperations.insertAfter(<any>automaticFocusList, this);
    });
    maybeUpdateFocus();
  }

  disposed() {
    LinkedListOperations.pop<AutomaticallyFocusedElement>(this);
    super.disposed();
  }
}
