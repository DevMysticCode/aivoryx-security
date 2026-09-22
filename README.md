# Aivoryx Tester

Application security assessment platform — monorepo scaffold (Phase 1, Step 1).

## Structure

```
/apps
  web             React + Vite + TypeScript frontend
  api             Backend API (Node + TypeScript) — placeholder, no routes yet
  worker          Scanner worker process — placeholder, no queue consumer yet
  report-worker   Report generation worker — placeholder
/packages
  shared-types    Types shared across apps
  config          Env-var schema/config loader
  logger          Structured logging
  db              Database schema/migrations/query layer
  queue           Job queue definitions
  scanner-core    ScannerPlugin interface, SafeHttpClient, orchestration primitives
  scanners        Individual scanner plugin packages (none yet)
  ai-core         AIProvider interface + providers (optional, not wired in yet)
  report-core     HTML/PDF report templating
/infrastructure
  docker          Dockerfiles + docker-compose (added in a later step)
```

This is a scaffold only: no database, queue, auth, scanner logic, or frontend features
are implemented yet. Each package/app currently exports or logs a placeholder so the
workspace builds, type-checks, and lints end to end.

## Requirements

- Node.js 20+ (see `.nvmrc`)
- pnpm 11+ (`corepack enable` recommended)

## Getting started

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm format:check
```

## Development commands

| Command                        | Description                                |
| ------------------------------ | ------------------------------------------ |
| `pnpm build`                   | Build all apps/packages via Turborepo      |
| `pnpm dev`                     | Run all apps in dev/watch mode             |
| `pnpm lint`                    | Lint all apps/packages via ESLint          |
| `pnpm typecheck`               | Type-check all apps/packages               |
| `pnpm format` / `format:check` | Format (or check formatting) with Prettier |

## Status

Phase 1, Step 1 — monorepo scaffold only. See project architecture notes for the full
phased roadmap (database, queue/workers, auth, scanners, frontend features, etc.).
