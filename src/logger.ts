import pino, { LogFn } from "pino";

const logger = pino({
  prettyPrint: {
    ignore: "pid,hostname",
    translateTime: true
  }
});

export interface Logger {
  info: LogFn,
  error: LogFn,
}

export default logger;
