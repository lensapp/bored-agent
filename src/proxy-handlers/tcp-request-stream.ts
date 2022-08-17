import { Stream } from "bored-mplex";
import { createCipheriv, createDecipheriv } from "crypto";
import { createConnection } from "net";
import { Logger } from "../logger";
import { StreamParser } from "../stream-parser";
import { registerCommonSocketStreamEvents } from "./register-common-socket-stream-events";

interface Dependencies {
  createConnection: typeof createConnection;
  logger: Logger
}

export function tcpRequestStream(privateKey: string, cipherAlgorithm: string, stream: Stream, host: string, port: number, deps: Dependencies) {
  const { logger, createConnection } = deps;
  const socket = createConnection(port, host, () => {
    const parser = new StreamParser();

    parser.bodyParser = (key: Buffer, iv: Buffer) => {
      const decipher = createDecipheriv(cipherAlgorithm, key, iv);
      const cipher = createCipheriv(cipherAlgorithm, key, iv);

      parser.pipe(decipher).pipe(socket).pipe(cipher).pipe(stream);
    };

    parser.privateKey = privateKey;

    try {
      stream.pipe(parser);
    } catch (error) {
      logger.error("[STREAM PARSER] failed to parse stream %s", error);
      stream.end();
    }
  });

  registerCommonSocketStreamEvents(socket, stream, { logger });
}
