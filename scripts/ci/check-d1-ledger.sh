#!/usr/bin/env bash
# D-1 ledger check: a PR labelled `d1-exception` must name the C# port issue it pays into.
#
# The survival rule bars new feature code in packages/api (scheduled for deletion). Owner decision
# D-1 allows a narrow exception for the launch spine and security fixes; this check makes every such
# exception carry a ledger line so the port issue can later find the TS code it must also carry.
#
# Inputs, ONLY through env (never interpolated into this script by the workflow):
#   PR_LABELS_JSON  toJSON(github.event.pull_request.labels.*.name), e.g. ["bug","d1-exception"]
#   BODY            the PR body
#
# Contract (pinned by tests/governance/d1-ledger-check.test.ts):
#   - no `d1-exception` label             -> exit 0 (not applicable)
#   - labelled, body has a line           -> exit 0
#       Port-issue: #NN
#       Port-issue: https://github.com/TIMSInternational/tims-ats/issues/NN
#     where NN is a port issue: 74-101, or 250 (the external.ts port, filed after the range).
#   - anything else                       -> ::error:: and exit 1
# A prose mention ("see #90") does not count; the key must start its own line.
set -euo pipefail

LABEL='d1-exception'
REPO_ISSUES='https://github.com/TIMSInternational/tims-ats/issues/'

labels="${PR_LABELS_JSON:-[]}"
body="${BODY:-}"

# Exact element match inside the JSON array: the label must be a whole quoted string bounded by
# `[`, `,` or `]`, so a lookalike such as `d1-exception-pending` does not trigger the check.
if ! grep -qE '(^|[[,])[[:space:]]*"d1-exception"[[:space:]]*(,|]|$)' <<<"$labels"; then
  echo "Not labelled '${LABEL}': D-1 ledger check not applicable."
  exit 0
fi

is_port_issue() {
  local n=$((10#$1))
  if { [ "$n" -ge 74 ] && [ "$n" -le 101 ]; } || [ "$n" -eq 250 ]; then
    return 0
  fi
  return 1
}

found=''
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  shopt -s nocasematch
  if [[ "$line" =~ ^[[:space:]]*port-issue:[[:space:]]*(.*[^[:space:]])[[:space:]]*$ ]]; then
    ref="${BASH_REMATCH[1]}"
    shopt -u nocasematch
    num=''
    if [[ "$ref" =~ ^#([0-9]{1,6})$ ]]; then
      num="${BASH_REMATCH[1]}"
    elif [[ "$ref" == "${REPO_ISSUES}"* ]]; then
      rest="${ref#"$REPO_ISSUES"}"
      if [[ "$rest" =~ ^([0-9]{1,6})/?$ ]]; then
        num="${BASH_REMATCH[1]}"
      fi
    fi
    if [ -n "$num" ] && is_port_issue "$num"; then
      found="#$((10#$num))"
      break
    fi
  fi
  shopt -u nocasematch
done <<<"$body"

if [ -n "$found" ]; then
  echo "D-1 exception ledgered against port issue ${found}."
  exit 0
fi

echo "::error::PR is labelled '${LABEL}' but its body has no valid 'Port-issue:' line."
echo ""
echo "A D-1 exception adds code to packages/api, which is scheduled for deletion. Name the C# port"
echo "issue that will now also have to carry it, on its own line:"
echo ""
echo "  Port-issue: #90"
echo ""
echo "Valid port issues: #74-#101, or #250. A prose mention elsewhere in the body does not count."
exit 1
