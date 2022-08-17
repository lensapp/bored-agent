import { getInjectable } from "@ogre-tools/injectable";
import { AgentProxy, AgentProxyOptions } from "./agent-proxy";
import createConnectionInjectable from "./create-connection.injectable";
import createTLSConnectionInjectable from "./create-tls-connection.injectable";
import createWebSocketInjectable from "./create-websocket.injectable";
import existsSyncInjectable from "./exists-sync.injectable";
import gotInjectable from "./got.injectable";
import loggerInjectable from "./logger.injectable";
import readFileSyncInjectable from "./read-file-sync.injectable";

const createAgentProxyInjectable = getInjectable({
  id: "agent-proxy",
  instantiate: (di) => (opts: AgentProxyOptions) => {
    return new AgentProxy(opts, {
      logger: di.inject(loggerInjectable),
      got: di.inject(gotInjectable),
      readFileSync: di.inject(readFileSyncInjectable),
      existsSync: di.inject(existsSyncInjectable),
      createWebsocket: di.inject(createWebSocketInjectable),
      createConnection: di.inject(createConnectionInjectable),
      createTlsConnection: di.inject(createTLSConnectionInjectable),
    });
  }
});

export default createAgentProxyInjectable;
