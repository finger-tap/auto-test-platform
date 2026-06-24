// 2026-06-08: mobile-agent heartbeat — 跟 web-agent 完全一样
// (serverUrl / agentToken / agentPort + 注册周期)。直接 re-export 同一份实现。
export { startHeartbeatLoop, stopHeartbeatLoop, sendShutdown } from '../agent/heartbeat.js';
