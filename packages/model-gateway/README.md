# `@rz-chain-reporter/model-gateway`

The application-owned gateway every model call goes through. Feature code names a
**task**; it never names a provider or a model.

Framework-free, so both the web application and the worker import it.

## Exports

| Subpath | Contains |
|---|---|
| `./gateway` | `createModelGateway` |
| `./task` | The task taxonomy and route resolution |
| `./types` | Invocation and adapter types |
| `./errors` | The error taxonomy |
| `./usage` | Usage normalisation and provider diagnosis |
| `./openrouter` | The remote adapter |
| `./ollama` | The on-host adapter |
| `./prestart` | The startup capability gate |

## Routing

The customer template maps each task key to a backend, a model and an optional
fallback. An unrecognised or unconfigured key is a configuration error, not a
runtime fallback — silently falling back would hide a misconfiguration until
someone noticed the wrong model's voice in production.

Three invocation keys are available: **primary**, **retry-1**, **fallback**. The
first two resolve to the *same* route; only the third switches. Durable workflows
walk them explicitly. A bounded synthesis stream keeps its selected invocation
key for every provider call and records a separate zero-based call index while
the gateway owns the typed tool loop and UI stream.

**The gateway never retries.** Every underlying call is made with retries
disabled. Retry is a durable-execution decision, made by the caller that knows
whether retrying is safe.

## Two backends, deliberately asymmetric interfaces

**Remote** supports structured output, embeddings, image generation and streaming.

**On-host** supports structured output, embeddings, and streaming synthesis. A
template routing image generation locally fails at startup rather than at first
use. Local routing is allowlisted: `assistant-synthesis`,
`image-template-selection`, `keyword-embedding`, and `text-translation` may
select local; every other task stays remote-only.

Shipped templates route **four tasks local** on host `127.0.0.1:11434`:

- `assistant-synthesis` → `qwen3:0.6b` (local, web + worker) → `openai/gpt-4o-mini`
- `text-translation` → `qwen3:0.6b` (local, worker) → `openai/gpt-4o-mini`
- `image-template-selection` → `qwen3:0.6b` (local, worker) → `openai/gpt-4o-mini`
- `keyword-embedding` → `embeddinggemma:300m` (local, worker) → `openai/text-embedding-3-small`

Other tasks remain remote.

### Local setup (host Ollama `127.0.0.1:11434`, shipped 4-task)

```sh
free -h  # need ~2 GiB free after the app is running, or stop and don't go local

curl -fsSL https://ollama.com/install.sh | sh
systemctl enable --now ollama

ollama pull qwen3:0.6b
ollama pull embeddinggemma:300m
curl -fsS http://127.0.0.1:11434/api/tags
```

Bind **worker + web** (web needs it because `assistant-synthesis` is local):

```bash
# deploy/instances/<host>/env/worker.env and deploy/instances/<host>/env/web.env
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

If only worker tasks were local, `web.env` would not need it. To revert any
local task to remote, change its route back to `"backend": "remote"` and drop
`OLLAMA_BASE_URL` only if no task remains local — prestart fails if a local
route is unbound.

## Every call, same usage lifecycle

1. Assert invocation bounds.
2. Resolve the route from the template.
3. **Assert the loaded template still matches the applied one.** A model call must
   not run against a configuration the process no longer matches.
4. Resolve the adapter.
5. **Write a pending usage row — before the provider call.**
6. Invoke.
7. Finalise the usage row.

Steps 5 and 7 are the important ones. Writing the row first makes a crash mid-call
visible. Effectful structured and image calls commit the ledger with their domain
write, so content and cost cannot diverge.

A synthesis stream opens one Usage row per model step. Completed steps settle
from their observed result; an unsettled row becomes unknown when the stream ends,
or cancelled on explicit cancellation. Its typed UI stream carries text, tool,
approval and data parts. A later approved domain command is separate from this
model settlement.

## Failed and unknown are different

- **`failed`** — the effect definitely did not happen.
- **`unknown`** — it may or may not have happened.

A timeout is *unknown*, not failure. An unclassifiable error is unknown. Only a
diagnosed provider rejection is definitely a failure.

Structured-output invalidity is the one clean definite failure: the model
responded and its response did not match the schema.

## Cost has provenance

The remote adapter recovers the provider's generation identifier and returned cost
— including for image calls, where it reads the response headers directly because
the SDK does not surface them.

Cost authority is recorded: billed, local, or unknown. **The gateway never
estimates.** Cost is stored as a decimal string, never a float.

Provider metadata is parsed against schemas rather than trusted.

## Image generation is ambiguity-hardened

It carries four compensation callbacks — prepare, resolve, compensate, reject.

- A definite failure whose "nothing was staged" confirmation does not come back
  clean is **downgraded to unknown**.
- A failed finalising transaction **interrogates ownership**: if the work landed,
  the call succeeds; if nothing is there and compensation worked, it is a clean
  failure; anything else is unknown.

Most systems would call a failed transaction a failure. Here it asks first,
because a stored-but-unrecorded image is an orphan nobody will find.

## Privacy

Input and output recording is disabled on every call. Trace attributes are limited
to the operation, attempt and usage identifiers. **Prompts and generated content
never enter telemetry.**

## The startup gate

`assertModelCapabilities` checks every configured task's primary *and* fallback
routes: a remote route needs the remote key, a local route needs the local URL,
image-generation tasks must be remote, and only allowlisted tasks may select
local. Web prestart uses `assertAssistantBindings` for the same binding and
capability rules on `assistant-synthesis` alone.

A template routing to an unbound backend fails at startup, not mid-run.

## Related

[`../../documentation/domain/content-generation.md`](../../documentation/domain/content-generation.md)
