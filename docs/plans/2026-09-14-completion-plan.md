# TIMS completion plan — C#/.NET 10

Date: 2026-09-14
Status: Proposed implementation sequence; not an approved scope change or delivery commitment.

## Outcome

Deliver the agreed TIMS employee-lifecycle application with its business backend on C#/.NET 10, React/Next.js frontend, and a separately defined AI boundary. Complete user journeys, production verification, database ownership and retirement of the TypeScript business backend are all part of completion.

The earlier 60% product / 40% migration figures are rough estimates, not acceptance measurements. Do not derive remaining calendar time from those percentages.

## Verified starting point

- API and workers target net10.0; the deployed commit's container uses ASP.NET 10.0.
- Production API image 5f083f0 is running; no C# source commits behind main 195b064a.
- C# backend flags enable reporting, 360, succession, nine-box, engagement, compensation/FX, DEI, team intelligence, billing reads, audit/access reviews and external-vendor surfaces. Flags alone do not prove complete browser journeys.
- Platform organizations, invitations reads, dashboard, monitoring reads, FIT and notifications have ports awaiting further cutover work.
- 359 tRPC procedures remain; 17 are retained in nominally migrated domains (#252).
- GitHub snapshot: 104 open issues (including 12 epics), 19 labeled blocked, 3 open PRs. Counts overlap and some issue descriptions are stale.
- Deployment automation PR #253 passes checks but requires review. PR #139 concerns nightly DB controls; PR #143 is WIP compensation cleanup.

## Provisional schedule and assumptions

These are planning ranges, not measured throughput estimates. All milestones run from kickoff, overlap, and must not be added together.

| Milestone | Target window | Meaning |
| --- | --- | --- |
| Auditable baseline and first fixes | Week 1 | Acceptance inventory, dependency map, security fixes started, deploy workflow reviewed |
| Hardened pilot on existing hybrid application | Weeks 3–5 | Critical customer journeys verified; known blocking security/delivery defects resolved; accepted exclusions recorded |
| Existing implemented scope fully on C# | Weeks 10–14 | Existing TS business capabilities ported, production-verified, ownership transferred and obsolete backend removed |
| Full agreed product scope | Weeks 16–24+ | Missing workflows, AI features, integrations and enterprise acceptance criteria delivered |

Assumes two experienced engineers working full time with AI assistance, independent review capacity, usable staging/test data, and owner/provider decisions answered within one business day. A single engineer should budget approximately 1.5–2 times these windows initially. AI sessions are not interchangeable with additional accountable engineers.

User clarification (2026-09-14): TIMS ATS is an independent application; tims.configuration.core stays separate and communicates through APIs. Team Suite absorption is not required. API integration and externally validated assessment norms cannot receive a reliable completion date before interface access and methodology are resolved. Required provider certification or procurement adds external lead time. If these are mandatory release criteria, they can extend the full-product window beyond 24 weeks.

Reforecast after two completed representative slices in the first two weeks. Measure engineering effort, elapsed review time, deployment time and acceptance failures separately.

## Sequence

### 1. Establish the actual release contract — first 2–3 days

- Convert architecture MVP and post-MVP acceptance criteria into one requirement register.
- For each requirement record implementation, frontend consumer, production routing, test evidence, ownership, blocker and release.
- Use states: unbuilt, implemented, deployed-disabled, enabled, acceptance-verified, legacy-retired.
- Reconcile stale issue bodies with merged commits and runtime evidence. Preserve intentional deferrals as decisions.
- Identify mandatory pilot workflows and distinguish them from full-platform requirements without silently dropping scope.
- Inventory TS jobs, scripts, seeds, exports, AI database dependencies and cross-domain readers before planning retirement.
- Start existing TIMS API integration discovery immediately: identify interfaces, auth/scopes, data ownership, synchronization and error handling. Do not import the legacy application.

Exit: every release requirement has an owner, acceptance test and dependency; percentage calculations use verified requirements, not file or issue counts.

### 2. Repair shared security and delivery controls — weeks 1–2

- #248: enforce in-organization notification targets across both implementations; prove cross-tenant denial.
- #239: define and enforce one impersonation contract for web and C#; test owner, impersonated and ordinary-user paths.
- #181: inspect and repair audit cancellation, trusted client IP and abuse controls.
- #218 / #217: implement truthful invitation delivery and the C# email boundary, including failure handling.
- Review #253, establish deploy permissions, then validate automatic delivery with a reviewed change.
- Review #139 and prove nightly DB controls execute and report failure.
- Validate MFA configuration across both stacks, provider availability and FX freshness detection (#235).

Exit: relevant behavioral tests pass, deployment is repeatable, and controls have observable failure signals.

### 3. Complete ports already implemented — weeks 2–4

- Prioritize read-only dashboard/monitoring surfaces to measure cutover throughput.
- Complete FIT and notification frontend integration and external writer inventories.
- Complete organization/invitation ports after email and provisioning prerequisites.
- Review each production enablement against the actual frontend/BFF routing; backend flags alone do not count.
- Resolve #252's residual procedures individually: port, remove proven unused functionality, or explicitly retain behind a named decision.
- Continue compensation/engagement ownership work only after all dependent readers and writers are accounted for.

Exit per domain: characterized behavior, reviewed C# implementation, parity/security tests, production verification, ownership disposition and TS removal.

### 4. Migrate complete business journeys — weeks 3–10

Use two implementation tracks after shared contracts are stable. Each engineer owns separate domains; serialize shared schema/auth/client-contract changes.

Track A — recruitment:
1. Vacancies and candidates.
2. Pipeline state machine and transitions.
3. Interviews, offers and candidate-to-employee handoff.
4. Assessments, candidate portal and remaining FIT dependencies.

Track B — platform and talent operations:
1. External API/PCA #250 with explicit scopes and tenant rules.
2. Users, organization settings, consent, feature flags and entitlements.
3. Onboarding, performance and learning.
4. Integration, billing, audit/export and remaining administrative procedures.

Deliver one complete vertical workflow at a time. Implement new backend-heavy features directly in C#; do not grow the TS business API. Security fixes shared by both live implementations are coordinated changes, not accidental parity divergence.

### 5. Finish missing product capabilities — weeks 4–18, overlapping

- Assessments: agreed test coverage, scoring/versioning, explainability, validated reference norms and proctoring requirements.
- Learning: course creation, media/quiz player, paths, prerequisites, completion and certifications.
- Talent/engagement: missing simulators, reminders, sentiment and action-plan follow-through.
- Exports: wire real generation into user-visible actions and verify files and access control.
- Integrations: calendars, external/PCA API, webhooks and at least the agreed HRIS connector.
- Billing: implement and verify the agreed metering/invoicing scope; Stripe live activation remains a separate recorded owner decision.
- Durable processing: deploy workers with retry, idempotency, failure visibility and agreed retention/notification jobs.
- AI: acceptance datasets and failure behavior for each required feature; agent registration is not completion.

Every item must be mapped to a requirement in step 1; this list is a starting inventory, not a substitute for the architecture acceptance register.

### 6. Consolidate and validate — weeks 10–24, by release

- Freeze the AI data-access boundary before removing packages/db; isolate any surviving Prisma dependencies explicitly.
- Remove tRPC, obsolete TS business services and Prisma only after their callers, jobs, seeds and data ownership are migrated.
- Regenerate and verify OpenAPI client contracts.
- Exercise all roles and tenant boundaries through complete browser/API workflows.
- Test realistic concurrent activity against an agreed workload and latency/error budget; calibrate capacity from measurements.
- Verify backup restoration, deployment rollback, worker recovery, monitoring and incident runbooks.
- Perform independent security review and customer acceptance for required modules.

Final exit: zero required workflows depend on the retired backend; all required acceptance criteria have current evidence; no unresolved release-blocking defect; operating procedures are tested.

## Delivery discipline

- Small domain-scoped PRs with implementation, meaningful tests and status updates together.
- Preserve C# golden parity/RLS/RBAC coverage after deleting the TS counterpart.
- Avoid a final bulk cutover: deploy and verify incrementally, with a documented reversal path before ownership retirement.
- Track remaining runtime-registered tRPC procedures, but never use that count alone as product completion.
- Weekly report: acceptance-verified requirements, retired procedures, defects, blocked days, forecast changes.
- Report implemented, production-enabled and acceptance-verified percentages separately.

## First week's concrete deliverables

1. Requirement register and dependency map reconciled with GitHub.
2. Reviewed fixes for notification targeting and impersonation, with tenant/role tests.
3. Deploy automation review and operational prerequisites resolved.
4. Invitation delivery design and initial implementation.
5. First representative C# cutover and measured cycle time.
6. Existing TIMS API and assessment-norm decisions/access tracked with owners.
