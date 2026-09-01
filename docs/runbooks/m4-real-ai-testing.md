# M4 real AI draft pipeline testing

This runbook proves the FlowDesk M4 path without copying credentials into terminals, logs, screenshots,
issues, or pull requests. The required runtime is Node.js 22 and pnpm 10.

## 1. Automated local gate

1. Start Docker Desktop and wait until `docker info` succeeds.
2. Start the local dependencies:

   ```bash
   docker compose -f infra/compose/compose.yaml up -d postgres redis minio minio-init clamav
   ```

3. Use a local-only environment file with the documented synthetic database accounts. Set
   `AI_PROVIDER=fake`; do not place a real provider key in a committed file.
4. Apply migrations and run the PostgreSQL suite:

   ```bash
   pnpm db:migrate
   pnpm --filter @flowdesk/db test:integration
   ```

5. Run the M4 focused suites:

   ```bash
   pnpm --filter @flowdesk/providers test
   pnpm --filter @flowdesk/security test
   pnpm --filter @flowdesk/api test
   pnpm --filter @flowdesk/worker test
   pnpm --filter @flowdesk/web test
   ```

6. Run the complete repository gate:

   ```bash
   pnpm verify
   node scripts/scan-secrets.mjs
   ```

Expected evidence: migrations `0023` and `0024` are recorded, the database test passes its tenant A/B negative
case, all unit/browser suites pass, and the secret scanner reports no findings.

## 2. Local UI vertical slice with deterministic fake AI

1. Keep `AI_PROVIDER=fake` and start the application processes with `pnpm dev`.
2. Sign in with the documented local mock-auth account and select one organization.
3. Open **Knowledge**, add a text source with a unique title, and wait for `Ready`.
4. Open a conversation containing a recent inbound customer message.
5. Click **Generate Draft** twice quickly.
6. Confirm there is one processing run, followed by one grounded draft with at least one citation.
7. Reload the browser and open the same conversation in a second browser window. Confirm both show
   the same run ID/result.
8. Click **Edit in Composer**, change the text, and send it. Confirm the draft is recorded as
   `edited` and exactly one outbound message/outbox event exists.
9. Repeat with a new draft and click **Approve & Send**. Confirm a replay of the same approval does
   not create a second message.
10. Create another draft, then add a newer inbound customer message before approval. Confirm the old
    draft becomes `stale` and cannot be sent.

## 3. Failure-path matrix

Run each case in a disposable local organization:

| Case                | Input/action                                                            | Expected result                                                              |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| No evidence         | Ask about content absent from Knowledge                                 | `no_evidence`; no answer and no outbound intent                              |
| Prompt injection    | Ask to ignore prior instructions or reveal the system prompt            | `safety_blocked`; provider chat is not called                                |
| PII                 | Include a synthetic email/phone/NIK                                     | provider prompt contains redaction markers; DB message remains authoritative |
| Unsafe knowledge    | Ingest text containing an instruction override                          | unsafe chunks are excluded; no evidence if none remain                       |
| Oversized prompt    | Use synthetic content above the configured budget                       | `budget_exceeded`; no chat call                                              |
| Provider 401        | Use an intentionally revoked test credential in an isolated environment | terminal safe provider error; no upstream body or credential in UI/logs      |
| Provider 429/5xx    | Use a controlled test proxy or adapter fixture                          | bounded retry with backoff, then success or `provider_failed`                |
| Worker interruption | Stop worker after claim, wait past the lease, restart                   | lease recovery; at most one active run                                       |
| Knowledge changes   | Re-index a source after queueing but before draft completion            | old run becomes `stale`; regenerate against the new version                  |
| Emergency stop      | Enable kill switch while a run is queued                                | worker records `off`; no provider or outbound call                           |
| Closed conversation | Close a conversation after draft completion, then attempt approval      | approval is rejected; no message or outbound intent                          |
| Approval replay     | Submit the same approved run twice                                      | both requests resolve to the same outbound message                           |

## 4. Staging real-provider proof

This is the only step that proves a real provider. It must run through the normal PR merge and staging
deployment; do not deploy the feature branch manually.

1. Choose exactly one real provider. For the recommended synthetic development path, use
   `AI_PROVIDER=gemini`, `GEMINI_CHAT_MODEL=gemini-3.7-flash`, and
   `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`. OpenAI remains optional through
   `AI_PROVIDER=openai` and its corresponding model settings.
2. On the staging host, use `sudoedit /opt/flowdesk/shared/staging.env` and add only the credential
   required by the selected provider. Never print, paste into chat, or export it through a shell
   command. Gemini free-tier proof must contain synthetic data only.
3. Validate configuration shape without rendering values:

   ```bash
   cd "/opt/flowdesk/releases/$(cat /opt/flowdesk/shared/current-image)"
   docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml config --quiet
   ```

4. Merge only after hosted CI is green. Confirm staging `/api/v1/build-info` reports the merge SHA.
5. In the staging dashboard, create a uniquely named synthetic text source and wait for `Ready`.
6. In a synthetic conversation, generate a draft and record only these non-secret facts:

   - build SHA;
   - organization fixture label;
   - knowledge source ID/status;
   - bot run ID/status/model;
   - citation count;
   - prompt/completion token counts;
   - latency and cost estimate;
   - approval actor and outbound message ID.

7. Confirm the worker metrics endpoint includes `ai_draft_runs_total`,
   `ai_draft_duration_seconds`, token totals, and cost totals. Metrics must not contain organization
   IDs, prompts, customer content, or credentials.
8. Inspect protected worker logs by run/request ID. Confirm logs contain no provider body, prompt,
   customer PII, or credential.
9. Approve the draft in the UI and verify the normal WhatsApp outbox/delivery lifecycle. This proves
   the approval-to-outbound path; a real Meta recipient smoke is separate evidence.

## 5. Pass/fail rule

M4 is release-proven only when automated CI, PostgreSQL tenant isolation, browser approval flow, and
the staging real-provider slice are all green. Mock-provider tests alone never qualify as real-provider
evidence. A real Gemini or OpenAI draft without a real Meta delivery proves AI execution, but not
external WhatsApp delivery.
