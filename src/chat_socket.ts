import {config} from './main';

let ws: WebSocket|null = null;

export function connectChatSocket() {
  ws = new WebSocket(config.chatURL);
}

export default function getChatSocket(): WebSocket {
  if (!ws) {
    throw new Error('Chat websocket must be connected before use');
  }
  return ws!;
}
