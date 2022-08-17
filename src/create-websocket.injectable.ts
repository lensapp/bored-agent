import WebSocket from "ws";
import { getInjectable } from "@ogre-tools/injectable";

const createWebSocketInjectable = getInjectable({
  id: "create-websocket",
  instantiate: () => (url: string, opts: WebSocket.ClientOptions) => new WebSocket(url, opts)
});

export default createWebSocketInjectable;
