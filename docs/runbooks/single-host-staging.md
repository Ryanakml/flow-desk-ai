# Single-host staging

## Purpose and boundary

This environment makes the current FlowDesk build continuously inspectable on one Linux VM, including the current AWS EC2 target. It is staging, not the AWS production reference in ADR-003. The host is a single failure domain for the application and its stateful dependencies; provider snapshots, an external database, object-storage lifecycle policy, multi-host failover, and production provider credentials remain separate work.

The public surface is Caddy on ports 80 and 443. PostgreSQL, Redis, MinIO, ClamAV, and the five application roles are reachable only on an internal Docker network. Routes are:

- `/` and `/livez` to `web`;
- `/api/*`, `/metrics`, and `/realtime*` to `api`;
- `/webhooks/*` to `ingress`.

`PUBLIC_BASE_URL` is the canonical external staging origin. It must be an HTTPS origin without a path, query string, fragment, or credentials. The deployment health gate and GitHub public smoke test derive `/livez` and `/api/v1/system/build` from it. `SITE_ADDRESS` is Caddy's listener address and must match the hostname in `PUBLIC_BASE_URL`; it is initialized from that URL by `configure-staging-env.sh`.

To move staging to a new domain, update only `PUBLIC_BASE_URL` and `SITE_ADDRESS` in `/opt/flowdesk/shared/staging.env`, then update the identity provider's allowed callback URL and merge a release PR. Do not use a raw IP or HTTP URL as `PUBLIC_BASE_URL`. Mock authentication and insecure cookies remain staging-only settings; before real customer data or provider credentials are used, set `AUTH_MOCK_ENABLED=false` and `AUTH_COOKIE_SECURE=true`.

## Host bootstrap

For a fresh host, run `bootstrap-host.sh` once as root with a dedicated Ed25519 public key and optional deployment username. The script installs Docker Engine and Compose, creates or reuses the unprivileged deployment user, configures bounded Docker logs, enables Fail2ban, and enables UFW with only 22/tcp, 80/tcp, 443/tcp, and 443/udp inbound. On Ubuntu EC2, pass `ubuntu` as the second argument if GitHub Actions should use the pre-created account. Coordinate UFW with the EC2 security group so SSH remains reachable.

If Docker is already installed, use the non-destructive preparation helper instead of the full bootstrap. It checks Docker and Compose, adds the existing user to the Docker group, creates the required directories, and preserves an existing `staging.env`:

```bash
sudo ./prepare-host.sh ubuntu
```

Log out and reconnect after the first Docker group change. `configure-staging-env.sh` creates `/opt/flowdesk/shared/staging.env` once with mode `0600`. It refuses to overwrite existing secrets. Export the real FlowDesk Meta App secret as `WEBHOOK_APP_SECRET` before running it; the script deliberately refuses to invent this value because a random secret would make every real Meta webhook fail HMAC validation. The tracked `environment.example` documents its contract without containing usable credentials.

```bash
read -rsp "FlowDesk Meta App secret: " WEBHOOK_APP_SECRET
export WEBHOOK_APP_SECRET
sudo --preserve-env=WEBHOOK_APP_SECRET ./configure-staging-env.sh https://staging.example.com
unset WEBHOOK_APP_SECRET
```

## AI provider runtime

The AI worker starts with `AI_PROVIDER=disabled` unless a provider is selected explicitly. In this
mode, the rest of FlowDesk remains available and draft requests remain durable but unprocessed.
`AI_PROVIDER=fake` is allowed only for local or preview testing and is rejected during staging or
production startup.

Gemini is the recommended provider for synthetic development and OpenAI remains optional. Both
credentials are server-only and are passed only to the worker container. They are not shared with
the web, API, ingress, scheduler, image build, or GitHub Actions. To enable the Gemini runtime, edit
`/opt/flowdesk/shared/staging.env` directly on the host with `sudoedit`; set `AI_PROVIDER=gemini` and
add `GEMINI_API_KEY` without printing it in shell history or logs. Keep the stable
`GEMINI_CHAT_MODEL=gemini-3.7-flash` and `GEMINI_EMBEDDING_MODEL=gemini-embedding-2` defaults unless a
reviewed migration requires otherwise. The embedding adapter explicitly requests 1536 dimensions.

To select OpenAI instead, set `AI_PROVIDER=openai` and add `OPENAI_API_KEY`; no Gemini credential is
required in that mode. Never commit the edited environment file. Use only synthetic data on the
Gemini free tier because its data-use terms differ from the paid tier; customer-data testing requires
an approved provider/tier privacy review.

Validate only the shape of the deployment without rendering environment values:

```bash
cd "/opt/flowdesk/releases/$(cat /opt/flowdesk/shared/current-image)"
docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml config --quiet
```

The next merge-triggered release recreates the API with the host configuration. Startup logs expose
only the selected provider and model identifiers, never the credential. A real staging smoke must
create a draft through the authenticated API, verify the persisted run status, token usage, latency,
and citations, then confirm that no outbound message is sent by draft generation alone. The worker
persists the actual runtime chat model on the completed bot run and records the provider identifier
in its audit metadata.

## Automated release

Pull requests execute all quality/database/Terraform gates and cached image builds but never contact staging. A push to `main` after every required job succeeds performs the release:

1. BuildKit restores and updates one GitHub Actions cache scope per image.
2. Six SHA-tagged images (`web`, `api`, `ingress`, `worker`, `scheduler`, and `migrator`) are published to GHCR.
3. The exact Compose manifest and release scripts are copied to `/opt/flowdesk/releases/<git-sha>`.
4. Stateful dependencies become healthy.
5. The checksum-locked migration runner executes once under its PostgreSQL advisory lock.
6. The restricted `flowdesk_app` login is provisioned as a member of the `NOBYPASSRLS` runtime group; applications never receive the bootstrap credential.
7. Application containers start, then the canonical public `/livez` endpoint and API build identity must both return `200`; the observed build SHA must match the release SHA.
8. GitHub stores the public build response as 30-day deployment evidence.

The `staging` GitHub Environment holds `STAGING_SSH_PRIVATE_KEY`; its non-secret variables are `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_PORT`, and the pinned `STAGING_SSH_HOST_KEY`. The short-lived GitHub token is used to pull private GHCR images and is removed from the host after deployment.

For the current AWS EC2 host, set `STAGING_HOST=15.232.26.46`, `STAGING_USER=ubuntu`, and `STAGING_SSH_PORT=22`. The minimal replacement for the previous nip.io staging origin is `https://flowdesk.15.232.26.46.nip.io`; set both `PUBLIC_BASE_URL` and `SITE_ADDRESS` accordingly (without the scheme for `SITE_ADDRESS`). Replace `STAGING_SSH_HOST_KEY` with the pinned key obtained over a trusted channel and replace `STAGING_SSH_PRIVATE_KEY` with the matching dedicated private key. The EC2 security group should allow inbound TCP 22 only from trusted administration/GitHub Actions egress as practical, TCP 80 and 443 publicly, and UDP 443 only if HTTP/3 is wanted. Do not expose application ports 3000 or 4000-4003, PostgreSQL 5432, Redis 6379, MinIO 9000, or ClamAV 3310.

## Stateful migration and cutover

Moving the Compose manifest does not move Docker named volumes between hosts. Preserve these separately before changing the GitHub Environment target:

- `/opt/flowdesk/shared/staging.env`, because it holds encryption, provider, database, and webhook secrets;
- PostgreSQL, using a logical dump and restore while writes are quiesced;
- MinIO objects, using an object-aware mirror or backup and restore.

Redis contains replaceable runtime coordination/rate-limit state, ClamAV signatures are downloaded again, Caddy certificates can be reissued, and application images are pulled again from GHCR. Do not copy a live PostgreSQL volume directory between hosts. During the final cutover, stop public/application writes on the old host, take the final database and object backup, restore them on EC2, start the release, validate the exact build SHA, and only then change the GitHub Environment target. Retain the old host and its volumes until the EC2 restore and functional smoke tests pass.

## Verification

From outside the host:

```bash
public_base_url=$(sed -n 's/^PUBLIC_BASE_URL=//p' /opt/flowdesk/shared/staging.env | head -n 1)
curl --fail "${public_base_url%/}/livez"
curl --fail "${public_base_url%/}/api/v1/system/build"
```

On the host:

```bash
ssh -p 22 ubuntu@15.232.26.46
cd /opt/flowdesk/releases/$(cat /opt/flowdesk/shared/current-image)
docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml ps
docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml logs --since 15m api worker ingress
```

For a faster incident snapshot, run the helper from the active release as the configured deployment
user. It prints container state plus timestamped, bounded logs; arguments limit the output to
specific services:

```bash
cd "/opt/flowdesk/releases/$(cat /opt/flowdesk/shared/current-image)"
chmod 0750 diagnose.sh
./diagnose.sh api web caddy
SINCE=1h TAIL_LINES=500 ./diagnose.sh api
```

Copy the `x-request-id` value from a failed browser response and search the API output for it.
Unexpected API failures are emitted as `http.request.failed` with the request/correlation ID,
route, error class, and PostgreSQL error code/constraint when available. Response bodies remain
generic so database details are not exposed to the browser. A duplicate organization slug is an
expected conflict and returns `409 ORGANIZATION_SLUG_CONFLICT` instead of an opaque `500`.

Every successful staging deployment verifies the canonical public liveness endpoint and matching
API build SHA. Authentication flows are validated by their API coverage and should be exercised
separately with the configured staging identity provider. On a failed health gate, the deploy job
prints the most recent application logs to the protected GitHub Actions run before rolling
application containers back.

## Rollback and recovery

If the release health gate fails, `deploy.sh` restores the previous SHA for application containers. Database migrations are not rolled back automatically: migrations are expand-compatible and recovery uses a compensating roll-forward migration. The operator can manually redeploy the recorded previous SHA:

```bash
previous=$(cat /opt/flowdesk/shared/previous-image)
cd "/opt/flowdesk/releases/${previous}"
./deploy.sh "${previous}"
```

Named volumes are deliberately retained across application rollback and `docker compose down`. Never use `down --volumes` in this environment. Before real staging data is accepted, enable EC2/EBS snapshots and add independently tested PostgreSQL and MinIO backup/restore jobs. A snapshot is not a substitute for an application-consistent, separately stored restore test.
