/**
 * @license
 * Copyright 2016 Google Inc.
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

import {decodeJxl} from 'neuroglancer/async_computation/decode_jxl_request';
import {requestAsyncComputation} from 'neuroglancer/async_computation/request';
import {postProcessRawData} from 'neuroglancer/sliceview/backend_chunk_decoders/postprocess';
import {VolumeChunk} from 'neuroglancer/sliceview/volume/backend';
import {CancellationToken} from 'neuroglancer/util/cancellation';

export async function decodeJxlChunk(
    chunk: VolumeChunk, cancellationToken: CancellationToken, response: ArrayBuffer) {
  const chunkDataSize = chunk.chunkDataSize!;
  const {uint8Array: decoded} = await requestAsyncComputation(
      decodeJxl, cancellationToken, [response],
      new Uint8Array(response),
      /*area=*/ chunkDataSize[0] * chunkDataSize[1] * chunkDataSize[2],
      /*numComponents=*/ chunkDataSize[3] || 1,
      /*bytesPerPixel=*/ 1);
  await postProcessRawData(chunk, cancellationToken, decoded);
}
