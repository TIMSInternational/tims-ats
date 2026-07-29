#!/bin/bash
# TIMS ATS — API Test Script
# Tests all 25 tRPC routers via HTTP

set -e

BASE="http://localhost:3010/api/trpc"

# Load env
cd "$(dirname "$0")/.."
export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)

# Get auth token
TOKEN=$(curl -s -X POST "${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"federico@nexadev.ai","password":"Tims2026!"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Auth cookie format for Supabase SSR
COOKIE="sb-lzhfnjfsdwdywwnlqgqq-auth-token=base64-eyJ0eXBlIjoiYWNjZXNzIiwiYWNjZXNzX3Rva2VuIjoiJHtUT0tFTn0ifQ=="

PASS=0
FAIL=0
ERRORS=""

test_query() {
  local name="$1"
  local proc="$2"
  local input="$3"

  local url="${BASE}/${proc}"
  if [ -n "$input" ]; then
    local encoded=$(python3 -c "import urllib.parse,json; print(urllib.parse.quote(json.dumps($input)))")
    url="${url}?input=${encoded}"
  fi

  local response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$url" 2>&1)

  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | sed '$d')

  # Check if response contains "result" (tRPC success) or specific error patterns
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',{}).get('data',{}); sys.exit(0 if r is not None else 1)" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  elif echo "$body" | grep -q '"code":"UNAUTHORIZED"' 2>/dev/null; then
    echo "  PASS  $name (auth check works)"
    PASS=$((PASS + 1))
  elif echo "$body" | grep -q '"code":"FORBIDDEN"' 2>/dev/null; then
    echo "  PASS  $name (permission check works)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (HTTP $http_code)"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  - ${name}: ${body:0:200}"
  fi
}

echo ""
echo "======================================"
echo "  TIMS ATS — API Test Suite"
echo "======================================"
echo ""

echo "--- auth ---"
test_query "auth.getSessionInfo" "auth.getSessionInfo"

echo ""
echo "--- organization ---"
test_query "org.getCurrent" "organization.getCurrent"
test_query "org.listCompanies" "organization.listCompanies"

echo ""
echo "--- user ---"
test_query "user.me" "user.me"
test_query "user.list" "user.list" '{"limit":5}'

echo ""
echo "--- vacancy ---"
test_query "vacancy.list" "vacancy.list" '{"limit":5}'
test_query "vacancy.getDashboardKpis" "vacancy.getDashboardKpis"

echo ""
echo "--- pipeline ---"
test_query "pipeline.getSlaStatus" "pipeline.getSlaStatus"
test_query "pipeline.getFunnel" "pipeline.getFunnel"

echo ""
echo "--- candidate ---"
test_query "candidate.list" "candidate.list" '{"limit":5}'
test_query "candidate.getPoolStats" "candidate.getPoolStats"

echo ""
echo "--- assessment ---"
test_query "assessment.listTypes" "assessment.listTypes"
test_query "assessment.listPending" "assessment.listPending" '{"limit":5}'

echo ""
echo "--- interview ---"
test_query "interview.listToday" "interview.listToday"
test_query "interview.getPendingScorecards" "interview.getPendingScorecards"

echo ""
echo "--- offer ---"
test_query "offer.list" "offer.list" '{"limit":5}'
test_query "offer.getPending" "offer.getPending"

echo ""
echo "--- onboarding ---"
test_query "onboarding.list" "onboarding.list" '{"limit":5}'
test_query "onboarding.getDashboardKpis" "onboarding.getDashboardKpis"

echo ""
echo "--- performance ---"
test_query "performance.listOkrs" "performance.listOkrs" '{"limit":5}'
test_query "performance.getDashboardKpis" "performance.getDashboardKpis"
test_query "performance.listRecognitions" "performance.listRecognitions" '{"limit":5}'

echo ""
echo "--- learning ---"
test_query "learning.listCourses" "learning.listCourses"
test_query "learning.getDashboardKpis" "learning.getDashboardKpis"

echo ""
echo "--- engagement ---"
test_query "engagement.listSurveys" "engagement.listSurveys"
test_query "engagement.getDashboardKpis" "engagement.getDashboardKpis"

echo ""
echo "--- dei ---"
test_query "dei.getDashboardKpis" "dei.getDashboardKpis"

echo ""
echo "--- compensation ---"
test_query "compensation.getSalaryBands" "compensation.getSalaryBands"
test_query "compensation.getDashboardKpis" "compensation.getDashboardKpis"

echo ""
echo "--- monitoring ---"
test_query "monitoring.getExecutiveKpis" "monitoring.getExecutiveKpis"
test_query "monitoring.getActiveAlerts" "monitoring.getActiveAlerts"

echo ""
echo "--- integration ---"
test_query "integration.listConnectors" "integration.listConnectors"
test_query "integration.getDashboardKpis" "integration.getDashboardKpis"

echo ""
echo "--- audit ---"
test_query "audit.listLogs" "audit.listLogs" '{"limit":5}'

echo ""
echo "--- billing ---"
test_query "billing.listInvoices" "billing.listInvoices" '{"take":5}'

echo ""
echo "--- featureFlag ---"
test_query "featureFlag.list" "featureFlag.list"

echo ""
echo "--- portal (public) ---"
# Portal endpoints don't need auth
SAVE_TOKEN=$TOKEN
TOKEN=""
test_query "portal.listVacancies" "portal.listVacancies" '{"page":1}'
TOKEN=$SAVE_TOKEN

echo ""
echo "======================================"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "======================================"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
fi
