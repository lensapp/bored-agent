import { AgentProxyOptions } from "./src/agent-proxy";
import { KeyPairManager } from "./src/keypair-manager";
import { version } from "./package.json";
import { getDi } from "./src/get-di";
import { HttpsProxyAgent } from "https-proxy-agent";
import loggerInjectable from "./src/logger.injectable";
import k8sClientInjectable from "./src/k8s-client.injectable";
import createAgentProxyInjectable from "./src/create-agent-proxy.injectable";

const di = getDi();

const logger = di.inject(loggerInjectable);

process.title = "bored-agent";

logger.info(`[MAIN] ~~ BoreD Agent v${version} ~~`);

const boredServer = process.env.BORED_SERVER || "http://bored:8080";
const boredToken = process.env.BORED_TOKEN;
const namespace = process.env.NAMESPACE;
const idpPublicKey = process.env.IDP_PUBLIC_KEY || "";

if (!boredToken) {
  logger.error("[MAIN] BORED_TOKEN not set, quitting.");

  process.exit(1);
}

if (!namespace) {
  logger.error("[MAIN] NAMESPACE not set, quitting.");

  process.exit(1);
}

const agentProxyOpts: AgentProxyOptions = {
  boredServer,
  boredToken,
  idpPublicKey
};

if (process.env.HTTPS_PROXY) {
  agentProxyOpts.httpsProxyAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
}

const createProxy = di.inject(createAgentProxyInjectable);
const proxy = createProxy(agentProxyOpts);
const keyPairManager = new KeyPairManager(namespace, di.inject(k8sClientInjectable));

keyPairManager.ensureKeys().then((keys) => {
  proxy.init(keys);
  proxy.connect().catch((reason) => {
    logger.error("[MAIN] failed to connect %s", reason);
    process.exit(1);
  });
}).catch((reason) => {
  logger.error("[MAIN] failed to create certificates %s", reason);
  process.exit(1);
});

process.once("SIGHUP", () => {
  logger.info("[MAIN] got SIGHUP, closing websocket connection");
  proxy.disconnect();
});

process.once("SIGTERM", () => {
  logger.info("[MAIN] got SIGTERM, closing websocket connection");
  proxy.disconnect();
  process.exit(0);
});

process.once("SIGINT", () => {
  logger.info("[MAIN] got SIGINT, closing websocket connection");
  proxy.disconnect();
  process.exit(0);
});
