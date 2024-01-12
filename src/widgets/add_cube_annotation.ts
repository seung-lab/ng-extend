import {LayerTool, makeToolActivationStatusMessageWithHeader, registerTool, ToolActivation} from "neuroglancer/ui/tool";
import {SegmentationUserLayer} from "neuroglancer/segmentation_user_layer";
import {makeIcon} from "neuroglancer/widget/icon";
import {EventActionMap} from "neuroglancer/util/mouse_bindings";
import {TextInputWidget} from "neuroglancer/widget/text_input";
import {TrackableValue, TrackableValueInterface, WatchableValue} from "neuroglancer/trackable_value";
import {makeAnnotationListElement} from 'neuroglancer/ui/annotations';
import {
    Annotation,
    LocalAnnotationSource, makeAnnotationId, AnnotationReference, AnnotationType
} from "neuroglancer/annotation";
import {AnnotationDisplayState, AnnotationLayerState} from 'neuroglancer/annotation/annotation_layer_state';
import {getDefaultAnnotationListBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {MouseEventBinder} from 'neuroglancer/util/mouse_bindings';
import {removeChildren} from "neuroglancer/util/dom";
import {BoundingBox} from "neuroglancer/coordinate_transform";
import {RenderLayerRole} from "neuroglancer/renderlayer";
import {LoadedDataSubsource} from "neuroglancer/layer_data_source";
import {vec3} from "neuroglancer/util/geom";
import {TrackableBoolean} from "neuroglancer/trackable_boolean";
import {SegmentSelection} from "neuroglancer/datasource/graphene/frontend";

const ADD_CUBE_TOOL_ID = "annotateCustomCube";

const ADD_CUBE_EVENT_MAP = EventActionMap.fromObject({
    'at:shift?+enter': {action: 'submit'},
    'at:shift?+control+mousedown0': {action: 'add-point'},
});

// function verifyCubeSizeValue(value: string): string {
//     if (value.split(/,\s*/).length !== 3) {
//         throw new Error(`Expected sizes of x,y,z, but missing one or few dimensions: ${JSON.stringify(value)}.`);
//     }
//     return value
// }

function verifyFloat32Array(obj: any): Float32Array {
    if (!(obj instanceof Float32Array)) {
        throw new Error(`It is not a type of Float32Array.`)
    }
    return obj
}

class AddCubeAnnotationTool extends LayerTool<SegmentationUserLayer> {
    cubeSize: TrackableValueInterface<Float32Array>;
    cubeAnnotationState: AnnotationLayerState;
    mousePosition: TrackableValueInterface<Float32Array>;
    mouseCursor = new TrackableValue<SegmentSelection | undefined>(undefined, x => x);
    annotation: Annotation;


    toJSON(): any {
        return ADD_CUBE_TOOL_ID;
    }

    activate(activation: ToolActivation<this>) {
        const {layer} = this;

        // Ensure we use the same segmentationGroupState while activated.
        const {body, header} = makeToolActivationStatusMessageWithHeader(activation);
        header.textContent = 'Add cube';
        body.classList.add('tool-status', 'add-cube');

        const submitAction = () => {
            // findPathState.triggerPathUpdate.dispatch();
            updateAnnotationElements();
        }

        this.cubeSize = new TrackableValue(Float32Array.of(5, 5, 5), verifyFloat32Array);
        const inputSize = activation.registerDisposer(new TextInputWidget(this.cubeSize))
        const label = document.createElement("depth");
        label.appendChild(document.createTextNode('set size'));
        label.appendChild(inputSize.element)
        body.appendChild(label)

        this.mousePosition = new TrackableValue(Float32Array.of(0,0,0), verifyFloat32Array)
        const positionField = activation.registerDisposer(new TextInputWidget(this.mousePosition))
        const position = document.createElement("position");
        position.appendChild(document.createTextNode('mouse position'));
        position.appendChild(positionField.element)
        body.appendChild(position)

        body.appendChild(makeIcon({
            text: 'Create',
            title: 'Create Cube Annotation',
            onClick: () => {
                submitAction();
            }
        }));

        // body.appendChild(makeIcon({
        //   text: 'Clear',
        //   title: 'Clear Find Path',
        //   onClick: () => {
        //       findPathState.source.reset();
        //       findPathState.target.reset();
        //       findPathState.centroids.reset();
        //   }
        // }));

        const annotationElements = document.createElement('div');
        annotationElements.classList.add('find-path-annotations');
        body.appendChild(annotationElements);

        const bindings = getDefaultAnnotationListBindings();
        console.log(bindings)
        this.registerDisposer(new MouseEventBinder(annotationElements, bindings));

        function makeColoredAnnotationState(
            layer: SegmentationUserLayer, loadedSubsource: LoadedDataSubsource,
            subsubsourceId: string, color: vec3, readonly = false) {
            const {subsourceEntry} = loadedSubsource;
            const source = new LocalAnnotationSource(loadedSubsource.loadedDataSource.transform, [], ['associated segments']);
            source.readonly = readonly;

            const displayState = new AnnotationDisplayState();
            displayState.color.value.set(color);

            displayState.relationshipStates.set('associated segments', {
                segmentationState: new WatchableValue(layer.displayState),
                showMatches: new TrackableBoolean(false),
            });

            const state = new AnnotationLayerState({
                localPosition: layer.localPosition,
                transform: loadedSubsource.getRenderLayerTransform(),
                source,
                displayState,
                dataSource: loadedSubsource.loadedDataSource.layerDataSource,
                subsourceIndex: loadedSubsource.subsourceIndex,
                subsourceId: subsourceEntry.id,
                subsubsourceId,
                role: RenderLayerRole.ANNOTATION,
            });
            layer.addAnnotationLayerState(state, loadedSubsource);
            return state;
        }

        function getGraphLoadedSubsource(layer: SegmentationUserLayer) {
            for (const dataSource of layer.dataSources) {
                const {loadState} = dataSource;
                if (loadState === undefined || loadState.error !== undefined) continue;
                for (const subsource of loadState.subsources) {
                    if (subsource.enabled) {
                        if (subsource.subsourceEntry.id === 'graph') {
                            return subsource;
                        }
                    }
                }
            }
            return undefined;
        }

        const calculateBoundingBox = (centroid: Float32Array, size: Float32Array) => {
            console.log(centroid, size)
            // Calculate half sizes
            const halfx = size[0] / 2;
            const halfy = size[1] / 2;
            const halfz = size[2] / 2;

            // Calculate lower bounds
            const lowerBounds = Float32Array.of
            (
                centroid[0] - halfx, centroid[1] - halfy,
                centroid[2] - halfz);

            // Calculate upper bounds
            const upperBounds = Float32Array.of
            (
                centroid[0] + halfx, centroid[1] + halfy,
                centroid[2] + halfz);

            return {lowerBounds: Float64Array.from(lowerBounds), upperBounds: Float64Array.from(upperBounds)};
        }

        const updateAnnotationElements = () => {
            removeChildren(annotationElements);
            const maxColumnWidths = [0, 0, 0];
            const globalDimensionIndices = [0, 1, 2];
            const localDimensionIndices: number[] = [];
            const template = '[symbol] 2ch [dim] var(--neuroglancer-column-0-width) [dim] var(--neuroglancer-column-1-width) [dim] var(--neuroglancer-column-2-width) [delete] min-content';

            const loadedSubsource = getGraphLoadedSubsource(layer)!;

            const YELLOW_COLOR = vec3.fromValues(1, 1, 0);
            const findPathGroup = makeColoredAnnotationState(layer, loadedSubsource, "addcustomcube", YELLOW_COLOR, false);
            this.cubeAnnotationState = findPathGroup;

            // annotation
            const box: BoundingBox = calculateBoundingBox(this.mousePosition.value, this.cubeSize.value)

            // Create annotation
            const annotationId = makeAnnotationId()
            const annotationReference = new AnnotationReference(annotationId)
            // console.log(annotationSource)
            const annotation: Annotation = {
                id: annotationId,
                // description: 'addcustomcube',
                pointA: new Float32Array(box.lowerBounds),
                pointB: new Float32Array(box.upperBounds),
                type: AnnotationType.AXIS_ALIGNED_BOUNDING_BOX,
                properties: []//layer.source.properties.map(x => x.default),
            };

            annotationReference.value = annotation;
            this.cubeAnnotationState.source.add(annotation)

            const [element, elementColumnWidths] = makeAnnotationListElement(this.layer, annotation, this.cubeAnnotationState, template, globalDimensionIndices, localDimensionIndices);
            for (const [column, width] of elementColumnWidths.entries()) {
                maxColumnWidths[column] = width;
            }
            console.log(element, elementColumnWidths)
            annotationElements.appendChild(element);

            for (const [column, width] of maxColumnWidths.entries()) {
                annotationElements.style.setProperty(`--neuroglancer-column-${column}-width`, `${width + 2}ch`);
            }
        };

        // findPathState.changed.add(updateAnnotationElements);
        // updateAnnotationElements();

        activation.bindInputEventMap(ADD_CUBE_EVENT_MAP);

        activation.bindAction('submit', event => {
            event.stopPropagation();
            submitAction();
        });

        const setMousePosition = (position: Float32Array) => {
            console.log(position.toString())
            this.mousePosition.value = position;
        }

        activation.bindAction('add-point', event => {
            console.log('add-point');
            event.stopPropagation();
            (async () => {
                const {mouseState} = this;
                setMousePosition(mouseState.position)
            })()
        });
    }

    get description() {
        return `add cube`;
    }
}

export function registerAnnotateCubeTool() {
    registerTool(SegmentationUserLayer, ADD_CUBE_TOOL_ID, layer => {
        return new AddCubeAnnotationTool(layer, true)
    })
}

