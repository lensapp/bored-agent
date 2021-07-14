import { HttpsProxyAgent } from "https-proxy-agent";
import { AgentProxy } from "../agent-proxy";

describe("AgentProxy", () => {
  describe("buildWebSocketOptions", () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it("returns correct defaults", () => {
      const agent = new AgentProxy({
        boredServer: "https://bored.acme.org",
        boredToken: "foo.bar.baz",
        idpPublicKey: "this-is-not-valid"
      });

      expect(agent.buildWebSocketOptions()).toEqual({
        headers: {
          "Authorization": "Bearer foo.bar.baz",
          "X-BoreD-PublicKey": ""
        }
      });
    });

    it("sets agent if HTTPS_PROXY is set", () => {
      process.env.HTTPS_PROXY = "http://proxy.acme.org:8080";

      const agent = new AgentProxy({
        boredServer: "https://bored.acme.org",
        boredToken: "foo.bar.baz",
        idpPublicKey: "this-is-not-valid"
      });

      expect(agent.buildWebSocketOptions().agent).toBeInstanceOf(HttpsProxyAgent);
    });
  });
});
