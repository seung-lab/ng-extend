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

import {CANCELED, CancellationToken, uncancelableToken} from 'neuroglancer/util/cancellation';
import {Uint64} from 'neuroglancer/util/uint64';

export class HttpError extends Error {
  url: string;
  status: number;
  statusText: string;
  response?: Response;

  constructor(url: string, status: number, statusText: string, response?: Response) {
    let message = `Fetching ${JSON.stringify(url)} resulted in HTTP error ${status}`;
    if (statusText) {
      message += `: ${statusText}`;
    }
    message += '.';
    super(message);
    this.name = 'HttpError';
    this.message = message;
    this.url = url;
    this.status = status;
    this.statusText = statusText;
    if (response) {
      this.response = response;
    }
  }

  static fromResponse(response: Response) {
    return new HttpError(response.url, response.status, response.statusText, response);
  }

  static fromRequestError(input: RequestInfo, error: unknown) {
    if (error instanceof TypeError) {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else {
        url = input.url;
      }
      return new HttpError(url, 0, 'Network or CORS error');
    }
    return error;
  }
}

const maxAttempts = 32;
const minDelayMilliseconds = 500;
const maxDelayMilliseconds = 10000;
// Pyr: a network error (fetch rejects with a TypeError, which fromRequestError reports as
// status 0 and isNotFoundError then treats as "no data") or a 5xx other than 503/504 gets a few
// more tries before it is reported, so a blip does not leave a chunk blank or FAILED for the
// session. Idempotent requests only. 1 try + 3 retries, waits pickDelay(0..2): 0.5-1, 1-2, 2-4 s.
const maxTransientAttempts = 4;

function isIdempotent(input: RequestInfo, init?: RequestInit) {
  const method =
      (init?.method ?? (typeof input === 'string' ? undefined : input.method) ?? 'GET')
          .toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

// A wait that ends early when the request is aborted; the loop top then throws CANCELED.
function transientDelay(attempt: number, signal?: AbortSignal|null) {
  return new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, pickDelay(attempt));
    signal?.addEventListener('abort', done);
  });
}

export function pickDelay(attemptNumber: number): number {
  // If `attemptNumber == 0`, delay is a random number of milliseconds between
  // `[minDelayMilliseconds, minDelayMilliseconds*2]`.  The lower and upper bounds of the interval
  // double with each successive attempt, up to the limit of
  // `[maxDelayMilliseconds/2,maxDelayMilliseconds]`.
  return Math.min(2 ** attemptNumber * minDelayMilliseconds, maxDelayMilliseconds / 2) *
      (1 + Math.random());
}

/**
 * Issues a `fetch` request.
 *
 * If the request fails due to an HTTP status outside `[200, 300)`, throws an `HttpError`.  If the
 * request fails due to a network or CORS restriction, throws an `HttpError` with a `status` of `0`.
 *
 * If the request fails due to a transient error (429, 503, 504), retry.
 */
export async function fetchOk(input: RequestInfo, init?: RequestInit): Promise<Response> {
  for (let requestAttempt = 0, transientAttempt = 0;;) {
    if (init?.signal?.aborted) {
      throw CANCELED;
    }
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      // An abort rejects with a DOMException (not a TypeError) and is caught at the loop top.
      if (error instanceof TypeError && isIdempotent(input, init) &&
          ++transientAttempt < maxTransientAttempts) {
        await transientDelay(transientAttempt - 1, init?.signal);
        continue;
      }
      throw HttpError.fromRequestError(input, error);
    }
    if (!response.ok) {
      const {status} = response;
      if (status === 429 || status === 503 || status === 504) {
        // 429: Too Many Requests.  Retry.
        // 503: Service unavailable.  Retry.
        // 504: Gateway timeout.  Can occur if the server takes too long to reply.  Retry.
        if (++requestAttempt !== maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pickDelay(requestAttempt - 1)));
          continue;
        }
      } else if (status >= 500 && isIdempotent(input, init) &&
                 ++transientAttempt < maxTransientAttempts) {
        // Pyr: 500/502 from the storage front end: a few more tries, then report it.
        await transientDelay(transientAttempt - 1, init?.signal);
        continue;
      }
      throw HttpError.fromResponse(response);
    }
    return response;
  }
}

// Pyr: the body is read outside fetchOk's loop, so a connection lost mid-body
// (response.arrayBuffer() rejects with a TypeError) gets the same few tries. An abort rejects with
// a DOMException and is rethrown unchanged, as before.
async function fetchOkAndTransform<T>(
    input: RequestInfo, init: RequestInit|undefined,
    transformResponse: ResponseTransform<T>): Promise<T> {
  for (let transientAttempt = 0;;) {
    const response = await fetchOk(input, init);
    try {
      return await transformResponse(response);
    } catch (error) {
      if (!(error instanceof TypeError) || init?.signal?.aborted || !isIdempotent(input, init) ||
          ++transientAttempt >= maxTransientAttempts) {
        throw error;
      }
      await transientDelay(transientAttempt - 1, init?.signal);
    }
  }
}

export function responseArrayBuffer(response: Response): Promise<ArrayBuffer> {
  return response.arrayBuffer();
}

export function responseJson(response: Response): Promise<any> {
  return response.json();
}

export type ResponseTransform<T> = (response: Response) => Promise<T>;

/**
 * Issues a `fetch` request in the same way as `fetchOk`, and returns the result of the promise
 * returned by `transformResponse`.
 *
 * Additionally, the request may be cancelled through `cancellationToken`.
 *
 * The `transformResponse` function should not do anything with the `Response` object after its
 * result becomes ready; otherwise, cancellation may not work as expected.
 */
export async function cancellableFetchOk<T>(
    input: RequestInfo, init: RequestInit, transformResponse: ResponseTransform<T>,
    cancellationToken: CancellationToken = uncancelableToken): Promise<T> {
  if (cancellationToken === uncancelableToken) {
    return await fetchOkAndTransform(input, init, transformResponse);
  }
  const abortController = new AbortController();
  const unregisterCancellation = cancellationToken.add(() => abortController.abort());
  try {
    return await fetchOkAndTransform(
        input, {...init, signal: abortController.signal}, transformResponse);
  } finally {
    unregisterCancellation();
  }
}

const tempUint64 = new Uint64();

export function getByteRangeHeader(startOffset: Uint64|number, endOffset: Uint64|number) {
  let endOffsetStr: string;
  if (typeof endOffset === 'number') {
    endOffsetStr = `${endOffset - 1}`;
  } else {
    Uint64.decrement(tempUint64, endOffset);
    endOffsetStr = tempUint64.toString();
  }
  return {'Range': `bytes=${startOffset}-${endOffsetStr}`};
}

export function parseUrl(url: string): {protocol: string, host: string, path: string} {
  // ng-extend: allow data: URLs (used for client-generated meshes, e.g. the
  // scout tag pin OBJ). They fall through parseSpecialUrl/fetch unchanged.
  if (url.startsWith('data:')) {
    return {protocol: 'data', host: '', path: url};
  }
  const urlProtocolPattern = /^([^:\/]+):\/\/([^\/]+)((?:\/.*)?)$/;
  let match = url.match(urlProtocolPattern);
  if (match === null) {
    throw new Error(`Invalid URL: ${JSON.stringify(url)}`);
  }
  return {protocol: match[1], host: match[2], path: match[3]};
}

export function isNotFoundError(e: any) {
  if (!(e instanceof HttpError)) return false;
  // Treat CORS errors (0) or 403 as not found.  S3 returns 403 if the file does not exist because
  // permissions are per-file.
  return (e.status === 0 || e.status === 403 || e.status === 404);
}
