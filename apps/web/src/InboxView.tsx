import { useState, useEffect, useCallback, useRef, useId } from "react";
import type {
  Conversation,
  Message,
  TemplatePreviewResponse,
  UpdateConversationRequest
} from "@flowdesk/contracts";
import { type RoleKey, hasPermission } from "@flowdesk/domain";
import {
  listConversations,
  getConversation,
  updateConversation,
  sendOutboundMessage,
  listConversationTemplates,
  previewTemplate,
  type ConversationTemplateItem,
  ApiError
} from "./api.js";
import { useRealtimeSync } from "./realtime.js";

export interface InboxViewProps {
  organizationId: string;
  userRole: RoleKey;
  sessionUserId: string;
  fetcher?: typeof fetch;
  initialConversations?: Conversation[] | undefined;
  initialActiveConversation?: Conversation | undefined;
  initialMessages?: Message[] | undefined;
}

type StatusFilter = "all" | "open" | "pending" | "resolved" | "closed";
type AssigneeFilter = "all" | "me" | "unassigned";

export function InboxView({
  organizationId,
  userRole,
  sessionUserId,
  fetcher = fetch,
  initialConversations,
  initialActiveConversation,
  initialMessages
}: InboxViewProps) {
  // Inbox state
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations ?? []);
  const [loadingConversations, setLoadingConversations] = useState(
    initialConversations === undefined
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialActiveConversation?.id ?? initialConversations?.[0]?.id ?? null
  );

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Thread detail state
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(
    initialActiveConversation ?? null
  );
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [loadingThread, setLoadingThread] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Composer state
  const [composerText, setComposerText] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Template modal & composer state (M3-05)
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [channelTemplates, setChannelTemplates] = useState<ConversationTemplateItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("");
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [templatePreview, setTemplatePreview] = useState<TemplatePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);

  // UI IDs
  const searchInputId = useId();
  const composerTextareaId = useId();
  const timelineEndRef = useRef<HTMLDivElement>(null);

  // Permissions
  const canSend = hasPermission(userRole, "message:send");
  const canResolve = hasPermission(userRole, "conversation:resolve");
  const canAssign = hasPermission(userRole, "conversation:assign");

  // Fetch conversation list
  const loadConversations = useCallback(
    async (preserveSelection = true) => {
      try {
        setLoadingConversations(true);
        setActionError(null);

        const query: { status?: string; assignedTo?: string } = {};
        if (statusFilter !== "all") query.status = statusFilter;
        if (assigneeFilter !== "all") query.assignedTo = assigneeFilter;

        const res = await listConversations(organizationId, query, fetcher);
        setConversations(res.items);

        if (res.items.length > 0) {
          if (!preserveSelection || !selectedConversationId) {
            setSelectedConversationId(res.items[0]!.id);
          } else {
            const exists = res.items.some((c) => c.id === selectedConversationId);
            if (!exists) {
              setSelectedConversationId(res.items[0]!.id);
            }
          }
        } else {
          setSelectedConversationId(null);
          setActiveConversation(null);
          setMessages([]);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load conversations";
        setActionError(msg);
      } finally {
        setLoadingConversations(false);
      }
    },
    [organizationId, statusFilter, assigneeFilter, selectedConversationId, fetcher]
  );

  // Fetch thread detail when selected conversation changes
  const loadThread = useCallback(
    async (conversationId: string) => {
      try {
        setLoadingThread(true);
        setActionError(null);
        const detail = await getConversation(organizationId, conversationId, fetcher);
        setActiveConversation(detail.conversation);
        setMessages(detail.messages);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load thread";
        setActionError(msg);
      } finally {
        setLoadingThread(false);
      }
    },
    [organizationId, fetcher]
  );

  // Initial load and filter change trigger
  useEffect(() => {
    void loadConversations(false);
  }, [organizationId, statusFilter, assigneeFilter]);

  // Load thread on selection change
  useEffect(() => {
    if (selectedConversationId) {
      void loadThread(selectedConversationId);
    }
  }, [selectedConversationId, loadThread]);

  // Receive tenant-scoped invalidation hints via authenticated Socket.IO and
  // reload authoritative state through the REST API.
  useRealtimeSync({
    organizationId,
    activeConversationId: selectedConversationId,
    enabled: typeof window !== "undefined",
    onReconcile: () => {
      void loadConversations(true);
      if (selectedConversationId) void loadThread(selectedConversationId);
    },
    onHint: (hint) => {
      if (hint.resourceType === "conversation" || hint.resourceType === "organization") {
        void loadConversations(true);
      }
      if (hint.resourceType === "message" || hint.resourceId === selectedConversationId) {
        if (selectedConversationId) void loadThread(selectedConversationId);
      }
    },
    onAccessRevoked: (reason) => {
      setActionError(`Realtime access revoked (${reason.code})`);
    }
  });

  // Auto-scroll timeline to bottom
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Search filtering
  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const phoneMatches = c.customerPhone.toLowerCase().includes(q);
    const nameMatches = (c.customerName ?? "").toLowerCase().includes(q);
    return phoneMatches || nameMatches;
  });

  // Handle status transition (Resolve / Reopen)
  const handleUpdateStatus = async (newStatus: "open" | "resolved") => {
    if (!activeConversation) return;
    try {
      setActionError(null);
      const updateBody: UpdateConversationRequest = {
        status: newStatus,
        version: activeConversation.version
      };

      const updated = await updateConversation(
        organizationId,
        activeConversation.id,
        updateBody,
        undefined,
        fetcher
      );

      setActiveConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setActionSuccess(`Conversation marked as ${newStatus}`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setActionError("Concurrency conflict: Conversation was modified elsewhere. Refreshed.");
        await loadThread(activeConversation.id);
        await loadConversations(true);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to update conversation";
        setActionError(msg);
      }
    }
  };

  // Handle assignment
  const handleAssignToMe = async () => {
    if (!activeConversation) return;
    try {
      setActionError(null);
      const updateBody: UpdateConversationRequest = {
        assignedToUserId: sessionUserId,
        version: activeConversation.version
      };

      const updated = await updateConversation(
        organizationId,
        activeConversation.id,
        updateBody,
        undefined,
        fetcher
      );

      setActiveConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setActionSuccess("Conversation assigned to you");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setActionError("Concurrency conflict: Conversation was modified elsewhere. Refreshed.");
        await loadThread(activeConversation.id);
        await loadConversations(true);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to assign conversation";
        setActionError(msg);
      }
    }
  };

  // Handle message sending
  const handleSendMessage = async () => {
    const text = composerText.trim();
    if (!text || !activeConversation || isSending) return;

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: "00000000-0000-0000-0000-000000000000",
      organizationId,
      conversationId: activeConversation.id,
      channelId: activeConversation.channelId,
      direction: "outbound",
      senderType: "agent",
      senderUserId: sessionUserId,
      providerMessageId: null,
      content: text,
      status: "queued",
      errorDetail: null,
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setComposerText("");
    setIsSending(true);
    setActionError(null);

    try {
      const sent = await sendOutboundMessage(
        organizationId,
        activeConversation.id,
        { content: text },
        `client-msg-${tempId}`,
        fetcher
      );

      // Replace optimistic message with actual created record
      setMessages((prev) => prev.map((m) => (m === optimisticMessage ? sent : m)));

      // Update conversation lastMessageAt in list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id ? { ...c, lastMessageAt: sent.createdAt } : c
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setActionError(msg);

      // Mark the optimistic message as failed
      setMessages((prev) =>
        prev.map((m) =>
          m === optimisticMessage ? { ...m, status: "failed", errorDetail: msg } : m
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Open Template Modal & Fetch Channel Templates
  const handleOpenTemplateModal = useCallback(async () => {
    if (!activeConversation) return;
    setShowTemplateModal(true);
    setLoadingTemplates(true);
    setPreviewError(null);
    setTemplatePreview(null);
    try {
      const res = await listConversationTemplates(organizationId, activeConversation.id, fetcher);
      const approved = res.items.filter((t) => t.status === "APPROVED");
      setChannelTemplates(approved);
      if (approved.length > 0) {
        setSelectedTemplateKey(`${approved[0]!.name}:${approved[0]!.language}`);
        setTemplateVariables({});
      }
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
  }, [activeConversation, organizationId, fetcher]);

  // Selected template object
  const activeTemplate = channelTemplates.find(
    (t) => `${t.name}:${t.language}` === selectedTemplateKey
  );

  // Real-time preview effect
  useEffect(() => {
    if (!showTemplateModal || !activeConversation || !activeTemplate) {
      setTemplatePreview(null);
      return;
    }

    let cancelled = false;
    const runPreview = async () => {
      try {
        const res = await previewTemplate(
          organizationId,
          activeConversation.id,
          {
            templateName: activeTemplate.name,
            language: activeTemplate.language,
            variables: templateVariables
          },
          fetcher
        );
        if (!cancelled) {
          setTemplatePreview(res);
          setPreviewError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setTemplatePreview(null);
          // Show error only if variables were filled
          if (Object.keys(templateVariables).length > 0) {
            setPreviewError(err instanceof Error ? err.message : "Preview error");
          }
        }
      }
    };

    void runPreview();
    return () => {
      cancelled = true;
    };
  }, [
    showTemplateModal,
    activeConversation,
    activeTemplate,
    templateVariables,
    organizationId,
    fetcher
  ]);

  // Send approved template
  const handleSendTemplate = async () => {
    if (!activeConversation || !activeTemplate) return;
    try {
      setIsSendingTemplate(true);
      setPreviewError(null);
      const key = `tpl-send-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const sentMsg = await sendOutboundMessage(
        organizationId,
        activeConversation.id,
        {
          type: "template",
          templateName: activeTemplate.name,
          language: activeTemplate.language,
          variables: templateVariables
        },
        key,
        fetcher
      );
      setMessages((prev) => [...prev, sentMsg]);
      setShowTemplateModal(false);
      setTemplateVariables({});
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Failed to send template message");
    } finally {
      setIsSendingTemplate(false);
    }
  };

  const renderStatusCheckmark = (msg: Message) => {
    if (msg.direction !== "outbound") return null;

    switch (msg.status) {
      case "queued":
        return (
          <span className="msg-check queued" title="Queued for dispatch" aria-label="Queued">
            ⏱
          </span>
        );
      case "sent":
        return (
          <span className="msg-check sent" title="Sent to WhatsApp" aria-label="Sent">
            ✓
          </span>
        );
      case "delivered":
        return (
          <span
            className="msg-check delivered"
            title="Delivered to customer"
            aria-label="Delivered"
          >
            ✓✓
          </span>
        );
      case "read":
        return (
          <span className="msg-check read" title="Read by customer" aria-label="Read">
            ✓✓
          </span>
        );
      case "failed":
        return (
          <span
            className="msg-check failed"
            title={`Failed: ${msg.errorDetail ?? "Unknown error"}`}
            aria-label="Failed"
          >
            ⚠️
          </span>
        );
      default:
        return null;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="inbox-container" data-testid="inbox-container">
      {/* Toast banners */}
      {actionError && (
        <div className="inbox-toast error" role="alert" data-testid="inbox-error">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>
            ✕
          </button>
        </div>
      )}
      {actionSuccess && (
        <div className="inbox-toast success" role="status" data-testid="inbox-success">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Left Sidebar: Conversation List */}
      <aside className="inbox-sidebar" role="region" aria-label="Conversation list">
        <div className="inbox-sidebar-header">
          <div className="inbox-title-row">
            <h2>Inbox</h2>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void loadConversations(true)}
              title="Refresh inbox"
              aria-label="Refresh conversations"
            >
              🔄
            </button>
          </div>

          {/* Search bar */}
          <div className="inbox-search">
            <label htmlFor={searchInputId} className="sr-only">
              Search by name or phone
            </label>
            <input
              id={searchInputId}
              type="text"
              className="form-input"
              placeholder="Search phone or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search conversations"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="inbox-tabs" role="tablist" aria-label="Status filters">
            {(["all", "open", "pending", "resolved", "closed"] as StatusFilter[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab}
                className={`inbox-tab ${statusFilter === tab ? "active" : ""}`}
                onClick={() => setStatusFilter(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Assignee Filter */}
          <div className="inbox-assignee-filter">
            <span>Assignee:</span>
            <select
              className="form-select"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as AssigneeFilter)}
              aria-label="Filter by assignee"
            >
              <option value="all">All Assignees</option>
              <option value="me">Assigned to Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>

        {/* Conversation List */}
        <div className="inbox-conversation-list" role="list">
          {loadingConversations ? (
            <div className="inbox-empty-state" data-testid="inbox-loading">
              <span className="spinner" />
              <p>Loading conversations...</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="inbox-empty-state" data-testid="inbox-empty">
              <p>No conversations found</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedConversationId;
              return (
                <div
                  key={conv.id}
                  role="listitem"
                  data-testid={`conv-item-${conv.id}`}
                  className={`inbox-conv-item ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedConversationId(conv.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedConversationId(conv.id);
                    }
                  }}
                >
                  <div className="conv-item-top">
                    <div className="conv-avatar">
                      {(conv.customerName ?? conv.customerPhone).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="conv-info">
                      <div className="conv-name">
                        {conv.customerName ? (
                          <>
                            <span className="customer-name">{conv.customerName}</span>
                            <span className="customer-phone-sub">+{conv.customerPhone}</span>
                          </>
                        ) : (
                          <span className="customer-name">+{conv.customerPhone}</span>
                        )}
                      </div>
                      <div className="conv-badges">
                        <span className="badge badge-whatsapp">WhatsApp</span>
                        <span className={`badge badge-status badge-${conv.status}`}>
                          {conv.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="conv-item-meta">
                    <span className="conv-time">{formatTime(conv.lastMessageAt)}</span>
                    {conv.assignedToUserId === sessionUserId && (
                      <span className="badge badge-mine">Me</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Center/Right Pane: Thread Timeline & Composer */}
      <main className="inbox-thread-pane" role="region" aria-label="Conversation thread">
        {selectedConversationId && activeConversation ? (
          <>
            {/* Thread Header */}
            <header className="thread-header">
              <div className="thread-customer-info">
                <h3>{activeConversation.customerName ?? `+${activeConversation.customerPhone}`}</h3>
                <div className="thread-sub-info">
                  <span>+{activeConversation.customerPhone}</span>
                  <span className="bullet">•</span>
                  <span className="badge badge-whatsapp">WhatsApp Cloud</span>
                  <span className={`badge badge-status badge-${activeConversation.status}`}>
                    {activeConversation.status}
                  </span>
                  {activeConversation.serviceWindow &&
                    (activeConversation.serviceWindow.isOpen ? (
                      <span
                        className="badge badge-success"
                        data-testid="service-window-badge"
                        title={`Customer service window open. Expires: ${activeConversation.serviceWindow.expiresAt ? new Date(activeConversation.serviceWindow.expiresAt).toLocaleTimeString() : "in 24h"}`}
                      >
                        ⏱️ 24h Window Active
                      </span>
                    ) : (
                      <span
                        className="badge badge-warning"
                        data-testid="service-window-badge"
                        title="24h service window expired. Freeform messaging blocked."
                      >
                        ⚠️ 24h Window Expired
                      </span>
                    ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="thread-actions">
                {activeConversation.assignedToUserId !== sessionUserId && canAssign && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => void handleAssignToMe()}
                    data-testid="btn-assign-me"
                  >
                    Assign to Me
                  </button>
                )}

                {canResolve &&
                  (activeConversation.status === "open" ||
                    activeConversation.status === "pending") && (
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      onClick={() => void handleUpdateStatus("resolved")}
                      data-testid="btn-resolve"
                    >
                      Resolve
                    </button>
                  )}

                {canResolve &&
                  (activeConversation.status === "resolved" ||
                    activeConversation.status === "closed") && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => void handleUpdateStatus("open")}
                      data-testid="btn-reopen"
                    >
                      Reopen
                    </button>
                  )}
              </div>
            </header>

            {/* Message Timeline */}
            <div
              className="thread-timeline"
              role="log"
              aria-live="polite"
              data-testid="thread-timeline"
            >
              {loadingThread ? (
                <div className="timeline-loading" data-testid="timeline-loading">
                  <span className="spinner" />
                  <p>Loading message history...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="timeline-empty" data-testid="timeline-empty">
                  <p>No messages in this conversation yet.</p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isInbound = msg.direction === "inbound";
                  return (
                    <div
                      key={
                        msg.id !== "00000000-0000-0000-0000-000000000000" ? msg.id : `msg-${index}`
                      }
                      className={`message-bubble-wrapper ${isInbound ? "inbound" : "outbound"}`}
                      data-testid={`msg-bubble-${msg.id}`}
                    >
                      <div className="message-bubble">
                        <div className="message-text">{msg.content}</div>
                        <div className="message-meta">
                          <span className="message-time">{formatTime(msg.createdAt)}</span>
                          {renderStatusCheckmark(msg)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={timelineEndRef} />
            </div>

            {/* Message Composer */}
            <footer className="thread-composer-wrapper">
              {!canSend ? (
                <div className="composer-disabled-banner" data-testid="composer-disabled">
                  You need the Agent or Administrator role to send WhatsApp messages.
                </div>
              ) : activeConversation.status === "closed" ? (
                <div className="composer-disabled-banner" data-testid="composer-closed">
                  This conversation is closed. Reopen it to send a reply.
                </div>
              ) : activeConversation.serviceWindow && !activeConversation.serviceWindow.isOpen ? (
                <div
                  className="composer-window-expired-banner"
                  data-testid="composer-window-expired"
                >
                  <div className="banner-text">
                    <strong>24-hour service window expired.</strong> Free-form messaging is blocked
                    by WhatsApp policy. You must use an approved template to contact this customer.
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleOpenTemplateModal()}
                    data-testid="btn-open-template-composer"
                  >
                    📋 Select WhatsApp Template
                  </button>
                </div>
              ) : (
                <form
                  className="thread-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendMessage();
                  }}
                  data-testid="thread-composer-form"
                >
                  <label htmlFor={composerTextareaId} className="sr-only">
                    Reply message
                  </label>
                  <textarea
                    id={composerTextareaId}
                    className="composer-textarea"
                    rows={2}
                    placeholder="Type a WhatsApp reply... (Cmd+Enter to send)"
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSending}
                    aria-label="Reply message"
                    data-testid="composer-input"
                  />
                  <div className="composer-actions">
                    <button
                      type="button"
                      className="btn btn-secondary composer-tpl-btn"
                      onClick={() => void handleOpenTemplateModal()}
                      data-testid="btn-open-template-composer"
                      title="Send WhatsApp Template"
                    >
                      📋 Template
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary composer-send-btn"
                      disabled={!composerText.trim() || isSending}
                      data-testid="composer-send-btn"
                    >
                      {isSending ? "Sending..." : "Send ↵"}
                    </button>
                  </div>
                </form>
              )}
            </footer>

            {/* WhatsApp Template Composer Modal */}
            {showTemplateModal && (
              <div
                className="modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="template-modal-title"
                data-testid="template-modal"
              >
                <div className="modal-card">
                  <header className="modal-header">
                    <h3 id="template-modal-title">Send WhatsApp Template</h3>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setShowTemplateModal(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </header>

                  <div className="modal-body">
                    {loadingTemplates ? (
                      <div className="modal-loading" data-testid="modal-loading">
                        Loading approved templates...
                      </div>
                    ) : channelTemplates.length === 0 ? (
                      <div className="modal-empty" data-testid="modal-empty">
                        No approved templates found for this channel.
                      </div>
                    ) : (
                      <div className="template-form">
                        <div className="form-group">
                          <label htmlFor="template-select">Select Approved Template</label>
                          <select
                            id="template-select"
                            className="form-control"
                            value={selectedTemplateKey}
                            onChange={(e) => {
                              setSelectedTemplateKey(e.target.value);
                              setTemplateVariables({});
                            }}
                            data-testid="template-select"
                          >
                            {channelTemplates.map((t) => (
                              <option
                                key={`${t.name}:${t.language}`}
                                value={`${t.name}:${t.language}`}
                              >
                                {t.name} ({t.language}) - {t.category}
                              </option>
                            ))}
                          </select>
                        </div>

                        {activeTemplate && activeTemplate.variableCount > 0 && (
                          <div className="template-variables-section">
                            <h4>Template Variables</h4>
                            {Array.from(
                              { length: activeTemplate.variableCount },
                              (_, i) => i + 1
                            ).map((varNum) => (
                              <div key={varNum} className="form-group">
                                <label
                                  htmlFor={`var-input-${varNum}`}
                                >{`Variable {{${varNum}}}`}</label>
                                <input
                                  id={`var-input-${varNum}`}
                                  type="text"
                                  className="form-control"
                                  placeholder={`Value for {{${varNum}}}`}
                                  value={templateVariables[String(varNum)] ?? ""}
                                  onChange={(e) =>
                                    setTemplateVariables((prev) => ({
                                      ...prev,
                                      [String(varNum)]: e.target.value
                                    }))
                                  }
                                  data-testid={`var-input-${varNum}`}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Preview card */}
                        <div className="template-preview-card" data-testid="template-preview-card">
                          <h4>Rendered Preview</h4>
                          {templatePreview ? (
                            <div className="preview-bubble">
                              {templatePreview.renderedHeader && (
                                <div className="preview-header">
                                  {templatePreview.renderedHeader}
                                </div>
                              )}
                              <div className="preview-body">{templatePreview.renderedBody}</div>
                              <div className="preview-meta">
                                <span className="badge badge-success">✓ Verified & Approved</span>
                              </div>
                            </div>
                          ) : (
                            <div className="preview-placeholder">
                              {activeTemplate && activeTemplate.variableCount > 0
                                ? "Fill in all variables above to generate preview."
                                : "Generating preview..."}
                            </div>
                          )}
                        </div>

                        {previewError && (
                          <div className="error-banner" data-testid="template-error-banner">
                            {previewError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <footer className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowTemplateModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        !templatePreview || !templatePreview.isEligible || isSendingTemplate
                      }
                      onClick={() => void handleSendTemplate()}
                      data-testid="btn-submit-template-send"
                    >
                      {isSendingTemplate ? "Sending..." : "Send Template"}
                    </button>
                  </footer>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="inbox-no-selection" data-testid="no-conv-selected">
            <div className="no-selection-content">
              <div className="no-selection-icon">💬</div>
              <h3>No conversation selected</h3>
              <p>Select a conversation from the list on the left to review messages and reply.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
