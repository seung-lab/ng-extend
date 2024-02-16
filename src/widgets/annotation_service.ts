export interface Point3D {
    x: string;
    y: string;
    z: string;
}

function calculateDistance(coordinates: Point3D[], scales: Float32Array): string {
    const point1: Point3D = coordinates[0];
    const point2: Point3D = coordinates[1];
    // Ignore the Z coordinate for XY plane distance
    const dx = scales[0] * (Number(point2.x) - Number(point1.x));
    const dy = scales[1] *(Number(point2.y) - Number(point1.y));
    const dz = scales[2] *(Number(point2.z) - Number(point1.z));

    // Calculate the distance using the Pythagorean theorem
    const distanceXY = Math.sqrt(dx * dx + dy * dy).toFixed(2);
    const distanceYZ: string = Math.sqrt(dy * dy + dz * dz).toFixed(2);
    const distanceZX: string = Math.sqrt(dz * dz + dx * dx).toFixed(2);

    return `Distance\nXY: ${distanceXY}nm, YZ: ${distanceYZ}nm, ZX: ${distanceZX}nm`;
}
export class AnnotationService {
    calculateDistance(coordinates: Point3D[], scales: Float32Array) {
        const distance = document.createElement('div');
        distance.className = 'nge-selected-annotation distance';
        distance.style.gridColumn = 'dim / -1';
        distance.style.textOverflow = 'ellipsis';
        console.log(coordinates)
        if (coordinates.length == 2) {
            distance.innerText = calculateDistance(coordinates, scales)
        }
        return distance;
    }


}