import WebSocket from "ws";
import * as tls from "tls";
import * as fs from "fs";
import { createDecipheriv, createCipheriv } from "crypto";
import { KeyPair } from "./keypair-manager";
import { StreamParser } from "./stream-parser";
import { StreamImpersonator } from "./stream-impersonator";
import logger from "./logger";
import { BoredMplex, Stream } from "bored-mplex";

export type AgentProxyOptions = {
  boredServer: string;
  boredToken: string;
  idpPublicKey: string;
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
      logger.info(`[PROXY] ${this.tlsSockets.length} active sockets`);
    }, 10_000);
  }

  connect(reconnect = false) {
    if (!reconnect) logger.info(`[PROXY] establishing reverse tunnel to ${this.boredServer} ...`);

    this.ws = new WebSocket(`${this.boredServer}/agent/connect`, {
      headers: {
        "Authorization": `Bearer ${this.boredToken}`,
        "X-BoreD-PublicKey": Buffer.from(this.keys?.public || "").toString("base64")
      }
    });
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

  protected closeTlsSockets() {
    this.tlsSockets.forEach((socket) => {
      try {
        socket.end();
      } catch (error) {
        logger.error(`[PROXY] failed to close socket: %s`, error);
      }
    });
  }

  handleRequestStream(stream: Stream) {
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
