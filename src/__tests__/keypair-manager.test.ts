import { KeyPairManager } from "../keypair-manager";
import { ServiceAccountTokenProvider } from "../service-account-token";

describe("KeyPairManager", () => {
  describe("generateKeys", () => {
    it("generates keys", async () => {
      const serviceAccountTokenProviderMock = {
        getSaToken: () => "service-account-token"
      } as ServiceAccountTokenProvider;
      const manager = new KeyPairManager("default", serviceAccountTokenProviderMock);

      const keys = await manager.generateKeys();

      expect(keys.private).toBeTruthy();
      expect(keys.public).toBeTruthy();
    });
  });
});
