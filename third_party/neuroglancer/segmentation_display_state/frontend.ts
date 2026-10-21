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

import {LayerChunkProgressInfo} from 'neuroglancer/chunk_manager/base';
import {ChunkManager, ChunkRenderLayerFrontend} from 'neuroglancer/chunk_manager/frontend';
import {LayerSelectedValues} from 'neuroglancer/layer';
import {PickIDManager} from 'neuroglancer/object_picking';
import {WatchableRenderLayerTransform} from 'neuroglancer/render_coordinate_transform';
import {RenderScaleHistogram} from 'neuroglancer/render_scale_statistics';
import {RenderLayer} from 'neuroglancer/renderlayer';
import {getCssColor, SegmentColorHash} from 'neuroglancer/segment_color';
import {forEachVisibleSegment, onTemporaryVisibleSegmentsStateChanged, onVisibleSegmentsStateChanged, VISIBLE_SEGMENTS_STATE_PROPERTIES, VisibleSegmentsState} from 'neuroglancer/segmentation_display_state/base';
import {InlineSegmentNumericalProperty, InlineSegmentProperty, PreprocessedSegmentPropertyMap} from 'neuroglancer/segmentation_display_state/property_map';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {SharedWatchableValue} from 'neuroglancer/shared_watchable_value';
import {TrackableAlphaValue} from 'neuroglancer/trackable_alpha';
import {observeWatchable, registerNestedSync, TrackableValue, WatchableValueInterface} from 'neuroglancer/trackable_value';
import {isWithinSelectionPanel} from 'neuroglancer/ui/selection_details';
import {Uint64Map} from 'neuroglancer/uint64_map';
import {setClipboard} from 'neuroglancer/util/clipboard';
import {useWhiteBackground} from 'neuroglancer/util/color';
import {RefCounted} from 'neuroglancer/util/disposable';
import {measureElementClone} from 'neuroglancer/util/dom';
import {kOneVec, vec3, vec4} from 'neuroglancer/util/geom';
import {NullarySignal} from 'neuroglancer/util/signal';
import {Uint64} from 'neuroglancer/util/uint64';
import {withSharedVisibility} from 'neuroglancer/visibility_priority/frontend';
import {makeCopyButton} from 'neuroglancer/widget/copy_button';
import {makeEyeButton} from 'neuroglancer/widget/eye_button';
import {makeFilterButton} from 'neuroglancer/widget/filter_button';
import svg_bin from 'ikonate/icons/bin.svg';
import svg_plus from 'ikonate/icons/plus.svg';
import {makeIcon} from 'neuroglancer/widget/icon';

export class Uint64MapEntry {
  constructor(public key: Uint64, public value?: Uint64, public label?: string|undefined) {}
  toString() {
    const {key, value, label} = this;
    let baseString: string;
    if (value === undefined) {
      baseString = `${key}`;
    } else {
      baseString = `${key}→${value}`;
    }
    if (label === undefined) return baseString;
    return `${baseString} ${label}`;
  }
}

export class SegmentSelectionState extends RefCounted {
  selectedSegment = new Uint64();
  baseSelectedSegment = new Uint64();
  hasSelectedSegment = false;
  changed = new NullarySignal();

  get value() {
    return this.hasSelectedSegment ? this.selectedSegment : undefined;
  }

  get baseValue() {
    return this.hasSelectedSegment ? this.baseSelectedSegment : undefined;
  }

  set(value: number|Uint64MapEntry|Uint64|null|undefined, hideSegmentZero = false) {
    const {selectedSegment, baseSelectedSegment} = this;
    let newLow: number = 0, newHigh: number = 0, newBaseLow: number = 0, newBaseHigh: number = 0;
    let hasSelectedSegment: boolean;
    if (value == null) {
      hasSelectedSegment = false;
    } else if (typeof value === 'number') {
      newLow = newBaseLow = (value >>> 0);
      newHigh = newBaseHigh = value < 0 ? 0xffffffff : 0;
      hasSelectedSegment = true;
    } else if (value instanceof Uint64MapEntry) {
      const valueMapped = value.value || value.key;
      newLow = valueMapped.low;
      newHigh = valueMapped.high;
      newBaseLow = value.key.low;
      newBaseHigh = value.key.high;
      hasSelectedSegment = true;
    } else if (value instanceof Uint64) {
      newLow = newBaseLow = value.low;
      newHigh = newBaseHigh = value.high;
      hasSelectedSegment = true;
    } else {
      hasSelectedSegment = false;
    }
    if (hideSegmentZero && newLow === 0 && newHigh === 0) {
      hasSelectedSegment = false;
    }
    if (!hasSelectedSegment) {
      if (this.hasSelectedSegment) {
        this.hasSelectedSegment = false;
        this.changed.dispatch();
      }
    } else if (
        hasSelectedSegment &&
        (!this.hasSelectedSegment || selectedSegment.low !== newLow ||
         selectedSegment.high !== newHigh || baseSelectedSegment.low !== newBaseLow ||
         baseSelectedSegment.high !== newBaseHigh)) {
      selectedSegment.low = newLow;
      selectedSegment.high = newHigh;
      baseSelectedSegment.low = newBaseLow;
      baseSelectedSegment.high = newBaseHigh;
      this.hasSelectedSegment = true;
      this.changed.dispatch();
    }
  }

  isSelected(value: Uint64) {
    return this.hasSelectedSegment && Uint64.equal(value, this.selectedSegment);
  }

  bindTo(layerSelectedValues: LayerSelectedValues, userLayer: SegmentationUserLayer) {
    this.registerDisposer(layerSelectedValues.changed.add(() => {
      const state = layerSelectedValues.get(userLayer);
      let value: any = undefined;
      if (state !== undefined) {
        value = state.value;
      }
      this.set(value, userLayer.displayState.segmentationGroupState.value.hideSegmentZero.value);
    }));
  }
}

export interface SegmentationGroupState extends VisibleSegmentsState {
  /**
   * Maximum length of base-10 representation of id seen.
   */
  maxIdLength: WatchableValueInterface<number>;
  segmentPropertyMap: WatchableValueInterface<PreprocessedSegmentPropertyMap|undefined>;
}

export interface SegmentationColorGroupState {
  segmentColorHash: SegmentColorHash;
  segmentStatedColors: Uint64Map;
  tempSegmentStatedColors2d: Uint64Map;
  segmentDefaultColor: WatchableValueInterface<vec3|undefined>;
  tempSegmentDefaultColor2d: WatchableValueInterface<vec3|vec4|undefined>;
}

export interface SegmentationDisplayState {
  segmentSelectionState: SegmentSelectionState;
  saturation: TrackableAlphaValue;
  hoverHighlight: WatchableValueInterface<boolean>;
  baseSegmentColoring: WatchableValueInterface<boolean>;
  baseSegmentHighlighting: WatchableValueInterface<boolean>;
  segmentationGroupState: WatchableValueInterface<SegmentationGroupState>;
  segmentationColorGroupState: WatchableValueInterface<SegmentationColorGroupState>;

  selectSegment: (id: Uint64, pin: boolean|'toggle') => void;
  filterBySegmentLabel: (id: Uint64) => void;
  moveToSegment: (id: Uint64) => void;

  // Indirect properties
  hideSegmentZero: WatchableValueInterface<boolean>;
  segmentColorHash: WatchableValueInterface<number>;
  segmentStatedColors: WatchableValueInterface<Uint64Map>;
  tempSegmentStatedColors2d: WatchableValueInterface<Uint64Map>;
  useTempSegmentStatedColors2d: WatchableValueInterface<boolean>;
  segmentDefaultColor: WatchableValueInterface<vec3|undefined>;
  tempSegmentDefaultColor2d: WatchableValueInterface<vec3|vec4|undefined>;
  highlightColor: WatchableValueInterface<vec4|undefined>;
}

export function resetTemporaryVisibleSegmentsState(state: VisibleSegmentsState) {
  state.useTemporarySegmentEquivalences.value = false;
  state.useTemporaryVisibleSegments.value = false;
  state.temporaryVisibleSegments.clear();
  state.temporarySegmentEquivalences.clear();
}

/// Converts a segment id to a Uint64MapEntry or Uint64 (if Uint64MapEntry would add no additional
/// information).
export function maybeAugmentSegmentId(
    displayState: SegmentationDisplayState|undefined|null, value: number|Uint64,
    mustCopy: boolean = false): Uint64|Uint64MapEntry {
  let id: Uint64;
  let mappedValue: Uint64;
  let mapped: Uint64|undefined;
  let label: string|undefined;
  if (typeof value === 'number') {
    id = new Uint64((value >>> 0), value < 0 ? 0xffffffff : 0);
  } else if (typeof value === 'string') {
    id = Uint64.parseString(value);
  } else {
    id = mustCopy ? value.clone() : value;
  }
  if (displayState == null) return id;
  const {segmentEquivalences, segmentPropertyMap: {value: segmentPropertyMap}} =
      displayState.segmentationGroupState.value;
  if (segmentEquivalences.size !== 0) {
    mappedValue = segmentEquivalences.get(id);
    if (Uint64.equal(mappedValue, id)) {
      mapped = undefined;
    } else {
      mapped = mappedValue;
    }
  } else {
    mappedValue = id;
  }
  label = segmentPropertyMap?.getSegmentLabel(mappedValue);
  if (label === undefined && mapped == undefined) {
    return id;
  }
  return new Uint64MapEntry(id, mapped, label);
}

/// Converts a plain segment id to a Uint64MapEntry.
export function augmentSegmentId(
    displayState: SegmentationDisplayState|undefined|null,
    value: number|Uint64|Uint64MapEntry): Uint64MapEntry {
  if (value instanceof Uint64MapEntry) return value;
  let newValue = maybeAugmentSegmentId(displayState, value);
  if (newValue instanceof Uint64) {
    return new Uint64MapEntry(newValue);
  }
  return newValue;
}

export function updateIdStringWidth(
    idStringWidth: WatchableValueInterface<number>, idString: string) {
  const {length} = idString;
  if (idStringWidth.value < length) {
    idStringWidth.value = length;
  }
}

export function bindSegmentListWidth(displayState: SegmentationDisplayState, element: HTMLElement) {
  return observeWatchable(
      width => element.style.setProperty('--neuroglancer-segment-list-width', `${width}ch`),
      displayState.segmentationGroupState.value.maxIdLength);
}

const segmentWidgetTemplate = (() => {
  const template = document.createElement('div');
  template.classList.add('neuroglancer-segment-list-entry');
  const stickyContainer = document.createElement('div');
  stickyContainer.classList.add('neuroglancer-segment-list-entry-sticky');
  template.appendChild(stickyContainer);
  const copyButton = makeCopyButton({
    title: `Copy segment ID`,
  });
  copyButton.classList.add('neuroglancer-segment-list-entry-copy');
  const copyContainer = document.createElement('div');
  copyContainer.classList.add('neuroglancer-segment-list-entry-copy-container');
  const copyIndex = copyContainer.childElementCount;
  copyContainer.appendChild(copyButton);
  const copyContainerIndex = stickyContainer.childElementCount;
  stickyContainer.appendChild(copyContainer);
  const visibleIndex = stickyContainer.childElementCount;
  const visibleIcon = makeEyeButton({
    title: 'Toggle segment visibility',
  });
  visibleIcon.classList.add('neuroglancer-segment-list-entry-visible-checkbox');
  stickyContainer.appendChild(visibleIcon);
  const idContainer = document.createElement('div');
  idContainer.classList.add('neuroglancer-segment-list-entry-id-container');
  const idContainerIndex = stickyContainer.childElementCount;
  stickyContainer.appendChild(idContainer);
  const idElement = document.createElement('div');
  idElement.classList.add('neuroglancer-segment-list-entry-id');
  const idIndex = idContainer.childElementCount;
  idContainer.appendChild(idElement);
  // nge: the star was neuroglancer's "keep this in the list" mark, and taking
  // it off took the cell out of view, which read as a bug (Ames 2026-10-14).
  // A cell in the list has a trash can that removes it; a search result has
  // a + that adds it. The `neuroglancer-starred` class (in the list) still
  // says which one shows.
  const starButton = document.createElement('div');
  starButton.classList.add('neuroglancer-segment-list-entry-star', 'nge-seg-list-toggle');
  const removeIcon = makeIcon({svg: svg_bin, title: 'Remove from view'});
  removeIcon.classList.add('nge-seg-list-remove');
  const addIcon = makeIcon({svg: svg_plus, title: 'Add to view'});
  addIcon.classList.add('nge-seg-list-add');
  starButton.append(removeIcon, addIcon);
  const starIndex = stickyContainer.childElementCount;
  stickyContainer.appendChild(starButton);

  const nameElement = document.createElement('span');
  nameElement.classList.add('neuroglancer-segment-list-entry-name');
  const labelIndex = template.childElementCount;
  template.appendChild(nameElement);
  const filterElement = makeFilterButton({
    title: 'Filter by label',
  });
  filterElement.classList.add('neuroglancer-segment-list-entry-filter');
  const filterIndex = template.childElementCount;
  template.appendChild(filterElement);
  return {
    template,
    copyContainerIndex,
    copyIndex,
    visibleIndex,
    idContainerIndex,
    idIndex,
    labelIndex,
    filterIndex,
    starIndex,
    unmappedIdIndex: -1,
    unmappedCopyIndex: -1
  };
})();

const segmentWidgetTemplateWithUnmapped = (() => {
  const t = segmentWidgetTemplate;
  const template = t.template.cloneNode(/*deep=*/ true) as HTMLDivElement;
  const stickyContainer = template.children[0] as HTMLElement;
  const idContainer = stickyContainer.children[t.idContainerIndex] as HTMLElement;
  const unmappedIdIndex = idContainer.childElementCount;
  const unmappedIdElement =
      idContainer.children[t.idIndex].cloneNode(/*deep=*/ true) as HTMLElement;
  unmappedIdElement.classList.add('neuroglancer-segment-list-entry-unmapped-id');
  idContainer.appendChild(unmappedIdElement);
  const copyContainer = stickyContainer.children[t.copyContainerIndex] as HTMLElement;
  const unmappedCopyIndex = copyContainer.childElementCount;
  copyContainer.appendChild(copyContainer.children[t.copyIndex].cloneNode(/*deep=*/ true));
  return {...t, template, unmappedIdIndex, unmappedCopyIndex};
})();

export type SegmentWidgetTemplate = typeof segmentWidgetTemplate;

interface SegmentWidgetWithExtraColumnsTemplate extends SegmentWidgetTemplate {
  numericalPropertyIndices: number[];
}

export function segmentWidgetTemplateWithExtraColumns(numExtraColumns: number):
    SegmentWidgetWithExtraColumnsTemplate {
  let origTemplate = segmentWidgetTemplate;
  const templateElement = origTemplate.template.cloneNode(/*deep=*/ true) as HTMLDivElement;
  const numericalPropertyIndices: number[] = [];
  for (let i = 0; i < numExtraColumns; ++i) {
    numericalPropertyIndices.push(templateElement.childElementCount);
    const child = document.createElement('div');
    child.classList.add('neuroglancer-segment-list-entry-extra-property');
    child.style.width =
        `max(var(--neuroglancer-column-${i}-width), var(--neuroglancer-column-${i}-label-width))`;
    templateElement.appendChild(child);
  }
  return {...origTemplate, template: templateElement, numericalPropertyIndices};
}

const cachedRegisterSegmentWidgetEventHandlers = new WeakMap<
    SegmentationDisplayState, (element: HTMLElement, template: SegmentWidgetTemplate) => void>();

function makeRegisterSegmentWidgetEventHandlers(displayState: SegmentationDisplayState) {
  const onMouseEnter = (event: Event) => {
    const entryElement = event.currentTarget as HTMLElement;
    const idString = entryElement.dataset.id!;
    const id = tempStatedColor;
    id.tryParseString(idString);
    displayState.segmentSelectionState.set(id);
    if (!isWithinSelectionPanel(entryElement)) {
      displayState.selectSegment(id, false);
    }
  };

  const selectHandler = (event: Event) => {
    const entryElement = event.currentTarget as HTMLElement;
    const idString = entryElement.dataset.id!;
    const id = tempStatedColor;
    id.tryParseString(idString);
    displayState.selectSegment(id, isWithinSelectionPanel(entryElement) ? 'toggle' : true);
  };

  const onMouseLeave = () => {
    displayState.segmentSelectionState.set(null);
  };

  const getEntryElement = (event: Event): HTMLElement => {
    return (event.currentTarget as HTMLElement).closest('.neuroglancer-segment-list-entry') as
        HTMLElement;
  };

  const copyHandler = (event: Event) => {
    const entryElement = getEntryElement(event);
    setClipboard(entryElement.dataset.id!);
    event.stopPropagation();
  };

  const unmappedCopyHandler = (event: Event) => {
    const entryElement = getEntryElement(event);
    setClipboard(entryElement.dataset.unmappedId!);
    event.stopPropagation();
  };

  const visibleCheckboxHandler = (event: Event) => {
    const entryElement = getEntryElement(event);
    const idString = entryElement.dataset.id!;
    const id = tempStatedColor;
    id.tryParseString(idString);
    const {selectedSegments, visibleSegments} = displayState.segmentationGroupState.value;
    const shouldBeVisible = !visibleSegments.has(id);
    if (shouldBeVisible) {
      selectedSegments.add(id);
    }
    visibleSegments.set(id, shouldBeVisible);
    event.stopPropagation();
    event.preventDefault();
  };

  const filterHandler = (event: Event) => {
    const entryElement = getEntryElement(event);
    const idString = entryElement.dataset.id!;
    const id = tempStatedColor
    id.tryParseString(idString);
    displayState.filterBySegmentLabel(id);
    event.stopPropagation();
  };

  const onMousedown = (event: MouseEvent) => {
    if (event.button !== 2 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    const entryElement = event.currentTarget as HTMLElement;
    const idString = entryElement.dataset.id!;
    const id = tempStatedColor
    id.tryParseString(idString);
    displayState.moveToSegment(id);
  };

  return (element: HTMLElement, template: SegmentWidgetTemplate) => {
    const {children} = element;
    const stickyChildren = children[0].children;
    element.addEventListener('mousedown', onMousedown);
    const copyContainer = stickyChildren[template.copyContainerIndex] as HTMLElement;
    if (template.unmappedCopyIndex !== -1) {
      copyContainer.children[template.unmappedCopyIndex].addEventListener(
          'click', unmappedCopyHandler);
    }
    copyContainer.children[template.copyIndex].addEventListener('click', copyHandler);
    element.addEventListener('mouseenter', onMouseEnter);
    element.addEventListener('mouseleave', onMouseLeave);
    stickyChildren[template.visibleIndex].addEventListener('click', visibleCheckboxHandler);
    children[template.filterIndex].addEventListener('click', filterHandler);
    element.addEventListener('action:select-position', selectHandler);

    const starButton = stickyChildren[template.starIndex] as HTMLElement;
    starButton.addEventListener('click', (event: MouseEvent) => {
      const entryElement = getEntryElement(event);
      const idString = entryElement.dataset.id!;
      const id = tempStatedColor
      id.tryParseString(idString);
      const {selectedSegments, visibleSegments} = displayState.segmentationGroupState.value;
      if (selectedSegments.has(id)) {
        selectedSegments.delete(id);
      } else {
        selectedSegments.add(id);
        visibleSegments.add(id);
      }
    });
  };
}

export class SegmentWidgetFactory<Template extends SegmentWidgetTemplate> {
  private registerEventHandlers: undefined|
      ((element: HTMLElement, template: SegmentWidgetTemplate) => void);
  constructor(
      public displayState: SegmentationDisplayState|undefined, protected template: Template) {
    if (displayState !== undefined) {
      let r = cachedRegisterSegmentWidgetEventHandlers.get(displayState);
      if (r === undefined) {
        r = makeRegisterSegmentWidgetEventHandlers(displayState);
        cachedRegisterSegmentWidgetEventHandlers.set(displayState, r);
      }
      this.registerEventHandlers = r;
    }
  }

  static make(displayState: SegmentationDisplayState|undefined, includeUnmapped: boolean) {
    return new SegmentWidgetFactory(
        displayState, includeUnmapped ? segmentWidgetTemplateWithUnmapped : segmentWidgetTemplate);
  }

  get(rawId: Uint64|number): HTMLDivElement {
    const {displayState} = this;
    return this.getWithNormalizedId(augmentSegmentId(displayState, rawId));
  }

  getWithNormalizedId(normalizedId: Uint64MapEntry): HTMLDivElement {
    const {displayState} = this;
    const {template} = this;
    const container = template.template.cloneNode(/*deep=*/ true) as HTMLDivElement;
    const id = normalizedId.key;
    const mapped = normalizedId.value ?? id;
    const mappedIdString = mapped.toString();
    container.dataset.id = mappedIdString;
    const {children} = container;
    const stickyChildren = children[0].children;
    const idContainer = stickyChildren[template.idContainerIndex] as HTMLElement;
    idContainer.children[template.idIndex].textContent = mappedIdString;
    const {unmappedIdIndex} = template;
    if (displayState !== undefined) {
      this.registerEventHandlers!(container, template);
    } else {
      (stickyChildren[template.visibleIndex] as HTMLElement).style.display = 'none';
    }
    if (unmappedIdIndex !== -1) {
      const unmappedIdElement = idContainer.children[unmappedIdIndex] as HTMLElement;
      if (!Uint64.equal(id, mapped)) {
        const unmappedIdString = id.toString();
        container.dataset.unmappedId = unmappedIdString;
        unmappedIdElement.textContent = unmappedIdString;
        if (displayState !== undefined) {
          updateIdStringWidth(
              displayState.segmentationGroupState.value.maxIdLength, unmappedIdString);
        }
      } else {
        unmappedIdElement.style.display = 'none';
        const copyContainer = stickyChildren[template.copyContainerIndex] as HTMLElement;
        (copyContainer.children[template.unmappedCopyIndex] as HTMLElement).style.display = 'none';
      }
    }
    children[template.labelIndex].textContent = normalizedId.label ?? '';
    if (displayState !== undefined) {
      this.updateWithId(container, mapped);
      updateIdStringWidth(displayState.segmentationGroupState.value.maxIdLength, mappedIdString);
    }
    return container;
  }

  update(container: HTMLElement) {
    const id = tempStatedColor;
    const idString = container.dataset.id;
    if (idString === undefined) return;
    id.parseString(idString);
    this.updateWithId(container, id);
  }

  private updateWithId(container: HTMLElement, mapped: Uint64) {
    const {children} = container;
    const stickyChildren = children[0].children;
    const {template} = this;
    const {displayState} = this;
    const {segmentSelectionState} = displayState!;
    const {visibleSegments} = displayState!.segmentationGroupState.value;
    (stickyChildren[template.visibleIndex] as HTMLInputElement)
        .classList.toggle('neuroglancer-visible', visibleSegments.has(mapped));
    container.dataset.selected = (segmentSelectionState.hasSelectedSegment &&
                                  Uint64.equal(segmentSelectionState.selectedSegment, mapped))
                                     .toString();
    const {selectedSegments} = displayState!.segmentationGroupState.value;
    (stickyChildren[template.starIndex] as HTMLInputElement)
        .classList.toggle('neuroglancer-starred', selectedSegments.has(mapped));
    const idContainer = stickyChildren[template.idContainerIndex] as HTMLElement;
    setSegmentIdElementStyle(
        (idContainer.children[template.idIndex] as HTMLElement),
        getBaseObjectColor(this.displayState, mapped) as vec3);
    const {unmappedIdIndex} = template;
    if (unmappedIdIndex !== -1) {
      let unmappedIdString: string|undefined;
      let color: vec3;
      if (displayState!.baseSegmentColoring.value &&
          (unmappedIdString = container.dataset.unmappedId) !== undefined) {
        const unmappedId = tempStatedColor;
        unmappedId.parseString(unmappedIdString);
        color = getBaseObjectColor(this.displayState, unmappedId) as vec3;
      } else {
        color = kOneVec;
      }
      setSegmentIdElementStyle(idContainer.children[unmappedIdIndex] as HTMLElement, color);
    }
  }
}

function setSegmentIdElementStyle(element: HTMLElement, color: vec3) {
  element.style.backgroundColor = getCssColor(color);
  element.style.color = useWhiteBackground(color) ? 'white' : 'black';
}

export class SegmentWidgetWithExtraColumnsFactory extends
    SegmentWidgetFactory<SegmentWidgetWithExtraColumnsTemplate> {
  segmentPropertyMap: PreprocessedSegmentPropertyMap|undefined;
  numericalProperties: InlineSegmentNumericalProperty[];
  numericalPropertyWidths: number[];
  parentElement: HTMLElement;
  constructor(
      displayState: SegmentationDisplayState, parentElement: HTMLElement,
      includeProperty: (property: InlineSegmentProperty) => boolean) {
    const segmentPropertyMap = displayState.segmentationGroupState.value.segmentPropertyMap.value;
    const numericalProperties =
        (segmentPropertyMap?.numericalProperties ?? []).filter(includeProperty);
    const template = segmentWidgetTemplateWithExtraColumns(numericalProperties.length);
    super(displayState, template);
    this.parentElement = parentElement;
    this.segmentPropertyMap = segmentPropertyMap;
    this.numericalProperties = numericalProperties;
    const numericalPropertyWidths = this.numericalPropertyWidths =
        new Array(this.numericalProperties.length);
    numericalPropertyWidths.fill(0);
  }

  getWithNormalizedId(normalizedId: Uint64MapEntry): HTMLDivElement {
    const container = super.getWithNormalizedId(normalizedId);
    const {numericalProperties} = this;
    const {numericalPropertyIndices} = this.template;
    if (numericalPropertyIndices.length > 0) {
      const index =
          this.segmentPropertyMap?.getSegmentInlineIndex(normalizedId.value ?? normalizedId.key) ??
          -1;
      if (index !== -1) {
        const {numericalPropertyWidths} = this;
        for (let i = 0, n = numericalPropertyIndices.length; i < n; ++i) {
          const value = numericalProperties[i].values[index];
          if (!isNaN(value)) {
            const s = value.toString();
            const w = s.length;
            if (w > numericalPropertyWidths[i]) {
              numericalPropertyWidths[i] = w;
              this.parentElement.style.setProperty(`--neuroglancer-column-${i}-width`, `${w}ch`);
            }
            container.children[numericalPropertyIndices[i]].textContent = s;
          }
        }
      }
    }
    return container;
  }

  private makeHeaderLabel(id: string, widthProperty: string, parent: HTMLElement) {
    const label = document.createElement('span');
    label.textContent = id;
    label.classList.add('neuroglancer-segment-list-header-label');
    label.classList.add('neuroglancer-segment-list-header-label');
    if (id === 'label') {
      parent.style.textAlign = 'left';
    }
    const sortIcon = document.createElement('span');
    sortIcon.classList.add('neuroglancer-segment-list-header-label-sort');
    label.appendChild(sortIcon);
    sortIcon.textContent = '▲';
    const width = measureElementClone(label).width;
    this.parentElement.style.setProperty(widthProperty, `${width}px`);
    parent.appendChild(label);
    return {id, label, sortIcon};
  }

  getHeader() {
    const {template} = this;
    const container = template.template.cloneNode(/*deep=*/ true) as HTMLDivElement;
    const {children} = container;
    const stickyChildren = children[0].children;
    const copyContainer = stickyChildren[template.copyContainerIndex] as HTMLElement;
    copyContainer.style.visibility = 'hidden';
    (stickyChildren[template.visibleIndex] as HTMLElement).style.visibility = 'hidden';
    (children[template.filterIndex] as HTMLElement).style.visibility = 'hidden';
    const idContainer = stickyChildren[template.idContainerIndex] as HTMLElement;
    const propertyLabels = [
      this.makeHeaderLabel(
          'id', '--neuroglancer-id-column-label-width',
          idContainer.children[template.idIndex] as HTMLElement),
      this.makeHeaderLabel(
          'label', '--neuroglancer-label-column-label-width',
          children[template.labelIndex] as HTMLElement),
    ];
    const {numericalProperties} = this;
    const {numericalPropertyIndices} = this.template;
    for (let i = 0, n = numericalPropertyIndices.length; i < n; ++i) {
      const property = numericalProperties[i];
      const headerLabel = this.makeHeaderLabel(
          property.id, `--neuroglancer-column-${i}-label-width`,
          container.children[numericalPropertyIndices[i]] as HTMLElement);
      const {description} = property;
      if (description) {
        headerLabel.label.title = description;
      }
      propertyLabels.push(headerLabel);
    }
    return {container, propertyLabels};
  }
}

export function makeSegmentWidget(
    displayState: SegmentationDisplayState|undefined|null, normalizedId: Uint64MapEntry) {
  const factory = SegmentWidgetFactory.make(displayState ?? undefined, /*includeUnmapped=*/ true);
  return factory.getWithNormalizedId(normalizedId);
}

export interface SegmentationDisplayStateWithAlpha extends SegmentationDisplayState {
  objectAlpha: TrackableAlphaValue;
}

export interface SegmentationDisplayState3D extends SegmentationDisplayStateWithAlpha {
  transform: WatchableRenderLayerTransform;
  renderScaleHistogram: RenderScaleHistogram;
  renderScaleTarget: TrackableValue<number>;
  // Specifies whether to write to the pick buffer when rendering with transparency.  This prevents
  // any object behind the transparent object from being picked.  When not rendering with
  // transparency, the pick buffer is always written (since there is no downside).
  transparentPickEnabled: WatchableValueInterface<boolean>;
}

export function registerCallbackWhenSegmentationDisplayStateChanged(
    displayState: SegmentationDisplayState, context: RefCounted, callback: () => void) {
  context.registerDisposer(registerNestedSync((c, groupState) => {
    onVisibleSegmentsStateChanged(c, groupState, callback);
  }, displayState.segmentationGroupState));
  context.registerDisposer(registerNestedSync((c, colorGroupState) => {
    c.registerDisposer(colorGroupState.segmentColorHash.changed.add(callback));
    c.registerDisposer(colorGroupState.segmentDefaultColor.changed.add(callback));
  }, displayState.segmentationColorGroupState));
  context.registerDisposer(displayState.saturation.changed.add(callback));
  context.registerDisposer(displayState.segmentSelectionState.changed.add(callback));
  context.registerDisposer(displayState.baseSegmentColoring.changed.add(callback));
  context.registerDisposer(displayState.hoverHighlight.changed.add(callback));
}

export function registerRedrawWhenSegmentationDisplayStateChanged(
    displayState: SegmentationDisplayState, renderLayer: {redrawNeeded: NullarySignal}&RefCounted) {
  const callback = renderLayer.redrawNeeded.dispatch;
  registerCallbackWhenSegmentationDisplayStateChanged(displayState, renderLayer, callback);
  renderLayer.registerDisposer(registerNestedSync((c, groupState) => {
    onTemporaryVisibleSegmentsStateChanged(c, groupState, callback);
  }, displayState.segmentationGroupState));
}

export function registerRedrawWhenSegmentationDisplayStateWithAlphaChanged(
    displayState: SegmentationDisplayStateWithAlpha,
    renderLayer: {redrawNeeded: NullarySignal}&RefCounted) {
  registerRedrawWhenSegmentationDisplayStateChanged(displayState, renderLayer);
  renderLayer.registerDisposer(
      displayState.objectAlpha.changed.add(renderLayer.redrawNeeded.dispatch));
}

export function registerRedrawWhenSegmentationDisplayState3DChanged(
    displayState: SegmentationDisplayState3D,
    renderLayer: {redrawNeeded: NullarySignal}&RefCounted) {
  registerRedrawWhenSegmentationDisplayStateWithAlphaChanged(displayState, renderLayer);
  renderLayer.registerDisposer(
      displayState.transform.changed.add(renderLayer.redrawNeeded.dispatch));
  renderLayer.registerDisposer(
      displayState.renderScaleTarget.changed.add(renderLayer.redrawNeeded.dispatch));
  renderLayer.registerDisposer(
      displayState.transparentPickEnabled.changed.add(renderLayer.redrawNeeded.dispatch));
}

/**
 * EyeWire II (wolfryder101 #181, Ames 2026-10-20: "can we make highlight
 * cooler? like a glow"): how the cell under the mouse is shown. The classic
 * fade washed the cell out; the others leave its colours as they are:
 *   halo     a slim glowing line around the cell in 3D (new players' default)
 *   outline  a crisp line just outside the cell in 3D (Ames did not like it;
 *            not offered in Settings, kept for a saved choice)
 *   pulse    bands of light running out along the cell from the mouse in 3D
 *   wireframe  the cell's triangles drawn in lines of its own colour over a
 *            dimmed body (Ames 2026-10-20)
 *   saturate the opposite of the fade: the cell's colour turns richer and a
 *            little brighter, in 2D and 3D (Ames 2026-10-20)
 *   fade     the classic look, the cell turns pale (existing players' default)
 * In 2D every style but fade keeps the cell's colour and makes it more solid.
 * The 3D outline and halo are drawn by perspective_view/panel.ts (ngeDrawShells
 * in mesh/frontend.ts), the pulse by the mesh shader. Read once at load;
 * Settings updates it live.
 */
export type NgeHoverStyle = 'outline'|'halo'|'pulse'|'wireframe'|'saturate'|'fade';
/** The style when the player has not chosen one (Ames 2026-10-20: "make
 *  Halo the default highlight mode for new users. We can retain
 *  legacy/original one for existing users"): a browser with settings in it
 *  already is an existing player's, and keeps the classic fade. The settings
 *  store (store.ts) settles it, and corrects it from the account copy. */
export function ngeDefaultHoverStyle(prefs: any): NgeHoverStyle {
  return prefs && Object.keys(prefs).length || ngeBrowserUsedBefore() ? 'fade' : 'halo';
}
/** Pyr was used in this browser before, even by a player who never saved a
 *  setting: they signed in here (the sign in token) or played a tutorial or
 *  earned a tutorial badge. */
function ngeBrowserUsedBefore(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('auth_token_v2_') || k.startsWith('nge-badge-')) return true;
      if (/^nge-tutorial(-\d+)?-step$/.test(k) && Number(localStorage.getItem(k)) > 0) return true;
    }
  } catch { /* no storage: treat as new */ }
  return false;
}
export function ngeParseHoverStyle(prefs: any): NgeHoverStyle {
  const v = prefs?.hoverStyle;
  return v === 'halo' || v === 'pulse' || v === 'wireframe' || v === 'saturate' || v === 'fade' || v === 'outline' ? v : ngeDefaultHoverStyle(prefs);
}
export const ngeHoverStyle = {value: ((): NgeHoverStyle => {
  try { return ngeParseHoverStyle(JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}')); } catch { return 'pulse'; }
})()};
/** How far the halo has faded for zoom, 0 (all there) to 1 (gone); set each
 *  frame by mesh/frontend.ts. */
export const ngeHaloFar = {value: 0};

/** EyeWire II 'saturate': richer colour, a little brighter (2D does the same
 *  in sliceview/volume/segmentation_renderlayer.ts). */
export function ngeSaturate(color: Float32Array|number[]) {
  const grey = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
  for (let i = 0; i < 3; ++i) {
    // Ames 2026-10-20: 1.7 and 1.12 were "a bit much".
    color[i] = Math.max(0, Math.min(1, (grey + (color[i] - grey) * 1.35) * 1.05));
  }
}

/** The pulse's colour (Nseraf: "if we can also change the colour of the
 *  'electricity'"): '#rrggbb', or '' for a light tint of the cell's own. */
export function ngeParsePulseColor(hex: unknown): [number, number, number]|null {
  const m = typeof hex === 'string' ? /^#([0-9a-f]{6})$/i.exec(hex) : null;
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export const ngePulseColor = {value: ((): [number, number, number]|null => {
  try { return ngeParsePulseColor(JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}').pulseColor); } catch { return null; }
})()};

/**
 * Temporary values used by getObjectColor.
 */
const tempColor = vec4.create();
const tempStatedColor = new Uint64();

export function getBaseObjectColor(
    displayState: SegmentationDisplayState|undefined|null, objectId: Uint64,
    color: Float32Array = tempColor) {
  if (displayState == null) {
    color.fill(1);
    return color;
  };
  const colorGroupState = displayState.segmentationColorGroupState.value;
  const {segmentStatedColors} = colorGroupState;
  if (segmentStatedColors.size !== 0 &&
      colorGroupState.segmentStatedColors.get(objectId, tempStatedColor)) {
    // If displayState maps the ID to a color, use it
    color[0] = ((tempStatedColor.low & 0x0000ff)) / 255.0;
    color[1] = ((tempStatedColor.low & 0x00ff00) >>> 8) / 255.0;
    color[2] = ((tempStatedColor.low & 0xff0000) >>> 16) / 255.0;
    return color;
  }
  const segmentDefaultColor = colorGroupState.segmentDefaultColor.value;
  if (segmentDefaultColor !== undefined) {
    color[0] = segmentDefaultColor[0];
    color[1] = segmentDefaultColor[1];
    color[2] = segmentDefaultColor[2];
    return color;
  }
  colorGroupState.segmentColorHash.compute(color, objectId);
  return color;
}

/**
 * Returns the alpha-premultiplied color to use.
 */
export function getObjectColor(
    displayState: SegmentationDisplayState, objectId: Uint64, alpha: number = 1) {
  const color = tempColor;
  color[3] = alpha;
  getBaseObjectColor(displayState, objectId, color);
  let saturation = displayState.saturation.value;
  if (ngeHoverStyle.value === 'fade' && displayState.hoverHighlight.value &&
      displayState.segmentSelectionState.isSelected(objectId)) {
    if (saturation > 0.5) {
      saturation = saturation -= 0.5;
    } else {
      saturation += 0.5;
    }
  }
  for (let i = 0; i < 3; ++i) {
    color[i] = color[i] * saturation + (1 - saturation);
  }
  if (ngeHoverStyle.value === 'saturate' && displayState.hoverHighlight.value &&
      displayState.segmentSelectionState.isSelected(objectId)) {
    ngeSaturate(color);
  } else if (ngeHoverStyle.value === 'halo' && ngeHaloFar.value > 0 && displayState.hoverHighlight.value &&
      displayState.segmentSelectionState.isSelected(objectId)) {
    // Far out the halo fades away, and the cell takes Saturate's colour in
    // its place, so the cell under the mouse still stands out.
    const before = [color[0], color[1], color[2]];
    ngeSaturate(color);
    for (let i = 0; i < 3; ++i) color[i] = before[i] + (color[i] - before[i]) * ngeHaloFar.value;
  }

  color[0] *= alpha;
  color[1] *= alpha;
  color[2] *= alpha;
  return color;
}

export function sendVisibleSegmentsState(state: VisibleSegmentsState, options: any = {}) {
  for (const property of VISIBLE_SEGMENTS_STATE_PROPERTIES) {
    options[property] = state[property].rpcId;
  }
  return options;
}

const Base = withSharedVisibility(ChunkRenderLayerFrontend);
export class SegmentationLayerSharedObject extends Base {
  constructor(
      public chunkManager: ChunkManager, public displayState: SegmentationDisplayState3D,
      chunkRenderLayer: LayerChunkProgressInfo) {
    super(chunkRenderLayer);
    const segmentationGroupState = displayState.segmentationGroupState.value;
    // Ensure that these properties remain valid as long as the layer does.
    for (const property of VISIBLE_SEGMENTS_STATE_PROPERTIES) {
      this.registerDisposer(segmentationGroupState[property].addRef());
    }
  }

  initializeCounterpartWithChunkManager(options: any) {
    let {displayState} = this;
    options['chunkManager'] = this.chunkManager.rpcId;
    sendVisibleSegmentsState(displayState.segmentationGroupState.value, options);
    options['transform'] =
        this.registerDisposer(SharedWatchableValue.makeFromExisting(
                                  this.chunkManager.rpc!, this.displayState.transform))
            .rpcId;
    options['renderScaleTarget'] =
        this.registerDisposer(SharedWatchableValue.makeFromExisting(
                                  this.chunkManager.rpc!, this.displayState.renderScaleTarget))
            .rpcId;
    super.initializeCounterpart(this.chunkManager.rpc!, options);
  }
}

export function forEachVisibleSegmentToDraw(
    displayState: SegmentationDisplayState3D, renderLayer: RenderLayer, emitColor: boolean,
    pickIDs: PickIDManager|undefined,
    callback: (
        objectId: Uint64, color: vec4|undefined, pickIndex: number|undefined,
        rootObjectId: Uint64) => void) {
  const alpha = Math.min(1, displayState.objectAlpha.value);
  const baseSegmentColoring = displayState.baseSegmentColoring.value;
  forEachVisibleSegment(displayState.segmentationGroupState.value, (objectId, rootObjectId) => {
    let pickIndex = pickIDs?.registerUint64(renderLayer, objectId);
    let color = emitColor ?
        getObjectColor(displayState, baseSegmentColoring ? objectId : rootObjectId, alpha) :
        undefined;
    callback(objectId, color, pickIndex, rootObjectId);
  });
}
