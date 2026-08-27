.PHONY: bootstrap dev test lint typecheck build verify compose-up compose-down db-migrate db-reset clean

bootstrap:
	corepack enable
	pnpm install --frozen-lockfile
	cp -n .env.example .env 2>/dev/null || true

dev: compose-up
	pnpm dev

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

verify:
	pnpm verify

compose-up:
	docker compose -f infra/compose/compose.yaml up -d

compose-down:
	docker compose -f infra/compose/compose.yaml down

db-migrate:
	pnpm db:migrate

db-reset:
	./scripts/db-reset-local.sh

clean:
	pnpm clean
