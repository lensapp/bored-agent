import { KubeConfig, CoreV1Api, V1Secret, PatchUtils } from "@kubernetes/client-node";
import { generateKeyPair } from "crypto";

export type SelfSignedCerts = {
  private: string;
  public: string;
};

const certSecretName = process.env.CERT_SECRET || "bored-agent-cert";
const namespace = process.env.NAMESPACE;

export class CertManager {
  private kubeConfig: KubeConfig;

  constructor() {
    this.kubeConfig = new KubeConfig();
    this.kubeConfig.loadFromCluster();
  }

  async ensureCerts(): Promise<SelfSignedCerts> {
    if (!namespace) {
      throw new Error("cannot resolve pod namespace");
    }

    let secret: {
      body: V1Secret;
    };
    const apiClient = this.kubeConfig.makeApiClient(CoreV1Api);

    try {
      secret = await apiClient.readNamespacedSecret(certSecretName, namespace);
    } catch(err) {
      throw new Error("failed to read cert secret");
    }

    if (!secret) {
      throw new Error(`cannot find secret: ${certSecretName}`);
    }

    const privateKey = secret.body.data?.["private"] || "";
    const publicKey = secret.body.data?.["public"] || "";

    if (privateKey !== "" && publicKey !== "") {
      return {
        private: Buffer.from(privateKey, "base64").toString("utf-8"),
        public: Buffer.from(publicKey, "base64").toString("utf-8")
      };
    }

    const pems = await this.generateKeys();
    const patch = [
      {
        "op": "replace",
        "path":"/data",
        "value": {
          "private": Buffer.from(pems.private).toString("base64"),
          "public": Buffer.from(pems.public).toString("base64")
        }
      }
    ];

    apiClient.patchNamespacedSecret(certSecretName, namespace, patch, undefined, undefined, undefined, undefined, {
      "headers": { "Content-type": PatchUtils.PATCH_FORMAT_JSON_PATCH }
    });

    return pems;
  }

  async generateKeys(): Promise<SelfSignedCerts> {
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
