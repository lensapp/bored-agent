import { getInjectable } from "@ogre-tools/injectable";
import { readFileSync } from "fs";

const readFileSyncInjectable = getInjectable({
  id: "read-file-sync",
  instantiate: () => readFileSync
});

export default readFileSyncInjectable;
