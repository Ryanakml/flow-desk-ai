# DigitalOcean single-host staging

## Purpose and boundary

This environment makes the current FlowDesk build continuously inspectable. It is staging, not the AWS production reference in ADR-003. The single Droplet is a failure domain for the application and its stateful dependencies; DigitalOcean backups, an external database, object-storage lifecycle policy, multi-host failover, and production provider credentials remain separate work.

The public surface is Caddy on ports 80 and 443. PostgreSQL, Redis, MinIO, ClamAV, and the five application roles are reachable only on an internal Docker network. Routes are:

- `/` and `/livez` to `web`;
- `/api/*`, `/metrics`, and `/realtime*` to `api`;
- `/webhooks/*` to `ingress`.

Until a domain is supplied, staging uses `http://206.189.89.33`, mock authentication, and an insecure development-compatible cookie. Do not enter real customer data or provider credentials. A domain cutover must set `SITE_ADDRESS`, `PUBLIC_BASE_URL`, the Auth0 callback, `AUTH_MOCK_ENABLED=false`, and `AUTH_COOKIE_SECURE=true` together.

## Host bootstrap

Run `bootstrap-host.sh` once as root with a dedicated Ed25519 public key. The script installs Docker Engine and Compose, creates the unprivileged `flowdesk` deployment user, configures bounded Docker logs, enables Fail2ban, and enables UFW with only 22/tcp, 80/tcp, 443/tcp, and 443/udp inbound.

`configure-staging-env.sh` creates `/opt/flowdesk/shared/staging.env` once with mode `0600`. It refuses to overwrite existing secrets. The tracked `environment.example` documents its contract without containing usable credentials.

## Automated release

Pull requests execute all quality/database/Terraform gates and cached image builds but never contact staging. A push to `main` after every required job succeeds performs the release:

1. BuildKit restores and updates one GitHub Actions cache scope per image.
2. Six SHA-tagged images (`web`, `api`, `ingress`, `worker`, `scheduler`, and `migrator`) are published to GHCR.
3. The exact Compose manifest and release scripts are copied to `/opt/flowdesk/releases/<git-sha>`.
4. Stateful dependencies become healthy.
5. The checksum-locked migration runner executes once under its PostgreSQL advisory lock.
6. The restricted `flowdesk_app` login is provisioned as a member of the `NOBYPASSRLS` runtime group; applications never receive the bootstrap credential.
7. Application containers start, then both the web liveness endpoint and API build identity must match the release SHA.
8. GitHub stores the public build response as 30-day deployment evidence.

The `staging` GitHub Environment holds `STAGING_SSH_PRIVATE_KEY`; its non-secret variables are `STAGING_HOST`, `STAGING_USER`, and the pinned `STAGING_SSH_HOST_KEY`. The short-lived GitHub token is used to pull private GHCR images and is removed from the host after deployment.

## Verification

From outside the Droplet:

```bash
curl --fail http://206.189.89.33/livez
curl --fail http://206.189.89.33/api/v1/system/build
```

On the Droplet:

```bash
ssh flowdesk@206.189.89.33
cd /opt/flowdesk/releases/$(cat /opt/flowdesk/shared/current-image)
docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml ps
docker compose --env-file /opt/flowdesk/shared/staging.env -f compose.yaml logs --since 15m api worker ingress
```

For a faster incident snapshot, run the helper from the active release as the `flowdesk`
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

Every successful staging deployment now performs a mock login, callback, authenticated session
read, and logout. On a failed health gate, the deploy job prints the most recent application logs
to the protected GitHub Actions run before rolling application containers back.

## Rollback and recovery

If the release health gate fails, `deploy.sh` restores the previous SHA for application containers. Database migrations are not rolled back automatically: migrations are expand-compatible and recovery uses a compensating roll-forward migration. The operator can manually redeploy the recorded previous SHA:

```bash
previous=$(cat /opt/flowdesk/shared/previous-image)
cd "/opt/flowdesk/releases/${previous}"
./deploy.sh "${previous}"
```

Named volumes are deliberately retained across application rollback and `docker compose down`. Never use `down --volumes` in this environment. Before real staging data is accepted, enable Droplet backups and add independently tested PostgreSQL and MinIO backup/restore jobs.
