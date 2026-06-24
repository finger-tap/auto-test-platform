// 2026-06-15: pc-agent report packaging — re-export agent-web's tar/gz
// helpers. Same format (ustar tarball → gzip → Buffer), consumed by
// GET /sessions/:id/report on the agent side.
export { tarGzDir, tarGzDirStream } from '../agent-web/report.js';
