import ReconnectingWebSocket from "reconnecting-websocket";
import { Config } from "#src/config.js";

declare const CONFIG: Config | undefined;

let ws: ReconnectingWebSocket | null = null;

export function connectChatSocket() {
  if (!CONFIG) return;
  console.log("connecting to", CONFIG.chat_url);
  ws = new ReconnectingWebSocket(CONFIG.chat_url);
}

export default function getChatSocket(): ReconnectingWebSocket {
  if (!ws) {
    throw new Error("Chat websocket must be connected before use");
  }
  return ws!;
}
