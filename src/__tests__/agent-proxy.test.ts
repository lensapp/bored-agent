import { Agents } from "got/dist/source";
import { HttpsProxyAgent } from "https-proxy-agent";
import { AgentProxy } from "../agent-proxy";
import { PassThrough } from "stream";
import { Stream } from "bored-mplex";
import { ServiceAccountTokenProvider } from "../service-account-token";

describe("AgentProxy", () => {
  const OLD_ENV = process.env;
  const serviceAccountTokenProviderMock = {
    getSaToken: () => "service-account-token"
  } as ServiceAccountTokenProvider;
  let agent: AgentProxy;
  let connect: any;

  beforeEach(() => {
    vi.resetModules();
    connect = vi.fn((_opts: any, callback: () => void) => {
      process.nextTick(() => {
        callback();
      });

      return new PassThrough();
    });
    process.env = { ...OLD_ENV };
    agent = new AgentProxy({
      boredServer: "https://bored.acme.org",
      boredToken: "foo.bar.baz",
      idpPublicKey: "this-is-not-valid"
    },
    serviceAccountTokenProviderMock,
    { 
      tlsConnect: connect,
      fileExists: vi.fn(() => false),
      readFile: vi.fn(),
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

  describe("handleDefaultRequestStream", () => {
    it("opens TLS socket with correct options", () => {
      const stream = new Stream(1, {} as any);

      agent.handleDefaultRequestStream(stream);

      expect(connect).toHaveBeenCalledWith(expect.objectContaining({
        host: "kubernetes.default.svc",
        port: 443,
        timeout: 1800000,
      }), expect.any(Function));
    });

    describe("given CA file exists", () => {
      beforeEach(() => {
        agent = new AgentProxy({
          boredServer: "https://bored.acme.org",
          boredToken: "foo.bar.baz",
          idpPublicKey: "this-is-not-valid"
        },
        serviceAccountTokenProviderMock,
        { 
          tlsConnect: connect,
          fileExists: vi.fn(() => true),
          readFile: vi.fn(() => Buffer.from("fake-ca") as any),
        });
      });

      it("passes CA to TLS socket", () => {
        const stream = new Stream(1, {} as any);

        agent.handleDefaultRequestStream(stream);

        expect(connect).toHaveBeenCalledWith(expect.objectContaining({
          host: "kubernetes.default.svc",
          port: 443,
          ca: expect.any(Buffer),
        }), expect.any(Function));
      });
    });

    describe("given CA file does not exist", () => {
      beforeEach(() => {
        agent = new AgentProxy({
          boredServer: "https://bored.acme.org",
          boredToken: "foo.bar.baz",
          idpPublicKey: "this-is-not-valid"
        },
        serviceAccountTokenProviderMock,
        { 
          tlsConnect: connect,
          fileExists: vi.fn(() => false),
          readFile: vi.fn(),
        });
      });

      it("does not pass CA to TLS socket", () => {
        const stream = new Stream(1, {} as any);

        agent.handleDefaultRequestStream(stream);

        expect(connect).toHaveBeenCalledWith(expect.not.objectContaining({
          ca: expect.anything(),
        }), expect.any(Function));
      });

      it("does not configure 'reject unauthorized' to TLS socket", () => {
        const stream = new Stream(1, {} as any);

        agent.handleDefaultRequestStream(stream);

        expect(connect).toHaveBeenCalledWith(expect.not.objectContaining({
          rejectUnauthorized: false,
        }), expect.any(Function));
      });
    });
  });
});
