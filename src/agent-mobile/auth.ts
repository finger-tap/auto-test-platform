// 2026-06-08: mobile-agent bearer auth — 跟 web-agent 共享同一份 env var
// (AGENT_TOKEN, mutual auth)。这里 re-export,避免代码漂移。
export { verifyServerRequest } from '../agent/auth.js';
