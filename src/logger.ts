import pino from "pino";

export const logLevel = process.env.LOG_LEVEL || "info";

const logger = pino({
  level: logLevel,
  transport: {
    target: "pino-pretty",
    options: {
      ignore: "pid,hostname",
      translateTime: true
    },
  },
});

export default logger;
