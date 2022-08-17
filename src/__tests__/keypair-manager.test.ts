import { getDi } from "../get-di";
import k8sClientInjectable from "../k8s-client.injectable";
import { KeyPairManager } from "../keypair-manager";

describe("KeyPairManager", () => {
  describe("generateKeys", () => {
    it("generates keys", async () => {
      const di = getDi();
      const manager = new KeyPairManager("default", di.inject(k8sClientInjectable));

      const keys = await manager.generateKeys();

      expect(keys.private).toBeTruthy();
      expect(keys.public).toBeTruthy();
    });
  });
});
