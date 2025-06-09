import path from "path";
import { Config, fetchBoredAgentYml } from "../updater-yml";
import fs from "fs";
import { Mock, vi } from "vitest";

describe("updater", () => {
  let config: Config;
  let gotMock: Mock;

  beforeEach(() => {
    config = {
      BORED_SERVER: "some-BORED_SERVER",
      BORED_TOKEN: "some-BORED_TOKEN",
      LENS_PLATFORM_K8S_CLUSTER_ID: "some-LENS_PLATFORM_K8S_CLUSTER_ID",
      LENS_PLATFORM_SPACE_NAME: "some-LENS_PLATFORM_SPACE_NAME",
      NAMESPACE: "some-NAMESPACE",
      AUTO_UPDATE_URL: "https://some-url.irrelevant/some-file-path",
      LENS_BACKEND_URL: "https://some-url.irrelevant/",
      HTTPS_PROXY: "some-HTTPS_PROXY",
      BORED_HTTPS_PROXY: "some-BORED_HTTPS_PROXY",
    };

    const mockData = fs.readFileSync(
      path.join(__dirname, "./updater-mock.yml")
    );

    gotMock = vi.fn().mockResolvedValue({ body: mockData.toString() });
  });

  it("parses yaml", async () => {
    const result = await fetchBoredAgentYml(config, gotMock as any);

    expect(result).toMatchSnapshot();
  });
});
