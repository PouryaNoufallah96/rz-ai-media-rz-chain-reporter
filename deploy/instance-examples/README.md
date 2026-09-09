# Instance deployment configs

Copy the matching hostname or IP directory's `deploy.env.example` to the deployment
root as `deploy.env`, replace the placeholders, and create the seven mode-600
runtime files from `deploy/env-examples/`. These files contain public identity
and path examples only; never add credentials here.

- `chrapp.rzprime.com/deploy.env.example` selects ChainReporter.
- `rzwire.rzprime.com/deploy.env.example` selects RZWire.
- `51.255.163.171/deploy.env.example` selects SLT CargoPay with IP-only HTTPS.

Each instance owns its Compose project, app root, image prefix, template key,
loopback ports, TLS paths, environment directory, volumes, backups, and release
pointer. Separate VPS hosts may use the same loopback ports; verify availability
on the target before deploying.

Real secrets and operator runbooks live under gitignored
`deploy/instances/<hostname-or-ip>/`. An update always rsyncs `src/`, `env/`,
and `deploy.env` — see `deploy/SHIP-UPDATE.md`.
