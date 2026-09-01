# M4 Real AI Draft Assistant Execution Plan

## Outcome

M4 is complete only when an organization admin can add approved knowledge from the FlowDesk dashboard and an agent can generate a cited reply draft using a real AI provider, review it, and send it through the existing outbound pipeline.

The M4 user journey is:

```text
Admin adds knowledge
-> worker extracts, chunks, and embeds it
-> tenant-scoped pgvector index becomes ready
-> customer message appears in Inbox
-> agent requests an AI draft
-> worker retrieves tenant knowledge and calls the real model
-> cited draft appears in Inbox
-> agent edits, rejects, or approves it
-> approval uses the existing outbound intent and WhatsApp sender
```

M4 does not auto-send AI replies. `AUTO` mode, multiple AI providers, tenant-owned API keys, and advanced billing belong after this milestone.

## Current baseline

The repository already has useful M4 foundations:

- PostgreSQL knowledge, chunk, bot configuration, and bot-run tables with pgvector and forced RLS.
- OpenAI chat and embedding adapters plus deterministic fake adapters for tests.
- RAG retrieval, citation formatting, prompt safety helpers, token checks, and a circuit breaker.
- An Inbox Copilot panel and the existing manual outbound path.

The real E2E gap is narrower than the old M4 backlog suggests:

- The Bot API currently instantiates fake chat and embedding providers directly.
- There is no complete dashboard-to-worker knowledge ingestion journey.
- AI drafts are generated through a synchronous API request and primarily held in client state.
- Approval sends the draft as a normal reply, but approval/rejection is not a durable bot-run lifecycle.
- Existing automated tests mainly prove fake-provider behavior; a real provider and real embedding smoke are still required.

## Fixed decisions for M4

| Decision           | M4 choice                                        |
| ------------------ | ------------------------------------------------ |
| Chat provider      | OpenAI through the existing adapter              |
| Embedding provider | OpenAI `text-embedding-3-small`, 1536 dimensions |
| Credential scope   | One server-managed credential per environment    |
| Knowledge inputs   | Text and public website URL                      |
| Bot modes          | `OFF` and `DRAFT` only                           |
| Draft trigger      | Manual agent request from Inbox                  |
| Sending            | Human approval only                              |
| Source of truth    | PostgreSQL                                       |
| Background work    | Existing worker/outbox pattern                   |
| Realtime           | Existing organization-scoped Socket.IO hints     |

## Execution order

### 1. Wire the real OpenAI runtime

Replace direct fake-provider construction in the runtime composition root with fail-closed provider selection. Fake providers remain available only when explicitly selected for tests or local development.

Required behavior:

- Production and staging refuse to start AI work when required AI configuration is missing.
- API keys never enter browser payloads, database rows, logs, or error responses.
- Chat and embedding models, timeouts, and request limits are typed configuration.
- Provider `401`, `429`, timeout, malformed response, and `5xx` errors become stable internal error categories.
- One failed call never creates an outbound intent.

Acceptance:

- A real chat completion and a real 1536-dimensional embedding succeed in staging.
- A missing or invalid credential gives a safe operator-visible error.
- Fake output cannot appear in staging or production.

### 2. Complete dashboard knowledge ingestion

Add one small Knowledge page for organization admins. It supports pasted text and a public website URL, lists sources, and shows `queued`, `processing`, `ready`, or `failed`.

Required behavior:

- Create-source API authenticates the user and requires the knowledge-management permission.
- URL fetch blocks localhost, private/link-local networks, credentials in URLs, unsafe redirects, oversized responses, and unsupported content.
- The API stores the source and creates a durable ingestion job; it does not perform extraction or embedding inline.
- The worker extracts text, normalizes it, hashes it, chunks it, calls the real embedding provider, and writes chunks transactionally.
- Retry is bounded. Final failure leaves no orphan ready chunks and exposes a safe reason in the dashboard.
- Re-ingesting identical content does not create duplicate embeddings.

Acceptance:

- Admin can add text and a valid public URL from the dashboard.
- A ready source is retrievable only inside its organization.
- Invalid/private URLs and embedding failures are visible and safe.

### 3. Make draft generation durable

Keep the Inbox interaction simple: the agent clicks **Generate AI draft**. The API creates a bot run and schedules worker processing. The completed draft is stored in PostgreSQL and announced through Socket.IO.

Required behavior:

- The bot run snapshots organization, conversation, latest inbound message, bot config, model, prompt version, knowledge version, and idempotency key.
- The worker executes in a tenant transaction and retrieves only published/ready chunks from that organization.
- No-evidence, prompt-injection, budget, provider, and success outcomes have explicit statuses.
- Duplicate clicks for the same conversation/inbound message return the existing active run.
- A newly arrived customer message makes an older generated draft stale.
- No bot-run state is allowed to create an outbound intent automatically.

Acceptance:

- A successful run persists content, citations, token usage, latency, cost estimate, and evidence version.
- A no-evidence query escalates safely without inventing an answer.
- Browser refresh or a second agent sees the same durable draft state.

### 4. Persist human review and safe sending

The Copilot card keeps three actions: **Edit**, **Approve & Send**, and **Reject**.

Required behavior:

- Edit copies content to the composer and records that the draft was edited only when it is sent or rejected.
- Approve atomically marks the run approved and creates one standard outbound intent.
- Reject records actor, timestamp, and a small reason taxonomy.
- Approval re-checks organization, permission, conversation state, service window, latest inbound message, emergency stop, and outbound idempotency.
- Two agents approving simultaneously still create one outbound message.
- Every action is written to the audit trail without storing credentials or hidden prompts in logs.

Acceptance:

- AI output cannot leave FlowDesk before an authenticated human approval.
- Repeat approval is idempotent.
- Stale, rejected, failed, or foreign-tenant drafts cannot be sent.

### 5. Prove M4 with real E2E evidence

Run the existing quality gates, PostgreSQL/RLS integration suite, browser journey, and a controlled staging smoke using a low-cost real provider request. Update M4 evidence only after all gates pass.

Acceptance:

- Hosted PR checks pass.
- The merged staging release reports the exact commit SHA.
- The real provider chat and embedding smoke succeeds without exposing secrets.
- The full dashboard journey works from knowledge creation through approved WhatsApp send.
- Negative tenant, duplicate, no-evidence, provider failure, and approval-race cases pass.

## Issue map

The implementation is tracked in five sequential issues:

1. [#157 — Real OpenAI runtime and fail-closed configuration](https://github.com/Ryanakml/flow-desk-ai/issues/157).
2. [#158 — Dashboard knowledge ingestion and real embeddings](https://github.com/Ryanakml/flow-desk-ai/issues/158).
3. [#159 — Durable tenant-scoped AI draft worker](https://github.com/Ryanakml/flow-desk-ai/issues/159).
4. [#160 — Human approval, idempotent outbound, and audit lifecycle](https://github.com/Ryanakml/flow-desk-ai/issues/160).
5. [#161 — Real M4 E2E, staging evidence, and milestone closure](https://github.com/Ryanakml/flow-desk-ai/issues/161).

An issue may start only after its dependency is merged or the dependency contract is stable on the same integration branch.

## Definition of done

M4 is done only if all statements below are true:

- [ ] Staging uses the real OpenAI chat and embedding adapters.
- [ ] Admin can create text and URL knowledge sources from the dashboard.
- [ ] Knowledge ingestion is durable, retryable, and observable.
- [ ] PostgreSQL RLS tests prove tenant A cannot read or retrieve tenant B data.
- [ ] Drafts and citations survive browser refresh and are visible to a second authorized agent.
- [ ] No-evidence and safety failures do not produce sendable drafts.
- [ ] AI output cannot create outbound intent without human approval.
- [ ] Double-click and two-agent approval produce only one outbound message.
- [ ] Token usage, latency, model, evidence, reviewer, and outbound result are auditable.
- [ ] Local gates, hosted CI, staging deployment, and real provider smoke all pass.

## Detailed testing steps

### A. Local static and unit gates

1. Install the pinned toolchain and dependencies:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Run the complete repository verification:

   ```bash
   pnpm verify
   pnpm test:coverage
   pnpm audit --prod --audit-level high
   node scripts/scan-secrets.mjs
   ```

3. Confirm the provider unit suite covers success, timeout, `401`, `429`, `5xx`, malformed JSON, empty content, and embedding dimension mismatch.
4. Confirm fake providers remain deterministic but require explicit test/local selection.
5. Search production composition paths and verify they do not instantiate fake AI providers.

Expected result: every command exits `0`; no production runtime path defaults silently to a fake provider.

### B. PostgreSQL and RLS integration

1. Start the repository's PostgreSQL/pgvector test service using the documented local environment.
2. Run migrations with the migrator role.
3. Run the database, API, and worker integration suites:

   ```bash
   pnpm --filter @flowdesk/db test:integration
   pnpm --filter @flowdesk/api test:integration
   pnpm --filter @flowdesk/worker test:integration
   ```

4. Create tenant A and tenant B fixtures.
5. Under tenant A context, create and publish one knowledge source and its chunks.
6. Under tenant B context, attempt direct source read, chunk read, vector retrieval, bot-run read, draft approval, and deletion using tenant A identifiers.
7. Repeat the checks using the runtime database role, not the migrator/owner role.
8. Verify every foreign-tenant operation returns no row or a safe forbidden/not-found response.
9. Verify `FORCE ROW LEVEL SECURITY` remains enabled on all knowledge and bot-run tables.

Expected result: tenant B obtains zero tenant A content, citation snippets, run metadata, or outbound side effects.

### C. Knowledge ingestion journey

1. Sign in as an organization admin and open Knowledge.
2. Add a short unique text source and verify state transitions `queued -> processing -> ready`.
3. Add a valid public URL and verify extracted text, source title, chunk count, and embedding model metadata.
4. Submit the same content again and verify content hashing prevents duplicate embeddings.
5. Submit localhost, loopback, private IPv4/IPv6, link-local metadata, credential-bearing URL, unsafe redirect, oversized response, and unsupported content fixtures.
6. Simulate provider `429` and verify bounded retry/backoff.
7. Simulate permanent embedding failure and verify final `failed` status with no ready/orphan chunks.
8. Refresh the browser and open a second admin session; verify both see the same persisted state.

Expected result: valid sources become tenant-scoped searchable knowledge; invalid sources fail safely with actionable UI states.

### D. Draft generation journey

1. Ensure bot mode is `DRAFT` and emergency stop is disabled.
2. Open a conversation containing a customer question supported by the ready knowledge source.
3. Click **Generate AI draft** once.
4. Verify the UI shows queued/processing state, then a persisted draft with at least one citation.
5. Verify the bot run records the conversation, inbound message, model, prompt/knowledge versions, tokens, latency, cost estimate, and evidence.
6. Refresh the browser and open the same conversation as a second authorized agent; verify the same draft appears.
7. Click Generate twice rapidly and verify only one active run exists for that inbound message.
8. Send a newer customer message while a run is processing and verify the old draft becomes stale/non-sendable.
9. Ask an unsupported question and verify a no-evidence escalation with no sendable hallucinated draft.
10. Test prompt-injection and sensitive-data fixtures and verify safe escalation/redaction.

Expected result: drafts are grounded, durable, tenant-scoped, and never autonomously queued outbound.

### E. Human approval and outbound safety

1. Generate a valid cited draft.
2. Click **Edit**, change the text, and verify only the edited text enters the composer.
3. Approve and verify exactly one outbound intent and audit record are created.
4. Double-click Approve and verify there is still one outbound intent.
5. Have two agent sessions approve the same draft concurrently and verify one succeeds idempotently while the other receives the existing result.
6. Reject another draft and verify it cannot later be approved.
7. Attempt approval after conversation close, emergency stop, permission removal, service-window expiry, and newer inbound arrival.
8. Verify every attempt is blocked safely without a provider send.
9. Allow the valid outbound job to run and reconcile `sent`, `delivered`, and `read` status through the existing WhatsApp pipeline.

Expected result: only one current, approved draft reaches the standard outbound pipeline.

### F. Real provider and staging proof

1. Store the AI credential only in the approved staging secret store; never paste it into commands, issues, PRs, screenshots, or logs.
2. Deploy through the normal merge-triggered CI/CD path.
3. Verify `/livez` and the build-info endpoint report healthy services and the exact merged commit SHA.
4. From the dashboard, ingest one small unique text source and wait for real embedding completion.
5. Generate one cited AI draft from a matching WhatsApp test conversation.
6. Review provider usage externally and confirm one bounded chat request and expected embedding requests were recorded.
7. Approve the draft and verify the WhatsApp test number receives exactly one message.
8. Re-run with an unsupported question and provider-failure fixture; confirm no outbound message.
9. Inspect protected logs and database audit rows using identifiers/correlation IDs only; confirm no credential or raw secret appears.
10. Save CI URLs, deployed SHA, redacted run IDs, screenshots of safe dashboard states, and test results in the M4 evidence document.

Expected result: a real, tenant-isolated, human-approved AI journey is proven end to end and is reproducible by another operator.
