import * as k8s from "@kubernetes/client-node";
import * as selfsigned from "selfsigned";

export type SelfSignedCerts = {
  private: string;
  public: string;
};

const certSecretName = process.env.CERT_SECRET || "heliograph-agent-cert";
const namespace = process.env.NAMESPACE;

export class CertManager {
  private kubeClient: k8s.KubeConfig;

  constructor() {
    this.kubeClient = new k8s.KubeConfig();
    this.kubeClient.loadFromDefault();
  }

  async ensureCerts(): Promise<SelfSignedCerts> {
    if (!namespace) {
      throw new Error("cannot resolve pod namespace");
    }

    let secret: {
      body: k8s.V1Secret;
    };
    const apiClient = this.kubeClient.makeApiClient(k8s.CoreV1Api);

    try {
      secret = await apiClient.readNamespacedSecret(certSecretName, namespace);
    } catch(err) {
      console.error(err);
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

    const pems: SelfSignedCerts = selfsigned.generate([], { days: 3650 });

    apiClient.patchNamespacedSecret(certSecretName, namespace, {
      data: {
        "private": Buffer.from(pems.private).toString("base64"),
        "public": Buffer.from(pems.public).toString("base64")
      }
    });


    return pems;
  }
}
