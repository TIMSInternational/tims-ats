---
paths:
  - "**"
---
# Cross-Model Verification (Codex)

Every build phase gets an adversarial **Codex** cross-model verification pass at its review gate,
alongside the per-slice reviewer and the opus whole-branch review (superpowers:subagent-driven-development).
Dispatch the `codex:codex-rescue` agent; instruct it to catch overstated/incorrect claims, cite file:line,
and surface what was missed — honesty over agreement. Enforcement = build-gate + this rule (NOT the hard
per-turn `--enable-review-gate`). Proven (2026-06-30 perf analysis): Codex caught 2 overstated findings +
1 missed issue on its first run.
