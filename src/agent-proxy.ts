import WebSocket from "ws";
import * as tls from "tls";
import * as net from "net";
import * as fs from "fs";
import got, { OptionsOfTextResponseBody } from "got";
import { HttpsProxyAgent } from "https-proxy-agent";
import { BoredMplex, Stream } from "bored-mplex";
import { createDecipheriv, createCipheriv } from "crypto";
import { KeyPair } from "./keypair-manager";
import { StreamParser } from "./stream-parser";
import { StreamImpersonator } from "./stream-impersonator";
import logger from "./logger";

export type AgentProxyOptions = {
  boredServer: string;
  boredToken: string;
  idpPublicKey: string;
};

export type StreamHeader = {
  target: string;
};

const caCert = process.env.CA_CERT || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const serviceAccountTokenPath = process.env.SERVICEACCOUNT_TOKEN_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/token";

export class AgentProxy {
  private boredServer: string;
  private boredToken: string;
  private idpPublicKey: string;
  private cipherAlgorithm = "aes-256-gcm";
  private mplex?: BoredMplex;
  private ws?: WebSocket;
  private caCert?: Buffer;
  private tlsSession?: Buffer;
  private keys?: KeyPair;
  private retryTimeout?: NodeJS.Timeout;
  private serviceAccountToken?: Buffer;
  private tlsSockets: tls.TLSSocket[] = [];

  constructor(opts: AgentProxyOptions) {
    this.boredServer = opts.boredServer;
    this.boredToken = opts.boredToken;
    this.idpPublicKey = opts.idpPublicKey;

    if (fs.existsSync(caCert)) {
      this.caCert = fs.readFileSync(caCert);
    }

    if (fs.existsSync(serviceAccountTokenPath)) {
      this.serviceAccountToken = fs.readFileSync(serviceAccountTokenPath);
    }
  }

  init(keys: KeyPair) {
    this.keys = keys;

    setInterval(() => {
      if (this.ws) logger.info(`[PROXY] ${this.tlsSockets.length} active sockets`);
    }, 10_000);
  }

  buildWebSocketOptions(): WebSocket.ClientOptions {
    const options: WebSocket.ClientOptions = {
      headers: {
        "Authorization": `Bearer ${this.boredToken}`,
        "X-BoreD-PublicKey": Buffer.from(this.keys?.public || "").toString("base64")
      }
    };

    if (process.env.HTTPS_PROXY) {
      options.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    }

    return options;
  }

  async connect(reconnect = false) {
    if (!reconnect) logger.info(`[PROXY] establishing reverse tunnel to ${this.boredServer} ...`);

    if (this.idpPublicKey === "") {
      await this.syncPublicKeyFromServer();
    }

    this.ws = new WebSocket(`${this.boredServer}/agent/connect`, this.buildWebSocketOptions());
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

    if (process.env.HTTPS_PROXY) {
      options.agent = { https: new HttpsProxyAgent(process.env.HTTPS_PROXY) };
    }

    return options;
  }

  protected async syncPublicKeyFromServer() {
    try {
      const res = await got.get(`${this.boredServer}/.well-known/public_key`, this.buildGotOptions());

      logger.info(`[PROXY] fetched idp public key from server`);
      this.idpPublicKey = res.body;
    } catch(error) {
      logger.error("[PROXY] failed to fetch idp public key from server");

      throw error;
    }
  }

  protected closeTlsSockets() {
    this.tlsSockets.forEach((socket) => {
      try {
        socket.end();
      } catch (error) {
        logger.error(`[PROXY] failed to close socket: %s`, error);
      }
    });
  }

  handleRequestStream(stream: Stream, data?: Buffer) {
    if (data) {
      const header = JSON.parse(data.toString()) as StreamHeader;
      const protocol = header.target.split("://")[0];

      switch(protocol) {
        case "unix": {
          this.handleUnixRequestStream(stream, header.target);
          break;
        }

        case "tcp": {
          const url = new URL(header.target);

          this.handleTcpRequestStream(stream, url.hostname, parseInt(url.port));
          break;
        }

        default: {
          logger.error("invalid stream target protocol %s", protocol);
          stream.end();
        }
      }
    } else {
      this.handleDefaultRequestStream(stream);
    }
  }

  handleTcpRequestStream(stream: Stream, host: string, port: number) {
    const socket = net.createConnection(port, host, () => {
      stream.pipe(socket).pipe(stream);
    });

    socket.on("timeout", () => {
      socket.end();
    });

    socket.on("error", (error) => {
      logger.info("[PROXY] tcp socket error: ", error);
      socket.end();
    });

    socket.on("end", () => {
      stream.end();
    });

    stream.on("finish", () => {
      logger.info("[PROXY] tcp stream ended");
      socket.end();
    });
  }

  handleUnixRequestStream(stream: Stream, socketPath: string) {
    const socket = net.createConnection(socketPath, () => {
      stream.pipe(socket).pipe(stream);
    });

    socket.on("timeout", () => {
      socket.end();
    });

    socket.on("error", (error) => {
      logger.info("[PROXY] unix socket error: ", error);
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
    const opts: tls.ConnectionOptions = {
      host: process.env.KUBERNETES_HOST || "kubernetes.default.svc",
      port: parseInt(process.env.KUBERNETES_SERVICE_PORT || "443"),
      timeout: 1_000 * 60 * 30 // 30 minutes
    };

    if (this.caCert) {
      opts.ca = this.caCert;
    } else {
      opts.rejectUnauthorized = false;

      opts.checkServerIdentity = () => {
        return undefined;
      };
    }

    if (this.tlsSession) {
      opts.session = this.tlsSession;
    }

    const socket = tls.connect(opts, () => {
      this.tlsSockets.push(socket);
      const parser = new StreamParser();

      parser.bodyParser = (key: Buffer, iv: Buffer) => {
        const decipher = createDecipheriv(this.cipherAlgorithm, key, iv);
        const cipher = createCipheriv(this.cipherAlgorithm, key, iv);

        if (this.serviceAccountToken && this.idpPublicKey !== "") {
          const streamImpersonator = new StreamImpersonator();

          streamImpersonator.publicKey = this.idpPublicKey;
          streamImpersonator.boredServer = this.boredServer;
          streamImpersonator.saToken = this.serviceAccountToken.toString();
          parser.pipe(decipher).pipe(streamImpersonator).pipe(socket).pipe(cipher).pipe(stream);
        } else {
          parser.pipe(decipher).pipe(socket).pipe(cipher).pipe(stream);
        }
      };

      parser.privateKey = this.keys?.private || "";

      try {
        stream.pipe(parser);
      } catch (error) {
        logger.error("[STREAM PARSER] failed to parse stream %s", error);
        stream.end();
      }
    });

    socket.on("timeout", () => {
      socket.end();
    });

    socket.on("error", (error) => {
      logger.info("[PROXY] TLS socket error: ", error);
      socket.end();
    });

    socket.on("end", () => {
      this.tlsSockets = this.tlsSockets.filter((tlsSocket) => tlsSocket !== socket);
      stream.end();
    });

    socket.on("session", (session) => {
      this.tlsSession = session;
    });

    stream.on("finish", () => {
      logger.info("[PROXY] request ended");
      socket.end();
    });
  }

  disconnect() {
    this.ws?.close();
  }
}
