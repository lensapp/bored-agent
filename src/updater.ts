import * as k8s from "@kubernetes/client-node";
import type { KubeConfig } from "@kubernetes/client-node";
import got from "got";

/**
 * bored-agent updater.
 * Can be executed as a CronJob to check for updates to bored-agent.yml manifest.
 * The manifest is applied to the cluster.
 */

/**
 * Replicate the functionality of `kubectl apply`.  That is, create the resources defined in the `specString` if they do
 * not exist, patch them if they do exist.
 * Based on https://github.com/kubernetes-client/javascript/blob/master/examples/typescript/apply/apply-example.ts
 *
 * @param kc Kubeconfig to use
 * @param specString YAML Kubernetes spec file as string
 * @return Array of resources created
 */
async function applyBoredAgentYml(kc: KubeConfig, specString: string): Promise<k8s.KubernetesObject[]> {
  console.log("Applying bored-agent.yml...");
  const client = k8s.KubernetesObjectApi.makeApiClient(kc);
  const specs = k8s.loadAllYaml(specString) as k8s.KubernetesObject[] ;
  const validSpecs = specs.filter((spec) => spec && spec.kind && spec.metadata);
  const created: k8s.KubernetesObject[] = [];

  for (const spec of validSpecs) {
    // This is to convince the old version of TypeScript that metadata exists even though we already filtered specs
    // without metadata out
    spec.metadata = spec.metadata || {};
    spec.metadata.annotations = spec.metadata.annotations || {};
    delete spec.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"];
    spec.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"] = JSON.stringify(spec);

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

function getConfig() {
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

    // e.g. "https://api.k8slens.dev"
    LENS_BACKEND_URL: process.env.LENS_BACKEND_URL
  };

  const missingConfiguration = Object.entries(config).find(([, value]) => !value);

  if (missingConfiguration) {
    throw new Error(`Environment variable ${missingConfiguration[0]} not set`);
  }

  return config;
}

type Config = ReturnType<typeof getConfig>;

async function fetchBoredAgentYml(config: Config) {
  const url = `${config.LENS_BACKEND_URL}/bored-agent/v2/bored-agent.yml`;

  console.log(`Fetching bored-agent.yml from ${url}`);

  const response = await got(url,
    {
      retry: {
        limit: 5
      }
    }
  );

  if (!(response?.body && typeof response?.body === "string")) {
    throw new Error();
  }

  const yml = response.body
    .replaceAll("$BORED_SERVER", `'${config.BORED_SERVER}'`)
    .replaceAll("$BORED_TOKEN", `'${config.BORED_TOKEN}'`)
    .replaceAll("$LENS_PLATFORM_K8S_CLUSTER_ID", `'${config.LENS_PLATFORM_K8S_CLUSTER_ID}'`)
    .replaceAll("$LENS_PLATFORM_SPACE_NAME", `'${config.LENS_PLATFORM_SPACE_NAME}'`)
    .replaceAll("$LENS_BACKEND_URL", `'${config.LENS_BACKEND_URL}'`);

  return yml;
}

async function update() {
  const config = getConfig();
  const kc = new k8s.KubeConfig();

  kc.loadFromCluster();

  console.log("Updating bored-agent");
  const boredAgentYml = await fetchBoredAgentYml(config);

  await applyBoredAgentYml(kc, boredAgentYml);
}

update().then(() => {
  console.log("bored-agent.yml applied");
}, error => {
  console.log("bored-agent update error:");
  console.error(error);
});
