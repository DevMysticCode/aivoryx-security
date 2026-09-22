# Infrastructure

Local development infrastructure (`docker-compose.yml`): PostgreSQL and Redis. The API,
workers, and frontend are not containerized yet — they run directly with Node during
development. Dockerfiles for those are added when the platform is ready to be deployed.

## Usage

From the repository root (these scripts wrap the commands below):

```bash
pnpm infra:up      # start Postgres + Redis in the background
pnpm infra:down    # stop and remove the containers (volumes persist)
pnpm infra:logs    # tail logs from both services
```

Equivalent raw commands:

```bash
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env up -d
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env down
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env logs -f
```

Run from the repository root, with `.env` present there (copy `.env.example` to `.env` first
if you haven't already) — `--env-file .env` is required because `-f` points at a compose file
outside the root, which stops Compose from picking up the root `.env` automatically.

## What's provisioned

| Service  | Image              | Default port | Credentials (from `.env`)                             |
| -------- | ------------------ | ------------ | ----------------------------------------------------- |
| postgres | postgres:16-alpine | 5432         | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` |
| redis    | redis:7-alpine     | 6379         | none (local dev only)                                 |

Both are bound to `127.0.0.1` only — not reachable from outside the host — and use named,
persistent volumes so data survives `pnpm infra:down` (removed only with `docker compose down -v`).
Each has a health check; `docker compose ps` shows `healthy` once ready.

These defaults match `DATABASE_URL`/`REDIS_URL` in `.env.example`. If you change
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`/`POSTGRES_PORT`/`REDIS_PORT`, update
`DATABASE_URL`/`REDIS_URL` in your `.env` to match.
