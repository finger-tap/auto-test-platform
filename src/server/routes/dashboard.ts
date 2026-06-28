import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import db from '../db/index.js';

export const dashboardRoutes = Router();
dashboardRoutes.use(authMiddleware);

interface RecentExecutionRow {
  id: number;
  test_type: string;
  set_id: number;
  set_name: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_at: string;
}

// ── GET /api/dashboard/recent-executions ──────────────────────────────
// 跨 4 种测试类型取最近 N 条执行记录。优先取用例集/场景集级别的执行
// (有 set_name, 适合列表展示), 单用例执行单独统计。
dashboardRoutes.get('/recent-executions', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const rows = db
    .prepare(
      `SELECT * FROM (
        -- API 场景集执行
        SELECT e.id, 'api' AS test_type, e.set_id, ss.name AS set_name,
               e.passed_count AS passed, e.failed_count AS failed,
               e.total_duration_ms, e.finished_at AS executed_at
        FROM scenario_set_executions e
        JOIN scenario_sets_api ss ON ss.id = e.set_id
        WHERE ss.user_id = ? AND e.status NOT IN ('running')

        UNION ALL

        -- Web 用例集执行
        SELECT e.id, 'web' AS test_type, e.set_id, ss.name AS set_name,
               e.passed_count AS passed, e.failed_count AS failed,
               e.total_duration_ms, e.finished_at AS executed_at
        FROM case_set_executions_web e
        JOIN case_sets_web ss ON ss.id = e.set_id
        WHERE ss.user_id = ? AND e.status NOT IN ('running')

        UNION ALL

        -- Mobile 用例集执行
        SELECT e.id, 'mobile' AS test_type, e.set_id, ss.name AS set_name,
               e.passed_count AS passed, e.failed_count AS failed,
               e.total_duration_ms, e.finished_at AS executed_at
        FROM case_set_executions_mobile e
        JOIN case_sets_mobile ss ON ss.id = e.set_id
        WHERE ss.user_id = ? AND e.status NOT IN ('running')

        UNION ALL

        -- PC 用例集执行
        SELECT e.id, 'pc' AS test_type, e.set_id, ss.name AS set_name,
               e.passed_count AS passed, e.failed_count AS failed,
               e.total_duration_ms, e.finished_at AS executed_at
        FROM case_set_executions_pc e
        JOIN case_sets_pc ss ON ss.id = e.set_id
        WHERE ss.user_id = ? AND e.status NOT IN ('running')

      )
      ORDER BY executed_at DESC
      LIMIT ?`,
    )
    .all(userId, userId, userId, userId, limit) as RecentExecutionRow[];

  res.json({ code: 200, message: 'ok', data: { items: rows } });
});

// ── GET /api/dashboard/stats ──────────────────────────────────────────
// 聚合 4 种测试类型的用例数、集数、通过率
// 通过率采用 "每个用例/场景取最新一次执行结果" 的统计逻辑,
// 与列表页 (scenario-sets.ts / case-sets-*.ts) 保持一致。
dashboardRoutes.get('/stats', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const queryCount = (table: string) => {
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`)
      .get(userId) as { count: number };
    return row.count;
  };

  // 从 execution_items 取每个用例/场景的最新状态,统计 passed/failed。
  // 逻辑与 case-sets-web.ts / scenario-sets.ts 的 findSetsByUserIdPaginated 一致。
  const queryLatestPassStats = (
    itemsTable: string,
    execsTable: string,
    setsTable: string,
    itemIdCol: 'case_id' | 'scenario_id',
  ): { passed: number; failed: number } => {
    try {
      const rows = db
        .prepare(
          `SELECT s.id AS set_id, sei.${itemIdCol} AS item_id, sei.status
           FROM ${setsTable} s
           JOIN ${execsTable} sse ON sse.set_id = s.id
           JOIN ${itemsTable} sei ON sei.set_execution_id = sse.id
           WHERE s.user_id = ?
           GROUP BY s.id, sei.${itemIdCol}
           ORDER BY MAX(sse.started_at) DESC`,
        )
        .all(userId) as { set_id: number; item_id: number; status: string }[];

      let passed = 0;
      let failed = 0;
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${row.set_id}:${row.item_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (row.status === 'success') passed++;
        else failed++;
      }
      return { passed, failed };
    } catch {
      return { passed: 0, failed: 0 };
    }
  };

  // 单 API 执行: 按 api_id 取最新状态
  const querySingleApiExecStats = (): { passed: number; failed: number } => {
    try {
      const rows = db
        .prepare(
          `SELECT e.api_id, e.status
           FROM apis a
           JOIN api_executions e ON e.api_id = a.id
           WHERE a.user_id = ?
           ORDER BY e.started_at DESC`,
        )
        .all(userId) as { api_id: number; status: string }[];

      let passed = 0;
      let failed = 0;
      const seen = new Set<number>();
      for (const row of rows) {
        if (seen.has(row.api_id)) continue;
        seen.add(row.api_id);
        if (row.status === 'success') passed++;
        else failed++;
      }
      return { passed, failed };
    } catch {
      return { passed: 0, failed: 0 };
    }
  };

  // 单用例执行 (web/mobile/pc): 按 case_id 取最新状态
  const querySingleCaseExecStats = (execTable: string): { passed: number; failed: number } => {
    try {
      const rows = db
        .prepare(
          `SELECT case_id, status FROM ${execTable}
           WHERE user_id = ? AND status NOT IN ('running')
           ORDER BY created_at DESC`,
        )
        .all(userId) as { case_id: number; status: string }[];

      let passed = 0;
      let failed = 0;
      const seen = new Set<number>();
      for (const row of rows) {
        if (seen.has(row.case_id)) continue;
        seen.add(row.case_id);
        if (row.status === 'success') passed++;
        else failed++;
      }
      return { passed, failed };
    } catch {
      return { passed: 0, failed: 0 };
    }
  };

  const apiCases = queryCount('apis');
  const apiSets = queryCount('scenario_sets_api');
  const apiPass = queryLatestPassStats(
    'scenario_set_execution_items', 'scenario_set_executions', 'scenario_sets_api', 'scenario_id',
  );
  const apiSinglePass = querySingleApiExecStats();

  const webCases = queryCount('web_test_cases');
  const webSets = queryCount('case_sets_web');
  const webPass = queryLatestPassStats(
    'case_set_execution_items_web', 'case_set_executions_web', 'case_sets_web', 'case_id',
  );
  const webSinglePass = querySingleCaseExecStats('web_case_executions');

  const mobileCases = queryCount('mobile_test_cases');
  const mobileSets = queryCount('case_sets_mobile');
  const mobilePass = queryLatestPassStats(
    'case_set_execution_items_mobile', 'case_set_executions_mobile', 'case_sets_mobile', 'case_id',
  );
  const mobileSinglePass = querySingleCaseExecStats('mobile_case_executions');

  const pcCases = queryCount('pc_test_cases');
  const pcSets = queryCount('case_sets_pc');
  const pcPass = queryLatestPassStats(
    'case_set_execution_items_pc', 'case_set_executions_pc', 'case_sets_pc', 'case_id',
  );
  const pcSinglePass = querySingleCaseExecStats('pc_case_executions');

  const mergePass = (...args: { passed: number; failed: number }[]) => {
    let passed = 0;
    let failed = 0;
    for (const a of args) { passed += a.passed; failed += a.failed; }
    return { passed, failed };
  };

  const toStats = (cases: number, sets: number, pass: { passed: number; failed: number }) => {
    const total = pass.passed + pass.failed;
    return {
      cases,
      sets,
      passRate: total > 0 ? Math.round((pass.passed / total) * 100) : 0,
    };
  };

  res.json({
    code: 200,
    message: 'ok',
    data: {
      'api-test': toStats(apiCases, apiSets, mergePass(apiPass, apiSinglePass)),
      'web-test': toStats(webCases, webSets, mergePass(webPass, webSinglePass)),
      'mobile-test': toStats(mobileCases, mobileSets, mergePass(mobilePass, mobileSinglePass)),
      'pc-test': toStats(pcCases, pcSets, mergePass(pcPass, pcSinglePass)),
    },
  });
});

// ── GET /api/dashboard/trend ──────────────────────────────────────────
// 最近 14 天每天的执行次数和通过率。
// 2026-06-16: 修复 — 之前只统计批量报告 (batch_reports_*), 而单用例执行
// (api_executions / *_case_executions) 和案例集执行 (*_executions) 完全
// 没被纳入, 导致用户明明执行过但图表是空的。
// 现在把三类执行记录都聚合进来:
//   1. 单用例执行 (api_executions, *_case_executions)
//   2. 案例集执行 (scenario_set_executions, case_set_executions_*)
//   3. 批量报告 (batch_reports_*) — 保留兼容
//
// status 映射:
//   成功: success | (partial 且 passed_count > failed_count)
//   失败: failed | error | partial(否则)
//   排除: running (不计入)
dashboardRoutes.get('/trend', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const days = Math.min(30, Math.max(7, Number(req.query.days) || 14));

  // ── 1. 单用例执行 ──
  // api_executions 用 started_at (ISO 'T' 分隔); web/pc/mobile 用 created_at
  const singleCaseSql = [
    `SELECT CASE WHEN status='success' THEN 1 ELSE 0 END AS is_success,
            CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END AS is_failure,
            started_at AS ts
     FROM api_executions WHERE status NOT IN ('running')`,
    `SELECT CASE WHEN status='success' THEN 1 ELSE 0 END AS is_success,
            CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END AS is_failure,
            created_at AS ts
     FROM web_case_executions WHERE user_id = ? AND status NOT IN ('running')`,
    `SELECT CASE WHEN status='success' THEN 1 ELSE 0 END AS is_success,
            CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END AS is_failure,
            created_at AS ts
     FROM mobile_case_executions WHERE user_id = ? AND status NOT IN ('running')`,
    `SELECT CASE WHEN status='success' THEN 1 ELSE 0 END AS is_success,
            CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END AS is_failure,
            created_at AS ts
     FROM pc_case_executions WHERE user_id = ? AND status NOT IN ('running')`,
  ].join(' UNION ALL ');

  // ── 2. 案例集执行 ──
  // scenario_set_executions 没有 user_id, 通过 JOIN scenario_sets_api 过滤
  // case_set_executions_* 也通过 JOIN 对应 sets 表过滤
  const setExecSql = [
    // API 场景集: scenario_set_executions → scenario_sets_api (可能无数据, JOIN 安全)
    `SELECT CASE WHEN e.status='success' THEN 1
                  WHEN e.status='failed' THEN 0
                  WHEN COALESCE(e.passed_count,0) > COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_success,
            CASE WHEN e.status='failed' THEN 1
                  WHEN e.status='success' THEN 0
                  WHEN COALESCE(e.passed_count,0) <= COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_failure,
            e.started_at AS ts
     FROM scenario_set_executions e
     JOIN scenario_sets_api s ON s.id = e.set_id
     WHERE s.user_id = ? AND e.status NOT IN ('running')`,
    // Web 用例集
    `SELECT CASE WHEN e.status='success' THEN 1
                  WHEN e.status='failed' THEN 0
                  WHEN COALESCE(e.passed_count,0) > COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_success,
            CASE WHEN e.status='failed' THEN 1
                  WHEN e.status='success' THEN 0
                  WHEN COALESCE(e.passed_count,0) <= COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_failure,
            e.started_at AS ts
     FROM case_set_executions_web e
     JOIN case_sets_web s ON s.id = e.set_id
     WHERE s.user_id = ? AND e.status NOT IN ('running')`,
    // Mobile 用例集
    `SELECT CASE WHEN e.status='success' THEN 1
                  WHEN e.status='failed' THEN 0
                  WHEN COALESCE(e.passed_count,0) > COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_success,
            CASE WHEN e.status='failed' THEN 1
                  WHEN e.status='success' THEN 0
                  WHEN COALESCE(e.passed_count,0) <= COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_failure,
            e.started_at AS ts
     FROM case_set_executions_mobile e
     JOIN case_sets_mobile s ON s.id = e.set_id
     WHERE s.user_id = ? AND e.status NOT IN ('running')`,
    // PC 用例集
    `SELECT CASE WHEN e.status='success' THEN 1
                  WHEN e.status='failed' THEN 0
                  WHEN COALESCE(e.passed_count,0) > COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_success,
            CASE WHEN e.status='failed' THEN 1
                  WHEN e.status='success' THEN 0
                  WHEN COALESCE(e.passed_count,0) <= COALESCE(e.failed_count,0) THEN 1
                  ELSE 0 END AS is_failure,
            e.started_at AS ts
     FROM case_set_executions_pc e
     JOIN case_sets_pc s ON s.id = e.set_id
     WHERE s.user_id = ? AND e.status NOT IN ('running')`,
  ].join(' UNION ALL ');

  // ── 3. 批量报告 (兼容, 虽然目前数据为空) ──
  const batchSql = [
    `SELECT CASE WHEN failed=0 AND passed>0 THEN 1 ELSE 0 END AS is_success,
            CASE WHEN failed>0 THEN 1 ELSE 0 END AS is_failure,
            executed_at AS ts
     FROM batch_reports_api br JOIN scenario_sets_api ss ON ss.id = br.set_id WHERE ss.user_id = ?`,
    `SELECT CASE WHEN failed=0 AND passed>0 THEN 1 ELSE 0 END AS is_success,
            CASE WHEN failed>0 THEN 1 ELSE 0 END AS is_failure,
            executed_at AS ts
     FROM batch_reports_web br JOIN case_sets_web ss ON ss.id = br.set_id WHERE ss.user_id = ?`,
    `SELECT CASE WHEN failed=0 AND passed>0 THEN 1 ELSE 0 END AS is_success,
            CASE WHEN failed>0 THEN 1 ELSE 0 END AS is_failure,
            executed_at AS ts
     FROM batch_reports_mobile br JOIN case_sets_mobile ss ON ss.id = br.set_id WHERE ss.user_id = ?`,
    `SELECT CASE WHEN failed=0 AND passed>0 THEN 1 ELSE 0 END AS is_success,
            CASE WHEN failed>0 THEN 1 ELSE 0 END AS is_failure,
            executed_at AS ts
     FROM batch_reports_pc br JOIN case_sets_pc ss ON ss.id = br.set_id WHERE ss.user_id = ?`,
  ].join(' UNION ALL ');

  const allSql = `SELECT date(ts) AS day,
                         SUM(is_success) AS passed,
                         SUM(is_failure) AS failed,
                         COUNT(*) AS count
                  FROM (${singleCaseSql} UNION ALL ${setExecSql} UNION ALL ${batchSql})
                  WHERE ts IS NOT NULL
                    AND date(ts) >= date('now', '+8 hours', '-${days} days')
                  GROUP BY day
                  ORDER BY day`;

  // 参数顺序: singleCase(userId×3) + setExec(userId×4) + batch(userId×4) = 11 params
  const rows = db
    .prepare(allSql)
    .all(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId) as {
    day: string;
    passed: number;
    failed: number;
    count: number;
  }[];

  // 填充缺失日期
  const rowMap = new Map(rows.map(r => [r.day, r]));
  const result: { date: string; passRate: number | null; count: number; passed: number; failed: number }[] = [];
  let totalCount = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = rowMap.get(key);
    const passed = row?.passed ?? 0;
    const failed = row?.failed ?? 0;
    const count = row?.count ?? 0;
    const total = passed + failed;
    totalCount += count;
    totalPassed += passed;
    totalFailed += failed;
    result.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      count,
      passed,
      failed,
    });
  }

  res.json({
    code: 200,
    message: 'ok',
    data: {
      trend: result,
      // 区间内汇总: 方便首页直接展示"执行总次数 / 成功 / 失败"
      summary: { total: totalCount, passed: totalPassed, failed: totalFailed },
    },
  });
});

// ── GET /api/dashboard/pending ────────────────────────────────────────
// 用户手动管理的待办事项列表
dashboardRoutes.get('/pending', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const rows = db
    .prepare(
      `SELECT id, title, status, created_at, completed_at
       FROM pending_items
       WHERE user_id = ?
       ORDER BY
         CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
         created_at DESC`,
    )
    .all(userId) as {
    id: number;
    title: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }[];

  res.json({ code: 200, message: 'ok', data: rows });
});

// ── POST /api/dashboard/pending ───────────────────────────────────────
// 新增一条待办事项
dashboardRoutes.post('/pending', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { title } = req.body as { title?: string };

  if (!title || !title.trim()) {
    res.status(400).json({ code: 400, message: '缺少参数 title' });
    return;
  }

  const result = db
    .prepare(`INSERT INTO pending_items (user_id, title) VALUES (?, ?)`)
    .run(userId, title.trim());

  res.json({
    code: 200,
    message: 'ok',
    data: { id: result.lastInsertRowid, title: title.trim(), status: 'pending' },
  });
});

// ── PUT /api/dashboard/pending/:id/complete ───────────────────────────
// 完成/取消完成一条待办事项（toggle）
dashboardRoutes.put('/pending/:id/complete', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);

  const row = db
    .prepare(`SELECT id, status FROM pending_items WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { id: number; status: string } | undefined;

  if (!row) {
    res.status(404).json({ code: 404, message: '待办事项不存在' });
    return;
  }

  const newStatus = row.status === 'pending' ? 'completed' : 'pending';
  const completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

  db.prepare(
    `UPDATE pending_items SET status = ?, completed_at = ? WHERE id = ?`,
  ).run(newStatus, completedAt, id);

  res.json({ code: 200, message: 'ok', data: { id, status: newStatus, completed_at: completedAt } });
});

// ── DELETE /api/dashboard/pending/:id ─────────────────────────────────
// 删除一条待办事项
dashboardRoutes.delete('/pending/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);

  const result = db
    .prepare(`DELETE FROM pending_items WHERE id = ? AND user_id = ?`)
    .run(id, userId);

  if (result.changes === 0) {
    res.status(404).json({ code: 404, message: '待办事项不存在' });
    return;
  }

  res.json({ code: 200, message: 'ok' });
});
