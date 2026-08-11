/**
 * state_link.ts — mint a SHORT shareable link for the current viewer state.
 *
 * The raw window.location.href carries the entire neuroglancer state in the
 * hash: multiple KB of URL. Anything that relays such a link through another
 * system truncates it (Slack cut one at ~280 chars, producing "Error parsing
 * state: Unterminated string in JSON" for whoever clicked it). So: post the
 * state to the configured state server (exactly what the Share button does)
 * and hand back the short `/#!middleauth+https://...` form.
 *
 * Returns null when there is no state server, no viewer, or the POST fails
 * (e.g. the user never authenticated) — callers must fall back to something
 * that survives relaying, not to location.href.
 */
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {responseJson} from 'neuroglancer/util/http_request';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';

type StateServers = Record<string, {url: string; default?: boolean}>;
declare const STATE_SERVERS: StateServers | undefined;

export async function mintShortStateLink(): Promise<string | null> {
  try {
    if (typeof STATE_SERVERS === 'undefined' || !Object.keys(STATE_SERVERS).length) return null;
    const viewer: any = (window as any)['viewer'];
    if (!viewer?.state) return null;

    const servers = Object.values(STATE_SERVERS);
    const selected =
      viewer.selectedStateServer?.value && servers.some(s => s.url === viewer.selectedStateServer.value)
        ? viewer.selectedStateServer.value
        : (servers.find(s => s.default) ?? servers[0]).url;

    const protocol = new URL(selected).protocol; // e.g. "middleauth+https:"
    const {url: parsedUrl, credentialsProvider} = parseSpecialUrl(selected, defaultCredentialsManager);
    const res = await cancellableFetchSpecialOk(credentialsProvider, parsedUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(viewer.state.toJSON()),
    }, responseJson);

    const stateUrl = new URL(res);
    const withoutProtocol = stateUrl.toString().split(stateUrl.protocol)[1];
    return `${window.location.origin}/#!${protocol}${withoutProtocol}`;
  } catch (e) {
    console.warn('[state_link] could not mint short state link:', e);
    return null;
  }
}
