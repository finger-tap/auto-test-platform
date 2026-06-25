import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findMobileTestsByUserIdPaginated,
  findMobileTestById,
  findMobileTestByName,
  createMobileTest,
  updateMobileTest,
  deleteMobileTest,
  createMobileTestLog,
  findLogsByMobileTestCaseId,
  createMobileCaseExecution,
  finishMobileCaseExecution,
  findMobileCaseExecutionsByCaseId,
  findRunningExecutionByDevice,
  findRunningExecutionByLocalDeviceKey,
  type MobileTestListFilter,
} from '../db/mobile-tests.js';
import { findUserById } from '../db/users.js';
import { executeMobileTest } from '../engine/mobile-executor.js';
import { getDevice } from '../db/devices.js';
import { relativeReportUrl } from '../engine/report-paths.js';
import { findEnvById, envToMap } from '../db/environments.js';
import { invalidateAllMergedCache } from '../devices/merge.js';

export const mobileTestRoutes = Router();
mobileTestRoutes.use(authMiddleware);

// 2026-06-10: 设备级执行 busy 锁 — in-memory mutex,按 lockKey 串行化 execute 路径。
// lockKey 是 string:
//   - 远端设备:`remote:<id>`(number 转 string)
//   - 本地设备:`<deviceId 原样>`,UI 传 `local:android:<serial>`
// 单进程内由这里主导;DB 兜底有 partial UNIQUE INDEX (idx_mobile_case_executions_running_per_device),
// 但那只覆盖 remote(因为 local 设备不在 devices 表里)。
// Map 不主动清理(残留的 resolved Promise 是无害的),理论上限 ≤ 设备数,可忽略。
const deviceLocks = new Map<string, Promise<unknown>>();

function withDeviceLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = deviceLocks.get(lockKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  // 把 next 也存为下次的 prev;catch 防止 fn reject 毒化后续 caller
  deviceLocks.set(lockKey, next.catch(() => undefined));
  return next;
}

// SQLite UNIQUE constraint 错误码(用于 catch createMobileCaseExecution 的兜底)
function isUniqueConstraintError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: string }).code;
  return typeof code === 'string' && code.includes('SQLITE_CONSTRAINT_UNIQUE');
}

// GET /api/mobile-tests
mobileTestRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters: MobileTestListFilter = {
    name: req.query.name as string | undefined,
    description: req.query.description as string | undefined,
    tag: req.query.tag as string | undefined,
    status: req.query.status as string | undefined,
    platform: req.query.platform as string | undefined,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
  };
  const result = findMobileTestsByUserIdPaginated(req.user!.userId, page, pageSize, sort, order, filters);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/mobile-tests
mobileTestRoutes.post('/', (req: Request, res: Response) => {
  const {
    name, description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, preconditions, tags, status,
    case_content, case_content_type,
  } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }

  const trimmedName = name.trim();
  if (findMobileTestByName(req.user!.userId, trimmedName)) {
    res.status(409).json({ code: 409, message: '已存在同名用例' });
    return;
  }

  const id = createMobileTest(req.user!.userId, {
    name: trimmedName, description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, preconditions, tags, status,
    case_content: typeof case_content === 'string' ? case_content : null,
    case_content_type: case_content_type === 'yaml' ? 'yaml' : 'text',
  });
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// Helper: check ownership
function checkOwnership(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ code: 400, message: 'Invalid id' });
    return null;
  }
  const testCase = findMobileTestById(id);
  if (!testCase) {
    res.status(404).json({ code: 404, message: 'Test case not found' });
    return null;
  }
  if (testCase.user_id !== req.user!.userId) {
    res.status(403).json({ code: 403, message: 'Forbidden' });
    return null;
  }
  return testCase;
}

// GET /api/mobile-tests/:id
mobileTestRoutes.get('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  res.json({ code: 200, message: 'ok', data: testCase });
});

// PUT /api/mobile-tests/:id
mobileTestRoutes.put('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;

  const {
    name, description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, preconditions, tags, status,
    case_content, case_content_type,
  } = req.body;

  const checkName = name && typeof name === 'string' ? name.trim() : testCase.name;
  const existingCase = findMobileTestByName(req.user!.userId, checkName);
  if (existingCase && existingCase.id !== testCase.id) {
    res.status(409).json({ code: 409, message: '已存在同名用例' });
    return;
  }

  updateMobileTest(testCase.id, {
    name, description, platform, device_name, platform_version,
    app_package, app_activity, bundle_id, appium_url, capabilities,
    test_script, assertions, preconditions, tags, status,
    case_content: typeof case_content === 'string' ? case_content : (case_content === null ? null : undefined),
    case_content_type: case_content_type === 'yaml' || case_content_type === 'text' ? case_content_type : undefined,
  });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/mobile-tests/:id
mobileTestRoutes.delete('/:id', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  deleteMobileTest(testCase.id);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/mobile-tests/:id/execute
mobileTestRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  // 2026-06-10: 设备级 busy 锁 — 同时支持本地和远端设备。
  // - mutex 主导单进程内的并发;DB 兜底由 partial UNIQUE INDEX 抓跨进程/未来多 server。
  // - 远端设备:lockKey=`remote:<id>`(numeric,SQL busy check + partial UNIQUE INDEX 双兜底)
  // - 本地设备:lockKey=deviceId 原样(`local:android:<serial>`),无 SQL busy check
  //   (本地设备不在 devices 表里,只能靠 mutex 串行化)
  // - 没传 deviceId / 设备不存在 / device 不是 mobile → 走老路径不锁(兼容无设备执行)。
  const deviceIdParam = req.query.deviceId;
  let lockKey: string | null = null;
  let execDeviceId: number | null = null;

  if (typeof deviceIdParam === 'string' && deviceIdParam.startsWith('local:')) {
    // 本地设备 — UI 传 `local:android:<serial>`,deviceId 字符串本身已 namespace 隔离
    lockKey = deviceIdParam;
  } else {
    const num = Number(deviceIdParam);
    if (Number.isFinite(num) && num > 0) {
      const d = getDevice(num);
      if (d?.test_type === 'mobile') {
        lockKey = `remote:${num}`;
        execDeviceId = num;
      }
    }
  }

  if (lockKey == null) {
    // 老路径 — 无设备或非 mobile,保持原行为不挡用户
    return runExecute(req, res, testCase, executedBy, null, null);
  }

  try {
    const isLocal = lockKey.startsWith('local:');
    await withDeviceLock(lockKey, async () => {
      // DB busy check — 远端走 device_id,本地走 local_device_key
      if (isLocal) {
        const running = findRunningExecutionByLocalDeviceKey(lockKey);
        if (running) {
          console.log(`[execute:busy] reject local lockKey=${lockKey} runningExecId=${running.id}`);
          res.status(409).json({ code: 409, message: '设备正被其他会话占用' });
          invalidateAllMergedCache();
          return;
        }
      } else if (execDeviceId !== null) {
        const running = findRunningExecutionByDevice(execDeviceId);
        if (running) {
          console.log(`[execute:busy] reject lockKey=${lockKey} userId=${req.user!.userId} runningExecId=${running.id}`);
          res.status(409).json({ code: 409, message: '设备正被其他会话占用' });
          invalidateAllMergedCache();
          return;
        }
      }
      invalidateAllMergedCache();
      await runExecute(req, res, testCase, executedBy, execDeviceId, isLocal ? lockKey : null);
    });
  } catch (e) {
    console.log(`[execute:busy] withDeviceLock threw lockKey=${lockKey}: ${e instanceof Error ? e.message : String(e)}`);
    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: 'execute failed' });
    }
  }
});

/**
 * 实际执行 case — 抽出来避免 withDeviceLock 嵌套 if 太多层。
 * execDeviceId 非 null 时,会在创建 execution 行前用 UNIQUE INDEX 兜底再判一次 busy。
 */
async function runExecute(
  req: Request,
  res: Response,
  testCase: NonNullable<ReturnType<typeof findMobileTestById>>,
  executedBy: string,
  execDeviceId: number | null,
  localDeviceKey: string | null,
): Promise<void> {
  const deviceId = execDeviceId;   // 透传给 executor(它只用 deviceId 查 SSH 凭据等)
  const startedAt = new Date().toISOString();

  // Phase 4: write a normalized mobile_case_executions row first.
  let execId: number;
  try {
    execId = createMobileCaseExecution(testCase.id, req.user!.userId, {
      started_at: startedAt,
      executed_by: executedBy,
      device_id: execDeviceId,
      local_device_key: localDeviceKey,
    });
  } catch (e) {
    // 兜底:UNIQUE INDEX 拒绝第二个 running 行(理论上 mutex 已防,这里是 defense-in-depth)
    if (isUniqueConstraintError(e)) {
      console.log(`[execute:busy] UNIQUE INDEX caught deviceId=${execDeviceId} — returning 409`);
      res.status(409).json({ code: 409, message: '设备正被其他会话占用' });
      invalidateAllMergedCache();
      return;
    }
    throw e;
  }
  // start 后清一下其他用户的设备列表缓存(让他们看到这个设备变 busy)
  invalidateAllMergedCache();

  // Environment variable substitution: load env vars from the selected environment.
  let envVars: Record<string, string> | undefined;
  const environmentId = typeof req.body?.environmentId === 'number' ? req.body.environmentId : undefined;
  if (environmentId) {
    const env = findEnvById(environmentId, req.user!.userId);
    if (env) {
      envVars = envToMap(env);
      console.log(`[routes:mobile-tests] case=${testCase.id} envId=${environmentId} envVars=${Object.keys(envVars).length} keys=${Object.keys(envVars).join(',')}`);
    }
  }

  let result: Awaited<ReturnType<typeof executeMobileTest>>;
  try {
    result = await executeMobileTest(testCase, {
      executedBy,
      deviceId,
      userId: req.user!.userId,
      // 2026-06-10: pass caseId/execId so the executor can compute the per-case
      // Midscene report path (same pattern as web/pc executors). Without
      // these, the executor silently skips report capture and result.report_path
      // is undefined → mobile_case_executions.report_path is NULL in the DB.
      caseId: testCase.id,
      execId,
      envVars,
    });
  } catch (err) {
    const finishedAt = new Date().toISOString();
    console.error(`[routes:mobile-tests] executor threw for case=${testCase.id} execId=${execId}`, err);
    finishMobileCaseExecution(execId, {
      status: 'failed',
      finished_at: finishedAt,
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      report_path: null,
      report_type: null,
      error_message: err instanceof Error ? err.message : String(err),
    });
    invalidateAllMergedCache();
    res.status(500).json({ code: 500, message: '执行异常', data: { error_message: err instanceof Error ? err.message : String(err) } });
    return;
  }

  const finishedAt = new Date().toISOString();
  finishMobileCaseExecution(execId, {
    status: result.status,
    finished_at: finishedAt,
    duration_ms: result.duration_ms,
    report_path: result.report_path || null,
    report_type: result.report_path ? 'midscene-html' : null,
    error_message: result.error_message || null,
  });
  // finish 后清(让其他用户看到设备变 idle)
  invalidateAllMergedCache();

  // Backward-compat: also keep mobile_test_logs writable (UI shows legacy logs).
  const logId = createMobileTestLog(testCase.id, {
    status: result.status,
    duration_ms: result.duration_ms,
    executed_by: executedBy,
    result: JSON.stringify(result),
    error_message: result.error_message || null,
    screenshots: JSON.stringify(result.screenshots),
  });

  res.json({
    code: 200, message: 'ok',
    data: {
      id: logId,
      execution_id: execId,
      report_path: result.report_path || null,
      report_url: result.report_path
        ? relativeReportUrl('mobile', testCase.id, execId)
        : null,
      ...result,
      executed_by: executedBy,
    },
  });
}

// GET /api/mobile-tests/:id/executions (Phase 4 — normalized execution history)
mobileTestRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const items = findMobileCaseExecutionsByCaseId(testCase.id, limit);
  res.json({
    code: 200, message: 'ok',
    data: items.map((e) => ({
      ...e,
      report_url: e.report_path
        ? relativeReportUrl('mobile', testCase.id, e.id)
        : null,
    })),
  });
});

// GET /api/mobile-tests/:id/logs
mobileTestRoutes.get('/:id/logs', (req: Request, res: Response) => {
  const testCase = checkOwnership(req, res);
  if (!testCase) return;
  const limit = Math.min(Number(req.query.limit) || 10, 100);
  const logs = findLogsByMobileTestCaseId(testCase.id, limit);
  res.json({ code: 200, message: 'ok', data: logs });
});
