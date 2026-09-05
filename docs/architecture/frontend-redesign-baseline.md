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

1. **Zero Backend Changes**: 100% of API endpoints, route definitions, controller logic, and HTTP status codes in `apps/api` and `apps/worker` remain untouched.
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
│   ├── api/             # Fastify REST API & contracts
│   ├── web/             # React 19 + Vite SPA (Primary redesign target)
│   │   ├── src/
│   │   │   ├── App.tsx                    # 1,081 LOC, ~37KB - Monolithic root controller
│   │   │   ├── InboxView.tsx              # 1,780 LOC, ~68KB - Core 3-pane operational inbox
│   │   │   ├── AnalyticsView.tsx          # 336 LOC, ~11KB - Operational metrics & CSV export
│   │   │   ├── KnowledgeView.tsx          # 533 LOC, ~18KB - RAG sources, bot mode, policy simulator
│   │   │   ├── ChannelsView.tsx           # 463 LOC, ~15KB - WhatsApp Cloud API & Meta onboarding
│   │   │   ├── DeveloperSettingsView.tsx  # 688 LOC, ~27KB - Scoped API keys & webhooks
│   │   │   ├── api.ts                     # 879 LOC, ~26KB - Typed HTTP fetch client
│   │   │   ├── automation-api.ts          # 118 LOC, ~3.6KB - M5 automation policy client
│   │   │   ├── realtime.ts                # 136 LOC, ~4KB - Socket.IO projection sync client
│   │   │   ├── styles.css                 # 1,779 LOC, ~35KB - Monolithic global CSS
│   │   │   └── main.tsx                   # SPA bootstrap entrypoint
│   │   └── package.json                   # React 19, Vite, Socket.IO, Vitest, axe-core
│   └── worker/          # BullMQ background workers (webhooks, WhatsApp, AI drafts)
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
  - _Left_: Conversation list with filter tabs (All, Mine, Unassigned), search input, queue selector.
  - _Center_: Conversation header, message timeline, AI draft card, message composer, template selector.
  - _Right_: Customer attributes, conversation details, RAG citations list.
- **State Management**: Complex local state (`selectedConversationId`, `conversations`, `messages`, `activeDraft`, `templateVariables`).
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/conversations` (`listConversations`)
  - `GET /api/v1/organizations/:orgId/conversations/:id` (`getConversation`)
  - `POST /api/v1/organizations/:orgId/conversations/:id/messages` (`createOutboundMessage`)
  - `POST /api/v1/organizations/:orgId/conversations/:id/operations` (`performConversationOperation` - assign, resolve)
  - `POST /api/v1/organizations/:orgId/conversations/:id/drafts/:runId/actions` (`submitBotDraftActionApi` - approve, edit, discard)
  - `GET /api/v1/organizations/:orgId/inbox/resources` (`getInboxWorkspaceResources`)
  - `POST /api/v1/organizations/:orgId/templates/preview` (`previewTemplate`)
  - `POST /api/v1/organizations/:orgId/uploads/sessions` (`createUploadSession`)
  - `GET /api/v1/organizations/:orgId/attachments/:id` (`getAttachmentDetail`)
- **Realtime Integration**: Emits `room.join` (`{ type: "conversation", id }`); receives `projection.changed` hints and executes `onReconcile`.
- **Permissions Gated**:
  - `conversation:assign` (assign/reassign conversation)
  - `conversation:resolve` (resolve conversation)
  - `message:send` (send outbound message or template)
- **Supported Capabilities**: Real AI drafts with `ConfidenceMeter`, expandable RAG citations (`chunkId`, `documentTitle`, `snippet`, `score`), WhatsApp pre-approved templates with variable substitution, media attachment uploads.
- **Non-Existent / Unsupported**: Typing indicators (Socket.IO does not emit them), live per-conversation SLA countdowns (only aggregate SLA in Analytics).

### Surface 2: Real-Time Analytics & SLA (`AnalyticsView.tsx`)

- **File & Size**: `apps/web/src/AnalyticsView.tsx` (336 lines, ~11KB).
- **Purpose**: Operational throughput, bot automation rate, and SLA monitoring.
- **Current Layout**: Header with time-range dropdown and export button; static text cards for metrics; unstyled list for daily volume series.
- **State Management**: `useState` for `data`, `loading`, `error`, `exporting`, `timeRange`.
- **APIs Invoked**:
  - `GET /api/v1/organizations/:orgId/analytics/overview?days=:days` (`getAnalyticsMetricsApi`)
  - `GET /api/v1/organizations/:orgId/analytics/export` (`exportAnalyticsReportApi`)
- **Realtime Integration**: None (on-demand query with cancel token).
- **Permissions Gated**: `analytics:view` (held by `owner`, `admin`, `supervisor`, `analyst`).
- **Supported Time Ranges**: Strictly `7`, `14`, and `30` days.
- **Supported Metrics**:
  - `overview`: `totalConversations`, `openConversations`, `assignedConversations`, `resolvedConversations`, `totalMessages`, `inboundMessages`, `outboundMessages`, `botMessages`, `humanMessages`, `botAutomationRate`, `slaMetPercentage`, `avgFirstResponseTimeSeconds`, `avgResolutionTimeSeconds`.
  - `volumeSeries`: array of `{ date, inbound, outbound, bot }`.
- **Compliance Export**: Downloads 30-day compliance report CSV and durably writes an `analytics.exported` audit event in the database.
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
  - `POST /api/v1/organizations/:orgId/automation/emergency-stop` (`setAutomationEmergencyStop`)
  - `GET /api/v1/organizations/:orgId/automation/policies` (`fetchAutomationPolicies`)
  - `POST /api/v1/organizations/:orgId/automation/policies/:id/publish` (`publishAutomationPolicy`)
  - `POST /api/v1/organizations/:orgId/automation/policies/simulate` (`simulateAutomationPolicy`)
- **Permissions Gated**: `automation:publish` (required for adding sources, altering bot mode, toggling emergency stop, publishing policies, and running simulation).
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
  - `POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/start` (`startWhatsAppEmbeddedSignupApi`)
  - `POST /api/v1/organizations/:orgId/channels/whatsapp/embedded-signup/complete` (`completeWhatsAppEmbeddedSignupApi`)
  - `POST /api/v1/organizations/:orgId/channels/:id/verify` (`verifyChannelApi`)
  - `DELETE /api/v1/organizations/:orgId/channels/:id` (`deleteChannelApi`)
- **Permissions Gated**: `automation:publish` (required for connecting, verifying, or deleting channels).
- **Credential Security**: Stored tokens are never returned by the backend. Rotating credentials requires entering a new access token.
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
  - `PUT /api/v1/organizations/:orgId/members/:id/role` (`updateMemberRole`)
  - `DELETE /api/v1/organizations/:orgId/members/:id` (`revokeMember`)
- **Permissions Gated**:
  - `membership:invite` (trigger invitation modal)
  - `membership:modify` (change member role dropdown)
  - `membership:revoke` (remove team member)
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
  - `POST /api/v1/organizations/bootstrap` (`bootstrapOrganization`)
  - `POST /api/v1/invitations/accept` (`acceptInvitation`)

---

## 4. Comprehensive API Dependency Matrix

| Surface          | Endpoint                                                               | Method   | Client Helper                       | Zod / Schema Contract                          |
| :--------------- | :--------------------------------------------------------------------- | :------- | :---------------------------------- | :--------------------------------------------- |
| **Auth / Shell** | `/api/v1/system/build`                                                 | `GET`    | `getBuildInfo`                      | `BuildInfoSchema`                              |
| **Auth / Shell** | `/api/v1/auth/session`                                                 | `GET`    | `getSession`                        | `SessionStateSchema`                           |
| **Auth / Shell** | `/api/v1/auth/logout`                                                  | `POST`   | `logout`                            | Raw JSON (`{ status, logoutUrl }`)             |
| **Auth / Shell** | `/api/v1/organizations`                                                | `GET`    | `listUserOrganizations`             | `ListUserOrganizationsResponseSchema`          |
| **Auth / Shell** | `/api/v1/organizations/bootstrap`                                      | `POST`   | `bootstrapOrganization`             | `BootstrapOrganizationResponseSchema`          |
| **Auth / Shell** | `/api/v1/invitations/accept`                                           | `POST`   | `acceptInvitation`                  | `AcceptInvitationResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:id/conversations`                              | `GET`    | `listConversations`                 | `ListConversationsResponseSchema`              |
| **Inbox**        | `/api/v1/organizations/:id/conversations/:id`                          | `GET`    | `getConversation`                   | `ConversationDetailResponseSchema`             |
| **Inbox**        | `/api/v1/organizations/:id/conversations/:id/messages`                 | `POST`   | `createOutboundMessage`             | `MessageSchema`                                |
| **Inbox**        | `/api/v1/organizations/:id/conversations/:id/operations`               | `POST`   | `performConversationOperation`      | `ConversationSchema`                           |
| **Inbox**        | `/api/v1/organizations/:id/conversations/:id/drafts/:runId/actions`    | `POST`   | `submitBotDraftActionApi`           | `GenerateBotDraftResponseSchema`               |
| **Inbox**        | `/api/v1/organizations/:id/inbox/resources`                            | `GET`    | `getInboxWorkspaceResources`        | `InboxWorkspaceResourcesResponseSchema`        |
| **Inbox**        | `/api/v1/organizations/:id/templates/preview`                          | `POST`   | `previewTemplate`                   | `TemplatePreviewResponseSchema`                |
| **Inbox**        | `/api/v1/organizations/:id/uploads/sessions`                           | `POST`   | `createUploadSession`               | `CreateUploadSessionResponseSchema`            |
| **Inbox**        | `/api/v1/organizations/:id/attachments/:id`                            | `GET`    | `getAttachmentDetail`               | `AttachmentDetailResponseSchema`               |
| **Analytics**    | `/api/v1/organizations/:id/analytics/overview`                         | `GET`    | `getAnalyticsMetricsApi`            | `AnalyticsMetricsResponseSchema`               |
| **Analytics**    | `/api/v1/organizations/:id/analytics/export`                           | `GET`    | `exportAnalyticsReportApi`          | Blob (CSV)                                     |
| **Knowledge**    | `/api/v1/organizations/:id/knowledge/sources`                          | `GET`    | `listKnowledgeSourcesApi`           | `ListKnowledgeSourcesResponseSchema`           |
| **Knowledge**    | `/api/v1/organizations/:id/knowledge/sources`                          | `POST`   | `createKnowledgeSourceApi`          | `CreateKnowledgeSourceResponseSchema`          |
| **Knowledge**    | `/api/v1/organizations/:id/bot/config`                                 | `GET`    | `getBotConfig`                      | `BotConfigSchema`                              |
| **Knowledge**    | `/api/v1/organizations/:id/bot/config`                                 | `PUT`    | `updateBotConfig`                   | `BotConfigSchema`                              |
| **Knowledge**    | `/api/v1/organizations/:id/automation/emergency-stop`                  | `POST`   | `setAutomationEmergencyStop`        | Raw JSON (`{ enabled }`)                       |
| **Knowledge**    | `/api/v1/organizations/:id/automation/policies`                        | `GET`    | `fetchAutomationPolicies`           | `z.array(AutomationPolicySchema)`              |
| **Knowledge**    | `/api/v1/organizations/:id/automation/policies/:id/publish`            | `POST`   | `publishAutomationPolicy`           | `AutomationPolicySchema`                       |
| **Knowledge**    | `/api/v1/organizations/:id/automation/policies/simulate`               | `POST`   | `simulateAutomationPolicy`          | `SimulatePolicyResponseSchema`                 |
| **Channels**     | `/api/v1/organizations/:id/channels`                                   | `GET`    | `listChannelsApi`                   | `ChannelClientRecord[]`                        |
| **Channels**     | `/api/v1/organizations/:id/channels`                                   | `POST`   | `connectWhatsAppWithTokenApi`       | `CompleteWhatsAppEmbeddedSignupResponseSchema` |
| **Channels**     | `/api/v1/organizations/:id/channels/whatsapp/embedded-signup/start`    | `POST`   | `startWhatsAppEmbeddedSignupApi`    | `StartWhatsAppEmbeddedSignupResponseSchema`    |
| **Channels**     | `/api/v1/organizations/:id/channels/whatsapp/embedded-signup/complete` | `POST`   | `completeWhatsAppEmbeddedSignupApi` | `CompleteWhatsAppEmbeddedSignupResponseSchema` |
| **Channels**     | `/api/v1/organizations/:id/channels/:id/verify`                        | `POST`   | `verifyChannelApi`                  | `ChannelClientRecord`                          |
| **Channels**     | `/api/v1/organizations/:id/channels/:id`                               | `DELETE` | `deleteChannelApi`                  | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:id/developer/api-keys`                         | `GET`    | `listApiKeysApi`                    | `DeveloperApiKeyRecord[]`                      |
| **Developer**    | `/api/v1/organizations/:id/developer/api-keys`                         | `POST`   | `createApiKeyApi`                   | `DeveloperApiKeyRecord & { rawKey }`           |
| **Developer**    | `/api/v1/organizations/:id/developer/api-keys/:id`                     | `DELETE` | `revokeApiKeyApi`                   | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:id/developer/webhooks`                         | `GET`    | `listWebhooksApi`                   | `WebhookSubscriptionClientRecord[]`            |
| **Developer**    | `/api/v1/organizations/:id/developer/webhooks`                         | `POST`   | `createWebhookApi`                  | `WebhookSubscriptionClientRecord & { secret }` |
| **Developer**    | `/api/v1/organizations/:id/developer/webhooks/:id`                     | `DELETE` | `deleteWebhookApi`                  | Raw JSON                                       |
| **Developer**    | `/api/v1/organizations/:id/developer/webhooks/:id/test`                | `POST`   | `testWebhookApi`                    | Raw JSON (`{ eventId, queued }`)               |
| **Developer**    | `/api/v1/organizations/:id/developer/webhooks/:id/deliveries`          | `GET`    | `listWebhookDeliveriesApi`          | `WebhookDeliveryClientRecord[]`                |
| **Team**         | `/api/v1/organizations/:id/members`                                    | `GET`    | `listMembers`                       | `ListMembersResponseSchema`                    |
| **Team**         | `/api/v1/organizations/:id/invitations`                                | `POST`   | `inviteMember`                      | `CreateInvitationResponseSchema`               |
| **Team**         | `/api/v1/organizations/:id/members/:id/role`                           | `PUT`    | `updateMemberRole`                  | Raw JSON                                       |
| **Team**         | `/api/v1/organizations/:id/members/:id`                                | `DELETE` | `revokeMember`                      | Raw JSON                                       |
| **Audit**        | `/api/v1/organizations/:id/audit-logs`                                 | `GET`    | `listAuditLogs`                     | `ListAuditLogsResponseSchema`                  |

---

## 5. Realtime Transport & Projection Synchronization

FlowDesk's realtime layer in `apps/web/src/realtime.ts` does **not** rely on arbitrary socket events (e.g. `message:created`, `conversation:updated`). Instead, it implements a **versioned projection hint system**:

### Socket Lifecycle & Handshake

1. **Connection**: Connects to `/realtime` via WebSocket/polling with credentials:
   ```typescript
   auth: {
     (organizationId, lastVersion);
   }
   ```
2. **Readiness (`realtime.ready`)**: Server emits current authoritative version:
   ```typescript
   { currentVersion: number, reconcileRequired: boolean }
   ```
   If `reconcileRequired` is `true`, client immediately invokes `options.onReconcile()`.
3. **Projection Events (`projection.changed`)**: Server broadcasts version hints:
   ```typescript
   { version: number, entityType: string, entityId: string, timestamp: string }
   ```
   If `hint.version > lastVersion + 1`, a sequence gap occurred; client triggers full reconciliation (`onReconcile()`). Otherwise, updates `lastVersion` and notifies `onHint()`.
4. **Room Subscriptions**: Client emits `room.join` (`{ type: "conversation", id: activeConversationId }`) when viewing a specific conversation.
5. **Security Gating (`access.revoked`)**: Server emits revocation notifications (`{ code, roomType }`), causing client to disconnect or redirect.

### TanStack Query Integration Architecture

In the modernized architecture (UI-02), realtime events must drive declarative cache invalidation rather than imperative component mutations:

- `onReconcile()` → Invokes `queryClient.invalidateQueries({ queryKey: conversationsKeys.all(orgId) })`.
- `onHint(hint)` → Evaluates `hint.entityType`:
  - `conversation` → invalidates `conversationsKeys.detail(orgId, hint.entityId)`.
  - `draft` → invalidates `conversationsKeys.draft(orgId, hint.entityId)`.

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

Visual baseline capture and testing must target three standard viewports:

| Tier        | Dimensions     | Layout Behavior                                                                                                                                                                    |
| :---------- | :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop** | **1440 × 900** | Permanent collapsible sidebar; 3-pane resizable Inbox (`react-resizable-panels`); 4-column metric cards; side-by-side management cards.                                            |
| **Tablet**  | **1024 × 768** | Collapsed sidebar (slide-out Sheet); 2-pane Inbox (Queue + Message stream; Right context panel in sliding Sheet); 2-column metric cards.                                           |
| **Mobile**  | **375 × 812**  | Hamburger header with drawer navigation; 1-pane Inbox (Queue view drills down into `/inbox/:conversationId`); single-column stacked forms/cards; horizontal scrolling data tables. |

---

## 10. Test Coverage & Verification Baseline

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

## 11. Code Donor & Architectural Reference Guidelines

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

## 12. Page-by-Page Regression Checklist

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
- [ ] Media attachments upload and download via signed sessions.
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
- [ ] Inline role change updates member role immediately.
- [ ] Removing a member triggers accessible confirmation dialog.
- [ ] Audit log table displays security events with timestamps and actors.
- [ ] Cursor pagination traverses audit event history cleanly.
- [ ] Clicking audit row opens metadata inspection sheet.
