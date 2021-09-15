import {config} from './main';
import ReconnectingWebSocket from 'reconnecting-websocket';

let ws: ReconnectingWebSocket|null = null;

export function connectChatSocket() {
  ws = new ReconnectingWebSocket(config.chatURL);
}

export default function getChatSocket(): ReconnectingWebSocket {
  if (!ws) {
    throw new Error('Chat websocket must be connected before use');
  }
  return ws!;
}
