#!/usr/bin/env bash
#
# bootstrap-github-oidc-role.sh — create the IAM role GitHub Actions assumes to deploy the C# API.
#
# Run it with:   bash scripts/deploy/bootstrap-github-oidc-role.sh
#
# ONE-TIME setup for `.github/workflows/deploy-platform-api.yml`. Idempotent: re-running it updates
# the policy in place and re-verifies, so it is safe to run again after editing the permissions.
#
# ── WHY OIDC AND NOT AN ACCESS KEY ───────────────────────────────────────────────────────────────
# No long-lived AWS credentials exist for this repo and none should be created. GitHub federates a
# short-lived token per run, scoped to a single repo and ref. The OIDC provider ALREADY EXISTS in this
# account (arn:aws:iam::747814092517:oidc-provider/token.actions.githubusercontent.com) and is used by
# climate-project, formmaps and translate — this follows that established pattern rather than
# inventing one.
#
# ── SCOPE OF THE ROLE ────────────────────────────────────────────────────────────────────────────
# Deliberately narrow. It can push to ONE ECR repository and update ONE App Runner service. It cannot
# read secrets, touch the database, create IAM, or reach any other service. The trust policy admits
# only pushes to `main` of this one repository — a PR branch cannot assume it, so a fork or an
# untrusted branch cannot deploy.
#
set -uo pipefail

ACCOUNT="747814092517"
REGION="us-west-2"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
ROLE="tims-ats-github-deploy-prod"
POLICY="deploy-tims-platform-api"
REPO="TIMSInternational/tims-ats"
ECR_REPO="tims-platform-api"
SERVICE_ARN="arn:aws:apprunner:${REGION}:${ACCOUNT}:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5"
ECR_ACCESS_ROLE="arn:aws:iam::${ACCOUNT}:role/tims-platform-api-ecr-access-role"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

say() { printf '%s\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

say ""
say "GitHub Actions deploy role — bootstrap"
say "══════════════════════════════════════"

WHO="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text 2>/dev/null)"
if [[ "$WHO" != "$ACCOUNT" ]]; then
  bad "Wrong account: got '${WHO:-none}', need $ACCOUNT."
  bad "The DEFAULT profile is a different account — pass --profile $PROFILE."
  exit 1
fi
ok "Authenticated to $ACCOUNT"

aws iam get-open-id-connect-provider --profile "$PROFILE" \
  --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1 \
  || { bad "GitHub OIDC provider not found. Expected it to already exist."; exit 1; }
ok "GitHub OIDC provider present"

TRUST="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$OIDC_ARN" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:${REPO}:ref:refs/heads/main" }
    }
  }]
}
JSON
)"

PERMS="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthTokenIsAccountWide",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushOnlyToThisRepository",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:DescribeImages"
      ],
      "Resource": "arn:aws:ecr:${REGION}:${ACCOUNT}:repository/${ECR_REPO}"
    },
    {
      "Sid": "ListIsNotResourceScopable",
      "Effect": "Allow",
      "Action": "apprunner:ListServices",
      "Resource": "*"
    },
    {
      "Sid": "UpdateOnlyThisService",
      "Effect": "Allow",
      "Action": ["apprunner:DescribeService", "apprunner:UpdateService"],
      "Resource": "${SERVICE_ARN}"
    },
    {
      "Sid": "AppRunnerPullsEcrAsThisRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "${ECR_ACCESS_ROLE}",
      "Condition": { "StringEquals": { "iam:PassedToService": "build.apprunner.amazonaws.com" } }
    }
  ]
}
JSON
)"

if aws iam get-role --profile "$PROFILE" --role-name "$ROLE" >/dev/null 2>&1; then
  say "  Role exists — updating its trust policy in place."
  aws iam update-assume-role-policy --profile "$PROFILE" --role-name "$ROLE" \
    --policy-document "$TRUST" >/dev/null || { bad "Failed to update trust policy."; exit 1; }
  ok "Trust policy updated"
else
  aws iam create-role --profile "$PROFILE" --role-name "$ROLE" \
    --description "GitHub Actions deploys the C# platform API (deploy-platform-api.yml)" \
    --assume-role-policy-document "$TRUST" >/dev/null \
    || { bad "Failed to create the role."; exit 1; }
  ok "Role $ROLE created"
fi

aws iam put-role-policy --profile "$PROFILE" --role-name "$ROLE" \
  --policy-name "$POLICY" --policy-document "$PERMS" >/dev/null \
  || { bad "Failed to attach the permissions policy."; exit 1; }
ok "Inline policy $POLICY attached"

say ""
say "Verifying…"
SUBS="$(aws iam get-role --profile "$PROFILE" --role-name "$ROLE" \
        --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike' --output json)"
ACTIONS="$(aws iam get-role-policy --profile "$PROFILE" --role-name "$ROLE" --policy-name "$POLICY" \
        --query 'length(PolicyDocument.Statement)' --output text)"
ARN_OUT="$(aws iam get-role --profile "$PROFILE" --role-name "$ROLE" --query 'Role.Arn' --output text)"

say "  role arn : $ARN_OUT"
say "  trusts   : $SUBS"
say "  policy   : $ACTIONS statements"
say ""

if [[ "$SUBS" == *"refs/heads/main"* && "$ARN_OUT" == *"$ROLE" ]]; then
  ok "READY. The workflow's role-to-assume already points here:"
  say "      arn:aws:iam::${ACCOUNT}:role/${ROLE}"
  say ""
  say "  Nothing else to configure — no secrets to add to GitHub. Merge a change under"
  say "  services/Tims.Platform/ and the deploy runs itself. To prove it without a code change:"
  say "      gh workflow run 'Deploy platform API'"
  exit 0
fi

bad "Verification did not match. Inspect the values above."
exit 1
