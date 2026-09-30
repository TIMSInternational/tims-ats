#!/usr/bin/env python3
"""Build an App Runner source-configuration that changes ONLY the container image.

Usage:  python3 apprunner-image-payload.py <describe-service.json> <new-image-identifier> <out.json>

Shared by `.github/workflows/deploy-platform-api.yml` (roll forward) and
`.github/workflows/rollback-platform-api.yml` (roll back), so both directions pass through the
exact same guard.

WHY: `aws apprunner update-service` takes a FULL source-configuration map and DROPS every env key
the map omits. On this service that is 26 keys and 22 live `Platform__*Enabled` flags, so a
partial or hand-written map takes ~13 production surfaces dark with no error. The payload is
therefore derived from the LIVE config (describe-service output) by copying it and replacing ONLY
/ImageRepository/ImageIdentifier.

WHAT THE DIFF CHECK IS (and is not): `after` is a deepcopy of `before` with one assignment, so on the
current code the structural diff below cannot find anything but that one change. It does NOT verify
the file the workflow later sends — nothing re-reads payload.json. It is a TRIPWIRE against future
edits to THIS script (a new field, a normalization, a dropped key), which would make it fire. The
checks that can fail on today's inputs are the repository, unchanged-image and zero-env-var ones.

Refuses (exit 1, nothing written) when:
  - the payload would differ in anything other than the image identifier;
  - the new image equals the running one (nothing to do — a no-op update is not a deploy);
  - the new image points at a different repository than the running one;
  - the live config carries zero runtime env vars.
"""
import copy
import json
import sys


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def repo_of(image: str) -> str:
    # "<registry>/<repo>:<tag>" -> "<registry>/<repo>". Digests (@sha256:) are not used here.
    if "@" in image:
        fail(f"Digest-pinned image identifiers are not supported: {image}")
    head, sep, _tag = image.rpartition(":")
    if not sep or "/" not in head:
        fail(f"Unparseable image identifier: {image}")
    return head


def diff(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"ADDED {path}/{k}")
            elif k not in b:
                out.append(f"REMOVED {path}/{k}")
            else:
                out.extend(diff(a[k], b[k], f"{path}/{k}"))
    elif a != b:
        out.append(f"CHANGED {path}")
    return out


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: apprunner-image-payload.py <live.json> <new-image> <out.json>")
    live_path, new_image, out_path = sys.argv[1:4]

    try:
        with open(live_path, encoding="utf-8") as fh:
            svc = json.load(fh)["Service"]
        before = svc["SourceConfiguration"]
        current_image = before["ImageRepository"]["ImageIdentifier"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        fail(f"Cannot read the live service configuration: {exc!r}")

    if repo_of(new_image) != repo_of(current_image):
        fail(f"New image repository {repo_of(new_image)} differs from the running {repo_of(current_image)}.")

    after = copy.deepcopy(before)
    after["ImageRepository"]["ImageIdentifier"] = new_image
    # Tripwire (see docstring): can only fire if this function is edited to change more than the image.
    diffs = diff(before, after)

    ic = after["ImageRepository"].get("ImageConfiguration", {})
    n_env = len(ic.get("RuntimeEnvironmentVariables", {}) or {})
    n_sec = len(ic.get("RuntimeEnvironmentSecrets", {}) or {})
    print(f"current image: {current_image}")
    print(f"new image:     {new_image}")
    print(f"payload: {len(diffs)} diff(s), {n_env} env vars, {n_sec} secrets")
    for d in diffs:
        print("  " + d)

    if not diffs:
        fail("The service already runs this image. Nothing to deploy.")
    if diffs != ["CHANGED /ImageRepository/ImageIdentifier"]:
        fail("Payload changes more than the image identifier. Refusing to deploy.")
    if n_env == 0:
        fail("Payload carries zero env vars — that would darken every live surface.")

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(after, fh, indent=2)


if __name__ == "__main__":
    main()
