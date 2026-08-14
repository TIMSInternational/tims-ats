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
> ERROR: You've hit your usage limit ... try again at Sep 9th, 2026 ...
> $ echo $?
> 0
> ```

Exit-0-on-refusal behavior verified 2026-08-02 (the refusal then said "Aug 15th, 2026"; the live CLI
now says "Sep 9th, 2026" — this date has slipped repeatedly and is read from live CLI output, not
authoritative). Any wrapper that trusts the exit code reads a refusal as a pass. The script
therefore inspects output for refusal signatures — quota, auth, network, empty response, missing
`VERDICT:` line — and fails closed on every one.

This is not hypothetical. Between 2026-07-22 and 2026-08-02 the gate did not run once and every build
reported green. **PRs #18, #19, #22, #24, #112 and #113 all merged without cross-model review** —
including #22 and #24, which were data-exposure security fixes, and #112, which changed RLS policies
on 76 production tables.

## Tier 2 — OmniRoute (still genuinely cross-model)

Codex is **quota-blocked until 2026-09-09** ("Sep 9th, 2026" per the live CLI refusal — a date that
has slipped repeatedly and is read from CLI output, not authoritative). Rather than dropping straight
to same-model review,
`scripts/verification/crossmodel-review.sh` tries a second **different-vendor** model first, via a
locally-run [OmniRoute](https://github.com/diegosouzapw/OmniRoute) gateway (MIT, self-hosted,
`localhost:20128`, no cloud hop).

```bash
npm i -g omniroute && omniroute      # Dashboard → Providers: add an upstream
export OMNIROUTE_KEY=...             # Dashboard → Endpoints (optional; a fresh install serves unauthenticated)
export OMNIROUTE_MODEL=oc/deepseek-v4-flash-free   # REQUIRED — see below. List yours:
                                     #   curl -s http://localhost:20128/v1/models | jq -r '.data[].id'
bash scripts/verification/crossmodel-review.sh
```

The script **refuses an Anthropic `OMNIROUTE_MODEL`** and exits 2 rather than quietly downgrading —
silently weakening a control is the exact failure this issue was about.

### `OMNIROUTE_MODEL` is required, and has no default (2026-08-05)

It used to default to **`auto/best-coding`**, and that quietly voided the guarantee above.

`auto/best-coding` is not a model, it is a **router**: the gateway chooses an upstream per request. So the
Anthropic check was validating a string that names no vendor. Probed on 2026-08-05, it resolved to
`"model":"big-pickle"` — an opaque codename attributable to nobody — while the same gateway's catalogue
included `aug/opus4.8`, `tllm/CLAUDE_4_6_SONNET` and friends, any of which the router could legitimately
have picked.

**Consequence for the record:** reviews run under that default — including **PR #130** and **#135** — were
performed by _a different reviewer_, but cannot be shown to have been _a different vendor_. They still found
real defects. Do not restate them as cross-model-verified.

Two further holes closed at the same time:

- **`fable` was missing from the Anthropic pattern.** Fable 5 is an Anthropic model (`claude-fable-5`) and
  its alias contains none of `claude|anthropic|sonnet|opus|haiku`. The gateway serves `aug/fable-5`, which
  the old pattern accepted as a valid cross-model reviewer.
- **The response's `model` field was never read.** The script reported the _requested_ string as the
  reviewer's identity. It now reports what actually served the request, and **hard-fails if that is
  positively Anthropic**. An unattributable codename is surfaced but not failed — rejecting those would
  reject most of this gateway's catalogue, and that is a judgement for whoever sets the variable.

Two caveats before enabling it:

- **The upstream provider receives the full diff.** That is a subprocessor decision for a SOC-2 scoped
  platform — cf. #40, which is open for precisely this omission. GitHub Models is the cleanest choice,
  since GitHub is already a processor for this repo.
- OmniRoute is MIT and self-hosted, but **~6 months old with ~590 open issues**. Scoped here to
  reviewing diffs only, deliberately — not as a general request router.

## Tier 3 — same-model panel, when no cross-model reviewer is available

If both tiers above exit 2, the required substitute is a **3-lens same-model adversarial panel**:

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
