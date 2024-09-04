import { generateKeyPair } from "crypto";
import { K8sClient } from "./k8s-client";
import { ServiceAccountTokenProvider } from "./service-account-token";

export type KeyPair = {
  private: string;
  public: string;
};

const certSecretName = process.env.CERT_SECRET || "bored-agent-cert";

export type Secret = {
  kind: string,
  apiVersion: string,
  metadata: {
    namespace: string,
    name: string
  },
  data: {
    private?: string,
    public?: string
  }
};

export class KeyPairManager {
  private namespace: string;
  private apiClient: K8sClient;

  constructor(namespace: string, serviceAccountTokenProvider: ServiceAccountTokenProvider, client?: K8sClient) {
    this.namespace = namespace;
    this.apiClient = client ?? new K8sClient(serviceAccountTokenProvider);
  }

  protected async fetchExistingKeys(): Promise<KeyPair> {
    let secret: Secret;

    try {
      secret = await this.apiClient.get<Secret>(`/api/v1/namespaces/${this.namespace}/secrets/${certSecretName}`);
    } catch(err) {
      throw new Error(`failed to read cert secret: ${err}`);
    }

    if (!secret) {
      throw new Error(`cannot find secret: ${certSecretName}`);
    }

    const privateKey = secret.data?.["private"] || "";
    const publicKey = secret.data?.["public"] || "";

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

    return this.apiClient.patch(`/api/v1/namespaces/${this.namespace}/secrets/${certSecretName}`, patch, {
      "Content-Type": "application/json-patch+json"
    });
  }

  async ensureKeys(): Promise<KeyPair> {
    await this.apiClient.init();
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
