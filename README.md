# Grok UI

An unofficial, local-first command center for [Grok Build](https://github.com/xai-org/grok-build). Grok UI combines a live runtime feed, native Agent Client Protocol controls, Git change inspection, and historical telemetry in one responsive web interface.

Inspired by [Hermes HUD Web UI](https://github.com/joeynyc/hermes-hudui), but built around Grok Build’s native session format and ACP implementation.

> Grok UI is an independent community project. It is not affiliated with or endorsed by xAI.

## Highlights

- Live active-agent roster from Grok’s process registry
- Real-time reasoning, response, plan, tool, phase, and usage events
- Native ACP command deck for new and existing sessions
- Full Session Workbench with live conversation, reasoning, tools, permissions, and follow-ups
- Concurrent, independently cancellable Grok sessions
- Real permission queue with Grok-provided approval options
- Git branch, dirty-state, file-change, and bounded diff inspection
- Context, token, and cost telemetry when Grok reports it
- Desktop notifications when a session needs input
- Durable managed sessions plus rename, archive, restore, and per-session change inspection
- Activity history, models, tools, skills, and memory inventory
- Persistent Operator and Event Horizon themes with live switching
- Loopback-only default with mandatory token authentication for remote binding
- Responsive desktop and mobile interface with keyboard navigation

## Requirements

- Node.js 22 or newer
- A working `grok` installation
- Grok Build already authenticated (`grok login`)

Verify the CLI first:

```bash
grok version
grok models
```

## Quick start

```bash
git clone git@github.com:joeynyc/Grok-UI.git
cd Grok-UI
npm install
npm run dev
```

Development mode runs the API on `127.0.0.1:4310` and Vite on `127.0.0.1:5173`.

For the production server:

```bash
npm run verify
npm run build
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310).

## Remote access

Grok UI refuses to bind beyond loopback unless `GROK_UI_TOKEN` is configured:

```bash
HOST=0.0.0.0 \
GROK_UI_TOKEN='replace-with-a-long-random-token' \
npm start
```

The browser exchanges the token for a short-lived, `HttpOnly`, `SameSite=Strict` session cookie. State-changing cookie requests are same-origin checked. Bearer authentication is also accepted for API clients:

```bash
curl -H "Authorization: Bearer $GROK_UI_TOKEN" http://server:4310/api/control
```

Put TLS in front of Grok UI before using it across an untrusted network. A private VPN or SSH tunnel is strongly recommended:

```bash
ssh -L 4310:127.0.0.1:4310 your-machine
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | API bind address |
| `PORT` | `4310` | API port |
| `GROK_HOME` | `~/.grok` | Grok state directory |
| `GROK_BIN` | `grok` | Grok executable used by the ACP controller |
| `GROK_UI_TOKEN` | empty | Required when `HOST` is not loopback |
| `GROK_UI_STATE_DIR` | `~/.grok-ui` | Private Grok UI annotations and durable managed-session state |

## How control works

Grok UI supervises one `grok agent --no-leader stdio` process and communicates through the official [Agent Client Protocol](https://agentclientprotocol.com/).

```text
Browser
  ├── SSE runtime + control updates
  └── authenticated control requests
          │
          ▼
Express supervisor
  ├── filesystem watcher ── ~/.grok session state
  ├── Git inspector ─────── selected workspaces
  └── ACP client ────────── grok agent stdio
                              ├── session/new + session/load
                              ├── session/prompt
                              ├── session/request_permission
                              └── session/cancel
```

Permission decisions are never guessed or auto-approved. Grok’s own permission options are rendered in the approval queue and the user’s selected option is returned over the same ACP request.

## Session Workbench

Open any recorded session, active Grok CLI process, or Grok UI-managed lane to enter the workbench. It combines the bounded on-disk session transcript with live filesystem and ACP updates, so messages, reasoning, tool calls, status, and permission decisions remain current without polling the full archive.

Sending a follow-up attaches a recorded CLI session to Grok UI’s ACP supervisor with `session/load`. Rename and archive actions are Grok UI overlays stored under `~/.grok-ui`; they never rewrite Grok’s own session files. Managed lanes, bounded event history, token totals, and costs are persisted locally and restored as idle after a Grok UI server restart.

## Privacy and security

- The server binds to loopback unless deliberately configured otherwise.
- Remote binding without `GROK_UI_TOKEN` fails at startup.
- Grok credentials never pass through the browser.
- Authentication cookies are `HttpOnly` and `SameSite=Strict`.
- API responses are non-cacheable and include restrictive browser security headers.
- Raw system prompts and durable-memory bodies are not indexed.
- Live conversation, thought, tool, and diff content is visible to authenticated dashboard users.
- Diff paths are restricted to repositories associated with known Grok sessions.
- File and event reads are bounded to avoid loading unbounded session logs.
- Grok UI contains no analytics or product telemetry.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Commands

```bash
npm run dev       # Run API and Vite with file watching
npm run check     # Type-check client and server
npm test          # Run unit and integration tests
npm run build     # Produce client and server builds
npm run verify    # Check, test, and build
npm start         # Serve the production build
```

## Repository layout

```text
server/
  grok-controller.ts      ACP lifecycle, prompts, approvals, cancellation
  live-monitor.ts         event-driven Grok runtime projection
  grok-store.ts           historical metadata aggregation
  session-reader.ts       bounded conversation and tool timeline projection
  session-state.ts        durable managed lanes and local annotations
  workspace-inspector.ts  bounded Git status and diff inspection
  security.ts             local/remote access gate
src/
  views/ControlView.tsx   command deck and approval queue
  views/ChangesView.tsx   repository change workbench
  views/SessionWorkbench.tsx  live session operations
  App.tsx                 live and historical dashboard shell
```

The longer architecture and trust-boundary notes live in [docs/architecture.md](docs/architecture.md).

## Status

Grok UI is a release-candidate community project. The core monitor and control paths are functional and verified against Grok Build `0.2.111`. Grok Build and ACP evolve quickly; compatibility fixes may be needed for future releases.

## License

[MIT](LICENSE)
