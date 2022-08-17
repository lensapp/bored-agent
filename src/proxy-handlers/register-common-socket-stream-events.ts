import { Stream } from "bored-mplex";
import { Socket } from "net";
import { Logger } from "../logger";

interface Dependencies {
  logger: Logger
}

export function registerCommonSocketStreamEvents(socket: Socket, stream: Stream, deps: Dependencies) {
  const { logger } = deps;

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
