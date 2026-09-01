import { useState, useEffect, useCallback, useRef, useId } from "react";
import type {
  Conversation,
  ConversationDetailResponse,
  InboxWorkspaceResourcesResponse,
  Message,
  TemplatePreviewResponse,
  GenerateBotDraftResponse
} from "@flowdesk/contracts";
import { type RoleKey, hasPermission } from "@flowdesk/domain";
import {
  listConversations,
  getConversation,
  sendOutboundMessage,
  performConversationOperation,
  getInboxWorkspaceResources,
  saveInboxFilter,
  deleteInboxFilter,
  createAttachmentUploadSession,
  uploadAttachmentBytes,
  completeAttachmentUpload,
  getAttachment,
  listConversationTemplates,
  previewTemplate,
  type ConversationTemplateItem,
  ApiError,
  generateBotDraft,
  getLatestBotDraft,
  applyBotDraftAction
} from "./api.js";
import { useRealtimeSync } from "./realtime.js";
import { inboxMessages, type InboxLocale } from "./i18n.js";

export interface InboxViewProps {
  organizationId: string;
  userRole: RoleKey;
  sessionUserId: string;
  fetcher?: typeof fetch;
  initialConversations?: Conversation[] | undefined;
  initialActiveConversation?: Conversation | undefined;
  initialMessages?: Message[] | undefined;
}

type StatusFilter = "all" | "new" | "open" | "pending" | "resolved" | "closed";
type AssigneeFilter = "all" | "me" | "unassigned";
type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

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
  const [queueFilter, setQueueFilter] = useState("all");
  const [locale, setLocale] = useState<InboxLocale>("en");
  const t = inboxMessages(locale);
  const [resources, setResources] = useState<InboxWorkspaceResourcesResponse>({
    queues: [],
    tags: [],
    savedFilters: []
  });
  const [filterName, setFilterName] = useState("");
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState("");

  // Thread detail state
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(
    initialActiveConversation ?? null
  );
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [notes, setNotes] = useState<ConversationDetailResponse["notes"]>([]);
  const [conversationTags, setConversationTags] = useState<ConversationDetailResponse["tags"]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Composer state
  const [composerText, setComposerText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "connecting"
  );
  const [hasConflict, setHasConflict] = useState(false);
  const [mediaState, setMediaState] = useState<string | null>(null);

  // Template modal & composer state (M3-05)
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [channelTemplates, setChannelTemplates] = useState<ConversationTemplateItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("");
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [templatePreview, setTemplatePreview] = useState<TemplatePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);

  // M4-06: AI Copilot state
  const [copilotDraft, setCopilotDraft] = useState<GenerateBotDraftResponse | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [showCitations, setShowCitations] = useState(false);
  const [isApprovingSend, setIsApprovingSend] = useState(false);
  const [copilotEditingRunId, setCopilotEditingRunId] = useState<string | null>(null);

  // UI IDs
  const searchInputId = useId();
  const composerTextareaId = useId();
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const conversationButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const templateDialogRef = useRef<HTMLDivElement>(null);
  const templateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

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

        const query: { status?: string; assignedTo?: string; queueId?: string } = {};
        if (statusFilter !== "all") query.status = statusFilter;
        if (assigneeFilter !== "all") query.assignedTo = assigneeFilter;
        if (queueFilter !== "all") query.queueId = queueFilter;

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
    [organizationId, statusFilter, assigneeFilter, queueFilter, selectedConversationId, fetcher]
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
        setNotes(detail.notes);
        setConversationTags(detail.tags);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load thread";
        setActionError(msg);
      } finally {
        setLoadingThread(false);
      }
    },
    [organizationId, fetcher]
  );

  const loadCopilotDraft = useCallback(
    async (conversationId: string, clearWhenMissing = false) => {
      try {
        const draft = await getLatestBotDraft(organizationId, conversationId, fetcher);
        setCopilotDraft(draft);
        setCopilotLoading(draft.status === "queued" || draft.status === "processing");
        setCopilotError(null);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          if (clearWhenMissing) setCopilotDraft(null);
          setCopilotLoading(false);
          return;
        }
        setCopilotLoading(false);
        setCopilotError(error instanceof Error ? error.message : "draft_error");
      }
    },
    [organizationId, fetcher]
  );

  // Initial load and filter change trigger
  useEffect(() => {
    void loadConversations(false);
  }, [organizationId, statusFilter, assigneeFilter, queueFilter]);

  const loadResources = useCallback(async () => {
    try {
      setResources(await getInboxWorkspaceResources(organizationId, fetcher));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to load workspace filters");
    }
  }, [organizationId, fetcher]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  // Load thread on selection change
  useEffect(() => {
    if (selectedConversationId) {
      void loadThread(selectedConversationId);
      void loadCopilotDraft(selectedConversationId, true);
    }
  }, [selectedConversationId, loadThread, loadCopilotDraft]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const timer = window.setInterval(
      () => {
        void loadCopilotDraft(selectedConversationId);
      },
      copilotDraft?.status === "queued" || copilotDraft?.status === "processing" ? 1_000 : 5_000
    );
    return () => window.clearInterval(timer);
  }, [selectedConversationId, copilotDraft?.status, loadCopilotDraft]);

  // Receive tenant-scoped invalidation hints via authenticated Socket.IO and
  // reload authoritative state through the REST API.
  useRealtimeSync({
    organizationId,
    activeConversationId: selectedConversationId,
    enabled: typeof window !== "undefined",
    onReconcile: () => {
      setHasConflict(false);
      void loadConversations(true);
      if (selectedConversationId) void loadThread(selectedConversationId);
      if (selectedConversationId) void loadCopilotDraft(selectedConversationId);
    },
    onHint: (hint) => {
      if (hint.resourceType === "conversation" || hint.resourceType === "organization") {
        void loadConversations(true);
        if (selectedConversationId) void loadCopilotDraft(selectedConversationId);
      }
      if (hint.resourceType === "message" || hint.resourceId === selectedConversationId) {
        if (selectedConversationId) void loadThread(selectedConversationId);
      }
    },
    onAccessRevoked: (reason) => {
      setActionError(`Realtime access revoked (${reason.code})`);
    },
    onConnectionState: setConnectionState
  });

  useEffect(() => {
    const online = () => {
      setConnectionState("reconnecting");
      void loadConversations(true);
      if (selectedConversationId) void loadThread(selectedConversationId);
    };
    const offline = () => setConnectionState("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [loadConversations, loadThread, selectedConversationId]);

  useEffect(() => {
    if (!showTemplateModal) return;
    const dialog = templateDialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])"
        ) ?? []
      );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowTemplateModal(false);
        templateTriggerRef.current?.focus();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => dialog?.removeEventListener("keydown", onKeyDown);
  }, [showTemplateModal]);

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
      const updated = await performConversationOperation(
        organizationId,
        activeConversation.id,
        {
          version: activeConversation.version,
          action: newStatus === "resolved" ? "resolve" : "reopen"
        },
        fetcher
      );

      setActiveConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setActionSuccess(`Conversation marked as ${newStatus}`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setHasConflict(true);
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
      const updated = await performConversationOperation(
        organizationId,
        activeConversation.id,
        { version: activeConversation.version, action: "claim" },
        fetcher
      );

      setActiveConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setActionSuccess("Conversation assigned to you");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setHasConflict(true);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to assign conversation";
        setActionError(msg);
      }
    }
  };

  const handleConflictReload = async () => {
    if (!activeConversation) return;
    await Promise.all([loadThread(activeConversation.id), loadConversations(true)]);
    setHasConflict(false);
  };

  const handleAddNote = async () => {
    if (!activeConversation || !noteBody.trim()) return;
    try {
      const updated = await performConversationOperation(
        organizationId,
        activeConversation.id,
        { version: activeConversation.version, action: "note", body: noteBody.trim() },
        fetcher
      );
      setActiveConversation(updated);
      setNoteBody("");
      await loadThread(updated.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setHasConflict(true);
      else setActionError(error instanceof Error ? error.message : "Failed to add note");
    }
  };

  const handleToggleTag = async (tagId: string, applied: boolean) => {
    if (!activeConversation) return;
    try {
      const updated = await performConversationOperation(
        organizationId,
        activeConversation.id,
        { version: activeConversation.version, action: applied ? "tag.remove" : "tag.add", tagId },
        fetcher
      );
      setActiveConversation(updated);
      await loadThread(updated.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setHasConflict(true);
      else setActionError(error instanceof Error ? error.message : "Failed to update tag");
    }
  };

  const handleSaveFilter = async () => {
    if (!filterName.trim()) return;
    await saveInboxFilter(
      organizationId,
      {
        name: filterName.trim(),
        definition: {
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          ...(assigneeFilter === "all" ? {} : { assignedTo: assigneeFilter }),
          ...(queueFilter === "all" ? {} : { queueId: queueFilter }),
          ...(searchQuery.trim() ? { search: searchQuery.trim() } : {})
        },
        isDefault: false
      },
      fetcher
    );
    setFilterName("");
    await loadResources();
  };

  const applySavedFilter = (
    definition: InboxWorkspaceResourcesResponse["savedFilters"][number]["definition"]
  ) => {
    setStatusFilter(definition.status ?? "all");
    const assigned = definition.assignedTo;
    setAssigneeFilter(assigned === "me" || assigned === "unassigned" ? assigned : "all");
    setQueueFilter(definition.queueId ?? "all");
    setSearchQuery(definition.search ?? "");
  };

  const handleDeleteFilter = async () => {
    if (!selectedSavedFilterId) return;
    await deleteInboxFilter(organizationId, selectedSavedFilterId, fetcher);
    setSelectedSavedFilterId("");
    await loadResources();
  };

  // Handle message sending
  const handleSendMessage = async () => {
    const text = composerText.trim();
    if (!text || !activeConversation || isSending || connectionState === "offline") return;

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
      const sent = copilotEditingRunId
        ? await applyBotDraftAction(
            organizationId,
            copilotEditingRunId,
            { action: "edited", editedContent: text },
            fetcher
          )
        : await sendOutboundMessage(
            organizationId,
            activeConversation.id,
            { content: text },
            `client-msg-${tempId}`,
            fetcher
          );
      if (!sent) throw new Error("The AI draft action did not create an outbound message.");
      if (copilotEditingRunId) {
        setCopilotEditingRunId(null);
        setCopilotDraft(null);
      }

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

  const handleMediaSelected = async (file: File | undefined) => {
    if (!file || !activeConversation || connectionState === "offline") return;
    try {
      setMediaState("uploading");
      const session = await createAttachmentUploadSession(
        organizationId,
        { fileName: file.name, contentType: file.type, byteSize: file.size },
        fetcher
      );
      await uploadAttachmentBytes(session, file, fetcher);
      await completeAttachmentUpload(organizationId, session.attachmentId, fetcher);
      setMediaState("scanning");
      let attachment = await getAttachment(organizationId, session.attachmentId, fetcher);
      for (let attempt = 0; attachment.status === "quarantine" && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        attachment = await getAttachment(organizationId, session.attachmentId, fetcher);
      }
      if (attachment.status !== "clean") {
        throw new Error(
          attachment.status === "rejected"
            ? "Attachment rejected by malware scanning"
            : "Attachment scan is still pending; try again shortly"
        );
      }
      setMediaState("sending");
      const sent = await sendOutboundMessage(
        organizationId,
        activeConversation.id,
        {
          type: "media",
          attachmentId: attachment.id,
          ...(composerText.trim() ? { caption: composerText.trim() } : {})
        },
        `media-${attachment.id}`,
        fetcher
      );
      setMessages((current) => [...current, sent]);
      setComposerText("");
      setMediaState(null);
    } catch (error) {
      setMediaState(null);
      setActionError(error instanceof Error ? error.message : "Failed to send attachment");
    } finally {
      if (mediaInputRef.current) mediaInputRef.current.value = "";
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

  // M4-06: AI Copilot handlers
  const handleGenerateDraft = useCallback(async () => {
    if (!activeConversation || copilotLoading) return;
    setCopilotLoading(true);
    setCopilotError(null);
    setShowCitations(false);
    try {
      const draft = await generateBotDraft(organizationId, activeConversation.id, fetcher);
      setCopilotDraft(draft);
      setCopilotLoading(draft.status === "queued" || draft.status === "processing");
    } catch (err: unknown) {
      setCopilotError(err instanceof Error ? err.message : "draft_error");
      setCopilotLoading(false);
    }
  }, [activeConversation, organizationId, fetcher, copilotLoading]);

  const handleCopilotApprove = async () => {
    if (!copilotDraft?.suggestedContent || !activeConversation || isApprovingSend) return;
    setIsApprovingSend(true);
    try {
      const sent = await applyBotDraftAction(
        organizationId,
        copilotDraft.runId,
        { action: "approved" },
        fetcher
      );
      if (!sent) throw new Error("Approval did not create an outbound message.");
      setMessages((prev) => [...prev.filter((message) => message.id !== sent.id), sent]);
      setCopilotDraft(null);
      setShowCitations(false);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id ? { ...c, lastMessageAt: sent.createdAt } : c
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      setActionError(msg);
    } finally {
      setIsApprovingSend(false);
    }
  };

  const handleCopilotEdit = () => {
    if (!copilotDraft?.suggestedContent) return;
    setComposerText(copilotDraft.suggestedContent);
    setCopilotEditingRunId(copilotDraft.runId);
    setShowCitations(false);
  };

  const handleCopilotReject = async () => {
    if (!copilotDraft || isApprovingSend) return;
    setIsApprovingSend(true);
    try {
      await applyBotDraftAction(
        organizationId,
        copilotDraft.runId,
        { action: "rejected" },
        fetcher
      );
      setCopilotDraft(null);
      setCopilotEditingRunId(null);
      setCopilotError(null);
      setShowCitations(false);
    } catch (error) {
      setCopilotError(error instanceof Error ? error.message : "draft_error");
    } finally {
      setIsApprovingSend(false);
    }
  };

  // Clear draft on conversation switch
  useEffect(() => {
    setCopilotDraft(null);
    setCopilotEditingRunId(null);
    setCopilotError(null);
    setShowCitations(false);
  }, [selectedConversationId]);

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
      {connectionState !== "connected" && (
        <div
          className={`connection-banner ${connectionState}`}
          role="status"
          aria-live="polite"
          data-testid="connection-state"
        >
          {connectionState === "offline" ? t.offline : t.reconnecting}
        </div>
      )}
      {hasConflict && (
        <div className="conflict-banner" role="alert" data-testid="conflict-state">
          <span>{t.conflict}</span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void handleConflictReload()}
          >
            {t.reload}
          </button>
        </div>
      )}
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
            <h2>{t.inbox}</h2>
            <div className="inbox-title-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setLocale((current) => (current === "en" ? "id" : "en"))}
                aria-label={`Switch language: ${t.language}`}
                data-testid="locale-toggle"
              >
                {locale.toUpperCase()}
              </button>
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
              placeholder={t.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search conversations"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="inbox-tabs" role="tablist" aria-label="Status filters">
            {(["all", "new", "open", "pending", "resolved", "closed"] as StatusFilter[]).map(
              (tab) => (
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
              )
            )}
          </div>

          {/* Assignee Filter */}
          <div className="inbox-assignee-filter">
            <span>{t.assignee}:</span>
            <select
              className="form-select"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as AssigneeFilter)}
              aria-label="Filter by assignee"
            >
              <option value="all">{t.allAssignees}</option>
              <option value="me">{t.mine}</option>
              <option value="unassigned">{t.unassigned}</option>
            </select>
          </div>
          <div className="inbox-assignee-filter">
            <span>{t.queue}:</span>
            <select
              className="form-select"
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              aria-label="Filter by queue"
              data-testid="queue-filter"
            >
              <option value="all">{t.allQueues}</option>
              {resources.queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          </div>
          <div className="saved-filter-controls">
            <label htmlFor="saved-filter-select" className="sr-only">
              {t.filters}
            </label>
            <select
              id="saved-filter-select"
              className="form-select"
              value={selectedSavedFilterId}
              onChange={(event) => {
                setSelectedSavedFilterId(event.target.value);
                const filter = resources.savedFilters.find(
                  (item) => item.id === event.target.value
                );
                if (filter) applySavedFilter(filter.definition);
              }}
            >
              <option value="">{t.filters}</option>
              {resources.savedFilters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.name}
                </option>
              ))}
            </select>
            {selectedSavedFilterId && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void handleDeleteFilter()}
              >
                {t.remove}
              </button>
            )}
            <div className="saved-filter-create">
              <input
                className="form-input"
                value={filterName}
                onChange={(event) => setFilterName(event.target.value)}
                placeholder={t.filterName}
                aria-label={t.filterName}
              />
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={!filterName.trim()}
                onClick={() => void handleSaveFilter()}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Conversation List */}
        <div className="inbox-conversation-list" role="listbox" aria-label="Conversations">
          {loadingConversations && conversations.length === 0 ? (
            <div className="inbox-empty-state" data-testid="inbox-loading">
              <span className="spinner" />
              <p>{t.loading}</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="inbox-empty-state" data-testid="inbox-empty">
              <p>{t.empty}</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedConversationId;
              return (
                <button
                  key={conv.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`conv-item-${conv.id}`}
                  className={`inbox-conv-item ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedConversationId(conv.id)}
                  tabIndex={
                    isSelected || (!selectedConversationId && conv === filteredConversations[0])
                      ? 0
                      : -1
                  }
                  ref={(element) => {
                    conversationButtonRefs.current[filteredConversations.indexOf(conv)] = element;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedConversationId(conv.id);
                    }
                    const index = filteredConversations.indexOf(conv);
                    const target =
                      e.key === "ArrowDown"
                        ? index + 1
                        : e.key === "ArrowUp"
                          ? index - 1
                          : e.key === "Home"
                            ? 0
                            : e.key === "End"
                              ? filteredConversations.length - 1
                              : null;
                    if (target !== null) {
                      e.preventDefault();
                      const next = Math.max(0, Math.min(filteredConversations.length - 1, target));
                      conversationButtonRefs.current[next]?.focus();
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
                </button>
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

            <section className="thread-operations-panel" aria-label="Internal collaboration">
              <div className="thread-tags">
                <span className="operations-label">{t.tags}</span>
                <div className="tag-picker" role="group" aria-label={t.tags}>
                  {resources.tags.length === 0 ? (
                    <span className="operations-empty">—</span>
                  ) : (
                    resources.tags.map((tag) => {
                      const applied = conversationTags.some((item) => item.id === tag.id);
                      return (
                        <button
                          type="button"
                          key={tag.id}
                          className={`tag-chip ${applied ? "applied" : ""}`}
                          style={{ "--tag-color": tag.color } as React.CSSProperties}
                          aria-pressed={applied}
                          onClick={() => void handleToggleTag(tag.id, applied)}
                        >
                          {tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <form
                className="private-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddNote();
                }}
              >
                <label htmlFor="private-note-input" className="operations-label">
                  {t.note}
                </label>
                <input
                  id="private-note-input"
                  className="form-input"
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder={t.notePlaceholder}
                />
                <button
                  type="submit"
                  className="btn btn-sm btn-secondary"
                  disabled={!noteBody.trim()}
                >
                  {t.addNote}
                </button>
              </form>
              {notes.length > 0 && (
                <details className="private-notes-history">
                  <summary>
                    {t.note} ({notes.length})
                  </summary>
                  <ol>
                    {notes.map((note) => (
                      <li key={note.id}>{note.body}</li>
                    ))}
                  </ol>
                </details>
              )}
            </section>

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
                        {msg.status === "failed" && (
                          <div className="failed-message-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setComposerText(msg.content);
                                setMessages((current) => current.filter((item) => item !== msg));
                              }}
                            >
                              {t.retry}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setMessages((current) => current.filter((item) => item !== msg))
                              }
                            >
                              {t.remove}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={timelineEndRef} />
            </div>

            {/* M4-06: AI Copilot Panel */}
            <CopilotPanel
              t={t}
              draft={copilotDraft}
              loading={copilotLoading}
              error={copilotError}
              showCitations={showCitations}
              isApproving={isApprovingSend}
              canSend={canSend}
              onGenerate={() => void handleGenerateDraft()}
              onApprove={() => void handleCopilotApprove()}
              onEdit={handleCopilotEdit}
              onReject={() => void handleCopilotReject()}
              onToggleCitations={() => setShowCitations((prev) => !prev)}
            />

            {/* Message Composer */}
            <footer className="thread-composer-wrapper">
              {connectionState === "offline" ? (
                <div className="composer-disabled-banner" data-testid="composer-offline">
                  {t.offline}
                </div>
              ) : !canSend ? (
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
                    <input
                      ref={mediaInputRef}
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,image/webp,application/pdf,audio/ogg,audio/mpeg,video/mp4"
                      onChange={(event) => void handleMediaSelected(event.target.files?.[0])}
                      data-testid="media-input"
                      aria-label={t.attach}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary composer-tpl-btn"
                      onClick={() => mediaInputRef.current?.click()}
                      disabled={mediaState !== null}
                      aria-label={t.attach}
                      data-testid="btn-attach-media"
                    >
                      {mediaState
                        ? mediaState === "scanning"
                          ? t.scanning
                          : t.sending
                        : `📎 ${t.attach}`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary composer-tpl-btn"
                      onClick={() => void handleOpenTemplateModal()}
                      ref={templateTriggerRef}
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
                      {isSending ? t.sending : t.send}
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
                <div className="modal-card" ref={templateDialogRef}>
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

// ── M4-06: AI Copilot Panel ──────────────────────────────────────────────────

type InboxT = ReturnType<typeof inboxMessages>;

interface CopilotPanelProps {
  t: InboxT;
  draft: GenerateBotDraftResponse | null;
  loading: boolean;
  error: string | null;
  showCitations: boolean;
  isApproving: boolean;
  canSend: boolean;
  onGenerate: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onToggleCitations: () => void;
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = pct >= 75 ? "high" : pct >= 50 ? "medium" : "low";
  return (
    <div className="copilot-confidence" aria-label={`Confidence ${pct}%`}>
      <div className="copilot-confidence-bar-track">
        <div
          className={`copilot-confidence-bar-fill confidence-${cls}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`copilot-confidence-pct confidence-${cls}`}>{pct}%</span>
    </div>
  );
}

function CopilotPanel({
  t,
  draft,
  loading,
  error,
  showCitations,
  isApproving,
  canSend,
  onGenerate,
  onApprove,
  onEdit,
  onReject,
  onToggleCitations
}: CopilotPanelProps) {
  const hasDraft = draft?.status === "drafted" && draft.sendable;
  const isOff = draft?.status === "off";
  const isFallback =
    draft !== null &&
    [
      "no_evidence",
      "safety_blocked",
      "budget_exceeded",
      "provider_failed",
      "stale",
      "cancelled"
    ].includes(draft.status);
  const fallbackMessage =
    draft?.status === "safety_blocked"
      ? t.copilotSafetyBlocked
      : draft?.status === "budget_exceeded"
        ? t.copilotBudgetExceeded
        : draft?.status === "provider_failed"
          ? t.copilotProviderFailed
          : draft?.status === "stale" || draft?.status === "cancelled"
            ? t.copilotStale
            : t.copilotFallback;

  return (
    <section className="copilot-panel" aria-label={t.copilotTitle} data-testid="copilot-panel">
      <div className="copilot-header">
        <span className="copilot-label">
          <span className="copilot-icon" aria-hidden="true">
            ✨
          </span>
          {t.copilotTitle}
        </span>
        {!loading && !hasDraft && !error && (
          <button
            type="button"
            className="btn btn-sm btn-copilot-generate"
            onClick={onGenerate}
            disabled={loading}
            data-testid="copilot-generate-btn"
            aria-label={t.copilotGenerate}
          >
            {t.copilotGenerate}
          </button>
        )}
        {hasDraft && (
          <button
            type="button"
            className="btn btn-sm btn-ghost copilot-refresh-btn"
            onClick={onGenerate}
            disabled={loading || isApproving}
            title="Regenerate draft"
            aria-label="Regenerate draft"
            data-testid="copilot-refresh-btn"
          >
            🔄
          </button>
        )}
      </div>

      {loading && (
        <div className="copilot-loading" data-testid="copilot-loading">
          <span className="spinner" />
          <span>{t.copilotGenerating}</span>
        </div>
      )}

      {error && !loading && (
        <div className="copilot-error" role="alert" data-testid="copilot-error">
          <span>⚠️ {t.copilotError}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onGenerate}>
            {t.retry ?? "Retry"}
          </button>
        </div>
      )}

      {!loading && !error && isOff && (
        <p className="copilot-off-msg" data-testid="copilot-off">
          {t.copilotOff}
        </p>
      )}

      {!loading && !error && isFallback && (
        <p className="copilot-fallback-msg" data-testid="copilot-fallback">
          {fallbackMessage}
        </p>
      )}

      {!loading && !error && hasDraft && !isFallback && !isOff && draft && (
        <div className="copilot-draft-card" data-testid="copilot-draft-card">
          <div className="copilot-draft-meta">
            <span className="copilot-meta-label">{t.copilotConfidence}</span>
            <ConfidenceMeter value={draft.confidence} />
          </div>

          <div className="copilot-draft-body">
            <p className="copilot-draft-text" data-testid="copilot-draft-text">
              {draft.suggestedContent}
            </p>
          </div>

          {draft.reasoning && (
            <details className="copilot-reasoning">
              <summary className="copilot-reasoning-summary">{t.copilotReasoningLabel}</summary>
              <p className="copilot-reasoning-text">{draft.reasoning}</p>
            </details>
          )}

          {draft.citations.length > 0 && (
            <div className="copilot-citations-section">
              <button
                type="button"
                className="btn btn-sm btn-ghost copilot-citations-toggle"
                onClick={onToggleCitations}
                aria-expanded={showCitations}
                data-testid="copilot-citations-toggle"
              >
                📚 {t.copilotCitations} ({draft.citations.length})
                <span aria-hidden="true">{showCitations ? " ▲" : " ▼"}</span>
              </button>
              {showCitations && (
                <ul
                  className="copilot-citations-list"
                  aria-label={t.copilotCitations}
                  data-testid="copilot-citations-list"
                >
                  {draft.citations.map((cit, idx) => (
                    <li key={cit.chunkId} className="copilot-citation-item">
                      <span className="citation-index">{idx + 1}</span>
                      <div className="citation-content">
                        <span className="citation-title">{cit.documentTitle}</span>
                        <blockquote className="citation-snippet">{cit.snippet}</blockquote>
                        <span className="citation-score">{Math.round(cit.score * 100)}% match</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="copilot-actions" role="group" aria-label="Copilot draft actions">
            {canSend && draft.sendable && (
              <button
                type="button"
                className="btn btn-sm btn-copilot-approve"
                onClick={onApprove}
                disabled={isApproving}
                data-testid="copilot-approve-btn"
              >
                {isApproving ? "Sending…" : `✅ ${t.copilotApprove}`}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={onEdit}
              disabled={isApproving}
              data-testid="copilot-edit-btn"
            >
              ✏️ {t.copilotEdit}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost copilot-reject-btn"
              onClick={onReject}
              disabled={isApproving}
              data-testid="copilot-reject-btn"
            >
              ✕ {t.copilotReject}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
