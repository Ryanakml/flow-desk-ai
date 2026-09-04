import React, { useEffect, useState } from "react";
import {
  type DeveloperApiKeyRecord,
  type WebhookSubscriptionClientRecord,
  listApiKeysApi,
  createApiKeyApi,
  revokeApiKeyApi,
  listWebhooksApi,
  createWebhookApi,
  deleteWebhookApi
} from "./api.js";
import {
  type WebhookDeliveryClientRecord,
  type WebhookVerificationStatus,
  listWebhookDeliveriesApi,
  testWebhookApi
} from "./developer-integrations-api.js";

export interface DeveloperSettingsViewProps {
  orgId: string;
  canManage: boolean;
  showToast?: (message: string, type: "success" | "error" | "info") => void;
}

type UiWebhookRecord = WebhookSubscriptionClientRecord & {
  verificationStatus?: WebhookVerificationStatus;
  updatedAt?: string;
};

const CANONICAL_KEY_SCOPES = ["conversation:read", "message:write"] as const;
const DEFAULT_WEBHOOK_EVENTS = ["conversation.created", "message.received"];

function verificationBadgeClass(status: WebhookVerificationStatus): string {
  if (status === "verified") return "bg-green-100 text-green-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function deliveryBadgeClass(status: WebhookDeliveryClientRecord["status"]): string {
  if (status === "delivered") return "bg-green-100 text-green-800";
  if (status === "dead_letter") return "bg-red-100 text-red-800";
  if (status === "failed") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

export function DeveloperSettingsView({
  orgId,
  canManage,
  showToast
}: DeveloperSettingsViewProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"keys" | "webhooks">("keys");

  const [keys, setKeys] = useState<DeveloperApiKeyRecord[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>([...CANONICAL_KEY_SCOPES]);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);

  const [webhooks, setWebhooks] = useState<UiWebhookRecord[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([...DEFAULT_WEBHOOK_EVENTS]);
  const [generatedWebhookSecret, setGeneratedWebhookSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);
  const [loadingDeliveriesWebhookId, setLoadingDeliveriesWebhookId] = useState<string | null>(
    null
  );
  const [deliveriesByWebhook, setDeliveriesByWebhook] = useState<
    Record<string, WebhookDeliveryClientRecord[]>
  >({});

  const [submitting, setSubmitting] = useState(false);

  const fetchKeys = async (): Promise<DeveloperApiKeyRecord[]> => {
    try {
      setLoadingKeys(true);
      const data = await listApiKeysApi(orgId);
      setKeys(data);
      return data;
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to load API keys", "error");
      return [];
    } finally {
      setLoadingKeys(false);
    }
  };

  const fetchWebhooks = async (): Promise<UiWebhookRecord[]> => {
    try {
      setLoadingWebhooks(true);
      const data = (await listWebhooksApi(orgId)) as UiWebhookRecord[];
      setWebhooks(data);
      return data;
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to load webhooks", "error");
      return [];
    } finally {
      setLoadingWebhooks(false);
    }
  };

  const fetchDeliveries = async (webhookId: string): Promise<void> => {
    try {
      setLoadingDeliveriesWebhookId(webhookId);
      const deliveries = await listWebhookDeliveriesApi(orgId, webhookId);
      setDeliveriesByWebhook((current) => ({ ...current, [webhookId]: deliveries }));
    } catch (err) {
      showToast?.(
        err instanceof Error ? err.message : "Failed to load webhook deliveries",
        "error"
      );
    } finally {
      setLoadingDeliveriesWebhookId(null);
    }
  };

  useEffect(() => {
    void fetchKeys();
    void fetchWebhooks();
  }, [orgId]);

  const handleCreateKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!keyName.trim()) return;

    try {
      setSubmitting(true);
      const created = await createApiKeyApi(orgId, {
        name: keyName.trim(),
        scopes: keyScopes
      });
      if (created.rawKey) setGeneratedRawKey(created.rawKey);
      showToast?.("API Key generated successfully", "success");
      setKeyName("");
      setShowKeyModal(false);
      await fetchKeys();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to create API key", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to revoke this API key? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      await revokeApiKeyApi(orgId, keyId);
      showToast?.("API Key revoked", "info");
      await fetchKeys();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to revoke API key", "error");
    }
  };

  const handleCreateWebhook = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!webhookName.trim() || !webhookUrl.trim()) return;

    try {
      setSubmitting(true);
      const created = await createWebhookApi(orgId, {
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        events: webhookEvents
      });
      setGeneratedWebhookSecret({ name: created.name, secret: created.secret });
      showToast?.("Webhook registered. Send a test to verify the endpoint.", "success");
      setWebhookName("");
      setWebhookUrl("");
      setWebhookEvents([...DEFAULT_WEBHOOK_EVENTS]);
      setShowWebhookModal(false);
      await fetchWebhooks();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to register webhook", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestWebhook = async (webhookId: string) => {
    try {
      setTestingWebhookId(webhookId);
      const result = await testWebhookApi(orgId, webhookId);
      showToast?.(`Webhook test queued (${result.eventId}). Waiting for verification…`, "info");

      let verified = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 750));
        const refreshed = await fetchWebhooks();
        const current = refreshed.find((webhook) => webhook.id === webhookId);
        if (current?.verificationStatus === "verified") {
          verified = true;
          break;
        }
        if (current?.verificationStatus === "failed") break;
      }

      await fetchDeliveries(webhookId);
      if (verified) {
        showToast?.("Webhook endpoint verified successfully", "success");
      } else {
        showToast?.("Test queued. Check delivery history for the latest result.", "info");
      }
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to test webhook", "error");
    } finally {
      setTestingWebhookId(null);
    }
  };

  const handleToggleDeliveries = async (webhookId: string) => {
    if (expandedWebhookId === webhookId) {
      setExpandedWebhookId(null);
      return;
    }
    setExpandedWebhookId(webhookId);
    await fetchDeliveries(webhookId);
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!window.confirm("Are you sure you want to delete this webhook subscription?")) return;

    try {
      await deleteWebhookApi(orgId, webhookId);
      showToast?.("Webhook subscription deleted", "info");
      setExpandedWebhookId((current) => (current === webhookId ? null : current));
      await fetchWebhooks();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to delete webhook", "error");
    }
  };

  const toggleScope = (scope: string, checked: boolean) => {
    setKeyScopes((current) =>
      checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((item) => item !== scope)
    );
  };

  const toggleWebhookEvent = (eventName: string, checked: boolean) => {
    setWebhookEvents((current) =>
      checked
        ? Array.from(new Set([...current, eventName]))
        : current.filter((item) => item !== eventName)
    );
  };

  return (
    <div className="developer-settings-container p-6" data-testid="developer-settings-view">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Developer Integrations</h2>
          <p className="text-sm text-gray-500">
            Manage scoped API keys and outbound webhook subscriptions for programmatic integrations.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`btn ${activeTab === "keys" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("keys")}
          >
            API Keys
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "webhooks" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("webhooks")}
          >
            Webhooks
          </button>
        </div>
      </div>

      {generatedRawKey && (
        <div className="card p-4 mb-6 bg-amber-50 border-amber-300 rounded-lg text-amber-900">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-md">Save Your New Secret API Key</h3>
            <button type="button" onClick={() => setGeneratedRawKey(null)}>
              Close ✕
            </button>
          </div>
          <p className="text-xs mb-2">Copy this key now. It will never be displayed again.</p>
          <div className="flex items-center gap-2">
            <code className="p-2 bg-white border rounded font-mono text-sm break-all flex-1">
              {generatedRawKey}
            </code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(generatedRawKey);
                showToast?.("Copied to clipboard!", "info");
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {generatedWebhookSecret && (
        <div className="card p-4 mb-6 bg-amber-50 border-amber-300 rounded-lg text-amber-900">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-md">Save Your Webhook Signing Secret</h3>
            <button type="button" onClick={() => setGeneratedWebhookSecret(null)}>
              Close ✕
            </button>
          </div>
          <p className="text-xs mb-2">
            Signing secret for {generatedWebhookSecret.name}. Copy it now; FlowDesk will only show
            the masked value later.
          </p>
          <div className="flex items-center gap-2">
            <code className="p-2 bg-white border rounded font-mono text-sm break-all flex-1">
              {generatedWebhookSecret.secret}
            </code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(generatedWebhookSecret.secret);
                showToast?.("Webhook signing secret copied", "info");
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {activeTab === "keys" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Scoped API Keys</h3>
            {canManage && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowKeyModal(true)}
              >
                + Generate New API Key
              </button>
            )}
          </div>

          {loadingKeys ? (
            <p className="text-sm text-gray-500">Loading API keys...</p>
          ) : keys.length === 0 ? (
            <div className="card p-8 text-center text-gray-500 border border-dashed rounded-lg">
              <p className="mb-4">No API keys created yet.</p>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowKeyModal(true)}
                >
                  Create your first API key
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="card p-4 border rounded-lg shadow-sm bg-white flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900">{key.name}</h4>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          key.revokedAt
                            ? "bg-red-100 text-red-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {key.revokedAt ? "REVOKED" : "ACTIVE"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-mono mb-1">
                      Prefix: {key.keyPrefix}••••••••
                    </p>
                    <div className="flex gap-1">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canManage && !key.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm text-red-600 hover:text-red-800"
                      onClick={() => void handleRevokeKey(key.id)}
                    >
                      Revoke Key
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "webhooks" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Outbound Webhook Subscriptions</h3>
            {canManage && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowWebhookModal(true)}
              >
                + Register Webhook
              </button>
            )}
          </div>

          {loadingWebhooks ? (
            <p className="text-sm text-gray-500">Loading webhooks...</p>
          ) : webhooks.length === 0 ? (
            <div className="card p-8 text-center text-gray-500 border border-dashed rounded-lg">
              <p className="mb-4">No outbound webhook subscriptions registered yet.</p>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowWebhookModal(true)}
                >
                  Register your first webhook
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((webhook) => {
                const verificationStatus = webhook.verificationStatus ?? "unverified";
                const deliveries = deliveriesByWebhook[webhook.id] ?? [];
                const expanded = expandedWebhookId === webhook.id;
                return (
                  <div key={webhook.id} className="card p-4 border rounded-lg shadow-sm bg-white">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900">{webhook.name}</h4>
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${verificationBadgeClass(
                              verificationStatus
                            )}`}
                          >
                            {verificationStatus.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 font-mono mb-1">{webhook.url}</p>
                        <p className="text-xs text-gray-500 mb-1">
                          Secret: <code className="font-mono">{webhook.secret}</code>
                        </p>
                        <div className="flex gap-1 flex-wrap">
                          {webhook.events.map((eventName) => (
                            <span
                              key={eventName}
                              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
                            >
                              {eventName}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {canManage && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={testingWebhookId === webhook.id}
                            onClick={() => void handleTestWebhook(webhook.id)}
                          >
                            {testingWebhookId === webhook.id ? "Testing…" : "Send Test / Verify"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => void handleToggleDeliveries(webhook.id)}
                        >
                          {expanded ? "Hide Deliveries" : "View Deliveries"}
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm text-red-600 hover:text-red-800"
                            onClick={() => void handleDeleteWebhook(webhook.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div
                        className="mt-4 border-t pt-3"
                        data-testid={`webhook-deliveries-${webhook.id}`}
                      >
                        <h5 className="text-sm font-semibold text-gray-800 mb-2">
                          Delivery History
                        </h5>
                        {loadingDeliveriesWebhookId === webhook.id ? (
                          <p className="text-xs text-gray-500">Loading deliveries...</p>
                        ) : deliveries.length === 0 ? (
                          <p className="text-xs text-gray-500">No delivery attempts yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {deliveries.map((delivery) => (
                              <div
                                key={delivery.id}
                                className="flex justify-between gap-4 text-xs border rounded p-2"
                              >
                                <div>
                                  <div className="font-mono text-gray-800">
                                    {delivery.eventType}
                                  </div>
                                  <div className="text-gray-500">{delivery.eventId}</div>
                                  {delivery.lastError && (
                                    <div className="text-red-600">{delivery.lastError}</div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <span
                                    className={`px-2 py-0.5 rounded-full font-medium ${deliveryBadgeClass(
                                      delivery.status
                                    )}`}
                                  >
                                    {delivery.status}
                                  </span>
                                  <div className="mt-1 text-gray-500">
                                    HTTP {delivery.responseStatusCode ?? "—"} · attempts{" "}
                                    {delivery.attemptCount}/{delivery.maxAttempts}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Generate Developer API Key</h3>
            <form onSubmit={(event) => void handleCreateKey(event)}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Automation Bot"
                  className="w-full p-2 border rounded text-sm"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Permissions / Scopes
                </label>
                <div className="space-y-1 text-sm">
                  {CANONICAL_KEY_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={keyScopes.includes(scope)}
                        onChange={(event) => toggleScope(scope, event.target.checked)}
                      />
                      <span>{scope}</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes("admin")}
                      onChange={(event) => toggleScope("admin", event.target.checked)}
                    />
                    <span>admin (Full Access)</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => setShowKeyModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary text-sm">
                  {submitting ? "Generating..." : "Generate Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWebhookModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Register Outbound Webhook</h3>
            <form onSubmit={(event) => void handleCreateWebhook(event)}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CRM Sync Handler"
                  className="w-full p-2 border rounded text-sm"
                  value={webhookName}
                  onChange={(event) => setWebhookName(event.target.value)}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Payload URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://your-domain.com/webhooks/flowdesk"
                  className="w-full p-2 border rounded text-sm"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subscribed Events
                </label>
                <div className="space-y-1 text-sm">
                  {["conversation.created", "message.received", "message.sent"].map(
                    (eventName) => (
                      <label key={eventName} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={webhookEvents.includes(eventName)}
                          onChange={(event) =>
                            toggleWebhookEvent(eventName, event.target.checked)
                          }
                        />
                        <span>{eventName}</span>
                      </label>
                    )
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => setShowWebhookModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary text-sm">
                  {submitting ? "Registering..." : "Register Webhook"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
