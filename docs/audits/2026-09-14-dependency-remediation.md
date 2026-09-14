# Dependency security remediation — 2026-09-14

Release audit before this patch: **49 high, 2 critical, 20 moderate, 3 low**. Final full-workspace `pnpm audit --json`: **0 high, 0 critical, 5 moderate, 2 low**. No audit ignores, omitted dependency scopes or runtime-exposure exceptions were applied. This is the registry advisory result for the committed lockfile, not a claim that the application is vulnerability-free.

## Changes

| Dependency | Resolution |
|---|---|
| Next.js | Pin existing web dependency and auth development dependency to 15.5.24, retaining Next 15 |
| sharp | Next 15.5.24-scoped override to 0.35.4; patched Next explicitly accepts `^0.34.3 || ^0.35.3` |
| Vite 8 | 8.0.16 |
| brace-expansion | Preserve major lines: 1.1.18, 2.1.4, 5.0.9 |
| js-yaml 4 | 4.3.2 |
| fast-uri 3 | 3.1.6 |
| PostCSS 8 | 8.5.18 |
| nanoid 3 | 3.3.18 |
| browserslist 4 | 4.28.7 |
| xmldom 0.8 | 0.8.15 |
| jsondiffpatch | Override only `ai@4.3.19` dependency to patched 0.7.6 |
| Trigger SDK | Remove unused dependency from placeholder workers package; `workers/src/index.ts` has only a comment and repository search found no SDK consumers |

All versions were checked against official npm registry metadata before installation. Transitive overrides are scoped to affected version ranges rather than forcing unrelated major versions. Existing workers placeholder scripts remain; this does not implement or claim a working background processor.

The jsondiffpatch override is the deliberate pre-1.0 compatibility exception: AI 4's latest 4.3.19 pins vulnerable 0.6.0 and no fixed AI 4 patch exists. Its RSC server imports the namespace and calls `diff`; 0.7.6 preserves that public API. A local diff/patch nested-object/array roundtrip passed, along with AI tests. The upstream [prototype-pollution advisory](https://github.com/advisories/GHSA-j4fx-xxwh-2485) identifies 0.7.6 as fixed. Revisit this override when upgrading the AI SDK; no AI major-version migration was performed here.

pnpm 11 ignored the previous `package.json` `pnpm.overrides` field: the first install left vulnerable versions unchanged and the lockfile had no overrides section. Overrides now live in `pnpm-workspace.yaml`, including the preexisting OpenTelemetry API pin. `allowBuilds` settings are preserved. The regenerated lockfile contains the effective override section and removed the unused Trigger dependency tree.

## Verification

- Final `pnpm audit --json`: 0 high / 0 critical; audit exit code remains 1 because lower-severity advisories exist.
- API and web `tsc --noEmit`: passed.
- Vitest AI suite plus bulk invitation and notification security tests: **18 files, 86 tests passed**.
- ESLint homepage and changed platform relay/client files: passed after dependency changes.
- Native sharp 0.35.4 PNG encode/decode smoke: passed.
- jsondiffpatch 0.7.6 `diff` / `patch` roundtrip: passed.
- `git diff --check`: passed.

The parent task owns the final production build and broader release verification. No production deployment, external AI calls or real email sends were performed during these checks.

Remaining advisories: moderate uuid, PostCSS, OpenTelemetry core, Vitest and Vitest mocker; low AI SDK and provider-utils. These remain visible in the full audit and require follow-up rather than suppression.
