let ws: WebSocket|null = null;

export function connectChatSocket() {
  ws = new WebSocket('wss://pyrdev.eyewire.org/chat');
  //ws = new WebSocket('ws://localhost:3000');
}

export default function getChatSocket(): WebSocket {
  if (!ws) {
    throw new Error('Chat websocket must be connected before use');
  }
  return ws!;
}
