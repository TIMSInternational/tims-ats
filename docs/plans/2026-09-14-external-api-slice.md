# External API completion and PCA integration slice

Date: 2026-09-14. Source inspection and issue #250; no production credential calls or source edits.

## Product boundary

TIMS ATS is an independent product. `tims.configuration.core` remains a separate legacy application. Integration is through explicit authenticated APIs; this slice does not import the legacy application, merge its database, reimplement its whole domain, or assume shared identifiers. PCA auto-email and other consumers receive only their authorized ATS API data.

## Corrected baseline

Issue #250 calls three external procedures unported. Current source contradicts that premise: all three already have C# implementations under `ExternalVendor`. Reuse them. `external-assessment.service.ts` is now an unconditional C# proxy; its comments report a July 31 production cutover, but production state was not checked in this planning subtask. `external-validation.service.ts` still retains a Prisma fallback selected when `EXTERNAL_VENDOR_WRITE_VIA_CSHARP` is false or the platform URL is disabled.

Existing C# flags are `Platform:ExternalVendorReadEnabled` and `Platform:ExternalVendorWriteEnabled`; do not introduce a competing `ExternalApiEnabled` flag merely because the older issue suggested it. Existing services, repositories, API-key authentication and golden fixtures substantially reduce implementation work.

## Existing procedure contracts

| TS procedure | C# route | Input | Response and authorization |
|---|---|---|---|
| external.getAssessmentResults | GET /external/assessment-results | Optional object: take integer 1–25, default 25; cursor optional UUID | `{items: ExternalAssessmentResultV1[], nextCursor?: UUID}` in TS; C# emits nullable nextCursor. Requires external role assessment:read grant plus assessment:read scope, with legacy empty-scope wildcard semantics. |
| external.getAssessmentResult | GET /external/assessment-results/{assignmentId} | assignmentId UUID | ExternalAssessmentResultV1; unavailable or foreign assignment is 404. Same grant/scope. |
| external.submitValidationResult | POST /external/validations/{validationId}/result | TS input validationId UUID; status passed/failed; result JSON object serialized length <=100,000; notes optional string <=5,000. C# puts ID in route and accepts remaining body fields. | `{schemaVersion:'v1',id,status,completedAt}`. Requires validation:update role grant AND explicit validation:write scope (empty scopes do not authorize). Pending-only atomic update; not found 404, already finalized 409. |

`ExternalAssessmentResultV1` fields: schemaVersion ('v1'), assignmentId, candidateId, vacancyId, assessmentType (nullable), status, assignedAt, startedAt (nullable), completedAt (nullable), expiresAt (nullable), scoredAt, rawScore (nullable), normalizedScore (nullable), percentile (nullable), band (nullable), normSampleSize (nullable), interpretation (JSON), breakdown (JSON), modelVersion (nullable). Preserve exact ISO dates and existing psychometric field ceiling. Do not add email or legacy IDs to v1 silently.

Sources: `packages/api/src/routers/external.ts`, `dto/external-assessment.ts`, `dto/external-validation.ts`; C# `Tims.Domain/ExternalVendor/ExternalAssessmentResultV1.cs` and `ExternalValidationSubmitCommand.cs`. Existing TS wire adapters restore Date values and normalize numeric values; account for that when characterizing direct REST versus tRPC compatibility.

The issue mentions MFA for machine validation writes. Current machine contracts use API-key scope/grant checks; the global MFA middleware explicitly excludes API-key sessions. Do not invent a human MFA flow for service credentials. Preserve explicit write scopes and review the discrepancy in the issue.

## Implementation sequence

1. Characterize existing endpoints and cutover compatibility. Run existing ExternalVendor integration/unit suites and contract fixtures. Verify direct API clients, API-key canary/parity support (#195), actual deployed read/write flags and the remaining TS validation call sites. Record who still calls tRPC before deleting compatibility paths.
2. Add an independently dark `Platform:PcaReadEnabled` flag for the NEW PII surface. Register new read-only services; default false. Extend OpenAPI generation and flag-gating tests. No browser wrapper is needed: this is machine-to-machine.
3. Implement company and candidate/result export reads under strict dedicated scopes, using the approved identifier/completion contract below. Keep new API data projections separate from the stable assessment v1 contract.
4. Verify two-tenant RLS, restrictive grants, pagination, missing mappings and fail-closed audit behavior on real PostgreSQL. Run bounded local consumer contract tests with fake PCA/legacy HTTP servers; no real email sends.
5. Deploy dark; use a dedicated tenant-scoped canary key through an approved parity fixture. Verify exports/audits, then enable PCA reads and update consumer configuration. Keep compatibility until consumers demonstrably use REST.
6. Reconcile table-ownership ledger and remaining writers before retiring TS validation repository/service and the external router. Assessment tables are shared with other domains; an API read port alone does not justify an ownership flip. Track ownership prerequisites separately rather than copying/removing shared schema models prematurely.

## Proposed new API contract (requires the specific unresolved facts below)

- GET `/external/pca/companies?take=25&cursor=<uuid>` -> `{schemaVersion:'v1',items:[{id,name}],nextCursor:null|uuid}`. Require `company:read` external-role grant plus an explicit `pca:company:read` scope. Do not expose company settings, tax IDs or legal fields.
- GET `/external/pca/companies/{companyId}/candidates?take=25&cursor=<opaque>` -> versioned items carrying `candidateId`, `companyId`, `email`, an explicitly defined `pcaCode`, assignment/result anchor, status and `completedAt`. Require candidate:read AND assessment:read grants plus explicit `pca:recipient:read` scope; empty scopes must fail. Decide below whether one item represents a candidate or an assessment attempt before freezing schema/cursor.
- Treat these names as proposed new contract choices, not existing endpoints. Limit pages to 25 initially to bound per-record audit work. A larger batch is a later measured optimization.
- Bind organization exclusively to the authenticated key. A companyId filter can only narrow that organization. Never accept organizationId or API key in the request body/query to override attribution.
- Foreign/missing company IDs have the same 404; foreign cursors never reveal existence or cross tenants. Stable deterministic keyset ordering, duplicate-attempt policy and resume semantics must be fixture-pinned. If the consumer needs updates after an earlier export, use an updatedAt/id cursor or a separate bounded change feed; UUID-only traversal cannot promise incremental updates.
- Export only active, undeleted authorized candidates under the agreed relationship. Candidate currently has NO companyId; derive through applications/vacancies (vacancy.companyId) only if product confirms this association, and constrain every joined organization. Avoid multiplying candidates accidentally across applications.
- Audit each exported PII/result record before returning data (fail closed), with organizationId, apiKeyId, record identifiers, action, trusted client IP and bounded user-agent. Never write email, raw keys or assessment payloads to diagnostic logs. Reuse IDataAccessAuditor and existing ExternalAssessmentReadUseCase's pattern.
- Per-key rate limit via ApiKeyRateLimitFilter, authorized role grants via PermissionService, and explicit-scope narrowing via ExternalScope with alwaysEnforceScope:true. Reuse ApiKeyAuthenticationHandler/ApiKeyResolver for hashing, expiry and revocation. No new authentication scheme or wildcard scope widening.
- Legacy IDs belong in an explicitly documented mapping or are returned by the separate legacy API. Do not infer PcaCod from candidate UUID, email, arbitrary JSON, assessment ID or company name. If ATS must store mappings, use a separate tenant-scoped integration mapping model with provider+external-ID uniqueness, documented ownership and migration; do not add an unvalidated free-form field to Candidate.

## File ownership and patterns

Own the new integration slice in these proposed files (one responsibility per file):

- `services/Tims.Platform/src/Tims.Api/ExternalPca/ExternalPcaEndpoints.cs`: bounded request validation, ApiKey authorization/filter, mapping errors to 400/404; split endpoint files if size requires.
- `services/Tims.Platform/src/Tims.Api/ExternalPca/ExternalPcaGate.cs`: strict external role + explicit scope gate; thread resolved scope into use case, refuse unsupported narrow scopes rather than broadening them.
- `services/Tims.Platform/src/Tims.Application/ExternalPca/ExternalPcaReadUseCase.cs`, `IExternalPcaReadRepository.cs`, `ExternalPcaReadModels.cs`: immutable DTOs, export orchestration and fail-closed audit. No EF/tRPC dependencies.
- `services/Tims.Platform/src/Tims.Infrastructure/ExternalPca/ExternalPcaReadRepository.cs`, `ExternalPcaDbContext.cs`, `ExternalPcaReadEntities.cs`: explicit projection-only mappings, TenantScope transactions and organization predicates on every join. Reuse existing native-enum data-source patterns if joining assessment status/type; never silently map PostgreSQL enums as unsupported strings.
- Shared edits only in Program.cs and PlatformOptions.cs for DI/flag registration; coordinate ownership. No changes to legacy source or provider credentials.
- `contracts/external-fixtures/pca-export-v1.json`: pinned versioned contract, nullable fields, dates, multiple attempts and missing mappings.
- `tests/Tims.IntegrationTests/ExternalPca/*`: Testcontainers production-like role/RLS schema and API tests. Unit tests for mapping/gate/audit-failure behavior. Existing `ExternalVendor` and `ExternalApiKeyAuthTests` remain regression suites.

## Required tests

- No key, invalid/revoked/expired key, JWT masquerading as key, key passed in body/query, missing grant, missing explicit scope, empty scopes and unsupported narrow grants all fail without data.
- Two tenants with overlapping company/candidate names; cross-tenant company/assignment/cursor and poisoned relationship rows do not escape key tenant. Prove repository RLS independently of API gates.
- Completion and PcaCod mapping fixtures as agreed; missing mappings are honest, never fabricated. Multiple applications/assessment attempts do not duplicate sends by accident.
- Page bounds, malformed UUID/cursor, stable resume behavior, empty page and no leakage of excluded candidate/company columns.
- PII audit failure aborts export; per-key quota returns 429; changing spoofable headers does not grant a new key quota.
- Existing validation pending-only concurrency still permits one update, one conflict. Verify direct REST DTOs versus tRPC date/nullable adapters before compatibility deletion.

## Missing product facts that actually block the PCA DTO

1. What exactly is PcaCod, which system owns it, and which entity does it identify (candidate, invitation, test attempt, company)? No PcaCod/pcaCod field was found in ATS schema/source. Provide a sanitized representative legacy API response or documented contract; do not request credentials in chat.
2. Does 'company' mean ATS Company under an organization, the organization itself, or a legacy customer? What is the authorized mapping between those identifiers?
3. What marks completion: all assigned tests, one PCA assessment, scored result availability, or a legacy report-ready state? How should failed/expired/repeated attempts appear?
4. Does PCA auto-email pull ATS results or does ATS need to read legacy completion first? Which API is authoritative for email and report availability, and which service owns send deduplication? Sending email is not part of these read endpoints.
5. Which tenants authorize the consumer and is its key permitted all companies in each tenant or an explicit subset? Existing external grants support org-level scope; company-limited credentials need a designed binding, not a caller-chosen filter.

These questions need not block verification/consolidation of the three existing C# routes. They block inventing the new cross-application identity and completion model. No changes to the separate legacy product are implied by this plan.

## Verified legacy discovery (supersedes the earlier unknowns where stated)

User expanded scope to integration of all company, candidate/employee and assessment-result data. Read-only inspection found the actual configuration repository plus already implemented legacy API consumers. No credentials, environment values or production data were opened. No sibling project was edited.

Source roots (absolute):

- Legacy configuration controllers: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/tims.configuration.core/src/tims.configuration.core.Web/Controllers/`.
- Working API consumer reference: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-pca-auto-email/src/tims/` (files below relative to this directory).
- Additional PCA workflow reference: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-suite/apps/api/src/services/pca-assessment-engine.ts` (read-only; active unrelated task).

The configuration repository is one service in the legacy product, NOT the company/person/result API itself. Source-defined default hosts in the consumer separate users, companies, applicants, surveys, configuration, core PCA and reports services. These are verified integration call sites, not a fresh production-availability assertion.

| Data/function | Existing upstream route and method | Source evidence / contract |
|---|---|---|
| Legacy user authentication | POST https://timshr.com/tims.users.web/api/Login | `companies.ts:45–64`, source defaults in `../config/env.ts:44`; JSON email/password from server configuration, bearer token parser accepts observed raw/JSON envelopes. Do not expose credentials or proxy this login to browsers. |
| Companies | GET https://timshr.com/tims.companies.web/api/Companies/GetAllCompanies | `companies.ts:67–84`, maps legacy company rows; requires user bearer. Account may access multiple organizations, so ATS must apply an explicit company binding, not trust the breadth of this credential. |
| People per company | GET https://timshr.com/tims.applicants.web/api/People/GetAllPeopleByCoId?coId=... | `masiveApi.ts:155,230`; whole-company batch, includes survey-control-to-person linkage. Existing timeout history is documented; import in bounded jobs, never synchronous unbounded browser fan-out. |
| Person details | GET https://timshr.com/tims.applicants.web/api/People/GetPeopleById/{personId} | `masiveApi.ts:193–201,259`; detail includes mcpAlias used for originating mass-link attribution. Person ID is distinct from survey ID. |
| Survey completion signature | GET https://timshr.com/tims.surveys.web/api/SurveyPerson/GetSurveyedControlByScId/{scId} | `masiveApi.ts:284–304`; handle absent/failed/unparseable results distinctly. |
| Assessment catalog | GET https://timshr.com/tims.surveys.web/api/Assessments/GetAllAssessments | `masiveApi.ts:366`; reuse actual assessment identifiers instead of assuming every result is PCA. |
| Jobs/JCA records | GET https://timshr.com/tims.surveys.web/api/Jobs/GetAllJobsByCoId?coId=...; GET /api/Jobs/GetJobById/{id} | `jobs.ts:76–78,121–126`, `masiveApi.ts:130–134`; list is one row per JCA survey-control, not necessarily one row per job. |
| Processes and company processes | GET https://timshr.com/tims.configuration.web/api/Processes/GetAllProcesses; GET /api/Processes/GetAllProcessesByCoId/{coId}; GET /api/Processes/GetAllProcessesByCoIdAndUserId/{coId}/{userId} | Real `ProcessesController.cs:52–91`, [Authorize]. Also process detail GET /api/Processes/GetProcessById/{id}. Do not copy its write routes into ATS. |
| Billing-center catalog | GET https://timshr.com/tims.configuration.web/api/BillingCenters/GetAllBillingCenters | Consumer `masiveApi.ts:371`; real BillingCentersController exists. |
| PCA company authentication | POST https://timshr.com/core/api/login/authenticate | `client.ts:47–66`; JSON `{CoKey}`, quoted bearer token, cache scoped per CoKey. CoKey is a secret; keep in server secret store, never identity DTOs or URL logs. |
| Single PCA completion | POST https://timshr.com/core/api/Pca/GetLink | `client.ts:190–211`; body `{CoKey,PcaCod}`; PcaEst === '7' means completed. |
| Competencies | POST https://timshr.com/core/api/Pca/GetCompetencesResult | `reports.ts:30`; body `{PcaCod,CmpTims:'1',CoKey}`. `types.ts` maps PcaCmps entries CmpNom/Level. |
| PCA PDF report | POST https://timshr.com/tims.reports.web/api/reports/getpcareport | `client.ts:115–135`; bearer, body coid/uid/spid/LangId/rptcod plus bounded rendering settings. Read-only report generation; no survey creation. |
| Existing bulk completed-person feed | Portal POST /Assess_People/FillGrid (authenticated portal session scoped to company) | `portal.ts:186–213,578`; envelope Data rows, StatusId 403, SurveyedPersonId, Email, PersonFirstName/LastName, SurveyDate. `ingestion/TimsApiSource.ts:296–310` uses this today. This is a portal JSON endpoint, not a newly claimed public REST API. Isolate it as legacy adapter if no equivalent supported batch REST feed is available. |

**PcaCod is now resolved from source:** it identifies a PCA evaluation/survey, not a person. `/Pca/AddSurvey` returns PcaCod/PcaLink (`client.ts:155–186`), and the existing completed feed maps `SurveyedPersonId` to pcaCod/spid (`portal.ts:187,200`). Creating a survey is billable and non-idempotent; this discovery/sync slice must not call AddSurvey. Preserve separate legacy company, person, survey-control and assessment-attempt identities.

**Completion semantics now have verified provider codes:** portal StatusId 403 and PCA GetLink PcaEst '7'. They are different representations, not ATS status enums. Preserve raw provider status and map to normalized completion only under the correct provider endpoint contract. Missing/unparseable completion dates must remain unknown; do not fabricate epoch or advance watermarks past unresolved rows. Existing delivery service owns its own `(companyId,pcaCod)` deduplication; ATS ingestion needs its own `(provider,tenant,externalSurveyId)` idempotency and must not send duplicate email.

### Concrete implementation expansion in ATS only

Add `LegacyTims` C# integration alongside the existing outbound ExternalVendor API. It is an inbound connector, not a copy of the legacy application:

1. `LegacyTimsOptions` contains fixed allowlisted service base URLs and secret references; server-only typed HttpClient adapters for users/companies, applicants, surveys/configuration and PCA/reports. Never accept arbitrary upstream URLs from tenant request bodies. Validate every external response with bounded typed contracts; preserve unknown/missing values, never inherit permissive `any` parsing or default missing scores to zero from the old consumer.
2. Introduce explicit authorized bindings from `(ATS organizationId, ATS companyId)` to `(provider='legacy-tims', legacy coId)` and per-provider external identifiers. Full administrator account access does not authorize import of every legacy company into every ATS tenant. Stage unmatched companies for mapping; do not merge by name/email alone.
3. Sync companies, people and attempts/results in checkpointed background jobs with per-tenant locks, bounded concurrency, retries for reads, stable source IDs and idempotent upserts. Persist source revision/fetchedAt and raw contract version; use a separate evidence table/object storage for permitted raw payloads. Encrypt/classify sensitive fields and audit imports/exports. Source deletions become explicit reconciliation events, not hard deletion of independently authored ATS records.
4. Separate person identity from ATS employment. Legacy People endpoints provide persons; no employee-status contract was verified in the inspected sources. Import source person identity and candidate links without manufacturing employee status. Map to ATS employee only using verified employment evidence (existing ATS hire/employee relationship or additional source contract). This is the remaining semantic gap in the user’s “candidate/employee” scope.
5. Connect report/score ingestion to the verified survey mapping, including multiple assessment families via catalog. PCA DISC/competence parsing is evidenced; do not claim full raw result contracts for every other assessment family until each actual source route is inspected. Official report availability alone is not a normalized score contract.
6. Add fake-HTTP contract fixtures plus Testcontainers tests proving no cross-tenant coId imports, repeated sync idempotency, person-versus-attempt identity, completion code handling, missing data quarantine, failure-safe checkpoints and non-PCA assessment preservation. No legacy modifications or billable calls are necessary to build/test this.

Remaining discovery is narrower now: verify the precise GetAllCompanies/person response field inventory without PII fixtures, supported all-assessment result routes, employee semantics, and source-to-ATS company bindings. Source code already resolves PcaCod and core completion semantics; do not ask the user to rediscover those facts.

## Follow-up discovery: exact minimal DTOs, assessment families and employment

### Source-verified minimal legacy DTO fields

- `companies.ts:65` RawCompany: `id:string`, `name:string`, optional `companyTypeId:number`, `statusId:number`, nullable optional `languageId:string`, nullable optional `distributorId:string`. Existing consumer filters `companyTypeId===3` (client companies) and maps languageId to its own region field. ATS must retain the actual source meaning: languageId is not proof of geographic region. statusId is present but its company-specific meanings are not established by this type. Do not silently import inactive companies as active.
- `masiveApi.ts:155–187` person-survey batch fields actually consumed: `personId`, `personEmail`, `personFirstName`, `personLastName`, `scId`, `scStatusId`, `assessmentId`; fallback casing `scID`/`ScId` and firstName/lastName is tolerated. This is a person-survey row, not a canonical deduplicated person roster. Existing consumer drops rows without scId, which ATS **must not copy for all-person integration**: retain/stage person identity rows without surveys separately rather than losing unassessed people. Detail endpoint supplies at least `mcpAlias` for attribution (`masiveApi.ts:193–259`). Full detail DTO has not been defined by that consumer.
- `masiveApi.ts:270` CompletionSignature: `assessmentId:number`, `targetId:string`, optional `languageId:string`. Missing signature and transient request failure are distinct; do not advance checkpoint on auth/timeout/429/5xx or invalid JSON.
- Portal completed row projection (`portal.ts:186–213`): `StatusId`, `SurveyedPersonId`, `Email`, `PersonFirstName`, `PersonLastName`, `PersonIdNumber`, `SurveyDate`, optional `MCPId`/`McpId`/`MasiveControlProcessId`. National ID is present but requires its own restricted field handling; broad integration does not mean include it in every outbound DTO.

### Assessment family matrix

| Family | Verified legacy contract | Separate tims-suite API evidence | Implementation status |
|---|---|---|---|
| PCA / DISC | core GET `/results/pca?pcacod=...` in `reports.ts:23`; POST `/Pca/GetCompetencesResult`; official report endpoint above. DISC response D1/I1/S1/C1 through graph 3, with older Pca-prefixed variants in `types.ts`. | GET `/api/pca/results`, `/api/pca/results/:userId`, `/api/pca/report-pdf`, `/api/pca/img-report`; `src/index.ts:123`, routes/pca-assessment.routes.ts:20–29. | Ready for bounded typed provider adapter and sanitized fixture implementation. Preserve three separate graphs and missing values. |
| JCA / job competence | Surveys job/list/detail routes and PCA-vs-job PDF report in `client.ts:223–267`; job code and survey-control IDs are distinct. | No equivalent JCA raw-result route established in this inspection. | Import catalog/job/attempt identity; official comparison PDF adapter available. Raw JCA normalized scoring contract remains unverified. |
| LIA / MIL | No legacy users/applicants/core raw-result endpoint located. Do not invent `/results/lia`. | GET `/api/lia-assessment/:sessionId/results`; src/index.ts:122 + routes/lia-assessment.routes.ts:37; controller delegates to local lia assessment engine. | A separate provider adapter can target Suite after its auth/schema contract is pinned. This is NOT proof the legacy TIMSHR API exposes that route. |
| English | No legacy raw-result endpoint located. | GET `/api/english-assessment/employee/:userId/results`; index.ts:121, routes/english-assessment.routes.ts:42; bearer authentication + subscription middleware. | Separate Suite provider only; identify session/version and preserve result schema rather than converting to PCA fields. |
| Personality | No legacy raw-result endpoint located. | GET `/api/personality-assessment/employee/:userId/results` and `/:sessionId/results`; index.ts:124, routes/personality-assessment.routes.ts:21,27. | Separate Suite provider only; profile/type data is not an employee employment-state record. |
| Other catalog assessment IDs | Surveys `/api/Assessments/GetAllAssessments` supplies catalog; completion signature includes assessmentId. | Other families must be inventoried against real route registration. | Preserve unknown catalog/attempt metadata; quarantine unsupported result payloads, never label them PCA or silently discard them. |

All Suite routes above are sourced from `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-suite/apps/api/src/`. They use the Suite's own authentication and data model, not legacy CoKey authentication. Keep provider identities separate (`legacy-tims` versus `tims-suite`). This repository was read only.

**Employment evidence:** Suite's `team-analysis-aggregator.ts:65–69` counts users with company_id and role='employee'. However `company-provisioning.ts:416–419` explicitly assigns role='employee' to individual accounts with company_id null. Therefore 'employee' is also an application authorization role and is NOT sufficient proof of employment. Likewise a legacy People entry is an assessment participant, not necessarily an employee. The safe model imports participant identity + source account role + source company link separately; ATS employment status remains unchanged unless an authoritative employment record or verified hire transition exists. This conclusion resolves the ambiguity without asking the user to reinterpret source internals.

### First read-only connector slice with no mapping guesses

Implement a server-only, administrator-authorized **discovery preview**, not automatic persistence into business entities:

1. Typed `LegacyTimsDirectoryClient`: authenticate using a configured secret reference, GET companies, display only validated minimal client-company metadata. Store no CoKey/password in responses. Do not select one arbitrary legacy company for an ATS org.
2. For an explicitly configured authorized `(ATS org, legacy coId)` binding, GET all person-survey rows and catalog. Return a bounded preview grouping by verified external personId, with separate attempts keyed by scId. Keep unmatched/missing-ID entries in an explicit rejected-row count; don't guess identity from email.
3. Provide completed PCA read preview only for survey IDs established by the authorized company's source rows. Fetch scores/report metadata using its correct provider credential; one bounded page and bounded concurrency. No AddSurvey, email, migration of legacy source, or automatic employment changes.
4. Where no binding exists, company discovery can finish and report 'mapping required' without leaking its people/results into an ATS tenant. Binding administration is a deliberate platform-owner configuration action; tenant users cannot submit a foreign coId as authority.
5. Tests use local fake HTTP responses and synthetic company/person IDs. Cover source/company binding, raw-vs-normalized IDs, participants without assessments, no employee promotion, multiple attempts, unsupported assessment IDs, throttling and partial failure. Production network verification and credential provisioning are separate rollout steps after source implementation.

This starts real integration work now while preserving all discovered data classes and making unsupported assessment contracts visible. It does not claim all legacy assessment result APIs were found: only configuration controller source exists among the locally available `github/tims.*` C# projects; users/companies/applicants/surveys routes are verified through existing consumers, not missing controller source.
