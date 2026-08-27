# FlowDesk

FlowDesk is an enterprise-ready WhatsApp automation SaaS under active implementation. The repository is currently at milestone M0: execution foundation. Customer features, authentication, tenant data, WhatsApp traffic, and AI behavior are intentionally not implemented yet.

## Prerequisites

- Node.js 22 (see `.node-version`)
- pnpm 10 through Corepack
- Docker Desktop or Docker Engine with Compose v2
- GNU Make

## Local start

```bash
nvm use
make bootstrap
make dev
```

The web shell runs at `http://localhost:3000`, API at `http://localhost:4000`, ingress at `http://localhost:4001`, worker health at `http://localhost:4002`, and scheduler health at `http://localhost:4003`. Grafana is at `http://localhost:3001`, Prometheus at `http://localhost:9090`, Mailpit at `http://localhost:8025`, and MinIO Console at `http://localhost:9001`.

Local credentials in `.env.example` are synthetic and must never be reused outside local development. `make db-reset` refuses to run unless `APP_ENV=local` and destroys only the named local PostgreSQL Compose volume.

## Verification

```bash
make verify
docker compose -f infra/compose/compose.yaml config --quiet
```

Build a service image with:

```bash
docker build -f infra/docker/Dockerfile.node --build-arg APP=api -t flowdesk/api:local .
```

Architecture intent lives in the enterprise specification, execution order in the execution blueprint, and accepted technical decisions in `docs/adr`.
