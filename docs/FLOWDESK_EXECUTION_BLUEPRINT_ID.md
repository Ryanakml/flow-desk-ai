# FlowDesk — Blueprint Eksekusi Teknis (Versi Indo)

**Status:** rencana eksekusi resmi
**Versi:** 1.0.0
**Bergantung sama:** `FLOWDESK_ENTERPRISE_PRODUCT_AND_ENGINEERING_SPEC.md`
**Buat siapa:** product, design, engineering, QA, security, platform/SRE, support
**Status project:** belum mulai development

> Dokumen ini ngubah Enterprise Product & Engineering Specification jadi urutan kerja yang jelas. Ini bukan checklist sekali jalan terus selesai. Setiap fase itu satu "irisan vertikal" yang langsung kepake buat customer, dan semua hal lintas-disiplin—CI/CD, testing, Docker, security, data, observability, dokumentasi, sampai operasional—harus terus berkembang bareng. Fase belakangan otomatis "mewarisi" semua requirement dari fase sebelumnya, kecuali dokumen ini bilang lain secara eksplisit.

---

## 1. Cara pakai blueprint ini

Ada tiga level "sumber kebenaran":

| Level                            | Dokumen/sistem                                                       | Jawab apa                                                                                 |
| -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spesifikasi produk & engineering | `FLOWDESK_ENTERPRISE_PRODUCT_AND_ENGINEERING_SPEC.md`                | FlowDesk itu apa, batasan arsitektur, kebijakan, standar kualitas.                        |
| Blueprint eksekusi               | Dokumen ini                                                          | Apa yang harus dibangun berikutnya, urutan dependensinya, dan definisi "selesai" itu apa. |
| Sistem delivery                  | GitHub Issues/Projects, PR, ADR, hasil CI, catatan deploy, dashboard | Status saat ini dan bukti objektif kalau satu fase udah kelar.                            |

Kalau dokumen-dokumen ini saling bentrok: spesifikasi produk/engineering yang megang kendali soal niat produk & platform; ADR yang udah disetujui yang megang kendali soal keputusan teknis spesifik; blueprint ini yang megang kendali soal urutan kerja dan gerbang rilis. Task tracker gak boleh diam-diam ngubah keputusan — kalau ada perubahan, wajib dicatat di ADR atau update dokumen terkait di PR yang sama.

### 1.1 Aturan intinya: fase itu irisan vertikal, bukan silo teknologi

Urutan yang salah:

```text
Fase A: backend → Fase B: frontend → Fase C: CI/CD → Fase D: tes
```

Urutan yang bener:

```text
Kapabilitas: nerima satu pesan WhatsApp dan bikin satu agent yang berwenang bisa balas.
  ├─ UI: state inbox dan UX buat balas
  ├─ API/domain: otorisasi, command percakapan/pesan
  ├─ data: migration, RLS, index, metadata retensi
  ├─ async: webhook/event/outbox/worker
  ├─ Docker/runtime: image service, health check, graceful shutdown
  ├─ CI/CD: build, cek contract/integration/E2E, perubahan deploy
  ├─ security: signature, tenant isolation, audit, kontrol secret
  ├─ observability: trace, metrics queue/provider, alert/runbook
  └─ dokumentasi: kontrak API/event, panduan operator/support
```

Gak ada satupun kapabilitas yang "kepake customer" dianggap selesai kalau cuma nyentuh salah satu layer di atas doang.

### 1.2 Definition of Done (DoD) yang akumulatif

Tiap fase punya dua gerbang:

1. **DoD khusus fase itu:** hasil dan bukti yang emang unik buat fase tersebut.
2. **DoD akumulatif:** semua kewajiban relevan dari fase-fase sebelumnya tetap harus lolos walau ada perubahan baru.

Contoh: fase 1 ngenalin CI lint/typecheck/image build. Fase 4 nambahin worker dan migration database. Jadi fase 4 belum dianggap selesai sampai worker itu di-build/di-scan/di-tes/di-deploy lewat CI, migration-nya udah direhearse, job metrics-nya ada, DAN gerbang CI yang lama masih lolos. CI/CD itu _kapabilitas yang hidup terus_, bukan fase yang ditutup lalu dilupain.

### 1.3 Arti "siap dimulai"

Satu fase cuma boleh dimulai kalau:

- syarat keluar dari fase sebelumnya (predecessor) udah kepenuhi;
- bug security/reliability kritis dari fase sebelumnya udah diselesaikan, atau ada risk acceptance yang jelas batas waktunya dan disetujui owner;
- keputusan product/design yang bisa nyegah kerja ulang (rework) udah dicatat;
- ada owner engineering dan owner acceptance yang jelas namanya;
- kerjaan udah dipecah jadi tiket-tiket yang bisa direview terpisah, lengkap sama link dependensinya;
- credential/akun test sandbox yang dibutuhin udah tersedia, tanpa pake data/secret produksi.

### 1.4 Yang GAK berarti "selesai"

Hal-hal berikut **gak** bisa nutup tiket/fase dengan sendirinya: "jalan di laptop gue", screenshot UI doang, respons API happy-path doang, edit manual di produksi, satu kali tes manual, atau unit test yang lolos tapi gak nge-cover perilaku authorization/retry/error.

---

## 2. Sistem operasi delivery

### 2.1 Hierarki item kerja

```text
Outcome jangka panjang (north-star)
  └─ Milestone rilis (M0…M8)
      └─ Epic kapabilitas (satu kapabilitas bisnis end-to-end)
          └─ Story / deliverable teknis
              └─ Task/subtask implementasi
                  └─ Pull request(s), tes, dokumentasi, bukti deployment
```

Pake tiket terpisah buat perubahan lintas-disiplin yang cukup besar. Contoh: "Kirim pesan media" itu epic; harusnya secara eksplisit mencakup kebijakan object-storage, UX upload, worker scan, adapter provider, migration DB, status delivery, fixture test, dashboard/alert, dan update retensi. Jangan dikubur jadi satu paragraf yang gak dicentang di tiket frontend generik.

### 2.2 Field wajib di tiap story

| Field                    | Kewajiban                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| ID/judul                 | Identifier yang stabil dan judul yang fokus ke outcome.                                                                        |
| Parent/fase              | Epic dan milestone yang pasti; link dependensi harus dua arah.                                                                 |
| Outcome buat user/sistem | Siapa yang untung dan perilaku yang diharapkan bisa diamati.                                                                   |
| Scope / pengecualian     | Apa yang berubah dan apa yang memang sengaja gak diubah.                                                                       |
| Kriteria acceptance      | Perilaku Given/When/Then yang bisa dites, termasuk kasus negatif/error.                                                        |
| Desain teknis            | Perubahan data/API/event/runtime, atau link ke ADR/design note.                                                                |
| Dampak lintas-disiplin   | CI/CD, test, Docker/infra, security, data, observability, docs, support: `none`, `update`, atau `new`, plus alasan yang jelas. |
| Rollout / rollback       | Flag, urutan migration, kompatibilitas, dan cara aman buat balik lagi.                                                         |
| Bukti                    | PR, hasil test, bukti preview/staging, link dashboard/runbook/docs.                                                            |
| Owner / reviewer         | Orang yang bikin dan orang yang approve secara independen.                                                                     |

Kalau deklarasi dampak gak diisi, itu jadi blocker. "None" cuma boleh kalau ada alasan yang disebutin.

### 2.3 Kontrak PR

Tiap PR wajib punya: issue yang di-link; niat user/sistem secara ringkas; perubahan arsitektur/data/API/event; screenshot atau recording buat UI; bukti test yang jelas; catatan migration/rollout/rollback; perubahan config/secret; dampak ke observability/alert; dampak security/privacy; update dokumentasi; dan follow-up issue (kalau ada) lengkap sama owner/tanggalnya. Penulis PR gak boleh approve sendiri perubahan yang protected.

Pake conventional commits, `main` yang protected, CODEOWNERS buat `packages/db`, `infra`, auth/RLS, adapter provider, dan workflows. Jaga PR tetep kecil biar gampang direview perilakunya beneran; pake feature flag buat kerjaan yang belum kelar tapi aman untuk di-merge.

### 2.4 Graf traceability

Setiap perilaku yang udah dirilis harus bisa ditelusuri dua arah:

```text
Requirement / kebijakan
  → fase → epic → tiket → ADR/design → PR → tes → image digest
  → migration → bukti staging → deployment produksi → dashboard/runbook
  → catatan audit/incident/change
```

Nanti pelihara `docs/TRACEABILITY.md` yang ringan aja, isinya ID requirement, fase, owner, referensi implementasi, test suite, sinyal operasional, dan status. Jangan sampai ini jadi birokrasi berlebihan: cukup cover kapabilitas kritis, kontrol security, perilaku provider, dan komitmen ke pihak luar — bukan tiap perubahan CSS.

### 2.5 Ritual "cek dampak perubahan"

Sebelum mulai implementasi, tanya sembilan pertanyaan ini:

1. Apakah ini bikin/ubah data yang disimpan, migration, index, retensi, backup, atau perilaku penghapusan?
2. Apakah ini mengekspos/mengubah HTTP, socket, queue, outgoing webhook, atau kontrak provider?
3. Apakah ini bikin process, dependency, image Docker, config, health check, scaling, atau perilaku shutdown yang baru?
4. Apakah ini nyeberang batas organization, role, support-admin, secret, attachment, payment, atau security AI?
5. Apa yang bisa duplikat, datang gak berurutan, timeout, atau gagal sebagian?
6. Apa yang perlu di-log, di-ukur (metered), di-trace, dikasih alert, dan dimasukin ke runbook?
7. Layer tes mana yang ngebuktiin sukses, dan mana yang ngebuktiin kegagalan berbahaya itu mustahil terjadi?
8. Gimana caranya perubahan ini dinyalain secara bertahap dan dibalikin dengan aman?
9. Dokumentasi customer/admin/support mana yang ikut berubah?

Jawabannya jadi subtask di story — bukan sekadar catatan diskusi yang ilang abis planning selesai.

---

## 3. Tangga kapabilitas lintas-disiplin

Tangga ini buat nyelesain masalah "CI/CD udah dikerjain di fase 2 terus dilupain". Tiap fase mendeklarasikan **delta** yang ditambahin. Semua level yang udah dicapai sebelumnya tetep wajib dijaga.

### 3.1 Tangga CI/CD

| Level | Kapabilitas wajib                                                                                                   | Wajib mulai di |
| ----- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| C0    | Proteksi repository, pin versi Node/pnpm, integritas lockfile, format/lint/typecheck.                               | M0             |
| C1    | Build semua image yang bakal di-deploy, unit test, status check di PR, retensi artifact.                            | M0             |
| C2    | Integration test pake PostgreSQL/Redis beneran; validasi migration; scan secret/dependency/license.                 | M1             |
| C3    | Contract test, scan container/SBOM, deployment preview/staging yang ephemeral, E2E smoke test.                      | M2             |
| C4    | Promosi image digest, signed provenance, gerbang IaC plan/apply, staging smoke, catatan deployment.                 | M3             |
| C5    | Environment produksi yang protected, identitas deploy OIDC, canary, gerbang health/SLO otomatis, workflow rollback. | M5             |
| C6    | Release train, bukti change-management, gerbang resilience/performance/security terjadwal.                          | M7             |

**Aturan:** setiap ada aplikasi baru, worker baru, migration baru, container baru, public route baru, event baru, atau module IaC baru — itu langsung ditambahin ke semua gerbang yang relevan di seri PR yang sama.

### 3.2 Tangga testing

| Level | Kapabilitas wajib                                                                                    | Wajib mulai di |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------- |
| T0    | Konvensi test, fixture yang deterministik, coverage reporting, gak boleh pake data customer beneran. | M0             |
| T1    | Unit test buat domain policy dan validasi input.                                                     | M1             |
| T2    | Integration test pake PostgreSQL/Redis plus negative test tenant/RLS yang eksplisit.                 | M1             |
| T3    | Fixture contract webhook/API provider; test idempotency/retry/DLQ.                                   | M2             |
| T4    | E2E browser buat critical path, test visual/a11y, test kompatibilitas migration.                     | M3             |
| T5    | Load test, failure injection, security DAST, gerbang evaluasi/rilis AI.                              | M4/M5          |
| T6    | Restore terjadwal, chaos/tabletop, monitoring sintetis di produksi.                                  | M7             |

### 3.3 Tangga Docker, runtime, dan infrastruktur

| Level | Kapabilitas wajib                                                                                              | Wajib mulai di |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| R0    | Dependency Compose lokal, `.env.example`, make target, bootstrap yang reproducible.                            | M0             |
| R1    | Image multi-stage non-root, `.dockerignore`, build image, health endpoint.                                     | M1             |
| R2    | Graceful shutdown worker, resource limit, Compose full-stack lokal, migration jadi satu job.                   | M2             |
| R3    | Terraform remote state, staging yang terisolasi, Postgres/Redis/object storage yang managed, secret manager.   | M3             |
| R4    | Image digest yang immutable, readiness/liveness, kebijakan autoscaling, segmentasi network, monitoring backup. | M5             |
| R5    | Konfigurasi multi-AZ/DR, threshold kapasitas, validasi recovery produksi.                                      | M7             |

### 3.4 Tangga security dan privacy

| Level | Kapabilitas wajib                                                                                       | Wajib mulai di |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------- |
| S0    | Backlog threat-model, aturan penanganan secret, scan dependency/secret.                                 | M0             |
| S1    | Auth, RBAC, tenant RLS, session yang aman, fondasi audit, security header.                              | M1             |
| S2    | Verifikasi signature Meta, secret channel yang terenkripsi, rate limiting, batasan provider yang ketat. | M2             |
| S3    | Scan attachment/proteksi SSRF, kontrol akses support, fondasi retensi/penghapusan.                      | M3             |
| S4    | Minimalisasi data AI/kontrol prompt-injection, review DPA/vendor, workflow export/deletion.             | M4             |
| S5    | SSO/MFA/SCIM, pentest eksternal, latihan incident, review akses.                                        | M7             |

### 3.5 Tangga observability dan operasional

| Level | Kapabilitas wajib                                                                | Wajib mulai di |
| ----- | -------------------------------------------------------------------------------- | -------------- |
| O0    | Log terstruktur, correlation ID, `/livez` dan `/readyz`, error reporting.        | M0             |
| O1    | Metrics/traces buat API, DB, auth; dashboard operasional.                        | M1             |
| O2    | Dashboard/alert webhook, queue, status provider, DLQ, plus runbook.              | M2             |
| O3    | Metrics AI/knowledge/media, visibilitas cost/budget, journey sintetis.           | M4             |
| O4    | SLO/error budget, on-call routing, status page, proses incident.                 | M5             |
| O5    | Bukti restore/DR, review kapasitas, laporan operasional buat eksekutif/customer. | M7             |

### 3.6 Tangga dokumentasi dan kualitas produk

| Level | Kapabilitas wajib                                                                                     | Wajib mulai di |
| ----- | ----------------------------------------------------------------------------------------------------- | -------------- |
| D0    | README, format ADR, konvensi coding/API, panduan kontribusi/setup.                                    | M0             |
| D1    | OpenAPI, kontrak data/event, matrix role, panduan admin/operator buat kapabilitas yang udah dibangun. | M1             |
| D2    | Setup/troubleshooting provider, runbook support, changelog/release notes.                             | M2             |
| D3    | Baseline accessibility/design-system, copy yang udah dilokalisasi, dokumentasi privacy/security.      | M3             |
| D4    | Onboarding customer, dokumentasi billing/plan, panduan integrasi, dokumentasi status/SLA.             | M6             |

---

## 4. Peta fase dan dependensinya

```text
M0 Fondasi eksekusi
  ↓
M1 Inti platform multi-tenant yang aman
  ↓
M2 Irisan vertikal: WhatsApp masuk sampai ke agent
  ↓
M3 Inbox operasional, outbound yang reliable, template & media
  ↓
M4 Ingestion knowledge + AI terkontrol dalam mode draft
  ↓
M5 Routing + auto-send yang dikontrol kebijakan + platform delivery produksi
  ↓
M6 Billing, integrasi, analytics, self-service customer
  ↓
M7 Hardening enterprise + beta design-partner
  ↓
M8 Launch GA + operasi berkelanjutan
```

Panah-panah itu nunjukin dependensi kapabilitas, bukan larangan buat nyiapin hal-hal secara paralel. Design, riset, module Terraform, test harness, dan prototype UI boleh jalan lebih awal, tapi fase-nya tetep gak boleh dianggap selesai kalau urutannya diloncatin.

### 4.1 Ringkasan milestone

| Milestone | Bukti yang keliatan buat customer                                                                                | Dependensi kunci yang dibuka                    |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M0        | Developer bisa reproduce fondasi platform, dan CI ngasih feedback yang bisa dipercaya.                           | Development tim yang aman.                      |
| M1        | Satu organization bisa akses workspace kosong yang terisolasi secara aman.                                       | Data milik tenant dan UI/API yang berwenang.    |
| M2        | Pesan WhatsApp masuk jadi satu percakapan yang terisolasi; agent bisa balas.                                     | Trafik customer beneran.                        |
| M3        | Tim bisa operasiin inbox real-time yang reliable, lengkap template/media.                                        | Workflow operator produksi.                     |
| M4        | Knowledge yang disetujui admin ngehasilin draft balasan agent yang aman dan bersumber jelas.                     | Value AI tanpa otonomi yang berbahaya.          |
| M5        | Otomasi yang disetujui bisa routing/auto-send sesuai kebijakan, dengan kontrol delivery/release setara produksi. | Proposisi revenue dari otomasi yang terkontrol. |
| M6        | Customer bisa bayar, integrasi, dapet laporan, dan self-manage.                                                  | Operasi SaaS komersial.                         |
| M7        | Design partner bisa operasi dengan aman di bawah kontrol dan support enterprise.                                 | Keyakinan buat GA.                              |
| M8        | Jualan ke publik dan operasi berkelanjutan berbasis SLO.                                                         | Delivery skala dan roadmap.                     |

---

## 5. M0 — Fondasi eksekusi

### Tujuan

Bikin sistem development yang reproducible, aman, dan bisa direview. M0 gak ngehasilin fitur buat customer; tujuannya nyegah semua kapabilitas berikutnya jadi susah dites atau susah di-deploy.

### Urutan kerja

1. **Governance repository**
   - Bikin layout monorepo: `apps/{web,api,ingress,worker,scheduler}`, `packages/{db,domain,contracts,providers,config,observability,ui}`, `infra`, `docs`.
   - Pin versi Node 22 LTS/pnpm, config TypeScript strict, ESLint/Prettier, EditorConfig, import boundaries, conventional commits, CODEOWNERS, template PR/issue, SECURITY.md, dan panduan kontribusi.
   - Bikin template ADR dan catet ADR-001: arsitektur modular-monolith/process-role; ADR-002: batasan tenant PostgreSQL RLS; ADR-003: arsitektur referensi deployment.
2. **Developer experience**
   - Tambahin `make bootstrap`, `make dev`, `make test`, `make lint`, `make typecheck`, `make build`, `make db-reset` (khusus lokal aja, jangan sampe kepake di production), `make compose-up/down`, dan `make verify`.
   - Compose nyalain PostgreSQL + pgvector, Redis, MinIO, Mailpit, OpenTelemetry collector, plus Grafana/Prometheus opsional. Seed data cuma yang sintetis (organization/user/message).
   - Tambahin package configuration pake validasi Zod dan `.env.example` per environment; fail closed kalau config-nya kurang.
3. **Skeleton pertama yang bisa di-deploy**
   - API expose `/livez`, `/readyz`, metadata version/build, logger JSON terstruktur, request ID, error response envelope, dan bootstrap OpenTelemetry.
   - Web render shell dengan info health/build lewat typed API client.
   - Ingress/worker/scheduler bisa nyala dan mati dengan bersih, tapi belum ada perilaku domain apapun.
4. **Baseline CI (C0/C1)**
   - Workflow PR: install dependency dari lockfile, format, lint, typecheck strict, unit test, build semua package, build semua image, upload artifact test/build.
   - Termasuk secret scanning, dependency review, dan deteksi workspace yang berubah. Pin commit third-party Actions.
   - Branch `main` protected, wajib CI dan review; CI gak melakukan deploy.
5. **Keputusan fondasi dan backlog**
   - Bikin ID requirement produk, threat model awal, draft data inventory, glossary domain, draft matrix role, aturan penamaan event, style guide API, taksonomi severity, dan format registry feature-flag.

### Demo keluar dari M0

Di mesin/CI runner yang bersih: clone → `make bootstrap` → `make dev` bikin web/API/dependency jalan; `make verify` lolos; kegagalan type/lint/unit-test/image yang disengaja bakal ngeblock PR; log service nunjukin request dan trace ID tanpa bocorin secret.

### DoD M0

- [ ] Semua requirement C0/C1, T0, R0, S0, O0, D0 udah ada buktinya di repository/CI.
- [ ] Tiap process nyala dengan config yang tervalidasi dan mati dengan bersih waktu kena SIGTERM.
- [ ] Image Docker bisa di-build tanpa dependency lokal developer dan jalan sebagai non-root kalau memungkinkan.
- [ ] Gak ada credential produksi, data customer, atau secret hardcoded di repo/test fixture/log.
- [ ] ADR dan backlog yang siap buat Fase 1 udah direview.
- [ ] Durasi CI, kebijakan flaky-test, siapa yang tanggung jawab kalau gagal, dan retensi artifact udah didokumentasiin.

---

## 6. M1 — Inti platform multi-tenant yang aman

### Tujuan

Pemilik organization bisa masuk dengan aman ke workspace baru yang terisolasi, ngundang operator, dan bisa dibuktiin kalau dua user itu gak bisa saling akses data organization masing-masing.

### Urutan kerja

1. **Baseline database sebelum UI fitur**
   - Bikin Prisma schema dan migration SQL manual buat setup UUIDv7/extension, `organizations`, identity/membership/roles, `audit_logs`, `idempotency_keys`, `outbox_events`, dan settings awal.
   - Implementasi role database: owner migration, app runtime `NOBYPASSRLS`, role reporting/break-glass. Tulis kebijakan RLS buat tiap tabel milik tenant dan tes helper transaction `SET LOCAL app.organization_id`.
   - Bikin template migration expand/backfill/contract; CI ngejalanin semua migration ke database fixture yang kosong dan yang schema lama.
2. **Identity dan authorization**
   - Implementasi integrasi identity yang dipilih, email/undangan yang terverifikasi, session HttpOnly yang aman/rotasi refresh, logout/revocation, bootstrap organization, lifecycle membership, flow password/MFA kalau memang diperlukan keputusan produknya.
   - Implementasi permission — bukan cek string role yang berserakan di controller — plus middleware authorization di route/service.
   - Implementasi batasan platform admin sebagai audience/host terpisah di masa depan; jangan nambahin route API yang nge-bypass tenant.
3. **Shell API/web app**
   - Bikin route guard yang authenticated, switcher organization (kalau user emang punya lebih dari satu organization), acceptance undangan, list tim, shell settings yang role-safe, state error/empty/loading/permission-denied.
   - Bangun generation contract OpenAPI/Zod, primitive response cursor, response problem RFC 9457, middleware `Idempotency-Key`, dan helper audit event.
4. **Hardening observability/security**
   - Tambahin header CSP/CSRF/cookie/CORS/security, rate limit buat login dan API, redaksi PII di log, metrics dan trace auth/DB/authorization.
   - Bikin audit viewer yang dibatasi cuma buat permission yang tepat, dan emit audit event buat auth, invite, role, dan perubahan setting organization/security.
5. **Upgrade CI/runtime (C2/T1/T2/R1/S1/O1/D1)**
   - Tambahin suite integration Testcontainers PostgreSQL/Redis, termasuk negative test cross-tenant buat tiap scope repository/API.
   - Tambahin validasi migration database, kebijakan dependency/license, scan vulnerability image, dan threshold coverage baseline buat kode domain/auth.
   - Tambahin image hardened multi-stage, test health endpoint, dashboard operasional buat API/auth/DB, dan draft matrix role/panduan admin awal.

### Demo keluar dari M1

Bikin organization A dan B; undang satu operator ke A; login sebagai tiap role; coba akses langsung pake REST ID, search, routing browser, socket token, dan panggilan repository database yang ngarah ke B. Semuanya harus ditolak/kosong by design, sementara workflow A yang emang diizinin tetep jalan. Audit event nunjukin aksi-aksi yang sensitif ke security.

### DoD M1

- [ ] Semua tabel tenant punya RLS, `organization_id` yang gak boleh null, index, dan negative test integration.
- [ ] Gak ada path database di app runtime yang bisa query tanpa tenant context; migration privileged/akses support itu terpisah.
- [ ] Session, membership, idempotency, error API, audit, dan perilaku role udah punya kontrak dan test yang terdokumentasi.
- [ ] Gerbang M0 tetep hijau; delta M1 udah ditambahin ke CI, konfigurasi image/runtime, monitoring, dan dokumentasi.
- [ ] Rehearsal migration database staging dan catatan rollback/forward-notes udah disimpan bareng rilisnya.

---

## 7. M2 — Irisan vertikal: WhatsApp masuk sampai ke agent

### Tujuan

Dengan aman nerima webhook WhatsApp beneran/sandbox, ngubahnya jadi percakapan yang terisolasi per tenant, dan bikin agent yang berwenang bisa kirim satu balasan teks polos dengan durability dan traceability yang lengkap.

### Urutan kerja

1. **Model channel dan lifecycle koneksi**
   - Tambahin `channels`, referensi credential terenkripsi, status/history koneksi, metadata kepemilikan sender, dan permission channel yang scoped ke tenant.
   - Bangun jalur koneksi test/sandbox dan state machine `DRAFT → CONNECTING → ACTIVE | DEGRADED | DISCONNECTED`. Implementasi cuma interface adapter Meta Cloud API resmi; adapter palsu (fake) dipake buat test lokal/E2E.
2. **Ingress sebagai batas yang durable**
   - Pake route Express raw-body khusus buat verification dan callback dari Meta. Validasi verify token dan signature HMAC dalam constant time sebelum diproses jadi JSON.
   - Simpan raw provider event (terenkripsi/referensi), hash SHA-256, identitas provider, status validasi, correlation ID, timestamp diterima, dan status processing sebelum di-acknowledge.
   - Balikin error yang retryable kalau penyimpanan durable-nya gagal. Redis down gak boleh sampai bikin event yang udah tersimpan durable jadi hilang; sweeper nanti antre event yang pending.
3. **Domain pesan dan pipeline async**
   - Tambahin `contacts`, `conversations`, `messages`, `message_status_events`, `conversation_events`, `webhook_events`, `outbound_intents`, dan index/state policy-nya.
   - Worker normalisasi event teks masuk/contact/status; dedup provider ID; bikin/update satu contact dan percakapan aktif dalam satu transaction; insert domain event/record outbox; publish projection ke browser.
   - Implementasi eligibility service-window sebagai satu policy service, tapi di fase ini cuma dipake buat inform validasi UI/intent.
4. **UI vertikal minimal buat operator**
   - Agent liat list personal/team-safe yang paginated, buka timeline, dan kirim balasan teks lewat composer.
   - API validasi permission, version optimistic percakapan, idempotency key outbound, batas payload, status channel, dan bikin intent — bukan panggilan langsung ke provider.
   - Send worker claim intent, panggil adapter fake/Meta, catet referensi request/response yang udah diredaksi, update state, retry cuma buat kegagalan transient yang udah diklasifikasi, dan emit update timeline/realtime.
5. **Upgrade operasional dan kualitas (C3/T3/R2/S2/O2/D2)**
   - Suite fixture contract provider cover signature webhook, status duplikat/tidak lengkap/gak berurutan, mapping error, dan payload outbound.
   - Tes crash/retry di antara tiap side effect; buktiin 100 webhook duplikat cuma ngehasilin satu message dan paling banyak satu outbound intent/send.
   - Tambahin config separasi/concurrency queue, DLQ, command replay yang dibatasi cuma buat role support, graceful shutdown worker, dashboard queue/webhook/provider plus alert/runbook.
   - Update panduan setup developer/provider dan troubleshooting buat operator.

### Demo keluar dari M2

Dari sender sandbox/test, kirim teks masuk dan replay webhook yang sama berulang kali. Munculnya cuma sekali di inbox tenant yang bener. Satu agent yang di-assign kirim satu balasan; transisi status worker/provider muncul cuma sekali di timeline dan audit trail. Matikan Redis atau worker di tengah proses, nyalain lagi, dan buktiin reconciliation-nya selesai tanpa kehilangan data atau kirim duplikat.

### DoD M2

- [ ] Webhook yang signed itu diverifikasi raw-body-nya, disimpan duluan, dinormalisasi secara idempotent, dan bisa di-replay secara independen.
- [ ] Semua efek inbound/outbound pake idempotency berbasis database dan outbox yang durable — bukan cuma lock Redis doang.
- [ ] Cek tenant/RBAC cover channel, contact, percakapan, message, event, dan room realtime.
- [ ] Error rate webhook/queue/provider, lag, job tertua, DLQ, duplikat, dan lifecycle send bisa diobservasi lengkap sama alert/runbook yang terdokumentasi.
- [ ] CI ngejalanin test contract provider dan failure/idempotency worker; test startup dan shutdown image/worker yang udah diupdate lolos.
- [ ] Dokumentasi setup API/event/provider, klasifikasi retensi data, dan prosedur support udah diupdate.

---

## 8. M3 — Inbox operasional, outbound yang reliable, template, dan media

### Tujuan

Ngubah tampilan percakapan yang minimal jadi workspace operasional harian buat tim support, lengkap sama assignment terkontrol, handoff, template, attachment, dan perilaku realtime yang reliable.

### Urutan kerja

1. **Operasi percakapan**
   - Implementasi model queue/tim, claim/release assignment, catatan privat, tag, penanda unread/read, resolve/reopen, state menunggu, placeholder pause/resume bot, timestamp SLA, jam kerja, dan perilaku optimistic concurrency.
   - Definisikan tiap transisi state di policy domain dan timeline event. Tes eksplisit buat race condition: dua claim bersamaan, kirim pesan setelah conversation ditutup, update dari tab yang basi (stale), agent yang dihapus di tengah aksi.
2. **Ketepatan realtime**
   - Tambahin koneksi Socket.IO yang authenticated, otorisasi room organization/team/percakapan, adapter Redis, versi schema event, protokol reconnect/reconciliation, presence/kapasitas — cuma kalau kebijakan privacy ngedukung.
   - Browser nganggep event sebagai hint/projection dan refetch kalau ada gap version. Isi pesan gak boleh ditulis ke telemetry browser pihak ketiga.
3. **Template dan eligibility provider**
   - Tambahin record/status sync template, model template resmi yang versioned, validasi component/variable, service eligibility service-window/template, preview/audit payload yang di-render, dan panduan error terminal.
   - Sync status provider secara idempotent; jangan pernah anggap template lokal udah approved tanpa cek status provider-nya.
4. **Pipeline attachment/media**
   - Tambahin flow upload presigned yang private, validasi MIME magic-byte/type/size, checksum, scan malware/quarantine, metadata object storage terenkripsi, adapter upload/download provider, otorisasi download yang aman, lifecycle/retensi.
   - Tangani kegagalan scan/provider dengan aman; media gak boleh pernah diserve pake URL publik permanen.
5. **Kualitas UX web**
   - Bangun list queue/timeline/composer yang keyboard-accessible; tambahin saved filter, state empty/loading/offline/error/conflict, layout triage yang responsive, dan string Bahasa Indonesia/English yang udah dilokalisasi buat screen yang udah dirilis.
6. **Upgrade release/kualitas (T4/R3/S3/D3)**
   - E2E browser: agent login → pesan masuk → claim → catatan/tag → kirim teks/template/media → update status; cek negative authorization dan reconnect.
   - Tambahin cek a11y, visual regression buat state kritis, test kompatibilitas migration, test fixture staging object-storage/malware, dan test security SSRF/file-upload.
   - Siapin infrastruktur staging yang terisolasi dan secret manager lewat Terraform yang direview; update image/manifest runtime, network policy, panduan retensi dan support.

### Demo keluar dari M3

Dua agent dan satu supervisor kerja di queue simulasi yang sama lewat tab browser berbeda. Cuma aksi yang berwenang aja yang berhasil; conflict state keliatan; satu agent dengan aman claim dan balas pake template yang udah disetujui provider dan attachment yang udah discan; update delivery reconnect dengan bener setelah API restart. Semua operasi bisa ditelusuri/diaudit dan gak ada attachment yang bisa diakses publik.

### DoD M3

- [ ] Aksi inbox punya test transisi domain, integration test API, dan coverage E2E browser termasuk state conflict/reconnect/error.
- [ ] Pipeline media punya perilaku authorization, checksum, scan/quarantine, error provider, retensi, dan penghapusan yang udah dites.
- [ ] Realtime punya auth, isolasi room, version/reconciliation, metrics backpressure/koneksi, dan runbook disconnect.
- [ ] Template dan eligibility service udah tersentralisasi, dites lewat fixture, dan bisa jelasin kegagalan dengan aman ke operator.
- [ ] Terraform/staging dan semua kewajiban C0–C3/T0–T4/R0–R3/S0–S3/O0–O2/D0–D3 udah kepenuhi.

---

## 9. M4 — Ingestion knowledge dan AI assistant di mode draft

### Tujuan

Admin bisa publish knowledge tenant yang udah disetujui, dan agent bisa dapet draft balasan AI yang aman dan bersumber jelas. Bot gak boleh auto-send di milestone ini.

### Urutan kerja

1. **Model data/version knowledge**
   - Tambahin source, document, chunk, knowledge set/version, ingest job, content hash, metadata parse/embedding, permission source, state publish/archive/delete, dan vector index yang udah dibenchmark pake data representatif.
   - Definisikan semantik version yang published itu immutable. Tiap bot run nyimpen snapshot version bot/knowledge/model/prompt yang persis.
2. **Pipeline ingestion yang aman**
   - Intake source teks/file/URL yang disetujui; pake ulang pipeline attachment yang udah hardened; URL fetcher nolak private IP/target metadata, kontrol DNS rebinding/redirect, izinin protocol/content type tertentu, dan terapkan batas size/time.
   - Scan virus, parse/normalize/extract, chunk dengan content hash/metadata, embed lewat adapter/cache provider, index, laporin progress dan alasan error yang aman. Retry itu idempotent per source/version.
3. **Retrieval dan konfigurasi bot**
   - Tambahin version draft/published bot, bahasa/tone/instruksi, allow-list source, top-K/threshold retrieval, jam yang diizinin, aturan fallback/escalation, mode `OFF`/`DRAFT`, dan emergency disable per organization.
   - Cuma retrieve chunk yang disetujui dan scoped ke organization/version. Bangun context percakapan yang bounded dan output provider terstruktur lengkap sama citation. Terapkan threshold kualitas source; bukti yang kurang cukup harus bikin escalation/gak jawab.
4. **Pengalaman draft dan audit**
   - Di timeline/composer percakapan, tampilin draft AI, citation source/confidence internal/alasan, estimasi token/cost (kalau diizinin), kontrol approve/edit/send/reject, dan taksonomi feedback.
   - Simpan `bot_runs`, bukti retrieval, hasil policy, hash output, metadata latency/token/cost model. Approval manusia bikin path outbound intent standar dari M2/M3.
5. **Gerbang rilis keamanan dan kualitas AI (T5/S4/O3)**
   - Bangun evaluation set yang anonim/versioned: kasus grounded, no-evidence, multilingual, ambigu, prompt injection, sensitif kebijakan, escalation, dan cost-limit.
   - Tambahin aturan prompt-injection, minimalisasi/redaksi PII, konfigurasi penanganan data provider, rate/budget limit, circuit breaker, dan fallback kegagalan. Jangan ada raw prompt/jawaban di log default.
   - CI ngejalanin test schema/policy/retrieval; evaluasi terjadwal ngehasilin metrics. Dashboard nunjukin state ingestion, indikator kualitas retrieval, latency/error provider, cost/budget AI, dan rate block/escalation.

### Demo keluar dari M4

Admin upload satu source yang bersih dan satu yang malicious/invalid, publish satu version knowledge, dan kirim pertanyaan yang representatif. Agent dapet draft dengan citation cuma kalau bukti melebihi kebijakan; pertanyaan yang gak didukung/kena injection akan escalate dengan aman. Source yang ditolak dan provider AI yang down ngehasilin status yang jelas, gak ada kebocoran data, dan gak ada pengiriman keluar.

### DoD M4

- [ ] Bot dibatasin keras cuma `OFF`/`DRAFT`; gak ada jalan yang bisa auto-send, termasuk waktu retry/race condition.
- [ ] Tiap jawaban yang kepake bisa ditelusuri ke version bot/config/knowledge/model/prompt/evidence dan approval manusia.
- [ ] Query source knowledge dan chunk itu scoped ke RLS/version; ingest/delete/retensi dan keamanan URL/file udah dites.
- [ ] Threshold evaluasi AI, budget cost, fallback/circuit provider, audit kebijakan, dan emergency disable jalan di staging.
- [ ] Standar inbound/outbound, CI/CD, image, tracing, alert, dan support yang udah ada — udah nyakup proses AI/knowledge.

---

## 10. M5 — Otomasi terkontrol dan platform rilis produksi

### Tujuan

Ngizinin respons otomatis dan routing yang qualified di bawah kebijakan ketat, sambil upgrade deployment, monitoring, dan kontrol operasional ke standar setara produksi.

### Urutan kerja

1. **Policy engine routing dan otomasi**
   - Implementasi aturan berurutan yang deterministik: channel/contact/tag/bahasa/waktu/intent/kapasitas queue/state bot/consent/entitlement plan. Aturan punya version draft/published, priority, simulator, output trace, dan deteksi conflict.
   - Definisikan allow-list auto-send, max balasan per contact/percakapan/window waktu, confidence/evidence yang wajib, intent yang dilarang, perilaku jam kerja, eligibility template/window, kondisi escalation, dan disclosure customer yang wajib kalau diperlukan.
2. **State machine auto-send**
   - Perkenalkan `AUTO` cuma per version bot/channel/organization yang opt-in secara eksplisit. Sebelum kirim, cek ulang version/assignment/pause/status emergency percakapan saat ini dan eligibility-nya — approval waktu draft aja gak cukup.
   - Auto-send pake pipeline delivery `outbound_intents`/provider yang sama kayak agent; link kausal ke pesan masuk dan bot run itu wajib. Handoff atau aksi manual harus otomatis nge-cancel intent otomatis yang belum kekirim, sebisa mungkin secara atomic.
   - Tambahin kill switch yang scoped global dan tenant, lengkap sama alasan/expiry yang teraudit; tes propagasinya ke worker yang lagi jalan/job yang lagi diantre.
3. **CI/CD produksi (C4/C5/R4/O4)**
   - Build sekali, scan/SBOM/provenance attest, publish image digest yang immutable, promosikan digest yang sama persis dari staging ke produksi.
   - Terraform plan/apply pake environment yang protected dan identitas cloud OIDC yang short-lived. Deploy ke staging ngejalanin validasi migration, test webhook/provider sintetis, smoke/E2E.
   - Produksi pake migration yang expand-compatible, canary 5%→25%→100%, pause/rollback eksplisit, gerbang health/SLO/queue/provider, catatan deploy/change, dan sintetis post-deploy.
4. **Model operasi SLO dan incident**
   - Implementasi SLO availability/webhook/queue/outbound/AI yang udah didefinisiin dan dashboard error budget. Konfigurasi routing P1/P2, status page, runbook on-call, playbook outage provider, role/template incident.
   - Jalanin staged failure drill: crash worker, outage Redis, simulasi DB failover, Meta 429/5xx, timeout AI, websocket yang basi (stale); buktiin safe mode dan reconciliation-nya jalan.
5. **Gerbang rilis auto-send**
   - Per version bot: lolos threshold evaluasi, approval dari peer/security/product, aktivasi tenant bertahap, rencana sampling manusia, batas rate/cost, owner rollback, dan consent/settings customer yang jelas.

### Demo keluar dari M5

Tenant beta yang terkontrol nyalain auto-send buat satu FAQ yang udah disetujui. Satu pesan yang qualified di-routing, dikasih bukti, dan dikirim sekali; satu takeover manusia, bukti yang kurang cukup, batas plan, provider 429, dan kill switch global masing-masing berhasil nyegah/menghentikan otomasi dengan aman. Deployment canary maju/rollback berdasarkan sinyal terukur tanpa ngedit server secara manual.

### DoD M5

- [ ] Auto-send itu policy-gated, opt-in, dibatasi rate/cost, berbasis bukti, teraudit, dan bisa dimatiin di level global/tenant/bot/percakapan.
- [ ] Deployment produksi pake image yang immutable dan terverifikasi dengan OIDC, promosi staging, canary, gerbang health otomatis, dan rollback yang terdokumentasi.
- [ ] SLO, alert, kepemilikan on-call, komunikasi status, runbook incident, dan bukti failure drill udah live.
- [ ] Semua tangga sebelumnya tetep hijau; jalur policy/routing/auto-send yang baru punya bukti unit, integration, E2E, load/failure, dan evaluasi AI.

---

## 11. M6 — Billing, integrasi, analytics, dan self-service customer

### Tujuan

Bikin FlowDesk siap secara komersial: customer ngerti entitlement/usage mereka, admin bisa self-manage, developer bisa integrasi dengan aman, dan tim dapet analytics yang actionable.

### Urutan kerja

1. **Fondasi entitlement dan billing**
   - Tambahin katalog/version plan, entitlement, state subscription, ledger usage yang immutable, referensi invoice/provider, kebijakan grace/suspension, adjustment, dan job reconciliation.
   - Adapter billing provider verifikasi signature webhook raw, simpan/dedup event sebelum di-project, dan jangan pernah bikin batas data kartu jadi bagian dari FlowDesk.
   - Batasin channel/seat/AI/retensi/limit API lewat satu entitlement service. Waktu billing provider lagi down, terapin perilaku grace yang terdokumentasi — bukan penolakan yang acak dan gak konsisten.
2. **Self-service customer**
   - Sediain handoff billing portal, tampilan invoice/usage/plan, manajemen seat/tim/channel, lifecycle API-key (cuma prefix + hash), webhook integrasi yang scoped, verifikasi endpoint, delivery yang signed, retry/history/DLQ, dan audit trail.
3. **Analytics dan reporting**
   - Definisikan glossary metrics duluan: inbound/outbound, first response, resolution, queue/SLA, workload agent, draft/accept/escalation bot, kesehatan knowledge, cost/usage. Tentukan time zone, filter, perilaku permission/privacy, dan koreksi event yang telat.
   - Bikin read model/aggregate lewat job asynchronous; jangan pernah jalanin query analytical yang unbounded di transaction inbox. Sediain export lengkap sama authorization, rate limit, watermark, audit/logged download, dan retensi.
4. **Ekspansi kualitas/ops**
   - Contract-test provider billing/integrasi; tes race condition/idempotency entitlement; tambahin dashboard delivery integrasi, alert reconciliation finance, metrics freshness analytics, test security export/deletion, dokumentasi admin/API customer, dan script support.

### Demo keluar dari M6

Lifecycle billing sandbox ngubah entitlement persis sekali walau ada callback yang duplikat/gak berurutan. Owner bisa liat subscription/usage, bisa rotate API key yang scoped dan cek retry webhook integrasi yang signed. Supervisor liat laporan metrics yang bener dan udah difilter; export-nya berwenang/teraudit; batas produk tetep konsisten diterapin walau lagi ada outage billing di upstream.

### DoD M6

- [ ] Record usage dan yang berkaitan sama uang itu immutable, idempotent, bisa direkonsiliasi, dan gak pernah pake floating point.
- [ ] Tiap keputusan entitlement itu tersentralisasi, dites, bisa dijelasin, dan terwakili di UI/tools support.
- [ ] API/webhook developer eksternal punya scope, rotation/revocation, signing, proteksi replay, observability, docs, dan recovery delivery.
- [ ] Analytics punya definisi metrics, privacy/RBAC, perilaku freshness/error, read path yang scalable, kontrol export, dan dokumentasi buat customer.

---

## 12. M7 — Hardening enterprise dan beta design-partner

### Tujuan

Validasi FlowDesk sama design partner beneran dan lengkapin kontrol-kontrol yang dibutuhin biar bisa bikin janji enterprise yang kredibel.

### Urutan kerja

1. **Identity dan administrasi enterprise**
   - Tambahin SSO SAML/OIDC, kebijakan MFA/session yang wajib, provisioning lifecycle SCIM (kalau dipaketin), domain yang terverifikasi, manajemen device/session, dan workflow impersonation/break-glass console support yang teraudit terpisah.
2. **Bukti security/compliance**
   - Lengkapin data inventory, dokumentasi DPA/subprocessor/security, flow retensi/deletion/export, proses review akses kuartalan, rotasi key/credential, assessment vendor, risk register, dan kepemilikan policy.
   - Libatkan pentest independen; triage/perbaikin temuan; jalanin scan SAST/DAST/container/dependency/secret secara terus-menerus. Jangan pernah klaim sertifikasi tanpa scope/audit formal.
3. **Reliability/kapasitas/DR**
   - Load test forecast dan trafik 2x forecast; benchmark retrieval/vector, queue, websocket, migration, dan connection pool API. Catat threshold dan aksi scaling.
   - Buktiin RPO/RTO lewat restore yang terisolasi; jalanin tabletop DR, credential compromise, tenant-isolation, outage Meta, dan balasan AI yang berbahaya. Selesain action item-nya.
4. **Operasi beta**
   - Onboard design partner terbatas lewat checklist yang terdokumentasi; konfigurasi flag/limit beta yang eksplisit; review mingguan buat SLO, kualitas, tiket, cost, kesehatan provider, dan feedback.
   - Jalanin escalation support customer, komunikasi status/incident, komunikasi perubahan, dan training. Jangan launch luas sebelum kondisi exit beta yang terukur lolos.
5. **Hardening rilis (C6/T6/R5/S5/O5/D4)**
   - Tambahin test restore/resilience/performance/security terjadwal, bukti release train/change, laporan operasional buat eksekutif/customer, runbook/kepemilikan lengkap dan materi launch.

### Kriteria keluar dari beta

- [ ] Jumlah/tipe tenant beta yang disepakati udah nyelesain workflow representatif selama periode yang disepakati, tanpa P1 yang belum selesai atau kegagalan P2 yang berulang.
- [ ] SLO, recovery objective, evaluasi/feedback AI, performance queue/provider, dan response support kepenuhi sesuai threshold beta yang dipublish.
- [ ] Temuan pentest/review risiko tinggi udah diselesaikan atau formally risk-accepted sama leadership yang berwenang, lengkap sama compensating control dan expiry-nya.
- [ ] Latihan restore dan incident udah punya bukti dan semua follow-up penting udah ditutup.
- [ ] Dokumen legal/komersial/customer-support udah sesuai sama produk yang beneran dirilis.

---

## 13. M8 — General availability dan operasi berkelanjutan

### Tujuan

Launch dengan hati-hati, operasi berbasis SLO/error budget, dan terus kembangin FlowDesk tanpa ngerusak kontrol fondasi yang udah dibangun.

### Urutan launch

1. Adain review go/no-go berdasarkan checklist launch Enterprise Specification dan bukti exit beta M7. Owner product, engineering, security, operations/support, dan legal/komersial masing-masing tanda tangan scope mereka.
2. Freeze perubahan high-risk yang gak perlu-perlu banget; verifikasi image/config/secret produksi, backup, alert routing, status page, billing, kontak provider, staffing support, dan jalur rollback.
3. Nyalain customer baru per kohort dengan headroom kapasitas/support yang terukur. Amatin journey pertama: onboarding, koneksi sender, pesan masuk, balasan manual, draft AI/auto-send, billing, dan support.
4. Jalanin review launch harian, terus pindah ke review operasi mingguan. Prioritasin bug/reliability/security di atas ekspansi roadmap selama error budget-nya belum sehat.

### Aturan yang berlaku terus

- Setiap fitur roadmap masuk ke sistem story/PR/change-impact/DoD yang sama; gak ada "jalan pintas pasca-GA".
- Bulanan: review akses, triage vulnerability, review cost/kapasitas/flag/expiry credential.
- Kuartalan: test restore, latihan incident, review provider/version/dependency, validasi disaster-recovery dan retensi.
- Keputusan rilis itu tergantung state SLO/error-budget, bukan cuma tekanan tanggal doang.

---

## 14. Matrix lintas-disiplin per fase

Ini peta "anti-lupa" yang wajib. `Maintain` artinya semua requirement sebelumnya tetep berlaku; `Add` artinya deliverable baru.

| Track            | M0                | M1            | M2                     | M3                              | M4                                      | M5                          | M6                              | M7/M8                     |
| ---------------- | ----------------- | ------------- | ---------------------- | ------------------------------- | --------------------------------------- | --------------------------- | ------------------------------- | ------------------------- |
| CI/CD            | Add C0–C1         | Add C2        | Add C3                 | Maintain + cek staging          | Add persiapan promosi provenance/digest | Add C4–C5 canary            | Add coverage contract provider  | Add C6 release train      |
| Tests            | Add T0            | Add T1–T2     | Add T3                 | Add T4                          | Add porsi AI eval T5                    | Selesain T5 failure/load    | Contract billing/integrasi      | Add T6 restore/chaos      |
| Docker/infra     | Add R0            | Add R1        | Add R2                 | Add R3                          | Maintain                                | Add R4                      | Kebutuhan scale/read-model      | Add R5 DR/kapasitas       |
| Security/privacy | Add S0            | Add S1        | Add S2                 | Add S3                          | Add S4                                  | Maintain/validasi auto-send | Kontrol billing/API/data-export | Add S5/pentest/SSO        |
| Observability    | Add O0            | Add O1        | Add O2                 | Maintain                        | Add O3                                  | Add O4/SLO/on-call          | Metrics finance/integrasi       | Add O5/bukti DR           |
| Docs/produk      | Add D0            | Add D1        | Add D2                 | Add D3                          | Panduan admin AI/kebijakan eval         | Docs incident/status        | Add D4 docs customer            | Docs launch/enterprise    |
| Data             | Konvensi baseline | RLS/migration | messaging/event/outbox | state media/template/percakapan | knowledge/vector versioned              | retensi automation/audit    | read model billing/analytics    | bukti backup/restore/DSAR |

Gak ada fase yang boleh nandain satu track "N/A" cuma karena gak ada engineer khusus yang di-assign. Lead fase itu wajib assign kepemilikan atau ngeluarin fitur itu dari scope.

---

## 15. Checklist DoD generik, berlaku buat semua kapabilitas

### 15.1 DoD backend/domain

- [ ] Transisi state domain, invariant, authorization, idempotency, dan taksonomi error itu eksplisit dan udah di-unit-test.
- [ ] DTO API/event itu tervalidasi schema/versioned; breaking change punya rencana migration/deprecation.
- [ ] Semua akses data tenant terjadi di dalam tenant context/RLS transaction; negative test buktiin isolasinya.
- [ ] Batas transaction, publikasi outbox/event, perilaku concurrency, dan retry safety udah didokumentasiin/dites.
- [ ] Limit input, budget pagination/query, rate limit, dan timeout provider udah didefinisiin.

### 15.2 DoD frontend/UX

- [ ] State design/interaksi cover loading, empty, validation, server error, offline/reconnect, permission denied, conflict, dan konfirmasi buat aksi yang gak bisa dibatalin.
- [ ] Pake contract API/event yang typed; jangan pernah bikin asumsi authorization dari visibility UI doang.
- [ ] Accessibility: keyboard, focus, semantics, label/error, kontras; critical flow dicek otomatis dan manual.
- [ ] UI gak boleh ngebocorin secret/PII di log, analytics, URL, atau cached screen yang gak berwenang.
- [ ] Event analytics dan lokalisasi itu disengaja dan udah direview dari sisi privacy.

### 15.3 DoD data/migration

- [ ] Kepemilikan schema, constraint, index, RLS, retensi/deletion, field terenkripsi, dan dampak query plan udah direview.
- [ ] Migration itu expand-compatible, reversible/forward-fix terdokumentasi, direhearse lewat test, dan jalan sekali di bawah deploy lock.
- [ ] Backfill punya throttling, resume key, metric progress, error path, dan kondisi rollback/cutover.
- [ ] Dampak backup/restore dan analytics udah dinilai; gak ada query unbounded yang ditambahin ke hot transaction path.

### 15.4 DoD async/provider

- [ ] Side effect punya intent/event yang durable, idempotency key/unique constraint, klasifikasi retry, timeout, backoff/jitter, DLQ, dan perilaku replay yang aman.
- [ ] Duplikat, out-of-order, 4xx/429/5xx provider, timeout, crash worker, dan reconciliation udah dites.
- [ ] Secret/payload provider itu terenkripsi/diredaksi; version, rate limit, dan owner deprecation udah dicatet.
- [ ] Concurrency/priority/backpressure queue dan cleanup/retensi job udah didefinisiin.

### 15.5 DoD CI/CD dan Docker

- [ ] Package/process/image baru itu udah masuk ke install, lint, typecheck, test, build, scan, publikasi artifact/image, dan manifest deployment.
- [ ] Image itu reproducible, pinned, non-root, minimal, discan/di-SBOM di level yang sesuai, punya requirement health/graceful shutdown/resource.
- [ ] Schema config, referensi secret, readiness, scaling, akses network, dan permission runtime udah diupdate per environment.
- [ ] Deployment pake image digest yang immutable; rencana migration dan rollback/feature flag udah dicatet.

### 15.6 DoD security/operations/docs

- [ ] Dampak threat/privacy udah dinilai; RBAC/RLS, audit event, rate/abuse limit, penanganan secret, dan perubahan retensi udah diimplementasi.
- [ ] Log/metrics/trace/dashboard/alert dan runbook cover sukses/gagal; redaksi PII udah diverifikasi.
- [ ] Docs support/admin/developer, OpenAPI/event schema, release note, dan kebutuhan komunikasi status udah diupdate.
- [ ] Owner, jalur on-call, dampak SLO/cost, feature flag/kill switch, dan rollback udah jelas.

---

## 16. Workflow rilis buat tiap milestone

```text
Plan → Design/ADR → Pecah tiket → Implementasi di balik batasan yang aman
     → PR/CI → Preview atau staging → cek integration/E2E/security
     → demo ngelawan kriteria acceptance → review bukti fase
     → rilis/promosi → cek sintetis pasca-rilis → retrospective
```

### 16.1 Paket bukti wajib waktu nutup fase

Owner fase publish release note singkat yang isinya:

1. kapabilitas customer yang dirilis dan scope yang dikecualiin;
2. epic/PR/ADR/migration/image digest yang terkait;
3. bukti test dan staging, termasuk keterbatasan yang udah diketahui;
4. delta matrix lintas-disiplin yang udah kelar;
5. dashboard/alert/runbook/docs yang ditambahin atau diubah;
6. hasil review security/privacy;
7. hasil rollout/rollback dan risiko yang belum selesai lengkap sama owner/tanggalnya;
8. konfirmasi prasyarat buat fase berikutnya.

Paket bukti itu handoff tertulis yang praktis, bukan presentasi slide. Tujuannya biar project bisa dihentiin/dilanjutin lagi tanpa harus ngebangun ulang konteksnya dari ingatan doang.

### 16.2 Definisi fase yang blocked

Berhenti dan selesain, jangan malah dikelilingin (workaround), kalau ada: kepemilikan tenant/data yang gak jelas; keputusan legal/provider penting yang belum ada; gak bisa buktiin satu batas security; jalur migration/backup yang rusak; gak ada environment testing yang aman; akses produksi yang gak terkontrol; atau flakiness berulang yang bikin CI gak bisa dipercaya lagi. Catat itu sebagai keputusan/risiko, bukan workaround yang gak keliatan.

---

## 17. Backlog awal M0 dalam urutan eksekusi yang persis

Ini antrean pertama yang bisa langsung dikerjain setelah blueprint ini disetujui. Jangan mulai implementasi fitur sebelum item 1–12 selesai atau di-resequence secara eksplisit lewat ADR.

1. Bikin kontrol Git repository: `main` yang protected, review/check yang wajib, CODEOWNERS, template issue/PR, SECURITY.md.
2. Init workspace pnpm/Turborepo, pin Node/pnpm, konfigurasi TypeScript/ESLint/Prettier bersama, dan batasan workspace.
3. Bikin skeleton direktori aplikasi/package dan process minimal yang bisa di-build: `api`, `web`, `ingress`, `worker`, `scheduler`.
4. Tambahin `packages/config` dengan configuration yang schema-validated, `.env.example`, dokumentasi config, dan test buat fail-closed startup.
5. Tambahin Dockerfile, `.dockerignore`, eksekusi non-root, profile dependency Compose, Makefile, dan panduan bootstrap mesin bersih.
6. Tambahin workflow CI C0/C1 dengan install lockfile, format/lint/typecheck/unit/build/image build, scan secret, retensi artifact, dan verifikasi yang sengaja bikin gagal.
7. Tambahin structured logger, correlation/request ID, skeleton OpenTelemetry, health endpoint, error envelope, dan test redaksi.
8. Tulis ADR-001/002/003 dan glossary domain awal, konvensi penamaan API/event, backlog threat model, template severity/runbook.
9. Konfigurasi service lokal PostgreSQL+pgvector/Redis/MinIO/Mailpit/observability dan data seed sintetis.
10. Bikin konvensi test harness dan satu unit test per aplikasi/package; terapin setup test yang deterministik.
11. Tambahin struktur Terraform awal/state backend dan validasi formatting/plan di CI tanpa apply infrastructure beneran.
12. Jalanin demo exit M0 dari clone yang baru banget, benerin friction-nya, lalu bikin/review tiket M1 pake template story yang wajib.

### Langkah selanjutnya yang persis

Mulai dari **item 1 M0** dan bikin hierarki issue buat M0 di waktu yang sama. Begitu M0 udah hijau semua, jangan langsung loncat ke AI atau UI inbox: mulai M1 dari fondasi database tenant/RLS. Urutan ini nyegah rework paling mahal yang mungkin kejadian di FlowDesk — yaitu balik lagi masangin tenant isolation, auditability, dan disiplin delivery setelah data messaging beneran udah ada.
