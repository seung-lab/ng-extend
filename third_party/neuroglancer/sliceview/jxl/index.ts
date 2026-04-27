/**
 * @license
 * Copyright 2024 William Silvermsith
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

import {DecodedImage} from 'neuroglancer/async_computation/decode_png_request';
import jxlWasmDataUrl from './jxl_decoder.wasm';

const libraryEnv = {};

let jxlModulePromise: Promise<WebAssembly.Instance>|undefined;

async function getJxlModulePromise(): Promise<WebAssembly.Instance> {
  if (jxlModulePromise === undefined) {
    jxlModulePromise = (async () => {
      const response = await fetch(jxlWasmDataUrl);
      const wasmCode = await response.arrayBuffer();
      const m = await WebAssembly.instantiate(wasmCode, {
        env: libraryEnv,
        wasi_snapshot_preview1: libraryEnv,
      });
      return m.instance;
    })();
  }
  return jxlModulePromise;
}

// JPEG XL container signature, per
// https://github.com/libjxl/libjxl/blob/8f22cb1fb98ed27ceee59887bd291ef4d277c89d/lib/jxl/decode.cc#L118-L130
const magicSpec = [
  0, 0, 0, 0xc,
  'J'.charCodeAt(0), 'X'.charCodeAt(0), 'L'.charCodeAt(0), ' '.charCodeAt(0),
  0xd, 0xa, 0x87, 0xa,
];

// Lightweight signature check — accepts either the bare codestream (0xff 0x0a)
// or the boxed container variant.
function checkHeader(buffer: Uint8Array) {
  function arrayEqualTrucated(a: any, b: any): boolean {
    return a.every((val: number, idx: number) => val === b[idx]);
  }

  const len = buffer.length;
  const kCodestreamMarker = 0x0a;

  if (len < 8 + 4) {
    throw new Error(`jxl: Invalid image size: ${len}`);
  }

  // JPEG XL codestream: 0xff 0x0a
  if (len >= 1 && buffer[0] === 0xff) {
    if (len < 2) {
      throw new Error(`jxl: Not enough bytes. Got: ${len}`);
    } else if (buffer[1] === kCodestreamMarker) {
      return; // valid codestream
    } else {
      throw new Error('jxl: Invalid codestream.');
    }
  }

  // Container form
  const validMagic = arrayEqualTrucated(magicSpec, buffer);
  if (!validMagic) {
    throw new Error(`jxl: didn't match magic numbers: ${buffer.slice(0, 12)}`);
  }
}

export async function decompressJxl(
  buffer: Uint8Array, area: number|undefined,
  numComponents: number|undefined, bytesPerPixel: number,
): Promise<DecodedImage> {
  const m = await getJxlModulePromise();
  checkHeader(buffer);

  area = area || 0;
  numComponents = numComponents || 1;

  const nbytes = area * bytesPerPixel * numComponents;

  const jxlImagePtr = (m.exports.malloc as Function)(buffer.byteLength);
  const heap = new Uint8Array((m.exports.memory as WebAssembly.Memory).buffer);
  heap.set(buffer, jxlImagePtr);

  let imagePtr: number|null = null;
  try {
    const heightAndWidth = (m.exports.height_and_width as Function)(
        jxlImagePtr, buffer.byteLength) as bigint;
    // ES2019 target doesn't support BigInt literals — use BigInt() constructor.
    const width = Number(heightAndWidth & BigInt(0x7fffffff));
    const height = Number(heightAndWidth >> BigInt(31));

    if (width <= 0 || height <= 0) {
      throw new Error(
          `jxl: Decoding failed. Width (${width}) and/or height (${height}) invalid.`);
    }
    if (area !== 0 && width * height !== area) {
      throw new Error(
          `jxl: Expected width and height (${width} x ${height}, ${width * height}) to match area: ${area}.`);
    }

    imagePtr = (m.exports.decode as Function)(
        jxlImagePtr, buffer.byteLength, nbytes) as number;

    if (imagePtr === 0) {
      throw new Error('jxl: Decoding failed. Null pointer returned.');
    }

    // memory.buffer (not heap.buffer) — memory growth during decompress
    // could have detached the prior buffer view.
    const image = new Uint8Array(
        (m.exports.memory as WebAssembly.Memory).buffer, imagePtr, nbytes);

    return {
      width,
      height,
      numComponents,
      uint8Array: image.slice(0),
    };
  } finally {
    (m.exports.free as Function)(jxlImagePtr, buffer.byteLength);
    if (imagePtr) {
      (m.exports.free as Function)(imagePtr, nbytes);
    }
  }
}
