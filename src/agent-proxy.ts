import WebSocket from "ws";
import * as tls from "tls";
import * as net from "net";
import * as fs from "fs";
import { Got, OptionsOfTextResponseBody } from "got";
import { HttpsProxyAgent } from "https-proxy-agent";
import { BoredMplex, Stream } from "bored-mplex";
import { KeyPair } from "./keypair-manager";
import logger, { Logger } from "./logger";
import { kubernetesPort, kubernetesHost } from "./k8s-client";
import { unixRequestStream } from "./proxy-handlers/unix-request-stream";
import { tcpRequestStream } from "./proxy-handlers/tcp-request-stream";
import { TLSSockets } from "./tls-sockets";
import { defaultRequestStream } from "./proxy-handlers/default-request-stream";
import { TLSSession } from "./tls-session";

export type AgentProxyOptions = {
  boredServer: string;
  boredToken: string;
  idpPublicKey: string;
  httpsProxyAgent?: HttpsProxyAgent;
};

export type StreamHeader = {
  target: string;
};

const caCert = process.env.CA_CERT || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const serviceAccountTokenPath = process.env.SERVICEACCOUNT_TOKEN_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/token";

export interface AgentProxyDependencies {
  readFileSync: typeof fs.readFileSync;
  existsSync: typeof fs.existsSync;
  got: Got;
  logger: Logger;
  createConnection: typeof net.createConnection;
  createTlsConnection: typeof tls.connect;
  createWebsocket: (url: string, opts: WebSocket.ClientOptions) => WebSocket;
}

export class AgentProxy {
  private boredServer: string;
  private boredToken: string;
  private idpPublicKey: string;
  private httpsProxyAgent?: HttpsProxyAgent;
  private cipherAlgorithm = "aes-256-gcm";
  private mplex?: BoredMplex;
  private ws?: WebSocket;
  private caCert?: Buffer;
  private tlsSession: TLSSession;
  private keys?: KeyPair;
  private retryTimeout?: NodeJS.Timeout;
  private serviceAccountToken?: Buffer;
  private tlsSockets: TLSSockets;
  private deps: AgentProxyDependencies;

  constructor(opts: AgentProxyOptions, deps: AgentProxyDependencies) {
    this.boredServer = opts.boredServer;
    this.boredToken = opts.boredToken;
    this.idpPublicKey = opts.idpPublicKey;
    this.httpsProxyAgent = opts.httpsProxyAgent;
    this.tlsSockets = new TLSSockets();
    this.tlsSession = new TLSSession();
    this.deps = deps;
  }

  init(keys: KeyPair) {
    this.keys = keys;

    if (this.deps.existsSync(caCert)) {
      this.caCert = this.deps.readFileSync(caCert);
    }

    if (this.deps.existsSync(serviceAccountTokenPath)) {
      this.serviceAccountToken = this.deps.readFileSync(serviceAccountTokenPath);
    }

    setInterval(() => {
      if (this.ws) logger.info(`[PROXY] ${this.tlsSockets.get().length} active sockets`);
    }, 10_000);
  }

  buildWebSocketOptions(): WebSocket.ClientOptions {
    const options: WebSocket.ClientOptions = {
      headers: {
        "Authorization": `Bearer ${this.boredToken}`,
        "X-BoreD-PublicKey": Buffer.from(this.keys?.public || "").toString("base64")
      }
    };

    if (this.httpsProxyAgent) {
      options.agent = this.httpsProxyAgent;
    }

    return options;
  }

  async connect(reconnect = false) {
    if (!reconnect) logger.info(`[PROXY] establishing reverse tunnel to ${this.boredServer} ...`);

    if (this.idpPublicKey === "") {
      await this.syncPublicKeyFromServer();
    }

    this.ws = this.deps.createWebsocket(`${this.boredServer}/agent/connect`, this.buildWebSocketOptions());
    this.ws.on("open", () => {
      if (!this.ws) return;

      logger.info("[PROXY] tunnel connection opened");

      this.mplex = new BoredMplex(this.handleRequestStream.bind(this));
      this.mplex.enableKeepAlive(15_000);

      const wsDuplex = WebSocket.createWebSocketStream(this.ws);

      this.mplex.pipe(wsDuplex).pipe(this.mplex);
    });

    const retry = () => {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      this.retryTimeout = setTimeout(() => {
        this.connect(true);
      }, 1000);
    };

    this.ws.on("error", (err) => {
      logger.error("[PROXY] websocket error", err);
      retry();
    });
    this.ws.on("unexpected-response", () => {
      retry();
    });
    this.ws.on("close", (code: number) => {
      logger.info(`[PROXY] tunnel connection closed (code: ${code})`);
      this.closeTlsSockets();
      retry();
    });
  }

  buildGotOptions() {
    const options: OptionsOfTextResponseBody = {
      retry: {
        limit: 6
      }
    };

    if (this.httpsProxyAgent) {
      options.agent = { https: this.httpsProxyAgent };
    }

    return options;
  }

  protected async syncPublicKeyFromServer() {
    try {
      const res = await this.deps.got.get(`${this.boredServer}/.well-known/public_key`, this.buildGotOptions());

      logger.info(`[PROXY] fetched idp public key from server`);
      this.idpPublicKey = res.body;
    } catch(error) {
      logger.error("[PROXY] failed to fetch idp public key from server");

      throw error;
    }
  }

  protected closeTlsSockets() {
    this.tlsSockets.get().forEach((socket) => {
      try {
        socket.end();
      } catch (error) {
        logger.error(`[PROXY] failed to close socket: %s`, error);
      }
    });
  }

  handleRequestStream(stream: Stream, data?: Buffer) {
    if (data) {
      let protocol = "";
      let header: StreamHeader;

      try {
        header = JSON.parse(data.toString()) as StreamHeader;

        protocol = header?.target?.split("://")[0];
      } catch (error) {
        logger.error("[PROXY] invalid stream open data: %o", error);
        stream.end();

        return;
      }


      switch(protocol) {
        case "unix": {
          this.handleUnixRequestStream(stream, header.target.replace("unix://", ""));
          break;
        }

        case "tcp": {
          const url = new URL(header.target);

          this.handleTcpRequestStream(stream, url.hostname, parseInt(url.port));
          break;
        }

        default: {
          logger.error("[PROXY] invalid stream target protocol %s", protocol);
          stream.end();
        }
      }
    } else {
      this.handleDefaultRequestStream(stream);
    }
  }

  handleTcpRequestStream(stream: Stream, host: string, port: number) {
    tcpRequestStream(this.keys?.private || "", this.cipherAlgorithm, stream, host, port, {
      logger: this.deps.logger,
      createConnection: this.deps.createConnection
    });
  }

  handleUnixRequestStream(stream: Stream, socketPath: string) {
    unixRequestStream(this.keys?.private || "", this.cipherAlgorithm, stream, socketPath, { 
      logger: this.deps.logger,
      createConnection: this.deps.createConnection
    });
  }

  protected registerCommonSocketStreamEvents(socket: net.Socket, stream: Stream) {
    socket.on("timeout", () => {
      socket.end();
    });

    socket.on("error", (error) => {
      logger.error("[PROXY] tcp socket error: %o", error);
      socket.end();
    });

    socket.on("end", () => {
      stream.end();
    });

    stream.on("finish", () => {
      logger.info("[PROXY] unix stream ended");
      socket.end();
    });
  }

  handleDefaultRequestStream(stream: Stream) {
    defaultRequestStream(stream, {
      host: kubernetesHost,
      port: kubernetesPort,
      cipherAlgorithm: this.cipherAlgorithm,
      serviceAccountToken: this.serviceAccountToken,
      idpPublicKey: this.idpPublicKey,
      boredServer: this.boredServer,
      privateKey: this.keys?.private || "",
      caCert: this.caCert
    }, {
      logger: this.deps.logger,
      connect: this.deps.createTlsConnection,
      tlsSession: this.tlsSession,
      tlsSockets: this.tlsSockets
    });
  }

  disconnect() {
    this.ws?.close();
  }
}
