# Product and flow review — 2026-09-28

Scope: beta release candidate `codex/beta-release-candidate`. This is a current evidence inventory, not a claim that the full product is accepted. Subsequent fixes in this branch address careers search/pagination, roleless access, assessment readiness/reminders and registration copy; the release still requires deployment and live acceptance.

## Product contract

The product goal in `docs/PRODUCT-MAP.md` is the complete journey **vacancy → candidate → assessment → interview → offer → onboarding → performance → succession**, with platform-owner operations, eight organization roles, candidate self-service, integrations, and AI assistance. That document's June implementation percentages are obsolete. `docs/ROLE-EXPERIENCE-REBUILD-SPEC.md` defines role-specific navigation and landing experiences. `docs/plans/2026-09-14-acceptance-register.md` lists 99 extended requirements, but every row is still marked unverified; it is not a pass report. `docs/REMAINING-WORK.md` records the newer implementation and cutover state.

The beta scope should be narrower than the full HR platform: invite a customer organization, create and publish a vacancy, apply as a candidate, screen and assess, interview, issue and accept an offer, and start onboarding. Modules outside this chain should be hidden or shown with honest empty states until their data and actions work.

## Journey and evidence matrix

| Journey | Current evidence | Open validation or product gap |
| --- | --- | --- |
| Platform owner → organization → invitation → account | Invitation setup has unit, HTTP, Postgres/RLS and component tests. Existing-account local acceptance completed. Bulk invitation code only marks sent after provider acceptance. | PR #279 still needs review/deploy. Production .NET setup flags and service secret are not active. Fresh email receipt, password setup, recovery, sign-out/sign-in, expiry and revoke require a real-recipient canary. |
| Recruiter → vacancy approval → publication | Local browser test covered draft, approval and publication. New vacancies now create seven pipeline stages atomically. | Apply and verify historical stage backfill in production. Repeat on newly deployed code with each role. |
| Public careers → application → recruiter pipeline | Public form and duplicate submission were tested locally with non-production CAPTCHA bypass; candidate creation, assignment, stage move and interview scheduling were locally exercised. | Test real Turnstile on the production hostname and follow the candidate into the recruiter and candidate portals. Current test org has zero published vacancies, preventing a live preview application. |
| Assessment assignment → player → scoring → result | Player, consent, submission, scoring and portal behavior have dedicated tests. This branch rejects assignment/start of questionless assessments and makes reminders depend on real SES provider acceptance. | Demo seed has assessment types but no approved active questions. A real end-to-end assignment with approved battery, scoring rules and reference norms is not accepted. Proctoring capture, inference, evidence review and retention are not implemented. |
| Interview → scorecard → decision | Scheduling was exercised locally; interview and scorecard routes exist. | Verify participant roles, notification delivery, video provider, evidence capture and decision trail in a complete beta session. |
| Offer → candidate signature → employee conversion | Offer and conversion behavior has focused tests, including onboarding handoff. | Run a complete browser journey with a synthetic beta candidate, signature and approver, then inspect resulting employee/onboarding records. Do not count an offer UI alone as acceptance. |
| Onboarding → check-ins | Persisted plans, tasks and check-ins are implemented and tested; fabricated dashboard data was removed. | Course/access provisioning, document tracking, generated learning routes and export remain outside verified beta scope. |
| Platform operations and integration | .NET 10 API health/readiness and CI pass; synthetic backup/restore was performed. | Production backup credentials/control job, cross-tenant denial, role navigation, notification delivery, worker recovery, load test and `tims.configuration.core` API exchange remain unverified. |

Two additional navigation limits surfaced in source review: `manifestFor([])` used the base admin manifest, so a signed-in account with no recognized organization role could see admin-shaped navigation. The branch now shows a dashboard-only access-pending state without employee queries. The public vacancy API returns at most 50 items per request; the board now exposes cursor-based “load more” pagination so later openings remain reachable.

External integration review found the existing .NET 10 ExternalVendor assessment-read and validation-write routes working under 45 unit and 67 integration tests. The PCA/legacy export cannot safely read legacy people until ATS stores an authorized tenant-to-legacy-company binding. No such binding table exists; a tenant-supplied legacy company ID would be unsafe. The first implementation slice needs binding schema/RLS and platform-owner administration, then a dark bounded connector and per-record audit.

The preview's unauthenticated `/dashboard` redirects to login. The login panel's unverified “1,200 professionals” social-proof claim and fabricated avatar initials were removed. Company sign-up now enforces the same 12–128-character password range as invitation setup; it has a focused validation test. The Supabase production Site URL and email rate-limit configuration in issue #50 still require dashboard verification and a real reset email.

## UX defect reproduced and corrected

On the preview careers page for AgroVerde, six fixed “Explore by Area” buttons appeared despite zero vacancies. Clicking Engineering searched only vacancy titles; it did not filter a department. Search results were labelled “Featured Vacancies,” and the page duplicated the first three jobs in a second listing. The branch now uses one vacancy list, explicit search/no-result states, a clear-search action, a real search form supporting Enter, accurate field labels and mobile layout, and copy matching the actual title/location query. Category shortcuts are removed until actual organization departments can be queried.

## Release gates

1. Review, merge and deploy PR #279, then activate coordinated .NET invitation setup only after required backend configuration is present.
2. Run a synthetic first-company walkthrough with real email, production Turnstile, one published job, an assessment using approved scoring material, interview, offer and onboarding.
3. Verify each role's landing and navigation against the role spec, including 403-free permitted paths and cross-tenant denials.
4. Capture the outcome for each of the 99 acceptance-register rows as implemented, deployed, accepted, excluded from beta, or blocked; avoid a single overall completion percentage until this is done.
