import got from "got";
import * as fs from "fs/promises";
import { ServiceAccountTokenProvider } from "./service-account-token";

export const kubernetesHost = process.env.KUBERNETES_HOST || "kubernetes.default.svc";
export const kubernetesPort = parseInt(process.env.KUBERNETES_SERVICE_PORT || "443");
export const caCert = process.env.CA_CERT || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

export type ErrorResponse = {
  status: number,
  code: number,
  reason: string,
  message: string
};

export class K8sError extends Error {
  response: ErrorResponse;

  constructor(errorResponse: ErrorResponse) {
    super(errorResponse.message);
    this.response = errorResponse;
  }
}

export class K8sClient {
  private caCert = "";
  private serviceAccountTokenProvider: ServiceAccountTokenProvider;

  constructor(serviceAccountTokenProvider: ServiceAccountTokenProvider) {
    this.serviceAccountTokenProvider = serviceAccountTokenProvider;
  }

  getHeaders() {
    return {
      "Authorization": `Bearer ${this.serviceAccountTokenProvider.getSaToken()}`,
      "Accept": "application/json"
    };
  }

  async init() {
    this.caCert = (await fs.readFile(caCert)).toString();
  }

  private getUrl(path: string) {
    return `https://${kubernetesHost}:${kubernetesPort}${path}`;
  }

  async get<T>(path: string, headers = {}): Promise<T> {
    const response = await got.get(this.getUrl(path), {
      headers: {
        ...headers,
        ...this.getHeaders(),
      },
      https: {
        certificateAuthority: this.caCert
      },
      responseType: "json",
      throwHttpErrors: false
    });

    if (response.statusCode !== 200) {
      throw new K8sError(response.body as ErrorResponse);
    }

    return response.body as T;
  }

  async patch<T>(path: string, obj: Object, headers = {}) {
    const response = await got.patch(this.getUrl(path), {
      headers: {
        ...this.getHeaders(),
        ...headers
      },
      https: {
        certificateAuthority: this.caCert
      },
      responseType: "json",
      throwHttpErrors: false,
      json: obj
    });

    if (response.statusCode !== 200) {
      throw new K8sError(response.body as ErrorResponse);
    }

    return response.body as T;
  }
}
