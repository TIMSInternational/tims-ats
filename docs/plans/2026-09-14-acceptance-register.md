# TIMS application acceptance register

Status: Initial inventory, 2026-09-14. Requirements below are copied from architecture §17; checkmarks in that source describe target acceptance, not verified completion. This inventory must be reconciled with later approved specifications and the full functional annexes before it is treated as exhaustive.

Implementation objective: C#/.NET 10 business backend; Next.js/React frontend; explicit AI boundary.

A requirement is complete only when its current C# implementation, production routing and end-to-end test evidence are linked. All rows begin **Unverified**; this does not mean all are unbuilt.

| ID | Phase | Area | Requirement | Evidence/status |
| --- | --- | --- | --- | --- |
| APP-001 | PHASE 1 | Module 1 — Attraction (enhanced) | Multichannel campaign manager: schedule, publish, and track across channels | Unverified; [source](<../TIMS ATS - Architecture.md#L1389>) |
| APP-002 | PHASE 1 | Module 1 — Attraction (enhanced) | Quality-of-Hire (QoH) by source: track which channels produce best hires | Unverified; [source](<../TIMS ATS - Architecture.md#L1390>) |
| APP-003 | PHASE 1 | Module 1 — Attraction (enhanced) | Cost per qualified candidate: ROI per channel and campaign | Unverified; [source](<../TIMS ATS - Architecture.md#L1391>) |
| APP-004 | PHASE 1 | Module 1 — Attraction (enhanced) | Inclusive language AI check: flag biased/exclusionary terms in vacancy descriptions | Unverified; [source](<../TIMS ATS - Architecture.md#L1392>) |
| APP-005 | PHASE 1 | Module 2 — Pipeline (enhanced) | Configurable SLA per stage (not just global): each client sets thresholds per stage | Unverified; [source](<../TIMS ATS - Architecture.md#L1395>) |
| APP-006 | PHASE 1 | Module 2 — Pipeline (enhanced) | Recruiter productivity metrics: candidates processed, avg time per stage, SLA compliance | Unverified; [source](<../TIMS ATS - Architecture.md#L1396>) |
| APP-007 | PHASE 1 | Module 2 — Pipeline (enhanced) | High-FIT at-risk highlights: surface top candidates stuck or at risk of dropping out | Unverified; [source](<../TIMS ATS - Architecture.md#L1397>) |
| APP-008 | PHASE 1 | Module 2 — Pipeline (enhanced) | Structured next-best-action per candidate: AI recommends next step based on pipeline state | Unverified; [source](<../TIMS ATS - Architecture.md#L1398>) |
| APP-009 | PHASE 1 | Module 5 — Communication (enhanced) | Candidate NPS per stage: survey after key touchpoints (application, assessment, interview) | Unverified; [source](<../TIMS ATS - Architecture.md#L1401>) |
| APP-010 | PHASE 1 | Module 5 — Communication (enhanced) | Consent tracking: granular opt-in/out for email, WhatsApp, SMS per candidate | Unverified; [source](<../TIMS ATS - Architecture.md#L1402>) |
| APP-011 | PHASE 1 | Module 5 — Communication (enhanced) | Bulk messaging with merge tags: personalized mass communication | Unverified; [source](<../TIMS ATS - Architecture.md#L1403>) |
| APP-012 | PHASE 1 | Module 5 — Communication (enhanced) | Chatbot human escalation: auto-escalate to recruiter when chatbot confidence is low | Unverified; [source](<../TIMS ATS - Architecture.md#L1404>) |
| APP-013 | PHASE 1 | Module 7 — Recruitment Analytics (enhanced) | Robust QoH scheduler: automated 30/60/90/180/365-day check-ins (lightweight, MVP version) | Unverified; [source](<../TIMS ATS - Architecture.md#L1407>) |
| APP-014 | PHASE 1 | Module 7 — Recruitment Analytics (enhanced) | Time-to-fill prediction: AI estimates days remaining based on pipeline velocity | Unverified; [source](<../TIMS ATS - Architecture.md#L1408>) |
| APP-015 | PHASE 1 | Module 7 — Recruitment Analytics (enhanced) | Long-term source quality: track QoH by source over time (not just volume) | Unverified; [source](<../TIMS ATS - Architecture.md#L1409>) |
| APP-016 | PHASE 1 | Module 7 — Recruitment Analytics (enhanced) | Recruiter audit: who moved whom, when, with what justification (full audit trail) | Unverified; [source](<../TIMS ATS - Architecture.md#L1410>) |
| APP-017 | PHASE 1 | Module 12 — Candidate Portal (enhanced) | Privacy controls: candidates can request data deletion (GDPR/Habeas Data compliance) | Unverified; [source](<../TIMS ATS - Architecture.md#L1413>) |
| APP-018 | PHASE 1 | Module 12 — Candidate Portal (enhanced) | Rejection feedback: configurable auto-feedback with personalized recommendations | Unverified; [source](<../TIMS ATS - Architecture.md#L1414>) |
| APP-019 | PHASE 1 | Module 12 — Candidate Portal (enhanced) | Professional development library: public resources, courses, tips for candidates | Unverified; [source](<../TIMS ATS - Architecture.md#L1415>) |
| APP-020 | PHASE 1 | Module 12 — Candidate Portal (enhanced) | Candidate NPS: post-process satisfaction survey | Unverified; [source](<../TIMS ATS - Architecture.md#L1416>) |
| APP-021 | PHASE 1 | Cross-cutting — DEI Fairness (partial, MVP) | Language bias detection in vacancy descriptions (AI-powered) | Unverified; [source](<../TIMS ATS - Architecture.md#L1419>) |
| APP-022 | PHASE 1 | Cross-cutting — DEI Fairness (partial, MVP) | Selection rate analysis by demographic group (4/5ths rule dashboard) | Unverified; [source](<../TIMS ATS - Architecture.md#L1420>) |
| APP-023 | PHASE 1 | Cross-cutting — DEI Fairness (partial, MVP) | AI decision audit log: every AI recommendation logged with rationale | Unverified; [source](<../TIMS ATS - Architecture.md#L1421>) |
| APP-024 | PHASE 1 | Cross-cutting — DEI Fairness (partial, MVP) | Fairness report: monthly auto-generated DEI snapshot for HR Admin | Unverified; [source](<../TIMS ATS - Architecture.md#L1422>) |
| APP-025 | PHASE 1 | Cross-cutting — Security & Sensitive Data (MVP) | RBAC matrix for sensitive data: who can see psychometric scores, medical docs, etc. | Unverified; [source](<../TIMS ATS - Architecture.md#L1425>) |
| APP-026 | PHASE 1 | Cross-cutting — Security & Sensitive Data (MVP) | Consent management: explicit consent tracking before collecting sensitive data | Unverified; [source](<../TIMS ATS - Architecture.md#L1426>) |
| APP-027 | PHASE 1 | Cross-cutting — Security & Sensitive Data (MVP) | Anonymization mode: view aggregate data without identifying individuals (for analytics) | Unverified; [source](<../TIMS ATS - Architecture.md#L1427>) |
| APP-028 | PHASE 1 | Cross-cutting — Security & Sensitive Data (MVP) | Psychometric audit trail: log every access to assessment results with viewer + timestamp | Unverified; [source](<../TIMS ATS - Architecture.md#L1428>) |
| APP-029 | PHASE 2 | Module 3 — Assessments (enhanced) | All 5 TIMS tests in MVP: PCA, MIL, Integrity, Personality, IE (not "at least 2") | Unverified; [source](<../TIMS ATS - Architecture.md#L1446>) |
| APP-030 | PHASE 2 | Module 3 — Assessments (enhanced) | Score normalization: standardized 0-100 scale across all assessment types | Unverified; [source](<../TIMS ATS - Architecture.md#L1447>) |
| APP-031 | PHASE 2 | Module 3 — Assessments (enhanced) | Model versioning: track which scoring model version produced each result | Unverified; [source](<../TIMS ATS - Architecture.md#L1448>) |
| APP-032 | PHASE 2 | Module 3 — Assessments (enhanced) | Critical proctoring alerts: real-time escalation for high-severity events (not just log) | Unverified; [source](<../TIMS ATS - Architecture.md#L1449>) |
| APP-033 | PHASE 2 | Module 3 — Assessments (enhanced) | Score explainability: AI-generated plain-language interpretation of each assessment result | Unverified; [source](<../TIMS ATS - Architecture.md#L1450>) |
| APP-034 | PHASE 2 | Module 9 — FIT Engine (enhanced) | Sub-scores visible: break FIT into dimensions (cognitive, personality, experience, etc.) | Unverified; [source](<../TIMS ATS - Architecture.md#L1453>) |
| APP-035 | PHASE 2 | Module 9 — FIT Engine (enhanced) | Hierarchical weights: org-level defaults → position family → specific vacancy overrides | Unverified; [source](<../TIMS ATS - Architecture.md#L1454>) |
| APP-036 | PHASE 2 | Module 9 — FIT Engine (enhanced) | Incomplete data rules: calculate partial FIT when not all assessments are complete | Unverified; [source](<../TIMS ATS - Architecture.md#L1455>) |
| APP-037 | PHASE 2 | Module 9 — FIT Engine (enhanced) | QoH recalibration: adjust FIT weights based on QoH outcomes (feedback loop) | Unverified; [source](<../TIMS ATS - Architecture.md#L1456>) |
| APP-038 | PHASE 3 | Module 6 — Interviews (enhanced) | Interview quality checker: rate interview quality (structured questions asked, evidence documented) | Unverified; [source](<../TIMS ATS - Architecture.md#L1474>) |
| APP-039 | PHASE 3 | Module 6 — Interviews (enhanced) | Evaluator bias analytics: compare inter-rater reliability, flag outlier scores | Unverified; [source](<../TIMS ATS - Architecture.md#L1475>) |
| APP-040 | PHASE 3 | Module 6 — Interviews (enhanced) | Required evidence per competency: enforce that evaluators provide behavioral evidence | Unverified; [source](<../TIMS ATS - Architecture.md#L1476>) |
| APP-041 | PHASE 3 | Module 6 — Interviews (enhanced) | Question-to-competency traceability: map every interview question to assessed competency | Unverified; [source](<../TIMS ATS - Architecture.md#L1477>) |
| APP-042 | PHASE 3 | Module 10 — Validations (enhanced) | Blocking vs non-blocking rules: define which validations must pass before hire vs. advisory | Unverified; [source](<../TIMS ATS - Architecture.md#L1480>) |
| APP-043 | PHASE 3 | Module 10 — Validations (enhanced) | Country-specific checklists: auto-load legal requirements based on company country | Unverified; [source](<../TIMS ATS - Architecture.md#L1481>) |
| APP-044 | PHASE 3 | Module 10 — Validations (enhanced) | External verifier roles: third-party verifiers submit results directly via secure portal | Unverified; [source](<../TIMS ATS - Architecture.md#L1482>) |
| APP-045 | PHASE 3 | Module 10 — Validations (enhanced) | Validation audit trail: full history of each check (who requested, who completed, when) | Unverified; [source](<../TIMS ATS - Architecture.md#L1483>) |
| APP-046 | PHASE 3 | Module 11 — Quality of Hire (enhanced) | QoH scheduler 30/60/90/180/365: automated check-ins with configurable survey templates | Unverified; [source](<../TIMS ATS - Architecture.md#L1486>) |
| APP-047 | PHASE 3 | Module 11 — Quality of Hire (enhanced) | Performance/engagement connection: correlate QoH scores with performance reviews (when available) | Unverified; [source](<../TIMS ATS - Architecture.md#L1487>) |
| APP-048 | PHASE 3 | Module 11 — Quality of Hire (enhanced) | Leader input: direct leader provides QoH input via simple survey | Unverified; [source](<../TIMS ATS - Architecture.md#L1488>) |
| APP-049 | PHASE 3 | Module 11 — Quality of Hire (enhanced) | Source effectiveness: rank recruitment sources by long-term QoH (not just hire count) | Unverified; [source](<../TIMS ATS - Architecture.md#L1489>) |
| APP-050 | PHASE 3 | Module 11 — Quality of Hire (enhanced) | QoH algorithm: weighted formula (performance + retention + cultural fit + leader satisfaction) | Unverified; [source](<../TIMS ATS - Architecture.md#L1490>) |
| APP-051 | PHASE 4 |  | Talent pool with smart search (filters + AI tags) returning results in <2s | Unverified; [source](<../TIMS ATS - Architecture.md#L1521>) |
| APP-052 | PHASE 4 |  | Re-engagement campaign sent to pooled candidates | Unverified; [source](<../TIMS ATS - Architecture.md#L1522>) |
| APP-053 | PHASE 4 |  | Recruitment funnel dashboard with real-time data | Unverified; [source](<../TIMS ATS - Architecture.md#L1523>) |
| APP-054 | PHASE 4 |  | Report builder generating PDF/Excel exports | Unverified; [source](<../TIMS ATS - Architecture.md#L1524>) |
| APP-055 | PHASE 4 |  | Source ROI report comparing cost-per-qualified-candidate across channels | Unverified; [source](<../TIMS ATS - Architecture.md#L1525>) |
| APP-056 | PHASE 5 |  | Onboarding plan auto-created from offer acceptance (30/60/90 day tasks) | Unverified; [source](<../TIMS ATS - Architecture.md#L1528>) |
| APP-057 | PHASE 5 |  | Digital document center with e-signature (contracts, NDA, policies) | Unverified; [source](<../TIMS ATS - Architecture.md#L1529>) |
| APP-058 | PHASE 5 |  | Buddy/mentor assignment functioning with notification | Unverified; [source](<../TIMS ATS - Architecture.md#L1530>) |
| APP-059 | PHASE 5 |  | Check-in surveys at 30/60/90 days with results visible to HRBP | Unverified; [source](<../TIMS ATS - Architecture.md#L1531>) |
| APP-060 | PHASE 5 |  | L&D route auto-generated from assessment gap analysis | Unverified; [source](<../TIMS ATS - Architecture.md#L1532>) |
| APP-061 | PHASE 5 |  | Onboarding completion rate dashboard | Unverified; [source](<../TIMS ATS - Architecture.md#L1533>) |
| APP-062 | PHASE 6 |  | OKR creation with hierarchical alignment (team → unit → company) | Unverified; [source](<../TIMS ATS - Architecture.md#L1536>) |
| APP-063 | PHASE 6 |  | OKR progress tracking with automated check-in reminders | Unverified; [source](<../TIMS ATS - Architecture.md#L1537>) |
| APP-064 | PHASE 6 |  | Video coaching session within platform with AI summary | Unverified; [source](<../TIMS ATS - Architecture.md#L1538>) |
| APP-065 | PHASE 6 |  | Coaching log with extracted commitments linked to OKRs | Unverified; [source](<../TIMS ATS - Architecture.md#L1539>) |
| APP-066 | PHASE 6 |  | Peer recognition (kudos) system with leaderboard | Unverified; [source](<../TIMS ATS - Architecture.md#L1540>) |
| APP-067 | PHASE 6 |  | Performance cycle: goal setting → mid-cycle → final review | Unverified; [source](<../TIMS ATS - Architecture.md#L1541>) |
| APP-068 | PHASE 7 |  | 360 evaluation cycle: configure evaluators, launch, collect, close | Unverified; [source](<../TIMS ATS - Architecture.md#L1544>) |
| APP-069 | PHASE 7 |  | Anonymous responses with configurable anonymity threshold | Unverified; [source](<../TIMS ATS - Architecture.md#L1545>) |
| APP-070 | PHASE 7 |  | Individual 360 report with heatmap and sentiment analysis | Unverified; [source](<../TIMS ATS - Architecture.md#L1546>) |
| APP-071 | PHASE 7 |  | Commitment tracker with evidence upload and escalation rules | Unverified; [source](<../TIMS ATS - Architecture.md#L1547>) |
| APP-072 | PHASE 7 |  | KPI dashboard per employee with progress tracking | Unverified; [source](<../TIMS ATS - Architecture.md#L1548>) |
| APP-073 | PHASE 7 |  | Nine Box 3x3 grid populated from performance + potential data | Unverified; [source](<../TIMS ATS - Architecture.md#L1549>) |
| APP-074 | PHASE 7 |  | Calibration session tool for committees | Unverified; [source](<../TIMS ATS - Architecture.md#L1550>) |
| APP-075 | PHASE 7 |  | Nine Box simulator ("what-if" scenarios) | Unverified; [source](<../TIMS ATS - Architecture.md#L1551>) |
| APP-076 | PHASE 8 |  | Course catalog with multimedia player (video, docs, quizzes) | Unverified; [source](<../TIMS ATS - Architecture.md#L1554>) |
| APP-077 | PHASE 8 |  | Learning paths with prerequisites and certifications | Unverified; [source](<../TIMS ATS - Architecture.md#L1555>) |
| APP-078 | PHASE 8 |  | Course completion tracked and linked to competency gaps | Unverified; [source](<../TIMS ATS - Architecture.md#L1556>) |
| APP-079 | PHASE 8 |  | Climate survey: create, distribute, collect, analyze with AI sentiment | Unverified; [source](<../TIMS ATS - Architecture.md#L1557>) |
| APP-080 | PHASE 8 |  | Pulse surveys (quick, recurring) with trend tracking | Unverified; [source](<../TIMS ATS - Architecture.md#L1558>) |
| APP-081 | PHASE 8 |  | Action plans from climate results with owner assignment and follow-up | Unverified; [source](<../TIMS ATS - Architecture.md#L1559>) |
| APP-082 | PHASE 8 |  | Team profile: competency balance radar, health score, composition simulator | Unverified; [source](<../TIMS ATS - Architecture.md#L1560>) |
| APP-083 | PHASE 8 |  | Ideal hire profile generated from team gaps | Unverified; [source](<../TIMS ATS - Architecture.md#L1561>) |
| APP-084 | PHASE 9 |  | Talent map: visual org chart with potential/performance overlay | Unverified; [source](<../TIMS ATS - Architecture.md#L1564>) |
| APP-085 | PHASE 9 |  | Succession plan per critical role with readiness indicators | Unverified; [source](<../TIMS ATS - Architecture.md#L1565>) |
| APP-086 | PHASE 9 |  | Salary bands by role family with equity analysis | Unverified; [source](<../TIMS ATS - Architecture.md#L1566>) |
| APP-087 | PHASE 9 |  | Compensation adjustment workflow with approval chain | Unverified; [source](<../TIMS ATS - Architecture.md#L1567>) |
| APP-088 | PHASE 9 |  | Full DEI dashboard: diversity metrics, pay equity, selection rate parity | Unverified; [source](<../TIMS ATS - Architecture.md#L1568>) |
| APP-089 | PHASE 9 |  | AI fairness audit: automated bias detection across all AI models | Unverified; [source](<../TIMS ATS - Architecture.md#L1569>) |
| APP-090 | PHASE 9 |  | Strategic monitoring dashboard: executive KPIs across all modules | Unverified; [source](<../TIMS ATS - Architecture.md#L1570>) |
| APP-091 | PHASE 9 |  | Executive narrative AI: auto-generated board-ready summaries | Unverified; [source](<../TIMS ATS - Architecture.md#L1571>) |
| APP-092 | PHASE 10 |  | REST API with OAuth2 + API key authentication | Unverified; [source](<../TIMS ATS - Architecture.md#L1574>) |
| APP-093 | PHASE 10 |  | Webhook system for event-driven integrations | Unverified; [source](<../TIMS ATS - Architecture.md#L1575>) |
| APP-094 | PHASE 10 |  | At least 1 HRIS connector (Workday or SAP) syncing employee data | Unverified; [source](<../TIMS ATS - Architecture.md#L1576>) |
| APP-095 | PHASE 10 |  | Billing: subscription plans, usage metering, Stripe invoicing | Unverified; [source](<../TIMS ATS - Architecture.md#L1577>) |
| APP-096 | PHASE 10 |  | Advanced audit log: searchable, filterable, exportable | Unverified; [source](<../TIMS ATS - Architecture.md#L1578>) |
| APP-097 | PHASE 10 |  | Consent management portal: employees manage their data preferences | Unverified; [source](<../TIMS ATS - Architecture.md#L1579>) |
| APP-098 | PHASE 10 |  | Data migration toolkit: CSV/JSON import with validation and rollback | Unverified; [source](<../TIMS ATS - Architecture.md#L1580>) |
| APP-099 | PHASE 10 |  | Power BI embed (optional) for custom reporting | Unverified; [source](<../TIMS ATS - Architecture.md#L1581>) |

## Active implementation wave

| Work | Owner | Status | Exit evidence |
| --- | --- | --- | --- |
| #248 notification recipient tenant validation | Notification agent | Implemented locally, not deployed | TS + .NET behavioral tenant tests |
| #239 impersonation transport and containment | Impersonation agent | Implemented locally, not deployed | Signed identity/cookie + BFF behavioral tests |
| #181 audit integrity | Audit agent | Partial hardening implemented; follow-ups open | Audit failure/abuse tests |
| #218 truthful bulk invitation delivery | Coordinator | Implemented locally, not deployed | Mock-provider failure and success tests; no real email sent |
| #253 automatic deployment | Coordinator | Existing PR, review required | CI and deployment validation |

## Blockers carried forward

- Live Stripe activation remains previously declined; no billing activation inferred from general completion authorization.
- User clarified that tims.configuration.core remains a separate system. Integration needs its API contract/access; source absorption is out of scope.
- External assessment reference norms require the approved battery/methodology.
- Production email, migrations and cutovers require their actual gates; test doubles are not delivery evidence.
