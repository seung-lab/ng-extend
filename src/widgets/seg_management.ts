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

import {annotationToJson, AnnotationType, LocalAnnotationSource, Point, restoreAnnotation} from 'neuroglancer/annotation';
import {AnnotationLayerState} from 'neuroglancer/annotation/frontend';
import {CoordinateTransform} from 'neuroglancer/coordinate_transform';
import {MouseSelectionState} from 'neuroglancer/layer';
import {Overlay} from 'neuroglancer/overlay';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {SegmentationUserLayerWithGraph} from 'neuroglancer/segmentation_user_layer_with_graph';
import {StatusMessage} from 'neuroglancer/status';
import {trackableAlphaValue} from 'neuroglancer/trackable_alpha';
import {WatchableRefCounted} from 'neuroglancer/trackable_value';
import {Tool} from 'neuroglancer/ui/tool';
import {serializeColor, TrackableRGB} from 'neuroglancer/util/color';
import {RefCounted} from 'neuroglancer/util/disposable';
import {vec3} from 'neuroglancer/util/geom';
import {NullarySignal} from 'neuroglancer/util/signal';
import {Viewer} from 'neuroglancer/viewer';


const ANNOTATION_COLOR_JSON_KEY = 'color';
const PATH_OBJECT_JSON_KEY = 'pathObject';

// const PATH_SOURCE_JSON_KEY = 'source';
const PATH_TARGET_JSON_KEY = 'target';
// const HAS_PATH_JSON_KEY = 'hasPath';
const ANNOTATION_PATH_JSON_KEY = 'annotationPath';

export class PathFinderState extends RefCounted {
  PositionMarker: PositionMarker;
  annotationLayerState =
      this.registerDisposer(new WatchableRefCounted<AnnotationLayerState>());
  pathAnnotationColor = new TrackableRGB(vec3.fromValues(1.0, 1.0, 0.0));
  changed = new NullarySignal();

  constructor(transform: CoordinateTransform) {
    super();
    const annotationSource = this.registerDisposer(new LocalAnnotationSource());
    this.PositionMarker =
        this.registerDisposer(new PositionMarker(annotationSource));
    this.annotationLayerState.value = new AnnotationLayerState({
      transform,
      source: annotationSource.addRef(),
      fillOpacity: trackableAlphaValue(1.0),
      color: this.pathAnnotationColor,
    });
    this.registerDisposer(
        this.PositionMarker.changed.add(this.changed.dispatch));
    this.registerDisposer(
        this.pathAnnotationColor.changed.add(this.changed.dispatch));
  }

  restoreState(x: any) {
    this.pathAnnotationColor.restoreState(x[ANNOTATION_COLOR_JSON_KEY]);
    this.PositionMarker.restoreState(x[PATH_OBJECT_JSON_KEY]);
  }

  toJSON() {
    return {
      [ANNOTATION_COLOR_JSON_KEY]:
          serializeColor(this.pathAnnotationColor.value),
      //[POSITION_MARK_JSON_KEY]: this.PositionMarker.toJSON()
    };
  }
}

class PositionMarker extends RefCounted {
  private _target: Point|undefined;
  changed = new NullarySignal();

  constructor(private annotationSource: LocalAnnotationSource) {
    super();
  }

  ready() {
    return this._target !== undefined;
  }

  get target() {
    return this._target;
  }

  addTarget(annotation: Point) {
    if (!this.ready()) {
      this._target = annotation;
      this.annotationSource.add(this.target!);
      this.changed.dispatch();
    }
  }

  clear() {
    this.annotationSource.clear();
    this._target = undefined;
    this.changed.dispatch();
  }

  restoreState(specification: any) {
    if (specification[ANNOTATION_PATH_JSON_KEY] !== undefined) {
      this.annotationSource.restoreState(
          specification[ANNOTATION_PATH_JSON_KEY].annotations, undefined);
    }
    if (specification[PATH_TARGET_JSON_KEY] !== undefined) {
      this._target =
          <Point>restoreAnnotation(specification[PATH_TARGET_JSON_KEY]);
    }
    this.changed.dispatch();
  }

  toJSON() {
    const x: any = {
      [ANNOTATION_PATH_JSON_KEY]: this.annotationSource.toJSON(),
    };
    if (this._target) {
      x[PATH_TARGET_JSON_KEY] = annotationToJson(this._target);
    }
    return x;
  }
}
export class ManagementMarkerTool extends Tool {
  constructor(private layer: SegmentationUserLayerWithGraph) {
    super();
  }

  private get pathBetweenSupervoxels() {
    return this.layer.pathFinderState.pathBetweenSupervoxels;
  }

  trigger(mouseState: MouseSelectionState) {
    if (mouseState.active) {
      const {segmentSelectionState} = this.layer.displayState;
      if (segmentSelectionState.hasSelectedSegment) {
        if (this.pathBetweenSupervoxels.ready()) {
          StatusMessage.showTemporaryMessage(
              'A source and target have already been selected.', 7000);
        } else if (!this.layer.displayState.rootSegments.has(
                       segmentSelectionState.selectedSegment)) {
          StatusMessage.showTemporaryMessage(
              'The selected supervoxel is of an unselected segment', 7000);
        } else {
          const annotation: Point = {
            id: '',
            segments: [
              segmentSelectionState.rawSelectedSegment.clone(),
              segmentSelectionState.selectedSegment.clone()
            ],
            point: vec3.transformMat4(
                vec3.create(),
                this.layer.manager.layerSelectedValues.mouseState.position,
                this.layer.transform.inverse),
            type: AnnotationType.POINT,
          };
          this.pathBetweenSupervoxels.addSourceOrTarget(annotation);
        }
      }
    }
  }

  description = `select source & target supervoxel to find a path between`;

  toJSON() {
    // Don't register the tool, it's not that important
    return;
  }
}

export class SubmitDialog extends Overlay {
  constructor(public viewer: Viewer, sid: string) {
    super();
    const br = () => document.createElement('br');
    // const apiURL = ``;

    const existingDialog = document.getElementById('nge-submit');
    if (existingDialog) {
      return;
    }

    let formMain = document.createElement('form');
    let {content} = this;
    content.style.overflow = 'visible';
    content.classList.add('ng-dark');
    const title = document.createElement('h1');
    const descr = document.createElement('div');

    descr.style.paddingBottom = '10px';
    descr.style.maxWidth = '480px';

    const advanceTab = document.createElement('button');
    advanceTab.innerHTML = 'Info';
    advanceTab.type = 'button';
    advanceTab.classList.add('special-button');
    const viewAdvanc = document.createElement('div');
    advanceTab.addEventListener('click', () => {
      viewAdvanc.classList.toggle('ng-hidden');
    });
    {
      viewAdvanc.classList.add('ng-hidden');
      let out = vec3.fromValues(0, 0, 0);
      viewer.navigationState.position.getVoxelCoordinates(out);
      let id = this.insertField(
          {content: sid, fieldTitle: 'segmentID', disabled: true});
      let x =
          this.insertField({content: out[0], fieldTitle: 'x', disabled: true});
      let y =
          this.insertField({content: out[1], fieldTitle: 'y', disabled: true});
      let z =
          this.insertField({content: out[2], fieldTitle: 'z', disabled: true});
      let updateView = () => {
        viewer.navigationState.position.setVoxelCoordinates(
            this.htmlToVec3(x, y, z));
      };
      x.addEventListener('change', updateView);
      y.addEventListener('change', updateView);
      z.addEventListener('change', updateView);


      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'nge_segment';
      cancel.addEventListener('click', () => {
        // apiURL
        this.dispose();
      });
      cancel.innerText = 'Submit';
      cancel.title = 'Submit';
      viewAdvanc.append(
          'Segment: ', id, br(), br(), 'x: ', x, ' y: ', y, ' z: ', z, br());
    }

    const sub = document.createElement('button');
    sub.type = 'button';
    sub.className = 'nge_segment';
    sub.addEventListener('click', () => {
      // apiURL

      StatusMessage.showMessage(`Thank you for your assessment!`);

      // window.open();
      this.dispose();
    });
    sub.innerText = 'Yes';
    sub.title = 'Submit neuron as complete.';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'nge_segment';
    cancel.addEventListener('click', () => {
      // apiURL
      this.dispose();
    });
    cancel.innerText = 'Cancel';
    cancel.title = 'Cancel';

    if (this.checkInSelectedSegment(sid)) {
      title.innerText = 'Mark Complete';
      descr.innerHTML = `To mark proofreading of this neuron as complete:
    <ol>
    <li>Are the crosshairs centered inside the nucleus? (Or if no soma is present, in a distinctive backbone?)</li>
    <li>Has each backbone been examined or proofread, showing no remaining obvious truncations or accidental mergers? (For more information about proofreading, see <a href="https://drive.google.com/open?id=1GF4Nh8UPsECMAicaaTOqxxM5u1taO4fW">this tutorial</a>.)</li>
    </ol>`;
      formMain.append(
          title, descr, br(), sub, ' ', cancel, br(), br(), advanceTab, br(),
          viewAdvanc);
    } else {
      title.innerText = 'Error';
      descr.innerHTML =
          `The crosshairs are not centered inside the selected neuron`;
      formMain.append(
          title, descr, br(), cancel, br(), br(), advanceTab, br(), viewAdvanc);
    }
    let modal = document.createElement('div');
    content.appendChild(modal);

    modal.appendChild(formMain);

    modal.onblur = () => this.dispose();
    modal.focus();
  }

  private htmlToVec3(
      x: HTMLInputElement, y: HTMLInputElement, z: HTMLInputElement) {
    let xv = parseInt(x.value, 10);
    let yv = parseInt(y.value, 10);
    let zv = parseInt(z.value, 10);
    return vec3.fromValues(xv, yv, zv);
  }

  private insertField(config: FieldConfig) {
    // const {form} = config;
    let {content, fieldTitle, disabled} = config;

    let text = document.createElement('input');
    text.type = 'number';
    text.value = `${content || ''}`;
    text.size = 33;
    text.title = fieldTitle || '';
    text.disabled = !!disabled;

    // form.append(label || '', ': ', text);
    return text;
  }

  private checkInSelectedSegment(sid: string) {
    const layers = this.viewer!.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        console.log(layer.displayState.segmentSelectionState.selectedSegment
                        .toString());
        if (sid ==
            layer.displayState.segmentSelectionState.selectedSegment
                .toString()) {
          return true;
        }
      }
    }
    return false;
  }
}

/*form: HTMLElement, popupID?: string, content?:
string, textId?: string, disabled = false, fieldTitle = '', btnName?: string,
btnTitle?: string, btnAct?: EventListener, btnClass?: string, readonly = true,
newLine = true */

type FieldConfig = {
  content?: string|number,
  fieldTitle?: string,
  disabled?: boolean
};