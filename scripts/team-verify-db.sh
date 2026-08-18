#!/usr/bin/env bash
# TiDB/MySQL 验证脚本 — 用户本地启动 TiDB 后运行:
#   DB_URL="mysql://root@127.0.0.1:4000/autotest_team" bash scripts/team-verify-db.sh
#
# 验证内容:
#   1. 连接 + 自动建库(migrate.ts 的 ensureDatabase)
#   2. drizzle 迁移全部应用
#   3. 注册/登录/建团队/建项目 全链路
#   4. 团队业务资源 CRUD(apis)+ 乐观锁 409 + 版本历史 + 回滚
#   5. .atpkg 导入链路(export-package 需本地 JWT,此脚本跳过,走 UI 验证)

set -euo pipefail

DB_URL="${DB_URL:-mysql://root@127.0.0.1:4000/autotest_team}"
export DB_URL
echo "[verify] DB_URL=$DB_URL"

PORT=3997
BASE="http://127.0.0.1:$PORT/api"
FAIL=0

step() { echo; echo "── $1 ──"; }
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

step "1/4 启动 server(自动建库+迁移)"
PORT=$PORT npx tsx src/server/index.ts > /tmp/team-verify.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 10

PING=$(curl -s --max-time 5 "$BASE/team/ping")
echo "  ping: $PING"
echo "$PING" | grep -q '"teamReady":true' && ok "migrations applied (teamReady=true)" || { bad "teamReady=false — check /tmp/team-verify.log"; exit 1; }

step "2/4 中心账号 + 组织"
ACC="verify_$(date +%s)@test.local"
REG=$(curl -s -X POST "$BASE/team/auth/register" -H 'Content-Type: application/json' \
  -d "{\"account\":\"$ACC\",\"password\":\"123456\",\"nickname\":\"验证员\"}")
echo "$REG" | grep -q '"code":201' && ok "register" || bad "register: $REG"

LOGIN=$(curl -s -X POST "$BASE/team/auth/login" -H 'Content-Type: application/json' \
  -d "{\"account\":\"$ACC\",\"password\":\"123456\"}")
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && ok "login (token len=${#TOKEN})" || { bad "login: $LOGIN"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

TEAM=$(curl -s -X POST "$BASE/team/teams" -H 'Content-Type: application/json' -H "$AUTH" \
  -d "{\"name\":\"验证团队_$(date +%s)\",\"description\":\"auto verify\"}")
TEAM_ID=$(echo "$TEAM" | sed -n 's/.*"team":{[^}]*"id":\([0-9]*\).*/\1/p')
[ -n "$TEAM_ID" ] && ok "create team id=$TEAM_ID" || { bad "create team: $TEAM"; exit 1; }

PROJ=$(curl -s -X POST "$BASE/team/teams/$TEAM_ID/projects" -H 'Content-Type: application/json' -H "$AUTH" \
  -d '{"name":"验证项目"}')
PROJ_ID=$(echo "$PROJ" | sed -n 's/.*"project":{[^}]*"id":\([0-9]*\).*/\1/p')
[ -n "$PROJ_ID" ] && ok "create project id=$PROJ_ID" || { bad "create project: $PROJ"; exit 1; }

CTX="X-Team-Id: $TEAM_ID"
PRJ="X-Project-Id: $PROJ_ID"

step "3/4 业务资源 CRUD + 乐观锁 + 版本"
CREATE=$(curl -s -X POST "$BASE/apis" -H 'Content-Type: application/json' -H "$AUTH" -H "$CTX" -H "$PRJ" \
  -d '{"name":"验证接口","method":"GET","url":"https://httpbin.org/get"}')
API_ID=$(echo "$CREATE" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
echo "$CREATE" | grep -q '"code":201' && ok "create api id=$API_ID" || bad "create api: $CREATE"

LIST=$(curl -s "$BASE/apis?page=1&pageSize=10" -H "$AUTH" -H "$CTX" -H "$PRJ")
echo "$LIST" | grep -q "验证接口" && ok "list apis (scoped)" || bad "list apis: $LIST"

# read (marks seen version)
curl -s "$BASE/apis/$API_ID" -H "$AUTH" -H "$CTX" -H "$PRJ" > /dev/null

UPD=$(curl -s -X PUT "$BASE/apis/$API_ID" -H 'Content-Type: application/json' -H "$AUTH" -H "$CTX" -H "$PRJ" \
  -d '{"name":"验证接口v2"}')
echo "$UPD" | grep -q '"code":200' && ok "update api" || bad "update api: $UPD"

# optimistic lock: stale version in body → 409
STALE=$(curl -s -X PUT "$BASE/apis/$API_ID" -H 'Content-Type: application/json' -H "$AUTH" -H "$CTX" -H "$PRJ" \
  -d '{"name":"陈旧写入","version":1}')
echo "$STALE" | grep -q '"code":409' && ok "optimistic lock 409" || bad "expected 409, got: $STALE"

VERS=$(curl -s "$BASE/apis/$API_ID/versions" -H "$AUTH" -H "$CTX" -H "$PRJ")
echo "$VERS" | grep -q '"version":1' && ok "version snapshots written" || bad "versions: $VERS"

RB=$(curl -s -X POST "$BASE/apis/$API_ID/rollback" -H 'Content-Type: application/json' -H "$AUTH" -H "$CTX" -H "$PRJ" \
  -d '{"version":1}')
echo "$RB" | grep -q '"code":200' && ok "rollback to v1" || bad "rollback: $RB"

AUDIT=$(curl -s "$BASE/team/teams/$TEAM_ID/audit" -H "$AUTH")
echo "$AUDIT" | grep -q "验证接口" && ok "audit trail" || bad "audit: $AUDIT"

DEL=$(curl -s -X DELETE "$BASE/apis/$API_ID" -H "$AUTH" -H "$CTX" -H "$PRJ")
echo "$DEL" | grep -q '"code":200' && ok "delete api" || bad "delete: $DEL"

step "4/4 权限隔离"
# no-team-header request with team token → 400
NOCTX=$(curl -s "$BASE/apis" -H "$AUTH")
echo "$NOCTX" | grep -q '"code":400' && ok "missing team ctx → 400" || bad "expected 400: $NOCTX"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "═══════ ALL DB VERIFICATIONS PASSED ═══════"
else
  echo "═══════ $FAIL CHECK(S) FAILED ═══════"
  tail -20 /tmp/team-verify.log || true
  exit 1
fi
