# TIMS ATS — Full API Specification (tRPC)

> **Status**: DRAFT v1.0
> **Date**: 2026-05-30
> **Stack**: tRPC 11 + Prisma 6 + Supabase Auth
> **Base URL**: `/api/trpc`
> **Auth**: Supabase JWT in httpOnly cookie, validated in tRPC middleware
> **Tenant isolation**: RLS via `SET LOCAL app.current_org_id` on every query

---

## Middleware Chain (every procedure)

```
1. auth()        → Validate JWT, resolve user + org + roles
2. rls(orgId)    → SET LOCAL for tenant isolation
3. permission()  → Check role has module:action:scope
4. audit()       → Log sensitive data access (optional, per procedure)
5. handler()     → Execute business logic
```

## Permission Format

```
module:action:scope
e.g. vacancy:create:organization
```

Scopes: `own` | `team` | `unit` | `company` | `organization`

---

## Table of Contents

1. [auth](#1-auth)
2. [organization](#2-organization)
3. [user](#3-user)
4. [vacancy](#4-vacancy)
5. [pipeline](#5-pipeline)
6. [candidate](#6-candidate)
7. [assessment](#7-assessment)
8. [interview](#8-interview)
9. [offer](#9-offer)
10. [onboarding](#10-onboarding)
11. [performance](#11-performance)
12. [learning](#12-learning)
13. [ninebox](#13-ninebox)
14. [succession](#14-succession)
15. [teamIntel](#15-teamintel)
16. [engagement](#16-engagement)
17. [dei](#17-dei)
18. [compensation](#18-compensation)
19. [monitoring](#19-monitoring)
20. [integration](#20-integration)
21. [audit](#21-audit)
22. [billing](#22-billing)
23. [featureFlag](#23-featureflag)
24. [portal](#24-portal)

---

## 1. auth

> Handles authentication sync, session info, and user context.
> **No permission required** — public or self-scoped.

| #   | Procedure             | Type     | Input                                                       | Output                                           | Permission    | Used By         |
| --- | --------------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------ | ------------- | --------------- |
| 1.1 | `auth.syncUser`       | mutation | `{ supabaseUserId, email, firstName?, lastName?, avatar? }` | `{ user, roles[], organizationId } \| null`      | public        | Post-login hook |
| 1.2 | `auth.getSessionInfo` | query    | —                                                           | `{ user, organization, roles[], permissions[] }` | authenticated | Every page load |
| 1.3 | `auth.logout`         | mutation | —                                                           | `{ success }`                                    | authenticated | Navbar          |
| 1.4 | `auth.updatePassword` | mutation | `{ currentPassword, newPassword }`                          | `{ success }`                                    | authenticated | Settings        |
| 1.5 | `auth.enableMfa`      | mutation | —                                                           | `{ qrCodeUrl, secret }`                          | authenticated | Settings        |
| 1.6 | `auth.verifyMfa`      | mutation | `{ code }`                                                  | `{ success }`                                    | authenticated | Settings        |

---

## 2. organization

> Org hierarchy: Organization > Company > BusinessUnit > Team.
> **super_admin only** for write ops. Read available to all authenticated.

| #    | Procedure                | Type     | Input                                                                 | Output                              | Permission          | Used By               |
| ---- | ------------------------ | -------- | --------------------------------------------------------------------- | ----------------------------------- | ------------------- | --------------------- |
| 2.1  | `org.getCurrent`         | query    | —                                                                     | `Organization` with companies       | authenticated       | Admin shell, settings |
| 2.2  | `org.update`             | mutation | `{ name?, slug?, domain?, logo?, settings?, billingEmail? }`          | `Organization`                      | organization:update | Super admin settings  |
| 2.3  | `org.listCompanies`      | query    | —                                                                     | `Company[]` with units              | authenticated       | Org tree, filters     |
| 2.4  | `org.createCompany`      | mutation | `{ name, country, currency, timezone, language, legalName?, taxId? }` | `Company`                           | organization:create | Super admin           |
| 2.5  | `org.updateCompany`      | mutation | `{ id, ...partial }`                                                  | `Company`                           | organization:update | Super admin           |
| 2.6  | `org.deleteCompany`      | mutation | `{ id }`                                                              | `{ success }`                       | organization:delete | Super admin           |
| 2.7  | `org.listBusinessUnits`  | query    | `{ companyId }`                                                       | `BusinessUnit[]` with teams         | authenticated       | Org tree, filters     |
| 2.8  | `org.createBusinessUnit` | mutation | `{ name, companyId, code?, parentId? }`                               | `BusinessUnit`                      | organization:create | Super admin           |
| 2.9  | `org.updateBusinessUnit` | mutation | `{ id, ...partial }`                                                  | `BusinessUnit`                      | organization:update | Super admin           |
| 2.10 | `org.listTeams`          | query    | `{ businessUnitId }`                                                  | `Team[]` with leader + members      | authenticated       | Org tree, filters     |
| 2.11 | `org.createTeam`         | mutation | `{ name, businessUnitId, leaderId? }`                                 | `Team`                              | organization:create | Super admin           |
| 2.12 | `org.updateTeam`         | mutation | `{ id, ...partial }`                                                  | `Team`                              | organization:update | Super admin           |
| 2.13 | `org.getOrgTree`         | query    | —                                                                     | Nested `Company > Unit > Team` tree | authenticated       | Org chart, filters    |

---

## 3. user

> User management, roles, invitations.
> Write ops require `user:create/update/delete`.

| #    | Procedure            | Type     | Input                                                                      | Output                          | Permission          | Used By          |
| ---- | -------------------- | -------- | -------------------------------------------------------------------------- | ------------------------------- | ------------------- | ---------------- |
| 3.1  | `user.me`            | query    | —                                                                          | `User` with roles, teams        | authenticated       | Profile, navbar  |
| 3.2  | `user.updateProfile` | mutation | `{ firstName?, lastName?, phone?, avatar?, locale?, timezone? }`           | `User`                          | authenticated (own) | Profile settings |
| 3.3  | `user.list`          | query    | `{ cursor?, limit?, search?, roleSlug?, companyId?, unitId?, isActive? }`  | `{ users[], nextCursor? }`      | user:read           | User management  |
| 3.4  | `user.getById`       | query    | `{ id }`                                                                   | `User` with roles, teams        | user:read           | User detail      |
| 3.5  | `user.create`        | mutation | `{ email, firstName, lastName, roleSlug, companyId?, unitId?, jobTitle? }` | `User`                          | user:create         | Invite user      |
| 3.6  | `user.update`        | mutation | `{ id, ...partial }`                                                       | `User`                          | user:update         | Edit user        |
| 3.7  | `user.deactivate`    | mutation | `{ id }`                                                                   | `{ success }`                   | user:delete         | Deactivate user  |
| 3.8  | `user.reactivate`    | mutation | `{ id }`                                                                   | `{ success }`                   | user:update         | Reactivate user  |
| 3.9  | `user.assignRole`    | mutation | `{ userId, roleSlug, companyScope?, unitScope? }`                          | `UserRole`                      | user:update         | Role assignment  |
| 3.10 | `user.removeRole`    | mutation | `{ userId, roleId }`                                                       | `{ success }`                   | user:update         | Role removal     |
| 3.11 | `user.listRoles`     | query    | —                                                                          | `Role[]` with permission counts | user:read           | Role management  |
| 3.12 | `user.bulkInvite`    | mutation | `{ users: { email, firstName, lastName, roleSlug }[] }`                    | `{ created, failed[] }`         | user:create         | Bulk invite      |

---

## 4. vacancy

> Job requisitions, publishing, AI-generated descriptions.
> Screens: #1 Command Center, #4 Job Requisition Workspace, #8 Analytics

| #    | Procedure                        | Type     | Input                                                                                    | Output                                                     | Permission      | Used By                      |
| ---- | -------------------------------- | -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------- | ---------------------------- |
| 4.1  | `vacancy.list`                   | query    | `{ cursor?, limit?, status?, companyId?, unitId?, search?, assignedTo? }`                | `{ vacancies[], nextCursor?, counts }`                     | vacancy:read    | Command center, vacancy list |
| 4.2  | `vacancy.getById`                | query    | `{ id }`                                                                                 | `Vacancy` with profile, stages, candidates count, SLA      | vacancy:read    | Vacancy workspace            |
| 4.3  | `vacancy.create`                 | mutation | `{ title, companyId, unitId, teamId?, description?, positions, priority, salary?, ... }` | `Vacancy`                                                  | vacancy:create  | New vacancy wizard           |
| 4.4  | `vacancy.update`                 | mutation | `{ id, ...partial }`                                                                     | `Vacancy`                                                  | vacancy:update  | Edit vacancy                 |
| 4.5  | `vacancy.close`                  | mutation | `{ id, reason }`                                                                         | `Vacancy`                                                  | vacancy:update  | Close vacancy                |
| 4.6  | `vacancy.freeze`                 | mutation | `{ id, reason }`                                                                         | `Vacancy`                                                  | vacancy:update  | Freeze vacancy               |
| 4.7  | `vacancy.duplicate`              | mutation | `{ id }`                                                                                 | `Vacancy`                                                  | vacancy:create  | Clone vacancy                |
| 4.8  | `vacancy.submitForApproval`      | mutation | `{ id }`                                                                                 | `Vacancy`                                                  | vacancy:update  | Approval flow                |
| 4.9  | `vacancy.approve`                | mutation | `{ id, comment? }`                                                                       | `Vacancy`                                                  | vacancy:approve | Approval flow                |
| 4.10 | `vacancy.reject`                 | mutation | `{ id, reason }`                                                                         | `Vacancy`                                                  | vacancy:approve | Approval flow                |
| 4.11 | `vacancy.generateDescription`    | mutation | `{ id }`                                                                                 | `{ description, inclusivityScore }`                        | vacancy:update  | AI description writer        |
| 4.12 | `vacancy.checkInclusiveLanguage` | mutation | `{ text }`                                                                               | `{ score, suggestions[] }`                                 | vacancy:read    | AI inclusivity check         |
| 4.13 | `vacancy.getJobProfile`          | query    | `{ id }`                                                                                 | `JobProfile` with DISC targets, competencies, PCA expected | vacancy:read    | JCA profile tab              |
| 4.14 | `vacancy.updateJobProfile`       | mutation | `{ vacancyId, discTargets, competencies[], pcaExpected, milExpected }`                   | `JobProfile`                                               | vacancy:update  | Edit JCA profile             |
| 4.15 | `vacancy.listChannels`           | query    | `{ vacancyId }`                                                                          | `Channel[]` with stats                                     | vacancy:read    | Publication channels         |
| 4.16 | `vacancy.publish`                | mutation | `{ vacancyId, channels[] }`                                                              | `{ published[] }`                                          | vacancy:update  | Publish to channels          |
| 4.17 | `vacancy.unpublish`              | mutation | `{ vacancyId, channelId }`                                                               | `{ success }`                                              | vacancy:update  | Unpublish                    |
| 4.18 | `vacancy.getStats`               | query    | `{ vacancyId }`                                                                          | `{ applicants, conversion, avgDays, sla }`                 | vacancy:read    | Vacancy dashboard            |
| 4.19 | `vacancy.getApprovalChain`       | query    | `{ vacancyId }`                                                                          | `ApprovalStep[]`                                           | vacancy:read    | Approval flow                |
| 4.20 | `vacancy.getDashboardKpis`       | query    | `{ period? }`                                                                            | `{ open, critical, expired, frozen, byCountry, byUnit }`   | vacancy:read    | Command center               |

---

## 5. pipeline

> Kanban board, stage management, candidate movements.
> Screens: #2 Pipeline Board, #1 Command Center

| #    | Procedure                     | Type     | Input                                               | Output                                 | Permission      | Used By              |
| ---- | ----------------------------- | -------- | --------------------------------------------------- | -------------------------------------- | --------------- | -------------------- |
| 5.1  | `pipeline.getBoard`           | query    | `{ vacancyId }`                                     | `Stage[]` with candidates, counts, SLA | pipeline:read   | Kanban board         |
| 5.2  | `pipeline.listStages`         | query    | `{ vacancyId }`                                     | `Stage[]` with config, SLA, checklist  | pipeline:read   | Stage management     |
| 5.3  | `pipeline.createStage`        | mutation | `{ vacancyId, name, order, slaHours?, checklist? }` | `Stage`                                | pipeline:update | Configure stages     |
| 5.4  | `pipeline.updateStage`        | mutation | `{ id, name?, order?, slaHours?, checklist? }`      | `Stage`                                | pipeline:update | Edit stage           |
| 5.5  | `pipeline.deleteStage`        | mutation | `{ id }`                                            | `{ success }`                          | pipeline:update | Remove stage         |
| 5.6  | `pipeline.moveCandidate`      | mutation | `{ applicationId, toStageId, reason? }`             | `StageMovement`                        | pipeline:update | Drag-drop / advance  |
| 5.7  | `pipeline.bulkMove`           | mutation | `{ applicationIds[], toStageId, reason? }`          | `{ moved, failed[] }`                  | pipeline:update | Bulk advance         |
| 5.8  | `pipeline.rejectCandidate`    | mutation | `{ applicationId, reason, feedback? }`              | `Application`                          | pipeline:update | Reject from pipeline |
| 5.9  | `pipeline.getMovementHistory` | query    | `{ applicationId }`                                 | `StageMovement[]`                      | pipeline:read   | Candidate timeline   |
| 5.10 | `pipeline.getStageChecklist`  | query    | `{ applicationId, stageId }`                        | `ChecklistItem[]`                      | pipeline:read   | Stage checklist      |
| 5.11 | `pipeline.updateChecklist`    | mutation | `{ applicationId, stageId, itemId, completed }`     | `ChecklistItem`                        | pipeline:update | Complete checklist   |
| 5.12 | `pipeline.getSlaStatus`       | query    | `{ vacancyId? }`                                    | `SlaAlert[]`                           | pipeline:read   | SLA alerts           |
| 5.13 | `pipeline.getNextBestAction`  | query    | `{ applicationId }`                                 | `{ action, reason, confidence }`       | pipeline:read   | AI next-best-action  |
| 5.14 | `pipeline.getFunnel`          | query    | `{ vacancyId?, period? }`                           | `{ stage, count, conversion }[]`       | pipeline:read   | Funnel chart         |

---

## 6. candidate

> Candidate profiles, applications, documents, search.
> Screens: #3 Candidate 360, #9 Talent Pool CRM

| #    | Procedure                      | Type     | Input                                                                                  | Output                                                                                | Permission       | Used By                   |
| ---- | ------------------------------ | -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------- | ------------------------- |
| 6.1  | `candidate.list`               | query    | `{ cursor?, limit?, search?, poolType?, fitMin?, fitMax?, tags[], source?, skills[] }` | `{ candidates[], nextCursor?, total }`                                                | candidate:read   | Talent pool, search       |
| 6.2  | `candidate.getById`            | query    | `{ id }`                                                                               | `Candidate` with profile, applications, assessments, documents, timeline, tags, risks | candidate:read   | Candidate 360             |
| 6.3  | `candidate.create`             | mutation | `{ firstName, lastName, email, phone?, source, vacancyId? }`                           | `Candidate`                                                                           | candidate:create | Add candidate             |
| 6.4  | `candidate.update`             | mutation | `{ id, ...partial }`                                                                   | `Candidate`                                                                           | candidate:update | Edit candidate            |
| 6.5  | `candidate.uploadDocument`     | mutation | `{ candidateId, type, file }`                                                          | `Document`                                                                            | candidate:update | Upload CV/docs            |
| 6.6  | `candidate.deleteDocument`     | mutation | `{ documentId }`                                                                       | `{ success }`                                                                         | candidate:update | Remove document           |
| 6.7  | `candidate.parseCV`            | mutation | `{ candidateId, documentId }`                                                          | `{ parsed: CvData }`                                                                  | candidate:update | AI CV parser              |
| 6.8  | `candidate.addTag`             | mutation | `{ candidateId, tag }`                                                                 | `CandidateTag`                                                                        | candidate:update | Tag candidate             |
| 6.9  | `candidate.removeTag`          | mutation | `{ candidateId, tagId }`                                                               | `{ success }`                                                                         | candidate:update | Remove tag                |
| 6.10 | `candidate.pool.addToPool`     | mutation | `{ candidateId, poolType }`                                                            | `{ success }`                                                                         | candidate:update | Add to talent pool        |
| 6.11 | `candidate.getTimeline`        | query    | `{ candidateId }`                                                                      | `TimelineEvent[]`                                                                     | candidate:read   | Activity timeline         |
| 6.12 | `candidate.apply`              | mutation | `{ candidateId, vacancyId }`                                                           | `Application`                                                                         | candidate:create | Apply to vacancy          |
| 6.13 | `candidate.getRisks`           | query    | `{ candidateId }`                                                                      | `Risk[]`                                                                              | candidate:read   | Risk flags                |
| 6.14 | `candidate.getRecommendations` | query    | `{ candidateId }`                                                                      | `{ vacancies[] }`                                                                     | candidate:read   | AI vacancy match          |
| 6.15 | `candidate.search`             | query    | `{ query, filters? }`                                                                  | `{ candidates[], total }`                                                             | candidate:read   | Global search             |
| 6.16 | `candidate.merge`              | mutation | `{ primaryId, duplicateId }`                                                           | `Candidate`                                                                           | candidate:update | Merge duplicates          |
| 6.17 | `candidate.pool.getPoolStats`  | query    | —                                                                                      | `{ active, passive, historic, internal, exEmployee, total }`                          | candidate:read   | Talent pool KPIs          |
| 6.18 | `candidate.bulkTag`            | mutation | `{ candidateIds[], tag }`                                                              | `{ tagged }`                                                                          | candidate:update | Bulk tag                  |
| 6.19 | `candidate.pool.export`        | mutation | `{ format: 'csv', poolType?, tags? }`                                                  | `{ csv, count, truncated, format: 'csv' }`                                            | candidate:read   | Export talent pool as CSV |

---

## 7. assessment

> Tests (PCA, MIL, Integrity, Personality, IE), results, proctoring.
> Screens: #3 Candidate 360 (results tab), Assessment Player (portal)

| #    | Procedure                        | Type     | Input                                              | Output                                  | Permission        | Used By              |
| ---- | -------------------------------- | -------- | -------------------------------------------------- | --------------------------------------- | ----------------- | -------------------- |
| 7.1  | `assessment.listTypes`           | query    | —                                                  | `AssessmentType[]`                      | assessment:read   | Assessment config    |
| 7.2  | `assessment.assign`              | mutation | `{ candidateId, vacancyId, assessmentTypes[] }`    | `Assignment[]`                          | assessment:create | Assign tests         |
| 7.3  | `assessment.bulkAssign`          | mutation | `{ candidateIds[], vacancyId, assessmentTypes[] }` | `{ assigned, failed[] }`                | assessment:create | Bulk assign          |
| 7.4  | `assessment.getResults`          | query    | `{ candidateId, vacancyId? }`                      | `AssessmentResult[]` with scores, norms | assessment:read   | Candidate 360        |
| 7.5  | `assessment.getResultDetail`     | query    | `{ resultId }`                                     | `AssessmentResult` full breakdown       | assessment:read   | Score detail         |
| 7.6  | `assessment.listPending`         | query    | `{ vacancyId?, candidateId? }`                     | `Assignment[]` pending                  | assessment:read   | Command center       |
| 7.7  | `assessment.cancel`              | mutation | `{ assignmentId }`                                 | `{ success }`                           | assessment:update | Cancel assignment    |
| 7.8  | `assessment.resend`              | mutation | `{ assignmentId }`                                 | `{ success }`                           | assessment:update | Resend invitation    |
| 7.9  | `assessment.getProctoringEvents` | query    | `{ sessionId }`                                    | `ProctoringEvent[]`                     | assessment:read   | Proctoring review    |
| 7.10 | `assessment.flagProctoring`      | mutation | `{ sessionId, severity, reason }`                  | `ProctoringFlag`                        | assessment:update | Flag suspicious      |
| 7.11 | `assessment.getExplainability`   | query    | `{ resultId }`                                     | `{ explanation }`                       | assessment:read   | AI score explanation |
| 7.12 | `assessment.compare`             | query    | `{ candidateIds[], vacancyId }`                    | `ComparisonMatrix`                      | assessment:read   | Candidate comparison |

---

## 8. interview

> Scheduling, scorecards, video, AI coaching, bias detection.
> Screens: #6 Interview Central

| #    | Procedure                        | Type     | Input                                                                                  | Output                                              | Permission       | Used By              |
| ---- | -------------------------------- | -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------- | -------------------- |
| 8.1  | `interview.list`                 | query    | `{ vacancyId?, candidateId?, date?, status? }`                                         | `Interview[]`                                       | interview:read   | Interview list       |
| 8.2  | `interview.getById`              | query    | `{ id }`                                                                               | `Interview` with evaluators, scorecard, guide       | interview:read   | Interview central    |
| 8.3  | `interview.schedule`             | mutation | `{ candidateId, vacancyId, evaluatorIds[], datetime, duration, type }`                 | `Interview`                                         | interview:create | Schedule             |
| 8.4  | `interview.reschedule`           | mutation | `{ id, datetime, reason }`                                                             | `Interview`                                         | interview:update | Reschedule           |
| 8.5  | `interview.cancel`               | mutation | `{ id, reason }`                                                                       | `{ success }`                                       | interview:update | Cancel               |
| 8.6  | `interview.getScorecard`         | query    | `{ interviewId, evaluatorId? }`                                                        | `Scorecard` with competency ratings                 | interview:read   | Scorecard panel      |
| 8.7  | `interview.submitScorecard`      | mutation | `{ interviewId, ratings: { competencyId, score, evidence }[], recommendation, notes }` | `Scorecard`                                         | interview:update | Submit evaluation    |
| 8.8  | `interview.getGuide`             | query    | `{ interviewId }`                                                                      | `{ questions[], competencies[], candidateGaps[] }`  | interview:read   | AI interview guide   |
| 8.9  | `interview.generateSummary`      | mutation | `{ interviewId }`                                                                      | `{ summary, keyPoints[], strengths[], concerns[] }` | interview:update | AI summary           |
| 8.10 | `interview.detectBias`           | query    | `{ interviewId }`                                                                      | `{ alerts[], interRaterReliability }`               | interview:read   | Bias detection       |
| 8.11 | `interview.compareEvaluators`    | query    | `{ interviewId }`                                                                      | `EvaluatorComparison[]`                             | interview:read   | Evaluator comparison |
| 8.12 | `interview.getVideoToken`        | query    | `{ interviewId }`                                                                      | `{ token, sessionId }`                              | interview:read   | Zoom Video SDK       |
| 8.13 | `interview.saveTranscript`       | mutation | `{ interviewId, transcript }`                                                          | `{ success }`                                       | interview:update | Save transcript      |
| 8.14 | `interview.listToday`            | query    | —                                                                                      | `Interview[]` for today                             | interview:read   | Command center       |
| 8.15 | `interview.getPendingScorecards` | query    | —                                                                                      | `Interview[]` without completed scorecard           | interview:read   | Command center       |

---

## 9. offer

> Offer creation, approval chain, pre-employment validations, e-signature.
> Screens: #7 Offer Validation Center

| #    | Procedure                  | Type     | Input                                                                         | Output                                                 | Permission    | Used By              |
| ---- | -------------------------- | -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------- | -------------------- |
| 9.1  | `offer.list`               | query    | `{ status?, vacancyId? }`                                                     | `Offer[]` with candidate, status                       | offer:read    | Offer list           |
| 9.2  | `offer.getById`            | query    | `{ id }`                                                                      | `Offer` with details, approvals, validations, timeline | offer:read    | Offer center         |
| 9.3  | `offer.create`             | mutation | `{ candidateId, vacancyId, salary, startDate, benefits?, contractType, ... }` | `Offer`                                                | offer:create  | Create offer         |
| 9.4  | `offer.update`             | mutation | `{ id, ...partial }`                                                          | `Offer`                                                | offer:update  | Edit offer           |
| 9.5  | `offer.submitForApproval`  | mutation | `{ id }`                                                                      | `Offer`                                                | offer:update  | Start approval chain |
| 9.6  | `offer.approve`            | mutation | `{ id, comment? }`                                                            | `Offer`                                                | offer:approve | Approve step         |
| 9.7  | `offer.reject`             | mutation | `{ id, reason }`                                                              | `Offer`                                                | offer:approve | Reject offer         |
| 9.8  | `offer.send`               | mutation | `{ id, method }`                                                              | `{ success }`                                          | offer:update  | Send to candidate    |
| 9.9  | `offer.getApprovalChain`   | query    | `{ offerId }`                                                                 | `ApprovalStep[]`                                       | offer:read    | Approval flow        |
| 9.10 | `offer.listValidations`    | query    | `{ offerId }`                                                                 | `Validation[]` with status                             | offer:read    | Pre-hire checks      |
| 9.11 | `offer.updateValidation`   | mutation | `{ validationId, status, result?, notes? }`                                   | `Validation`                                           | offer:update  | Complete check       |
| 9.12 | `offer.uploadMedical`      | mutation | `{ offerId, file }`                                                           | `MedicalDocument`                                      | offer:update  | Upload medical       |
| 9.13 | `offer.analyzeMedical`     | mutation | `{ documentId }`                                                              | `{ analysis, risks[], recommendation }`                | offer:update  | AI medical analyzer  |
| 9.14 | `offer.getLegalChecklist`  | query    | `{ offerId }`                                                                 | `LegalCheckItem[]` by country                          | offer:read    | Country checklist    |
| 9.15 | `offer.updateLegalCheck`   | mutation | `{ checkId, completed }`                                                      | `LegalCheckItem`                                       | offer:update  | Complete check       |
| 9.16 | `offer.generateEsignature` | mutation | `{ offerId }`                                                                 | `{ signUrl }`                                          | offer:update  | OpenSign e-sig       |
| 9.17 | `offer.convertToEmployee`  | mutation | `{ offerId }`                                                                 | `User`                                                 | offer:update  | Hire transition      |
| 9.18 | `offer.getPending`         | query    | —                                                                             | `Offer[]` pending action                               | offer:read    | Command center       |

---

## 10. onboarding

> 30/60/90 plans, tasks, check-ins, document collection.
> Screens: #10 Onboarding Dashboard

| #     | Procedure                          | Type     | Input                                            | Output                                                                | Permission        | Used By              |
| ----- | ---------------------------------- | -------- | ------------------------------------------------ | --------------------------------------------------------------------- | ----------------- | -------------------- |
| 10.1  | `onboarding.list`                  | query    | `{ status?, phase?, search? }`                   | `OnboardingPlan[]` with progress                                      | onboarding:read   | Onboarding list      |
| 10.2  | `onboarding.getById`               | query    | `{ id }`                                         | `Plan` with tasks, documents, check-ins, courses, risks               | onboarding:read   | Onboarding detail    |
| 10.3  | `onboarding.create`                | mutation | `{ userId, templateId?, buddyId?, startDate }`   | `OnboardingPlan`                                                      | onboarding:create | Start onboarding     |
| 10.4  | `onboarding.updatePlan`            | mutation | `{ id, ...partial }`                             | `OnboardingPlan`                                                      | onboarding:update | Edit plan            |
| 10.5  | `onboarding.listTasks`             | query    | `{ planId, responsible? }`                       | `Task[]` by phase + responsible                                       | onboarding:read   | Task view            |
| 10.6  | `onboarding.createTask`            | mutation | `{ planId, title, responsible, phase, dueDate }` | `Task`                                                                | onboarding:create | Add task             |
| 10.7  | `onboarding.updateTask`            | mutation | `{ taskId, completed?, notes? }`                 | `Task`                                                                | onboarding:update | Complete task        |
| 10.8  | `onboarding.getTasksByResponsible` | query    | `{ responsible? }`                               | `{ rrhh, leader, ti, buddy, employee }` with progress                 | onboarding:read   | Tasks by responsible |
| 10.9  | `onboarding.listDocuments`         | query    | `{ planId }`                                     | `Document[]` with status                                              | onboarding:read   | Document list        |
| 10.10 | `onboarding.requestDocument`       | mutation | `{ planId, documentType }`                       | `Document`                                                            | onboarding:update | Request doc          |
| 10.11 | `onboarding.getCheckIns`           | query    | `{ planId }`                                     | `CheckIn[]` (day1, week1, day30, day60, day90)                        | onboarding:read   | Check-in calendar    |
| 10.12 | `onboarding.completeCheckIn`       | mutation | `{ checkInId, notes, score? }`                   | `CheckIn`                                                             | onboarding:update | Complete check-in    |
| 10.13 | `onboarding.getRiskScore`          | query    | `{ planId }`                                     | `{ score, factors[] }`                                                | onboarding:read   | Risk indicator       |
| 10.14 | `onboarding.getLearningRoute`      | query    | `{ planId }`                                     | `Course[]` from PCA gaps                                              | onboarding:read   | L&D route            |
| 10.15 | `onboarding.getDashboardKpis`      | query    | —                                                | `{ active, completionRate, pendingDocs, atRisk, avgTimeToFirstGoal }` | onboarding:read   | Dashboard KPIs       |

---

## 11. performance

> OKRs, KPIs, coaching sessions, feedback, recognition.
> Screens: #11 Performance, OKR & Coaching

| #     | Procedure                             | Type     | Input                                       | Output                                                                              | Permission         | Used By          |
| ----- | ------------------------------------- | -------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ | ---------------- |
| 11.1  | `performance.listOkrs`                | query    | `{ userId?, teamId?, period?, status? }`    | `OKR[]` with key results, progress                                                  | performance:read   | OKR table        |
| 11.2  | `performance.getOkrById`              | query    | `{ id }`                                    | `OKR` with key results, updates                                                     | performance:read   | OKR detail       |
| 11.3  | `performance.createOkr`               | mutation | `{ userId, title, period, keyResults[] }`   | `OKR`                                                                               | performance:create | Create OKR       |
| 11.4  | `performance.updateOkr`               | mutation | `{ id, ...partial }`                        | `OKR`                                                                               | performance:update | Edit OKR         |
| 11.5  | `performance.updateKeyResult`         | mutation | `{ id, currentValue, notes? }`              | `KeyResult`                                                                         | performance:update | Update progress  |
| 11.6  | `performance.listCoachingSessions`    | query    | `{ userId?, leaderId?, upcoming? }`         | `CoachingSession[]`                                                                 | coaching:read      | Coaching list    |
| 11.7  | `performance.createCoachingSession`   | mutation | `{ employeeId, datetime, topic, type }`     | `CoachingSession`                                                                   | coaching:create    | Schedule session |
| 11.8  | `performance.completeCoachingSession` | mutation | `{ id, notes, commitments[] }`              | `CoachingSession`                                                                   | coaching:update    | Complete session |
| 11.9  | `performance.listCommitments`         | query    | `{ userId?, status? }`                      | `Commitment[]`                                                                      | commitment:read    | Commitment log   |
| 11.10 | `performance.createCommitment`        | mutation | `{ employeeId, description, dueDate }`      | `Commitment`                                                                        | commitment:create  | New commitment   |
| 11.11 | `performance.updateCommitment`        | mutation | `{ id, status, notes? }`                    | `Commitment`                                                                        | commitment:update  | Update status    |
| 11.12 | `performance.submitFeedback`          | mutation | `{ toUserId, type, message, isAnonymous? }` | `Feedback`                                                                          | performance:create | Give feedback    |
| 11.13 | `performance.listFeedback`            | query    | `{ userId?, type? }`                        | `Feedback[]`                                                                        | performance:read   | Feedback feed    |
| 11.14 | `performance.giveRecognition`         | mutation | `{ toUserId, category, message }`           | `Recognition`                                                                       | performance:create | Kudos            |
| 11.15 | `performance.listRecognitions`        | query    | `{ userId?, limit? }`                       | `Recognition[]`                                                                     | performance:read   | Recognition wall |
| 11.16 | `performance.getDashboardKpis`        | query    | `{ period? }`                               | `{ okrCompletion, activeOkrs, coachingSessions, pendingCommitments, recognitions }` | performance:read   | Dashboard KPIs   |
| 11.17 | `performance.getLowProgressAlerts`    | query    | —                                           | `{ users[], threshold }`                                                            | performance:read   | Alert banner     |

---

## 12. learning

> Course catalog, learning paths, certifications, progress.
> Screens: #12 L&D Dashboard

| #     | Procedure                        | Type     | Input                                                       | Output                                                                     | Permission | Used By             |
| ----- | -------------------------------- | -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- | ------------------- |
| 12.1  | `learning.listCourses`           | query    | `{ type?, search?, category? }`                             | `Course[]` with enrollment, completion                                     | lnd:read   | Course catalog      |
| 12.2  | `learning.getCourseById`         | query    | `{ id }`                                                    | `Course` with modules, enrollments                                         | lnd:read   | Course detail       |
| 12.3  | `learning.createCourse`          | mutation | `{ title, type, duration, category, content, isRequired? }` | `Course`                                                                   | lnd:create | New course          |
| 12.4  | `learning.updateCourse`          | mutation | `{ id, ...partial }`                                        | `Course`                                                                   | lnd:update | Edit course         |
| 12.5  | `learning.enrollUser`            | mutation | `{ userId, courseId }`                                      | `Enrollment`                                                               | lnd:create | Enroll              |
| 12.6  | `learning.bulkEnroll`            | mutation | `{ userIds[], courseId }`                                   | `{ enrolled, failed[] }`                                                   | lnd:create | Bulk enroll         |
| 12.7  | `learning.updateProgress`        | mutation | `{ enrollmentId, moduleId, completed }`                     | `Enrollment`                                                               | lnd:update | Track progress      |
| 12.8  | `learning.listPaths`             | query    | `{ userId? }`                                               | `LearningPath[]` with courses, progress                                    | lnd:read   | Learning paths      |
| 12.9  | `learning.createPath`            | mutation | `{ name, courseIds[], targetGap? }`                         | `LearningPath`                                                             | lnd:create | Create path         |
| 12.10 | `learning.getGapBasedPaths`      | query    | `{ userId }`                                                | `LearningPath[]` from PCA gaps                                             | lnd:read   | AI-generated paths  |
| 12.11 | `learning.getPrePostTestResults` | query    | `{ courseId }`                                              | `{ preAvg, postAvg, delta, byUser[] }`                                     | lnd:read   | Impact measurement  |
| 12.12 | `learning.getTeamProgress`       | query    | `{ teamId? }`                                               | `TeamProgress[]` with hours, courses, certs                                | lnd:read   | Team progress table |
| 12.13 | `learning.getRecommendations`    | query    | `{ userId? }`                                               | `{ courses[], confidence }`                                                | lnd:read   | AI recommendations  |
| 12.14 | `learning.issueCertificate`      | mutation | `{ userId, courseId }`                                      | `Certificate`                                                              | lnd:create | Issue cert          |
| 12.15 | `learning.getDashboardKpis`      | query    | —                                                           | `{ totalCourses, activeLearners, avgHours, certifications, gapReduction }` | lnd:read   | Dashboard KPIs      |

---

## 13. ninebox

> Nine Box grid, calibration, talent review, auto-plans.
> Screens: #13 Nine Box Predictivo

> **⚠️ THIS SECTION DESCRIBES A SURFACE THAT NO LONGER EXISTS IN TypeScript.**
> As of 2026-08-05 (#57) `packages/api/src/routers/ninebox.ts` is deleted outright, along with
> `ninebox.schemas.ts` / `ninebox.helpers.ts` and its `root.ts` registration. **None of the twelve
> procedures below is a live tRPC endpoint.** Seven had their TS side deleted on 2026-07-29 when
> `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP` went live; the last five went with the router.
>
> The behaviour is served by C# — `services/Tims.Platform/src/Tims.Api/NineBox/NineBoxReadEndpoints.cs`
> and `NineBoxWriteEndpoints.cs`, behind `Platform:NineBoxReadEnabled` / `Platform:NineBoxWriteEnabled`.
> **13.8 `submitCalibrationVote` and 13.9 `finalizeCalibration` matter most here:** their absence from
> TypeScript is the precondition for ownership flip #70, pinned by
> `tests/governance/calibration-no-ts-writers.test.ts`. Reading this table as evidence that a TS writer
> of `calibration_votes` / `calibration_sessions` still exists is exactly backwards.
>
> The rows are retained as the historical contract the C# port was built against, not as an API.

| #     | Procedure (all DELETED from TS — served by C#) | Type     | Input                                            | Output                                                                                         | Permission     | Used By              |
| ----- | ---------------------------------------------- | -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------- | -------------------- |
| 13.1  | `ninebox.getGrid`                              | query    | `{ period, companyId?, unitId? }`                | `NineBoxCell[]` with employees, counts                                                         | ninebox:read   | Nine Box grid        |
| 13.2  | `ninebox.getEmployeeDetail`                    | query    | `{ userId, period }`                             | `{ potentialScore, performanceScore, confidence, axisBreakdown, history[] }`                   | ninebox:read   | Employee detail      |
| 13.3  | `ninebox.getAxisBreakdown`                     | query    | `{ period }`                                     | `{ potential: { mil, lnd, learning, evolution }, performance: { pca, 360, okrs, integrity } }` | ninebox:read   | Axis bars            |
| 13.4  | `ninebox.getMovementHistory`                   | query    | `{ userId }`                                     | `Movement[]` (quadrant changes over time)                                                      | ninebox:read   | Movement arrows      |
| 13.5  | `ninebox.simulate`                             | mutation | `{ userId, adjustments }`                        | `NineBoxCell` predicted                                                                        | ninebox:read   | Simulator            |
| 13.6  | `ninebox.createCalibration`                    | mutation | `{ period, committeeIds[], scheduledDate }`      | `CalibrationSession`                                                                           | ninebox:create | Start calibration    |
| 13.7  | `ninebox.getCalibration`                       | query    | `{ id }`                                         | `CalibrationSession` with members, status                                                      | ninebox:read   | Calibration panel    |
| 13.8  | `ninebox.submitCalibrationVote`                | mutation | `{ sessionId, userId, quadrant, justification }` | `Vote`                                                                                         | ninebox:update | Committee vote       |
| 13.9  | `ninebox.finalizeCalibration`                  | mutation | `{ sessionId }`                                  | `CalibrationSession`                                                                           | ninebox:update | Finalize             |
| 13.10 | `ninebox.getQuadrantPlan`                      | query    | `{ quadrant }`                                   | `{ actions[], description }`                                                                   | ninebox:read   | Auto-plan            |
| 13.11 | `ninebox.getBenchStrength`                     | query    | —                                                | `BenchStrength[]` by critical role                                                             | ninebox:read   | Bench strength table |
| 13.12 | `ninebox.getDashboardKpis`                     | query    | `{ period }`                                     | `{ totalEvaluated, highPotential, atRisk, avgConfidence }`                                     | ninebox:read   | Dashboard KPIs       |

---

## 14. succession

> Talent map, successors, flight risk, exit simulation.
> Screens: #14 Talent Map & Succession

> **⚠️ NONE OF THESE tRPC PROCEDURES EXIST ANY MORE — this table is a historical record of the
> original TS contract, not a live API surface.** `packages/api/src/routers/succession.ts` was
> deleted outright on 2026-08-03 (#58) and unregistered from `root.ts`; the 2026-07-29 cutover had
> already removed 8 of the 9 reads and 2 of the 5 writes. The C# service is the sole implementation:
> `SuccessionReadEndpoints.cs` + `SuccessionWriteEndpoints.cs` behind `Platform:SuccessionReadEnabled`
> / `Platform:SuccessionWriteEnabled` (both live in prod). The live FE contract is
> `apps/web/lib/platform-api/succession.ts`. Note the table below also predates the write surface —
> it omits `updateCriticalRoleBand`, the 5th C# write. Rows 14.2/14.3/14.5/14.6 were the last four
> to go; they had zero FE consumers throughout.

| #     | Procedure                             | Type     | Input                                 | Output                                                                   | Permission    | Used By             |
| ----- | ------------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------ | ------------- | ------------------- |
| 14.1  | `succession.listCriticalRoles`        | query    | —                                     | `CriticalRole[]` with holder, successors, riskLevel                      | talent:read   | Succession pipeline |
| 14.2  | `succession.getCriticalRole`          | query    | `{ id }`                              | `CriticalRole` with successor details                                    | talent:read   | Role detail         |
| 14.3  | `succession.addCriticalRole`          | mutation | `{ positionId, criticality }`         | `CriticalRole`                                                           | talent:create | Mark as critical    |
| 14.4  | `succession.addSuccessor`             | mutation | `{ roleId, userId, readiness, type }` | `Successor`                                                              | talent:create | Add successor       |
| 14.5  | `succession.removeSuccessor`          | mutation | `{ roleId, userId }`                  | `{ success }`                                                            | talent:delete | Remove successor    |
| 14.6  | `succession.updateSuccessorReadiness` | mutation | `{ roleId, userId, readiness }`       | `Successor`                                                              | talent:update | Update readiness    |
| 14.7  | `succession.getFlightRisk`            | query    | `{ companyId?, unitId? }`             | `FlightRisk[]` with score, factors                                       | talent:read   | Flight risk list    |
| 14.8  | `succession.getCompetencyCoverage`    | query    | `{ unitId? }`                         | `Coverage[]` by competency area                                          | talent:read   | Coverage chart      |
| 14.9  | `succession.getRolesWithoutSuccessor` | query    | —                                     | `CriticalRole[]` unmatched                                               | talent:read   | Gap table           |
| 14.10 | `succession.simulateExit`             | query    | `{ userId }`                          | `{ impact, directReports, replacementTime, nextInLine[] }`               | talent:read   | Exit simulator      |
| 14.11 | `succession.getDashboardKpis`         | query    | —                                     | `{ criticalRoles, readyNow, in1to2Years, noSuccessor, flightRiskCount }` | talent:read   | Dashboard KPIs      |

---

## 15. teamIntel

> Team composition, PCA profiles, balance, recommendations.
> Screens: #15 Team Intelligence

| #    | Procedure                       | Type  | Input           | Output                                                                 | Permission | Used By              |
| ---- | ------------------------------- | ----- | --------------- | ---------------------------------------------------------------------- | ---------- | -------------------- |
| 15.1 | `teamIntel.getTeamProfile`      | query | `{ teamId }`    | `{ pcaProfile, discDistribution, genderSplit, seniorityDistribution }` | team:read  | Team profile         |
| 15.2 | `teamIntel.getMembers`          | query | `{ teamId }`    | `Member[]` with PCA type, tenure, performance                          | team:read  | Member table         |
| 15.3 | `teamIntel.getBalanceScore`     | query | `{ teamId }`    | `{ score, alerts[] }`                                                  | team:read  | Balance analysis     |
| 15.4 | `teamIntel.getBalanceAlerts`    | query | `{ teamId }`    | `Alert[]` with recommendations                                         | team:read  | AI balance alerts    |
| 15.5 | `teamIntel.getRecommendedHires` | query | `{ teamId }`    | `{ profiles[], priority }`                                             | team:read  | Hire recommendations |
| 15.6 | `teamIntel.compareTeams`        | query | `{ teamIds[] }` | `Comparison[]`                                                         | team:read  | Team comparison      |
| 15.7 | `teamIntel.getDashboardKpis`    | query | `{ teamId }`    | `{ size, avgTenure, balanceScore, diversityIndex, avgPerformance }`    | team:read  | Dashboard KPIs       |

---

## 16. engagement

> Surveys, eNPS, climate heatmap, sentiment, action plans.
> Screens: #16 Engagement, Climate & Culture

| #     | Procedure                          | Type     | Input                                              | Output                                                                | Permission          | Used By            |
| ----- | ---------------------------------- | -------- | -------------------------------------------------- | --------------------------------------------------------------------- | ------------------- | ------------------ |
| 16.1  | `engagement.listSurveys`           | query    | `{ status? }`                                      | `Survey[]` with participation                                         | engagement:read     | Survey list        |
| 16.2  | `engagement.createSurvey`          | mutation | `{ title, type, questions[], targetGroups[] }`     | `Survey`                                                              | engagement:create   | Launch survey      |
| 16.3  | `engagement.getSurveyResults`      | query    | `{ surveyId }`                                     | `Results` with dimensions, areas                                      | engagement:read     | Results view       |
| 16.4  | `engagement.getEnps`               | query    | `{ period? }`                                      | `{ score, promoters, passives, detractors, trend[] }`                 | engagement:read     | eNPS card          |
| 16.5  | `engagement.getClimateHeatmap`     | query    | `{ surveyId? }`                                    | `{ dimensions[], departments[], scores[][] }`                         | engagement:read     | Heatmap            |
| 16.6  | `engagement.getResultsByArea`      | query    | `{ surveyId? }`                                    | `AreaResult[]`                                                        | engagement:read     | Bar chart          |
| 16.7  | `engagement.getWordCloud`          | query    | `{ surveyId? }`                                    | `{ words: { text, weight, sentiment }[] }`                            | engagement:read     | Word cloud         |
| 16.8  | `engagement.getSentiment`          | query    | `{ surveyId? }`                                    | `{ positive, neutral, negative, trend }`                              | engagement:read     | Sentiment pie      |
| 16.9  | `engagement.getLowClimateAlerts`   | query    | —                                                  | `Alert[]` by department                                               | engagement:read     | Alert list         |
| 16.10 | `engagement.listActionPlans`       | query    | —                                                  | `ActionPlan[]` with status                                            | engagement:read     | Action plans       |
| 16.11 | `engagement.createActionPlan`      | mutation | `{ title, responsible, area, dueDate, actions[] }` | `ActionPlan`                                                          | engagement:create   | New plan           |
| 16.12 | `engagement.updateActionPlan`      | mutation | `{ id, status, notes? }`                           | `ActionPlan`                                                          | engagement:update   | Update plan        |
| 16.13 | `engagement.listLeaderCommitments` | query    | —                                                  | `Commitment[]`                                                        | engagement:read     | Leader commitments |
| 16.14 | `engagement.submitSurveyResponse`  | mutation | `{ surveyId, answers[] }`                          | `{ success }`                                                         | authenticated (own) | Employee responds  |
| 16.15 | `engagement.getRotationRisk`       | query    | `{ unitId? }`                                      | `{ percentage, trend, factors[] }`                                    | engagement:read     | Risk KPI           |
| 16.16 | `engagement.getDashboardKpis`      | query    | —                                                  | `{ enps, participation, lastSurvey, lowClimateAlerts, rotationRisk }` | engagement:read     | Dashboard KPIs     |

---

## 17. dei

> Diversity, equity, inclusion analytics.
> Screens: #18 DEI Analytics

| #     | Procedure                     | Type     | Input            | Output                                                                        | Permission | Used By               |
| ----- | ----------------------------- | -------- | ---------------- | ----------------------------------------------------------------------------- | ---------- | --------------------- |
| 17.1  | `dei.getGenderRepresentation` | query    | `{ companyId? }` | `{ byDepartment: { dept, male, female, nonBinary }[] }`                       | dei:read   | Gender bars           |
| 17.2  | `dei.getPayEquity`            | query    | —                | `{ byLevel: { level, avgMale, avgFemale, gap }[] }`                           | dei:read   | Pay equity table      |
| 17.3  | `dei.getAgeDistribution`      | query    | —                | `{ ranges: { range, count, pct }[] }`                                         | dei:read   | Age chart             |
| 17.4  | `dei.getNationalityDiversity` | query    | —                | `{ nationalities: { country, count, pct }[] }`                                | dei:read   | Nationality breakdown |
| 17.5  | `dei.getHiringFunnel`         | query    | `{ period? }`    | `{ stages: { stage, diversePct }[] }`                                         | dei:read   | Hiring funnel         |
| 17.6  | `dei.getPromotionEquity`      | query    | —                | `{ byDeptGender: { dept, maleRate, femaleRate }[] }`                          | dei:read   | Promotion table       |
| 17.7  | `dei.getLeadershipDiversity`  | query    | —                | `{ male, female, nonBinary, total }`                                          | dei:read   | Leadership pie        |
| 17.8  | `dei.getInclusionIndex`       | query    | —                | `{ current, trend: { quarter, score }[] }`                                    | dei:read   | Inclusion trend       |
| 17.9  | `dei.generateReport`          | mutation | `{ period }`     | `{ reportUrl }`                                                               | dei:export | Generate report       |
| 17.10 | `dei.getDashboardKpis`        | query    | —                | `{ genderRatio, diversityIndex, payEquityGap, inclusionScore, diverseHires }` | dei:read   | Dashboard KPIs        |

---

## 18. compensation

> Salary bands, compa-ratio, benefits, market comparison.
> Screens: #19 Compensation & Benefits

| #     | Procedure                                | Type     | Input                                             | Output                                                                      | Permission           | Used By             |
| ----- | ---------------------------------------- | -------- | ------------------------------------------------- | --------------------------------------------------------------------------- | -------------------- | ------------------- |
| 18.1  | `compensation.getSalaryBands`            | query    | —                                                 | `Band[]` with min, mid, max, employees[]                                    | compensation:read    | Salary bands        |
| 18.2  | `compensation.getCompaRatioDistribution` | query    | —                                                 | `{ ranges: { range, count, label }[] }`                                     | compensation:read    | Compa-ratio chart   |
| 18.3  | `compensation.getPayEquity`              | query    | —                                                 | `{ byRoleGender: { role, male, female, gap }[] }`                           | compensation:read    | Equity table        |
| 18.4  | `compensation.getBenefitsUtilization`    | query    | —                                                 | `{ benefits: { name, utilization }[] }`                                     | compensation:read    | Benefits bars       |
| 18.5  | `compensation.listPendingAdjustments`    | query    | —                                                 | `Adjustment[]` with employee, compaRatio, recommendation                    | compensation:read    | Pending adjustments |
| 18.6  | `compensation.createAdjustment`          | mutation | `{ userId, type, amount, effectiveDate, reason }` | `Adjustment`                                                                | compensation:create  | Salary adjustment   |
| 18.7  | `compensation.approveAdjustment`         | mutation | `{ id, comment? }`                                | `Adjustment`                                                                | compensation:approve | Approve adjustment  |
| 18.8  | `compensation.simulateAdjustment`        | query    | `{ userId, newSalary }`                           | `{ compaRatio, bandPosition, budgetImpact }`                                | compensation:read    | Salary simulator    |
| 18.9  | `compensation.getMarketComparison`       | query    | —                                                 | `{ byRole: { role, internal, market, percentile }[] }`                      | compensation:read    | Market comparison   |
| 18.10 | `compensation.getTotalCompBreakdown`     | query    | —                                                 | `{ byLevel: { level, base, variable, benefits }[] }`                        | compensation:read    | Comp breakdown      |
| 18.11 | `compensation.getEmployeeComp`           | query    | `{ userId }`                                      | `{ salary, compaRatio, band, benefits[], history[] }`                       | compensation:read    | Individual comp     |
| 18.12 | `compensation.getDashboardKpis`          | query    | —                                                 | `{ totalPayroll, avgSalary, compaRatio, benefitsUtil, pendingAdjustments }` | compensation:read    | Dashboard KPIs      |

---

## 19. monitoring

> Executive dashboard, cross-module KPIs, alerts.
> Screens: #17 Strategic Monitoring & Alerts

| #    | Procedure                        | Type     | Input                    | Output                                                                | Permission        | Used By            |
| ---- | -------------------------------- | -------- | ------------------------ | --------------------------------------------------------------------- | ----------------- | ------------------ |
| 19.1 | `monitoring.getExecutiveKpis`    | query    | —                        | `{ headcount, openVacancies, avgTtf, turnover, enps, trainingHours }` | monitoring:read   | Executive KPIs     |
| 19.2 | `monitoring.getModuleHealth`     | query    | —                        | `ModuleHealth[]` with status, primaryKpi, trend                       | monitoring:read   | Module health grid |
| 19.3 | `monitoring.getActiveAlerts`     | query    | `{ severity?, module? }` | `Alert[]` with priority, timestamp                                    | monitoring:read   | Alerts feed        |
| 19.4 | `monitoring.dismissAlert`        | mutation | `{ alertId }`            | `{ success }`                                                         | monitoring:update | Dismiss alert      |
| 19.5 | `monitoring.getCrossModuleTrend` | query    | `{ months? }`            | `{ months[], headcount[], turnover[], enps[], ttf[] }`                | monitoring:read   | Trend chart        |
| 19.6 | `monitoring.configureAlertRules` | mutation | `{ rules[] }`            | `{ success }`                                                         | monitoring:update | Alert config       |
| 19.7 | `monitoring.getAlertRules`       | query    | —                        | `AlertRule[]`                                                         | monitoring:read   | Alert config       |

---

## 20. integration

> HRIS connectors, webhooks, API keys, sync, audit.
> Screens: #20 HRIS / Integration Admin

| #     | Procedure                      | Type     | Input                             | Output                                                                       | Permission         | Used By            |
| ----- | ------------------------------ | -------- | --------------------------------- | ---------------------------------------------------------------------------- | ------------------ | ------------------ |
| 20.1  | `integration.listConnectors`   | query    | —                                 | `Connector[]` with status, lastSync, entities                                | integration:read   | Connector list     |
| 20.2  | `integration.getConnector`     | query    | `{ id }`                          | `Connector` with config, history                                             | integration:read   | Connector detail   |
| 20.3  | `integration.createConnector`  | mutation | `{ type, name, config }`          | `Connector`                                                                  | integration:create | New integration    |
| 20.4  | `integration.updateConnector`  | mutation | `{ id, config?, status? }`        | `Connector`                                                                  | integration:update | Edit integration   |
| 20.5  | `integration.deleteConnector`  | mutation | `{ id }`                          | `{ success }`                                                                | integration:delete | Remove integration |
| 20.6  | `integration.syncNow`          | mutation | `{ connectorId }`                 | `{ jobId }`                                                                  | integration:update | Manual sync        |
| 20.7  | `integration.getSyncHistory`   | query    | `{ connectorId }`                 | `SyncEvent[]`                                                                | integration:read   | Sync timeline      |
| 20.8  | `integration.listWebhooks`     | query    | —                                 | `Webhook[]` with status                                                      | integration:read   | Webhook list       |
| 20.9  | `integration.createWebhook`    | mutation | `{ url, events[], secret? }`      | `Webhook`                                                                    | integration:create | New webhook        |
| 20.10 | `integration.updateWebhook`    | mutation | `{ id, ...partial }`              | `Webhook`                                                                    | integration:update | Edit webhook       |
| 20.11 | `integration.deleteWebhook`    | mutation | `{ id }`                          | `{ success }`                                                                | integration:delete | Remove webhook     |
| 20.12 | `integration.listApiKeys`      | query    | —                                 | `ApiKey[]` (masked)                                                          | integration:read   | API key list       |
| 20.13 | `integration.createApiKey`     | mutation | `{ name, environment, scopes[] }` | `{ key, id }`                                                                | integration:create | Generate key       |
| 20.14 | `integration.revokeApiKey`     | mutation | `{ id }`                          | `{ success }`                                                                | integration:delete | Revoke key         |
| 20.15 | `integration.getErrorLog`      | query    | `{ connectorId?, hours? }`        | `Error[]`                                                                    | integration:read   | Error log          |
| 20.16 | `integration.retryError`       | mutation | `{ errorId }`                     | `{ success }`                                                                | integration:update | Retry failed       |
| 20.17 | `integration.getSystemHealth`  | query    | —                                 | `{ services: { name, status, uptime }[] }`                                   | integration:read   | System health      |
| 20.18 | `integration.getDashboardKpis` | query    | —                                 | `{ activeConnectors, syncSuccessRate, lastSync, errors24h, webhooksActive }` | integration:read   | Dashboard KPIs     |

---

## 21. audit

> Access logs, change tracking, data export.
> **super_admin only** for all operations.

| #    | Procedure                  | Type     | Input                                                                | Output                                 | Permission   | Used By            |
| ---- | -------------------------- | -------- | -------------------------------------------------------------------- | -------------------------------------- | ------------ | ------------------ |
| 21.1 | `audit.listLogs`           | query    | `{ cursor?, limit?, userId?, entity?, action?, dateFrom?, dateTo? }` | `{ logs[], nextCursor? }`              | audit:read   | Audit trail        |
| 21.2 | `audit.getLogDetail`       | query    | `{ id }`                                                             | `AuditLog` with changes diff           | audit:read   | Log detail         |
| 21.3 | `audit.exportLogs`         | mutation | `{ filters?, format }`                                               | `{ url }`                              | audit:export | Export audit       |
| 21.4 | `audit.getAccessReport`    | query    | `{ userId, period }`                                                 | `{ accesses[], sensitiveDataViews[] }` | audit:read   | User access report |
| 21.5 | `audit.getChangesByEntity` | query    | `{ entity, entityId }`                                               | `AuditLog[]`                           | audit:read   | Entity history     |

---

## 22. billing

> Plans, subscriptions, usage, invoices (Stripe).
> **super_admin only.**

| #    | Procedure                       | Type     | Input         | Output                                       | Permission     | Used By        |
| ---- | ------------------------------- | -------- | ------------- | -------------------------------------------- | -------------- | -------------- |
| 22.1 | `billing.getCurrentPlan`        | query    | —             | `{ plan, status, trialEndsAt?, features[] }` | billing:read   | Plan info      |
| 22.2 | `billing.getUsage`              | query    | `{ period? }` | `{ users, aiCalls, storage, assessments }`   | billing:read   | Usage stats    |
| 22.3 | `billing.listInvoices`          | query    | —             | `Invoice[]`                                  | billing:read   | Invoice list   |
| 22.4 | `billing.getInvoice`            | query    | `{ id }`      | `Invoice` with line items                    | billing:read   | Invoice detail |
| 22.5 | `billing.createCheckoutSession` | mutation | `{ planId }`  | `{ url }`                                    | billing:update | Upgrade plan   |
| 22.6 | `billing.createPortalSession`   | mutation | —             | `{ url }`                                    | billing:update | Manage billing |
| 22.7 | `billing.cancelSubscription`    | mutation | `{ reason? }` | `{ success }`                                | billing:delete | Cancel         |

---

## 23. featureFlag

> Feature toggles per organization.
> **super_admin only.**

| #    | Procedure            | Type     | Input                        | Output                  | Permission          | Used By       |
| ---- | -------------------- | -------- | ---------------------------- | ----------------------- | ------------------- | ------------- |
| 23.1 | `featureFlag.list`   | query    | —                            | `FeatureFlag[]`         | organization:read   | Feature flags |
| 23.2 | `featureFlag.update` | mutation | `{ key, enabled, payload? }` | `FeatureFlag`           | organization:update | Toggle flag   |
| 23.3 | `featureFlag.check`  | query    | `{ key }`                    | `{ enabled, payload? }` | authenticated       | Runtime check |

---

## 24. portal

> Candidate-facing API (portal routes, not admin).
> **candidate role** or **public** for career pages.

| #     | Procedure                     | Type     | Input                                                      | Output                                | Permission       | Used By             |
| ----- | ----------------------------- | -------- | ---------------------------------------------------------- | ------------------------------------- | ---------------- | ------------------- |
| 24.1  | `portal.listVacancies`        | query    | `{ search?, category?, location?, page? }`                 | `{ vacancies[], total, pages }`       | public           | Career page         |
| 24.2  | `portal.getVacancy`           | query    | `{ id }`                                                   | `Vacancy` public fields               | public           | Vacancy detail      |
| 24.3  | `portal.apply`                | mutation | `{ vacancyId, firstName, lastName, email, phone, cvFile }` | `{ applicationId }`                   | public           | Apply form          |
| 24.4  | `portal.getMyApplications`    | query    | —                                                          | `Application[]` with status           | candidate:read   | Candidate dashboard |
| 24.5  | `portal.getApplicationStatus` | query    | `{ applicationId }`                                        | `{ stage, timeline[], nextSteps }`    | candidate:read   | Status tracker      |
| 24.6  | `portal.uploadDocument`       | mutation | `{ applicationId, type, file }`                            | `Document`                            | candidate:update | Upload docs         |
| 24.7  | `portal.getMyAssessments`     | query    | —                                                          | `Assignment[]` with status, deadlines | candidate:read   | Assessment list     |
| 24.8  | `portal.startAssessment`      | mutation | `{ assignmentId }`                                         | `{ sessionId, testUrl }`              | candidate:update | Start test          |
| 24.9  | `portal.getMyInterviews`      | query    | —                                                          | `Interview[]` with datetime, link     | candidate:read   | Interview list      |
| 24.10 | `portal.getMyOffer`           | query    | `{ offerId }`                                              | `Offer` candidate view                | candidate:read   | View offer          |
| 24.11 | `portal.acceptOffer`          | mutation | `{ offerId }`                                              | `{ success }`                         | candidate:update | Accept              |
| 24.12 | `portal.declineOffer`         | mutation | `{ offerId, reason? }`                                     | `{ success }`                         | candidate:update | Decline             |
| 24.13 | `portal.updateProfile`        | mutation | `{ phone?, address?, ... }`                                | `CandidateProfile`                    | candidate:update | Update info         |
| 24.14 | `portal.requestDataDeletion`  | mutation | `{ reason }`                                               | `{ ticketId }`                        | candidate:update | GDPR/Habeas Data    |
| 24.15 | `portal.submitNps`            | mutation | `{ applicationId, score, comment? }`                       | `{ success }`                         | candidate:update | Candidate NPS       |

---

## Summary

| Router       | Queries | Mutations | Total   |
| ------------ | ------- | --------- | ------- |
| auth         | 1       | 5         | 6       |
| organization | 6       | 7         | 13      |
| user         | 4       | 8         | 12      |
| vacancy      | 9       | 11        | 20      |
| pipeline     | 8       | 6         | 14      |
| candidate    | 10      | 9         | 19      |
| assessment   | 7       | 5         | 12      |
| interview    | 8       | 7         | 15      |
| offer        | 7       | 11        | 18      |
| onboarding   | 8       | 7         | 15      |
| performance  | 8       | 9         | 17      |
| learning     | 8       | 7         | 15      |
| ninebox      | 7       | 5         | 12      |
| succession   | 6       | 5         | 11      |
| teamIntel    | 6       | 1         | 7       |
| engagement   | 9       | 7         | 16      |
| dei          | 9       | 1         | 10      |
| compensation | 7       | 5         | 12      |
| monitoring   | 4       | 3         | 7       |
| integration  | 10      | 8         | 18      |
| audit        | 4       | 1         | 5       |
| billing      | 4       | 3         | 7       |
| featureFlag  | 2       | 1         | 3       |
| portal       | 8       | 7         | 15      |
| **TOTAL**    | **159** | **143**   | **302** |

---

## Screen → API Mapping

| Screen                   | Primary Router(s)                   | Key Procedures                                                 |
| ------------------------ | ----------------------------------- | -------------------------------------------------------------- |
| 1. Command Center        | vacancy, pipeline, interview, offer | getDashboardKpis, getSlaStatus, listToday, getPending          |
| 2. Pipeline Board        | pipeline, candidate                 | getBoard, moveCandidate, getNextBestAction                     |
| 3. Candidate 360         | candidate, assessment, pipeline     | getById, getResults, getTimeline, getRisks                     |
| 4. Job Requisition       | vacancy                             | getById, getJobProfile, listChannels, getApprovalChain         |
| 5. Candidate Portal      | portal                              | listVacancies, apply, getMyApplications                        |
| 6. Interview Central     | interview                           | getById, getScorecard, getGuide, submitScorecard               |
| 7. Offer Center          | offer                               | getById, getApprovalChain, listValidations, getLegalChecklist  |
| 8. Recruiting Analytics  | vacancy, pipeline, candidate        | getDashboardKpis, getFunnel, getStats                          |
| 9. Talent Pool CRM       | candidate                           | list (with filters), getPoolStats, getRecommendations          |
| 10. Onboarding           | onboarding                          | list, getById, listTasks, getCheckIns, getDashboardKpis        |
| 11. Performance & OKR    | performance                         | listOkrs, listCoachingSessions, listCommitments, listFeedback  |
| 12. L&D Dashboard        | learning                            | listCourses, listPaths, getTeamProgress, getRecommendations    |
| 13. Nine Box             | ninebox                             | getGrid, getEmployeeDetail, getCalibration, getBenchStrength   |
| 14. Talent Map           | succession                          | listCriticalRoles, getFlightRisk, simulateExit                 |
| 15. Team Intelligence    | teamIntel                           | getTeamProfile, getMembers, getBalanceAlerts, compareTeams     |
| 16. Engagement           | engagement                          | getEnps, getClimateHeatmap, getSentiment, listActionPlans      |
| 17. Strategic Monitoring | monitoring                          | getExecutiveKpis, getModuleHealth, getActiveAlerts             |
| 18. DEI Analytics        | dei                                 | getGenderRepresentation, getPayEquity, getInclusionIndex       |
| 19. Compensation         | compensation                        | getSalaryBands, getCompaRatioDistribution, getMarketComparison |
| 20. HRIS Admin           | integration                         | listConnectors, listWebhooks, listApiKeys, getErrorLog         |
| Super Admin — Org        | organization, user                  | getOrgTree, list (users), listRoles                            |
| Super Admin — Billing    | billing                             | getCurrentPlan, getUsage, listInvoices                         |
| Super Admin — Audit      | audit                               | listLogs, getAccessReport                                      |
| Super Admin — Flags      | featureFlag                         | list, update                                                   |
