import pino from "pino";

const logger = pino({
  prettyPrint: {
    ignore: "pid,hostname",
    translateTime: true
  }
});

export default logger;
