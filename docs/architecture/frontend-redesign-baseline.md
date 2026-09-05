# FlowDesk Frontend Redesign Baseline, Inventory & Migration Contract

> **Milestone**: M6.5 — Frontend Architecture & Product UI Redesign  
> **Status**: Authoritative Reference Specification  
> **Target Stack**: Vite + React 19 + Tailwind CSS v4 + `@flowdesk/ui` + TanStack Router + TanStack Query + TanStack Table  
> **Aesthetic Philosophy**: Linear × Attio × Intercom × modern shadcn

---

## 1. Executive Summary & Migration Contract

FlowDesk functional engineering through Milestones M0–M6 is complete and staging-accepted (encompassing scoped external API keys, HMAC-signed outbound webhooks, tenant-isolated analytics rollups, 30-day CSV compliance export with audit tracking, WhatsApp BYO/embedded onboarding, multi-tenant RBAC, and AI drafting).

However, the existing user interface in `apps/web` retains prototype architectural characteristics:

- **Global Navigation**: Driven by a single `activeTab` string state in `App.tsx` without deep-linking or browser history integration.
- **Server State**: Repetitive, manual `useEffect` / `useState` fetch cycles without centralized caching, background revalidation, or optimistic mutations.
- **Visual Presentation**: Styled via a monolithic 1,779-line `styles.css` using heavy glassmorphic shadows (`--shadow-glass`), dark radial gradients, and ad-hoc class naming.
- **Shared Design System**: `packages/ui` contains only a minimal `StatusBadge` export, while composite UI elements are duplicated across views.
- **Monolithic Views**: Dense views (e.g. `InboxView.tsx` at ~68KB, `App.tsx` at ~37KB) combine layout, state, Socket.IO sync, and business logic.

### The Immutable Migration Contract

This baseline document defines what **cannot change** during Milestone M6.5:

1. **Zero Backend Changes**: 100% of API endpoints, route definitions, controller logic, and HTTP status codes in `apps/api` (Express 5) and `apps/worker` (PostgreSQL outbox claim loops and timers) remain untouched.
2. **Zero Schema/RLS Changes**: No PostgreSQL database migrations, schema alterations, or Row-Level Security policy adjustments.
3. **Zero Authentication/Session Changes**: Cookie-based session resolution (`getSession`), Auth0/OIDC upstream logout redirects, and CSRF semantics remain authoritative.
4. **Zero RBAC Regression**: All 15 permissions in `packages/domain/src/permissions.ts` and standard role mappings remain strictly enforced. Frontend disabled states reflect permissions, but backend authorization remains the absolute gatekeeper.
5. **Zero Realtime Protocol Drift**: The Socket.IO versioned projection synchronization mechanism (`projection.changed`, `realtime.ready`, `onReconcile`) must be preserved.
6. **Zero Secret Leakage**: Raw API keys, webhook signing secrets, and channel credentials retain strict one-time reveal or masked handling; no secrets in logs, localStorage, or git fixtures.

---

## 2. Monorepo & Frontend Architecture Overview

```
flowdesk/
├── apps/
│   ├── api/             # Express 5 REST API & contracts (^5.1.0)
│   ├── web/             # React 19 + Vite SPA (Primary redesign target)
│   │   ├── src/
│   │   │   ├── App.tsx                    # 1,081 LOC, ~37KB - Monolithic root controller
│   │   │   ├── InboxView.tsx              # 1,780 LOC, ~68KB - Core 3-pane operational inbox
│   │   │   ├── AnalyticsView.tsx          # 336 LOC, ~11KB - Operational metrics & CSV export
│   │   │   ├── KnowledgeView.tsx          # 533 LOC, ~18KB - RAG sources, bot mode, policy simulator
│   │   │   ├── ChannelsView.tsx           # 463 LOC, ~15KB - WhatsApp Cloud API & Meta onboarding
│   │   │   ├── DeveloperSettingsView.tsx  # 688 LOC, ~27KB - Scoped API keys & webhooks
│   │   │   ├── api.ts                     # 879 LOC, ~26KB - Typed HTTP fetch client (50 API helpers)
│   │   │   ├── automation-api.ts          # 118 LOC, ~3.6KB - M5 automation policy client (6 API helpers)
│   │   │   ├── realtime.ts                # 136 LOC, ~4KB - Socket.IO projection sync client
│   │   │   ├── styles.css                 # 1,779 LOC, ~35KB - Monolithic global CSS
│   │   │   └── main.tsx                   # SPA bootstrap entrypoint
│   │   └── package.json                   # React 19, Vite, Socket.IO, Vitest, axe-core
│   └── worker/          # PostgreSQL outbox pollers & timers (webhooks, WhatsApp, AI drafts)
├── packages/
│   ├── config/          # Shared runtime configuration
│   ├── contracts/       # Zod schemas & TypeScript API contracts
│   ├── db/              # PostgreSQL schema, Kysely queries, migrations
│   ├── domain/          # Pure domain types, roles, and permissions
│   └── ui/              # Target shared design system package (currently StatusBadge only)
```

---

## 3. Exhaustive Surface & View Inventory

FlowDesk currently exposes **8 primary functional surfaces**, plus an unauthenticated/loading state and a 0-organization onboarding view.

### Surface 1: Conversations / WhatsApp Operator Inbox (`InboxView.tsx`)

- **File & Size**: `apps/web/src/InboxView.tsx` (1,780 lines, ~68KB).
- **Purpose**: High-throughput customer operations cockpit for live WhatsApp messaging.
- **Current Layout**: Fixed 3-column CSS flexbox:
  - _Left_: Conversation list with filter tabs (All, Mine, Unassigned), search input, queue selector, saved filters dropdown.
  - _Center_: Conversation header, message timeline, AI draft card, message composer, template selector, media upload trigger.
  - _Right_: Customer attributes, conversation details, RAG citations list.
- **State Management**: Complex local state (`selectedConversationId`, `conversations`, `messages`, `activeDraft`, `templateVariables`, `savedFilters`).
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/conversations` (`listConversations`)
  - `GET /api/v1/organizations/:orgId/conversations/:conversationId` (`getConversation`)
  - `POST /api/v1/organizations/:orgId/conversations/:conversationId/messages` (`createOutboundMessage`)
  - `POST /api/v1/organizations/:orgId/conversations/:conversationId/actions` (`performConversationOperation` - assign, resolve, snooze)
  - `GET /api/v1/organizations/:orgId/conversations/workspace-resources` (`getInboxWorkspaceResources` - queues, saved filters, templates)
  - `POST /api/v1/organizations/:orgId/conversations/saved-filters` (`saveInboxFilter`)
  - `DELETE /api/v1/organizations/:orgId/conversations/saved-filters/:filterId` (`deleteInboxFilter`)
  - `GET /api/v1/organizations/:orgId/conversations/:conversationId/templates` (`listConversationTemplates`)
  - `POST /api/v1/organizations/:orgId/conversations/:conversationId/template-preview` (`previewTemplate`)
  - `POST /api/v1/organizations/:orgId/bot/draft/:conversationId` (`generateBotDraft`)
  - `GET /api/v1/organizations/:orgId/bot/draft/:conversationId/latest` (`getLatestBotDraft`)
  - `POST /api/v1/organizations/:orgId/bot/draft-runs/:runId/action` (`applyBotDraftAction` - approve, edit, reject)
  - `POST /api/v1/organizations/:orgId/attachments/upload-session` (`createAttachmentUploadSession`)
  - `PUT :uploadUrl` (`uploadAttachmentBytes`)
  - `POST /api/v1/organizations/:orgId/attachments/:id/complete` (`completeAttachmentUpload`)
  - `GET /api/v1/organizations/:orgId/attachments/:id` (`getAttachment`)
- **Realtime Integration**: Emits `room.join` (`{ type: "conversation", id }`); receives `projection.changed` hints and executes `onReconcile`.
- **Permissions Gated**:
  - `conversation:assign` (assign/reassign conversation)
  - `conversation:resolve` (resolve conversation)
  - `message:send` (send outbound message or template)
- **Supported Capabilities**: Real AI drafts with `ConfidenceMeter`, expandable RAG citations (`chunkId`, `documentTitle`, `snippet`, `score`), WhatsApp pre-approved templates with variable substitution, presigned media attachment uploads (`upload-session` -> PUT bytes -> `complete`).
- **Non-Existent / Unsupported**: Typing indicators (Socket.IO does not emit them), live per-conversation SLA countdowns (only aggregate SLA in Analytics).

### Surface 2: Real-Time Analytics & SLA (`AnalyticsView.tsx`)

- **File & Size**: `apps/web/src/AnalyticsView.tsx` (336 lines, ~11KB).
- **Purpose**: Operational throughput, bot automation rate, and SLA monitoring.
- **Current Layout**: Header with time-range dropdown and export button; static text cards for metrics; unstyled list for daily volume series.
- **State Management**: `useState` for `data`, `loading`, `error`, `exporting`, `timeRange`.
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/analytics/metrics?days=:days` (`getAnalyticsMetricsApi`)
  - `POST /api/v1/organizations/:orgId/analytics/export` (`exportAnalyticsReportApi`)
- **Realtime Integration**: None (on-demand query with cancel token).
- **Permissions Gated**: `analytics:view` (held by `owner`, `admin`, `supervisor`, `analyst`).
- **Supported Time Ranges**: Strictly `7`, `14`, and `30` days.
- **Supported Metrics**:
  - `overview`: `totalConversations`, `openConversations`, `assignedConversations`, `resolvedConversations`, `totalMessages`, `inboundMessages`, `outboundMessages`, `botMessages`, `humanMessages`, `botAutomationRate`, `slaMetPercentage`, `avgFirstResponseTimeSeconds`, `avgResolutionTimeSeconds`.
  - `volumeSeries`: array of `{ date, inbound, outbound, bot }`.
- **Compliance Export**: Initiates `POST /analytics/export` to generate and download 30-day compliance report CSV and durably records an `analytics.exported` audit event in the database.
- **Non-Existent / Unsupported**: Period-over-period percentage comparisons (e.g. `+12%`), SLA trend lines over time, custom CSV date pickers.

### Surface 3: AI Knowledge & Automation (`KnowledgeView.tsx`)

- **File & Size**: `apps/web/src/KnowledgeView.tsx` (533 lines, ~18KB).
- **Purpose**: RAG knowledge source management, AI bot mode configuration, emergency stop, and automation policy simulator.
- **Current Layout**: Multi-section vertical card stack:
  1. Knowledge sources list + Add source form (Text or URL).
  2. Bot operating mode selector (`off`, `draft`, `auto`).
  3. Emergency stop toggle.
  4. Published & Draft automation policy display.
  5. Policy simulator form with dry-run decision trace.
- **State Management**: Local state across sources, policies, simulation parameters, and submission flags.
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/knowledge/sources` (`listKnowledgeSourcesApi`)
  - `POST /api/v1/organizations/:orgId/knowledge/sources` (`createKnowledgeSourceApi` - `type: "text" | "url"`)
  - `GET /api/v1/organizations/:orgId/bot/config` (`getBotConfig`)
  - `PUT /api/v1/organizations/:orgId/bot/config` (`updateBotConfig`)
  - `POST /api/v1/organizations/:orgId/routing/policies/draft` (`createAutomationPolicyDraft`)
  - `GET /api/v1/organizations/:orgId/routing/policies` (`fetchAutomationPolicies`)
  - `POST /api/v1/organizations/:orgId/routing/policies/:policyId/publish` (`publishAutomationPolicy`)
  - `POST /api/v1/organizations/:orgId/routing/policies/:policyId/rollback` (`rollbackAutomationPolicy`)
  - `POST /api/v1/organizations/:orgId/routing/policies/simulate` (`simulateAutomationPolicy`)
  - `POST /api/v1/organizations/:orgId/automation/emergency-stop` (`setAutomationEmergencyStop`)
- **Permissions Gated**: `automation:publish` (required for adding sources, altering bot mode, toggling emergency stop, drafting/publishing policies, and running simulation).
- **Supported Capabilities**: Text/URL knowledge indexing with status (`indexed`, `processing`, `failed`), bot mode selection, emergency stop killswitch, policy evaluation context (intent, tags, business hours, customer consent).
- **Non-Existent / Unsupported**: PDF/TXT file drag-and-drop upload, delete knowledge source endpoint, temperature/creativity sliders, model selection dropdowns.

### Surface 4: Empty Workspace Shell (`App.tsx` tab "workspace")

- **File & Size**: `apps/web/src/App.tsx` (lines 780–814).
- **Purpose**: Landing placeholder when an organization has no active conversations or tickets.
- **Current Layout**: Centered `.glass-card` with inbox icon, boundary confirmation message, and "Invite team members" action.
- **Permissions Gated**: `membership:invite` (displays button navigating to Team tab).

### Surface 5: WhatsApp Channels (`ChannelsView.tsx`)

- **File & Size**: `apps/web/src/ChannelsView.tsx` (463 lines, ~15KB).
- **Purpose**: WhatsApp Business Account connection, Meta Embedded Signup, credential management, and channel verification.
- **Current Layout**: Connected channel cards with status badges; buttons for "Connect with Meta" (SDK popup) and "Manual BYO Connection".
- **State Management**: Local state managing channels list, Meta SDK loading, manual form inputs, and pending signup tokens.
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/channels` (`listChannelsApi`)
  - `POST /api/v1/organizations/:orgId/channels` (`connectWhatsAppWithTokenApi` - BYO token)
  - `PATCH /api/v1/organizations/:orgId/channels/:channelId/credentials` (`rotateChannelCredentialsApi`)
  - `POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/start` (`startWhatsAppEmbeddedSignupApi`)
  - `POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/complete` (`completeWhatsAppEmbeddedSignupApi`)
  - `POST /api/v1/organizations/:orgId/channels/:id/verify` (`verifyChannelApi`)
  - `DELETE /api/v1/organizations/:orgId/channels/:id` (`deleteChannelApi`)
- **Permissions Gated**: `automation:publish` and `channel:manage` (required for connecting, rotating credentials, verifying, or deleting channels).
- **Credential Security**: Stored tokens are never returned by the backend. Rotating credentials requires entering a new access token via `PATCH /channels/:channelId/credentials`.
- **Non-Existent / Unsupported**: Meta quality rating, display-name health indicators, webhook verification fields in channel records.

### Surface 6: Developer API Keys & Webhooks (`DeveloperSettingsView.tsx`)

- **File & Size**: `apps/web/src/DeveloperSettingsView.tsx` (688 lines, ~27KB).
- **Purpose**: Programmatic integrations management (scoped API keys and HMAC-signed webhooks).
- **Current Layout**: Two sub-tabs ("API Keys" and "Webhooks") with modal forms for creation and delivery attempt accordions.
- **State Management**: Independent fetch cycles for keys, webhooks, and delivery attempts per webhook ID.
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/developer/api-keys` (`listApiKeysApi`)
  - `POST /api/v1/organizations/:orgId/developer/api-keys` (`createApiKeyApi`)
  - `DELETE /api/v1/organizations/:orgId/developer/api-keys/:id` (`revokeApiKeyApi`)
  - `GET /api/v1/organizations/:orgId/developer/webhooks` (`listWebhooksApi`)
  - `POST /api/v1/organizations/:orgId/developer/webhooks` (`createWebhookApi`)
  - `DELETE /api/v1/organizations/:orgId/developer/webhooks/:id` (`deleteWebhookApi`)
  - `POST /api/v1/organizations/:orgId/developer/webhooks/:id/test` (`testWebhookApi`)
  - `GET /api/v1/organizations/:orgId/developer/webhooks/:id/deliveries` (`listWebhookDeliveriesApi`)
- **Permissions Gated**: `automation:publish` (required for creating/revoking keys and configuring webhooks).
- **Canonical API Key Scopes**: Strictly `conversation:read` and `message:write`.
- **Developer Webhook Headers**: `X-FlowDesk-Signature`, `X-FlowDesk-Event-Id`, `X-FlowDesk-Timestamp`.
- **Known Defect #213**: Revoking a key succeeds on the backend but the row fails to immediately reflect `REVOKED` without a full reload. (Assigned to M6.5 and resolved in UI-07).
- **Non-Existent / Unsupported**: Non-canonical scopes (`conversation:write`, `webhook:manage`), delivery latency metrics.

### Surface 7: Team Settings (`App.tsx` tab "team")

- **File & Size**: `apps/web/src/App.tsx` (lines 815–945).
- **Purpose**: Member listing, role assignment, and invitation management.
- **Current Layout**: Inline table rendering members, role selector dropdown, status indicator, and remove action; modal for invitation.
- **State Management**: State held in `App.tsx` (`members`, `showInviteModal`, `inviteEmail`, `inviteRole`).
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/members` (`listMembers`)
  - `POST /api/v1/organizations/:orgId/invitations` (`inviteMember`)
  - `DELETE /api/v1/organizations/:orgId/invitations/:inviteId` (`revokeInvitation`)
  - `PATCH /api/v1/organizations/:orgId/members/:memberId` (`updateMemberRole`)
  - `DELETE /api/v1/organizations/:orgId/members/:memberId` (`revokeMember`)
- **Permissions Gated**:
  - `membership:invite` (trigger invitation modal)
  - `membership:modify` (change member role dropdown)
  - `membership:revoke` (remove team member or revoke invitation)
- **Standard Roles**: `owner`, `admin`, `supervisor`, `agent`, `analyst`, `billing_admin`.

### Surface 8: Security Audit Logs (`App.tsx` tab "audit")

- **File & Size**: `apps/web/src/App.tsx` (lines 946–1050).
- **Purpose**: Tamper-evident compliance event stream.
- **Current Layout**: Dense table displaying Timestamp, Actor (`displayName` / `email`), Action (`action`), Target Entity, and metadata; Previous/Next cursor pagination.
- **State Management**: State held in `App.tsx` (`auditLogs`, `auditPageInfo`, `loadingAudit`).
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/audit-logs?cursor=:cursor&limit=:limit` (`listAuditLogs`)
- **Permissions Gated**: `audit:view` (held by `owner`, `admin`, `analyst`).

### Auxiliary Surface: 0-Organization Onboarding & Session Auth (`App.tsx`)

- **File & Size**: `apps/web/src/App.tsx` (lines 335–563).
- **Purpose**: Authentication loading spinner, session initialization (`getSession`), organization switching (`listUserOrganizations`), and first-time organization bootstrapping (`bootstrapOrganization`).
- **APIs Invoked**:
  - `GET /api/v1/auth/session` (`getSession`)
  - `POST /api/v1/auth/logout` (`logout`)
  - `GET /api/v1/organizations` (`listUserOrganizations`)
  - `POST /api/v1/organizations` (`bootstrapOrganization`)
  - `POST /api/v1/invitations/accept` (`acceptInvitation`)

---

## 4. Comprehensive API Dependency Matrix

This matrix documents all 56 API client helper functions across `apps/web/src/api.ts` and `apps/web/src/automation-api.ts`, matching exact Express 5 backend route definitions.

| Surface          | Exact HTTP Route                                                              | Method   | Client Helper                       | Zod / Payload Contract                         |
| :--------------- | :---------------------------------------------------------------------------- | :------- | :---------------------------------- | :--------------------------------------------- |
| **Auth / Shell** | `/api/v1/system/build`                                                        | `GET`    | `getBuildInfo`                      | `BuildInfoSchema`                              |
| **Auth / Shell** | `/api/v1/auth/session`                                                        | `GET`    | `getSession`                        | `SessionStateSchema`                           |
| **Auth / Shell** | `/api/v1/auth/logout`                                                         | `POST`   | `logout`                            | Raw JSON (`{ status, logoutUrl }`)             |
| **Auth / Shell** | `/api/v1/organizations`                                                       | `GET`    | `listUserOrganizations`             | `ListUserOrganizationsResponseSchema`          |
| **Auth / Shell** | `/api/v1/organizations`                                                       | `POST`   | `bootstrapOrganization`             | `BootstrapOrganizationResponseSchema`          |
| **Auth / Shell** | `/api/v1/invitations/accept`                                                  | `POST`   | `acceptInvitation`                  | `AcceptInvitationResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations`                                  | `GET`    | `listConversations`                 | `ListConversationsResponseSchema`              |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/:conversationId`                  | `GET`    | `getConversation`                   | `ConversationDetailResponseSchema`             |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/:conversationId/messages`         | `POST`   | `createOutboundMessage`             | `MessageSchema`                                |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/:conversationId/actions`          | `POST`   | `performConversationOperation`      | `ConversationSchema`                           |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/workspace-resources`              | `GET`    | `getInboxWorkspaceResources`        | `InboxWorkspaceResourcesResponseSchema`        |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/saved-filters`                    | `POST`   | `saveInboxFilter`                   | `SavedFilterSchema`                            |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/saved-filters/:filterId`          | `DELETE` | `deleteInboxFilter`                 | Raw JSON (`{ success: true }`)                 |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/:conversationId/templates`        | `GET`    | `listConversationTemplates`         | `ConversationTemplatesResponseSchema`          |
| **Inbox**        | `/api/v1/organizations/:orgId/conversations/:conversationId/template-preview` | `POST`   | `previewTemplate`                   | `TemplatePreviewResponseSchema`                |
| **Inbox**        | `/api/v1/organizations/:orgId/bot/draft/:conversationId`                      | `POST`   | `generateBotDraft`                  | `GenerateBotDraftResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:orgId/bot/draft/:conversationId/latest`               | `GET`    | `getLatestBotDraft`                 | `GenerateBotDraftResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:orgId/bot/draft-runs/:runId/action`                   | `POST`   | `applyBotDraftAction`               | `GenerateBotDraftResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:orgId/attachments/upload-session`                     | `POST`   | `createAttachmentUploadSession`     | `CreateAttachmentUploadSessionResponseSchema`  |
| **Inbox**        | `:uploadUrl`                                                                  | `PUT`    | `uploadAttachmentBytes`             | Binary Body (Presigned upload)                 |
| **Inbox**        | `/api/v1/organizations/:orgId/attachments/:id/complete`                       | `POST`   | `completeAttachmentUpload`          | `CompleteAttachmentUploadResponseSchema`       |
| **Inbox**        | `/api/v1/organizations/:orgId/attachments/:id`                                | `GET`    | `getAttachment`                     | `AttachmentDetailResponseSchema`               |
| **Analytics**    | `/api/v1/organizations/:orgId/analytics/metrics?days=:days`                   | `GET`    | `getAnalyticsMetricsApi`            | `AnalyticsMetricsResponseSchema`               |
| **Analytics**    | `/api/v1/organizations/:orgId/analytics/export`                               | `POST`   | `exportAnalyticsReportApi`          | Blob (CSV file download)                       |
| **Knowledge**    | `/api/v1/organizations/:orgId/knowledge/sources`                              | `GET`    | `listKnowledgeSourcesApi`           | `ListKnowledgeSourcesResponseSchema`           |
| **Knowledge**    | `/api/v1/organizations/:orgId/knowledge/sources`                              | `POST`   | `createKnowledgeSourceApi`          | `CreateKnowledgeSourceResponseSchema`          |
| **Knowledge**    | `/api/v1/organizations/:orgId/bot/config`                                     | `GET`    | `getBotConfig`                      | `BotConfigSchema`                              |
| **Knowledge**    | `/api/v1/organizations/:orgId/bot/config`                                     | `PUT`    | `updateBotConfig`                   | `BotConfigSchema`                              |
| **Knowledge**    | `/api/v1/organizations/:orgId/routing/policies/draft`                         | `POST`   | `createAutomationPolicyDraft`       | `AutomationPolicySchema`                       |
| **Knowledge**    | `/api/v1/organizations/:orgId/routing/policies`                               | `GET`    | `fetchAutomationPolicies`           | `z.array(AutomationPolicySchema)`              |
| **Knowledge**    | `/api/v1/organizations/:orgId/routing/policies/:policyId/publish`             | `POST`   | `publishAutomationPolicy`           | `AutomationPolicySchema`                       |
| **Knowledge**    | `/api/v1/organizations/:orgId/routing/policies/:policyId/rollback`            | `POST`   | `rollbackAutomationPolicy`          | `AutomationPolicySchema`                       |
| **Knowledge**    | `/api/v1/organizations/:orgId/routing/policies/simulate`                      | `POST`   | `simulateAutomationPolicy`          | `SimulatePolicyResponseSchema`                 |
| **Knowledge**    | `/api/v1/organizations/:orgId/automation/emergency-stop`                      | `POST`   | `setAutomationEmergencyStop`        | Raw JSON (`{ enabled }`)                       |
| **Channels**     | `/api/v1/organizations/:orgId/channels`                                       | `GET`    | `listChannelsApi`                   | `ChannelClientRecord[]`                        |
| **Channels**     | `/api/v1/organizations/:orgId/channels`                                       | `POST`   | `connectWhatsAppWithTokenApi`       | `CompleteWhatsAppEmbeddedSignupResponseSchema` |
| **Channels**     | `/api/v1/organizations/:orgId/channels/:channelId/credentials`                | `PATCH`  | `rotateChannelCredentialsApi`       | `ChannelClientRecord`                          |
| **Channels**     | `/api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/start`        | `POST`   | `startWhatsAppEmbeddedSignupApi`    | `StartWhatsAppEmbeddedSignupResponseSchema`    |
| **Channels**     | `/api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/complete`     | `POST`   | `completeWhatsAppEmbeddedSignupApi` | `CompleteWhatsAppEmbeddedSignupResponseSchema` |
| **Channels**     | `/api/v1/organizations/:orgId/channels/:id/verify`                            | `POST`   | `verifyChannelApi`                  | `ChannelClientRecord`                          |
| **Channels**     | `/api/v1/organizations/:orgId/channels/:id`                                   | `DELETE` | `deleteChannelApi`                  | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:orgId/developer/api-keys`                             | `GET`    | `listApiKeysApi`                    | `DeveloperApiKeyRecord[]`                      |
| **Developer**    | `/api/v1/organizations/:orgId/developer/api-keys`                             | `POST`   | `createApiKeyApi`                   | `DeveloperApiKeyRecord & { rawKey }`           |
| **Developer**    | `/api/v1/organizations/:orgId/developer/api-keys/:id`                         | `DELETE` | `revokeApiKeyApi`                   | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:orgId/developer/webhooks`                             | `GET`    | `listWebhooksApi`                   | `WebhookSubscriptionClientRecord[]`            |
| **Developer**    | `/api/v1/organizations/:orgId/developer/webhooks`                             | `POST`   | `createWebhookApi`                  | `WebhookSubscriptionClientRecord & { secret }` |
| **Developer**    | `/api/v1/organizations/:orgId/developer/webhooks/:id`                         | `DELETE` | `deleteWebhookApi`                  | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:orgId/developer/webhooks/:id/test`                    | `POST`   | `testWebhookApi`                    | Raw JSON (`{ eventId, queued }`)               |
| **Developer**    | `/api/v1/organizations/:orgId/developer/webhooks/:id/deliveries`              | `GET`    | `listWebhookDeliveriesApi`          | `WebhookDeliveryClientRecord[]`                |
| **Team**         | `/api/v1/organizations/:orgId/members`                                        | `GET`    | `listMembers`                       | `ListMembersResponseSchema`                    |
| **Team**         | `/api/v1/organizations/:orgId/invitations`                                    | `POST`   | `inviteMember`                      | `CreateInvitationResponseSchema`               |
| **Team**         | `/api/v1/organizations/:orgId/invitations/:inviteId`                          | `DELETE` | `revokeInvitation`                  | Raw JSON                                       |
| **Team**         | `/api/v1/organizations/:orgId/members/:memberId`                              | `PATCH`  | `updateMemberRole`                  | Raw JSON                                       |
| **Team**         | `/api/v1/organizations/:orgId/members/:memberId`                              | `DELETE` | `revokeMember`                      | Raw JSON                                       |
| **Audit**        | `/api/v1/organizations/:orgId/audit-logs`                                     | `GET`    | `listAuditLogs`                     | `ListAuditLogsResponseSchema`                  |

---

## 5. Realtime Transport & Projection Synchronization

FlowDesk's realtime layer in `apps/web/src/realtime.ts` does **not** emit arbitrary entity-level events (e.g. `message:created` or `conversation:updated`). Instead, it implements a **versioned projection hint synchronization protocol** over Socket.IO:

### Current Authoritative Implementation (`realtime.ts`)

1. **Connection**: Connects to the `/realtime` namespace using WebSocket transport with auth credentials:
   ```typescript
   auth: {
     organizationId: string,
     lastVersion: number
   }
   ```
2. **Readiness Event (`realtime.ready`)**: The server emits the organization's current authoritative version:
   ```typescript
   {
     currentVersion: number,
     reconcileRequired: boolean
   }
   ```
   If `reconcileRequired` is `true`, the client immediately executes `options.onReconcile()` to refresh its local state from REST endpoints.
3. **Projection Events (`projection.changed`)**: The server broadcasts projection change hints:
   ```typescript
   {
     version: number,
     entityType?: string,
     entityId?: string,
     timestamp?: string
   }
   ```
   - If `hint.version > lastVersion + 1`, a sequence gap has occurred; the client marks a gap and executes `onReconcile()` to pull authoritative state.
   - If contiguous, `lastVersion` increments to `hint.version` and `onHint(hint)` fires.
4. **Room Subscriptions**: The client emits `room.join` (`{ type: "conversation", id: activeConversationId }`) when viewing a specific conversation.
5. **Revocation Notice (`access.revoked`)**: The server notifies when organization or room access is revoked (`{ code, roomType }`), triggering graceful disconnection.

### Proposed TanStack Query Cache Invalidation Design (Target for UI-02)

During UI-02, the imperative `onReconcile` pattern will be integrated with TanStack Query's declarative cache invalidation:

- `onReconcile()` → Dispatches `queryClient.invalidateQueries({ queryKey: ["conversations", orgId] })`.
- `onHint(hint)` → Evaluates incoming `hint.entityType` (design proposal):
  - When `hint.entityType === "conversation"` → Dispatches `queryClient.invalidateQueries({ queryKey: ["conversation", orgId, hint.entityId] })`.
  - When `hint.entityType === "draft"` → Dispatches `queryClient.invalidateQueries({ queryKey: ["bot-draft", orgId, hint.entityId] })`.
  - When unspecified or generic → Dispatches `queryClient.invalidateQueries({ queryKey: ["conversations", orgId] })`.

---

## 6. Role-Based Access Control (RBAC) & Security Policy

Permissions are centrally defined in `packages/domain/src/permissions.ts`.

### Canonical Permissions

- `org:security:manage`
- `membership:read`
- `membership:invite`
- `membership:modify`
- `membership:revoke`
- `channel:manage`
- `channel:view`
- `conversation:assign`
- `conversation:resolve`
- `conversation:read`
- `message:send`
- `automation:publish`
- `analytics:view`
- `billing:manage`
- `audit:view`

### Standard Role Matrix

| Permission             | Owner | Admin | Supervisor | Agent | Analyst | Billing Admin |
| :--------------------- | :---: | :---: | :--------: | :---: | :-----: | :-----------: |
| `org:security:manage`  |   ✓   |   ✓   |            |       |         |               |
| `membership:read`      |   ✓   |   ✓   |     ✓      |   ✓   |    ✓    |       ✓       |
| `membership:invite`    |   ✓   |   ✓   |            |       |         |               |
| `membership:modify`    |   ✓   |   ✓   |            |       |         |               |
| `membership:revoke`    |   ✓   |   ✓   |            |       |         |               |
| `channel:manage`       |   ✓   |   ✓   |            |       |         |               |
| `channel:view`         |   ✓   |   ✓   |     ✓      |   ✓   |    ✓    |               |
| `conversation:assign`  |   ✓   |   ✓   |     ✓      |       |         |               |
| `conversation:resolve` |   ✓   |   ✓   |     ✓      |       |         |               |
| `conversation:read`    |   ✓   |   ✓   |     ✓      |   ✓   |    ✓    |               |
| `message:send`         |   ✓   |   ✓   |     ✓      |   ✓   |         |               |
| `automation:publish`   |   ✓   |   ✓   |            |       |         |               |
| `analytics:view`       |   ✓   |   ✓   |     ✓      |       |         |               |
| `billing:manage`       |   ✓   |       |            |       |         |       ✓       |
| `audit:view`           |   ✓   |   ✓   |            |       |    ✓    |               |

### Security & Secret Handling Rules

- **API Keys**: Raw key string (`fd_live_...`) is returned **only once** upon creation. It must be presented in a dedicated one-time reveal dialog with clipboard copy, then purged from client memory.
- **Webhook Secrets**: Signing secret (`whsec_...`) is returned **only once** upon registration.
- **WhatsApp Tokens**: Access tokens are write-only. The API masks stored tokens; client forms must never expect stored tokens in `GET` responses.
- **Audit Gating**: Users without `audit:view` must receive a 403 Forbidden state and must not have `/audit` visible in navigation.

---

## 7. Current CSS Architecture & Design Token Analysis

The current frontend styling is defined entirely in `apps/web/src/styles.css` (1,779 lines, ~35KB).

### Legacy Design Tokens (CSS Variables)

- **Backgrounds**: `--color-bg-base: #090d16`, `--color-bg-surface: rgba(17, 24, 39, 0.75)`, `--color-bg-card: rgba(30, 41, 59, 0.65)`.
- **Accents**: `--color-primary: #6366f1` (indigo), `--color-accent: #06b6d4` (cyan).
- **Semantics**: `--color-success: #10b981`, `--color-warning: #f59e0b`, `--color-danger: #f43f5e`.
- **Borders & Glass**: `--color-border: rgba(255, 255, 255, 0.08)`, `--shadow-glass: 0 8px 32px 0 rgba(0, 0, 0, 0.37)`, `--backdrop-blur: blur(16px)`.
- **Radii**: `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 16px`.

### Target Semantic Tokens (Tailwind CSS v4 / `@flowdesk/ui`)

The redesign transforms these custom tokens into standard semantic CSS variables:

- `background` & `foreground` (Neutral light/dark base)
- `card` & `card-foreground` (Subtle elevated surface, replacing heavy glassmorphism)
- `primary` & `primary-foreground` (Restrained brand accent, eliminating high-saturation glows)
- `muted` & `muted-foreground` (Clean secondary typography)
- `destructive`, `success`, `warning`, `info` (Semantic state tokens)
- `border`, `input`, `ring` (Subtle 1px borders and focused keyboard rings)
- `radius`: Standardized to 8–12px family (`--radius: 0.5rem`).

---

## 8. Component Architecture, Monoliths & Separation of Concerns

### Monolithic Hotspots

| File                        | Lines | Bytes | Current Entanglements                                                                           | Target Architecture                                                                                                                 |
| :-------------------------- | :---- | :---- | :---------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `InboxView.tsx`             | 1,780 | 68KB  | Queue filtering, message stream, AI drafting, template modals, uploads, Socket.IO listeners     | Feature folder `features/inbox/` split into `ConversationQueue`, `MessageStream`, `AiDraftCard`, `MessageComposer`, `ContextDrawer` |
| `App.tsx`                   | 1,081 | 37KB  | Root routing, org switcher, onboarding, toast dispatcher, team table, invite modal, audit table | Lean Provider Shell (`App.tsx` < 100 LOC) + TanStack Router tree + dedicated `features/team/` and `features/audit/`                 |
| `DeveloperSettingsView.tsx` | 688   | 27KB  | API key table, generate modal, webhook table, register modal, delivery history accordion        | `features/developer/` split into `/developer/api-keys` and `/developer/webhooks` with dedicated sheets                              |
| `KnowledgeView.tsx`         | 533   | 18KB  | Source table, text/URL form, bot config, emergency stop, policy simulator                       | `features/knowledge/` split into modular cards for sources, bot mode, safety, and simulator                                         |
| `ChannelsView.tsx`          | 463   | 15KB  | Channel cards, Meta SDK script loading, BYO modal, delete confirmation                          | `features/channels/` with isolated Meta SDK loader and accessible dialogs                                                           |
| `AnalyticsView.tsx`         | 336   | 11KB  | Header, metric cards, static volume table, CSV export trigger                                   | `features/analytics/` with Recharts visualizations and date-range controls                                                          |

---

## 9. Visual Baseline & Responsive Viewports

Visual baseline capture and testing targets three standard viewports:

| Tier        | Dimensions     | Layout Behavior                                                                                                                                                                    |
| :---------- | :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop** | **1440 × 900** | Permanent collapsible sidebar; 3-pane resizable Inbox (`react-resizable-panels`); 4-column metric cards; side-by-side management cards.                                            |
| **Tablet**  | **1024 × 768** | Collapsed sidebar (slide-out Sheet); 2-pane Inbox (Queue + Message stream; Right context panel in sliding Sheet); 2-column metric cards.                                           |
| **Mobile**  | **375 × 812**  | Hamburger header with drawer navigation; 1-pane Inbox (Queue view drills down into `/inbox/:conversationId`); single-column stacked forms/cards; horizontal scrolling data tables. |

### Visual Baseline Packet Index

All 24 baseline screenshots have been captured from the running React 19 application using synthetic staging fixtures (no customer PII or real credentials) and packaged into `docs/architecture/frontend-redesign-baseline/`:

| Surface                      | Surface Key    | Desktop (1440×900)                                                                                                                                                         | Tablet (1024×768)                                                                                                                                                        | Mobile (375×812)                                                                                                                                                         |
| :--------------------------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Conversations / Inbox** | `01-inbox`     | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/01-inbox-desktop.png)     | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/01-inbox-tablet.png)     | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/01-inbox-mobile.png)     |
| **2. Analytics & SLA**       | `02-analytics` | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/02-analytics-desktop.png) | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/02-analytics-tablet.png) | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/02-analytics-mobile.png) |
| **3. AI Knowledge**          | `03-knowledge` | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/03-knowledge-desktop.png) | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/03-knowledge-tablet.png) | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/03-knowledge-mobile.png) |
| **4. Workspace Shell**       | `04-workspace` | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/04-workspace-desktop.png) | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/04-workspace-tablet.png) | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/04-workspace-mobile.png) |
| **5. WhatsApp Channels**     | `05-channels`  | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/05-channels-desktop.png)  | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/05-channels-tablet.png)  | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/05-channels-mobile.png)  |
| **6. Developer Settings**    | `06-developer` | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/06-developer-desktop.png) | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/06-developer-tablet.png) | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/06-developer-mobile.png) |
| **7. Team Settings**         | `07-team`      | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/07-team-desktop.png)      | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/07-team-tablet.png)      | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/07-team-mobile.png)      |
| **8. Security Audit**        | `08-audit`     | [Desktop](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/08-audit-desktop.png)     | [Tablet](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/08-audit-tablet.png)     | [Mobile](file:///Users/ryanakmalpasya/Documents/BS/Freelance/PROJECTS/SKEM%20PROJECT/SAAS/flowdesk/docs/architecture/frontend-redesign-baseline/08-audit-mobile.png)     |

---

## 10. Accessibility & Compliance Baseline

### Current Automated Findings (`axe-core`)

The existing codebase includes automated accessibility suites executed with `axe-core` under Vitest / JSDOM (`InboxView.browser.test.tsx`):

- **Automated Rule Posture**:
  - `axe.run(container, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } })`
  - **Results**: **0 serious or critical violations** on tested components.
- **Known Limitations & JSDOM Disclaimers**:
  - Color contrast checks are disabled during JSDOM test runs because JSDOM does not compute layout geometry, pseudo-elements, or rendered CSS variable color inheritance.
  - Form validation error announcements currently rely on inline `<span>` text without `aria-live="polite"` or `aria-describedby` linking.
  - Dialogs and modals in `App.tsx` and `DeveloperSettingsView.tsx` lack strict keyboard focus-traps and ESC-key dismiss listeners.

### Target Accessibility Requirements for UI-10

1. **WCAG 2.1 AA Compliance**: Contrast ratios of at least 4.5:1 for normal body text and 3:1 for large text/icons against semantic surfaces (`bg-background` and `bg-card`).
2. **Accessible Dialog Primitives**: Radix UI / shadcn dialogs with automatic focus trapping, restore-focus-on-close, and `aria-modal="true"`.
3. **Screen Reader Live Regions**: Realtime messages and toast notifications announce dynamically via `aria-live="polite"`.
4. **Keyboard Operability**: Full keyboard traversal across conversation lists (`ArrowDown`/`ArrowUp`), command palettes, tabs, and action menus without focus-trapping bugs.

---

## 11. Test Coverage & Verification Baseline

### Baseline Test Execution Results (Pre-Redesign)

- **`@flowdesk/web` Test Suite**:
  - `src/InboxView.test.tsx` (17 tests passed)
  - `src/InboxView.browser.test.tsx` (4 tests passed)
  - `src/AnalyticsView.test.tsx` (3 tests passed)
  - `src/ChannelsView.test.tsx` (3 tests passed)
  - `src/KnowledgeView.test.tsx` (5 tests passed)
  - `src/DeveloperSettingsView.test.tsx` (4 tests passed)
  - `src/App.test.tsx` (2 tests passed)
  - `src/App.browser.test.tsx` (1 test passed)
  - `src/api.test.ts` (20 tests passed)
  - `src/realtime.test.tsx` (8 tests passed)
  - **Total**: **10 test files, 67 tests passing (0 failures)**.
- **`@flowdesk/ui` Test Suite**:
  - `src/index.test.tsx` (1 test passed)
- **Code Quality Checks**:
  - `pnpm lint` (ESLint 9 passing 100%)
  - `pnpm format:check` (Prettier passing 100%)

### Test Preservation Contract

No existing behavioral test may be deleted during the redesign. Tests targeting legacy DOM selectors must be updated to target modern accessible roles (`role="table"`, `data-testid`, accessible names) while preserving all assertions on business logic, permissions, and network payloads.

---

## 12. Code Donor & Architectural Reference Guidelines

### Primary Architectural Donor: `satnaing/shadcn-admin`

- **Use For**:
  - Vite + React 19 configuration.
  - TanStack Router file-based route definitions and layouts.
  - TanStack Query query-client configuration and cache conventions.
  - Collapsible sidebar shell with breadcrumbs and user navigation.
  - Reusable DataTable primitive wrappers around TanStack Table.
  - Recharts integration using Tailwind CSS variable tokens.

### Secondary Visual Donor: `Kiranism/next-shadcn-dashboard-starter`

- **Use For**:
  - Information density and visual hierarchy.
  - Restrained typography and spacing rhythm (no oversized card padding).
  - Subtle borders and muted backgrounds for enterprise operational feel.
- **Strict Rule**: Never import or adopt Next.js-specific routing or SSR patterns.

### The Immutable Donor Rule

FlowDesk's domain types, API contracts, PostgreSQL models, RBAC rules, and Socket.IO projection protocols remain authoritative. Code donors provide UI composition and component patterns only.

---

## 13. Page-by-Page Regression Checklist

Before completing any surface redesign (UI-04 through UI-09) and before closing the milestone (UI-12), the following regression items must be verified:

### Authentication, Shell & Workspace

- [ ] User session loads correctly from cookie; unauthenticated users redirect to login.
- [ ] Multi-tenant organization switcher lists all memberships and updates active tenant.
- [ ] 0-organization accounts render the onboarding bootstrap form (`bootstrapOrganization`).
- [ ] Light and Dark mode themes toggle cleanly and persist in `localStorage`.
- [ ] Command palette (`Cmd+K`) opens and executes route transitions.
- [ ] Logout invalidates session and navigates to `logoutUrl`.

### WhatsApp Operator Inbox

- [ ] Conversation list filters by status (`all`, `open`, `pending`, `resolved`) and assignee (`all`, `me`, `unassigned`).
- [ ] Realtime inbound messages render via `projection.changed` hints without page reload.
- [ ] Outbound text messages send successfully and render with delivery confirmation.
- [ ] AI Draft card renders suggested text, `ConfidenceMeter`, and expandable RAG citations.
- [ ] AI Draft review actions ("Approve & Send", "Edit", "Discard" with rejection reason) function.
- [ ] Pre-approved WhatsApp templates preview with variables and send correctly.
- [ ] Media attachments upload and download via signed sessions (`upload-session` -> `complete`).
- [ ] Agent assignment and conversation resolution update backend state.

### Real-Time Analytics & SLA

- [ ] Overview KPI cards display real numbers for conversations, messages, FRT, SLA %, and bot rate.
- [ ] Message volume chart displays stacked Inbound, Outbound, and Bot series.
- [ ] Date range selector switches dynamically between 7, 14, and 30 days.
- [ ] Compliance CSV export triggers file download.
- [ ] Exporting CSV reliably emits an `analytics.exported` audit event.

### AI Knowledge & Automation

- [ ] Knowledge sources list displays indexed, processing, and failed states.
- [ ] Adding a Text knowledge source succeeds and enters processing.
- [ ] Adding a URL knowledge source validates HTTPS and succeeds.
- [ ] Bot operating mode switches between `off`, `draft`, and `auto`.
- [ ] Emergency stop toggle engages and disengages safety killswitch.
- [ ] Automation policy simulator executes dry runs with intent/tags and renders decision trace.

### WhatsApp Channels

- [ ] Connected channels display verified phone numbers, WABA IDs, and status badges.
- [ ] Channel verification action triggers `verifyChannelApi` and updates badge.
- [ ] Meta Embedded Signup flow loads Facebook SDK and exchanges tokens.
- [ ] BYO credentials modal connects channel with masked token input.
- [ ] Channel credential rotation updates access token via `rotateChannelCredentialsApi`.
- [ ] Disconnecting a channel requires guarded confirmation dialog.

### Developer Integrations

- [ ] API keys list displays prefix, status, and canonical scopes (`conversation:read`, `message:write`).
- [ ] Generating API key displays one-time raw secret with copy button.
- [ ] **Defect #213 Verified**: Revoking a key immediately marks row `REVOKED` without page reload.
- [ ] Webhook subscriptions list displays endpoint URL and verification badge.
- [ ] Registering webhook displays one-time signing secret (`whsec_...`).
- [ ] "Send Test / Verify" triggers live verification test.
- [ ] Delivery history drawer lists attempts with status codes, payload, and error messages.

### Team & Audit Logs

- [ ] Team members table displays avatars, emails, and role pills.
- [ ] Inviting a member validates email and assigns standard role.
- [ ] Revoking an invitation deletes pending invitation.
- [ ] Inline role change updates member role immediately via `PATCH /members/:memberId`.
- [ ] Removing a member triggers accessible confirmation dialog.
- [ ] Audit log table displays security events with timestamps and actors.
- [ ] Cursor pagination traverses audit event history cleanly.
- [ ] Clicking audit row opens metadata inspection sheet.
