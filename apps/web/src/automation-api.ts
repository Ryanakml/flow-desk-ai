interface EmergencyStopResponse {
  organizationId: string;
  emergencyDisabled: boolean;
  triggeredAt: string;
}

async function problemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.title === "string") return body.title;
  } catch {
    // fall through to status text
  }
  return response.statusText || `Request failed with ${response.status}`;
}

export async function setAutomationEmergencyStop(
  orgId: string,
  enabled: boolean,
  fetcher: typeof fetch = fetch
): Promise<EmergencyStopResponse> {
  const response = await fetcher(`/api/v1/organizations/${orgId}/bot/emergency-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error(await problemDetail(response));
  return (await response.json()) as EmergencyStopResponse;
}
