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
import { kubernetesPort, kubernetesHost } from "./k8s-client";
import { ServiceAccountTokenProvider } from "./service-account-token";

export type AgentProxyOptions = {
  boredServer: string;
  boredToken: string;
  idpPublicKey: string;
};

export type AgentProxyDependencies = {
  tlsConnect: typeof tls.connect;
  fileExists: typeof fs.existsSync;
  readFile: typeof fs.readFileSync;
};

export type StreamHeader = {
  target: string;
  encrypted: boolean;
};

const caCert = process.env.CA_CERT || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

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
  private tlsSockets: tls.TLSSocket[] = [];
  private serviceAccountTokenProvider: ServiceAccountTokenProvider;
  private dependencies: AgentProxyDependencies;

  constructor(
    opts: AgentProxyOptions,
    serviceAccountTokenProvider: ServiceAccountTokenProvider,
    dependencies: AgentProxyDependencies = { 
      tlsConnect: tls.connect,
      fileExists: fs.existsSync,
      readFile: fs.readFileSync,
    }
  ) {
    this.boredServer = opts.boredServer;
    this.boredToken = opts.boredToken;
    this.idpPublicKey = opts.idpPublicKey;
    this.dependencies = dependencies;

    if (this.dependencies.fileExists(caCert)) {
      this.caCert = this.dependencies.readFile(caCert);
    }

    this.serviceAccountTokenProvider = serviceAccountTokenProvider;
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

      wsDuplex.on("error", (error) => {
        // wsDuplex may emit error when data is being written to the websocket which is already closing.
        // In these cases we ignore the error as ws will retry on "close" event.
        if (!String(error?.message).includes("WebSocket is not open")) {
          throw error;
        } else {
          logger.warn("[PROXY] Duplex stream error: WebSocket is not open.");
        }
      });

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
      let protocol = "";
      let encrypted = true;
      let header: StreamHeader;

      try {
        header = JSON.parse(data.toString()) as StreamHeader;
        encrypted = !!header?.encrypted;
        protocol = header?.target?.split("://")[0];
      } catch (error) {
        logger.error("[PROXY] invalid stream open data: %o", error);
        stream.end();

        return;
      }


      switch(protocol) {
        case "unix": {
          this.handleUnixRequestStream(stream, header.target.replace("unix://", ""), encrypted);
          break;
        }

        case "tcp": {
          const url = new URL(header.target);

          this.handleTcpRequestStream(stream, url.hostname, parseInt(url.port), encrypted);
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

  handleTcpRequestStream(stream: Stream, host: string, port: number, decrypt = true) {
    const socket = net.createConnection(port, host, () => {
      if (decrypt) {
        this.decryptAndPipeStream(stream, socket);
      } else {
        stream.pipe(socket).pipe(stream);
      }
    });

    this.registerCommonSocketStreamEvents(socket, stream);
  }

  handleUnixRequestStream(stream: Stream, socketPath: string, decrypt = true) {
    const socket = net.createConnection(socketPath, () => {
      if (decrypt) {
        this.decryptAndPipeStream(stream, socket);
      } else {
        stream.pipe(socket).pipe(stream);
      }
    });

    this.registerCommonSocketStreamEvents(socket, stream);
  }

  private decryptAndPipeStream(stream: Stream, socket: net.Socket) {
    const parser = new StreamParser();

    parser.bodyParser = (key: Buffer, iv: Buffer) => {
      const decipher = createDecipheriv(this.cipherAlgorithm, key, iv);
      const cipher = createCipheriv(this.cipherAlgorithm, key, iv);

      parser.pipe(decipher).pipe(socket).pipe(cipher).pipe(stream);
    };

    parser.privateKey = this.keys?.private || "";

    try {
      stream.pipe(parser);
    } catch (error) {
      logger.error("[STREAM PARSER] failed to parse stream %s", error);
      stream.end();
    }
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
    const opts: tls.ConnectionOptions = {
      host: kubernetesHost,
      port: kubernetesPort,
      timeout: 1_000 * 60 * 30 // 30 minutes
    };

    if (this.caCert) {
      opts.ca = this.caCert;
    }

    if (this.tlsSession) {
      opts.session = this.tlsSession;
    }

    const socket = this.dependencies.tlsConnect(opts, () => {
      this.tlsSockets.push(socket);
      const parser = new StreamParser();

      parser.bodyParser = (key: Buffer, iv: Buffer) => {
        const decipher = createDecipheriv(this.cipherAlgorithm, key, iv);
        const cipher = createCipheriv(this.cipherAlgorithm, key, iv);

        if (this.serviceAccountTokenProvider.getSaToken() && this.idpPublicKey !== "") {
          const streamImpersonator = new StreamImpersonator(() => this.serviceAccountTokenProvider.getSaToken() as string);

          streamImpersonator.publicKey = this.idpPublicKey;
          streamImpersonator.boredServer = this.boredServer;
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
