import { getInjectable } from "@ogre-tools/injectable";
import { createConnection } from "net";

const createConnectionInjectable = getInjectable({
  id: "create-connection",
  instantiate: () => createConnection
});

export default createConnectionInjectable;
