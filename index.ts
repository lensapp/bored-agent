import { AgentProxy } from "./src/agent-proxy";
import { CertManager } from "./src/cert-manager";
import { version } from "./package.json";

console.log(`~~ BoreD Agent v${version} ~~`);

const proxy = new AgentProxy({
  tunnelServer: "http://bored:8080/lens-agent/connect"
});

const certManager = new CertManager();

certManager.ensureCerts().then((certs) => {
  proxy.init(certs);
  proxy.connect();
}).catch((reason) => {
  console.error("failed to create certificates", reason);
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
