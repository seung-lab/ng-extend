export default interface Config {
  linkShortenerURL: string,
  leaderboardURL: string,
  chatURL: string,
  proctorURL: string,
  imageLayers: ImageLayerDescription[],
  segmentationLayers: SegmentationLayerDescription[],
  brainMeshURL: string
}

export interface Vector3 {
  x: number, y: number, z: number,
}

export interface LayerDescription {
  name: string,
  description: string,
  source: string,
  layerName?: string,
  color?: string,
  defaultPerspectiveZoomFactor?: number,
  defaultPosition?: Vector3
}

export interface CellDescription {
  id: string, default?: boolean,
}

export interface ImageLayerDescription extends LayerDescription {
  type: 'image'
}

export interface SegmentationLayerDescription extends LayerDescription {
  type: 'segmentation' | 'segmentation_with_graph',
  curatedCells?: CellDescription[]
}
