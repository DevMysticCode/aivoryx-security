# Scanner Plugins

Each scanner plugin lives as its own package under this directory, implementing the
`ScannerPlugin` interface from `@aivoryx/scanner-core`.

- `http-reachability` (Batch 4) — the only scanner that exists today. Determines
  whether an authorized WEB asset is reachable and records a single non-invasive
  `INFO` finding. See `../../docs/security-model.md`.

Future scanners (headers, TLS, CORS, cookie security, technology detection, ...)
will each land as a new package here without requiring the worker or scanner-core
architecture to change.
