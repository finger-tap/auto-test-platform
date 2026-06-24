# Agent Service

A small Node service that runs on a remote machine, holds a pool of Playwright
browsers, and serves them to the central server over HTTP + WebSocket. The
central server connects to the agent's browser over WebSocket (via
`pw.chromium.connect(wsEndpoint)`) and the agent ships the resulting Midscene
report back as a gzipped tarball.

This is the remote counterpart to the in-process `launcher.launchServer()` the
executor uses for local mode. Both code paths share the same downstream
Playwright APIs.

> **Operator note**: in normal operation, you don't need to read this file or
> install the agent by hand. The central server can SSH-push the agent bundle
> onto a Linux host from the UI (DeviceList → "重连/升级" button). See
> `README.md` → "Web 远程 Agent 部署" for the operator-facing guide. This
> file is the protocol / lifecycle reference for anyone hacking on the agent
> itself or running it manually (CI runners, dev machines, non-Linux hosts).

## When to use an agent

- Cross-OS testing (Mac / Windows / Linux browsers)
- CI runners with isolated Playwright caches
- A long-lived browser pool so per-case cold-start is amortized

For everything else, leave `deviceId` empty in the execute request and the
executor runs the browser in-process on the central server (the default).

## Configuration (env)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `AGENT_TOKEN` | yes | — | The per-device bearer token from the central server's DeviceList → "查看令牌". The server uses the same value to authenticate its own calls back to this agent. |
| `AGENT_SERVER_URL` | yes | — | Central server base URL, e.g. `http://localhost:3000`. Used for heartbeat + shutdown. |
| `AGENT_PORT` | no | `4001` | Port this agent listens on. |
| `AGENT_NAME` | no | `agent` | Log prefix — useful if you run multiple agents on the same host. |
| `AGENT_CORS_ORIGIN` | no | `AGENT_SERVER_URL` | CORS allow-origin. Set to `*` for ad-hoc curl inspection. |
| `PLAYWRIGHT_BROWSERS_PATH` | no | `~/Library/Caches/ms-playwright` etc. | Where Playwright finds the browser binaries. Run `npx playwright install chromium` once on the agent host. |
| `AGENT_REPORT_TEMP_ROOT` | no | `/tmp/agent-reports` | Where Midscene writes per-session report dirs. Make sure this disk has enough space for concurrent cases. |

## Running

```sh
# 1. install playwright browsers once
npx playwright install chromium

# 2. set env
export AGENT_TOKEN=<paste from central server DeviceList → 查看令牌>
export AGENT_SERVER_URL=http://central-server:3000
export AGENT_PORT=4001

# 3. run
npm run agent                # dev (tsx)
npm run dev:agent            # watch mode
npm run build:agent && npm run start:agent  # production
```

## Lifecycle

1. Process starts, reads env
2. `POST /api/agents/register` to central server with token + endpoint URL
3. Heartbeat loop starts: `POST /api/agents/heartbeat` every 30s
4. Express listens on `AGENT_PORT`
5. On `SIGTERM` / `SIGINT`: send `POST /api/agents/shutdown`, close all browser
   servers, exit

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | open | Liveness, returns version + active session count |
| POST | `/launch` | bearer | Launch browser, return `{wsEndpoint, sessionId, reportTempDir}` |
| POST | `/sessions/:id/heartbeat` | bearer | Touch session `lastUsedAt` |
| GET | `/sessions/:id/report` | bearer | Stream the gzipped tarball of the session's Midscene report |
| POST | `/sessions/:id/shutdown` | bearer | Close the session's browser server (idempotent) |

All non-`/healthz` endpoints require `Authorization: Bearer <AGENT_TOKEN>`.

## Browser pool

The agent reuses `BrowserServer` instances across requests with the same
launch params (`chromium|headless|executablePath`). This avoids paying the
~2-3s Chromium cold-start per case. Sessions share the underlying browser
process but each gets its own `sessionId` for report isolation (so concurrent
cases on the same agent don't trample each other's Midscene temp dir).

Idle browser servers are closed after 30 minutes of no activity (cleanup runs
every 5 minutes).

## Security notes

- `AGENT_TOKEN` is the only secret. The same value is used both directions
  (server → agent and agent → server). Treat it like a password.
- The agent is intentionally a separate process from the central server.
  Don't expose `AGENT_PORT` to the public internet — bind it to a private
  network, SSH tunnel, or a firewall rule that only allows the central
  server's IP.
- All agent ↔ server traffic is plain HTTP. For production, put both
  services behind a TLS-terminating reverse proxy.

## Troubleshooting

- `agent launch` returns 401 → token mismatch. Re-copy from DeviceList.
- `agent launch` returns 500 with "browser not found" → run `npx playwright
  install chromium` on the agent host.
- Heartbeat fails with "fetch failed" → the central server URL is
  unreachable from the agent machine. Check `AGENT_SERVER_URL` and any
  firewall rules.
- Device stays `offline` in the UI even though the agent is running → the
  scheduler's `markStaleAgentsOffline` job runs once per minute, wait up
  to 60s for the next tick after a fresh registration.
