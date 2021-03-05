import { KubeConfig, CoreV1Api, V1Secret, PatchUtils } from "@kubernetes/client-node";
import { generateKeyPair } from "crypto";

export type KeyPair = {
  private: string;
  public: string;
};

const certSecretName = process.env.CERT_SECRET || "bored-agent-cert";

export class KeyPairManager {
  private kubeConfig: KubeConfig;
  private namespace: string;
  private apiClient: CoreV1Api;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.kubeConfig = new KubeConfig();
    this.kubeConfig.loadFromCluster();
    this.apiClient = this.kubeConfig.makeApiClient(CoreV1Api);
  }

  protected async fetchExistingKeys(): Promise<KeyPair> {
    let secret: {
      body: V1Secret;
    };

    try {
      secret = await this.apiClient.readNamespacedSecret(certSecretName, this.namespace);
    } catch(err) {
      throw new Error("failed to read cert secret");
    }

    if (!secret) {
      throw new Error(`cannot find secret: ${certSecretName}`);
    }

    const privateKey = secret.body.data?.["private"] || "";
    const publicKey = secret.body.data?.["public"] || "";

    return {
      private: privateKey,
      public: publicKey
    };
  }

  protected async storeKeys(keys: KeyPair) {
    const patch = [
      {
        "op": "replace",
        "path":"/data",
        "value": {
          "private": Buffer.from(keys.private).toString("base64"),
          "public": Buffer.from(keys.public).toString("base64")
        }
      }
    ];

    return this.apiClient.patchNamespacedSecret(certSecretName, this.namespace, patch, undefined, undefined, undefined, undefined, {
      "headers": { "Content-type": PatchUtils.PATCH_FORMAT_JSON_PATCH }
    });
  }

  async ensureKeys(): Promise<KeyPair> {
    const existingKeys = await this.fetchExistingKeys();

    if (existingKeys.private !== "" && existingKeys.public !== "") {
      return {
        private: Buffer.from(existingKeys.private, "base64").toString("utf-8"),
        public: Buffer.from(existingKeys.public, "base64").toString("utf-8")
      };
    }

    const keys = await this.generateKeys();

    await this.storeKeys(keys);

    return keys;
  }

  async generateKeys(): Promise<KeyPair> {
    return new Promise((resolve, reject) => {
      generateKeyPair("rsa", {
        modulusLength: 4096
      }, (err, publicKey, privateKey) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            public: publicKey.export({ type: "pkcs1", format: "pem"}).toString(),
            private: privateKey.export({ type: "pkcs1", format: "pem"}).toString()
          });
        }
      });
    });
  }
}
