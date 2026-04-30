// Patch SegmentationUserLayer.moveToSegment to also work for MeshLayer-based
// segmentations (graphene). Upstream only walks MultiscaleMeshLayer, so right-click
// "jump to segment" silently fails on every graphene dataset (EyeWire II, MICrONS).
//
// We add getObjectPosition to MeshLayer (computes a centroid from any loaded
// fragment's vertex positions) and replace moveToSegment to accept both layer
// types. The patch is also called by our custom jump-to-segment button, so this
// single fix repairs both code paths.

import {MeshLayer, MultiscaleMeshLayer} from 'neuroglancer/mesh/frontend';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {getObjectKey} from 'neuroglancer/segmentation_display_state/base';
import {RenderLayerTransform} from 'neuroglancer/render_coordinate_transform';
import {Uint64} from 'neuroglancer/util/uint64';
import * as matrix from 'neuroglancer/util/matrix';
import {VirtualList} from 'neuroglancer/widget/virtual_list';

// Expose the VirtualList instance on its DOM element so external code (our
// alt+click jump-to-list handler) can call scrollItemIntoView. NG's virtual
// list uses an anchor-index scheme, not pixel offsets, so setting scrollTop
// from outside doesn't reliably scroll to a target item — only the instance's
// own API does. We tag on first updateView() call (called every paint cycle).
{
  const proto = VirtualList.prototype as any;
  const origUpdateView = proto.updateView;
  if (typeof origUpdateView === 'function') {
    proto.updateView = function(this: any) {
      if (this.element && !this.element.__nge_virtualList) {
        this.element.__nge_virtualList = this;
        console.log('[nge-patch] tagged VirtualList element', this.element?.className);
      }
      return origUpdateView.call(this);
    };
    console.log('[nge-patch] VirtualList.updateView installed');
  } else {
    console.warn('[nge-patch] VirtualList.prototype.updateView not found — is the import path right?');
  }
}

if (!(MeshLayer.prototype as any).getObjectPosition) {
  (MeshLayer.prototype as any).getObjectPosition = function(
      this: MeshLayer, id: Uint64): Float32Array | undefined {
    const transform = this.displayState.transform.value;
    if (transform.error !== undefined) return undefined;
    const objectKey = getObjectKey(id);
    const manifestChunk = this.source.chunks.get(objectKey);
    const fragmentIds = manifestChunk?.fragmentIds;
    if (!fragmentIds || fragmentIds.length === 0) return undefined;

    // Bbox over loaded fragments. One fragment is usually enough to land near
    // the segment, but unioning gives a stabler centroid for multi-fragment cells.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;

    const fragmentChunks = this.source.fragmentSource.chunks;
    for (const fragmentId of fragmentIds) {
      const {key} = this.source.getFragmentKey(objectKey, fragmentId);
      const fragment = fragmentChunks.get(key);
      const verts = fragment?.meshData?.vertexPositions;
      if (!(verts instanceof Float32Array) || verts.length < 3) continue;

      for (let i = 0; i + 2 < verts.length; i += 3) {
        const x = verts[i], y = verts[i + 1], z = verts[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      any = true;
    }
    if (!any) return undefined;

    const rank = transform.rank;
    const modelCenter = new Float32Array(rank);
    modelCenter[0] = (minX + maxX) * 0.5;
    modelCenter[1] = (minY + maxY) * 0.5;
    modelCenter[2] = (minZ + maxZ) * 0.5;

    const layerCenter = new Float32Array(rank);
    matrix.transformPoint(
        layerCenter, transform.modelToRenderLayerTransform, rank + 1, modelCenter, rank);
    return layerCenter;
  };
}

const _origMoveToSegment = SegmentationUserLayer.prototype.moveToSegment;
SegmentationUserLayer.prototype.moveToSegment = function(this: SegmentationUserLayer, id: Uint64) {
  for (const layer of this.renderLayers) {
    if (!(layer instanceof MultiscaleMeshLayer) && !(layer instanceof MeshLayer)) continue;
    const layerPosition = (layer as any).getObjectPosition?.(id);
    if (layerPosition === undefined) continue;
    this.setLayerPosition(
        layer.displayState.transform.value as RenderLayerTransform, layerPosition);
    return;
  }
  // Fall through to the original (which will show the same status message)
  // so we preserve any future upstream additions we don't know about.
  _origMoveToSegment.call(this, id);
};
