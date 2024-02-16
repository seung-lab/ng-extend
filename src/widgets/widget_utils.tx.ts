import {formatScaleWithUnit} from "neuroglancer/util/si_units";

export const getLayerScales = (coordinateSpace: any) => {
    let scales = new Float32Array(coordinateSpace.value?.scales.length);

    for (let i=0; i < coordinateSpace.value?.scales.length; i++) {
        const {scale} = formatScaleWithUnit(coordinateSpace.value?.scales[i], coordinateSpace.value?.units[i])
        scales[i] = parseFloat(scale);
    }
    return scales
}