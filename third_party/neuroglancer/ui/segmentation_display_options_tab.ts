/**
 * @license
 * Copyright 2016 Google Inc.
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

import {Overlay} from 'neuroglancer/overlay';
import {LAYER_CONTROLS, SegmentationUserLayer, SKELETON_RENDERING_SHADER_CONTROL_TOOL_ID} from 'neuroglancer/segmentation_user_layer';
import {DependentViewWidget} from 'neuroglancer/widget/dependent_view_widget';
import {makeHelpButton} from 'neuroglancer/widget/help_button';
import {addLayerControlToOptionsTab} from 'neuroglancer/widget/layer_control';
import {LinkedLayerGroupWidget} from 'neuroglancer/widget/linked_layer';
import {makeMaximizeButton} from 'neuroglancer/widget/maximize_button';
import {ShaderCodeWidget} from 'neuroglancer/widget/shader_code_widget';
import {ShaderControls} from 'neuroglancer/widget/shader_controls';
import {Tab} from 'neuroglancer/widget/tab_view';
import {makeToolButton} from 'neuroglancer/ui/tool';
import {SELECT_SEGMENTS_TOOLS_ID} from 'neuroglancer/ui/segment_select_tools';
import {ColorWidget} from 'neuroglancer/widget/color';
import {vec3} from 'neuroglancer/util/geom';

function makeSkeletonShaderCodeWidget(layer: SegmentationUserLayer) {
  return new ShaderCodeWidget({
    fragmentMain: layer.displayState.skeletonRenderingOptions.shader,
    shaderError: layer.displayState.shaderError,
    shaderControlState: layer.displayState.skeletonRenderingOptions.shaderControlState,
  });
}

export class DisplayOptionsTab extends Tab {
  constructor(public layer: SegmentationUserLayer) {
    super();
    const {element} = this;
    element.classList.add('neuroglancer-segmentation-rendering-tab');

    // nge: the Select tool, moved here from the Seg tab (Ames 2026-10-14).
    {
      const toolbox = document.createElement('div');
      toolbox.className = 'neuroglancer-segmentation-toolbox nge-render-select-tool';
      toolbox.appendChild(makeToolButton(this, layer.toolBinder, {
        toolJson: SELECT_SEGMENTS_TOOLS_ID, label: 'Select',
        title: 'Select: turn it on, then drag across the 2D view to add every cell you pass over. Alt+drag takes them out.',
      }));
      element.appendChild(toolbox);
    }

    // Linked segmentation control
    {
      const widget = this.registerDisposer(
          new LinkedLayerGroupWidget(layer.displayState.linkedSegmentationGroup));
      widget.label.textContent = 'Linked to: ';
      element.appendChild(widget.element);
    }

    // Linked segmentation control
    {
      const widget = this.registerDisposer(
          new LinkedLayerGroupWidget(layer.displayState.linkedSegmentationColorGroup));
      widget.label.textContent = 'Colors linked to: ';
      element.appendChild(widget.element);
    }

    for (const control of LAYER_CONTROLS) {
      element.appendChild(addLayerControlToOptionsTab(this, layer, this.visibility, control));
    }

    // nge: the volume's bounding box, shown or not and its colour (Ames
    // 2026-10-14). These lived in an Annotations tab that held nothing else.
    {
      const row = document.createElement('label');
      row.className = 'neuroglancer-layer-control-container nge-bounds-control';
      const name = document.createElement('span');
      name.className = 'neuroglancer-layer-control-label-container';
      name.textContent = 'Bounding box';
      const show = document.createElement('input');
      show.type = 'checkbox';
      show.title = 'Show the box around the volume';
      const boundsSubsources = () => {
        const out: {sub: any, source: any}[] = [];
        for (const ds of layer.dataSources) {
          const loaded: any = ds.loadState;
          if (!loaded || loaded.error !== undefined || !loaded.subsources) continue;
          for (const sub of loaded.subsources) {
            if (sub.subsourceEntry?.id === 'bounds') out.push({sub, source: loaded});
          }
        }
        return out;
      };
      const refresh = () => {
        const subs = boundsSubsources();
        row.style.display = subs.length ? '' : 'none';
        show.checked = subs.some(x => x.sub.enabled);
      };
      show.addEventListener('change', () => {
        for (const {sub, source} of boundsSubsources()) {
          sub.enabled = show.checked;
          source.enableDefaultSubsources = false;
          source.enabledSubsourcesChanged.dispatch();
        }
        refresh();
      });
      const color = this.registerDisposer(new ColorWidget(
          layer.annotationDisplayState.color, () => vec3.fromValues(0.10, 0.25, 0.60)));
      color.element.title = 'Color of the box';
      const controls = document.createElement('span');
      controls.className = 'nge-bounds-control-inputs';
      controls.append(show, color.element);
      row.append(name, controls);
      element.appendChild(row);
      this.registerDisposer(layer.dataSourcesChanged.add(refresh));
      const timer = setInterval(refresh, 1500);
      this.registerDisposer(() => clearInterval(timer));
      refresh();
    }

    const skeletonControls = this.registerDisposer(new DependentViewWidget(
        layer.hasSkeletonsLayer, (hasSkeletonsLayer, parent, refCounted) => {
          if (!hasSkeletonsLayer) return;
          let topRow = document.createElement('div');
          topRow.className = 'neuroglancer-segmentation-dropdown-skeleton-shader-header';
          let label = document.createElement('div');
          label.style.flex = '1';
          label.textContent = 'Skeleton shader:';
          topRow.appendChild(label);
          topRow.appendChild(makeMaximizeButton({
            title: 'Show larger editor view',
            onClick: () => {
              new ShaderCodeOverlay(this.layer);
            }
          }));
          topRow.appendChild(makeHelpButton({
            title: 'Documentation on skeleton rendering',
            href:
                'https://github.com/google/neuroglancer/blob/master/src/neuroglancer/sliceview/image_layer_rendering.md',
          }));
          parent.appendChild(topRow);

          const codeWidget = refCounted.registerDisposer(makeSkeletonShaderCodeWidget(this.layer));
          parent.appendChild(codeWidget.element);
          parent.appendChild(refCounted
                                 .registerDisposer(new ShaderControls(
                                     layer.displayState.skeletonRenderingOptions.shaderControlState,
                                     this.layer.manager.root.display, this.layer, {
                                       visibility: this.visibility,
                                       toolId: SKELETON_RENDERING_SHADER_CONTROL_TOOL_ID,
                                     }))
                                 .element);
          codeWidget.textEditor.refresh();
        }, this.visibility));
    element.appendChild(skeletonControls.element);
  }
}

class ShaderCodeOverlay extends Overlay {
  codeWidget = this.registerDisposer(makeSkeletonShaderCodeWidget(this.layer));
  constructor(public layer: SegmentationUserLayer) {
    super();
    this.content.classList.add('neuroglancer-segmentation-layer-skeleton-shader-overlay');
    this.content.appendChild(this.codeWidget.element);
    this.codeWidget.textEditor.refresh();
  }
}
