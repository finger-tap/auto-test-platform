// Standalone smoke test for the VM sandbox (Phase 1.1 fix)
// Verifies:
//   1. Positive: existing surface (setVar/getVar/env/prevApi/BUILTINS/async) works
//   2. Negative: RCE escapes are blocked (constructor chain, eval, new Function, process)
//
// Run with: npx tsx scripts/verify-sandbox.mjs

import { executeScript, evalCondition } from '../src/server/db/scripts/pre-post.js';

let pass = 0;
let fail = 0;

function expect(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function runPositive() {
  console.log('\n[1] Positive: existing functionality preserved');

  // 1a. setVar → returned in result.vars
  {
    const r = await executeScript(`setVar('user_id', '12345'); setVar('token', 'abc');`, {
      vars: {},
      env: {},
    });
    expect('setVar propagates to result.vars', r.success && r.vars.user_id === '12345' && r.vars.token === 'abc', JSON.stringify(r));
  }

  // 1b. getVar reads pre-existing vars
  {
    const r = await executeScript(`const v = getVar('existing'); setVar('echoed', v);`, {
      vars: { existing: 'hello world' },
      env: {},
    });
    expect('getVar reads ctx.vars', r.success && r.vars.echoed === 'hello world');
  }

  // 1c. Bare-name var access
  {
    const r = await executeScript(`setVar('upper', user_name.toUpperCase());`, {
      vars: { user_name: 'alice' },
      env: {},
    });
    expect('Bare-name var access works', r.success && r.vars.upper === 'ALICE');
  }

  // 1d. Env vars accessible by bare name
  {
    const r = await executeScript(`setVar('out', BASE_URL + '/api');`, {
      vars: {},
      env: { BASE_URL: 'https://example.com' },
    });
    expect('Env vars accessible by bare name', r.success && r.vars.out === 'https://example.com/api');
  }

  // 1e. Builtins (BUILTINS) work
  {
    const r = await executeScript(`setVar('id', randomUUID());`, {
      vars: {},
      env: {},
    });
    expect('Builtin randomUUID() works', r.success && typeof r.vars.id === 'string' && r.vars.id.length > 10);
  }

  // 1f. JSON / Math / Date
  {
    const r = await executeScript(`setVar('sum', String(Math.floor(JSON.parse('{"a":1.7}').a + 0.5)));`, {
      vars: {},
      env: {},
    });
    expect('Math + JSON work', r.success && r.vars.sum === '2', `got: ${r.vars.sum}`);
  }

  // 1g. Async / await
  {
    const r = await executeScript(`
      const v = await Promise.resolve('async-ok');
      setVar('result', v);
    `, { vars: {}, env: {} });
    expect('Async/await works', r.success && r.vars.result === 'async-ok');
  }

  // 1h. db object is null when no dbConfigs
  {
    const r = await executeScript(`setVar('has_db', db === null ? 'no' : 'yes');`, {
      vars: {},
      env: {},
    });
    expect('db is null when no dbConfigs', r.success && r.vars.has_db === 'no');
  }

  // 1i. prevApi accessible
  {
    const r = await executeScript(`setVar('status', String(prevApi.status_code));`, {
      vars: {},
      env: {},
      prevApi: { status_code: 200, response_body: '{}', response_headers: {} },
    });
    expect('prevApi accessible', r.success && r.vars.status === '200');
  }

  // 1j. console.log captured (note: host shim prefixes with [script])
  {
    const r = await executeScript(`console.log('hello'); console.log('world');`, {
      vars: {},
      env: {},
    });
    expect(
      'console.log captured',
      r.success && r.output === '[script] hello\n[script] world',
      r.output
    );
  }

  // 1k. evalCondition positive
  {
    const ok = evalCondition('status === "200" && code === "0"', {
      vars: { status: '200' },
      env: { code: '0' },
    });
    expect('evalCondition true case', ok === true);
  }

  // 1l. evalCondition negative
  {
    const ok = evalCondition('status === 200', {
      vars: { status: '500' },
      env: {},
    });
    expect('evalCondition false case', ok === false);
  }

  // 1m. evalCondition malformed → false (no throw)
  {
    const ok = evalCondition('this is not valid @@@', {
      vars: {},
      env: {},
    });
    expect('evalCondition malformed returns false', ok === false);
  }
}

async function runNegative() {
  console.log('\n[2] Negative: RCE escapes blocked');

  // 2a. Constructor chain escape (the main vulnerability)
  {
    const r = await executeScript(`
      const F = ({}).constructor.constructor;
      const proc = F('return process')();
      setVar('leaked', typeof proc);
    `, { vars: {}, env: {} });
    expect(
      'Constructor chain escape blocked',
      r.success === false || r.vars.leaked === 'undefined',
      r.error || `leaked: ${r.vars?.leaked}`
    );
  }

  // 2b. Direct process access (was accessible in old sandbox via outer realm)
  {
    const r = await executeScript(`setVar('has', typeof process);`, { vars: {}, env: {} });
    expect(
      'process not accessible',
      r.vars.has === 'undefined',
      `got: ${r.vars.has}`
    );
  }

  // 2c. require not accessible
  {
    const r = await executeScript(`setVar('has', typeof require);`, { vars: {}, env: {} });
    expect('require not accessible', r.vars.has === 'undefined', `got: ${r.vars.has}`);
  }

  // 2d. global not accessible
  {
    const r = await executeScript(`setVar('has', typeof global);`, { vars: {}, env: {} });
    expect("global not accessible (or doesn't have process)", !r.vars.has || r.vars.has === 'undefined', `got: ${r.vars.has}`);
  }

  // 2e. Function constructor direct call
  {
    const r = await executeScript(`
      try {
        const f = new Function('return 1+1');
        setVar('worked', 'yes');
      } catch (e) {
        setVar('worked', 'blocked');
      }
    `, { vars: {}, env: {} });
    expect('new Function() blocked', r.vars.worked === 'blocked', `got: ${r.vars.worked}`);
  }

  // 2f. eval() blocked
  {
    const r = await executeScript(`
      try {
        eval('1+1');
        setVar('worked', 'yes');
      } catch (e) {
        setVar('worked', 'blocked');
      }
    `, { vars: {}, env: {} });
    expect('eval() blocked', r.vars.worked === 'blocked', `got: ${r.vars.worked}`);
  }

  // 2g. module/exports not accessible
  {
    const r = await executeScript(`setVar('has', typeof module);`, { vars: {}, env: {} });
    expect('module not accessible', r.vars.has === 'undefined', `got: ${r.vars.has}`);
  }

  // 2h. setTimeout in script (was never allowed; should still fail)
  {
    const r = await executeScript(`
      try {
        setTimeout(() => {}, 0);
        setVar('worked', 'yes');
      } catch (e) {
        setVar('worked', 'blocked');
      }
    `, { vars: {}, env: {} });
    expect('setTimeout not in sandbox', r.vars.worked === 'blocked', `got: ${r.vars.worked}`);
  }
}

async function runTimeout() {
  console.log('\n[3] Timeout enforcement');

  // 3a. Slow async script times out
  {
    const start = Date.now();
    const r = await executeScript(`
      await new Promise(r => setTimeout(r, 10000));
      setVar('done', 'never');
    `, { vars: {}, env: {} });
    const elapsed = Date.now() - start;
    expect(
      `Async timeout fires within ${6000}ms`,
      r.success === false && elapsed < 6000,
      `elapsed=${elapsed}ms, success=${r.success}, error=${r.error}`
    );
  }

  // 3b. Infinite sync loop times out
  {
    const start = Date.now();
    const r = await executeScript(`
      while (true) {}
    `, { vars: {}, env: {} });
    const elapsed = Date.now() - start;
    expect(
      `Sync infinite loop timed out within ${6000}ms`,
      r.success === false && elapsed < 6000,
      `elapsed=${elapsed}ms, error=${r.error}`
    );
  }
}

(async () => {
  console.log('Verifying VM sandbox (Phase 1.1 fix)...');
  await runPositive();
  await runNegative();
  await runTimeout();
  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
