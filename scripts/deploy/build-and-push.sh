#!/usr/bin/env bash
# scripts/deploy/build-and-push.sh
#
# Builds the Tims.Api container image and pushes it to the ECR repo the Terraform
# module (services/Tims.Platform/deploy/terraform) creates. Scripts runbook §3
# verbatim (docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md):
#
#   cd services/Tims.Platform
#   ACCT=<your-account-id>; REGION=us-west-2; REPO=tims-platform-api; TAG=$(git rev-parse --short HEAD)
#   aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCT.dkr.ecr.$REGION.amazonaws.com
#   docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t $REPO:$TAG .
#   docker tag $REPO:$TAG $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
#   docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
#
# NOTE: the runbook's `aws ecr create-repository` (one-time, click-ops) step is
# intentionally NOT reproduced here — the Terraform module now owns the ECR
# repo (deploy/terraform/main.tf `aws_ecr_repository.api`, IMMUTABLE tags). Run
# `terraform apply` (or at least `-target=aws_ecr_repository.api`) BEFORE this
# script. See scripts/deploy/README.md for the full ordering.
#
# SAFETY MODEL:
#   - Dry-run by default: prints the exact commands, touches nothing, needs no
#     credentials, no Docker daemon requirement beyond what --dry-run itself needs
#     (none — dry-run does not invoke docker at all).
#   - Real execution requires the explicit --yes flag.
#   - On --yes, `aws sts get-caller-identity` is checked FIRST, before any build/
#     login/push, so a missing/expired credential fails loudly and immediately
#     rather than after a multi-minute dotnet build.
#   - Tag defaults to the short git SHA (git rev-parse --short HEAD). `latest` is
#     rejected outright — the ECR repo is IMMUTABLE-tagged, so `latest` would
#     never even be re-pushable, and the runbook is explicit about SHA tags.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLATFORM_DIR="$REPO_ROOT/services/Tims.Platform"

DRY_RUN=1
YES=0
REGION="us-west-2"
ACCOUNT_ID=""
REPO_NAME="tims-platform-api"
TAG=""

usage() {
  cat <<'EOF'
Usage: scripts/deploy/build-and-push.sh [options]

Builds the Tims.Api Docker image and pushes it to ECR (runbook §3).

Options:
  --yes                 Actually run the build/login/push. Without this flag,
                         the script only PRINTS what it would do and exits 0.
  --region <region>     AWS region (default: us-west-2, matches Terraform var
                         `aws_region`).
  --account-id <id>     AWS account ID. If omitted with --yes, it is resolved
                         from `aws sts get-caller-identity`. In dry-run mode
                         without this flag, a placeholder is printed.
  --repo-name <name>    ECR repository name (default: tims-platform-api,
                         matches Terraform var `ecr_repository_name`).
  --tag <tag>           Image tag. Default: short git SHA (git rev-parse
                         --short HEAD). Passing "latest" is a hard error —
                         the ECR repo is immutable-tagged and the runbook
                         requires SHA tags for traceable rollback.
  --dry-run             Explicit no-op mode (this is also the default).
  -h, --help            Show this help.

Examples:
  # Safe default — just shows the commands:
  scripts/deploy/build-and-push.sh --account-id 123456789012

  # Federico, for real, after `terraform apply` has created the ECR repo:
  scripts/deploy/build-and-push.sh --account-id 123456789012 --yes
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --region) REGION="$2"; shift 2 ;;
    --account-id) ACCOUNT_ID="$2"; shift 2 ;;
    --repo-name) REPO_NAME="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$TAG" ]; then
  if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  else
    echo "ERROR: could not resolve a git SHA for the default tag (not a git repo, or no commits?)." >&2
    echo "       Pass --tag explicitly if this is expected." >&2
    exit 1
  fi
fi

if [ "$TAG" = "latest" ]; then
  echo "ERROR: --tag latest is not allowed. The ECR repo is IMMUTABLE-tagged" >&2
  echo "       (deploy/terraform/main.tf) and the runbook (§3) always tags by" >&2
  echo "       short git SHA for traceable, reproducible rollback. Pass an" >&2
  echo "       explicit SHA-like tag, or omit --tag to use the current HEAD." >&2
  exit 1
fi

if [ ! -f "$PLATFORM_DIR/src/Tims.Api/Dockerfile" ]; then
  echo "ERROR: Dockerfile not found at $PLATFORM_DIR/src/Tims.Api/Dockerfile" >&2
  exit 1
fi

ACCOUNT_DISPLAY="${ACCOUNT_ID:-<ACCOUNT_ID-unresolved>}"
REGISTRY="${ACCOUNT_DISPLAY}.dkr.ecr.${REGION}.amazonaws.com"

echo "== Tims.Api build-and-push =="
echo "  mode:        $([ "$DRY_RUN" -eq 1 ] && echo 'DRY RUN (no changes made)' || echo 'REAL RUN')"
echo "  region:      $REGION"
echo "  account-id:  $ACCOUNT_DISPLAY"
echo "  repo-name:   $REPO_NAME"
echo "  tag:         $TAG"
echo "  build ctx:   $PLATFORM_DIR"
echo

print_plan() {
  cat <<EOF
Commands that would run (runbook §3):

  cd $PLATFORM_DIR
  aws sts get-caller-identity                          # credential preflight (real run only)
  aws ecr get-login-password --region $REGION | \\
    docker login --username AWS --password-stdin $REGISTRY
  docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t $REPO_NAME:$TAG .
  docker tag $REPO_NAME:$TAG $REGISTRY/$REPO_NAME:$TAG
  docker push $REGISTRY/$REPO_NAME:$TAG

EOF
}

if [ "$DRY_RUN" -eq 1 ]; then
  print_plan
  echo "Dry run complete. No AWS or Docker registry calls were made."
  echo "Re-run with --yes (and a real --account-id) to execute for real."
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  # Should be unreachable (DRY_RUN=0 is only set alongside YES=1 above), but
  # guard explicitly so a future edit can't accidentally skip confirmation.
  echo "ERROR: refusing to execute without --yes." >&2
  exit 1
fi

echo "-- Credential preflight --"
if ! CALLER_IDENTITY_JSON="$(aws sts get-caller-identity --output json 2>&1)"; then
  echo "ERROR: 'aws sts get-caller-identity' failed — no valid AWS credentials are" >&2
  echo "       configured in this environment. Refusing to proceed with any" >&2
  echo "       ECR login, docker build, or docker push." >&2
  echo "       Underlying error:" >&2
  echo "$CALLER_IDENTITY_JSON" | sed 's/^/       /' >&2
  exit 1
fi
echo "Credentials OK:"
echo "$CALLER_IDENTITY_JSON"

if [ -z "$ACCOUNT_ID" ]; then
  ACCOUNT_ID="$(echo "$CALLER_IDENTITY_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Account"])')"
  echo "Resolved --account-id from caller identity: $ACCOUNT_ID"
fi
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo
echo "-- ECR login --"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo
echo "-- Docker build (context: $PLATFORM_DIR) --"
(cd "$PLATFORM_DIR" && docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t "$REPO_NAME:$TAG" .)

echo
echo "-- Tag + push --"
docker tag "$REPO_NAME:$TAG" "$REGISTRY/$REPO_NAME:$TAG"
docker push "$REGISTRY/$REPO_NAME:$TAG"

echo
echo "Done. Image pushed: $REGISTRY/$REPO_NAME:$TAG"
echo "Next: point Terraform's image_tag variable at '$TAG' and 'terraform apply'."
