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

import debounce from 'lodash/debounce';
import {CredentialsManager} from 'neuroglancer/credentials_provider';
import {StatusMessage} from 'neuroglancer/status';
import {WatchableValue} from 'neuroglancer/trackable_value';
import {RefCounted} from 'neuroglancer/util/disposable';
import {responseJson} from 'neuroglancer/util/http_request';
import {urlSafeParse, verifyObject} from 'neuroglancer/util/json';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {getCachedJson, Trackable} from 'neuroglancer/util/trackable';

/**
 * @file Implements a binding between a Trackable value and the URL hash state.
 */

/**
 * Encodes a fragment string robustly.
 */
function encodeFragment(fragment: string) {
  return encodeURI(fragment).replace(/[!'()*;,]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

export interface UrlHashBindingOptions {
  defaultFragment?: string;
  updateDelayMilliseconds?: number;
}

/**
 * An instance of this class manages a binding between a Trackable value and the URL hash state.
 * The binding is initialized in the constructor, and is removed when dispose is called.
 */
/** nge: the longest view written to the page address (characters). Firefox
 *  keeps every address a page sets in its history files, so big views written
 *  there after every change filled one player's history with 12 GB of copies
 *  (hi529, report 541). A bigger view is kept by Pyr instead, in this
 *  browser's own database (src/util/reload_guard.ts). */
const NGE_MAX_HASH_CHARS = 100_000;

/** nge: a view's text without its 3D angle (the first projectionOrientation,
 *  the viewer's own: it comes before the layers). */
export function withoutTurn(json: string): string {
  return json.replace(/"projectionOrientation":\[[^\]]*\],?/, '');
}

export class UrlHashBinding extends RefCounted {
  /**
   * Most recently parsed or set state string.
   */
  private prevStateString: string|undefined;

  /**
   * Generation number of previous state set.
   */
  private prevStateGeneration: number|undefined;

  /**
   * Most recent error parsing URL hash.
   */
  parseError = new WatchableValue<Error|undefined>(undefined);

  private defaultFragment: string;

  constructor(
      public root: Trackable, public credentialsManager: CredentialsManager,
      options: UrlHashBindingOptions = {}) {
    super();
    const {updateDelayMilliseconds = 200, defaultFragment = '{}'} = options;
    this.registerEventListener(window, 'hashchange', () => this.updateFromUrlHash());
    // nge: a view that keeps changing is still written at least every 5 s.
    const throttledSetUrlHash = debounce(() => this.setUrlHash(), updateDelayMilliseconds, {maxWait: Math.max(updateDelayMilliseconds, 5000)});
    this.registerDisposer(root.changed.add(throttledSetUrlHash));
    this.registerDisposer(() => throttledSetUrlHash.cancel());
    // nge: leaving the page (a reload among it) keeps the latest view, with
    // a copy that is written at once (src/util/local_view.ts).
    const leave = () => {
      throttledSetUrlHash.flush();
      const hooks = (window as any).__ngeLocalView;
      if (hooks && this.lastLocalJson) hooks.backup(this.lastLocalJson);
    };
    this.registerEventListener(window, 'pagehide', leave);
    this.registerEventListener(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
    this.defaultFragment = defaultFragment;
  }

  /** nge: the last view kept under this tab's code. */
  private lastLocalJson: string | undefined;
  /** nge: that view without its 3D angle. */
  private lastSansTurn: string | undefined;

  /**
   * Sets the URL hash to match the current state.
   */
  setUrlHash() {
    const cacheState = getCachedJson(this.root);
    const {generation} = cacheState;
    if (generation !== this.prevStateGeneration) {
      this.prevStateGeneration = cacheState.generation;
      const json = JSON.stringify(cacheState.value);
      // nge: the address holds a short code; the view is kept in this
      // browser (src/util/local_view.ts, report 541).
      const hooks = (window as any).__ngeLocalView;
      if (hooks) {
        (window as any).__ngeHashStale = false;
        (window as any).__ngeStaleJson = undefined;
        this.prevStateString = undefined;
        // A view with no layers leaves the address as it is: a link still
        // loading (a state server link waiting for sign in) stays there.
        if (json === '{}' || !json.includes('"layers"')) return;
        // The Starship's slow turn changes only the 3D angle, several times
        // a second. While it turns, that alone is not kept again (it rewrote
        // the whole view every 5 s); leaving the page still keeps it.
        const turning = performance.now() - ((window as any).__ngeAutoTurnAt || -1e9) < 2000;
        const sansTurn = withoutTurn(json);
        const onlyTurned = turning && this.lastLocalJson !== undefined && sansTurn === this.lastSansTurn;
        this.lastLocalJson = json;
        if (onlyTurned) return;
        this.lastSansTurn = sansTurn;
        const want = hooks.prefix + hooks.save(json);
        if (location.hash !== want) {
          try { history.replaceState(null, '', want); } catch { /* keep the old address */ }
        }
        return;
      }
      // nge: a view too big for the address is not encoded for it (that took
      // a second on a big MEC view, after every edit: Nseraf, report 383).
      // Pyr keeps it itself, from this same text (src/util/reload_guard.ts).
      if (json.length > NGE_MAX_HASH_CHARS) {
        (window as any).__ngeHashStale = true;
        (window as any).__ngeStaleJson = json;
        this.prevStateString = undefined;
        return;
      }
      (window as any).__ngeStaleJson = undefined;
      let stateString = encodeFragment(json);
      if (stateString !== this.prevStateString) {
        this.prevStateString = stateString;
        // nge: a view too big for the address (Nseraf, report 371: MEC with
        // thousands of marks) is not written there: Firefox stops taking it
        // near 1 MB and Chrome will not reload an address over 2 MB. The
        // flag tells Pyr to keep the view itself (src/util/reload_guard.ts).
        let stale = stateString.length > NGE_MAX_HASH_CHARS;
        if (!stale) {
          try {
            if (decodeURIComponent(stateString) === '{}') {
              history.replaceState(null, '', '#');
            } else {
              history.replaceState(null, '', '#!' + stateString);
              stale = location.hash.length < stateString.length;
            }
          } catch {
            stale = true;
          }
        }
        (window as any).__ngeHashStale = stale;
      }
    }
  }

  /**
   * Sets the current state to match the URL hash.  If it is desired to initialize the state based
   * on the URL hash, then this should be called immediately after construction.
   */
  updateFromUrlHash() {
    try {
      let s = location.href.replace(/^[^#]+/, '');
      if (s === '' || s === '#' || s === '#!') {
        s = '#!' + this.defaultFragment;
      }
      // nge: a code for a view kept in this browser (src/util/local_view.ts).
      const hooks = (window as any).__ngeLocalView;
      if (hooks && s.startsWith(hooks.prefix)) {
        const code = s.slice(hooks.prefix.length);
        // The address this tab wrote itself: the view is already on screen.
        if (code === hooks.code() && this.lastLocalJson !== undefined) return;
        hooks.load(code).then((json: string | null) => {
          if (!json) {
            console.warn('[view] no kept view for this address in this browser');
            return;
          }
          this.root.reset();
          this.root.restoreState(JSON.parse(json));
          this.parseError.value = undefined;
        }).catch((e: Error) => { this.parseError.value = e; });
        return;
      }
      // Handle remote JSON state
      if (s.match(/^#!([a-z][a-z\d+-.]*):\/\//)) {
        const url = s.substring(2);
        const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(url, this.credentialsManager);
        StatusMessage.forPromise(
            cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {}, responseJson)
                .then(json => {
                  verifyObject(json);
                  this.root.reset();
                  this.root.restoreState(json);
                }),
            {initialMessage: `Loading state from ${url}`, errorPrefix: `Error loading state:`});
      } else if (s.startsWith('#!+')) {
        s = s.slice(3);
        // Firefox always %-encodes the URL even if it is not typed that way.
        s = decodeURIComponent(s);
        let state = urlSafeParse(s);
        verifyObject(state);
        this.root.restoreState(state);
        this.prevStateString = undefined;
      } else if (s.startsWith('#!')) {
        s = s.slice(2);
        s = decodeURIComponent(s);
        if (s === this.prevStateString) {
          return;
        }
        this.prevStateString = s;
        this.root.reset();
        let state = urlSafeParse(s);
        verifyObject(state);
        this.root.restoreState(state);
      } else {
        throw new Error(`URL hash is expected to be of the form "#!{...}" or "#!+{...}".`);
      }
      this.parseError.value = undefined;
    } catch (parseError) {
      this.parseError.value = parseError;
    }
  }
}
