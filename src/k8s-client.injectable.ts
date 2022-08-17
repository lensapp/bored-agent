import { getInjectable } from "@ogre-tools/injectable";
import gotInjectable from "./got.injectable";
import { K8sClient } from "./k8s-client";
import readFileInjectable from "./read-file.injectable";

const k8sClientInjectable = getInjectable({
  id: "k8s-client",
  instantiate: (di) => {
    return new K8sClient({
      got: di.inject(gotInjectable),
      readFile: di.inject(readFileInjectable)
    });
  }
});

export default k8sClientInjectable;
