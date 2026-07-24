# Architecture

Grok UI is a single-user local developer tool with three data planes.

## Runtime plane

`LiveMonitor` watches `active_sessions.json` plus bounded tails of active `events.jsonl` and `updates.jsonl` files. Filesystem events are debounced and projected into a small `LiveSnapshot`, then delivered through server-sent events.

Historical views use `summary.json` and `signals.json`. Memory bodies, system prompts, raw terminal history, and authentication files are not read.

## Control plane

`GrokController` supervises one `grok agent --no-leader stdio` child process and uses the official TypeScript ACP SDK.

The connection supports:

- ACP initialization and cached Grok authentication
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`
- `session/update`
- `session/request_permission`

Each permission request stays pending as a server-side promise until an authenticated user selects one of Grok’s options or cancels the turn. The browser cannot manufacture an option that Grok did not advertise.

## Workspace plane

`WorkspaceInspector` runs argument-separated Git commands against workspaces associated with recorded or controlled Grok sessions. It never invokes a shell.

Diff paths are resolved beneath the repository root. Reads are bounded, binary content is not rendered, and untracked files are represented without leaving the repository.

## Network boundary

The production server binds to `127.0.0.1` by default. A non-loopback host requires `GROK_UI_TOKEN`.

Authenticated browsers receive an in-memory session ID through an `HttpOnly`, `SameSite=Strict` cookie. Mutations using that cookie are same-origin checked. API clients may use the configured token as a bearer credential.

No browser request contains Grok credentials. No product analytics are emitted.
