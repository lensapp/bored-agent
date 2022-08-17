import { getInjectable } from "@ogre-tools/injectable";
import { existsSync } from "fs";

const existsSyncInjectable = getInjectable({
  id: "exists-sync",
  instantiate: () => existsSync
});

export default existsSyncInjectable;
