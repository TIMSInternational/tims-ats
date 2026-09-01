#!/usr/bin/env bash
#
# enable-fx-refresh.sh — end the FX stale-pin incident by turning the refresh on.
#
# Run it with:   bash scripts/deploy/enable-fx-refresh.sh
#
# ── THE INCIDENT ─────────────────────────────────────────────────────────────────────────────────
# `fx_rates` froze at `as_of 2026-07-31` while the FX reads served live traffic: compensation band
# distributions, total-comp breakdowns, the compensation dashboard KPIs and DEI pay equity all convert
# through those rates, and for four of the six endpoints the TypeScript fallback has been DELETED. COP
# drifted ~2.4% in the first fifteen days.
#
# The cause was structural: the daily refresh lived in `Tims.Workers`, which has never been deployed.
# PR #236 fixed it by hosting the same refresh use case inside the API that IS deployed
# (`FxRefreshHostedService`), behind `Platform:FxRefreshEnabled`, default false.
#
# That fix then sat unreachable for two weeks. The runbook said "flip the flag", but the running image
# predated the fix — the flag named code that was not there. The 2026-09-01 deploy changed that:
# `FxRefreshHostedService` is confirmed present in the running image, so this is now a real action.
#
# ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────
# Adds exactly one environment variable. It derives the payload from the LIVE service config and
# refuses to apply unless the only difference is that one added key — App Runner's update-service takes
# a FULL map and silently drops every key omitted from it, which on this service would darken 22 live
# flags across ~13 production surfaces.
#
set -uo pipefail

REGION="us-west-2"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
SERVICE="tims-platform-api"
KEY="Platform__FxRefreshEnabled"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

say ""
say "FX refresh — enable"
say "═══════════════════"

ARN="$(aws apprunner list-services --profile "$PROFILE" --region "$REGION" \
        --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceArn" --output text 2>/dev/null)"
[[ -z "$ARN" || "$ARN" == "None" ]] && { bad "Service not found in $REGION."; exit 1; }

aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" > "$WORK/live.json"
STATUS="$(python3 -c "import json;print(json.load(open('$WORK/live.json'))['Service']['Status'])")"
[[ "$STATUS" == "RUNNING" ]] || { bad "Service status is $STATUS, not RUNNING. Wait and retry."; exit 1; }
ok "Service is RUNNING"

cp "$WORK/live.json" "$HOME/tims-apprunner-BACKUP-before-fx.json"
ok "Config backed up to ~/tims-apprunner-BACKUP-before-fx.json"

python3 - "$WORK" "$KEY" <<'PY' || exit 1
import json, sys, copy
work, key = sys.argv[1], sys.argv[2]
svc = json.load(open(f"{work}/live.json"))["Service"]
before = svc["SourceConfiguration"]
after = copy.deepcopy(before)
env = after["ImageRepository"]["ImageConfiguration"].setdefault("RuntimeEnvironmentVariables", {})

if env.get(key) == "true":
    print("ALREADY_ON")
    sys.exit(3)
env[key] = "true"

diffs = []
def walk(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            if k not in a: diffs.append(f"ADDED {path}/{k}")
            elif k not in b: diffs.append(f"REMOVED {path}/{k}")
            else: walk(a[k], b[k], f"{path}/{k}")
    elif a != b:
        diffs.append(f"CHANGED {path}")
walk(before, after)

expected = [f"ADDED /ImageRepository/ImageConfiguration/RuntimeEnvironmentVariables/{key}"]
n = len(env)
print(f"  diff: {diffs}")
print(f"  env vars after: {n}")
if diffs != expected:
    print("  REFUSE: payload changes more than the one key")
    sys.exit(1)
if n < 27:
    print(f"  REFUSE: only {n} env vars — a partial map would darken the live surfaces")
    sys.exit(1)
json.dump(after, open(f"{work}/payload.json", "w"), indent=2)
PY
rc=$?
if [[ $rc -eq 3 ]]; then ok "$KEY is ALREADY true — nothing to do."; exit 0; fi
[[ $rc -ne 0 ]] && { bad "Payload verification failed. Nothing applied."; exit 1; }
ok "Payload adds exactly one key and retains every other"

say ""
say "Applying…"
OP="$(aws apprunner update-service --profile "$PROFILE" --region "$REGION" \
      --service-arn "$ARN" --source-configuration "file://$WORK/payload.json" \
      --query 'OperationId' --output text 2>&1)"
[[ -z "$OP" || "$OP" == *rror* ]] && { bad "update-service failed: $OP"; exit 1; }
ok "Started — operation $OP"

for i in $(seq 1 60); do
  sleep 15
  S="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" \
        --service-arn "$ARN" --query 'Service.Status' --output text 2>/dev/null)"
  printf '\r  [%02d] %-24s' "$i" "$S"
  [[ "$S" == "RUNNING" ]] && break
done
printf '\n'

N="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" \
  --query 'length(Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables)' --output text)"
V="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" \
  --query "Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.$KEY" --output text)"
URL="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" --query 'Service.ServiceUrl' --output text)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://$URL/health")"

say ""
say "  $KEY = $V"
say "  env vars: $N (was 26, expect 27)"
say "  GET /health -> HTTP $CODE"
say ""

if [[ "$V" == "true" && "$N" == "27" && "$CODE" == "200" ]]; then
  ok "FX REFRESH IS ON."
  say ""
  say "  The refresh runs on startup and then daily. Confirm the pins actually moved —"
  say "  this is the only proof that matters, and it is a DATABASE check, not a config one:"
  say ""
  say "      SELECT base, quote, rate, as_of, source FROM fx_rates ORDER BY as_of DESC;"
  say ""
  say "  as_of should leave 2026-07-31 within a few minutes. If it does not, the flag is on"
  say "  but the job is failing — check the App Runner application logs for FxRefresh."
  exit 0
fi

bad "Did not verify. Roll back with: bash ~/tims-rollback.sh"
exit 1
