import { AgentProxy } from "./src/agent-proxy";
import { KeyPairManager } from "./src/keypair-manager";
import { version } from "./package.json";
import logger from "./src/logger";

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

const proxy = new AgentProxy({
  boredServer,
  boredToken,
  idpPublicKey
});

const keyPairManager = new KeyPairManager(namespace);

keyPairManager.ensureKeys().then((keys) => {
  proxy.init(keys);
  proxy.connect();
}).catch((reason) => {
  logger.error("[MAIN] failed to create certificates", reason);
  process.exit(1);
});


process.once("SIGTERM", () => {
  proxy.disconnect();
  process.exit(0);
});

process.once("SIGINT", () => {
  proxy.disconnect();
  process.exit(0);
});
