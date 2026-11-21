#!/usr/bin/env bash
# Mark a workers image as DEPLOYED so the ECR lifecycle policy can never expire it.
#
# WHY: the repository keeps "the last 30 images", and ECR counts by PUSH time. Deciding before building
# (workers-deploy-decide.sh) keeps idle CI runs from pushing, but it cannot keep the running image among
# the newest 30: failed rolls leave newer images behind, and a manual rollback restores an OLDER image
# without refreshing its push time. Once 30 newer images exist, the running or rollback image becomes
# eligible for expiry, and ECS can no longer replace the task (tier-1 review of the workers deploy).
#
# The fix is explicit protection rather than an ordering invariant: every image a deploy rolls onto (and
# the image it rolls away from, the rollback target) gets an extra immutable tag `deployed-<tag>`. The
# lifecycle policy's priority-1 rule selects that prefix, and ECR never lets a lower-priority rule (the
# 30-image count) expire an image a higher-priority rule selected.
#
# Usage: workers-protect-image.sh <short-SHA tag>
# Inputs (environment): AWS_REGION, ECR_REPO; the AWS identity from the usual chain (AWS_PROFILE honoured).
# Idempotent: an image that already carries the tag is reported and accepted. Any other failure is fatal.
# Tested by tests/governance/workers-image-retention.test.ts (fake `aws` on PATH).
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}" "${ECR_REPO:?ECR_REPO is required}"
die() { echo "::error::workers-protect-image: $*" >&2; exit 1; }
command -v jq >/dev/null || die "jq not on PATH"

TAG="${1:-}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || die "not a commit short-SHA image tag: '$TAG'"
PROTECT_TAG="deployed-$TAG"

IMG="$(aws ecr batch-get-image --region "$AWS_REGION" --repository-name "$ECR_REPO" \
         --image-ids imageTag="$TAG" --output json)" \
  || die "cannot read $ECR_REPO:$TAG; the image is NOT protected."
MANIFEST="$(jq -er '.images[0].imageManifest' <<<"$IMG" 2>/dev/null)" \
  || die "$ECR_REPO:$TAG not found; the image is NOT protected."
MEDIA_TYPE="$(jq -er '.images[0].imageManifestMediaType' <<<"$IMG" 2>/dev/null)" \
  || die "$ECR_REPO:$TAG has no manifest media type; the image is NOT protected."

if OUT="$(aws ecr put-image --region "$AWS_REGION" --repository-name "$ECR_REPO" \
            --image-tag "$PROTECT_TAG" --image-manifest "$MANIFEST" \
            --image-manifest-media-type "$MEDIA_TYPE" --output json 2>&1)"; then
  echo "protected: $ECR_REPO:$TAG is also tagged $PROTECT_TAG"
elif grep -q 'ImageAlreadyExistsException' <<<"$OUT"; then
  echo "already protected: $ECR_REPO:$TAG carries $PROTECT_TAG"
else
  die "could not tag $ECR_REPO:$TAG as $PROTECT_TAG; the image is NOT protected. AWS said: $OUT"
fi
