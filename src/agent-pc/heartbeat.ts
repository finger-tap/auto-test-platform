// 2026-06-15: pc-agent heartbeat — re-export agent-web's implementation.
// The heartbeat loop (register / heartbeat / shutdown) is identical across
// all agent kinds; only the `kind` field passed at register time differs.
export { startHeartbeatLoop, stopHeartbeatLoop, sendShutdown } from '../agent-web/heartbeat.js';
