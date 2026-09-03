# Instance deployment configs

Copy the matching hostname directory's `deploy.env.example` to the deployment
root as `deploy.env`, replace the placeholders, and create the seven mode-600
runtime files from `deploy/env-examples/`. These files contain public identity
and path examples only; never add credentials here.

- `chrapp.rzprime.com/deploy.env.example` selects ChainReporter.
- `rzwire.rzprime.com/deploy.env.example` selects RZWire.

Each instance owns its Compose project, app root, image prefix, template key,
loopback ports, TLS paths, environment directory, volumes, backups, and release
pointer. The two known instances are on separate VPS hosts, so their loopback
ports may be the same.
