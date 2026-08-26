import { BuildInfoSchema, type BuildInfo } from "@flowdesk/contracts";

export async function getBuildInfo(fetcher: typeof fetch = fetch): Promise<BuildInfo> {
  const response = await fetcher("/api/v1/system/build");
  if (!response.ok) throw new Error(`API health request failed with ${response.status}`);
  return BuildInfoSchema.parse(await response.json());
}
