import React, { useState, useEffect } from "react";
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

export interface DeveloperSettingsViewProps {
  orgId: string;
  canManage: boolean;
  showToast?: (message: string, type: "success" | "error" | "info") => void;
}

export function DeveloperSettingsView({
  orgId,
  canManage,
  showToast
}: DeveloperSettingsViewProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"keys" | "webhooks">("keys");

  // API Keys state
  const [keys, setKeys] = useState<DeveloperApiKeyRecord[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<boolean>(true);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [keyName, setKeyName] = useState<string>("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["read:conversations", "write:messages"]);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookSubscriptionClientRecord[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState<boolean>(true);
  const [showWebhookModal, setShowWebhookModal] = useState<boolean>(false);
  const [webhookName, setWebhookName] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([
    "conversation.created",
    "message.received"
  ]);

  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchKeys = async () => {
    try {
      setLoadingKeys(true);
      const data = await listApiKeysApi(orgId);
      setKeys(data);
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to load API keys", "error");
    } finally {
      setLoadingKeys(false);
    }
  };

  const fetchWebhooks = async () => {
    try {
      setLoadingWebhooks(true);
      const data = await listWebhooksApi(orgId);
      setWebhooks(data);
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to load webhooks", "error");
    } finally {
      setLoadingWebhooks(false);
    }
  };

  useEffect(() => {
    void fetchKeys();
    void fetchWebhooks();
  }, [orgId]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    try {
      setSubmitting(true);
      const created = await createApiKeyApi(orgId, {
        name: keyName.trim(),
        scopes: keyScopes
      });
      if (created.rawKey) {
        setGeneratedRawKey(created.rawKey);
      }
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
    if (!confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) {
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

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookName.trim() || !webhookUrl.trim()) return;

    try {
      setSubmitting(true);
      await createWebhookApi(orgId, {
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        events: webhookEvents
      });
      showToast?.("Webhook subscription registered successfully", "success");
      setWebhookName("");
      setWebhookUrl("");
      setShowWebhookModal(false);
      await fetchWebhooks();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to register webhook", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!confirm("Are you sure you want to delete this webhook subscription?")) {
      return;
    }

    try {
      await deleteWebhookApi(orgId, webhookId);
      showToast?.("Webhook subscription deleted", "info");
      await fetchWebhooks();
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : "Failed to delete webhook", "error");
    }
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

      {/* Generated Secret Raw Key Notification */}
      {generatedRawKey && (
        <div className="card p-4 mb-6 bg-amber-50 border-amber-300 rounded-lg text-amber-900">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-md">Save Your New Secret API Key</h3>
            <button
              type="button"
              className="text-xs text-amber-700 hover:text-amber-900"
              onClick={() => setGeneratedRawKey(null)}
            >
              Close ✕
            </button>
          </div>
          <p className="text-xs mb-2">
            Please copy this key now. For security reasons, it will never be displayed again.
          </p>
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

      {/* Tab 1: API Keys */}
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
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="card p-4 border rounded-lg shadow-sm bg-white flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900">{k.name}</h4>
                      {k.revokedAt ? (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                          REVOKED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 font-mono mb-1">
                      Prefix: {k.keyPrefix}••••••••
                    </p>
                    <div className="flex gap-1">
                      {k.scopes.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    {canManage && !k.revokedAt && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm text-red-600 hover:text-red-800"
                        onClick={() => void handleRevokeKey(k.id)}
                      >
                        Revoke Key
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Webhooks */}
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
              {webhooks.map((w) => (
                <div
                  key={w.id}
                  className="card p-4 border rounded-lg shadow-sm bg-white flex justify-between items-center"
                >
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">{w.name}</h4>
                    <p className="text-xs text-gray-600 font-mono mb-1">{w.url}</p>
                    <p className="text-xs text-gray-500 mb-1">
                      Secret: <code className="font-mono">{w.secret.substring(0, 10)}...</code>
                    </p>
                    <div className="flex gap-1">
                      {w.events.map((ev) => (
                        <span
                          key={ev}
                          className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
                        >
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    {canManage && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm text-red-600 hover:text-red-800"
                        onClick={() => void handleDeleteWebhook(w.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Generate API Key */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Generate Developer API Key</h3>
            <form onSubmit={(e) => void handleCreateKey(e)}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Automation Bot"
                  className="w-full p-2 border rounded text-sm"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Permissions / Scopes
                </label>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes("read:conversations")}
                      onChange={(e) => {
                        if (e.target.checked) setKeyScopes([...keyScopes, "read:conversations"]);
                        else setKeyScopes(keyScopes.filter((s) => s !== "read:conversations"));
                      }}
                    />
                    <span>read:conversations</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes("write:messages")}
                      onChange={(e) => {
                        if (e.target.checked) setKeyScopes([...keyScopes, "write:messages"]);
                        else setKeyScopes(keyScopes.filter((s) => s !== "write:messages"));
                      }}
                    />
                    <span>write:messages</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes("admin")}
                      onChange={(e) => {
                        if (e.target.checked) setKeyScopes([...keyScopes, "admin"]);
                        else setKeyScopes(keyScopes.filter((s) => s !== "admin"));
                      }}
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

      {/* Modal: Register Webhook */}
      {showWebhookModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Register Outbound Webhook</h3>
            <form onSubmit={(e) => void handleCreateWebhook(e)}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CRM Sync Handler"
                  className="w-full p-2 border rounded text-sm"
                  value={webhookName}
                  onChange={(e) => setWebhookName(e.target.value)}
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
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subscribed Events
                </label>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes("conversation.created")}
                      onChange={(e) => {
                        if (e.target.checked)
                          setWebhookEvents([...webhookEvents, "conversation.created"]);
                        else
                          setWebhookEvents(
                            webhookEvents.filter((ev) => ev !== "conversation.created")
                          );
                      }}
                    />
                    <span>conversation.created</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes("message.received")}
                      onChange={(e) => {
                        if (e.target.checked)
                          setWebhookEvents([...webhookEvents, "message.received"]);
                        else
                          setWebhookEvents(webhookEvents.filter((ev) => ev !== "message.received"));
                      }}
                    />
                    <span>message.received</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes("sla.breached")}
                      onChange={(e) => {
                        if (e.target.checked) setWebhookEvents([...webhookEvents, "sla.breached"]);
                        else setWebhookEvents(webhookEvents.filter((ev) => ev !== "sla.breached"));
                      }}
                    />
                    <span>sla.breached</span>
                  </label>
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
