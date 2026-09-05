# FlowDesk Frontend Application Architecture Specification

> **Milestone**: M6.5 — Frontend Architecture & Product UI Redesign  
> **Package**: `apps/web`  
> **Status**: Authoritative Architectural Standard  
> **Target Stack**: React 19 + TanStack Router (file-based) + TanStack Query v5 + Socket.IO Realtime Adapter  
> **Related Standards**: `docs/architecture/frontend-redesign-baseline.md`, `docs/architecture/frontend-design-system.md`

---

## 1. Executive Architecture Summary

Issue `#216 (UI-02)` modernizes the `apps/web` runtime architecture from a monolithic 1,081-line `App.tsx` state machine into a modular, production-grade frontend architecture:

1. **Typed File-Based Routing**: TanStack Router (`@tanstack/react-router`) with type-safe route trees, bookmarkable deep links, and first-class 404 / error boundaries.
2. **Server-State Management**: TanStack Query (`@tanstack/react-query`) with category-specific cache lifetimes, tenant isolation, and centralized query-key factories.
3. **Realtime Synchronization Adapter**: Direct bridge connecting Socket.IO events (`realtime.event`, `realtime.ready`) to targeted query key invalidation without unconditional global cache nuking.
4. **Feature-Based Monorepo Modularity**: Domain boundaries partitioned under `apps/web/src/features/*`, isolating queries, mutations, query keys, and views per feature area.
5. **Lean Composition Root**: `App.tsx` reduced to under 30 lines as a pure provider shell (`QueryClientProvider` -> `AuthProvider` -> `RouterProvider`).
6. **Zero Functional Regression**: All existing M0–M6 production capabilities, authentication flows, bilingual internationalization, keyboard navigation, and RBAC permission gates remain intact.

---

## 2. File-Based Route Hierarchy & URL Mapping

All routes live under `apps/web/src/routes/` and compile via `@tanstack/router-plugin/vite` into `apps/web/src/routeTree.gen.ts`:

| Route Path               | File Location                          | Purpose & Deep-Linking Capability                                             | Auth & Permission Guards                                                  |
| :----------------------- | :------------------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| `/`                      | `src/routes/index.tsx`                 | Root redirect to `/inbox` on authenticated session.                           | Inherits root session guard.                                              |
| `/inbox`                 | `src/routes/inbox.tsx`                 | Omnichannel conversation triage, multi-queue filters, bilingual SLA view.     | Authenticated tenant.                                                     |
| `/inbox/$conversationId` | `src/routes/inbox.$conversationId.tsx` | Bookmarkable direct conversation thread deep-link.                            | Authenticated tenant.                                                     |
| `/analytics`             | `src/routes/analytics.tsx`             | Analytics metrics, SLA compliance charts, and CSV audit exports.              | Authenticated tenant.                                                     |
| `/knowledge`             | `src/routes/knowledge.tsx`             | AI knowledge sources, crawler, and bot configuration.                         | Authenticated tenant (`knowledge:manage` for edits).                      |
| `/channels`              | `src/routes/channels.tsx`              | WhatsApp channel integrations and Meta embedded signup.                       | Authenticated tenant (`channel:manage` for edits).                        |
| `/developer/api-keys`    | `src/routes/developer.api-keys.tsx`    | Developer external API keys, scoped credential generation and revoke.         | Authenticated tenant (`api_key:manage` for edits).                        |
| `/developer/webhooks`    | `src/routes/developer.webhooks.tsx`    | Developer webhook subscriptions, signing secret verification, and deliveries. | Authenticated tenant (`webhook:manage` for edits).                        |
| `/team`                  | `src/routes/team.tsx`                  | Team member roster, invitations, role transitions, and member revocation.     | Authenticated tenant (`membership:*` permissions).                        |
| `/audit`                 | `src/routes/audit.tsx`                 | Tamper-evident tenant audit trail log with cursor pagination.                 | Requires `audit:view` permission (renders 403 Forbidden if unauthorized). |
| `/settings/workspace`    | `src/routes/settings.workspace.tsx`    | Isolated tenant workspace information and settings.                           | Authenticated tenant.                                                     |

### Error & Not Found Handling

- `__root.tsx` defines:
  - `notFoundComponent`: Rendered when an unknown URL is requested, offering a graceful "404 — Page Not Found" glass card with a single-click return to `/inbox`.
  - `errorComponent`: Top-level route error boundary catching unhandled client rendering errors and providing recovery actions.
  - Document Title Synchronizer: Automatically updates `document.title` on route transitions (e.g. `FlowDesk — Inbox`, `FlowDesk — Developer APIs`).

---

## 3. Provider Hierarchy & Lean App Shell

The application root composition (`apps/web/src/App.tsx`) is structured with strict separation between server-state caching, authentication/tenancy context, and routing:

```
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
</QueryClientProvider>
```

### Provider Responsibilities:

1. **`QueryClientProvider`**:
   - Manages asynchronous query cache, retries, and network reconnection listeners.
   - Configured via `src/lib/query-client.ts`.
2. **`AuthProvider`**:
   - Resides in `src/features/auth/context.tsx`.
   - Manages current `sessionUser`, tenant `organizations`, `selectedOrgId`, `currentRole`, invite acceptance token flow, and first-time organization onboarding bootstrap.
   - Provides `checkPermission(permission)` helper evaluating `@flowdesk/domain` RBAC rules.
3. **`RouterProvider`**:
   - Mounts the TanStack Router instance with intent preloading and registers TypeScript router types globally.

---

## 4. TanStack Query Cache Policy & Lifecycle Management

Located in `apps/web/src/lib/query-client.ts`, the global query client applies defensive defaults:

### Global Defaults:

- **`staleTime: 0`**: Queries are fresh by default but revalidated according to domain category policies.
- **Defensive Retries**:
  - Never retries `401 Unauthorized`, `403 Forbidden`, or `404 Not Found` (avoids flooding backend on permission failure or missing records).
  - Retries transient network failures up to 2 times.
- **`refetchOnWindowFocus: false`**: Prevents disruptive background re-fetching and layout shifts while an operator is typing a customer message.
- **`refetchOnReconnect: true`**: Automatically revalidates stale queries when network reconnects.
- **Mutation Errors**: Left un-swallowed so feature forms can present immediate contextual error states.

### Category Cache Policy Matrix:

| Domain Category                                                                | Default `staleTime` | Default `gcTime` | Revalidation Trigger                                            |
| :----------------------------------------------------------------------------- | :------------------ | :--------------- | :-------------------------------------------------------------- |
| **Realtime / High Churn** (Inbox, Messages, Copilot Drafts)                    | `0 ms`              | 5 min            | Realtime Socket.IO hint, message send, operation apply.         |
| **Operational Activity** (Audit Trail, Webhook Deliveries)                     | 30 sec              | 10 min           | Pagination change, manual refresh, real-time hint.              |
| **Analytical Reporting** (Metrics, Analytics Charts)                           | 2 min               | 15 min           | Time-window filter switch (`days`), manual CSV export.          |
| **Configuration / Infrequent** (Knowledge, Channels, Team, Webhooks, API Keys) | 5 min               | 30 min           | Mutation success (create/update/delete/revoke), real-time hint. |
| **Tenant Session & Orgs**                                                      | 10 min              | 60 min           | Org switcher change, logout, invite acceptance.                 |

---

## 5. Centralized Query-Key Factory Conventions

To enforce absolute tenant boundary isolation and avoid cache collisions between different organizations, all query keys follow a strict hierarchical tuple format:

```ts
// Convention: ["organizations", organizationId, <domain>, ...qualifiers]
```

### Registered Query Key Factories:

- **Conversations (`src/features/inbox/query-keys.ts`)**:
  - `all(orgId)`: `["organizations", orgId, "conversations"]`
  - `lists(orgId)`: `["organizations", orgId, "conversations", "list"]`
  - `list(orgId, filters)`: `["organizations", orgId, "conversations", "list", filters]`
  - `details(orgId)`: `["organizations", orgId, "conversations", "detail"]`
  - `detail(orgId, convId)`: `["organizations", orgId, "conversations", "detail", convId]`
  - `messages(orgId, convId)`: `["organizations", orgId, "conversations", "detail", convId, "messages"]`
  - `workspaceResources(orgId)`: `["organizations", orgId, "conversations", "workspace-resources"]`
  - `templates(orgId, convId)`: `["organizations", orgId, "conversations", "detail", convId, "templates"]`
  - `templatePreview(orgId, convId, key)`: `["organizations", orgId, "conversations", "detail", convId, "template-preview", key]`
  - `copilotDraft(orgId, convId)`: `["organizations", orgId, "conversations", "detail", convId, "copilot-draft"]`
- **Developer API & Webhooks (`src/features/developer/query-keys.ts`)**:
  - `apiKeys(orgId)`: `["organizations", orgId, "developer", "api-keys"]`
  - `webhooks(orgId)`: `["organizations", orgId, "developer", "webhooks"]`
  - `webhookDeliveries(orgId, webhookId)`: `["organizations", orgId, "developer", "webhooks", webhookId, "deliveries"]`
- **Channels (`src/features/channels/query-keys.ts`)**:
  - `list(orgId)`: `["organizations", orgId, "channels", "list"]`
  - `detail(orgId, channelId)`: `["organizations", orgId, "channels", "detail", channelId]`
- **Team (`src/features/team/query-keys.ts`)**:
  - `members(orgId)`: `["organizations", orgId, "team", "members"]`
- **Analytics (`src/features/analytics/query-keys.ts`)**:
  - `metrics(orgId, days)`: `["organizations", orgId, "analytics", "metrics", days]`
- **Knowledge (`src/features/knowledge/query-keys.ts`)**:
  - `sources(orgId)`: `["organizations", orgId, "knowledge", "sources"]`
  - `botConfig(orgId)`: `["organizations", orgId, "knowledge", "bot-config"]`
- **Workspace (`src/features/workspace/query-keys.ts`)**:
  - `details(orgId)`: `["organizations", orgId, "workspace", "details"]`

---

## 6. Realtime Socket.IO -> Query Invalidation Adapter

Located in `apps/web/src/lib/realtime-adapter.ts`, incoming Socket.IO realtime hints are adapted into targeted query invalidations:

```
Socket.IO Event
      │
      ▼
useRealtimeSync (main socket listener)
      │
      ▼
handleRealtimeHint(queryClient, hint)
      │
      ├── resourceType: "conversation" ──► Invalidate [orgId, "conversations", "detail", resourceId]
      │                               ──► Invalidate [orgId, "conversations", "list"]
      ├── resourceType: "message"      ──► Invalidate [orgId, "conversations", "detail"]
      │                               ──► Invalidate [orgId, "conversations", "list"]
      ├── resourceType: "queue"        ──► Invalidate [orgId, "conversations", "workspace-resources"]
      │                               ──► Invalidate [orgId, "conversations", "list"]
      ├── resourceType: "team"         ──► Invalidate [orgId, "team", "members"]
      ├── resourceType: "template"     ──► Invalidate [orgId, "conversations", "detail"]
      │                               ──► Invalidate [orgId, "knowledge"]
      ├── resourceType: "organization" ──► Invalidate [orgId, "workspace", "details"]
      └── default (unmapped)          ──► Fallback conservative invalidation of [orgId, "conversations"]
```

When a reconnect gap occurs (`onReconcile`), `handleRealtimeReconciliation` invalidates all active conversation queries for the current tenant to fetch fresh authoritative state.

---

## 7. Feature Folder Structure

To ensure scalable maintainability as subsequent M6.5 UI redesign issues are implemented, feature concerns are modularized under `apps/web/src/features/`:

```
apps/web/src/features/
├── analytics/
│   ├── queries.ts          # useAnalyticsMetrics
│   └── query-keys.ts       # analyticsKeys
├── audit/
│   └── AuditView.tsx       # Extracted modular Audit trail view
├── auth/
│   ├── context.tsx         # AuthProvider and useAuth hook
│   └── query-keys.ts       # authKeys
├── channels/
│   ├── queries.ts          # useChannelsList, useChannelDetail
│   └── query-keys.ts       # channelsKeys
├── developer/
│   ├── queries.ts          # useApiKeysList, useWebhooksList, useDeliveries
│   └── query-keys.ts       # developerKeys
├── inbox/
│   ├── queries.ts          # useConversationsList, useConversationDetail, etc.
│   └── query-keys.ts       # conversationsKeys
├── knowledge/
│   ├── queries.ts          # useKnowledgeSources, useBotConfig
│   └── query-keys.ts       # knowledgeKeys
├── team/
│   ├── TeamView.tsx        # Extracted modular Team settings view
│   ├── queries.ts          # useTeamMembers
│   └── query-keys.ts       # teamKeys
└── workspace/
    ├── WorkspaceView.tsx   # Extracted modular Workspace settings view
    ├── queries.ts          # useWorkspaceDetails
    └── query-keys.ts       # workspaceKeys
```

---

## 8. Migration Safety & Verification Results

All changes in issue `#216` maintain absolute backwards compatibility:

- **Monorepo Verification**: `pnpm verify` passes 100% (Formatting, OpenAPI schema check, ESLint, TypeScript across 14 packages, Vitest across all test suites, and production builds).
- **Web App Tests**: 11 test files, 75 unit/browser/architecture tests passing cleanly.
- **Zero Visual Redesign**: Existing views (`InboxView`, `AnalyticsView`, `KnowledgeView`, `ChannelsView`, `DeveloperSettingsView`) retain identical layout, styling, and DOM node contracts.
