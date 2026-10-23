#!/usr/bin/env python3
"""Build the next workers task definition from the LIVE one: swap the image, keep everything else.

Used by create-workers-service.sh when the service already exists (the manual deploy AND rollback path).
Rebuilding the definition from the script's defaults instead (FX on, HRIS off, no extra env or secret
references) meant a rollback silently re-enabled a job the owner had disabled and dropped any custom
cron setting or HRIS secret reference (tier-1 review). Only the overrides the caller passed EXPLICITLY
(--fx-refresh / --hris-sync, and task.cpu / task.memory from WORKERS_CPU / WORKERS_MEMORY) are applied on
top of the live configuration; anything not passed keeps its live value.

Usage: workers-next-td.py <live-td.json> <out.json> <container> <image> [NAME=VALUE ...]
Tested by tests/governance/workers-image-retention.test.ts.
"""
import json
import sys

READ_ONLY = (
    "taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
    "registeredAt", "registeredBy", "deregisteredAt",
)
ALLOWED_OVERRIDES = {"Workers__FxRefreshEnabled", "Workers__HrisSyncEnabled"}
# Task-level sizing (Fargate units: cpu 256..16384, memory MiB). ECS rejects an invalid cpu/memory pair at
# registration, before anything changes, so only the shape is checked here.
TASK_OVERRIDES = {"task.cpu": "cpu", "task.memory": "memory"}


def main(argv: list[str]) -> int:
    if len(argv) < 5:
        print("usage: workers-next-td.py <live-td.json> <out.json> <container> <image> [NAME=VALUE ...]", file=sys.stderr)
        return 2
    src, dst, container, image, *overrides = argv[1:]
    with open(src, encoding="utf-8") as f:
        td = json.load(f)
    for key in READ_ONLY:
        td.pop(key, None)
    matches = [c for c in td.get("containerDefinitions", []) if c.get("name") == container]
    if len(matches) != 1:
        print(f"container {container} not found exactly once in the live task definition", file=sys.stderr)
        return 1
    c = matches[0]
    c["image"] = image
    env = c.setdefault("environment", [])
    for item in overrides:
        name, sep, value = item.partition("=")
        if sep and name in TASK_OVERRIDES:
            if not value.isdigit() or not 128 <= int(value) <= 122880:
                print(f"refusing override '{item}'", file=sys.stderr)
                return 2
            td[TASK_OVERRIDES[name]] = value
            continue
        if not sep or name not in ALLOWED_OVERRIDES or value not in ("true", "false"):
            print(f"refusing override '{item}'", file=sys.stderr)
            return 2
        for entry in env:
            if entry.get("name") == name:
                entry["value"] = value
                break
        else:
            env.append({"name": name, "value": value})
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(td, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
