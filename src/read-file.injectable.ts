import { getInjectable } from "@ogre-tools/injectable";
import { readFile } from "fs/promises";

const readFileInjectable = getInjectable({
  id: "read-file",
  instantiate: () => readFile
});

export default readFileInjectable;
