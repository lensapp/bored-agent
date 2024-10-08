import { AgentProxy } from "./src/agent-proxy";
import { KeyPairManager } from "./src/keypair-manager";
import { version } from "./package.json";
import logger from "./src/logger";
import { serviceAccountTokenPath, ServiceAccountTokenProvider } from "./src/service-account-token";
import { existsSync } from "fs";

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

const serviceAccountFileExists = existsSync(serviceAccountTokenPath);
const serviceAccountTokenProvider = new ServiceAccountTokenProvider(serviceAccountFileExists);

const proxy = new AgentProxy({
  boredServer,
  boredToken,
  idpPublicKey
}, serviceAccountTokenProvider);

const keyPairManager = new KeyPairManager(namespace, serviceAccountTokenProvider);

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
