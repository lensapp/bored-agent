import { getInjectable } from "@ogre-tools/injectable";
import got from "got";

const gotInjectable = getInjectable({
  id: "got",
  instantiate: () => got
});

export default gotInjectable;
