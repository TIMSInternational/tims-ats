# Compliance-by-Design Roadmap — SOC 1 Type II · SOC 2 Type II · ISO 27001:2022

Date: 2026-07-17 · Owner: NexaDev LLC (Federico Tafur, security owner) · Status: **Active.**
Directive (Federico 2026-07-17): the TIMS platform and ALL infrastructure we build MUST be fully compliant
with **SOC 1 Type II, SOC 2 Type II, and ISO 27001** — compliance-by-design, controls baked in as we build.

## 0. Framing (read first)
- **Type II = a clock.** Type II tests that controls *operated effectively over a window* (3–12 months) with
  retained evidence — history cannot be fabricated. So every control we turn on NOW starts accruing evidence.
- **~30% platform / ~70% organization.** This doc covers the ~30% we engineer (technical controls + automated
  evidence). The org program (policies, risk, vendor, HR-sec, IR, DR, training, mgmt review) is §5 — required,
  not code.
- **One crosswalked control set** satisfies all three (they overlap 70–85%). SOC 1 (SSAE 18) is scoped to
  controls over customers' **financial reporting** — we anchor its objectives on the **billing/invoices** domain
  (being migrated to C#) + comp/payroll data. SOC 2 = Trust Services Criteria (Security CC1–CC9 mandatory;
  Confidentiality + Availability selected). ISO 27001 = ISMS (clauses 4–10) + Annex A (93 controls / 4 themes)
  via a Statement of Applicability.
- **Decisions (Federico 2026-07-17):** all three in parallel; automation platform (Vanta/Drata) deferred but
  recommended; start baking controls NOW.
- **Prod DDL/secrets = Federico-run** (same as the C# migration). I author migrations/policies/tests + apply to
  Testcontainers/staging; Federico runs prod.

## 1. Control crosswalk → our stack (what maps where)
| Domain | SOC 2 | ISO A.* | Our stack — status |
|---|---|---|---|
| Tenant isolation / logical access | CC6.1 | 8.3, 8.20 | **Strong** — fail-closed Postgres RLS (`app_tenant` NOBYPASSRLS, `SET LOCAL` org GUC), Testcontainers-proven |
| Authorization | CC6.3 | 8.2 | **Strong** — RBAC module:action:scope, DB-checked grants, least-privilege, k-anon |
| Authentication / MFA | CC6.1 | 8.5 | **Gap** — Supabase JWT solid; `MFA_ENFORCED` decision OPEN → enforce (CB-2) |
| Audit logging | CC7.2 | 8.15 | **Partial** — `data_access_logs` append-only; needs immutability + broader events (**CB-1**) |
| Change management | CC8.1 | 8.32 | **Strong-ish** — PR + SDD + Codex/opus gates + dark-by-default flags + table-ownership ledger; **fix the admin-merge-past-CI bypass** (CB-4) |
| Cryptography / secrets | CC6.1 | 8.24 | **Strong** — secrets never logged, AWS Secrets Manager, gitleaks, TLS; add rotation policy |
| Data classification / confidentiality | C-series | 5.12 | **Good** — `FieldClassification`, explicit selects, PII handling; formalize retention/erasure (CB-6) |
| Vuln & patch mgmt | CC7.1 | 8.8 | **Partial** — lockfiles/pinned deps/Semgrep; add Dependabot + patch SLA + pen test (CB-5) |
| Monitoring / detection | CC7.2–7.3 | 8.16 | **Partial** — OTel + Sentry; add CloudTrail + GuardDuty + alerting (CB-3) |
| Config / IaC | CC7.1 | 8.9 | **Gap** — add Terraform/CDK, no click-ops (CB-4) |
| Availability / BC-DR | A-series | 5.29–5.30, 8.13 | **Gap** — Supabase PITR; add restore *tests* + DR runbook + scheduler HA (CB-7) |
| Access reviews / JML | CC6.2–6.3 | 5.18 | **Gap** — build users×roles×grants report + quarterly recert (CB-2) |
| Vendor / subprocessor | CC9.2 | 5.19–5.22 | **Gap** — register + DPAs (§5, org) |
| Physical | CC6.4 | 7.* | **Inherited** — AWS/Supabase SOC2/ISO (carve-out) + endpoint/MDM for staff (§5) |
| ISMS governance | CC1–CC5 | 4–10 | **Gap** — policy suite, risk register, SoA, internal audit, mgmt review (§5) |

## 2. Engineering control backlog (CB-N) — sequenced, SDD-built
Each CB is a vertical slice: design → TDD → fresh reviewer + Codex + opus gate → merge; prod DDL/secrets Federico-run.

- **CB-1 — Audit-log immutability + security-event coverage (IN PROGRESS).** Insert-only trigger + `REVOKE
  UPDATE/DELETE` on `data_access_logs` (carried G2 follow-up) so the audit trail is tamper-evident; extend the
  append-only writer to cover authN success/**failure**, authZ denials, admin/privileged actions, data exports,
  **feature-flag flips**, role/permission changes. (CC7.2 / A.8.15 / SOC 1 audit trail.) Design:
  `docs/architecture/compliance/cb-1-audit-immutability.md`.
- **CB-1b — `audit_logs` immutability (SHIPPED).** The twin of CB-1 for the admin/security-event trail (all 20
  `db.auditLog.create` sites) — it was fully mutable. Same reusable control + prod SQL
  (`2026-07-17-audit-logs-immutable.sql`, Federico-run). ⚠️ FK-cascade constraint documented (org/user hard
  delete blocked once immutable — safe today, no such path exists; FK-less refactor recommended follow-up).
  Design: `cb-1b-audit-logs-immutability.md`.
- **CB-1c — security-event COVERAGE.** Log the UNLOGGED events into the (now-immutable) trail, in the LIVE app:
  authN failures (`login_failed`), authZ denials (FORBIDDEN/UNAUTHORIZED throws in `trpc.ts`), `rolePermission`
  grant edits, feature-flag bulk ops, platform-owner cross-org reads/exports. Touches live auth/tRPC → own gate.
- **CB-2 — Identity assurance + access governance.** Enforce MFA (close `MFA_ENFORCED`; mandatory privileged);
  session/JWT lifetime + revocation; **access-review report** (users×roles×grants×last-login×deprovision) + a
  quarterly recertification workflow; JML deprovisioning SLA. (CC6.1–6.3 / A.8.5, A.5.18.)
- **CB-3 — Detection & centralized logging.** AWS CloudTrail (all API calls) + GuardDuty; ship app + audit logs
  to a central store with retention (90d hot / 1yr cold; 7yr audit); security alerting (failed-login spikes,
  privilege escalation, config change). (CC7.2–7.3 / A.8.15–8.16.)
- **CB-4 — Change mgmt hardening + IaC.** Fix the CI billing-trap so branch protection + required reviews PASS
  and are ENFORCED (stop admin-merging past CI — a real change-mgmt finding); Terraform/CDK for all AWS infra;
  audit feature-flag flips as approved change events. (CC8.1 / A.8.9, A.8.32.)
- **CB-5 — Vulnerability management.** Dependabot/Renovate + container (ECR) scanning + SAST (Semgrep) as
  blocking gates; documented patch SLA by severity; annual penetration test. (CC7.1 / A.8.8.)
- **CB-6 — Data governance & privacy.** Retention + deletion jobs (audit purge + customer-data erasure on
  offboarding — GDPR / Colombian Habeas Data / CCPA); data-classification enforcement + log masking (extend
  `FieldClassification`); DSR handling. (Privacy TSC / Confidentiality / A.5.34.)
- **CB-7 — Availability / BC-DR.** Automated backup **restore tests** (prove RTO/RPO, not just PITR); DR runbook
  + annual test; scheduler HA (single-replica Quartz → clustered ADO store). (A-series / A.5.30, A.8.13.)
- **CB-8 — Continuous compliance evidence.** RLS-isolation proofs + control tests as BLOCKING CI gates; evidence
  export hooks (automation-platform-agnostic) so Vanta/Drata (if adopted) can ingest. (CC4.1 / A.5.35–5.36.)

## 3. Sequencing
CB-1 → CB-2 → CB-3/CB-4 (parallel) → CB-5 → CB-6/CB-7 → CB-8. Interleave with the C# migration (each new C#
domain ships with its audit events, RLS proofs, and dark-by-default change control already wired). Start the
Type II observation window once CB-1..CB-4 are operating.

## 4. Federico-run (out of my hands)
Prod DDL (triggers, revokes, migrations) · prod secrets/rotation · AWS account config (CloudTrail/GuardDuty/IAM
SSO/MFA) · branch-protection settings + the CI billing fix · engaging an auditor/vCISO · signing DPAs.

## 5. Organizational program (required, NOT code — parallel track)
Policy suite (~15: infosec, access control, crypto, change mgmt, SDLC, incident response, BCP/DR, vendor, data
classification, retention, acceptable use, HR security, risk mgmt) · **risk assessment + register + ISO SoA** ·
asset inventory · **vendor/subprocessor register + DPAs** (Supabase, Vercel, AWS, Upstash, Stripe, Bedrock, SES,
ElevenLabs, Trigger.dev — inherit their SOC2/ISO via carve-out) · IR plan + tabletop · BCP/DR + annual test ·
security-awareness training · HR security (background checks, NDAs, JML) · annual pen test · internal audit +
management review · customer trust center + DPA template. Appoint security owner (Federico); consider a
fractional vCISO to run readiness + audit liaison.

## 6. Timeline (honest)
~3–6 mo to SOC 2 readiness/Type I; +3–6 mo observation → Type II. ISO 27001 ~6–12 mo to certification. SOC 1
Type II tracks SOC 2's window on the billing/comp scope. Building compliant-by-design NOW collapses the runway.

See also: [[tims-soc2-iso27001-compliance]] (memory), `docs/architecture/csharp-migration/` (the migration
whose new domains inherit these controls).
