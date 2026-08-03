---
paths:
  - '**'
---

# Cross-Model Verification

Every build phase gets an adversarial cross-model verification pass at its review gate, alongside the
per-slice reviewer and the opus whole-branch review (superpowers:subagent-driven-development). The
reviewer's job is to catch overstated or incorrect claims, cite `file:line`, and surface what was
missed — **honesty over agreement**.

Proven value (2026-06-30 perf analysis): Codex caught 2 overstated findings + 1 missed issue on its
first run.

## How to run it

```bash
bash scripts/verification/codex-review.sh [BASE_REF]     # defaults to origin/main
```

Also wired as **/gate check 15**.

| Exit | Meaning                                               |
| ---- | ----------------------------------------------------- |
| `0`  | Codex ran and raised no blocking findings             |
| `1`  | Codex ran and raised blocking findings                |
| `2`  | **Codex could not run** — verification did not happen |

**Exit 2 is not a pass.** It is precisely the state this rule previously failed to distinguish.

## Why a script instead of calling the CLI directly

> **The Codex CLI exits `0` when it is quota-blocked.**
>
> ```
> $ echo "Reply OK" | codex exec --sandbox read-only -
> ERROR: You've hit your usage limit ... try again at Aug 15th, 2026 11:44 PM.
> $ echo $?
> 0
> ```

Verified 2026-08-02. Any wrapper that trusts the exit code reads a refusal as a pass. The script
therefore inspects output for refusal signatures — quota, auth, network, empty response, missing
`VERDICT:` line — and fails closed on every one.

This is not hypothetical. Between 2026-07-22 and 2026-08-02 the gate did not run once and every build
reported green. **PRs #18, #19, #22, #24, #112 and #113 all merged without cross-model review** —
including #22 and #24, which were data-exposure security fixes, and #112, which changed RLS policies
on 76 production tables.

## Tier-2 fallback — when Codex is unavailable

Codex is **quota-blocked until 2026-08-15**. Until then exit 2 is expected, and the required
substitute is a **3-lens same-model adversarial panel**:

1. **Security / tenant-isolation** — data exposure, authz bypass, RLS, secrets, race conditions.
2. **Claim auditor** — take every claim in the commit messages and PR body and verify it against
   `file:line`. Overstated claims are the highest-value finding class, and the one a same-model
   reviewer is still reliably good at.
3. **Coverage** — what is missing: an untested path, an unhandled error, a doc that now contradicts
   the code.

Each lens must be prompted to **refute**, not confirm, and must re-read the source itself rather than
trusting the implementer's summary. This pattern produced 22 confirmed findings (0 rebutted) against
the ownership-flip runbook in #63.

**While the fallback is active, do not call this rule "cross-model."** It is same-model adversarial
review, which is weaker — it shares the original author's blind spots. Record in the PR body which
tier actually ran.

## Enforcement — what is and isn't real

- **/gate check 15** runs the script. A skipped or exit-2 result must be reported as ⚠️ NOT RUN,
  never as PASS.
- **CI job `verification-gate`** fails any PR whose body contains neither a `## Verification` section
  nor an explicit `Verification-waiver: <reason>` line. That does not prove a review happened — it
  makes an absent one visible in GitHub instead of buried in a session log.
- There is **no automated enforcement beyond those two.**

An earlier version of this rule claimed "Enforcement = build-gate + this rule". That was false:
`/gate` had no Codex check and neither CI workflow mentioned Codex. It also instructed dispatching a
`codex:codex-rescue` agent that is not installed in this environment. Both corrected 2026-08-02 (#38).
