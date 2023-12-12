import * as k8s from "@kubernetes/client-node";
import got from "got";
import {
  applyBoredAgentYml,
  fetchBoredAgentYml,
  getConfig,
} from "./updater-yml";

/**
 * bored-agent updater.
 * Can be executed as a CronJob to check for updates to bored-agent.yml manifest.
 * The manifest is applied to the cluster.
 */
async function update() {
  const config = getConfig();
  const kc = new k8s.KubeConfig();

  kc.loadFromCluster();

  console.log("Updating bored-agent");
  const boredAgentYml = await fetchBoredAgentYml(config, got);

  await applyBoredAgentYml(kc, boredAgentYml);
}

update().then(
  () => {
    console.log("bored-agent.yml applied");
  },
  (error) => {
    console.log("bored-agent update error:");
    console.error(error);
  }
);
