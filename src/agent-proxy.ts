import WebSocket from "ws";
import { Server } from "yamux-js";
import type { Duplex } from "stream";
import * as tls from "tls";
import * as fs from "fs";

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

  constructor(opts: AgentProxyOptions) {
    this.tunnelServer = opts.tunnelServer;

    if (fs.existsSync(caCert)) {
      this.caCert = fs.readFileSync(caCert);
    }
  }

  connect() {
    console.log("establishing reverse tunnel ...");
    let retryTimeout: NodeJS.Timeout;

    this.ws = new WebSocket(this.tunnelServer);
    this.ws.on("open", () => {
      if (!this.ws) return;

      console.log("tunnel connection opened");
      this.yamuxServer = new Server(this.handleRequestStream.bind(this));

      this.yamuxServer.on("error", (error) => {
        console.error("yamux server error", error);
      });

      const wsDuplex = WebSocket.createWebSocketStream(this.ws);

      this.yamuxServer.pipe(wsDuplex).pipe(this.yamuxServer);
    });

    const retry = () => {
      clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        this.connect();
      }, 1000);
    };

    this.ws.on("error", () => {
      retry();
    });
    this.ws.on("unexpected-response", () => {
      retry();
    });
    this.ws.on("close", () => {
      console.log("tunnel connection closed ...");
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
