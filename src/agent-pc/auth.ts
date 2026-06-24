// 2026-06-15: pc-agent bearer auth — same shared-secret model as agent-web.
// AGENT_TOKEN is set by the systemd unit / launchd plist at deploy time,
// injected from devices.agent_token. Mutual: server → agent and
// agent → server both carry `Bearer <AGENT_TOKEN>`.
export { verifyServerRequest } from '../agent-web/auth.js';
