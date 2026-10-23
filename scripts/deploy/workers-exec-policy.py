#!/usr/bin/env python3
"""Build the workers execution role's inline policy WITHOUT dropping grants the live policy already has.

create-workers-service.sh --apply runs on every manual roll and rollback, and used to replace the policy with
the DB-only baseline. An owner who had extended it (an HRIS secret, a KMS key for a customer-managed secret)
lost those grants on the next rollback while the task definition still referenced the secrets, so replacement
tasks failed secret injection (tier-1 review). The result is the baseline, with the secret-injection statement
widened to every secret the live statement already allowed, plus every other live statement kept verbatim.
A roll can add access; it never removes any. Narrowing it is a deliberate, separate IAM change.

Usage: workers-exec-policy.py <region> <account> <ecr-repo> <log-group> <db-secret-arn> [<live-policy.json>]
Prints the policy JSON. Tested by tests/governance/workers-exec-policy.test.ts.
"""
from __future__ import annotations

import json
import sys

SECRETS_SID = "InjectOnlyTheDbConnectionString"


def baseline(region: str, account: str, repo: str, log_group: str, db_secret: str) -> list[dict]:
    return [
        {"Sid": "EcrAuthTokenIsAccountWide", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
        {
            "Sid": "PullOnlyTheWorkersImage",
            "Effect": "Allow",
            "Action": ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
            "Resource": f"arn:aws:ecr:{region}:{account}:repository/{repo}",
        },
        {
            "Sid": "WriteOnlyTheWorkersLogs",
            "Effect": "Allow",
            "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
            "Resource": f"arn:aws:logs:{region}:{account}:log-group:{log_group}:*",
        },
        # Named for its origin; once an owner adds secrets it injects those too (see the module docstring).
        {"Sid": SECRETS_SID, "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": db_secret},
    ]


def as_list(value) -> list:
    return value if isinstance(value, list) else [value]


def merge(base: list[dict], live: dict | None) -> dict:
    ours = {s["Sid"] for s in base}
    statements = [dict(s) for s in base]
    if live:
        live_statements = as_list(live.get("Statement", []))
        secrets = statements[-1]
        resources = as_list(secrets["Resource"])
        for s in live_statements:
            if s.get("Sid") == SECRETS_SID:
                resources += [r for r in as_list(s.get("Resource", [])) if r not in resources]
        secrets["Resource"] = resources[0] if len(resources) == 1 else resources
        statements += [s for s in live_statements if s.get("Sid") not in ours]
    return {"Version": "2012-10-17", "Statement": statements}


def main(argv: list[str]) -> int:
    if len(argv) not in (6, 7):
        print(__doc__.split("Usage: ")[1].splitlines()[0], file=sys.stderr)
        return 2
    region, account, repo, log_group, db_secret = argv[1:6]
    live = None
    if len(argv) == 7:
        with open(argv[6], encoding="utf-8") as f:
            live = json.load(f)
        if not isinstance(live, dict) or "Statement" not in live:
            print("the live policy is not an IAM policy document", file=sys.stderr)
            return 1
    print(json.dumps(merge(baseline(region, account, repo, log_group, db_secret), live), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
