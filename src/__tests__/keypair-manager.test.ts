import { KeyPairManager } from "../keypair-manager";

describe("KeyPairManager", () => {
  describe("generateKeys", () => {
    it("generates keys", async () => {
      const manager = new KeyPairManager("default");

      const keys = await manager.generateKeys();

      expect(keys.private).toBeTruthy();
      expect(keys.public).toBeTruthy();
    });
  });
});
