import * as k8s from "@kubernetes/client-node";
import type { KubeConfig, KubernetesObject, V1ObjectMeta } from "@kubernetes/client-node";
import type { Got } from "got";
import isUrl from "is-url";
import yaml, { Scalar } from "yaml";

/**
 * KubernetesObject with metadata.name as required field, as opposed to the V1ObjectMeta interface
 * which has them as optional fields. KubernetesObjectHeader requires non optional field for name.
 * KubernetesObjectApi.read takes KubernetesObjectHeader as input.
 *
 * @see https://github.com/kubernetes-client/javascript/issues/367#issuecomment-2322098513
 */
export type KubernetesObjectWithMetadata = KubernetesObject & {
  metadata: V1ObjectMeta & {
    name: string;
  };
};

/**
 * Replicate the functionality of `kubectl apply`.  That is, create the resources defined in the `specString` if they do
 * not exist, patch them if they do exist.
 * Based on https://github.com/kubernetes-client/javascript/blob/master/examples/typescript/apply/apply-example.ts
 *
 * @param kc Kubeconfig to use
 * @param specString YAML Kubernetes spec file as string
 * @return Array of resources created
 */
export async function applyBoredAgentYml(
  kc: KubeConfig,
  specString: string
): Promise<k8s.KubernetesObject[]> {
  console.log("Applying bored-agent.yml...");
  const client = k8s.KubernetesObjectApi.makeApiClient(kc);
  const specs = k8s.loadAllYaml(specString) as KubernetesObjectWithMetadata[];
  const validSpecs = specs.filter((spec) => spec && spec.kind && spec.metadata);
  const created: k8s.KubernetesObject[] = [];

  for (const spec of validSpecs) {
    // This is to convince the old version of TypeScript that metadata exists even though we already filtered specs
    // without metadata out
    spec.metadata = spec.metadata || {};
    spec.metadata.annotations = spec.metadata.annotations || {};
    delete spec.metadata.annotations[
      "kubectl.kubernetes.io/last-applied-configuration"
    ];
    spec.metadata.annotations[
      "kubectl.kubernetes.io/last-applied-configuration"
    ] = JSON.stringify(spec);

    try {
      // Try to get the resource, if it does not exist an error will be thrown and we will end up in the catch
      // block.
      await client.read(spec);
      // We got the resource, so it exists, so patch it
      const response = await client.patch(spec);

      created.push(response.body);
    } catch (e: any) {
      // We did not get the resource, so it does not exist, so create it
      const response = await client.create(spec);

      created.push(response.body);
    }
  }

  return created;
}

export function getConfig() {
  const config = {
    // e.g. "https://eu.bored.lc-staging1.staging-k8slens.cloud/0a0ad578-fc03-47fa-b5d0-61c9aa02615b"
    BORED_SERVER: process.env.BORED_SERVER,

    // e.g. "eyJhbGciOiJSUzI1NiJ9.eyJpY..."
    BORED_TOKEN: process.env.BORED_TOKEN,

    // e.g. "dfe42777-5254-4ffe-8f12-d00665d292c1"
    LENS_PLATFORM_K8S_CLUSTER_ID: process.env.LENS_PLATFORM_K8S_CLUSTER_ID,

    // e.g. "foo-bar"
    LENS_PLATFORM_SPACE_NAME: process.env.LENS_PLATFORM_SPACE_NAME,

    // e.g. "lens-platform"
    NAMESPACE: process.env.NAMESPACE,

    // e.g. "https://api.k8slens.dev/bored-agent/v2/bored-agent.yml"
    AUTO_UPDATE_URL: process.env.AUTO_UPDATE_URL,

    /**
    @deprecated Will be removed in favor of AUTO_UPDATE_URL
    e.g. "https://api.k8slens.dev"
    */
    LENS_BACKEND_URL: process.env.LENS_BACKEND_URL,

    HTTPS_PROXY: process.env.BORED_HTTPS_PROXY,
    BORED_HTTPS_PROXY: process.env.BORED_HTTPS_PROXY,
  };

  return config;
}

export type Config = ReturnType<typeof getConfig>;

const configKeysByPlaceholders: Record<string, keyof Config> = {
  $BORED_SERVER: "BORED_SERVER",
  $BORED_TOKEN: "BORED_TOKEN",
  $LENS_PLATFORM_K8S_CLUSTER_ID: "LENS_PLATFORM_K8S_CLUSTER_ID",
  $LENS_PLATFORM_SPACE_NAME: "LENS_PLATFORM_SPACE_NAME",
  $NAMESPACE: "NAMESPACE",
  $AUTO_UPDATE_URL: "AUTO_UPDATE_URL",
  $LENS_BACKEND_URL: "LENS_BACKEND_URL",
};

// For backwards compatibilty these values added later need to be empty
// instead of having a placeholder to ensure it doesn't break old versions
const configKeysToFillWhenEmpty: (keyof Config)[] = [
  "HTTPS_PROXY",
  "BORED_HTTPS_PROXY",
];

function getBoredAgentUrl(
  AUTO_UPDATE_URL: string | undefined,
  LENS_BACKEND_URL: string | undefined
) {
  const url = isUrl(AUTO_UPDATE_URL ?? "")
    ? (AUTO_UPDATE_URL as string)
    : `${LENS_BACKEND_URL}/bored-agent/v2/bored-agent.yml`;

  return url;
}

function getConfigReplacer(config: Record<string, any>) {
  const placeholders = Object.keys(configKeysByPlaceholders);

  /**
   * Replacer with the shape of JSON.stringify's replacer.
   * The object in which the key was found is provided as the replacer's this context.
   */
  return function configPlaceholderReplacer(
    this: any,
    key: string,
    content: any
  ) {
    if (typeof content === "string" && placeholders.includes(content)) {
      return config[configKeysByPlaceholders[content]];
    }

    if (
      typeof content === "object" &&
      content?.name &&
      content?.value === "" &&
      configKeysToFillWhenEmpty.includes(content.name)
    ) {
      return { ...content, value: config[content.name] };
    }

    return content;
  };
}

export async function fetchBoredAgentYml(config: Config, got: Got) {
  const url = getBoredAgentUrl(config.AUTO_UPDATE_URL, config.LENS_BACKEND_URL);

  console.log(`Fetching bored-agent.yml from ${url}`);

  const response = await got(url, {
    retry: {
      limit: 5,
    },
  });

  if (!(response?.body && typeof response?.body === "string")) {
    throw new Error();
  }

  const replacer = getConfigReplacer(config);

  const documents = yaml.parseAllDocuments(response.body);
  const containsErrors = documents.some(
    (document) =>
      document.errors?.length &&
      document.errors.some((error) => error.name === "YAMLParseError")
  );

  if (containsErrors) {
    throw new Error(
      `Error parsing YAML:\n${JSON.stringify(
        documents.flatMap((document) => document.errors),
        null,
        2
      )}`
    );
  }

  return documents
    .filter(
      ({ contents }) => contents !== null && (contents as Scalar).value !== null
    )
    .map((document) => yaml.stringify(document.toJSON(), replacer))
    .join("\n---\n");
}
