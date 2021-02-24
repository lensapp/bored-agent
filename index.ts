import { AgentProxy } from "./src/agent-proxy";

const proxy = new AgentProxy({
  tunnelServer: "http://localhost:8080/lens-agent/connect"
});

process.once("SIGTERM", () => {
  proxy.disconnect();
  process.exit(0);
});

process.once("SIGINT", () => {
  proxy.disconnect();
  process.exit(0);
});

proxy.connect();
