import {LayerTool, makeToolActivationStatusMessageWithHeader, registerTool, ToolActivation} from "neuroglancer/ui/tool";
import {makeIcon} from "neuroglancer/widget/icon";
import {EventActionMap} from "neuroglancer/util/mouse_bindings";
import {TextInputWidget} from "neuroglancer/widget/text_input";
import {TrackableValue} from "neuroglancer/trackable_value";
import {
    Annotation,
    makeAnnotationId,
    AnnotationType,
} from "neuroglancer/annotation";
import {AnnotationLayerState} from 'neuroglancer/annotation/annotation_layer_state';
import {getDefaultAnnotationListBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {MouseEventBinder} from 'neuroglancer/util/mouse_bindings';
import {removeChildren} from "neuroglancer/util/dom";
import {RefCounted} from "neuroglancer/util/disposable";
import {Trackable} from "neuroglancer/util/trackable";
import {verifyOptionalObjectProperty} from "neuroglancer/util/json";
import {NullarySignal} from "neuroglancer/util/signal";
import {StatusMessage} from "neuroglancer/status";
import {AnnotationUserLayer} from "neuroglancer/annotation/user_layer";
import {formatScaleWithUnit} from "neuroglancer/util/si_units";

const ADD_CUBE_TOOL_ID = "annotateCustomCube";
const ADD_CUBE_EVENT_MAP = EventActionMap.fromObject({
    'at:shift?+enter': {action: 'submit'},
    'at:shift?+control+mousedown0': {action: 'add-point'},
});
const CUBESIZE_JSON_KEY = "cubeSize";
const MOUSEPOSITION_JSON_KEY = "mousePosition";

function verifyFloat32Array(obj: string): Float32Array {
    const parts = obj.split(',').map(part => parseFloat(part.trim()));
    if (parts.length >= 1 && parts.every(part => !isNaN(part))) {
        return new Float32Array(parts);
    } else {
        StatusMessage.showMessage('Invalid input format. Expected format: number,number,number');
        throw new Error(`It is not a type of Float32Array.`)
    }
}

const calculateBoundingBox = (mousePoint: Float32Array, cubeSize: Float32Array, scales: Float32Array) => {
    // Calculate half sizes
    const halfx = 1000 / scales[0] * cubeSize[0] / 2;
    const halfy = 1000 / scales[1] * cubeSize[1] / 2;
    const halfz = 1000 / scales[2] * cubeSize[2] / 2;

    // Calculate lower bounds
    const lowerBounds = Float32Array.of
    (
        mousePoint[0] - halfx, mousePoint[1] - halfy,
        mousePoint[2] - halfz);

    // Calculate upper bounds
    const upperBounds = Float32Array.of
    (
        mousePoint[0] + halfx, mousePoint[1] + halfy,
        mousePoint[2] + halfz);

    return {lowerBounds: Float32Array.from(lowerBounds), upperBounds: Float32Array.from(upperBounds)};
}

const getLayerScales = (layer: AnnotationUserLayer) => {
    let scales = new Float32Array(layer.manager.root.coordinateSpace.value.scales.length);

    for (let i=0; i < layer.manager.root.coordinateSpace.value.scales.length; i++) {
        const {scale} = formatScaleWithUnit(layer.manager.root.coordinateSpace.value.scales[i], layer.manager.root.coordinateSpace.value.units[i])
        scales[i] = parseFloat(scale);
    }
    return scales
}

class AddCubeAnnotationState extends RefCounted implements Trackable {
    changed = new NullarySignal();
    cubeSize = new TrackableValue<Float32Array>(Float32Array.of(5, 5, 5), verifyFloat32Array);
    mousePosition = new TrackableValue<Float32Array>(Float32Array.of(0, 0, 0), verifyFloat32Array);

    constructor() {
        super();
        this.registerDisposer(this.cubeSize.changed.add(() => {
            this.changed.dispatch();
        }));
        this.registerDisposer(this.mousePosition.changed.add(() => {
            this.changed.dispatch();
        }));
    }

    reset() {
        this.cubeSize.reset();
        this.mousePosition.reset();
    }

    toJSON() {
        const {cubeSize, mousePosition} = this;
        return {
            [CUBESIZE_JSON_KEY]: cubeSize.toJSON(),
            [MOUSEPOSITION_JSON_KEY]: mousePosition.toJSON(),
        }
    }

    restoreState(x: any) {
        verifyOptionalObjectProperty(
            x, CUBESIZE_JSON_KEY, value => {
                this.cubeSize.restoreState(verifyFloat32Array(value));
            }
        );
        verifyOptionalObjectProperty(
            x, MOUSEPOSITION_JSON_KEY, value => {
                this.mousePosition.restoreState(value);
            }
        )
    }
}

class AddCubeAnnotationTool extends LayerTool<AnnotationUserLayer> {
    cubeAnnotationState: AnnotationLayerState;
    annotation: Annotation;
    addCubeAnnotationState = new AddCubeAnnotationState();

    toJSON(): any {
        return ADD_CUBE_TOOL_ID;
    }

    activate(activation: ToolActivation<this>) {
        const {layer} = this;
        const {cubeSize, mousePosition} = this.addCubeAnnotationState;
        const {body, header} = makeToolActivationStatusMessageWithHeader(activation);
        header.textContent = 'Add cube';
        body.classList.add('tool-status', 'add-cube');

        const scales = getLayerScales(layer);

        const submitAction = () => {
            if (cubeSize.value instanceof Float32Array && mousePosition.value instanceof Float32Array) {
                updateAnnotationElements();
            }
        }

        const cubeSizeWidget = activation.registerDisposer(new TextInputWidget(cubeSize))
        const label = document.createElement("cube-size");
        label.appendChild(document.createTextNode('set size (micron)'));
        label.appendChild(cubeSizeWidget.element)
        body.appendChild(label)

        // mouse position
        const mousePositionWidget = activation.registerDisposer(new TextInputWidget(mousePosition))
        const position = document.createElement("position");
        position.appendChild(document.createTextNode('mouse position'));
        position.appendChild(mousePositionWidget.element)
        body.appendChild(position)
        mousePositionWidget.element.disabled = true;

        body.appendChild(makeIcon({
            text: 'Create',
            title: 'Create Cube Annotation',
            onClick: () => {
                submitAction();
            }
        }));

        const annotationElements = document.createElement('div');
        annotationElements.classList.add('cube-annotations');
        body.appendChild(annotationElements);

        const bindings = getDefaultAnnotationListBindings();
        this.registerDisposer(new MouseEventBinder(annotationElements, bindings));

        const updateAnnotationElements = () => {
            removeChildren(annotationElements);

            // annotation
            const box = calculateBoundingBox(mousePosition.value, cubeSize.value, scales)
            // Create annotation
            const annotationId = makeAnnotationId()
            const annotation: Annotation = {
                id: annotationId,
                pointA: new Float32Array(box.lowerBounds),
                pointB: new Float32Array(box.upperBounds),
                type: AnnotationType.AXIS_ALIGNED_BOUNDING_BOX,
                properties: []
            };
            layer.localAnnotations?.add(annotation);

        };

        activation.bindInputEventMap(ADD_CUBE_EVENT_MAP);

        activation.bindAction('submit', event => {
            event.stopPropagation();
            submitAction();
        });

        const setMousePosition = (position: Float32Array) => {
            let flooredPosition = new Float32Array(position.length);
            for (let i = 0; i < position.length; i++) {
                flooredPosition[i] = Math.floor(position[i])
            }
            mousePosition.value = flooredPosition;
            mousePosition.changed.dispatch();
        };

        activation.bindAction('add-point', event => {
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
    registerTool(AnnotationUserLayer, ADD_CUBE_TOOL_ID, layer => {
        return new AddCubeAnnotationTool(layer, true)
    })
}

