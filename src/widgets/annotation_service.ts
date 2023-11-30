export interface Point3D {
    x: string;
    y: string;
    z: string;
}

function calculateDistanceInXYPlane(coordinates: Point3D[]): string {
    const point1: Point3D = coordinates[0];
    const point2: Point3D = coordinates[1];
    // Ignore the Z coordinate for XY plane distance
    const dx = Number(point2.x) - Number(point1.x);
    const dy = Number(point2.y) - Number(point1.y);

    // Calculate the distance using the Pythagorean theorem
    const distance = Math.sqrt(dx * dx + dy * dy).toFixed(2);

    return distance.toString();
}
export class AnnotationService {
    calculateDistance(coordinates: Point3D[]) {
        const distance = document.createElement('span');
        distance.className = 'nge-selected-annotation distance';
        console.log(coordinates)
        if (coordinates.length == 2) {
            distance.innerText = `Distance: ${calculateDistanceInXYPlane(coordinates)}`
        }
        return distance
    }


}