import { createContainer } from "@ogre-tools/injectable";
import createConnectionInjectable from "./create-connection.injectable";
import createTLSConnectionInjectable from "./create-tls-connection.injectable";
import createWebSocketInjectable from "./create-websocket.injectable";
import existsSyncInjectable from "./exists-sync.injectable";
import gotInjectable from "./got.injectable";
import k8sClientInjectable from "./k8s-client.injectable";
import loggerInjectable from "./logger.injectable";
import readFileSyncInjectable from "./read-file-sync.injectable";
import readFileInjectable from "./read-file.injectable";

export const getDi = () => {
  const di = createContainer("main");

  di.register(createConnectionInjectable);
  di.register(createTLSConnectionInjectable);
  di.register(createWebSocketInjectable);
  di.register(existsSyncInjectable);
  di.register(gotInjectable);
  di.register(k8sClientInjectable);
  di.register(loggerInjectable);
  di.register(readFileSyncInjectable);
  di.register(readFileInjectable);

  return di;
};
