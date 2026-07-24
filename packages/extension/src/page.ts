/**
 * Runs in the page's MAIN world at document_start — before ESPN's bundle
 * executes — so the WebSocket constructor is wrapped before the draft room
 * connects. Every received frame is relayed to the isolated content script
 * via postMessage; parsing happens in the service worker.
 */

const RELAY_TYPE = "__drafthelper_ws_frame";

const OrigWebSocket = window.WebSocket;

function hook(sock: WebSocket): void {
  sock.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    // Only draft-service sockets are interesting.
    if (!sock.url.includes("fantasydraft.espn.com")) return;
    window.postMessage({ type: RELAY_TYPE, frame: ev.data }, window.location.origin);
  });
}

const WrappedWebSocket = function (
  this: WebSocket,
  url: string | URL,
  protocols?: string | string[]
) {
  const sock =
    protocols === undefined ? new OrigWebSocket(url) : new OrigWebSocket(url, protocols);
  try {
    hook(sock);
  } catch {
    // Never break the draft room.
  }
  return sock;
} as unknown as typeof WebSocket;

WrappedWebSocket.prototype = OrigWebSocket.prototype;
Object.defineProperty(WrappedWebSocket, "CONNECTING", { value: OrigWebSocket.CONNECTING });
Object.defineProperty(WrappedWebSocket, "OPEN", { value: OrigWebSocket.OPEN });
Object.defineProperty(WrappedWebSocket, "CLOSING", { value: OrigWebSocket.CLOSING });
Object.defineProperty(WrappedWebSocket, "CLOSED", { value: OrigWebSocket.CLOSED });

window.WebSocket = WrappedWebSocket;

export {};
