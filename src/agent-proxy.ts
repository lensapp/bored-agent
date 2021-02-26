import WebSocket from "ws";
import { Server } from "yamux-js";
import type { Duplex } from "stream";
import * as tls from "tls";
import * as fs from "fs";
import { SelfSignedCerts } from "./cert-manager";

export type AgentProxyOptions = {
  tunnelServer: string;
};

const caCert = process.env.CA_CERT || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

export class AgentProxy {
  private tunnelServer: string;
  private yamuxServer?: Server;
  private ws?: WebSocket;
  private caCert?: Buffer;
  private tlsSession?: Buffer;
  private certs?: SelfSignedCerts;

  constructor(opts: AgentProxyOptions) {
    this.tunnelServer = opts.tunnelServer;

    if (fs.existsSync(caCert)) {
      this.caCert = fs.readFileSync(caCert);
    }
  }

  init(certs: SelfSignedCerts) {
    this.certs = certs;
  }

  connect(reconnect = false) {
    if (!reconnect) console.log(`PROXY: establishing reverse tunnel to ${this.tunnelServer} ...`);
    let retryTimeout: NodeJS.Timeout;
    let connected = false;

    this.ws = new WebSocket(this.tunnelServer, {
      headers: {
        "X-BoreD-PublicKey": Buffer.from(this.certs?.public || "").toString("base64")
      }
    });
    this.ws.on("open", () => {
      if (!this.ws) return;

      console.log("PROXY: tunnel connection opened");
      connected = true;
      this.yamuxServer = new Server(this.handleRequestStream.bind(this));

      this.yamuxServer.on("error", (error) => {
        console.error("YAMUX: server error", error);
      });

      const wsDuplex = WebSocket.createWebSocketStream(this.ws);

      this.yamuxServer.pipe(wsDuplex).pipe(this.yamuxServer);
    });

    const retry = () => {
      clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        this.connect(true);
      }, 1000);
    };

    this.ws.on("error", () => {
      retry();
    });
    this.ws.on("unexpected-response", () => {
      retry();
    });
    this.ws.on("close", () => {
      if (connected) console.log("PROXY: tunnel connection closed...");
      retry();
    });
  }

  handleRequestStream(stream: Duplex) {
    const opts: tls.ConnectionOptions = {
      host: process.env.KUBERNETES_HOST || "kubernetes.default.svc",
      port: parseInt(process.env.KUBERNETES_PORT || "443")
    };

    if (this.caCert) {
      opts.ca = this.caCert;
    } else {
      opts.rejectUnauthorized = false;

      opts.checkServerIdentity = (host, cert) => {
        return undefined;
      };
    }

    if (this.tlsSession) {
      opts.session = this.tlsSession;
    }

    const socket = tls.connect(opts, () => {
      console.log("connected to k8s api");
      stream.pipe(socket).pipe(stream);
    });

    socket.on("session", (session) => {
      this.tlsSession = session;
    });


    stream.on("end", () => {
      console.log("request ended");
      socket.end();
    });
  }

  disconnect() {
    this.ws?.close();
  }
}
