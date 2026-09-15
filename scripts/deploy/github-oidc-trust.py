#!/usr/bin/env python3
"""Build the narrowly pinned TIMS deploy trust after checking GitHub's live settings."""
import json
import sys

PREFIX = "repo:TIMSInternational@305569681/tims-ats@1301900745"
PROVIDER = "arn:aws:iam::747814092517:oidc-provider/token.actions.githubusercontent.com"


def main():
    try:
        settings = json.load(sys.stdin)
        if not isinstance(settings, dict) or not (
            settings.get("use_default") is True
            and settings.get("use_immutable_subject") is True
            and settings.get("sub_claim_prefix") == PREFIX
        ):
            raise ValueError("unexpected GitHub OIDC identity settings")
    except (ValueError, TypeError):
        print("Cannot verify the pinned TIMS GitHub OIDC identity; no trust policy produced.", file=sys.stderr)
        return 1
    json.dump({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Federated": PROVIDER},
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {"StringEquals": {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": f"{PREFIX}:ref:refs/heads/main",
            }},
        }],
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
