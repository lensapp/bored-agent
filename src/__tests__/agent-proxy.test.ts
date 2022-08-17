import { Agents } from "got/dist/source";
import { HttpsProxyAgent } from "https-proxy-agent";
import { AgentProxy } from "../agent-proxy";

describe("AgentProxy", () => {
  const OLD_ENV = process.env;
  let agent: AgentProxy;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    agent = new AgentProxy({
      boredServer: "https://bored.acme.org",
      boredToken: "foo.bar.baz",
      idpPublicKey: "this-is-not-valid"
    }, {
      readFileSync: jest.fn(),
      existsSync: jest.fn(),
      got: jest.fn() as any,
      logger: jest.fn() as any,
      createConnection: jest.fn(),
      createTlsConnection: jest.fn(),
      createWebsocket: jest.fn(),
    });
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe("buildWebSocketOptions", () => {
    it("returns correct defaults", () => {
      expect(agent.buildWebSocketOptions()).toEqual({
        headers: {
          "Authorization": "Bearer foo.bar.baz",
          "X-BoreD-PublicKey": ""
        }
      });
    });

    it("sets agent if HTTPS_PROXY is set", () => {
      process.env.HTTPS_PROXY = "http://proxy.acme.org:8080";

      expect(agent.buildWebSocketOptions().agent).toBeInstanceOf(HttpsProxyAgent);
    });
  });

  describe("buildGotOptions", () => {
    it("returns correct defaults", () => {
      expect(agent.buildGotOptions()).toEqual({
        retry: {
          limit: 6
        }
      });
    });

    it("sets agent.https if HTTPS_PROXY is set", () => {
      process.env.HTTPS_PROXY = "http://proxy.acme.org:8080";

      expect(agent.buildGotOptions().agent).toBeDefined();
      expect((agent.buildGotOptions().agent as Agents).https).toBeInstanceOf(HttpsProxyAgent);
    });
  });
});
