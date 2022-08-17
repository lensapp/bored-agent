import { getInjectable } from "@ogre-tools/injectable";
import logger from "./logger";

const loggerInjectable = getInjectable({
  id: "logger",
  instantiate: () => logger
});

export default loggerInjectable;
