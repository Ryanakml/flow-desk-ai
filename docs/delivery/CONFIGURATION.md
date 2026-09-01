# Configuration contract

All processes read environment variables through `@flowdesk/config`; direct reads are limited to bootstrapping a role-specific port before schema validation. Invalid values abort startup before accepting work. Local defaults are permitted only where they are harmless; secrets never receive code defaults.

`.env.example` is the canonical local inventory and contains synthetic local-only values. Production secrets must arrive as secret-manager references or injected runtime values, never source, image layers, Terraform state, client bundles, or logs. A new variable requires schema, example/inventory, owner, sensitivity, rotation behavior, and tests in the same change.

| Group            | Examples                                   | Rule                                                     |
| ---------------- | ------------------------------------------ | -------------------------------------------------------- |
| Runtime identity | `APP_ENV`, `SERVICE_VERSION`, `GIT_SHA`    | Required or safe build-time value; emitted in telemetry  |
| Network          | role-specific ports, public URLs           | Validate ranges and URL format                           |
| Dependencies     | `DATABASE_URL`, `REDIS_URL`, S3 settings   | Validate before the role first depends on them           |
| Secrets          | signing, encryption, Meta, AI, Stripe keys | Reference/injection only; fail closed                    |
| Telemetry        | log level, OTLP endpoint                   | Redact payload and preserve environment/service identity |
| Safety flags     | bot auto-send default                      | The safe default is always false                         |

Environment isolation is strict: local, preview, staging, and production never share database, Redis, bucket, provider sender, or secrets.

M3 media runtime variables are validated together. Staging and production require `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `CLAMAV_HOST`; startup fails before work is accepted if any is absent. `S3_ENDPOINT` is optional for AWS and required by local MinIO, while `S3_FORCE_PATH_STYLE` defaults false. `CLAMAV_PORT` defaults to `3310`. Retention defaults are `MEDIA_CLEAN_RETENTION_DAYS=90` and `MEDIA_REJECTED_RETENTION_DAYS=7`; policy changes require product/privacy approval and a deletion rehearsal.

M4 AI runtime variables are worker-only. `AI_PROVIDER` defaults to `disabled`; `fake` is rejected in
staging and production. `gemini` is the recommended real provider for synthetic development and
requires a server-injected `GEMINI_API_KEY`; its stable defaults are `gemini-3.7-flash` and
`gemini-embedding-2`. The embedding adapter requests 1536 dimensions to remain compatible with the
existing pgvector index. `openai` remains optional and requires `OPENAI_API_KEY`. Both real providers
require HTTPS base URLs, bounded timeouts, and an output-token cap.

Provider keys are not passed to web, API, ingress, scheduler, image builds, or CI. Provider/model
identifiers may appear in protected metrics and run audit metadata; credentials, prompts, retrieved
content, provider bodies, and customer PII must not appear in logs or metric labels. Gemini free-tier
testing must use synthetic data only because the provider terms permit free-tier inputs and outputs
to be used for product improvement. Customer data requires an approved paid/provider data policy.
