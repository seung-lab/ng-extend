/**
 * @license
 * Copyright 2020 Google Inc.
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

import './segment_list.css';

import type {DebouncedFunc} from 'lodash';
import debounce from 'lodash/debounce';
import throttle from 'lodash/throttle';
import {registerCallbackWhenSegmentationDisplayStateChanged, SegmentationDisplayState, SegmentWidgetWithExtraColumnsFactory} from 'neuroglancer/segmentation_display_state/frontend';
import {changeTagConstraintInSegmentQuery, executeSegmentQuery, ExplicitIdQuery, FilterQuery, findQueryResultIntersectionSize, forEachQueryResultSegmentIdGenerator, InlineSegmentNumericalProperty, isQueryUnconstrained, NumericalPropertyConstraint, parseSegmentQuery, PreprocessedSegmentPropertyMap, PropertyHistogram, queryIncludesColumn, QueryResult, unparseSegmentQuery, updatePropertyHistograms} from 'neuroglancer/segmentation_display_state/property_map';
import type {SegmentationUserLayer, SegmentationUserLayerGroupState} from 'neuroglancer/segmentation_user_layer';
import {observeWatchable, WatchableValue, WatchableValueInterface} from 'neuroglancer/trackable_value';
import {getDefaultSelectBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {animationFrameDebounce} from 'neuroglancer/util/animation_frame_debounce';
import {ArraySpliceOp, getFixedOrderMergeSplices} from 'neuroglancer/util/array';
import {setClipboard} from 'neuroglancer/util/clipboard';
import {RefCounted} from 'neuroglancer/util/disposable';
import {removeChildren, updateInputFieldWidth} from 'neuroglancer/util/dom';
import {EventActionMap, KeyboardEventBinder, registerActionListener} from 'neuroglancer/util/keyboard_bindings';
import {MouseEventBinder} from 'neuroglancer/util/mouse_bindings';
import {neverSignal, NullarySignal, Signal} from 'neuroglancer/util/signal';
import {Uint64} from 'neuroglancer/util/uint64';
import {CheckboxIcon} from 'neuroglancer/widget/checkbox_icon';
import {makeCopyButton} from 'neuroglancer/widget/copy_button';
import {DependentViewWidget} from 'neuroglancer/widget/dependent_view_widget';
import {Tab} from 'neuroglancer/widget/tab_view';
import {VirtualList, VirtualListSource} from 'neuroglancer/widget/virtual_list';
import {clampToInterval, computeInvlerp, dataTypeCompare, DataTypeInterval, dataTypeIntervalEqual, getClampedInterval, getIntervalBoundsEffectiveFraction, parseDataTypeValue} from 'neuroglancer/util/lerp';
import {CdfController, getUpdatedRangeAndWindowParameters, RangeAndWindowIntervals} from 'neuroglancer/widget/invlerp';
import {makeToolButton} from 'neuroglancer/ui/tool';
import {ANNOTATE_MERGE_SEGMENTS_TOOL_ID, ANNOTATE_SPLIT_SEGMENTS_TOOL_ID} from 'neuroglancer/ui/segment_split_merge_tools';
import {makeEyeButton} from 'neuroglancer/widget/eye_button';
import svg_bin from 'ikonate/icons/bin.svg';
import svg_plus from 'ikonate/icons/plus.svg';
import {makeIcon} from 'neuroglancer/widget/icon';
import {addPastedSegments, clearPastedSegments, getPastedSegments, listFilterOf, loadCellAtPlace, parsePastedIds, placeFrom, requestSegmentLabels, segmentLabels, segmentLabelsChanged, segmentMatchesFilter} from 'neuroglancer/ui/nge_pasted_segments';
import {StatusMessage} from 'neuroglancer/status';
import {openColorPalette, pickedSegments, SegmentFolders} from 'neuroglancer/ui/nge_segment_folders';

const tempUint64 = new Uint64();

abstract class SegmentListSource extends RefCounted implements VirtualListSource {
  length: number;
  changed = new Signal<(splices: readonly Readonly<ArraySpliceOp>[]) => void>();

  // The segment list is the concatenation of two lists: the `explicitSegments` list, specified as
  // explicit uint64 ids, and the `matches`, list, specifying the indices into the
  // `segmentPropertyMap` of the matching segments.
  explicitSegments: Uint64[]|undefined;
  explicitSegmentsVisible: boolean = false;

  debouncedUpdate = debounce(() => this.update(), 0);

  constructor(
      public segmentationDisplayState: SegmentationDisplayState,
      public parentElement: HTMLElement) {
    super();
  }

  abstract update(): void;

  private updateRendering(element: HTMLElement) {
    this.segmentWidgetFactory.update(element);
  }

  segmentWidgetFactory: SegmentWidgetWithExtraColumnsFactory;

  abstract render(index: number): HTMLDivElement;

  updateRenderedItems(list: VirtualList) {
    list.forEachRenderedItem(element => {
      this.updateRendering(element);
    });
  }
}

/** nge: which cells a list of cells in view holds: the pasted ones, one
 *  folder's (by folder id), or the rest ('inview'). */
type ListMode = 'inview'|'pasted'|{folder: string};

class StarredSegmentsListSource extends SegmentListSource {
  explicitSegmentsVisible: true;

  constructor(
      public segmentationDisplayState: SegmentationDisplayState,
      public parentElement: HTMLElement, public mode: ListMode = 'inview',
      protected filterText?: WatchableValueInterface<string>,
      protected folders?: SegmentFolders) {
    super(segmentationDisplayState, parentElement);
    this.update();
    const group = segmentationDisplayState.segmentationGroupState.value;
    this.registerDisposer(group.selectedSegments.changed.add(this.debouncedUpdate));
    // nge: the pasted cells and each folder are listed on their own.
    this.registerDisposer(getPastedSegments(group).changed.add(this.debouncedUpdate));
    if (folders !== undefined) {
      this.registerDisposer(folders.changed.add(this.debouncedUpdate));
    }
    // nge: words in the box narrow the cells listed, by name or ID.
    if (filterText !== undefined) {
      this.registerDisposer(filterText.changed.add(this.debouncedUpdate));
      this.registerDisposer(segmentLabelsChanged.add(() => {
        if (filterText.value.trim()) this.debouncedUpdate();
      }));
    }
  }

  /** nge: the words in the box, if any. */
  get filterValue() {
    return listFilterOf(this.filterText?.value ?? '');
  }

  /** nge: this list's cells, in the list's own order (pasted: newest paste
   *  first). A cell in a folder is listed only in its folder. */
  segmentsHere(): Uint64[] {
    const group = this.segmentationDisplayState.segmentationGroupState.value;
    const filter = listFilterOf(this.filterText?.value ?? '');
    const keep = (id: Uint64) => !filter || segmentMatchesFilter(id.toString(), filter);
    if (/[a-z]/i.test(filter)) {
      // a name search: find the names of the cells not drawn yet
      const unknown: string[] = [];
      for (const id of group.selectedSegments) {
        const s = id.toString();
        if (!segmentLabels.has(s)) unknown.push(s);
      }
      if (unknown.length) requestSegmentLabels(unknown);
    }
    const inFolders = this.folders?.memberIds() ?? new Set<string>();
    const {mode} = this;
    if (typeof mode === 'object') {
      const mine = new Set(this.folders?.value.find(f => f.id === mode.folder)?.ids ?? []);
      return [...group.selectedSegments].filter(id => mine.has(id.toString()) && keep(id));
    }
    const pasted = getPastedSegments(group).ids;
    if (mode === 'pasted') {
      const out: Uint64[] = [];
      for (const s of pasted) {
        if (inFolders.has(s)) continue;
        const id = Uint64.parseString(s);
        if (group.selectedSegments.has(id) && keep(id)) out.push(id);
      }
      return out;
    }
    const skip = new Set(pasted);
    return [...group.selectedSegments].filter(
        id => !skip.has(id.toString()) && !inFolders.has(id.toString()) && keep(id));
  }

  update() {
    const splices: ArraySpliceOp[] = [];
    const newSelectedSegments = this.segmentsHere();
    const {explicitSegments} = this;
    if (explicitSegments === undefined) {
      splices.push({retainCount: 0, insertCount: newSelectedSegments.length, deleteCount: 0});
    } else {
      splices.push(
          ...getFixedOrderMergeSplices(explicitSegments, newSelectedSegments, Uint64.equal));
    }
    this.explicitSegments = newSelectedSegments;
    this.length = newSelectedSegments.length;
    this.changed.dispatch(splices);
  }

  render = (index: number) => {
    const {explicitSegments} = this;
    const id = explicitSegments![index];
    return this.segmentWidgetFactory.get(id);
  };
}

class SegmentQueryListSource extends SegmentListSource {
  prevQuery: string|undefined;
  queryResult = new WatchableValue<QueryResult|undefined>(undefined);
  prevQueryResult = new WatchableValue<QueryResult|undefined>(undefined);
  statusText = new WatchableValue<string>('');
  selectedMatches: number = 0;
  visibleMatches: number = 0;
  matchStatusTextPrefix: string = '';
  selectedSegmentsGeneration = -1;
  visibleSegmentsGeneration = -1;
  explicitSegmentsVisible = false;

  get numMatches() {
    return this.queryResult.value?.count ?? 0;
  }

  update() {
    const query = this.query.value;
    const {segmentPropertyMap} = this;
    this.prevQueryResult.value = this.queryResult.value;
    const prevQueryResult = this.prevQueryResult.value;
    let queryResult: QueryResult;
    if (this.prevQuery === query) {
      queryResult = prevQueryResult!;
    } else {
      const queryParseResult = parseSegmentQuery(segmentPropertyMap, query);
      queryResult = executeSegmentQuery(segmentPropertyMap, queryParseResult);
    }

    const splices: ArraySpliceOp[] = [];
    let changed = false;
    let matchStatusTextPrefix = '';
    const unconstrained = isQueryUnconstrained(queryResult.query);
    if (!unconstrained) {
      if (this.explicitSegments !== undefined && this.explicitSegmentsVisible) {
        splices.push({deleteCount: this.explicitSegments.length, retainCount: 0, insertCount: 0});
        this.explicitSegments = undefined;
        changed = true;
      }
    }

    const {explicitIds} = queryResult;
    if (explicitIds !== undefined) {
      this.explicitSegments = explicitIds;
    } else if (!this.explicitSegmentsVisible) {
      this.explicitSegments = undefined;
    }

    if (prevQueryResult !== queryResult) {
      splices.push({
        retainCount: 0,
        deleteCount: prevQueryResult?.count ?? 0,
        insertCount: queryResult.count,
      });
      changed = true;
      this.queryResult.value = queryResult;
    }

    if (queryResult.explicitIds !== undefined) {
      matchStatusTextPrefix = `${queryResult.count} ids`;
    } else if (unconstrained) {
      matchStatusTextPrefix = `${queryResult.count} total ids`;
    } else if (queryResult.total > 0) {
      matchStatusTextPrefix = `${queryResult.count} match /${queryResult.total} total ids`;
    }

    const {selectedSegments, visibleSegments} =
        this.segmentationDisplayState.segmentationGroupState.value;
    const selectedSegmentsGeneration = selectedSegments.changed.count;
    const visibleSegmentsGeneration = visibleSegments.changed.count;
    const prevSelectedSegmentsGeneration = this.selectedSegmentsGeneration;
    const prevVisibleSegmentsGeneration = this.visibleSegmentsGeneration;
    const queryChanged = prevQueryResult !== queryResult;
    const selectedChanged =
        prevSelectedSegmentsGeneration !== selectedSegmentsGeneration || queryChanged;
    const visibleChanged =
        prevVisibleSegmentsGeneration !== visibleSegmentsGeneration || queryChanged;
    this.selectedSegmentsGeneration = selectedSegmentsGeneration;
    this.visibleSegmentsGeneration = visibleSegmentsGeneration;

    if (selectedChanged) {
      this.selectedMatches = queryResult.count > 0 ?
          findQueryResultIntersectionSize(segmentPropertyMap, queryResult, selectedSegments) :
          0;
    }

    if (visibleChanged) {
      this.visibleMatches = queryResult.count > 0 ?
          findQueryResultIntersectionSize(segmentPropertyMap, queryResult, visibleSegments) :
          0;
    }

    let fullStatusText = matchStatusTextPrefix;
    if (this.selectedMatches > 0) {
      if (this.selectedMatches === this.visibleMatches) {
        fullStatusText = `${this.selectedMatches} vis/${fullStatusText}`;
      } else if (this.visibleMatches > 0) {
        fullStatusText =
            `${this.visibleMatches} vis/${this.selectedMatches} star/${fullStatusText}`;
      } else {
        fullStatusText = `${this.selectedMatches} star/${fullStatusText}`;
      }
    }

    this.statusText.value = fullStatusText;

    this.prevQuery = query;
    this.matchStatusTextPrefix = matchStatusTextPrefix;
    this.length = queryResult.count;
    if (changed) {
      this.changed.dispatch(splices);
    }
  }

  constructor(
      public query: WatchableValueInterface<string>,
      public segmentPropertyMap: PreprocessedSegmentPropertyMap|undefined,
      public segmentationDisplayState: SegmentationDisplayState,
      public parentElement: HTMLElement) {
    super(segmentationDisplayState, parentElement);
    this.update();
    this.registerDisposer(
        segmentationDisplayState.segmentationGroupState.value.selectedSegments.changed.add(
            this.debouncedUpdate));  // to update statusText
    this.registerDisposer(
        segmentationDisplayState.segmentationGroupState.value.visibleSegments.changed.add(
            this.debouncedUpdate));  // to update statusText
    if (query) {
      this.registerDisposer(query.changed.add(this.debouncedUpdate));
    }
  }

  render = (index: number) => {
    const {explicitSegments} = this;
    let id: Uint64;
    if (explicitSegments !== undefined) {
      id = explicitSegments[index];
    } else {
      id = tempUint64;
      const propIndex = this.queryResult.value!.indices![index];
      const {ids} = this.segmentPropertyMap!.segmentPropertyMap.inlineProperties!;
      id.low = ids[propIndex * 2];
      id.high = ids[propIndex * 2 + 1];
    }
    return this.segmentWidgetFactory.get(id);
  };
}

const keyMap = EventActionMap.fromObject({
  'enter': {action: 'toggle-listed'},
  'shift+enter': {action: 'hide-listed'},
  'control+enter': {action: 'hide-all'},
  'escape': {action: 'cancel'},
});

interface NumericalBoundElements {
  container: HTMLElement;
  inputs: [HTMLInputElement, HTMLInputElement];
  spacers: [HTMLElement, HTMLElement, HTMLElement]|undefined;
}

interface NumericalPropertySummary {
  element: HTMLElement;
  controller: CdfController<RangeAndWindowIntervals>;
  property: InlineSegmentNumericalProperty;
  boundElements: {
    window: NumericalBoundElements,
    range: NumericalBoundElements,
  };
  plotImg: HTMLImageElement;
  propertyHistogram: PropertyHistogram|undefined;
  bounds: RangeAndWindowIntervals;
  columnCheckbox: HTMLInputElement;
  sortIcon: HTMLElement;
}

function updateInputBoundWidth(inputElement: HTMLInputElement) {
  updateInputFieldWidth(inputElement, Math.max(1, inputElement.value.length + 0.1));
}

function updateInputBoundValue(inputElement: HTMLInputElement, bound: number) {
  let boundString: string;
  if (Number.isInteger(bound)) {
    boundString = bound.toString();
  } else {
    const sFull = bound.toString();
    const sPrecision = bound.toPrecision(6);
    boundString = (sFull.length < sPrecision.length) ? sFull : sPrecision;
  }
  inputElement.value = boundString;
  updateInputBoundWidth(inputElement);
}

function createBoundInput(boundType: 'range'|'window', endpointIndex: 0|1) {
  const e = document.createElement('input');
  e.addEventListener('focus', () => {
    e.select();
  });
  e.classList.add(`neuroglancer-segment-query-result-numerical-plot-${boundType}-bound`);
  e.classList.add('neuroglancer-segment-query-result-numerical-plot-bound');
  e.type = 'text';
  e.spellcheck = false;
  e.autocomplete = 'off';
  e.title = (endpointIndex === 0 ? 'Lower' : 'Upper') + ' bound ' +
      (boundType === 'range' ? 'range' : 'for distribution');
  e.addEventListener('input', () => {
    updateInputBoundWidth(e);
  });
  return e;
}

function toggleIncludeColumn(
    queryResult: QueryResult|undefined, setQuery: (query: FilterQuery) => void, fieldId: string) {
  if (queryResult === undefined) return;
  if (queryResult.indices === undefined) return;
  const query = queryResult.query as FilterQuery;
  let {sortBy, includeColumns} = query;
  const included = queryIncludesColumn(query, fieldId);
  if (included) {
    sortBy = sortBy.filter(x => x.fieldId !== fieldId);
    includeColumns = includeColumns.filter(x => x !== fieldId);
  } else {
    includeColumns.push(fieldId);
  }
  setQuery({...query, sortBy, includeColumns});
}

function toggleSortOrder(
    queryResult: QueryResult|undefined, setQuery: (query: FilterQuery) => void, id: string) {
  const query = queryResult?.query;
  const sortBy = query?.sortBy;
  if (sortBy === undefined) return;
  const {includeColumns} = (query as FilterQuery);
  const prevOrder = sortBy.find(x => x.fieldId === id)?.order;
  const newOrder = (prevOrder === '<') ? '>' : '<';
  const newIncludeColumns = includeColumns.filter(x => x !== id);
  for (const s of sortBy) {
    if (s.fieldId !== 'id' && s.fieldId !== 'label' && s.fieldId !== id) {
      newIncludeColumns.push(s.fieldId);
    }
  }
  setQuery({
    ...query as FilterQuery,
    sortBy: [{fieldId: id, order: newOrder}],
    includeColumns: newIncludeColumns,
  });
}

function updateColumnSortIcon(
    queryResult: QueryResult|undefined, sortIcon: HTMLElement, id: string) {
  const sortBy = queryResult?.query?.sortBy;
  const order = sortBy?.find(s => s.fieldId === id)?.order;
  sortIcon.textContent = order === '>' ? '▼' : '▲';
  sortIcon.style.visibility = order === undefined ? '' : 'visible';
  sortIcon.title = `Sort by ${id} in ${order === '<' ? 'descending' : 'ascending'} order`;
}

class NumericalPropertiesSummary extends RefCounted {
  listElement: HTMLElement|undefined;
  properties: NumericalPropertySummary[];
  propertyHistograms: PropertyHistogram[] = [];
  bounds = {
    window: new WatchableValue<DataTypeInterval[]>([]),
    range: new WatchableValue<DataTypeInterval[]>([]),
  };

  throttledUpdate = this.registerCancellable(throttle(() => this.updateHistograms(), 100));
  debouncedRender =
      this.registerCancellable(animationFrameDebounce(() => this.updateHistogramRenderings()));
  debouncedSetQuery = this.registerCancellable(debounce(() => this.setQueryFromBounds(), 200));

  constructor(
      public segmentPropertyMap: PreprocessedSegmentPropertyMap|undefined,
      public queryResult: WatchableValueInterface<QueryResult|undefined>,
      public setQuery: (query: FilterQuery) => void) {
    super();
    const properties = segmentPropertyMap?.numericalProperties;
    const propertySummaries: NumericalPropertySummary[] = [];
    let listElement: HTMLElement|undefined;
    if (properties !== undefined && properties.length > 0) {
      listElement = document.createElement('details');
      const summaryElement = document.createElement('summary');
      summaryElement.textContent =
          `${properties.length} numerical propert${properties.length > 1 ? 'ies' : 'y'}`;
      listElement.appendChild(summaryElement);
      listElement.classList.add('neuroglancer-segment-query-result-numerical-list');
      const windowBounds = this.bounds.window.value;
      for (let i = 0, numProperties = properties.length; i < numProperties; ++i) {
        const property = properties[i];
        const summary = this.makeNumericalPropertySummary(i, property);
        propertySummaries.push(summary);
        listElement.appendChild(summary.element);
        windowBounds[i] = property.bounds;
      }
    }
    this.listElement = listElement;
    this.properties = propertySummaries;
    this.registerDisposer(this.queryResult.changed.add(() => {
      this.handleNewQueryResult();
    }));
    // When window bounds change, we need to recompute histograms.  Throttle this to avoid
    // excessive computation time.
    this.registerDisposer(this.bounds.window.changed.add(this.throttledUpdate));
    // When window bounds or constraint bounds change, re-render the plot on the next animation
    // frame.
    this.registerDisposer(this.bounds.window.changed.add(this.debouncedRender));
    this.registerDisposer(this.bounds.range.changed.add(this.debouncedRender));
    this.registerDisposer(this.bounds.range.changed.add(this.debouncedSetQuery));
    this.handleNewQueryResult();
  }

  private setQueryFromBounds() {
    const queryResult = this.queryResult.value;
    if (queryResult === undefined) return;
    if (queryResult.indices === undefined) return;
    const query = queryResult.query as FilterQuery;
    const numericalConstraints: NumericalPropertyConstraint[] = [];
    const constraintBounds = this.bounds.range.value;
    const {properties} = this;
    for (let i = 0, numProperties = properties.length; i < numProperties; ++i) {
      const property = properties[i].property;
      numericalConstraints.push({fieldId: property.id, bounds: constraintBounds[i]});
    }
    this.setQuery({...query, numericalConstraints});
  }

  private getBounds(propertyIndex: number) {
    const {bounds} = this;
    return {range: bounds.range.value[propertyIndex], window: bounds.window.value[propertyIndex]};
  }

  private setBounds(propertyIndex: number, value: RangeAndWindowIntervals) {
    const {property} = this.properties[propertyIndex];
    let newRange = getClampedInterval(property.bounds, value.range);
    if (dataTypeCompare(newRange[0], newRange[1]) > 0) {
      newRange = [newRange[1], newRange[0]] as DataTypeInterval;
    }
    const newWindow = getClampedInterval(property.bounds, value.window);
    const oldValue = this.getBounds(propertyIndex);
    const {dataType} = this.properties[propertyIndex].property;
    if (!dataTypeIntervalEqual(dataType, newWindow, oldValue.window)) {
      this.bounds.window.value[propertyIndex] = newWindow;
      this.bounds.window.changed.dispatch();
    }
    if (!dataTypeIntervalEqual(dataType, newRange, oldValue.range)) {
      this.bounds.range.value[propertyIndex] = newRange;
      this.bounds.range.changed.dispatch();
    }
  }

  private setBound(
      boundType: 'range'|'window', endpoint: 0|1, propertyIndex: number, value: number) {
    const property = this.segmentPropertyMap!.numericalProperties[propertyIndex];
    const baseBounds = property.bounds;
    value = clampToInterval(baseBounds, value) as number;
    const params = this.getBounds(propertyIndex);
    const newParams = getUpdatedRangeAndWindowParameters(
        params, boundType, endpoint, value, /*fitRangeInWindow=*/ true);
    this.setBounds(propertyIndex, newParams);
  }

  private handleNewQueryResult() {
    const queryResult = this.queryResult.value;
    const {listElement} = this;
    if (listElement === undefined) return;
    if (queryResult?.indices !== undefined) {
      const {numericalConstraints} = (queryResult!.query as FilterQuery);
      const {numericalProperties} = this.segmentPropertyMap!;
      const constraintBounds = this.bounds.range.value;
      const numConstraints = numericalConstraints.length;
      const numProperties = numericalProperties.length;
      constraintBounds.length = numProperties;
      for (let i = 0; i < numProperties; ++i) {
        constraintBounds[i] = numericalProperties[i].bounds;
      }
      for (let i = 0; i < numConstraints; ++i) {
        const constraint = numericalConstraints[i];
        const propertyIndex = numericalProperties.findIndex(p => p.id === constraint.fieldId);
        constraintBounds[propertyIndex] = constraint.bounds;
      }
    }
    this.updateHistograms();
    this.throttledUpdate.cancel();
  }

  private updateHistograms() {
    const queryResult = this.queryResult.value;
    const {listElement} = this;
    if (listElement === undefined) return;
    updatePropertyHistograms(
        this.segmentPropertyMap, queryResult, this.propertyHistograms, this.bounds.window.value);
    this.updateHistogramRenderings();
  }

  private updateHistogramRenderings() {
    this.debouncedRender.cancel();
    const {listElement} = this;
    if (listElement === undefined) return;
    const {propertyHistograms} = this;
    if (propertyHistograms.length === 0) {
      listElement.style.display = 'none';
      return;
    }
    listElement.style.display = '';
    const {properties} = this;
    for (let i = 0, n = properties.length; i < n; ++i) {
      this.updateNumericalPropertySummary(i, properties[i], propertyHistograms[i]);
    }
  }

  private makeNumericalPropertySummary(
      propertyIndex: number, property: InlineSegmentNumericalProperty): NumericalPropertySummary {
    const plotContainer = document.createElement('div');
    plotContainer.classList.add('neuroglancer-segment-query-result-numerical-plot-container');
    const plotImg = document.createElement('img');
    plotImg.classList.add('neuroglancer-segment-query-result-numerical-plot');
    const controller = new CdfController(
        plotImg, property.dataType, () => this.getBounds(propertyIndex),
        bounds => this.setBounds(propertyIndex, bounds));
    const sortIcon = document.createElement('span');
    sortIcon.classList.add('neuroglancer-segment-query-result-numerical-plot-sort');
    const columnCheckbox = document.createElement('input');
    columnCheckbox.type = 'checkbox';
    columnCheckbox.addEventListener('click', () => {
      toggleIncludeColumn(this.queryResult.value, this.setQuery, property.id);
    });
    const makeBoundElements = (boundType: 'window'|'range'): NumericalBoundElements => {
      const container = document.createElement('div');
      container.classList.add('neuroglancer-segment-query-result-numerical-plot-bounds');
      container.classList.add(
          `neuroglancer-segment-query-result-numerical-plot-bounds-${boundType}`);
      const makeBoundElement = (endpointIndex: 0|1) => {
        const e = createBoundInput(boundType, endpointIndex);
        e.addEventListener('change', () => {
          const existingBounds = this.bounds[boundType].value[propertyIndex];
          if (existingBounds === undefined) return;
          try {
            const value = parseDataTypeValue(property.dataType, e.value);
            this.setBound(boundType, endpointIndex, propertyIndex, value as number);
            this.bounds[boundType].changed.dispatch();
          } catch {
          }
          updateInputBoundValue(
              e, this.bounds[boundType].value[propertyIndex][endpointIndex] as number);
        });
        return e;
      };
      const inputs: [HTMLInputElement, HTMLInputElement] =
          [makeBoundElement(0), makeBoundElement(1)];

      let spacers: [HTMLElement, HTMLElement, HTMLElement]|undefined;
      if (boundType === 'range') {
        spacers = [
          document.createElement('div'),
          document.createElement('div'),
          document.createElement('div'),
        ];
        spacers[1].classList.add(
            'neuroglancer-segment-query-result-numerical-plot-bound-constraint-spacer');
        spacers[1].appendChild(columnCheckbox);
        const label = document.createElement('span');
        label.classList.add('neuroglancer-segment-query-result-numerical-plot-label');
        label.appendChild(document.createTextNode(property.id));
        label.appendChild(sortIcon);
        label.addEventListener('click', () => {
          toggleSortOrder(this.queryResult.value, this.setQuery, property.id);
        });
        spacers[1].appendChild(label);
        const {description} = property;
        if (description) {
          spacers[1].title = description;
        }
        container.appendChild(spacers[0]);
        container.appendChild(inputs[0]);
        const lessEqual1 = document.createElement('div');
        lessEqual1.textContent = '≤';
        lessEqual1.classList.add(
            'neuroglancer-segment-query-result-numerical-plot-bound-constraint-symbol');
        container.appendChild(lessEqual1);
        container.appendChild(spacers[1]);
        const lessEqual2 = document.createElement('div');
        lessEqual2.textContent = '≤';
        lessEqual2.classList.add(
            'neuroglancer-segment-query-result-numerical-plot-bound-constraint-symbol');
        container.appendChild(lessEqual2);
        container.appendChild(inputs[1]);
        container.appendChild(spacers[2]);
      } else {
        container.appendChild(inputs[0]);
        container.appendChild(inputs[1]);
      }
      return {container, spacers, inputs};
    };
    const boundElements = {
      range: makeBoundElements('range'),
      window: makeBoundElements('window'),
    };
    plotContainer.appendChild(boundElements.range.container);
    plotContainer.appendChild(plotImg);
    plotContainer.appendChild(boundElements.window.container);
    return {
      property,
      controller,
      element: plotContainer,
      plotImg,
      boundElements,
      bounds: {
        window: [NaN, NaN],
        range: [NaN, NaN],
      },
      propertyHistogram: undefined,
      columnCheckbox,
      sortIcon,
    };
  }

  private updateNumericalPropertySummary(
      propertyIndex: number, summary: NumericalPropertySummary,
      propertyHistogram: PropertyHistogram) {
    const prevWindowBounds = summary.bounds.window;
    const windowBounds = this.bounds.window.value[propertyIndex]!;
    const prevConstraintBounds = summary.bounds.range;
    const constraintBounds = this.bounds.range.value[propertyIndex]!;
    const {property} = summary;
    const queryResult = this.queryResult.value;
    const isIncluded = queryIncludesColumn(queryResult?.query, property.id);
    summary.columnCheckbox.checked = isIncluded;
    summary.columnCheckbox.title =
        isIncluded ? 'Remove column from result table' : 'Add column to result table';
    updateColumnSortIcon(queryResult, summary.sortIcon, property.id);
    // Check if we need to update the image.
    if (summary.propertyHistogram === propertyHistogram &&
        dataTypeIntervalEqual(property.dataType, prevWindowBounds, windowBounds) &&
        dataTypeIntervalEqual(property.dataType, prevConstraintBounds, constraintBounds)) {
      return;
    }
    const {histogram} = propertyHistogram;
    const svgNs = 'http://www.w3.org/2000/svg';
    const plotElement = document.createElementNS(svgNs, 'svg');
    plotElement.setAttribute('width', `1`);
    plotElement.setAttribute('height', `1`);
    plotElement.setAttribute('preserveAspectRatio', 'none');
    const rect = document.createElementNS(svgNs, 'rect');
    const constraintStartX = computeInvlerp(windowBounds, constraintBounds[0]);
    const constraintEndX = computeInvlerp(windowBounds, constraintBounds[1]);
    rect.setAttribute('x', `${constraintStartX}`);
    rect.setAttribute('y', '0');
    rect.setAttribute('width', `${constraintEndX - constraintStartX}`);
    rect.setAttribute('height', '1');
    rect.setAttribute('fill', '#4f4f4f');
    plotElement.appendChild(rect);
    const numBins = histogram.length;
    const makeCdfLine =
        (startBinIndex: number, endBinIndex: number, endBinIndexForTotal: number) => {
          const polyLine = document.createElementNS(svgNs, 'polyline');
          let points = '';
          let totalCount = 0;
          for (let i = startBinIndex; i < endBinIndexForTotal; ++i) {
            totalCount += histogram[i];
          }
          if (totalCount === 0) return undefined;
          const startBinX = computeInvlerp(windowBounds, propertyHistogram.window[0]);
          const endBinX = computeInvlerp(windowBounds, propertyHistogram.window[1]);
          const addPoint = (i: number, height: number) => {
            const fraction = i / (numBins - 2);
            const x = startBinX * (1 - fraction) + endBinX * fraction;
            points += ` ${x},${1 - height}`;
          };
          if (startBinIndex !== 0) {
            addPoint(startBinIndex, 0);
          }
          let cumSum = 0;
          for (let i = startBinIndex; i < endBinIndex; ++i) {
            const count = histogram[i];
            cumSum += count;
            addPoint(i, cumSum / totalCount);
          }
          polyLine.setAttribute('fill', 'none');
          polyLine.setAttribute('stroke-width', '1px');
          polyLine.setAttribute('points', points);
          polyLine.setAttribute('vector-effect', 'non-scaling-stroke');
          return polyLine;
        };

    {
      const polyLine = makeCdfLine(0, numBins - 1, numBins);
      if (polyLine !== undefined) {
        polyLine.setAttribute('stroke', 'cyan');
        plotElement.appendChild(polyLine);
      }
    }

    if (!dataTypeIntervalEqual(property.dataType, property.bounds, constraintBounds)) {
      // Also plot CDF restricted to data that satisfies the constraint.
      const constraintStartBin = Math.floor(
          Math.max(0, Math.min(1, computeInvlerp(propertyHistogram.window, constraintBounds[0]))) *
          (numBins - 2));
      const constraintEndBin = Math.ceil(
          Math.max(0, Math.min(1, computeInvlerp(propertyHistogram.window, constraintBounds[1]))) *
          (numBins - 2));
      const polyLine = makeCdfLine(constraintStartBin, constraintEndBin, constraintEndBin);
      if (polyLine !== undefined) {
        polyLine.setAttribute('stroke', 'white');
        plotElement.appendChild(polyLine);
      }
    }

    // Embed the svg as an img rather than embedding it directly, in order to
    // allow it to be scaled using CSS.
    const xml = (new XMLSerializer).serializeToString(plotElement);
    summary.plotImg.src = `data:image/svg+xml;base64,${btoa(xml)}`;
    summary.propertyHistogram = propertyHistogram;
    for (let endpointIndex = 0; endpointIndex < 2; ++endpointIndex) {
      prevWindowBounds[endpointIndex] = windowBounds[endpointIndex];
      updateInputBoundValue(
          summary.boundElements.window.inputs[endpointIndex],
          windowBounds[endpointIndex] as number);
      prevConstraintBounds[endpointIndex] = constraintBounds[endpointIndex];
      updateInputBoundValue(
          summary.boundElements.range.inputs[endpointIndex],
          constraintBounds[endpointIndex] as number);
    }

    const spacers = summary.boundElements.range.spacers!;
    const clampedRange = getClampedInterval(windowBounds, constraintBounds);
    const effectiveFraction = getIntervalBoundsEffectiveFraction(property.dataType, windowBounds);
    const leftOffset = computeInvlerp(windowBounds, clampedRange[0]) * effectiveFraction;
    const rightOffset =
        computeInvlerp(windowBounds, clampedRange[1]) * effectiveFraction + (1 - effectiveFraction);
    spacers[0].style.width = `${leftOffset * 100}%`;
    spacers[2].style.width = `${(1 - rightOffset) * 100}%`;
  }
}

function renderTagSummary(
    queryResult: QueryResult, setQuery: (query: FilterQuery) => void): HTMLElement|undefined {
  const {tags} = queryResult;
  if (tags === undefined || tags.length === 0) return undefined;
  const filterQuery = queryResult.query as FilterQuery;
  const tagList = document.createElement('div');
  tagList.classList.add('neuroglancer-segment-query-result-tag-list');
  for (const {tag, count} of tags) {
    const tagElement = document.createElement('div');
    tagElement.classList.add('neuroglancer-segment-query-result-tag');
    const tagName = document.createElement('span');
    tagName.classList.add('neuroglancer-segment-query-result-tag-name');
    tagName.textContent = tag;
    tagList.appendChild(tagElement);
    const included = filterQuery.includeTags.includes(tag);
    const excluded = filterQuery.excludeTags.includes(tag);
    let toggleTooltip: string;
    if (included) {
      toggleTooltip = 'Remove tag from required set';
    } else if (excluded) {
      toggleTooltip = 'Remove tag from excluded set';
    } else {
      toggleTooltip = 'Add tag to required set';
    }
    tagName.addEventListener('click', () => {
      setQuery(changeTagConstraintInSegmentQuery(filterQuery, tag, true, !included && !excluded));
    });
    tagName.title = toggleTooltip;
    const inQuery = included || excluded;
    const addIncludeExcludeButton = (include: boolean) => {
      const includeExcludeCount = include ? count : queryResult.count - count;
      const includeElement = document.createElement('div');
      includeElement.classList.add(`neuroglancer-segment-query-result-tag-toggle`);
      includeElement.classList.add(
          `neuroglancer-segment-query-result-tag-${include ? 'include' : 'exclude'}`);
      tagElement.appendChild(includeElement);
      if (!inQuery && includeExcludeCount === 0) return;
      const selected = include ? included : excluded;
      includeElement.appendChild(
          new CheckboxIcon(
              {
                get value() {
                  return selected;
                },
                set value(value: boolean) {
                  setQuery(changeTagConstraintInSegmentQuery(filterQuery, tag, include, value));
                },
                changed: neverSignal,
              },
              {
                text: include ? '+' : '-',
                enableTitle: `Add tag to ${include ? 'required' : 'exclusion'} set`,
                disableTitle: `Remove tag from ${include ? 'required' : 'exclusion'} set`,
                backgroundScheme: 'dark',
              })
              .element);
    };
    addIncludeExcludeButton(true);
    addIncludeExcludeButton(false);
    tagElement.appendChild(tagName);
    const numElement = document.createElement('span');
    numElement.classList.add('neuroglancer-segment-query-result-tag-count');
    if (!inQuery) {
      numElement.textContent = count.toString();
    }
    tagElement.appendChild(numElement);
  }
  return tagList;
}

abstract class SegmentListGroupBase extends RefCounted {
  element = document.createElement('div');

  selectionStatusContainer = document.createElement('span');
  starAllButton: HTMLElement;
  selectionStatusMessage = document.createElement('span');
  copyAllSegmentsButton: HTMLElement;
  copyVisibleSegmentsButton: HTMLElement;
  visibilityToggleAllButton: HTMLElement;

  statusChanged = new NullarySignal();

  private debouncedUpdateStatus = debounce(() => this.updateStatus(), 0);

  makeSegmentsVisible(visible: boolean) {
    const {visibleSegments} = this.group;
    const segments = Array.from(this.listSegments(true));
    visibleSegments.set(segments, visible);
  }

  invertVisibility() {
    const markVisible: Uint64[] = [];
    const markNonVisible: Uint64[] = [];
    const {visibleSegments} = this.group;
    for (const segment of this.listSegments(true)) {
      if (visibleSegments.has(segment)) {
        markNonVisible.push(segment);
      } else {
        markVisible.push(segment);
      }
    }
    visibleSegments.set(markVisible, true);
    visibleSegments.set(markNonVisible, false);
  }

  selectSegments(select: boolean, changeVisibility = false) {
    const {selectedSegments, visibleSegments} = this.group;
    const segments = Array.from(this.listSegments(true));
    if (select || !changeVisibility) {
      selectedSegments.set(segments, select);
    }
    if (changeVisibility) {
      visibleSegments.set(segments, select);
    }
  }

  copySegments(onlyVisible = false) {
    let ids = [...this.listSegments(true)];
    if (onlyVisible) {
      ids = ids.filter(segment => this.group.visibleSegments.has(segment));
    }
    ids.sort(Uint64.compare);
    setClipboard(ids.join(', '));
  }

  constructor(
      protected listSource: SegmentListSource, protected group: SegmentationUserLayerGroupState) {
    super();

    const {
      element,
    } = this;
    element.style.display = 'contents';
    // nge: in place of the star, search results get "add them all" and the
    // lists of cells in view get "remove them all" (Ames 2026-10-14).
    const isSearch = listSource instanceof SegmentQueryListSource;
    this.starAllButton = makeIcon({
      svg: isSearch ? svg_plus : svg_bin,
      title: isSearch ? 'Add every match to the view' : 'Remove these cells from the view',
      onClick: () => {
        if (isSearch) {
          this.selectSegments(true, true);
          return;
        }
        const ids = Array.from(this.listSegments(true));
        if (ids.length > 1 &&
            !window.confirm(`Remove ${ids.length} cells from the view?`)) {
          return;
        }
        this.group.selectedSegments.delete(ids);
      }
    });
    this.starAllButton.classList.add('nge-seg-list-all-toggle', isSearch ? 'nge-seg-add-all' : 'nge-seg-remove-all');
    this.copyAllSegmentsButton = makeCopyButton({
      title: 'Copy all segment IDs',
      onClick: () => {
        this.copySegments(false);
      },
    });
    this.copyVisibleSegmentsButton = makeCopyButton({
      title: 'Copy visible segment IDs',
      onClick: () => {
        this.copySegments(true);
      },
    });
    this.visibilityToggleAllButton = makeEyeButton({
      onClick: event => {
        if (event.shiftKey) {
          this.invertVisibility();
          return;
        }
        this.makeSegmentsVisible(
            !this.visibilityToggleAllButton.classList.contains('neuroglancer-visible'));
      }
    });
    const {selectionStatusContainer} = this;
    this.copyAllSegmentsButton.classList.add('nge-seg-copy-all');
    this.copyVisibleSegmentsButton.classList.add('nge-seg-copy-visible');
    this.selectionStatusMessage.classList.add('neuroglancer-segment-list-status-message');
    selectionStatusContainer.classList.add('neuroglancer-segment-list-status');
    selectionStatusContainer.appendChild(this.copyAllSegmentsButton);
    selectionStatusContainer.appendChild(this.starAllButton);
    selectionStatusContainer.appendChild(this.visibilityToggleAllButton);
    selectionStatusContainer.appendChild(this.copyVisibleSegmentsButton);
    selectionStatusContainer.appendChild(this.selectionStatusMessage);
    this.element.appendChild(selectionStatusContainer);
    this.registerDisposer(group.visibleSegments.changed.add(this.debouncedUpdateStatus));
    this.registerDisposer(group.selectedSegments.changed.add(this.debouncedUpdateStatus));
    this.registerDisposer(listSource.changed.add(this.debouncedUpdateStatus));
  }

  * listSegments(safe = false): IterableIterator<Uint64> {
    safe;
  }

  /** nge: the words before the count in a list's heading. */
  headingText() {
    return '';
  }

  updateStatus() {
    const {
      listSource,
      group,
      starAllButton,
      selectionStatusMessage,
      copyAllSegmentsButton,
      copyVisibleSegmentsButton,
      visibilityToggleAllButton
    } = this;
    listSource.debouncedUpdate.flush();
    const {visibleSegments, selectedSegments} = group;
    let queryVisibleCount = 0;
    let querySelectedCount = 0;
    let numMatches = 0;
    let statusMessage = '';
    const selectedCount = selectedSegments.size;
    const visibleCount = visibleSegments.size;
    if (listSource instanceof SegmentQueryListSource) {
      numMatches = listSource.numMatches;
      queryVisibleCount = listSource.visibleMatches;
      querySelectedCount = listSource.selectedMatches;
      statusMessage = listSource.statusText.value;
    } else {
      // nge: count this list's own cells (the pasted list and the list of
      // the others in view each have their own heading).
      let here = 0, shown = 0;
      for (const id of this.listSegments(true)) {
        ++here;
        if (visibleSegments.has(id)) ++shown;
      }
      queryVisibleCount = shown;
      querySelectedCount = here;
      // Shown out of listed (the eye beside it says what the numbers are).
      statusMessage = `${this.headingText()}${shown}/${here}`;
    }
    const isSearchList = listSource instanceof SegmentQueryListSource;
    const visibleDisplayedCount =
        numMatches ? queryVisibleCount : (isSearchList ? visibleCount : queryVisibleCount);
    const visibleSelectedCount =
        numMatches ? querySelectedCount : (isSearchList ? selectedCount : querySelectedCount);
    const totalDisplayed = numMatches || visibleSelectedCount;
    starAllButton.classList.toggle('neuroglancer-starred', visibleSelectedCount === totalDisplayed);
    starAllButton.classList.toggle(
        'neuroglancer-indeterminate',
        visibleSelectedCount > 0 && visibleSelectedCount !== totalDisplayed);
    selectionStatusMessage.textContent = statusMessage;
    copyAllSegmentsButton.title =
        `Copy all ${totalDisplayed} ${numMatches ? 'matching' : 'listed'} segment ID(s)`;
    copyVisibleSegmentsButton.title =
        `Copy ${visibleDisplayedCount} ${numMatches ? 'visible matching' : 'visible'} segment(s)`;
    copyAllSegmentsButton.style.visibility = totalDisplayed ? 'visible' : 'hidden';
    copyVisibleSegmentsButton.style.visibility = visibleDisplayedCount ? 'visible' : 'hidden';
    starAllButton.style.visibility = totalDisplayed ? 'visible' : 'hidden';
    visibilityToggleAllButton.style.visibility = totalDisplayed ? 'visible' : 'hidden';
    const allVisible = visibleDisplayedCount === totalDisplayed;
    visibilityToggleAllButton.classList.toggle('neuroglancer-visible', allVisible);
    const visibleIndeterminate =
        visibleDisplayedCount > 0 && visibleDisplayedCount !== totalDisplayed;
    visibilityToggleAllButton.classList.toggle('neuroglancer-indeterminate', visibleIndeterminate);
    let visibleToggleTitle: string;
    if (!allVisible) {
      visibleToggleTitle = `Click to show ${totalDisplayed - visibleDisplayedCount} segment ID(s).`;
    } else {
      visibleToggleTitle = `Click to hide ${totalDisplayed} segment ID(s).`;
    }
    if (visibleIndeterminate) {
      visibleToggleTitle += `  Shift+click to invert visibility.`;
    }
    visibilityToggleAllButton.title = visibleToggleTitle;
    this.statusChanged.dispatch();
  }
}

/** nge: what the Seg panel's sections can ask of the tab. */
interface SectionActions {
  /** Give cells one colour ('#rrggbb'). */
  recolor(ids: string[], hex: string): void;
  /** A folder was just made: name it. */
  onNewFolder(folderId: string): void;
}

const FOLDER_DRAG_TYPE = 'application/x-nge-folder';

class SegmentListGroupSelected extends SegmentListGroupBase {
  constructor(
      protected listSource: StarredSegmentsListSource,
      protected group: SegmentationUserLayerGroupState, folders?: SegmentFolders,
      actions?: SectionActions) {
    super(listSource, group);
    this.folderModel = folders;
    const {mode} = listSource;
    const kind = typeof mode === 'object' ? 'folder' : mode;
    this.element.classList.add(`nge-seg-list-group--${kind}`);
    const heading = this.selectionStatusContainer;
    heading.classList.add(`nge-seg-list-heading--${kind}`);
    if (mode === 'pasted') {
      // nge: put the pasted cells in with the rest (they stay in view).
      const keep = document.createElement('button');
      keep.className = 'nge-seg-list-keep';
      keep.textContent = 'Move down';
      keep.title = 'Put these cells in with the others in view (they stay shown)';
      keep.addEventListener('click', () => clearPastedSegments(group));
      heading.appendChild(keep);
    }
    if (folders === undefined) return;
    const targetFolder = typeof mode === 'object' ? mode.folder : '';

    // Cells dropped on a heading go into that folder; on In view, out of
    // their folder (drag_reorder.ts sends `nge-folder-drop`, with every
    // picked cell when the dragged one was picked).
    heading.dataset.ngeFolderDrop = targetFolder || 'none';
    heading.addEventListener('nge-folder-drop', (event: Event) => {
      const segIds = ((event as CustomEvent).detail?.segIds ?? []) as string[];
      if (!segIds.length) return;
      // A search result dropped on a folder joins the view as it goes in.
      const add: Uint64[] = [];
      for (const s of segIds) {
        const id = new Uint64();
        if (id.tryParseString(s) && !group.selectedSegments.has(id)) add.push(id);
      }
      if (add.length) {
        group.selectedSegments.add(add);
        group.visibleSegments.add(add);
      }
      const p = getPastedSegments(group);
      if (segIds.some(id => p.ids.includes(id))) {
        p.ids = p.ids.filter(id => !segIds.includes(id));
        p.changed.dispatch();
      }
      folders.move(segIds, targetFolder);
      pickedSegments.clear();
    });
    // A folder dragged onto a heading goes inside that folder; onto In view,
    // to the top level.
    heading.addEventListener('dragover', (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(FOLDER_DRAG_TYPE)) return;
      event.preventDefault();
      heading.classList.add('nge-folder-drop-target');
    });
    heading.addEventListener('dragleave', () => heading.classList.remove('nge-folder-drop-target'));
    heading.addEventListener('drop', (event: DragEvent) => {
      heading.classList.remove('nge-folder-drop-target');
      const dragged = event.dataTransfer?.getData(FOLDER_DRAG_TYPE);
      if (!dragged) return;
      event.preventDefault();
      if (dragged === targetFolder) return;
      folders.setParent(dragged, targetFolder || undefined);
    });

    if (mode === 'inview') {
      const add = document.createElement('button');
      add.className = 'nge-seg-list-keep nge-seg-folder-new';
      add.textContent = '+ Folder';
      add.title = 'Make a folder, then drag cells onto it (picked cells go straight in)';
      add.addEventListener('click', () => {
        const f = folders.create('New folder');
        const picked = [...pickedSegments.ids].filter(s => {
          const id = new Uint64();
          return id.tryParseString(s) && group.selectedSegments.has(id);
        });
        if (picked.length) {
          folders.move(picked, f.id);
          pickedSegments.clear();
        }
        actions?.onNewFolder(f.id);
      });
      heading.appendChild(add);
      return;
    }
    if (typeof mode !== 'object') return;

    // A folder's heading: fold, colour, name (double click or the pencil to
    // rename), a folder inside it, ungroup. Drag the heading to nest it.
    const folder = () => folders.value.find(f => f.id === mode.folder);
    heading.draggable = true;
    heading.addEventListener('dragstart', (event: DragEvent) => {
      if (name.contentEditable === 'true') { event.preventDefault(); return; }
      event.dataTransfer?.setData(FOLDER_DRAG_TYPE, mode.folder);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    const caret = document.createElement('button');
    caret.className = 'nge-seg-folder-caret';
    caret.title = 'Fold or unfold';
    caret.addEventListener('click', () => {
      const f = folder();
      if (f) folders.setCollapsed(f.id, !f.collapsed);
    });
    // The folder's colour: one click on the dot, one on a colour, and every
    // cell in the folder (and the folders inside it) takes it.
    const swatch = document.createElement('button');
    swatch.className = 'nge-seg-folder-color';
    swatch.title = 'Recolour every cell in this folder';
    swatch.addEventListener('click', event => {
      event.stopPropagation();
      const f = folder();
      if (!f) return;
      openColorPalette(swatch, f.color, hex => {
        const cur = folder();
        if (!cur) return;
        actions?.recolor(folders.cellsIn(cur.id), hex);
        if (cur.color !== hex || !cur.paint) folders.setColor(cur.id, hex, true);
      }, `Colour for ${f.name}`);
    });
    heading.prepend(caret, swatch);
    const name = document.createElement('span');
    name.className = 'nge-seg-folder-name';
    name.title = 'Double click to rename. Drag onto another folder to put it inside.';
    const startRename = () => {
      const f = folder();
      if (!f) return;
      name.contentEditable = 'true';
      name.focus();
      const range = document.createRange();
      range.selectNodeContents(name);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    const finishRename = (save: boolean) => {
      if (name.contentEditable !== 'true') return;
      name.contentEditable = 'false';
      const f = folder();
      if (!f) return;
      if (save && name.textContent && name.textContent.trim() !== f.name) {
        folders.rename(f.id, name.textContent);
      } else {
        name.textContent = f.name;
      }
    };
    name.addEventListener('dblclick', startRename);
    name.addEventListener('blur', () => finishRename(true));
    name.addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finishRename(true); }
      if (event.key === 'Escape') { event.preventDefault(); finishRename(false); }
    });
    this.selectionStatusMessage.before(name);
    const icon = (text: string, title: string, onClick: () => void, extra = '') => {
      const b = document.createElement('button');
      b.className = 'nge-seg-folder-icon' + (extra ? ' ' + extra : '');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    heading.append(
        icon('+', 'Make a folder inside this one', () => {
          const f = folder();
          if (!f) return;
          const child = folders.create('New folder', f.id);
          if (f.collapsed) folders.setCollapsed(f.id, false);
          actions?.onNewFolder(child.id);
        }),
        icon('\u270e', 'Rename this folder', startRename),
        icon('\u2715', 'Ungroup: the folder goes, its cells stay in view', () => {
          const f = folder();
          if (!f) return;
          const cells = folders.cellsIn(f.id).length;
          const inner = folders.subtree(f.id).length - 1;
          if (cells || inner) {
            const what = [cells ? `${cells} cell${cells === 1 ? '' : 's'}` : '',
                          inner ? `${inner} folder${inner === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
            if (!window.confirm(`Ungroup "${f.name}"? Its ${what} stay in view, out of this folder.`)) return;
          }
          folders.remove(f.id);
        }, 'nge-seg-folder-ungroup'));
    const paint = () => {
      const f = folder();
      if (!f) return;
      caret.textContent = f.collapsed ? '\u25b8' : '\u25be';
      if (name.contentEditable !== 'true') name.textContent = f.name;
      swatch.style.background = f.color ?? '#8cb4eb';
      this.element.style.setProperty('--nge-folder-color', f.color ?? '#8cb4eb');
      this.element.classList.toggle('nge-seg-folder--collapsed', !!f.collapsed);
      const depth = folders.ordered().find(x => x.folder.id === f.id)?.depth ?? 0;
      this.element.style.setProperty('--nge-folder-depth', String(depth));
    };
    // Copy the folder's IDs (and those of the folders inside it), beside the
    // other heading icons (Ames 2026-10-14).
    const copy = this.copyAllSegmentsButton;
    copy.classList.add('nge-seg-folder-copy');
    heading.insertBefore(copy, heading.querySelector('.nge-seg-folder-icon'));
    this.registerDisposer(folders.changed.add(paint));
    paint();
    this.startRename = startRename;
  }

  private folderModel?: SegmentFolders;
  startRename?: () => void;

  headingText() {
    const {mode} = this.listSource;
    if (typeof mode === 'object') return '\u00b7 ';
    return mode === 'pasted' ? 'Pasted \u00b7 ' : 'In view \u00b7 ';
  }

  /** A folder's heading acts on its cells and the cells of the folders
   *  inside it (show, hide, remove, copy). */
  listSegments(safe = false) {
    safe;
    const {mode} = this.listSource;
    if (typeof mode === 'object' && this.folderModel !== undefined) {
      const mine = new Set(this.folderModel.cellsIn(mode.folder));
      const filter = this.listSource.filterValue;
      return [...this.group.selectedSegments]
          .filter(id => mine.has(id.toString()) &&
                      (!filter || segmentMatchesFilter(id.toString(), filter)))[Symbol.iterator]();
    }
    return this.listSource.segmentsHere()[Symbol.iterator]();
  }
}

class SegmentListGroupQuery extends SegmentListGroupBase {
  updateQuery() {
    const {listSource, debouncedUpdateQueryModel} = this;
    debouncedUpdateQueryModel();
    debouncedUpdateQueryModel.flush();
    listSource.debouncedUpdate.flush();
  }

  listSegments(safe = false): IterableIterator<Uint64> {
    const {listSource, segmentPropertyMap} = this;
    this.updateQuery();
    const queryResult = listSource.queryResult.value;
    return forEachQueryResultSegmentIdGenerator(segmentPropertyMap, queryResult, safe);
  }

  constructor(
      list: VirtualList, protected listSource: SegmentQueryListSource,
      group: SegmentationUserLayerGroupState,
      private segmentPropertyMap: PreprocessedSegmentPropertyMap|undefined,
      segmentQuery: WatchableValueInterface<string>, queryElement: HTMLInputElement,
      private debouncedUpdateQueryModel: DebouncedFunc<() => void>) {
    super(listSource, group);
    const setQuery = (newQuery: ExplicitIdQuery|FilterQuery) => {
      queryElement.focus();
      queryElement.select();
      const value = unparseSegmentQuery(segmentPropertyMap, newQuery);
      document.execCommand('insertText', false, value);
      segmentQuery.value = value;
      queryElement.select();
    };
    const queryStatisticsContainer = document.createElement('div');
    queryStatisticsContainer.classList.add('neuroglancer-segment-query-result-statistics');
    const queryStatisticsSeparator = document.createElement('div');
    queryStatisticsSeparator.classList.add(
        'neuroglancer-segment-query-result-statistics-separator');
    const queryErrors = document.createElement('ul');
    queryErrors.classList.add('neuroglancer-segment-query-errors');
    // push them in front of the base list elements
    this.element.prepend(queryErrors, queryStatisticsContainer, queryStatisticsSeparator);
    this.registerEventListener(queryElement, 'input', () => {
      debouncedUpdateQueryModel();
    });
    this.registerDisposer(registerActionListener(queryElement, 'cancel', () => {
      queryElement.focus();
      queryElement.select();
      document.execCommand('delete');
      queryElement.blur();
      queryElement.value = '';
      segmentQuery.value = '';
    }));
    // nge: IDs typed or pasted into the box go straight into the view, shown,
    // under "Pasted" (Ames 2026-10-14). A name or a /regexp is still a search.
    const clearQuery = () => {
      debouncedUpdateQueryModel.cancel();
      queryElement.value = '';
      segmentQuery.value = '';
    };
    const addIdsFrom = (text: string) => {
      // Coordinates: go there (placeFrom says when numbers are a place).
      const place = placeFrom(text, (group as any).layer);
      if (place !== undefined) {
        const viewer = (window as any)['viewer'];
        if (viewer && viewer.coordinateSpace?.value?.rank === place.length) {
          viewer.navigationState.position.value = Float32Array.from(place);
          StatusMessage.showTemporaryMessage(`Moved to ${place.join(', ')}. Finding the cell there\u2026`);
          // and the cell there joins the list, under Pasted
          loadCellAtPlace(group);
        } else {
          StatusMessage.showTemporaryMessage('This view does not have three coordinates.');
        }
        clearQuery();
        return true;
      }
      const ids = parsePastedIds(text);
      if (ids === undefined) return false;
      addPastedSegments(group, ids);
      clearQuery();
      return true;
    };
    this.registerEventListener(queryElement, 'paste', (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const whole = queryElement.value.slice(0, queryElement.selectionStart ?? 0) + text +
          queryElement.value.slice(queryElement.selectionEnd ?? queryElement.value.length);
      if (placeFrom(whole, (group as any).layer) === undefined && parsePastedIds(whole) === undefined) return;
      event.preventDefault();
      addIdsFrom(whole);
    });
    this.registerDisposer(registerActionListener(queryElement, 'toggle-listed', () => {
      if (addIdsFrom(queryElement.value)) return;
      this.toggleMatches();
    }));
    this.registerDisposer(registerActionListener(queryElement, 'hide-all', () => {
      group.visibleSegments.clear();
    }));
    this.registerDisposer(registerActionListener(queryElement, 'hide-listed', () => {
      debouncedUpdateQueryModel();
      debouncedUpdateQueryModel.flush();
      listSource.debouncedUpdate.flush();
      const {visibleSegments} = group;
      if (this.listSource instanceof StarredSegmentsListSource) {
        visibleSegments.clear();
      } else {
        visibleSegments.delete(Array.from(this.listSegments()));
      }
    }));
    const numericalPropertySummaries = this.registerDisposer(
        new NumericalPropertiesSummary(segmentPropertyMap, listSource.queryResult, setQuery));
    {
      const {listElement} = numericalPropertySummaries;
      if (listElement !== undefined) {
        queryStatisticsContainer.appendChild(listElement);
      }
    }
    const updateQueryErrors = (queryResult: QueryResult|undefined) => {
      const errors = queryResult?.errors;
      removeChildren(queryErrors);
      if (errors === undefined) return;
      for (const error of errors) {
        const errorElement = document.createElement('li');
        errorElement.textContent = error.message;
        queryErrors.appendChild(errorElement);
      }
    };

    let tagSummary: HTMLElement|undefined = undefined;
    observeWatchable((queryResult: QueryResult|undefined) => {
      listSource.segmentWidgetFactory = new SegmentWidgetWithExtraColumnsFactory(
          listSource.segmentationDisplayState, listSource.parentElement,
          property => queryIncludesColumn(queryResult?.query, property.id));
      list.scrollToTop();
      removeChildren(list.header);
      if (segmentPropertyMap !== undefined) {
        const header = listSource.segmentWidgetFactory.getHeader();
        header.container.classList.add('neuroglancer-segment-list-header');
        for (const headerLabel of header.propertyLabels) {
          const {label, sortIcon, id} = headerLabel;
          label.addEventListener('click', () => {
            toggleSortOrder(listSource.queryResult.value, setQuery, id);
          });
          updateColumnSortIcon(queryResult, sortIcon, id);
        }
        list.header.appendChild(header.container);
      }
      updateQueryErrors(queryResult);
      queryStatisticsSeparator.style.display = 'none';
      tagSummary?.remove();
      if (queryResult === undefined) return;
      let {query} = queryResult;
      if (query.errors !== undefined || query.ids !== undefined) return;
      tagSummary = renderTagSummary(queryResult, setQuery);
      if (tagSummary !== undefined) {
        queryStatisticsContainer.appendChild(tagSummary);
      }
      if (numericalPropertySummaries.properties.length > 0 || tagSummary !== undefined) {
        queryStatisticsSeparator.style.display = '';
      }
    }, listSource.queryResult);
  }

  toggleMatches() {
    const {listSource} = this;
    this.updateQuery();
    listSource.debouncedUpdate.flush();
    const queryResult = listSource.queryResult.value;
    if (queryResult === undefined) return;
    const {visibleMatches} = listSource;
    const shouldSelect = (visibleMatches !== queryResult.count);
    this.selectSegments(shouldSelect, true);
    return true;
  }
}

export class SegmentDisplayTab extends Tab {
  constructor(public layer: SegmentationUserLayer) {
    super();
    const {element} = this;
    element.classList.add('neuroglancer-segment-display-tab');
    element.appendChild(
        this.registerDisposer(new DependentViewWidget(
                                  layer.displayState.segmentationGroupState.value.graph,
                                  (graph, parent, context) => {
                                    if (graph === undefined) return;
                                    if (graph.tabContents) {
                                      return;
                                    }
                                    const toolbox = document.createElement('div');
                                    toolbox.className = 'neuroglancer-segmentation-toolbox';
                                    toolbox.appendChild(makeToolButton(context, layer.toolBinder, {
                                      toolJson: ANNOTATE_MERGE_SEGMENTS_TOOL_ID,
                                      label: 'Merge',
                                      title: 'Merge segments'
                                    }));
                                    toolbox.appendChild(makeToolButton(context, layer.toolBinder, {
                                      toolJson: ANNOTATE_SPLIT_SEGMENTS_TOOL_ID,
                                      label: 'Split',
                                      title: 'Split segments'
                                    }));
                                    parent.appendChild(toolbox);
                                  }))
            .element);


    // nge: the Select tool is in the Render tab, to give the list the room
    // (Ames 2026-10-14).

    const queryElement = document.createElement('input');
    queryElement.classList.add('neuroglancer-segment-list-query');
    queryElement.addEventListener('focus', () => {
      queryElement.select();
    });
    const keyboardHandler = this.registerDisposer(new KeyboardEventBinder(queryElement, keyMap));
    keyboardHandler.allShortcutsAreGlobal = true;
    const {segmentQuery} = this.layer.displayState;
    const debouncedUpdateQueryModel = this.registerCancellable(debounce(() => {
      segmentQuery.value = queryElement.value;
    }, 200));
    queryElement.autocomplete = 'off';
    queryElement.title = keyMap.describe();
    queryElement.spellcheck = false;
    queryElement.placeholder = 'Paste IDs, (x, y, z), or find a cell by name';
    this.registerDisposer(observeWatchable(q => {
      queryElement.value = q;
    }, segmentQuery));
    this.registerDisposer(observeWatchable(t => {
      if (Date.now() - t < 100) {
        setTimeout(() => {
          queryElement.focus();
        }, 0);
        this.layer.segmentQueryFocusTime.value = Number.NEGATIVE_INFINITY;
      }
    }, this.layer.segmentQueryFocusTime));

    element.appendChild(queryElement);
    element.appendChild(
        this
            .registerDisposer(new DependentViewWidget(
                // segmentLabelMap is guaranteed to change if segmentationGroupState changes.
                layer.displayState.segmentPropertyMap,
                (segmentPropertyMap, parent, context) => {
                  const listSource = context.registerDisposer(new SegmentQueryListSource(
                      segmentQuery, segmentPropertyMap, layer.displayState, parent));
                  const group = layer.displayState.segmentationGroupState.value;
                  const folders: SegmentFolders = (layer as any).ngeFolders;
                  const list = context.registerDisposer(
                      new VirtualList({source: listSource, horizontalScroll: true}));
                  const segList = context.registerDisposer(new SegmentListGroupQuery(
                      list, listSource, group, segmentPropertyMap, segmentQuery, queryElement,
                      debouncedUpdateQueryModel));
                  segList.element.appendChild(list.element);
                  parent.appendChild(segList.element);
                  list.element.classList.add('neuroglancer-segment-list');
                  list.element.classList.add('neuroglancer-preview-list');
                  context.registerDisposer(layer.bindSegmentListWidth(list.element));
                  context.registerDisposer(
                      new MouseEventBinder(list.element, getDefaultSelectBindings()));

                  // nge: the cells in view, in sections: Pasted, each folder,
                  // then the rest (In view). Each is its own list.
                  interface Section {
                    source: StarredSegmentsListSource;
                    vlist: VirtualList;
                    grp: SegmentListGroupSelected;
                  }
                  let renameNext: string|undefined;
                  const sectionActions: SectionActions = {
                    recolor: (ids, hex) => {
                      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
                      if (!m) return;
                      const v = parseInt(m[1], 16);
                      // neuroglancer packs a colour as 0xBBGGRR
                      const packed = ((v >> 16) & 0xff) | (v & 0xff00) | ((v & 0xff) << 16);
                      const colors = layer.displayState.segmentationColorGroupState.value.segmentStatedColors;
                      for (const s of ids) {
                        const id = new Uint64();
                        if (!id.tryParseString(s)) continue;
                        // set() never overwrites a colour already there: delete first
                        colors.delete(id);
                        colors.set(id, new Uint64(packed, 0));
                      }
                      // the rows' chips take the new colour too
                      updateListItems();
                    },
                    onNewFolder: id => {
                      // The sections are rebuilt as the folder is made: name it
                      // now if its section is there, else as soon as it is.
                      const sec = folderSections.find(
                          x => typeof x.source.mode === 'object' && x.source.mode.folder === id);
                      if (sec?.grp.startRename) sec.grp.startRename();
                      else renameNext = id;
                    },
                  };
                  const makeSection = (owner: RefCounted, mode: ListMode): Section => {
                    const source = owner.registerDisposer(new StarredSegmentsListSource(
                        layer.displayState, parent, mode, segmentQuery, folders));
                    // a segment's row is the same wherever it sits in the list
                    const vlist = owner.registerDisposer(new VirtualList(
                        {source, horizontalScroll: true, keepRowsOnSplice: true}));
                    const grp = owner.registerDisposer(new SegmentListGroupSelected(
                        source, group, folders, sectionActions));
                    grp.element.appendChild(vlist.element);
                    vlist.element.classList.add('neuroglancer-segment-list');
                    if (typeof mode === 'object') vlist.element.classList.add('nge-seg-list--folder');
                    if (mode === 'pasted') vlist.element.classList.add('nge-seg-list--pasted');
                    owner.registerDisposer(layer.bindSegmentListWidth(vlist.element));
                    owner.registerDisposer(new MouseEventBinder(vlist.element, getDefaultSelectBindings()));
                    source.segmentWidgetFactory = new SegmentWidgetWithExtraColumnsFactory(
                        source.segmentationDisplayState, source.parentElement,
                        property => queryIncludesColumn(undefined, property.id));
                    removeChildren(vlist.header);
                    owner.registerDisposer(grp.statusChanged.add(() => updateListDisplayState()));
                    return {source, vlist, grp};
                  };
                  const pasted = makeSection(context, 'pasted');
                  parent.appendChild(pasted.grp.element);
                  const foldersHost = document.createElement('div');
                  foldersHost.style.display = 'contents';
                  parent.appendChild(foldersHost);
                  const inview = makeSection(context, 'inview');
                  parent.appendChild(inview.grp.element);

                  let folderSections: Section[] = [];
                  let folderOwner: RefCounted|undefined;
                  let builtFor = '';
                  const buildFolders = () => {
                    const ordered = folders?.ordered() ?? [];
                    const key = ordered.map(x => x.folder.id + '<' + (x.folder.parent ?? '')).join(',');
                    if (key === builtFor) return;
                    builtFor = key;
                    folderOwner?.dispose();
                    removeChildren(foldersHost);
                    folderOwner = new RefCounted();
                    folderSections = ordered.map(({folder: f}) => {
                      const sec = makeSection(folderOwner!, {folder: f.id});
                      foldersHost.appendChild(sec.grp.element);
                      sec.grp.updateStatus();
                      return sec;
                    });
                    if (renameNext !== undefined) {
                      const target = folderSections.find(
                          x => typeof x.source.mode === 'object' && x.source.mode.folder === renameNext);
                      renameNext = undefined;
                      target?.grp.startRename?.();
                    }
                  };
                  if (folders !== undefined) {
                    context.registerDisposer(folders.changed.add(() => {
                      buildFolders();
                      updateListDisplayState();
                    }));
                  }
                  context.registerDisposer(() => folderOwner?.dispose());

                  const allSections = () => [pasted, ...folderSections, inview];

                  // nge: a cell that joins a folder whose colour was picked
                  // takes that colour, however it got there (Ames 2026-10-14).
                  if (folders !== undefined) {
                    const membersOf = () => new Map(folders.value.map(f => [f.id, new Set(f.ids)]));
                    let before = membersOf();
                    context.registerDisposer(folders.changed.add(() => {
                      const now = membersOf();
                      for (const f of folders.value) {
                        if (!f.paint || !f.color) continue;
                        const had = before.get(f.id);
                        const joined = f.ids.filter(id => !had?.has(id));
                        if (joined.length && had !== undefined) sectionActions.recolor(joined, f.color);
                      }
                      before = now;
                    }));
                  }

                  // nge: picked cells (Ctrl+click, Shift+click) are lit, and a
                  // bar above the list acts on all of them at once.
                  const pickStyle = document.createElement('style');
                  document.head.appendChild(pickStyle);
                  context.registerDisposer(() => pickStyle.remove());
                  const bar = document.createElement('div');
                  bar.className = 'nge-pick-bar';
                  parent.prepend(bar);
                  const barCount = document.createElement('span');
                  barCount.className = 'nge-pick-count';
                  const moveTo = document.createElement('select');
                  moveTo.className = 'nge-pick-move';
                  moveTo.title = 'Move the picked cells into a folder';
                  const barBtn = (text: string, title: string, onClick: () => void, cls = '') => {
                    const b = document.createElement('button');
                    b.className = 'nge-pick-btn' + (cls ? ' ' + cls : '');
                    b.textContent = text;
                    b.title = title;
                    b.addEventListener('click', onClick);
                    return b;
                  };
                  const pickedIds = () => {
                    const out: Uint64[] = [];
                    for (const s of pickedSegments.ids) {
                      const id = new Uint64();
                      if (id.tryParseString(s) && group.selectedSegments.has(id)) out.push(id);
                    }
                    return out;
                  };
                  const recolorPicked = document.createElement('button');
                  recolorPicked.className = 'nge-pick-btn nge-pick-recolor';
                  recolorPicked.textContent = 'Colour';
                  recolorPicked.title = 'Give the picked cells one colour';
                  recolorPicked.addEventListener('click', () => {
                    openColorPalette(recolorPicked, undefined, hex => {
                      sectionActions.recolor(pickedIds().map(id => id.toString()), hex);
                    }, 'Colour for the picked cells');
                  });
                  bar.append(
                      barCount, moveTo,
                      barBtn('Show', 'Show the picked cells', () => group.visibleSegments.set(pickedIds(), true)),
                      barBtn('Hide', 'Hide the picked cells', () => group.visibleSegments.set(pickedIds(), false)),
                      recolorPicked,
                      barBtn('Remove', 'Take the picked cells out of the view', () => {
                        const ids = pickedIds();
                        if (ids.length > 1 && !window.confirm(`Remove ${ids.length} cells from the view?`)) return;
                        group.selectedSegments.delete(ids);
                        pickedSegments.clear();
                      }, 'nge-pick-remove'),
                      barBtn('\u2715', 'Unpick (Esc)', () => pickedSegments.clear(), 'nge-pick-clear'));
                  moveTo.addEventListener('change', () => {
                    const v = moveTo.value;
                    moveTo.value = '';
                    if (!v || folders === undefined) return;
                    const ids = pickedIds().map(id => id.toString());
                    let target = v === '__none' ? '' : v;
                    if (v === '__new') {
                      const f = folders.create('New folder');
                      target = f.id;
                      window.setTimeout(() => sectionActions.onNewFolder(f.id), 0);
                    }
                    const p = getPastedSegments(group);
                    if (ids.some(id => p.ids.includes(id))) {
                      p.ids = p.ids.filter(id => !ids.includes(id));
                      p.changed.dispatch();
                    }
                    folders.move(ids, target);
                    pickedSegments.clear();
                  });
                  const paintPicks = () => {
                    const n = pickedSegments.ids.size;
                    bar.style.display = n ? '' : 'none';
                    barCount.textContent = `${n} picked`;
                    removeChildren(moveTo);
                    const opt = (value: string, text: string) => {
                      const o = document.createElement('option');
                      o.value = value;
                      o.textContent = text;
                      moveTo.appendChild(o);
                    };
                    opt('', 'Move to\u2026');
                    for (const {folder: f, depth} of folders?.ordered() ?? []) {
                      opt(f.id, '\u00a0\u00a0'.repeat(depth) + f.name);
                    }
                    opt('__new', '+ New folder');
                    opt('__none', 'Out of folders');
                    pickStyle.textContent = [...pickedSegments.ids]
                        .map(id => `.neuroglancer-segment-list-entry[data-id="${id}"]`)
                        .join(',\n') + (n ? ' { background: rgba(124, 255, 178, 0.14) !important; box-shadow: inset 3px 0 0 #7cffb2; }' : '');
                  };
                  context.registerDisposer(pickedSegments.changed.add(paintPicks));
                  if (folders !== undefined) context.registerDisposer(folders.changed.add(paintPicks));
                  paintPicks();
                  context.registerDisposer(getPastedSegments(group).changed.add(() => {
                    for (const sec of allSections()) {
                      sec.source.debouncedUpdate.flush();
                      sec.grp.updateStatus();
                    }
                  }));

                  function updateListDisplayState() {
                    // nge: words in the box narrow the lists below by name; the
                    // layer's own search shows only where the layer has names
                    // of its own to search.
                    const filtering = listFilterOf(segmentQuery.value) !== '';
                    const showQueryResultsList = segmentPropertyMap !== undefined &&
                        (listSource.query.value !== '' || listSource.numMatches > 0);
                    const showPastedList = pasted.source.length > 0;
                    let shownInFolders = 0;
                    const order = folders?.ordered() ?? [];
                    for (const sec of folderSections) {
                      // An empty folder still shows, so cells can be dragged in,
                      // unless the box is narrowing the list; a folder inside a
                      // folded one does not.
                      const placed = order.find(
                          x => typeof sec.source.mode === 'object' && x.folder.id === sec.source.mode.folder);
                      const show = !placed?.hidden && (sec.source.length > 0 || !filtering);
                      sec.grp.element.style.display = show ? 'contents' : 'none';
                      const f = folders?.value.find(
                          x => typeof sec.source.mode === 'object' && x.id === sec.source.mode.folder);
                      sec.vlist.element.style.display = f?.collapsed ? 'none' : '';
                      sec.vlist.element.dataset.ngeEmpty = String(sec.source.length === 0 && !filtering);
                      shownInFolders += sec.source.length;
                    }
                    const showStarredSegmentsList = inview.source.length > 0 || !filtering ||
                        (!showQueryResultsList && !showPastedList && !shownInFolders);
                    inview.vlist.element.dataset.ngeNoMatch = String(
                        filtering && inview.source.length === 0 && !showPastedList && !shownInFolders);
                    segList.element.style.display = showQueryResultsList ? 'contents' : 'none';
                    pasted.grp.element.style.display = showPastedList ? 'contents' : 'none';
                    inview.grp.element.style.display = showStarredSegmentsList ? 'contents' : 'none';
                  }
                  context.registerDisposer(segList.statusChanged.add(updateListDisplayState));
                  buildFolders();
                  segList.updateStatus();
                  for (const sec of allSections()) sec.grp.updateStatus();

                  const updateListItems = context.registerCancellable(animationFrameDebounce(() => {
                    listSource.updateRenderedItems(list);
                    for (const sec of allSections()) sec.source.updateRenderedItems(sec.vlist);
                  }));
                  const {displayState} = this.layer;
                  registerCallbackWhenSegmentationDisplayStateChanged(
                      displayState, context, updateListItems);
                  context.registerDisposer(
                      displayState.segmentationGroupState.value.selectedSegments.changed.add(
                          updateListItems));
                  inview.vlist.scrollToTop();
                }))
            .element);
  }
}
