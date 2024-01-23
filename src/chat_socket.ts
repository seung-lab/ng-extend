import ReconnectingWebSocket from 'reconnecting-websocket';

import {Config} from './config';

declare const CONFIG: Config|undefined;

let ws: ReconnectingWebSocket|null = null;

export function connectChatSocket() {
  if (!CONFIG) return;
  ws = new ReconnectingWebSocket(CONFIG.chat_url);
}

export default function getChatSocket(): ReconnectingWebSocket {
  if (!ws) {
    throw new Error('Chat websocket must be connected before use');
  }
  return ws!;
}
