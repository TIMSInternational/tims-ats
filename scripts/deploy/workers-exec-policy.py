#!/usr/bin/env python3
"""Build the workers execution role's inline policy WITHOUT dropping grants the live policy already has.

create-workers-service.sh --apply runs on every manual roll and rollback, and used to replace the policy with
the DB-only baseline. An owner who had extended it (an HRIS secret, a KMS key for a customer-managed secret)
lost those grants on the next rollback while the task definition still referenced the secrets, so replacement
tasks failed secret injection (tier-1 review).

Nothing is merged or rewritten: every live statement is kept EXACTLY (its Effect, Action, Resource and
Condition), and a baseline statement is added only when the live policy does not already contain it verbatim.
A baseline statement whose Sid an edited live statement already uses is added under `<Sid>Baseline`. The
result is the union of the live policy and the baseline: a roll can restore a baseline grant, but it never
removes, narrows, or loosens anything an owner wrote. Narrowing is a deliberate, separate IAM change.

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
        {"Sid": SECRETS_SID, "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": db_secret},
    ]


def as_list(value) -> list:
    return value if isinstance(value, list) else [value]


def same_grant(a: dict, b: dict) -> bool:
    """Equal Effect, Action and Resource (order-insensitive) and equal Condition (absent counts as none)."""
    def norm(s: dict) -> tuple:
        return (
            s.get("Effect"),
            tuple(sorted(as_list(s.get("Action", [])))),
            tuple(sorted(as_list(s.get("Resource", [])))),
            json.dumps(s.get("Condition"), sort_keys=True),
        )
    return norm(a) == norm(b)


def union(base: list[dict], live: dict | None) -> dict:
    if not live:
        return {"Version": "2012-10-17", "Statement": base}
    statements = [s for s in as_list(live.get("Statement", []))]
    sids = {s.get("Sid") for s in statements}
    for b in base:
        if any(same_grant(b, s) for s in statements):
            continue
        sid = b["Sid"]
        while sid in sids:
            sid += "Baseline"
        statements.append({**b, "Sid": sid})
        sids.add(sid)
    return {"Version": live.get("Version", "2012-10-17"), "Statement": statements}


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
    print(json.dumps(union(baseline(region, account, repo, log_group, db_secret), live), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
