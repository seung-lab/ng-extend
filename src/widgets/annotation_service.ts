export interface Point3D {
    x: string;
    y: string;
    z: string;
}

function calculateDistance(type: string, coordinates: Point3D[], scales: Float32Array): string {
    const point1: Point3D = coordinates[0];
    const point2: Point3D = coordinates[1];

    const diffX = Math.abs(Number(point2.x) - Number(point1.x));
    const diffY = Math.abs(Number(point2.y) - Number(point1.y));
    const diffZ = Math.abs(Number(point2.z) - Number(point1.z));

    const dx = scales[0] * diffX;
    const dy = scales[1] * diffY;
    const dz = scales[2] * diffZ;

    // Calculate the distance
    if (type == "line") {
        if (dz == 0) {
            const distanceXY = Math.sqrt(dx * dx + dy * dy).toFixed(2);
            return `Distance: ${distanceXY}nm`;
        } else if (dy == 0) {
            const distanceZX: string = Math.sqrt(dz * dz + dx * dx).toFixed(2);
            return `Distance: ${distanceZX}nm`;
        } else if (dx == 0) {
            const distanceYZ: string = Math.sqrt(dy * dy + dz * dz).toFixed(2);
            return `Distance: ${distanceYZ}nm`;
        } else {
            return ''
        }
    } else if (type == "box") {
        const minDiff = Math.min(diffX, diffY, diffZ);
        if (minDiff == diffZ) {
            return `x: ${dx}nm, y: ${dy}nm`;
        } else if (minDiff == diffX) {
            return `y: ${dy}nm, z: ${dz}nm`;
        } else if (minDiff == diffY) {
            return `x: ${dx}nm, z: ${dz}nm`;
        } else {
            return ''
        }
    } else {
        return ''
    }
}
export class AnnotationService {
    calculateDistance(type: string, coordinates: Point3D[], scales: Float32Array) {
        const distance = document.createElement('div');
        distance.className = 'nge-selected-annotation distance';
        distance.style.gridColumn = 'dim / -1';
        distance.style.textOverflow = 'ellipsis';
        if (coordinates.length == 2) {
            distance.innerText = calculateDistance(type, coordinates, scales)
        }
        return distance;
    }


}