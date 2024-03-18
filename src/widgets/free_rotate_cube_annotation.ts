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
import {getDefaultAnnotationListBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {MouseEventBinder} from 'neuroglancer/util/mouse_bindings';
import {removeChildren} from "neuroglancer/util/dom";
import {RefCounted} from "neuroglancer/util/disposable";
import {Trackable} from "neuroglancer/util/trackable";
import {verifyOptionalObjectProperty} from "neuroglancer/util/json";
import {NullarySignal} from "neuroglancer/util/signal";
import {StatusMessage} from "neuroglancer/status";
import {AnnotationUserLayer} from "neuroglancer/annotation/user_layer";
import {getLayerScales} from "./widget_utils";

const FREE_ROTATE_CUBE_ANNOTATION_TOOL_ID = "freeRotateCubeAnnotationTool";
const FREE_ROTATE_CUBE_ANNOTATION_TOOL_EVENT_MAP = EventActionMap.fromObject({
    'at:shift?+enter': {action: 'submit'},
    'at:shift?+control+mousedown0': {action: 'add-point'},
});
const CUBESIZE_JSON_KEY = "cubeSize";
const ROTATIONANGLE_JSON_KEY = "rotationAngle";
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

function verifyNumber(obj: string): Number {
    if (!isNaN(parseInt(obj))) {
        return new Number(obj);
    } else {
        StatusMessage.showMessage('Invalid input format. Expected format: number');
        throw new Error(`It is not a type of Number.`)
    }
}

// const calculateBoundingBox = (mousePoint: Float32Array, cubeSize: Float32Array, scales: Float32Array) => {
//     // Calculate half sizes
//     const halfx = 1000 / scales[0] * cubeSize[0] / 2;
//     const halfy = 1000 / scales[1] * cubeSize[1] / 2;
//     const halfz = 1000 / scales[2] * cubeSize[2] / 2;
//
//     // Calculate lower bounds
//     const lowerBounds = Float32Array.of
//     (
//         mousePoint[0] - halfx, mousePoint[1] - halfy,
//         mousePoint[2] - halfz);
//
//     // Calculate upper bounds
//     const upperBounds = Float32Array.of
//     (
//         mousePoint[0] + halfx, mousePoint[1] + halfy,
//         mousePoint[2] + halfz);
//
//     return {lowerBounds: Float32Array.from(lowerBounds), upperBounds: Float32Array.from(upperBounds)};
// }

function rotateVertex(vertex: number[], angleRad: number) {
    const [x, y, z] = vertex;
    // Apply rotation around the Z axis
    let xz = Math.cos(angleRad) * x - Math.sin(angleRad) * y;
    let yz = Math.sin(angleRad) * x + Math.cos(angleRad) * y;
    // // Apply rotation around the Y axis
    // let xy = Math.cos(angleRad) * xz + Math.sin(angleRad) * z;
    // let zy = -Math.sin(angleRad) * xz + Math.cos(angleRad) * z;
    // // Apply rotation around the X axis
    // let yx = Math.cos(angleRad) * yz - Math.sin(angleRad) * zy;
    // let zx = Math.sin(angleRad) * yz + Math.cos(angleRad) * zy;

    return [xz, yz, z];
}

function rotatedCubeEdges(centroid: Float32Array, size: Float32Array, angleDeg: Number, scales: Float32Array) {
    const angleRad = Number(angleDeg) * Math.PI / 180;
    const halfX = 1000 / scales[0] * size[0] / 2;
    const halfY = 1000 / scales[1] * size[1] / 2;
    const halfZ = 1000 / scales[2] * size[2] / 2;
    const vertices = [
        [halfX, halfY, halfZ],
        [-halfX, halfY, halfZ],
        [-halfX, -halfY, halfZ],
        [halfX, -halfY, halfZ],
        [halfX, halfY, -halfZ],
        [-halfX, halfY, -halfZ],
        [-halfX, -halfY, -halfZ],
        [halfX, -halfY, -halfZ]
    ].map(vertex => {
        let rotatedVertex = rotateVertex(vertex, angleRad);
        return rotatedVertex.map((v, i) => v + centroid[i]);
    });

    // Define cube edges by vertex indices
    const edgesIndices = [
        [0, 1], [1, 2], [2, 3], [3, 0], // Bottom face
        [4, 5], [5, 6], [6, 7], [7, 4], // Top face
        [0, 4], [1, 5], [2, 6], [3, 7]  // Side faces
    ];

    // Generate pairs of points for each edge
    const edges = edgesIndices.map(([start, end]) => [vertices[start], vertices[end]]);

    return edges;
}





class FreeRotateCubeAnnotationState extends RefCounted implements Trackable {
    changed = new NullarySignal();
    cubeSize = new TrackableValue<Float32Array>(Float32Array.of(1, 1, 1), verifyFloat32Array);
    mousePosition = new TrackableValue<Float32Array>(Float32Array.of(0, 0, 0), verifyFloat32Array);
    rotationAngle = new TrackableValue(30, verifyNumber);
    constructor() {
        super();
        this.registerDisposer(this.cubeSize.changed.add(() => {
            this.changed.dispatch();
        }));
        this.registerDisposer(this.mousePosition.changed.add(() => {
            this.changed.dispatch();
        }));
        this.registerDisposer(this.rotationAngle.changed.add(() => {
            this.changed.dispatch();
        }));
    }

    reset() {
        this.cubeSize.reset();
        this.mousePosition.reset();
        this.rotationAngle.reset();
    }

    toJSON() {
        const {cubeSize, mousePosition, rotationAngle} = this;
        return {
            [CUBESIZE_JSON_KEY]: cubeSize.toJSON(),
            [MOUSEPOSITION_JSON_KEY]: mousePosition.toJSON(),
            [ROTATIONANGLE_JSON_KEY]: rotationAngle.toJSON(),
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
        );
        verifyOptionalObjectProperty(
            x, ROTATIONANGLE_JSON_KEY, value => {
                this.rotationAngle.restoreState(verifyNumber(value))
            }
        )
    }
}

class FreeRotateCubeAnnotationTool extends LayerTool<AnnotationUserLayer> {
    annotation: Annotation;
    freeRotateCubeAnnotationState = new FreeRotateCubeAnnotationState();

    toJSON(): any {
        return FREE_ROTATE_CUBE_ANNOTATION_TOOL_ID;
    }

    activate(activation: ToolActivation<this>) {
        const {layer} = this;
        const {cubeSize, mousePosition, rotationAngle} = this.freeRotateCubeAnnotationState;
        const {body, header} = makeToolActivationStatusMessageWithHeader(activation);
        header.textContent = 'Add cube';
        body.classList.add('tool-status', 'add-cube');

        const scales = getLayerScales(layer.manager.root.coordinateSpace);

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

        const rotationAngleWidget = activation.registerDisposer(new TextInputWidget(rotationAngle))
        const angle = document.createElement("rotation-angle");
        angle.appendChild(document.createTextNode('rotation angle around the z axis(degree)'));
        angle.appendChild(rotationAngleWidget.element)
        body.appendChild(angle)


        // mouse position
        const mousePositionWidget = activation.registerDisposer(new TextInputWidget(mousePosition))
        const position = document.createElement("position");
        position.appendChild(document.createTextNode('mouse position'));
        position.appendChild(mousePositionWidget.element)
        body.appendChild(position)
        mousePositionWidget.element.disabled = true;

        body.appendChild(makeIcon({
            text: 'Create',
            title: 'Create Free Rotate Cube Annotation',
            onClick: () => {
                submitAction();
            }
        }));

        const annotationElements = document.createElement('div');
        annotationElements.classList.add('free-rotate-cube-annotations');
        body.appendChild(annotationElements);

        const bindings = getDefaultAnnotationListBindings();
        this.registerDisposer(new MouseEventBinder(annotationElements, bindings));

        const updateAnnotationElements = () => {
            removeChildren(annotationElements);
            const edges = rotatedCubeEdges(mousePosition.value, cubeSize.value, rotationAngle.value, scales);
            for (const edge of edges) {

                const line: Annotation = {
                    id: makeAnnotationId(),
                    type: AnnotationType.LINE,
                    pointA: Float32Array.of(edge[0][0], edge[0][1], edge[0][2]),
                    pointB: Float32Array.of(edge[1][0], edge[1][1], edge[1][2]),
                    properties: []
                }
                layer.localAnnotations?.add(line);
            }
        };

        activation.bindInputEventMap(FREE_ROTATE_CUBE_ANNOTATION_TOOL_EVENT_MAP);

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

export function registerFreeRotateCubeAnnotationTool() {
    registerTool(AnnotationUserLayer, FREE_ROTATE_CUBE_ANNOTATION_TOOL_ID, layer => {
        return new FreeRotateCubeAnnotationTool(layer, true)
    })
}

