import { useState, useEffect, useCallback, useId } from "react";
import {
  listChannelsApi,
  createChannelApi,
  verifyChannelApi,
  deleteChannelApi,
  rotateChannelCredentialsApi,
  type ChannelClientRecord
} from "./api.js";

export interface ChannelsViewProps {
  orgId: string;
  canManage: boolean;
  showToast: (msg: string, isError?: boolean) => void;
}

export function ChannelsView({ orgId, canManage, showToast }: ChannelsViewProps) {
  const [channels, setChannels] = useState<ChannelClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rotatingChannelId, setRotatingChannelId] = useState<string | null>(null);
  const [rotatedAccessToken, setRotatedAccessToken] = useState("");
  const [rotating, setRotating] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const phoneId = useId();
  const wabaInputId = useId();
  const tokenInputId = useId();
  const rotatedTokenInputId = useId();

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listChannelsApi(orgId);
      setChannels(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load channels", true);
    } finally {
      setLoading(false);
    }
  }, [orgId, showToast]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phoneNumberId || !wabaId || !accessToken) {
      showToast("Please fill in all required fields", true);
      return;
    }

    try {
      setSubmitting(true);
      await createChannelApi(orgId, { name, phoneNumberId, wabaId, accessToken });
      showToast("WhatsApp channel connected successfully!");
      setShowModal(false);
      setName("");
      setPhoneNumberId("");
      setWabaId("");
      setAccessToken("");
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to connect channel", true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (channelId: string) => {
    try {
      setVerifyingId(channelId);
      const res = await verifyChannelApi(orgId, channelId);
      if (res.verified) {
        showToast("WhatsApp API Connection Verified Successfully!");
      } else {
        showToast(`Verification Failed: ${res.message}`, true);
      }
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Verification error", true);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async (channelId: string) => {
    if (!window.confirm("Are you sure you want to disconnect this channel?")) return;
    try {
      await deleteChannelApi(orgId, channelId);
      showToast("Channel disconnected successfully");
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to disconnect channel", true);
    }
  };

  const handleRotateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotatingChannelId || !rotatedAccessToken.trim()) {
      showToast("A new permanent System User access token is required", true);
      return;
    }
    try {
      setRotating(true);
      await rotateChannelCredentialsApi(orgId, rotatingChannelId, rotatedAccessToken.trim());
      showToast("WhatsApp access token updated successfully");
      setRotatedAccessToken("");
      setRotatingChannelId(null);
      await loadChannels();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update access token", true);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="channels-container p-6" data-testid="channels-view">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">WhatsApp Channels</h2>
          <p className="text-sm text-gray-500">
            Connect your Meta WhatsApp Business Accounts for AI copilot and auto-response.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
            id="connect-channel-btn"
          >
            + Connect WhatsApp Channel
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
              onClick={() => setShowModal(true)}
              className="btn btn-secondary btn-sm"
            >
              Connect your first channel
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

              <div className="text-sm text-gray-600 space-y-1 mb-4">
                <p>
                  <strong>Phone Number ID:</strong> {channel.phoneNumberId}
                </p>
                <p>
                  <strong>WABA ID:</strong> {channel.wabaId}
                </p>
              </div>

              {canManage && (
                <div className="flex gap-2 border-t pt-3 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRotatedAccessToken("");
                      setRotatingChannelId(channel.id);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Rotate token
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleVerify(channel.id)}
                    disabled={verifyingId === channel.id}
                    className="btn btn-secondary btn-sm"
                  >
                    {verifyingId === channel.id ? "Verifying..." : "Verify Connection"}
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

      {showModal && (
        <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="modal-content bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">Connect Meta WhatsApp Channel</h3>
            <form onSubmit={(e) => void handleCreateChannel(e)} className="space-y-4">
              <div>
                <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">
                  Channel Name
                </label>
                <input
                  id={nameId}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Support WhatsApp Line"
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label htmlFor={phoneId} className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number ID
                </label>
                <input
                  id={phoneId}
                  type="text"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="Meta Phone Number ID (e.g. 10987654321)"
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor={wabaInputId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  WhatsApp Business Account ID (WABA ID)
                </label>
                <input
                  id={wabaInputId}
                  type="text"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="WABA ID (e.g. 9876543210)"
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor={tokenInputId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Permanent System User Access Token
                </label>
                <input
                  id={tokenInputId}
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAAG..."
                  className="input w-full"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Connecting..." : "Connect Channel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rotatingChannelId && (
        <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="modal-content bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-2">Update WhatsApp access token</h3>
            <p className="text-sm text-gray-600 mb-4">
              This keeps the existing channel, conversations, messages, and templates linked. The
              current token is never displayed.
            </p>
            <form onSubmit={(e) => void handleRotateCredentials(e)} className="space-y-4">
              <div>
                <label
                  htmlFor={rotatedTokenInputId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  New permanent System User access token
                </label>
                <input
                  id={rotatedTokenInputId}
                  type="password"
                  value={rotatedAccessToken}
                  onChange={(e) => setRotatedAccessToken(e.target.value)}
                  placeholder="EAAG..."
                  className="input w-full"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setRotatedAccessToken("");
                    setRotatingChannelId(null);
                  }}
                  className="btn btn-secondary"
                  disabled={rotating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={rotating}>
                  {rotating ? "Updating..." : "Update access token"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
