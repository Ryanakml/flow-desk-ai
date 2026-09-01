# M4 real AI draft assistant evidence

- Updated: 2026-09-01
- Milestone: GitHub milestone 5
- Delivery PR: #163
- Tracking issues: #157, #158, #159, #160, #161
- Release state: implementation in review; staging real-provider proof is still required

## Evidence levels

| Capability                               | Code/unit                                               | PostgreSQL CI                 | Browser                 | Real OpenAI | Staging | Status              |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------- | ----------------------- | ----------- | ------- | ------------------- |
| Fail-closed provider configuration       | Yes                                                     | N/A                           | N/A                     | Not yet     | Not yet | Implemented         |
| OpenAI chat and 1536d embedding adapters | Success/error/timeout fixtures                          | N/A                           | N/A                     | Not yet     | Not yet | Adapter-proven only |
| Text/public-URL knowledge ingestion      | Yes                                                     | Migration/RLS job             | Processing/failure UI   | Not yet     | Not yet | Implemented         |
| Durable idempotent draft worker          | Success, retry, no-evidence, safety                     | Tenant A/B and claim function | Refresh/approval flow   | Not yet     | Not yet | Implemented         |
| Human approval-only outbound             | API replay test                                         | Transactional DB primitives   | Approve flow            | N/A         | Not yet | Implemented         |
| Realtime draft visibility                | DB version trigger and authenticated organization rooms | RLS/version checks            | Poll/reconcile fallback | N/A         | Not yet | Implemented         |
| Token/latency/cost observability         | Metric tests                                            | Durable bot run fields        | Status UI               | Not yet     | Not yet | Implemented         |

## Implemented flow

```text
dashboard knowledge input
  -> tenant transaction + durable ingestion job
  -> worker extraction/chunking/OpenAI embedding
  -> tenant-filtered pgvector chunks

agent Generate Draft
  -> idempotent queued bot_run with bot config + knowledge version snapshot
  -> worker safety + PII minimization + embedding + tenant retrieval
  -> evidence gate + bounded prompt + chat provider
  -> durable draft/citations/tokens/latency/cost
  -> authenticated organization realtime hint + REST reconciliation
  -> explicit approve/edit action
  -> stale/service-window/permission check
  -> transactional message + outbox
  -> existing outbound delivery worker
```

No inbound event automatically creates or sends an AI response. The persisted bot mode accepts only
`off` and `draft`. The OpenAI credential is worker-only in the staging Compose file.

## Automated evidence

- Provider adapter tests cover success, timeout, authentication, rate limit, 5xx, malformed chat,
  empty chat, and invalid embedding shape/dimension.
- Knowledge worker tests cover 1536-dimensional storage, transient retry, permanent failure, and no
  orphan document/chunk state.
- Draft worker tests cover grounded success, PII redaction, prompt injection before provider calls,
  no evidence without chat, stale knowledge versions, output instruction leakage, and retryable
  provider failure.
- API tests cover durable enqueue without provider calls, restore after refresh, permission checks,
  atomic approval, and approval replay returning the same outbound message.
- Browser tests cover worker processing state, restored draft content, and explicit approval.
- Database integration includes migration replay, forced RLS, tenant A/B negative reads, active-run
  dedupe, and the security-definer claim boundary.
- Prometheus tests cover status, latency, token, and cost signals without tenant/content labels.

## Evidence not yet claimed

- No real OpenAI credential was used in this branch or CI.
- No real OpenAI chat/embedding call has been observed on staging.
- No M4 staging dashboard run has been captured against the merge SHA.
- No real Meta recipient delivery has been performed as part of this M4 PR.

These items must remain open in issue #161 until the steps in
`docs/runbooks/m4-real-ai-testing.md` are completed. Mock tests must not be relabeled as real-provider
or live delivery evidence.
