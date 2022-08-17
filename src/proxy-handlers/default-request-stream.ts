import { Stream } from "bored-mplex";
import { createCipheriv, createDecipheriv } from "crypto";
import * as tls from "tls";
import { Logger } from "../logger";
import { StreamImpersonator } from "../stream-impersonator";
import { StreamParser } from "../stream-parser";

interface Options {
  host: string;
  port: number;
  cipherAlgorithm: string;
  serviceAccountToken?: Buffer;
  idpPublicKey: string;
  boredServer: string;
  privateKey: string;
  caCert?: Buffer;
}

interface Dependencies {
  logger: Logger;
  connect: typeof tls.connect,
  tlsSession: {
    get: () => Buffer | undefined,
    set: (session: Buffer) => void,
  }
  tlsSockets: {
    get: () => tls.TLSSocket[],
    push: (socket: tls.TLSSocket) => void,
    replace: (sockets: tls.TLSSocket[]) => void,
  };
}

export function defaultRequestStream(stream: Stream, opts: Options, deps: Dependencies) {
  const { 
    host, 
    port, 
    cipherAlgorithm,
    serviceAccountToken,
    idpPublicKey,
    boredServer,
    privateKey,
    caCert
  } = opts;
  const { tlsSession, tlsSockets, logger, connect } = deps;
  const connectionOptions: tls.ConnectionOptions = {
    host,
    port,
    timeout: 1_000 * 60 * 30 // 30 minutes
  };

  if (caCert) {
    connectionOptions.ca = caCert;
  } else {
    connectionOptions.rejectUnauthorized = false;

    connectionOptions.checkServerIdentity = () => {
      return undefined;
    };
  }

  if (tlsSession.get()) {
    connectionOptions.session = tlsSession.get();
  }

  const socket = connect(connectionOptions, () => {
    tlsSockets.push(socket);
    const parser = new StreamParser();

    parser.bodyParser = (key: Buffer, iv: Buffer) => {
      const decipher = createDecipheriv(cipherAlgorithm, key, iv);
      const cipher = createCipheriv(cipherAlgorithm, key, iv);

      if (serviceAccountToken && idpPublicKey !== "") {
        const streamImpersonator = new StreamImpersonator();

        streamImpersonator.publicKey = idpPublicKey;
        streamImpersonator.boredServer = boredServer;
        streamImpersonator.saToken = serviceAccountToken.toString();
        parser.pipe(decipher).pipe(streamImpersonator).pipe(socket).pipe(cipher).pipe(stream);
      } else {
        parser.pipe(decipher).pipe(socket).pipe(cipher).pipe(stream);
      }
    };

    parser.privateKey = privateKey;

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
    tlsSockets.replace(tlsSockets.get().filter((tlsSocket) => tlsSocket !== socket));
    stream.end();
  });

  socket.on("session", (session) => {
    tlsSession.set(session);
  });

  stream.on("finish", () => {
    logger.info("[PROXY] request ended");
    socket.end();
  });
}
