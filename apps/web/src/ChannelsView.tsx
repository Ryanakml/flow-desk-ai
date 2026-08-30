import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeWhatsAppEmbeddedSignupApi,
  deleteChannelApi,
  listChannelsApi,
  startWhatsAppEmbeddedSignupApi,
  verifyChannelApi,
  type ChannelClientRecord
} from "./api.js";

interface FacebookSdk {
  init(config: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

const META_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const META_MESSAGE_ORIGINS = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

function loadMetaSdk(appId: string): Promise<FacebookSdk> {
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version: "v25.0" });
    return Promise.resolve(window.FB);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = META_SDK_URL;
    script.onload = () => {
      if (!window.FB) {
        reject(new Error("Meta login SDK did not load."));
        return;
      }
      window.FB.init({ appId, cookie: true, xfbml: false, version: "v25.0" });
      resolve(window.FB);
    };
    script.onerror = () => reject(new Error("Meta login SDK could not be loaded."));
    document.head.appendChild(script);
  });
}

type PendingSignup = {
  attemptId: string;
  state: string;
  code?: string;
  phoneNumberId?: string;
  wabaId?: string;
  completing?: boolean;
};

export interface ChannelsViewProps {
  orgId: string;
  canManage: boolean;
  showToast: (msg: string, isError?: boolean) => void;
}

export function ChannelsView({ orgId, canManage, showToast }: ChannelsViewProps) {
  const [channels, setChannels] = useState<ChannelClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const pendingSignup = useRef<PendingSignup | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true);
      setChannels(await listChannelsApi(orgId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load channels", true);
    } finally {
      setLoading(false);
    }
  }, [orgId, showToast]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const completePendingSignup = useCallback(async () => {
    const pending = pendingSignup.current;
    if (
      !pending ||
      pending.completing ||
      !pending.code ||
      !pending.phoneNumberId ||
      !pending.wabaId
    ) {
      return;
    }
    pending.completing = true;
    setConnecting(true);
    try {
      const result = await completeWhatsAppEmbeddedSignupApi(orgId, {
        attemptId: pending.attemptId,
        state: pending.state,
        code: pending.code,
        phoneNumberId: pending.phoneNumberId,
        wabaId: pending.wabaId
      });
      showToast(`WhatsApp channel connected: ${result.channel.name}`);
      pendingSignup.current = null;
      await loadChannels();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Meta connection could not be completed.",
        true
      );
    } finally {
      const current = pendingSignup.current;
      if (current) current.completing = false;
      setConnecting(false);
    }
  }, [loadChannels, orgId, showToast]);

  useEffect(() => {
    const receiveMetaSignupEvent = (event: MessageEvent<unknown>) => {
      if (!META_MESSAGE_ORIGINS.has(event.origin) || typeof event.data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("type" in payload) ||
        payload.type !== "WA_EMBEDDED_SIGNUP" ||
        !("event" in payload) ||
        payload.event !== "FINISH" ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null
      ) {
        return;
      }
      const data = payload.data as Record<string, unknown>;
      const pending = pendingSignup.current;
      if (
        !pending ||
        typeof data["phone_number_id"] !== "string" ||
        typeof data["waba_id"] !== "string"
      ) {
        return;
      }
      pending.phoneNumberId = data["phone_number_id"];
      pending.wabaId = data["waba_id"];
      void completePendingSignup();
    };
    window.addEventListener("message", receiveMetaSignupEvent);
    return () => window.removeEventListener("message", receiveMetaSignupEvent);
  }, [completePendingSignup]);

  const handleConnect = async () => {
    if (!canManage || connecting) return;
    try {
      setConnecting(true);
      const setup = await startWhatsAppEmbeddedSignupApi(orgId);
      pendingSignup.current = { attemptId: setup.attemptId, state: setup.state };
      const sdk = await loadMetaSdk(setup.appId);
      sdk.login(
        (loginResponse) => {
          const pending = pendingSignup.current;
          const code = loginResponse.authResponse?.code;
          if (!pending || !code) {
            pendingSignup.current = null;
            setConnecting(false);
            showToast("Meta connection was cancelled before authorization completed.", true);
            return;
          }
          pending.code = code;
          void completePendingSignup();
        },
        {
          config_id: setup.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} }
        }
      );
    } catch (err) {
      pendingSignup.current = null;
      setConnecting(false);
      showToast(err instanceof Error ? err.message : "Unable to start Meta connection.", true);
    }
  };

  const handleVerify = async (channelId: string) => {
    try {
      setVerifyingId(channelId);
      const result = await verifyChannelApi(orgId, channelId);
      showToast(
        result.verified
          ? "WhatsApp API connection is healthy."
          : `Verification failed: ${result.message}`,
        !result.verified
      );
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Verification error", true);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async (channelId: string) => {
    if (
      !window.confirm(
        "Disconnect this WhatsApp channel? Existing conversation history will remain."
      )
    ) {
      return;
    }
    try {
      await deleteChannelApi(orgId, channelId);
      showToast("Channel disconnected successfully.");
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to disconnect channel", true);
    }
  };

  return (
    <div className="channels-container p-6" data-testid="channels-view">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">WhatsApp Channels</h2>
          <p className="text-sm text-gray-500">
            Connect a WhatsApp Business Account securely through Meta. FlowDesk never asks for your
            Meta App Secret or a pasted access token.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => void handleConnect()}
            className="btn btn-primary"
            id="connect-channel-btn"
            disabled={connecting}
          >
            {connecting ? "Connecting with Meta..." : "Connect WhatsApp with Meta"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-4 text-center text-gray-500">Loading connected channels...</div>
      ) : channels.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 border border-dashed rounded-lg">
          <p className="mb-4">No WhatsApp channels connected yet.</p>
          {canManage && (
            <button
              type="button"
              onClick={() => void handleConnect()}
              className="btn btn-secondary btn-sm"
              disabled={connecting}
            >
              Connect your first channel with Meta
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((channel) => (
            <div key={channel.id} className="card p-4 border rounded-lg shadow-sm bg-white">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold text-lg">{channel.name}</h3>
                  <span className="text-xs text-gray-500">Type: {channel.type.toUpperCase()}</span>
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    channel.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {channel.status.toUpperCase()}
                </span>
              </div>
              {channel.statusReason && (
                <p className="mb-3 text-sm text-amber-700">{channel.statusReason}</p>
              )}
              <div className="text-sm text-gray-600 space-y-1 mb-4">
                <p>
                  <strong>Phone Number ID:</strong> {channel.phoneNumberId}
                </p>
                <p>
                  <strong>WABA ID:</strong> {channel.wabaId}
                </p>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2 border-t pt-3 mt-2">
                  <button
                    type="button"
                    onClick={() => void handleConnect()}
                    disabled={connecting}
                    className="btn btn-secondary btn-sm"
                  >
                    Reconnect with Meta
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleVerify(channel.id)}
                    disabled={verifyingId === channel.id}
                    className="btn btn-secondary btn-sm"
                  >
                    {verifyingId === channel.id ? "Checking..." : "Test connection"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(channel.id)}
                    className="btn btn-danger btn-sm text-red-600 hover:text-red-800"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
