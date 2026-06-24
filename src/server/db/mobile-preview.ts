// 2026-06-08: mobile_case_execution_preview 表的 CRUD
// 用途:为每个移动端 case execution 留一条 preview 审计记录(开始/结束时间、帧数),
// 主要给事后排错用(看"当时有没有起过预览、收到多少帧、什么时候断的")。
// 活跃的 session 状态以 in-memory Map 为准(见 preview/proxy.ts),
// DB 这边只持久化"开始时写一行,结束时 UPDATE 关闭时间 + 帧数"。

import db from './index.js';

export type PreviewKind = 'screenshot' | 'scrcpy' | 'mjpeg';

export interface MobileExecutionPreviewRow {
  case_execution_id: number;
  preview_kind: PreviewKind;
  session_id: string | null;
  started_at: string;
  stopped_at: string | null;
  total_frames: number;
  last_frame_at: string | null;
}

export function startPreview(opts: {
  caseExecutionId: number;
  kind: PreviewKind;
  sessionId: string;
}): void {
  db.prepare(
    `INSERT INTO mobile_case_execution_preview
       (case_execution_id, preview_kind, session_id, started_at, total_frames)
     VALUES (?, ?, ?, datetime('now', '+8 hours'), 0)
     ON CONFLICT(case_execution_id) DO UPDATE SET
       preview_kind = excluded.preview_kind,
       session_id   = excluded.session_id,
       started_at   = excluded.started_at,
       stopped_at   = NULL,
       total_frames = 0,
       last_frame_at = NULL`
  ).run(opts.caseExecutionId, opts.kind, opts.sessionId);
}

export function recordFrame(caseExecutionId: number): void {
  // total_frames +1,last_frame_at = now. 写入频率 ≈ 1-2 FPS,SQLite 完全 hold 住
  db.prepare(
    `UPDATE mobile_case_execution_preview
        SET total_frames = total_frames + 1,
            last_frame_at = datetime('now', '+8 hours')
      WHERE case_execution_id = ?`
  ).run(caseExecutionId);
}

export function stopPreview(caseExecutionId: number): void {
  db.prepare(
    `UPDATE mobile_case_execution_preview
        SET stopped_at = datetime('now', '+8 hours')
      WHERE case_execution_id = ?`
  ).run(caseExecutionId);
}

export function getPreview(caseExecutionId: number): MobileExecutionPreviewRow | null {
  const row = db.prepare(
    `SELECT * FROM mobile_case_execution_preview WHERE case_execution_id = ?`
  ).get(caseExecutionId) as MobileExecutionPreviewRow | undefined;
  return row ?? null;
}
