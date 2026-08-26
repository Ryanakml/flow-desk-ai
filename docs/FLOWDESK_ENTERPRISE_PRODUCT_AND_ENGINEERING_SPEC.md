# FlowDesk - Enterprise Product, Engineering, Security, and Operations Specification

**Status:** authoritative build manual  
**Version:** 3.0.0  
**Audience:** founder, product, design, engineering, QA, security, DevOps/SRE, support, finance, and implementation partners  
**Last updated:** 25 August 2026  
**Project state:** pre-development, build-ready planning

> Dokumen ini bukan proposal singkat, bukan PRD ringan, dan bukan blueprint high-level. Dokumen ini adalah spesifikasi implementasi menyeluruh untuk membangun FlowDesk dari nol sampai siap dijual, dioperasikan, diaudit, dan di-scale sebagai SaaS enterprise.

---

## 1. Tujuan Dokumen

Dokumen ini menjadi acuan utama untuk:

1. menentukan ruang lingkup produk yang benar-benar akan dibangun,
2. mengunci keputusan arsitektur dan tech stack,
3. menjelaskan detail implementasi modul per modul,
4. mendefinisikan standar engineering, security, dan operasional,
5. memastikan hasil akhir bukan demo, tetapi platform yang layak dipakai pelanggan berbayar.

Yang dimaksud "selesai" untuk FlowDesk bukan hanya:

- UI tampil,
- API bisa di-hit,
- bot bisa membalas,
- Docker bisa jalan secara lokal.

Yang dimaksud "selesai" adalah:

- fitur bekerja sesuai acceptance criteria,
- aman untuk data tenant,
- dapat diobservasi dan di-debug,
- ada mekanisme retry, reconciliation, dan recovery,
- ada test coverage yang relevan,
- ada CI/CD yang repeatable,
- ada runbook operasi,
- ada pembatasan biaya,
- ada kesiapan support dan incident response,
- ada jalur rollout, rollback, dan go-live yang terkendali.

---

## 2. Definisi Produk

FlowDesk adalah platform otomasi komunikasi bisnis berbasis **WhatsApp Business Platform (Cloud API)** untuk organisasi multi-tenant. Fokus utamanya adalah:

- menerima dan memproses percakapan customer secara real-time,
- memberi tim operasional inbox bersama untuk menangani percakapan,
- mengotomasi respons menggunakan AI yang dibatasi oleh knowledge base tenant,
- menjaga kontrol manusia penuh terhadap automasi,
- menyediakan auditability, reliability, dan operability level enterprise.

FlowDesk **bukan**:

- WhatsApp mod/unofficial client,
- browser automation untuk akun WhatsApp personal,
- bulk sender tanpa governance,
- sistem yang mencoba mengakali policy Meta,
- AI agent yang bebas bertindak tanpa guardrail.

Semua constraint resmi dari Meta harus dianggap sebagai aturan sistem:

- onboarding akun dan nomor,
- template approval,
- service window,
- rate limit,
- message quality,
- webhook format,
- policy dan compliance provider.

---

## 3. Sasaran Bisnis dan Positioning

### 3.1 Outcome bisnis yang harus dicapai

FlowDesk harus memungkinkan pelanggan:

- menurunkan waktu respons pertama,
- mengurangi beban manual agent,
- menjaga konsistensi jawaban,
- meningkatkan conversion atau resolution rate,
- tetap memiliki kendali operasional penuh saat bot tidak memadai.

### 3.2 Target customer ideal

Target awal yang masuk akal:

- SMB sampai mid-market yang mengandalkan WhatsApp untuk sales dan support,
- agency yang mengelola beberapa brand,
- ecommerce, klinik, edukasi, jasa profesional, dan layanan lokal,
- organisasi yang membutuhkan team inbox, assignment, dan otomatisasi dengan approval.

### 3.3 Positioning produk

FlowDesk harus diposisikan sebagai:

- official WhatsApp operation platform,
- AI-assisted team inbox,
- multi-tenant SaaS dengan security dan auditability,
- bukan sekadar chatbot builder.

### 3.4 Packaging komersial minimum

Sebelum produk dijual, FlowDesk harus sudah punya definisi:

- paket harga,
- kuota seat,
- batas channel/nomor,
- batas AI usage,
- batas knowledge storage,
- batas API/webhook,
- SLA/support tier,
- kebijakan fair use,
- kebijakan trial,
- kebijakan suspend/grace period.

Logika plan tidak boleh tersebar sebagai `if plan === 'pro'` di banyak tempat. Semua entitlement harus didefinisikan sebagai data dan dievaluasi oleh service khusus.

---

## 4. Prinsip Produk dan Prinsip Engineering

### 4.1 Prinsip produk

1. **Human override first**
   Operator harus selalu bisa mengambil alih percakapan.
2. **Safe automation**
   Bot hanya boleh bertindak dalam konteks yang diizinkan.
3. **Explained actions**
   Setiap aksi bot harus bisa dijelaskan.
4. **Trustworthy SaaS**
   Tenant harus yakin datanya terisolasi.
5. **Operable under failure**
   Sistem harus tetap jelas perilakunya saat provider, AI, atau queue bermasalah.

### 4.2 Prinsip engineering

1. **Durable before asynchronous**
   Webhook tidak dianggap diterima sebelum tercatat durable.
2. **Idempotency everywhere**
   Inbound, outbound, billing usage, webhook, dan retried jobs harus tahan duplikasi.
3. **Database is source of truth**
   Redis hanya cache, queue transport, atau coordination layer.
4. **Policy in one place**
   Aturan eligibility, authorization, service window, retention, dan entitlements tidak boleh tercerai-berai.
5. **Defense in depth**
   Frontend check tidak cukup; backend authorization tidak cukup; ORM scoping tidak cukup; database policy tetap wajib.
6. **Observable by default**
   Semua alur penting harus punya log, metric, trace, dan audit.
7. **Migration discipline**
   Tidak ada perubahan schema yang mengandalkan keberuntungan.

---

## 5. Persona dan Permission Model

### 5.1 Persona inti

| Persona | Tujuan utama | Cakupan akses |
|---|---|---|
| Platform super-admin | support operasional, respons insiden, tenant operations | aplikasi terpisah, akses just-in-time, diaudit |
| Organization owner | memiliki akun, billing, sender, security policy | penuh untuk tenant sendiri |
| Organization admin | konfigurasi tim, channel, bot, knowledge, report | admin tenant tanpa hak ownership global |
| Supervisor | memonitor queue dan performa agent/bot | inbox, analytics, assignment, review |
| Agent/operator | menjawab customer dan menangani percakapan | inbox terbatas sesuai role/team |
| Analyst | membaca analytics | read-only dengan redaksi data sensitif |
| Developer/integrator | menggunakan API key/integration webhook | machine scope, bukan pengganti user interaktif |

### 5.2 Permission model

Permission model harus:

- deny by default,
- role-based dengan kemungkinan fine-grained permission,
- dievaluasi server-side,
- versioned dan unit-tested,
- mendukung scoped access per organization, team, queue, dan channel bila dibutuhkan.

Contoh permission:

- `conversation.read`
- `conversation.assign`
- `conversation.send`
- `conversation.pause_bot`
- `conversation.export`
- `bot.publish`
- `knowledge.write`
- `billing.manage`
- `team.manage`
- `audit.read`
- `integration.manage`
- `support.impersonate`

### 5.3 Ketentuan khusus

- Tidak ada hidden admin route di aplikasi tenant.
- Support impersonation harus punya alasan, masa berlaku, dan audit.
- Permission tidak boleh hanya berdasarkan role string di frontend.
- Semua perubahan permission/role harus tercatat di audit log.

---

## 6. Scope Produk

### 6.1 Scope GA

FlowDesk GA harus mencakup:

- organization onboarding,
- official WhatsApp channel connection,
- user/team/role management,
- contacts,
- shared inbox,
- inbound dan outbound messaging,
- template management dan template send,
- assignment dan routing,
- notes, tags, status percakapan,
- bot studio,
- knowledge ingestion dan knowledge versioning,
- AI-assisted reply draft dan optional auto-send,
- analytics dasar,
- billing and entitlements,
- API keys dan outgoing webhooks,
- audit logging,
- observability, backup, incident readiness.

### 6.2 Out of scope GA

Yang secara eksplisit tidak dimasukkan ke GA:

- mobile app native,
- multi-channel live selain WhatsApp,
- autonomous agent dengan external tool execution,
- marketplace publik,
- white-label multi-brand extreme customization,
- on-premise HA complex cluster untuk semua customer.

### 6.3 Fase sesudah GA

Kemampuan yang bisa disiapkan extension point-nya:

- Instagram DM,
- Telegram,
- email/ticket bridge,
- native mobile app,
- customer portal,
- advanced workflow builder,
- AI summarization/QA/copilot lebih lanjut,
- SCIM, SAML advanced enterprise pack,
- multi-region active-active read/write.

---

## 7. Target Kualitas, NFR, dan SLO

### 7.1 Sasaran non-fungsional minimum

| Area | Target awal |
|---|---:|
| Webhook acceptance latency | p95 < 2 detik |
| Inbound ke inbox UI | p95 < 5 detik |
| Manual send accepted | p95 < 3 detik |
| Automation first response | p95 < 15 detik |
| API availability | 99.9% bulanan |
| Enterprise tier availability | 99.95% target jangka lanjut |
| RPO | <= 5 menit |
| RTO | <= 4 jam |
| Tenant isolation incidents | 0 |
| AI grounded response pass rate | >= 85% pada evaluation set yang disetujui |

### 7.2 NFR detail

Sistem harus memenuhi:

- multi-tenant isolation,
- append-only auditability untuk aksi sensitif,
- encrypted secrets dan sensitive data,
- resumable background processing,
- bounded retry,
- cost control untuk AI dan infra,
- backup dan restore yang diuji,
- traceability end-to-end,
- graceful degradation saat provider gagal.

### 7.3 Error budget

Ketika SLO reliability terlanggar secara material:

- freeze deploy fitur non-esensial,
- prioritaskan bug fix, hardening, dan capacity work,
- dokumentasikan corrective action,
- ukur efektivitas perbaikannya.

---

## 8. Customer Journeys dan Acceptance Criteria

### 8.1 Onboarding organisasi

Flow:

1. owner mendaftar,
2. verifikasi email,
3. membuat organization,
4. memilih region default, timezone, dan bahasa,
5. memilih paket/trial,
6. mengundang anggota awal,
7. menghubungkan channel WhatsApp,
8. mengatur business hours,
9. mengunggah knowledge awal,
10. mengaktifkan bot jika semua prasyarat terpenuhi.

Acceptance:

- onboarding bisa dipause dan dilanjutkan,
- setiap step memiliki status dan remediation yang jelas,
- secret provider tidak pernah tampil di browser payload,
- organization tidak bisa mengaktifkan auto-send sebelum policy lulus validasi.

### 8.2 Inbound message processing

Flow:

1. Meta mengirim webhook,
2. ingress memverifikasi signature,
3. raw event dipersist durable,
4. worker menormalisasi payload,
5. contact di-upsert,
6. conversation ditemukan atau dibuat,
7. message dicatat,
8. routing dan bot policy dievaluasi,
9. event outbox dipublikasikan,
10. UI menerima update.

Acceptance:

- replay webhook yang sama 100 kali menghasilkan 1 inbound logical message,
- agent melihat message baru tanpa refresh manual,
- bot tidak mengirim 2 pesan untuk trigger yang sama,
- setiap failure punya state dan jejak audit.

### 8.3 Agent workflow

Agent harus bisa:

- melihat queue pribadi, tim, unassigned, waiting, resolved,
- claim, assign, release, resolve, reopen,
- pause/resume bot per conversation,
- kirim text, media, template,
- gunakan macro,
- tambah tag dan private note,
- lihat alasan bot reply dibuat atau diblok,
- lihat status provider message.

Acceptance:

- race condition antar 2 tab tidak menghasilkan duplicate send,
- conflict write menghasilkan `409`, bukan silent overwrite,
- semua aksi punya feedback sukses/gagal yang jelas.

### 8.4 Knowledge dan bot workflow

Admin harus bisa:

- upload file,
- submit URL approved,
- edit text source,
- lihat status ingest,
- publish knowledge set version,
- rollback ke version sebelumnya,
- test bot dengan knowledge version tertentu,
- pilih mode `OFF`, `DRAFT`, atau `AUTO`.

Acceptance:

- source yang dihapus dari published set berhenti retrievable setelah invalidation period yang dibatasi,
- bot run menyimpan citations dan policy outcome,
- content yang gagal scan/parse tidak bisa ikut published set.

---

## 9. Arsitektur Sistem

### 9.1 Rekomendasi arsitektur produksi

Mulai dengan **modular monolith** yang dibagi menjadi beberapa process role yang dapat di-deploy terpisah:

- `web`
- `api`
- `ingress`
- `worker`
- `scheduler`

Semua berbagi:

- satu PostgreSQL transactional database,
- Redis untuk queue/cache/pub-sub,
- object storage untuk media dan dokumen,
- secret manager,
- observability stack.

Alasan memilih modular monolith:

- domain masih saling terkait,
- konsistensi transaksi lebih penting daripada over-distributed design,
- cost dan operational complexity lebih rendah,
- masih bisa di-scale secara horizontal per role,
- lebih mudah menjaga tenant isolation dan data correctness.

### 9.2 Diagram konteks

```text
Internet
  |
CDN / WAF
  |
Load Balancer
  |---------------- web (SPA)
  |---------------- api (REST + realtime auth gateway)
  |---------------- ingress (webhook only)
                          |
                          | persist raw event
                          v
                     PostgreSQL
                          |
                     transactional outbox
                          |
                     Redis / BullMQ
                          |
             workers / scheduler / broadcaster
                          |
        Meta Cloud API / AI Provider / Billing Provider / Email / Storage
```

### 9.3 Alur utama sistem

#### A. Inbound webhook

1. request masuk ke `ingress`,
2. raw body disimpan apa adanya,
3. signature diverifikasi,
4. row `webhook_events` dibuat,
5. job normalize di-enqueue,
6. worker memproses jadi entity domain,
7. outbox event dibuat,
8. publisher mendorong update ke socket dan integration webhook.

#### B. Manual outbound

1. operator submit send request,
2. backend validasi permission, payload, eligibility, dan idempotency,
3. `outbound_intents` dibuat,
4. queue `send-message` memproses intent,
5. provider response disimpan,
6. status callback dari Meta memperbarui lifecycle.

#### C. Auto bot reply

1. inbound message lulus eligibility,
2. worker membuat `bot_run`,
3. retrieval dilakukan terhadap published knowledge set,
4. response di-generate dalam schema ketat,
5. policy engine memutuskan `BLOCK`, `DRAFT`, `QUEUE_SEND`, atau `ESCALATE`,
6. jika `QUEUE_SEND`, outbound intent dibuat,
7. jika `DRAFT`, agent diminta review.

#### D. Knowledge ingestion

1. source dibuat,
2. file diupload ke object storage atau URL masuk fetch queue,
3. scan, parse, chunk, embed, index,
4. status transisi sampai `READY`,
5. admin publish knowledge set version.

### 9.4 Service boundary

`ingress` bertanggung jawab hanya untuk:

- raw body verification,
- durable persistence,
- enqueue job,
- response cepat ke provider.

`api` bertanggung jawab untuk:

- REST endpoints,
- auth,
- RBAC,
- dashboard queries,
- mutation command,
- realtime auth/session.

`worker` bertanggung jawab untuk:

- normalisasi event,
- outbound delivery,
- AI orchestration,
- ingest processing,
- async side effects.

`scheduler` bertanggung jawab untuk:

- cron jobs,
- reconciliation,
- retention jobs,
- stale conversation maintenance,
- reporting materialization.

### 9.5 Kapan split jadi microservice

Service tidak boleh dipecah hanya karena terlihat modern. Pemecahan baru dilakukan jika ada bukti:

- beban ingress jauh lebih tinggi dari sisanya,
- boundary security khusus dibutuhkan,
- kebutuhan scaling atau deployment cadence benar-benar berbeda,
- domain ownership tim sudah cukup matang.

Jika belum ada bukti tersebut, menjaga satu codebase modular lebih rasional.

---

## 10. Stack Teknologi yang Dikunci

### 10.1 Prinsip pemilihan stack

Stack dipilih berdasarkan:

- sesuai requirement technical hiring target,
- ekosistem matang,
- maintainability tinggi,
- kuat untuk SaaS multi-tenant,
- mendukung Docker, CI/CD, dan observability profesional,
- tidak menambah kompleksitas tanpa alasan.

### 10.2 Stack inti

| Layer | Teknologi | Versi/arah | Alasan |
|---|---|---|---|
| Monorepo | `pnpm workspaces` + `Turborepo` | stabil terbaru yang kompatibel | dependency management dan pipeline workspace |
| Runtime backend | Node.js | 22 LTS | modern, stabil, sesuai target stack |
| Language | TypeScript | 5.x strict | type safety end-to-end |
| API server | Express | 5.x | matang, eksplisit, cocok untuk HTTP service yang terkendali |
| Validation | Zod | latest stable | contract validation dan inference |
| API docs | OpenAPI 3.1 | generated | spesifikasi machine-readable |
| Frontend | React | 19 | modern SPA dashboard |
| Frontend build | Vite | latest stable | cepat dan DX baik |
| Routing | TanStack Router | latest stable | typed routing |
| Data fetching | TanStack Query | latest stable | cache dan sync data solid |
| Forms | React Hook Form + Zod | latest stable | form handling efisien |
| UI styling | Tailwind CSS + shadcn/ui | latest stable | konsisten dan cepat build |
| ORM | Prisma | latest stable | typed query, migration terkelola |
| Database | PostgreSQL | 16+ | transactional source of truth |
| Vector search | `pgvector` | extension | RAG tanpa stack terpisah di fase awal |
| Cache / queue broker | Redis | 7.4+ | BullMQ, rate limit, pub/sub |
| Job queue | BullMQ | latest stable | robust untuk async jobs |
| Realtime | Socket.IO + Redis adapter | latest stable | live inbox dan event sync |
| Object storage | S3 compatible | AWS S3 prod, MinIO local | media, docs, archive |
| Auth | WorkOS/Auth0/OIDC-ready + session cookies | enterprise ready | SSO/MFA/SCIM path jelas |
| Password fallback | Argon2id | latest stable | jika local credentials tetap disediakan |
| Logging | Pino | latest stable | JSON logging cepat |
| Metrics/trace | OpenTelemetry | latest stable | traceability end-to-end |
| Testing | Vitest, Supertest, Playwright, Testcontainers, k6 | latest stable | unit hingga performance |
| Malware scanning | ClamAV or managed scanner | stable | scanning file upload |
| Billing | Stripe Billing | adapter-based | mature billing provider |
| IaC | Terraform | 1.x | infra versioned dan reviewable |
| Containerization | Docker + Compose | latest stable | dev dan self-hosted reference |
| CI/CD | GitHub Actions | current | integrate dengan repo workflow |

### 10.3 Catatan auth

Untuk enterprise readiness, **membangun auth sepenuhnya sendiri bukan prioritas terbaik** bila targetnya SSO, MFA, SCIM, dan session hardening. Rekomendasi:

- gunakan provider identity enterprise seperti WorkOS/Auth0/OIDC,
- simpan local credential flow hanya jika memang dibutuhkan oleh market awal,
- session aplikasi tetap dikontrol di backend,
- permission bisnis tetap menjadi tanggung jawab FlowDesk.

### 10.4 Catatan Go

Service `ingress-go` opsional hanya dibuat jika load test membuktikan ingress Express tidak cukup. Jangan memelihara dua implementation stack sejak awal tanpa alasan operasional yang jelas.

---

## 11. Standar Monorepo dan Struktur Direktori

```text
flowdesk/
├── apps/
│   ├── web/
│   ├── api/
│   ├── ingress/
│   ├── worker/
│   └── scheduler/
├── packages/
│   ├── db/
│   ├── domain/
│   ├── contracts/
│   ├── providers/
│   ├── config/
│   ├── observability/
│   ├── security/
│   ├── ui/
│   └── testkit/
├── infra/
│   ├── compose/
│   ├── terraform/
│   ├── docker/
│   ├── monitoring/
│   ├── policies/
│   └── runbooks/
├── docs/
│   ├── adr/
│   ├── api/
│   ├── product/
│   ├── support/
│   └── security/
├── .github/workflows/
├── scripts/
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

### 11.1 Tanggung jawab package

- `packages/db`: Prisma schema, migrations, SQL policy tambahan, seeds.
- `packages/domain`: aggregate, policy, state machine, command/query service interfaces.
- `packages/contracts`: Zod DTO, API schemas, event envelope, shared enum.
- `packages/providers`: adapter untuk Meta, AI, storage, billing, email.
- `packages/config`: schema env dan config loader fail-fast.
- `packages/observability`: logger, tracing helper, metric registry.
- `packages/security`: crypto helper, secret abstraction, sanitizer/redactor.
- `packages/testkit`: fixture, factory, fake provider, helper e2e/integration.

### 11.2 Standar codebase

- ESM only.
- TypeScript `strict` aktif.
- Tidak ada `any` tanpa alasan eksplisit.
- Semua config dibaca via typed schema.
- Semua endpoint memakai validation input/output.
- Semua query tenant-bound menerima `TenantContext`.
- Semua side effect eksternal lewat adapter/port yang bisa di-mock.
- Semua code path error penting punya classification.

### 11.3 Architecture Decision Record

Keputusan besar harus punya ADR, minimal untuk:

- auth provider,
- RLS strategy,
- billing model,
- AI provider,
- storage layout,
- deployment target,
- auto-send policy,
- eventing strategy.

---

## 12. Domain Model dan Kontrak Data

### 12.1 Aturan umum data

- Gunakan `uuidv7` jika library dan DB support memadai, atau UUID v4 bila belum.
- Semua timestamp memakai `timestamptz` UTC.
- Money dan usage disimpan sebagai integer minor units atau integer counter.
- Phone number disimpan dalam format E.164 canonical.
- Semua entity penting punya `createdAt`, `updatedAt`, dan bila relevan `createdBy`, `updatedBy`, `version`.
- Semua tabel tenant-owned wajib memiliki `organizationId`.

### 12.2 Aggregate inti

| Aggregate | Isi utama |
|---|---|
| Organization | profil tenant, status, locale, timezone, retention, policy |
| Membership / User | anggota, role, identity mapping |
| Channel | koneksi sender WhatsApp, credential ref, status |
| Contact | identitas customer, consent, tags, profile |
| Conversation | state percakapan, assignment, SLA, bot state |
| Message | inbound/outbound content dan metadata lifecycle |
| OutboundIntent | niat kirim yang idempotent sebelum provider call |
| WebhookEvent | raw provider payload yang durable |
| OutboxEvent | event domain untuk side effect dan realtime |
| KnowledgeSource / Document / Chunk | data knowledge base versioned |
| Bot / BotVersion / BotRun | konfigurasi AI dan hasil eksekusi |
| Template | metadata template provider |
| Subscription / Entitlement / UsageLedger | billing state dan kuota |
| ApiKey / IntegrationWebhook | akses machine-to-machine |
| AuditLog / SecurityEvent | jejak aksi sensitif dan insiden |

### 12.3 Tabel minimum yang wajib ada

- `organizations`
- `users`
- `memberships`
- `roles`
- `permissions`
- `channels`
- `contacts`
- `conversations`
- `messages`
- `message_attachments`
- `outbound_intents`
- `message_status_events`
- `conversation_events`
- `webhook_events`
- `outbox_events`
- `idempotency_keys`
- `knowledge_sources`
- `knowledge_documents`
- `knowledge_chunks`
- `knowledge_sets`
- `knowledge_set_versions`
- `bots`
- `bot_versions`
- `bot_runs`
- `retrieval_evidence`
- `templates`
- `subscriptions`
- `entitlements`
- `usage_ledger`
- `api_keys`
- `integration_webhooks`
- `audit_logs`
- `security_events`
- `deletion_requests`
- `data_export_requests`

### 12.4 State machine penting

#### Conversation

```text
UNASSIGNED -> ASSIGNED
UNASSIGNED -> BOT_HANDLING
BOT_HANDLING -> ASSIGNED
ASSIGNED -> WAITING_CUSTOMER
WAITING_CUSTOMER -> ASSIGNED
ASSIGNED -> RESOLVED
RESOLVED -> REOPENED
any active -> PAUSED_BOT
PAUSED_BOT -> previous eligible state
```

#### Outbound intent

```text
DRAFT -> QUEUED -> SENDING -> ACCEPTED
ACCEPTED -> SENT -> DELIVERED -> READ
SENDING -> FAILED_RETRYABLE -> QUEUED
SENDING -> FAILED_FINAL
QUEUED -> CANCELLED
```

#### Bot run

```text
CREATED -> RETRIEVING -> GENERATING -> POLICY_CHECK
POLICY_CHECK -> BLOCKED
POLICY_CHECK -> DRAFTED
POLICY_CHECK -> QUEUED_SEND
POLICY_CHECK -> ESCALATED
POLICY_CHECK -> FAILED
```

### 12.5 Indexing dan partitioning

Index minimum:

- `messages(conversation_id, created_at, id)`
- `conversations(organization_id, last_message_at desc, id)`
- `conversations(organization_id, state, assignee_id)`
- `contacts(organization_id, canonical_phone)`
- `webhook_events(provider, provider_event_id)`
- `outbound_intents(organization_id, idempotency_key)`
- `usage_ledger(source_type, source_id)`

Guideline partitioning:

- `webhook_events`, `message_status_events`, `audit_logs`, dan `outbox_events` boleh dipartisi per bulan jika volume memerlukan,
- jangan partition terlalu dini tanpa benchmark,
- retention dan archive harus mempertimbangkan cost query dan restore.

### 12.6 Disiplin migrasi

Semua perubahan schema mengikuti pola:

1. expand,
2. dual write jika perlu,
3. backfill resumable,
4. switch read,
5. contract.

Migration harus punya:

- owner,
- lock risk,
- rollback note,
- estimasi runtime,
- data backfill plan,
- staging rehearsal.

Tidak boleh ada `prisma db push` ke environment selain local scratch database.

---

## 13. Tenant Isolation dan Security Boundary

### 13.1 Isolasi tenant

Tenant isolation harus diterapkan pada tiga lapis:

1. **application layer**
   Semua request membawa `TenantContext`.
2. **ORM/repository layer**
   Semua repository menolak query tanpa tenant context.
3. **database layer**
   PostgreSQL Row Level Security menjadi guard terakhir.

### 13.2 RLS strategy

Per transaksi request:

- backend mengeksekusi `SET LOCAL app.organization_id = '<uuid>'`,
- policy RLS mewajibkan `organization_id = current_setting('app.organization_id', true)::uuid`,
- runtime DB role diberi `NOBYPASSRLS`,
- role migrasi dan break-glass dipisah.

### 13.3 Support access

Akses support lintas tenant:

- hanya via platform console terpisah,
- melalui session impersonation terkontrol,
- read-only by default,
- selalu diaudit,
- wajib alasan/ticket,
- time-bounded.

---

## 14. Modul Produk dan Spesifikasi Implementasi

### 14.1 Identity, session, dan access control

#### Tujuan

Mengelola identitas user, session aman, MFA/SSO path, dan permission bisnis tenant.

#### Fitur wajib

- login/logout,
- invite acceptance,
- session management,
- password reset jika local auth ada,
- MFA enrollment/challenge,
- domain discovery untuk enterprise SSO,
- audit login/logout/failed login,
- revoke session per user/org.

#### Keputusan implementasi

- Session lebih disarankan berbasis **HttpOnly secure cookies** daripada token long-lived di browser storage.
- Access token/session harus short-lived.
- Refresh/session rotation wajib.
- Session reuse detection wajib bila menggunakan rotating refresh sessions.
- Password reset token harus di-hash di DB, bukan plaintext.

#### Endpoint minimum

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/invitations/accept`
- `POST /api/v1/auth/password/forgot`
- `POST /api/v1/auth/password/reset`
- `POST /api/v1/auth/mfa/enroll`
- `POST /api/v1/auth/mfa/verify`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:id`

#### Acceptance khusus

- session user yang direvoke tidak boleh tetap aktif di socket,
- brute force login ter-rate-limit,
- failed login dan suspicious auth events masuk `security_events`.

### 14.2 Organization, team, dan policy management

#### Fitur wajib

- create organization,
- organization profile,
- timezone/locale,
- business hours,
- retention policy,
- user invite,
- role assignment,
- team/queue grouping,
- suspend/reactivate org,
- legal/contact settings.

#### Hal yang harus jelas

- tenant status: `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `PENDING_SETUP`, `CLOSED`,
- perilaku sistem saat tenant suspended,
- siapa yang boleh mengubah retention,
- bagaimana team assignment bekerja saat user dihapus atau dinonaktifkan.

### 14.3 Channel connection dan WhatsApp integration

#### Tanggung jawab modul

- lifecycle connection sender,
- metadata WABA/phone number,
- credential reference,
- webhook health,
- template sync,
- capability checks,
- disconnect/reconnect.

#### State channel

```text
DRAFT -> CONNECTING -> ACTIVE
ACTIVE -> DEGRADED -> ACTIVE
ACTIVE -> DISCONNECTED
any -> ERROR_REQUIRES_ACTION
```

#### Ketentuan implementasi

- simpan hanya identifier dan credential reference yang diperlukan,
- provider secret dienkripsi dengan envelope encryption,
- raw Meta password tidak pernah disimpan,
- version API Meta harus dipin, tidak unversioned.

#### Edge cases penting

- signature invalid,
- unknown phone number ID,
- duplicate callback,
- template sync partial failure,
- credential expired,
- provider rate limiting,
- business verification issue dari Meta.

### 14.4 Contacts dan consent

#### Fitur wajib

- upsert contact dari inbound,
- manual edit name/note/fields,
- tags,
- consent status,
- opt-out keywords,
- source attribution untuk consent,
- merge duplicate contact bila diperlukan dengan aturan ketat.

#### Ketentuan consent

Sistem harus bisa melacak:

- consent granted / denied / unknown,
- sumber consent,
- waktu consent,
- opt-out reason,
- restriction per campaign atau bot bila dibutuhkan.

#### Larangan

- jangan campurkan logika consent ke frontend saja,
- jangan kirim auto-message jika policy tenant melarang untuk contact tertentu.

### 14.5 Inbox, conversation, assignment, dan collaboration

#### Fitur wajib

- queue views,
- detail timeline,
- unread counters,
- assignment,
- claim/release,
- status resolution,
- pause bot,
- tags,
- private notes,
- mention atau handoff internal bila diperlukan,
- SLA badge/status.

#### Aturan conversation

- satu conversation aktif per contact+channel dalam definisi tertentu,
- optimistic concurrency wajib untuk write critical action,
- setiap transition harus valid menurut state machine,
- takeover manusia harus bisa membatalkan bot send yang belum dikirim.

#### Realtime contract

Realtime tidak boleh jadi source of truth.

Socket event hanya memberi:

- ID entity,
- version,
- event type,
- hint untuk refetch atau patch.

Jika client mendeteksi gap versi, client wajib refetch dari API.

### 14.6 Message delivery dan status lifecycle

#### Jenis pesan minimum

- text,
- template,
- image,
- document,
- audio,
- video,
- location jika dibutuhkan,
- interactive types hanya bila ada roadmap jelas.

#### Validasi minimum

- size dan MIME type,
- provider eligibility,
- template variable count/type,
- language compatibility,
- service window eligibility,
- duplicate send protection.

#### Lifecycle data

Setiap message perlu melacak:

- logical message ID internal,
- provider message ID,
- direction,
- kind,
- actor type,
- send attempt count,
- acceptance time,
- status history,
- failed reason classification.

### 14.7 Template management

#### Fitur wajib

- sync template dari provider,
- tampilkan status approval,
- language dan category,
- preview variables,
- validation sebelum send,
- template search dan favorit.

#### Catatan penting

FlowDesk tidak boleh menganggap template lokal pasti approved.
Sumber kebenaran approval tetap provider.

### 14.8 Knowledge management

#### Source types minimum

- plain text,
- PDF,
- DOCX,
- HTML page dari URL yang diallow,
- FAQ structured text.

#### Pipeline ingest

1. source created,
2. file upload atau URL fetch,
3. malware scan,
4. MIME/type verify,
5. parse text,
6. normalize,
7. chunk,
8. embed,
9. index,
10. ready.

#### Metadata yang wajib disimpan

- source type,
- original filename / URL,
- checksum,
- upload actor,
- scan result,
- parse result,
- chunk count,
- embedding model/version,
- language,
- created set/version association.

#### Kegagalan yang harus ditangani

- parse fail,
- unsupported format,
- URL blocked,
- scan fail,
- too large,
- timeout,
- duplicate content hash,
- embed provider unavailable.

### 14.9 Bot Studio dan automation policy

#### Konfigurasi minimum per bot version

- system instruction,
- allowed language,
- tone/style,
- retrieval threshold,
- top-K,
- max citations,
- fallback text,
- escalation rules,
- working hours,
- auto-send allow-list,
- blocked topics,
- model config,
- daily/monthly budget,
- approval mode.

#### Mode operasi

- `OFF`
- `DRAFT`
- `AUTO`

#### Policy engine minimum

Sebelum bot boleh mengirim:

- contact tidak opt-out,
- tenant tidak emergency-disabled,
- conversation tidak diambil alih manusia,
- service/template window valid,
- evidence cukup,
- confidence/policy threshold lolos,
- budget belum habis,
- topik diizinkan,
- latest bot version aktif.

#### Audit bot run

Setiap `bot_run` wajib menyimpan:

- prompt template version,
- model,
- model version,
- token usage,
- estimated cost,
- latency,
- evidence IDs,
- policy outcome,
- response hash,
- final action.

### 14.10 Analytics dan reporting

#### Analytics minimum GA

- volume inbound/outbound,
- first response time,
- resolution time,
- agent workload,
- bot draft rate,
- bot auto-send rate,
- escalation rate,
- template usage,
- failed send rate,
- conversation by status/team/channel.

#### Prinsip analytics

- data analytics tidak boleh mengorbankan tenant isolation,
- PII harus direduksi bila report read-only cukup,
- metrik operasional dan billing harus dibedakan.

#### Strategi implementasi

- phase awal: query live + small materialized summary,
- phase lanjut: scheduled aggregation table,
- jangan bangun warehouse terpisah terlalu dini.

### 14.11 Billing, subscription, dan entitlements

#### Fitur wajib

- plan catalog,
- checkout / subscription attach,
- entitlement projection,
- usage ledger,
- invoice list,
- grace period,
- plan downgrade/upgrade behavior,
- suspend policy.

#### Prinsip

- webhook billing dipersist durable dan idempotent,
- usage ledger immutable,
- finance bisa merekonsiliasi invoice ke source action,
- billing outage tidak boleh langsung memutus operasional customer secara brutal.

#### Entitlement contoh

- max users,
- max channels,
- monthly AI tokens/messages,
- max knowledge documents/storage,
- API/webhook quota,
- audit retention,
- support SLA,
- advanced security features.

### 14.12 API keys, outgoing webhooks, dan integrations

#### Fitur wajib

- create/revoke API key,
- scope per key,
- outgoing webhook endpoint management,
- webhook signing secret rotation,
- retry history,
- dead-letter visibility,
- endpoint verification.

#### Keamanan

- simpan hanya prefix + hashed secret,
- tampilkan secret penuh hanya sekali saat create,
- webhook payload signed HMAC SHA-256,
- include timestamp dan event ID untuk replay protection.

### 14.13 Platform admin dan support operations

#### Wajib dipisahkan dari tenant app

Platform console harus berada di hostname atau app terpisah.

#### Fitur minimum

- tenant lookup,
- connection health,
- webhook/job failures,
- support session launch,
- suspend/reactivate tenant,
- replay webhook/job dengan guardrails,
- data export/deletion workflow visibility,
- billing state visibility,
- incident notes.

#### Larangan

- jangan expose direct raw SQL tools di UI produksi,
- jangan izinkan platform admin menulis ke tenant tanpa audit dan guardrail.

---

## 15. Kontrak API, Event, dan Realtime

### 15.1 Standar API

- Version prefix: `/api/v1`
- JSON camelCase
- Error format: `application/problem+json`
- Cursor pagination untuk list besar
- `Idempotency-Key` untuk mutation yang relevan
- OpenAPI 3.1 generated dari contract
- Request/response validation dua arah

### 15.2 Problem response minimum

Field wajib:

- `type`
- `title`
- `status`
- `code`
- `detail`
- `requestId`
- `errors` bila field-level validation gagal

### 15.3 Grup endpoint

| Grup | Cakupan |
|---|---|
| Auth | login, session, MFA, invite |
| Organization | profile, policy, team, role |
| Channels | connection, status, template sync |
| Contacts | list, detail, update, tags, consent |
| Inbox | queue, conversation detail, assign, resolve, pause |
| Messages | history, media upload, send, template send |
| Automation | bot config, test, publish, rollback |
| Knowledge | source upload, ingest status, publish set |
| Analytics | operational dashboard |
| Billing | subscription, invoice, usage, entitlement |
| Integrations | API keys, outgoing webhooks |
| Audit | read/export audit events |
| Platform admin | support-only host terpisah |

### 15.4 Internal event envelope

Format event internal:

```json
{
  "eventId": "uuid",
  "eventType": "message.received.v1",
  "schemaVersion": 1,
  "occurredAt": "2026-08-25T10:00:00Z",
  "organizationId": "uuid",
  "aggregateId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "actor": {
    "type": "system",
    "id": "worker"
  },
  "data": {}
}
```

### 15.5 Socket event rules

- client join room `org:{id}` dan room granular lain yang diaizinkan,
- semua socket auth memakai session backend,
- event harus versioned,
- payload tidak boleh membocorkan data tenant lain,
- reconnect wajib diikuti reconciliation berbasis cursor/version.

### 15.6 Outgoing webhook ke customer

Ketentuan:

- signed,
- retry dengan backoff,
- dead-letter tracking,
- endpoint verification,
- disable otomatis setelah failure berulang tertentu,
- delivery history view.

---

## 16. Queue, Job, Retry, dan Reconciliation Design

### 16.1 Queue minimum

| Queue | Fungsi |
|---|---|
| `webhook-normalize` | normalisasi event provider |
| `conversation-routing` | assignment/routing decision |
| `send-message` | pengiriman outbound ke provider |
| `message-status-sync` | sinkronisasi status bila perlu |
| `knowledge-fetch` | fetch URL source |
| `knowledge-process` | parse/chunk/embed/index |
| `bot-run` | AI orchestration |
| `outbox-publish` | publish realtime/integration events |
| `billing-project` | entitlement projection |
| `retention-maintenance` | purge/archive |
| `reconciliation` | repair state inconsistency |
| `notifications` | email/system notification |

### 16.2 Prinsip retry

- retry hanya untuk error transient,
- exponential backoff dengan jitter,
- hormati `Retry-After`,
- ada max attempts,
- terminal error harus classified jelas,
- exhausted job masuk DLQ dengan observability dan replay tooling.

### 16.3 Exactly-once effect

BullMQ sifatnya at-least-once. Karena itu:

- effect penting harus dijaga oleh unique constraint atau idempotency table,
- provider send harus punya idempotency key internal,
- usage billing tidak boleh tercatat dua kali,
- replay job tidak boleh menggandakan side effect.

### 16.4 Reconciliation wajib

FlowDesk wajib punya job terjadwal untuk:

- re-enqueue raw webhook yang belum terproses,
- memeriksa outbox unpublished,
- memeriksa outbound intent yang stuck,
- memeriksa perbedaan state message vs provider callback,
- menutup service window,
- menandai channel degraded,
- menjalankan retention expiry.

### 16.5 Dead letter operations

DLQ bukan kuburan data. Sistem harus menyediakan:

- klasifikasi penyebab,
- total affected records,
- replay aman,
- bulk retry terbatas,
- audit siapa yang me-replay,
- safe preview sebelum replay.

---

## 17. WhatsApp dan Provider Integration Rules

### 17.1 Aturan integrasi wajib

- gunakan hanya official Meta Cloud API version yang dipin,
- signature diverifikasi terhadap raw bytes,
- simpan raw webhook sebelum parsing destruktif,
- anggap callback bisa duplicate, out-of-order, dan terlambat,
- service window dan template eligibility ditentukan di satu service policy,
- media harus melalui private object storage staging,
- credential rotation dan disconnect harus didukung.

### 17.2 Hal spesifik yang tidak boleh diabaikan

- keyword opt-out,
- nomor/channel health monitoring,
- webhook challenge verification,
- provider message ID mapping,
- media retention,
- template localization,
- rate-limit handling,
- status quality atau restrictions dari Meta,
- provider outage communication.

### 17.3 Failure matrix

| Kondisi | Respons wajib |
|---|---|
| Signature invalid | log security event, jangan enqueue |
| DB down saat ingress | kembalikan failure retryable, jangan claim accepted |
| Redis down | raw event tetap disimpan dan di-sweeper kemudian |
| Meta rate limit | schedule retry, expose queued state |
| Template rejected | fail final dengan remediation |
| Provider outage | circuit breaker, queue with cap, alert |
| Malformed payload | quarantine event, metric, no crash |

---

## 18. AI Assistant, RAG, dan Safety Controls

### 18.1 Pipeline AI

1. pre-check policy,
2. redact sensitive content sesuai tenant policy,
3. build bounded context,
4. retrieve approved chunks,
5. evaluate relevance threshold,
6. generate structured candidate,
7. validate schema dan policy,
8. decide action,
9. store run metadata.

### 18.2 Retrieval strategy

Rekomendasi awal:

- chunk size sekitar 400-800 token ekuivalen,
- overlap moderat,
- simpan metadata source dan language,
- hybrid retrieval lexical + vector setelah benchmark,
- rerank hanya jika quality gain terbukti layak terhadap cost.

### 18.3 Guardrail minimum

Bot tidak boleh:

- menjawab tanpa evidence memadai untuk pertanyaan yang memerlukan source,
- mengubah policy internal,
- meminta password, OTP, kartu, atau data sensitif tak perlu,
- memberi advice medis/hukum/keuangan final,
- mengarang harga, stok, atau kebijakan yang tidak ada di knowledge,
- membocorkan system prompt,
- menjalankan tool eksternal bebas.

### 18.4 Prompt injection defense

Knowledge dianggap data tidak terpercaya. Maka:

- retrieved text tidak punya prioritas lebih tinggi dari system policy,
- instruksi berbahaya di source harus di-neutralize,
- provenance wajib disimpan,
- citation wajib menunjuk source internal,
- evaluasi adversarial cases wajib ada.

### 18.5 Auto-send governance

Auto-send hanya boleh aktif jika:

- owner/admin menyetujui,
- evaluation threshold terpenuhi,
- emergency disable tersedia,
- scope intent yang diizinkan jelas,
- fallback ke human handoff tersedia,
- customer disclosure jika diwajibkan tersedia.

### 18.6 Cost governance

Batasi:

- token per run,
- total AI cost per org per hari/bulan,
- total auto-send per conversation,
- burst limit per org,
- fallback model atau draft-only mode saat budget limit tercapai.

---

## 19. UX, Frontend, dan Design System Requirements

### 19.1 Information architecture

Navigasi utama:

- Inbox
- Contacts
- Automation
- Knowledge
- Templates
- Analytics
- Integrations
- Team & Security
- Billing
- Settings

Platform admin harus dipisah.

### 19.2 Standar UX

- keyboard-first untuk inbox,
- focus management jelas,
- loading/error/empty/offline states wajib,
- conflict state ditangani,
- destructive action punya confirmation,
- export/import besar harus async,
- timezone dan localization konsisten,
- copy error ramah operator, bukan raw stack.

### 19.3 Accessibility

Target minimum:

- WCAG 2.2 AA untuk flow kritis,
- screen-reader usable untuk login, inbox, send, assign, settings utama,
- contrast dan visible focus baik,
- semantic label dan aria state akurat.

### 19.4 Frontend implementation rules

- state server utama lewat TanStack Query,
- form validation shared dengan backend contract bila mungkin,
- feature flag sensitif dievaluasi server-side,
- browser log/error analytics tidak boleh mengandung secret atau payload sensitif,
- attachment access melalui signed URL jangka pendek.

### 19.5 Design system

Wajib punya:

- design tokens,
- component variants,
- Storybook,
- visual regression,
- standardized empty/loading/error states,
- i18n catalog minimal Bahasa Indonesia dan English.

---

## 20. Security, Privacy, Compliance, dan Governance

### 20.1 Security baseline

Sebelum GA, FlowDesk harus memiliki:

- threat model STRIDE,
- secret management terpusat,
- TLS end-to-end sesuai kebutuhan,
- secure session strategy,
- RLS,
- encryption at rest,
- audit logging,
- rate limit dan abuse protection,
- malware scanning upload,
- SSRF protection untuk URL ingestion,
- dependency scanning,
- container scanning,
- SAST,
- DAST baseline,
- periodic penetration test.

### 20.2 Session dan credential security

- password pakai Argon2id bila local auth ada,
- MFA untuk admin/owner sangat direkomendasikan, enterprise wajib,
- session cookie `Secure`, `HttpOnly`, `SameSite`,
- secret tidak boleh ada di repo, logs, browser, Terraform state, atau Docker layer,
- API key di-hash dan hanya ditampilkan sekali saat create,
- secret rotation policy harus terdokumentasi.

### 20.3 Privacy dan data governance

Harus jelas:

- data inventory,
- subprocessor list,
- legal basis,
- consent handling,
- retention schedule,
- deletion workflow,
- DSAR/export workflow,
- legal hold behavior,
- backup window limitation terhadap deletion immediacy.

### 20.4 Compliance positioning

Jangan klaim:

- SOC 2,
- ISO 27001,
- GDPR/PDPA compliant,
- data residency guarantee,

sebelum ada kontrol, bukti, review legal, dan assessment yang memadai. Bangun kontrol dan evidencenya lebih dulu.

### 20.5 Auditability

Event audit minimum:

- login dan failed login,
- invite create/revoke/accept,
- role/permission change,
- sender connect/disconnect,
- bot publish/disable,
- knowledge publish/delete,
- message send/cancel,
- API key/webhook create/revoke,
- billing status change,
- support impersonation,
- data export/deletion request.

Audit harus append-only, access-controlled, exportable, dan dimonitor bila ada indikasi tampering.

---

## 21. Infrastruktur Produksi, Environment, dan Topologi Deploy

### 21.1 Referensi arsitektur produksi yang direkomendasikan

Default yang paling rasional untuk enterprise SaaS awal:

- AWS CloudFront
- AWS WAF
- Application Load Balancer
- ECS Fargate untuk service container
- RDS PostgreSQL Multi-AZ + pgvector
- ElastiCache Redis
- S3 + KMS
- ECR
- Secrets Manager
- CloudWatch + OpenTelemetry collector + Grafana
- Route 53 + ACM
- Terraform untuk semua resource

### 21.2 Environment yang wajib dipisah

| Environment | Tujuan |
|---|---|
| `local` | development harian |
| `preview` | per-PR validation |
| `staging` | pre-production integrated testing |
| `production` | customer live traffic |

Setiap environment harus punya:

- DB sendiri,
- Redis sendiri,
- bucket sendiri,
- secret sendiri,
- sender/provider config sendiri jika relevan,
- monitoring dan alert context sendiri.

### 21.3 Komponen deployable

- `web`
- `api`
- `ingress`
- `worker`
- `scheduler`
- `otel-collector` bila self-managed
- reverse proxy hanya untuk self-hosted single-host variant

### 21.4 Kenapa bukan Kubernetes dulu

Jika tim belum punya kebutuhan dan kapasitas operasional Kubernetes, ECS Fargate lebih masuk akal untuk:

- menurunkan operational burden,
- mempercepat production readiness,
- fokus pada product reliability dulu.

Kubernetes hanya dipilih jika:

- ada platform team yang sudah matang,
- multi-cluster atau advanced scheduling memang dibutuhkan,
- cost/operability analysis mendukung.

### 21.5 Network dan boundary

- public ingress hanya ke ALB/CDN/WAF,
- database dan Redis private,
- service-to-service least privilege,
- egress ke AI/provider dibatasi,
- object storage private,
- support akses via bastion/break-glass yang diaudit.

---

## 22. Docker, Local Development, dan Runtime Hardening

### 22.1 Local development stack

`docker compose` untuk local minimal menyalakan:

- PostgreSQL 16 + pgvector
- Redis
- MinIO
- Mailpit
- OpenTelemetry collector
- Prometheus
- Grafana
- ClamAV atau scanner pengganti

Opsi tambahan:

- fake Meta provider
- fake billing webhook sender
- fake AI adapter

Tujuannya: developer bisa menguji alur utama tanpa credential production.

### 22.2 Prinsip image build

- multi-stage build,
- lockfile frozen,
- no dev dependency di runtime image,
- base image dipin sedapat mungkin,
- non-root user,
- explicit health endpoints,
- graceful shutdown,
- resource limit,
- `.dockerignore` rapi,
- SBOM dan vulnerability scan.

### 22.3 Pilihan base image

Untuk pragmatisme Node + Prisma:

- builder: `node:22-bookworm-slim`
- runtime: `node:22-bookworm-slim` non-root, atau distroless jika operasional siap

Jangan pilih image yang menyulitkan binary compatibility Prisma tanpa keuntungan jelas.

### 22.4 Health checks

- `/livez`: proses hidup
- `/readyz`: dependency dan schema compatible
- `/healthz`: optional aggregate internal

### 22.5 Graceful shutdown

Saat menerima SIGTERM:

- hentikan accept traffic baru,
- hentikan claim job baru,
- selesaikan in-flight request secara bounded,
- flush logs/traces,
- release lock dengan aman,
- exit clean.

### 22.6 Compose bukan orchestration produksi utama

Compose production example boleh disediakan untuk deployment kecil single-host, tetapi:

- tidak boleh dianggap reference HA utama,
- tidak boleh menjalankan DB dan Redis tanpa hardening,
- tidak boleh jadi satu-satunya jalur operasional enterprise.

---

## 23. CI/CD, Release Engineering, dan Supply Chain Security

### 23.1 Branching model

Flow sederhana:

- `feature/*` -> PR -> `main`
- release candidate tag: `vX.Y.Z-rc.N`
- production release: signed semantic version tag

### 23.2 PR gates wajib

Semua PR wajib lulus:

1. formatting dan lint,
2. TypeScript strict check,
3. unit test,
4. repository/integration test,
5. RLS negative test,
6. API contract check,
7. OpenAPI drift check,
8. dependency/license policy,
9. secret scan,
10. SAST,
11. build web dan service images,
12. image scan,
13. SBOM generation,
14. smoke test image,
15. Playwright core flow,
16. accessibility checks untuk flow utama.

### 23.3 CD flow yang benar

1. build sekali dari commit yang lolos CI,
2. publish image by immutable digest,
3. buat provenance/attestation dan SBOM,
4. apply infra lewat Terraform terproteksi,
5. deploy ke staging,
6. jalankan smoke, synthetic webhook, provider sandbox test,
7. approval,
8. deploy canary production,
9. cek SLO/error/queue lag,
10. promote ke full rollout,
11. simpan deployment record.

### 23.4 Migration saat deploy

`prisma migrate deploy` harus dijalankan:

- sekali per release,
- dengan lock yang aman,
- sebelum app rollout jika migration expand-compatible,
- rollback DB bukan default path; utamakan roll-forward.

### 23.5 Supply chain hardening

- pin GitHub Actions by commit SHA,
- gunakan OIDC short-lived credential ke cloud,
- larang long-lived cloud key di CI,
- image provenance dan attestation,
- dependency update lewat Renovate/Dependabot,
- package registry source dibatasi.

### 23.6 Preview environments

Preview per PR sangat berguna untuk:

- UI review,
- QA eksplorasi,
- quick smoke flow,
- stakeholder signoff.

Namun preview tetap harus:

- isolate data,
- pakai seed/fake data,
- punya TTL cleanup.

---

## 24. Observability, SRE, dan Incident Response

### 24.1 Telemetry contract

#### Logs

Minimal field:

- timestamp
- level
- service
- environment
- version
- requestId
- correlationId
- traceId
- organizationId bila aman
- actorId bila relevan
- jobId/eventId
- errorClass

Default redaction:

- token,
- cookie,
- auth header,
- phone number penuh bila policy melarang,
- message text,
- raw provider payload,
- secrets.

#### Metrics

Minimal metric domain:

- HTTP RED metrics,
- webhook verify/accept/dedupe,
- queue depth dan oldest job age,
- retry dan DLQ,
- outbound success/failure/rate limit,
- DB pool dan slow query,
- Redis memory/eviction,
- socket connection count,
- AI cost/latency/safety block,
- knowledge ingest success/failure,
- entitlement denial.

#### Traces

Trace harus menghubungkan:

- inbound HTTP,
- DB transaction,
- queue job,
- provider call,
- AI provider call,
- storage operation.

### 24.2 Dashboard minimum

- executive reliability dashboard,
- webhook dashboard,
- queue dashboard,
- outbound delivery dashboard,
- AI quality dan cost dashboard,
- DB/Redis dashboard,
- security dashboard,
- per-tenant support dashboard.

### 24.3 Alerting

Alert minimum:

- webhook acceptance drop,
- ingress 5xx spike,
- queue oldest job terlalu tua,
- DLQ growth,
- cross-tenant anomaly,
- provider error spike,
- AI block anomaly,
- backup failure,
- restore test failure,
- storage scan failure spike.

### 24.4 Incident response

Harus ada:

- severity matrix,
- incident commander role,
- communication cadence,
- status page workflow,
- evidence preservation,
- customer communication template,
- postmortem template,
- corrective action tracking.

### 24.5 Tabletop exercise

Latihan minimum per kuartal:

- provider outage,
- secret leak,
- tenant isolation bug,
- database restore scenario,
- harmful bot auto-send scenario.

---

## 25. Backup, Disaster Recovery, dan Capacity Planning

### 25.1 Backup policy

Database:

- automated backups,
- PITR,
- encrypted snapshot,
- restore test berkala,
- cross-account atau cross-region copy jika kontrak menuntut.

Object storage:

- versioning,
- lifecycle,
- quarantine bucket/prefix,
- restore sampling test.

Redis:

- bukan source of truth,
- persistence hanya untuk operational recovery, bukan durability claim utama.

### 25.2 Restore drill

Restore drill dianggap valid hanya jika:

- restore dilakukan ke environment isolasi,
- aplikasi bisa start,
- data tenant bisa diverifikasi,
- RLS tetap berfungsi,
- sampling data penting cocok,
- RTO dan RPO diukur.

### 25.3 Capacity model awal

Perlu diasumsikan dan diuji:

- jumlah org aktif,
- jumlah channel per org,
- message per hari,
- concurrent agents,
- average attachment size,
- queue throughput,
- embedding volume,
- AI QPS,
- storage growth,
- cost ceiling bulanan.

### 25.4 Load testing

Test minimal:

- inbound burst webhook,
- mass status callback,
- banyak agent aktif bersamaan,
- queue retry storm,
- DB degraded,
- Redis failover,
- AI provider lambat,
- graceful shutdown under load.

---

## 26. Quality Strategy dan Definition of Done

### 26.1 Layer pengujian

| Layer | Contoh |
|---|---|
| Unit | policy eligibility, state machine, RBAC, math usage |
| Repository/integration | unique constraints, RLS, outbox tx, idempotency |
| Provider contract | Meta fixtures, status mapping, template payload |
| E2E | onboarding, inbox, manual send, bot draft, knowledge publish |
| Security | authz matrix, CSRF, SSRF, upload abuse |
| Performance | webhook burst, queue lag, failover behavior |
| AI eval | groundedness, refusal correctness, escalation |

### 26.2 Definition of done per fitur

Fitur dianggap done hanya jika:

- requirement dan acceptance jelas,
- API/event contract terdokumentasi,
- schema migration aman,
- RBAC/RLS diperiksa,
- logging/metric/trace ditambahkan,
- audit event relevan ada,
- unit/integration/E2E lulus,
- error/loading/empty/conflict state lengkap,
- security/privacy impact direview,
- support doc dan rollback note ada,
- owner menerima hasil.

### 26.3 Test data policy

- jangan gunakan data customer nyata untuk testing,
- fixture harus anonim,
- seed data konsisten,
- preview/staging harus bisa di-reset.

---

## 27. Delivery Plan, Work Breakdown, dan Team Shape

### 27.1 Realita timeline

Membangun FlowDesk sebagai produk enterprise-ready tidak realistis jika diposisikan sebagai proyek 30 hari. Versi demo mungkin bisa. Versi buildable dan sellable membutuhkan fase yang lebih matang.

### 27.2 Milestone yang masuk akal

| Milestone | Durasi indikatif | Hasil keluar |
|---|---:|---|
| M0 Foundation | 2-4 minggu | PRD final, ADR awal, infra bootstrap, auth decision, threat model |
| M1 Secure platform core | 4-6 minggu | org/team/auth/RLS/audit/basic UI/CI |
| M2 Messaging core | 5-7 minggu | ingress, normalize, inbox, manual send, status callback |
| M3 Knowledge + bot control | 5-7 minggu | ingest, RAG, bot modes, eval, review flow |
| M4 Commercial + operations | 4-6 minggu | billing, integrations, support tooling, DR drills, legal pack |
| M5 Beta -> GA | 4-8 minggu | pilot customer, reliability tuning, launch review |

### 27.3 Workstreams paralel

- product and UX
- backend core
- frontend app
- platform/infra
- security and compliance
- QA and release quality
- support/billing/legal readiness

### 27.4 Komposisi tim ideal

- 1 product manager
- 1 product designer
- 2-4 full-stack engineer
- 1 backend/integration focused engineer
- 1 platform/SRE engineer
- 1 QA/SDET
- 1 security advisor part-time
- 1 support/ops representative

Pada startup awal, beberapa peran bisa digabung, tetapi pekerjaannya tidak hilang.

### 27.5 Vertical slice pertama

Target vertical slice:

- tenant bootstrap,
- channel test connection,
- inbound webhook durable,
- message muncul di inbox,
- agent bisa balas,
- provider callback masuk,
- audit dan telemetry lengkap,
- end-to-end trace terlihat.

AI tidak boleh menjadi workstream pertama sebelum messaging core stabil.

---

## 28. RACI Ringkas

| Area | Responsible | Accountable | Consulted |
|---|---|---|---|
| Product scope | PM | Founder/Product lead | Eng lead, design, support |
| Architecture | Eng lead | CTO/Founder | Platform, security |
| Auth/security | Security + backend | Eng lead | PM |
| WhatsApp integration | Backend/integrations | Eng lead | Support, product |
| Inbox UX | Frontend + design | PM | Support |
| AI/RAG | Backend/AI owner | Eng lead | PM, support, legal |
| Billing | Backend + finance ops | Founder/Product | Legal |
| CI/CD + infra | Platform engineer | Eng lead | Security |
| Incident process | Platform + support | Eng lead | PM |
| Launch signoff | Multi-function | Founder/Product | All leads |

---

## 29. Launch Readiness Checklist

### 29.1 Product readiness

- [ ] onboarding flow jelas dan tidak buntu
- [ ] team inbox dan manual send stabil
- [ ] bot mode `OFF` dan `DRAFT` stabil sebelum `AUTO`
- [ ] pricing, packaging, dan entitlement jelas
- [ ] support docs dan admin docs tersedia

### 29.2 Engineering readiness

- [ ] CI wajib tidak bisa dibypass sembarangan
- [ ] migration strategy terbukti aman
- [ ] replay dan reconciliation tooling tersedia
- [ ] environment staging menyerupai production secukupnya
- [ ] canary deployment tervalidasi

### 29.3 Security readiness

- [ ] threat model selesai
- [ ] secret management rapi
- [ ] RLS negative tests lulus
- [ ] security scan bersih atau risk accepted
- [ ] support impersonation diaudit

### 29.4 Operational readiness

- [ ] runbook P1/P2 ada
- [ ] alert routing aktif
- [ ] on-call owner jelas
- [ ] restore drill lulus
- [ ] status page dan communication template siap

### 29.5 Commercial readiness

- [ ] terms/privacy/DPA tersedia
- [ ] subprocessor list tersedia
- [ ] billing dan invoicing flow tervalidasi
- [ ] support hours/SLA jujur dan terdokumentasi
- [ ] refund/cancel/grace policy jelas

### 29.6 AI readiness

- [ ] evaluation suite disetujui
- [ ] unsafe topics dibatasi
- [ ] emergency disable tersedia
- [ ] citations dan reason traceable
- [ ] cost limits aktif

---

## 30. Support, Operasi Harian, dan Customer Success Readiness

### 30.1 Support minimum sebelum jualan

Harus ada:

- knowledge base internal,
- escalation path engineering,
- severity definitions,
- SLA response target,
- issue template,
- maintenance notice template,
- outage communication template,
- support admin tooling minimal.

### 30.2 Operasi mingguan

Weekly ops review membahas:

- error budget,
- incidents,
- queue health,
- provider health,
- AI cost dan safety,
- support tickets,
- backup status,
- capacity trend,
- expiring secrets,
- expiring feature flags,
- billing anomalies.

### 30.3 Operasi bulanan

- access review,
- secret rotation review,
- dependency review,
- cost review,
- retention/deletion audit,
- restore sample test,
- roadmap vs reliability tradeoff.

---

## 31. Cost Control dan FinOps Dasar

### 31.1 Komponen biaya utama

- compute untuk web/api/ingress/worker/scheduler,
- RDS,
- Redis,
- object storage,
- egress bandwidth,
- AI usage,
- observability stack,
- malware scanning,
- billing provider fee,
- email/provider costs.

### 31.2 Guardrail biaya

- budget alert per environment,
- AI per-org budget,
- storage lifecycle,
- log retention policy,
- preview environment TTL,
- right-size task resource,
- monitor high-cardinality metrics,
- archive raw event sesuai retention.

### 31.3 Prinsip

FlowDesk tidak boleh baru sadar mahal setelah production. Cost harus jadi bagian dari design decision sejak awal.

---

## 32. Daftar Runbook yang Wajib Ditulis

Sebelum production, minimal harus ada runbook untuk:

- webhook ingress failure,
- Redis/queue degradation,
- provider rate limiting spike,
- outbound stuck queue,
- DLQ replay,
- AI provider outage,
- attachment scan backlog,
- backup failure,
- restore execution,
- emergency bot disable,
- tenant suspension/reactivation,
- secret rotation,
- support impersonation procedure,
- incident communication.

Runbook harus memuat:

- gejala,
- cara verifikasi,
- langkah containment,
- langkah recovery,
- risiko replay,
- kapan eskalasi,
- owner.

---

## 33. Daftar Keputusan yang Harus Dikunci Sebelum Build Dimulai

1. identity provider apa yang dipakai,
2. cloud target utama apa,
3. region dan data residency target,
4. apakah local auth tetap didukung,
5. apakah auto-send masuk GA atau post-GA,
6. model AI utama dan fallback,
7. plan pricing awal,
8. retention default per tenant,
9. apakah compose self-hosted didukung secara komersial,
10. bagaimana support coverage dan SLA.

Tanpa keputusan ini, tim akan tersendat di tengah implementasi.

---

## 34. Risiko Utama

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Menganggap project ini bisa dibangun seperti demo 30 hari | scope kabur, quality jeblok | kunci milestone realistis dan acceptance jelas |
| Underestimate tenant isolation | insiden data kritis | RLS, test negatif, review security |
| Overbuild microservices terlalu dini | delivery lambat, ops rumit | modular monolith dulu |
| AI terlalu dini jadi fokus | core messaging rapuh | stabilkan messaging dahulu |
| Auth dibangun seadanya padahal target enterprise | security dan SSO path lemah | pakai provider identity yang tepat |
| Tidak punya reconciliation | silent data loss | event log durable + repair job |
| CI/CD lemah | release tidak repeatable | immutable image, staged promotion, canary |
| Cost AI dan observability bocor | margin rusak | budget dan retention policy sejak awal |

---

## 35. Kesimpulan Implementasi

FlowDesk yang benar-benar siap dijual dan dipakai tidak boleh diperlakukan sebagai:

- landing page + chatbot demo,
- backend CRUD biasa,
- WhatsApp wrapper tipis,
- dashboard tanpa operational backbone.

FlowDesk harus dibangun sebagai:

- SaaS multi-tenant yang disiplin,
- messaging platform yang reliabel,
- AI-assisted system yang terkendali,
- product yang operable saat ada kegagalan,
- platform yang bisa diaudit, dipelihara, dan dikembangkan jangka panjang.

Jika dokumen ini diikuti sebagai baseline, tim akan punya acuan yang cukup detail untuk mulai membangun produk secara serius tanpa kehilangan aspek penting seperti tenant isolation, observability, CI/CD profesional, backup/DR, billing, governance, dan launch readiness.

---

## Appendix A - Environment Variables Inventory

Contoh nama konfigurasi:

```dotenv
NODE_ENV=development
APP_ENV=local
APP_BASE_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:4000
SESSION_COOKIE_DOMAIN=localhost

DATABASE_URL=postgresql://...
DATABASE_POOL_MAX=20
REDIS_URL=redis://...

S3_BUCKET=flowdesk-local
S3_REGION=ap-southeast-1
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true

SESSION_SIGNING_KEY_REF=secret://...
ENCRYPTION_MASTER_KEY_REF=secret://...
META_APP_SECRET_REF=secret://...
META_VERIFY_TOKEN_REF=secret://...
META_ACCESS_TOKEN_REF=secret://...
AI_PROVIDER_KEY_REF=secret://...
STRIPE_SECRET_KEY_REF=secret://...
STRIPE_WEBHOOK_SECRET_REF=secret://...

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
LOG_LEVEL=info

FEATURE_FLAGS_PROVIDER=database
FILE_UPLOAD_MAX_MB=20
SIGNED_URL_TTL_SECONDS=300
BOT_AUTOSEND_DEFAULT_ENABLED=false
```

Aturan:

- tidak ada default production yang berbahaya,
- fail fast jika config invalid,
- pisahkan secret dan non-secret config,
- semua env harus tervalidasi schema.

## Appendix B - Dokumen Pendukung yang Wajib Menyusul

- PRD detail
- UX flows dan wireframe utama
- ADR awal
- threat model
- OpenAPI draft
- data retention policy
- support runbook pack
- incident response plan
- DPA/privacy draft
- billing and packaging brief

## Appendix C - Urutan Implementasi Paling Rasional

1. foundation repo + infra + CI
2. auth + org + role + RLS
3. channel connection + ingress durable
4. conversation/message core + inbox
5. outbound delivery + status callbacks
6. observability + reconciliation + support tooling dasar
7. knowledge ingestion
8. bot draft mode
9. billing + entitlements
10. AI auto-send hanya setelah quality dan control cukup
