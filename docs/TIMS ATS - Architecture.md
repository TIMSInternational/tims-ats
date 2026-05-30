# TIMS Platform — Final Architecture (Optimized)

> **Status**: LOCKED — v3.0 (gap resolution + full annexes)
> **Date**: 2026-05-26 (v3.0 — gap resolution, annexes, data continuity, permission matrix)
> **Previous**: 2026-05-25 (v2.0 revised cost model)
> **Builder**: NexaDev
> **Client**: TIMS International

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Stack Decisions](#2-stack-decisions)
3. [System Architecture](#3-system-architecture)
4. [Multi-Tenancy Model](#4-multi-tenancy-model)
5. [Application Architecture](#5-application-architecture)
6. [Monorepo Structure](#6-monorepo-structure)
7. [Database Strategy](#7-database-strategy)
8. [API Layer](#8-api-layer)
9. [Auth & Permissions](#9-auth--permissions)
10. [AI Architecture (Cost-Optimized)](#10-ai-architecture-cost-optimized)
11. [Real-Time & Background Jobs](#11-real-time--background-jobs)
12. [Video & Communication](#12-video--communication)
13. [File Storage & CDN](#13-file-storage--cdn)
14. [External Integrations](#14-external-integrations)
15. [Deployment & Infrastructure](#15-deployment--infrastructure)
16. [Cost Model](#16-cost-model)
17. [Phasing & What Ships When](#17-phasing--what-ships-when)
18. [Migration & Scale Triggers](#18-migration--scale-triggers)
19. [Functional Annexes — Phases 4-10](#19-functional-annexes--phases-4-10)
20. [Data Continuity Map](#20-data-continuity-map)
21. [Sensitive Data Permission Matrix](#21-sensitive-data-permission-matrix)

---

## 1. Design Principles

```
1. SHIP LEAN, SCALE LATER
   Start with the smallest infrastructure that serves TIMS International.
   Add complexity only when a measurable trigger is hit.

2. ONE DEPLOYMENT, MULTIPLE FACES
   Single Next.js app serves both admin and portal via subdomain routing.
   Cuts deployment cost, CI complexity, and shared code duplication.

3. NO PYTHON UNTIL YOU NEED ML
   All AI at launch is LLM calls (Claude via Bedrock).
   Node.js handles this natively. Python AI service added only
   when custom model training begins (500+ QoH data points).

4. DATABASE IS THE PLATFORM
   Supabase PostgreSQL handles: data, auth, file storage, realtime,
   row-level security. One service replaces 4-5 separate systems.

5. AI COST = ENGINEERING PROBLEM
   Every AI call is routed through a cost-optimization pipeline:
   model tiering → prompt caching → batch API → response caching → context trimming.
   Target: 70-80% cost reduction vs. naive implementation.

6. SCHEMA-PER-PHASE, NOT SCHEMA-FOR-ALL
   Design only the tables needed for the current phase.
   ~45 tables for MVP, not 200. Prevents premature abstractions.

7. PATTERN ONCE, REPLICATE EVERYWHERE
   First CRUD, first dashboard, first AI agent — get the pattern perfect.
   Every subsequent instance follows the established pattern.
```

---

## 2. Stack Decisions

### Final Stack

```
LAYER                  TECHNOLOGY                    RATIONALE
─────────────────────  ────────────────────────────  ──────────────────────────────
MONOREPO               Turborepo + pnpm              Fast builds, shared packages
FRAMEWORK              Next.js 15+ (App Router)      SSR for portal SEO, RSC, API routes
UI                     Tailwind CSS 4 + shadcn/ui    Proven NexaDev pattern, fast to build
STATE / DATA           TanStack Query + tRPC 11      End-to-end type safety
DRAG & DROP            @hello-pangea/dnd             Pipeline Kanban, onboarding tasks
CHARTS                 Recharts                      Dashboards, radar charts, heatmaps
FORMS                  React Hook Form + Zod         Validation, wizard forms
TABLES                 TanStack Table                Filterable, sortable, paginated
i18n                   next-intl                     ES + EN from day 1

DATABASE               Supabase (PostgreSQL 16)      RLS, Auth, Storage, Realtime — one bill
ORM                    Prisma 6                      Migrations, type generation, RLS helper
AUTH                   Supabase Auth                 SSO (Google, Microsoft), MFA, JWT
REALTIME               Supabase Realtime             Postgres changes → WebSocket (free tier)
FILE STORAGE           Supabase Storage              S3-compatible, CDN, signed URLs
BACKGROUND JOBS        Trigger.dev v3                Serverless, durable, already known
QUEUE / EVENTS         Trigger.dev event triggers    Replaces BullMQ + Redis pub/sub

AI (LLM)              Vercel AI SDK + AWS Bedrock    Claude calls from Node.js, streaming
AI (MODELS)            Haiku (60%) + Sonnet (40%)    Model tiering for cost optimization
AI (CACHING)           Anthropic prompt caching       90% reduction on cached input tokens
AI (BATCH)             Anthropic Batch API            50% off for non-real-time tasks
AI (PROCTORING)        TensorFlow.js (client-side)   Face detection in browser, zero server cost
EMAIL                  AWS SES                        Production access, 50K/day, pennies
WHATSAPP               WhatsApp Business Cloud API    Candidate communications (mostly free)
CALENDAR               Google Calendar + MS Graph     Interview scheduling
E-SIGNATURE            OpenSign (open-source)         ESIGN Act + UETA compliant, $0/mo
VIDEO                  Zoom Video SDK (@zoom/videosdk) In-app video interviews, 10K free min/mo
BILLING                Stripe                         Subscriptions, invoices, usage metering

DEPLOY                 Vercel                         Frontend + API (Edge + Serverless)
MONITORING             Sentry (free tier)             Error tracking
LOGS                   Vercel Logs + Axiom (free)     Request logs, function logs
CI/CD                  GitHub Actions                 Lint, test, type-check, deploy
TESTING                Vitest + Playwright            Unit + E2E
```

### What Was Removed (and Why)

```
REMOVED                  REPLACED BY                  SAVINGS
─────────────────────    ────────────────────────     ────────────
Redis                    Supabase Realtime + DB       $70-100/mo
Socket.io                Supabase Realtime            Complexity
BullMQ workers           Trigger.dev                  $100-300/mo (no always-on containers)
Python FastAPI service   Vercel AI SDK (Node.js)      $150-300/mo (no ECS)
Daily.co (managed)       Zoom Video SDK (free tier)   $200-300/mo → $0 at launch (10K free min)
DocuSign API             OpenSign (open-source)        $50-480/mo (self-hosted, ESIGN compliant)
AWS Transcribe           Removed (not needed at MVP)  $100-200/mo
AWS S3 + CloudFront      Supabase Storage             $50-150/mo
Separate portal app      Subdomain middleware          $20-40/mo + CI complexity
pgvector                 Deferred to Phase 4+         Complexity
NextAuth.js              Supabase Auth (built-in)     Complexity
```

---

## 3. System Architecture

```
                            ┌─────────────────┐
                            │   Vercel Edge    │
                            │   (CDN + SSR)    │
                            └────────┬────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
           ┌───────▼───────┐ ┌──────▼──────┐ ┌──────▼──────┐
           │{client}.tims  │ │app.tims.com │ │api.tims.com │
           │.com           │ │             │ │             │
           │Career Site +  │ │Admin Panel  │ │tRPC API     │
           │Candidate      │ │(HR, Leaders,│ │(consumed by │
           │Portal         │ │ Employees)  │ │ both apps)  │
           └───────┬───────┘ └──────┬──────┘ └──────┬──────┘
                   │                │                │
                   └────────────────┼────────────────┘
                                    │
                        ┌───────────▼───────────┐
                        │   SINGLE NEXT.JS APP  │
                        │                       │
                        │  Middleware:           │
                        │  - Subdomain detect   │
                        │  - Auth check         │
                        │  - Org context inject │
                        │  - i18n locale        │
                        └───────────┬───────────┘
                                    │
              ┌─────────┬───────────┼───────────┬─────────┐
              │         │           │           │         │
        ┌─────▼────┐ ┌──▼───┐ ┌────▼────┐ ┌───▼───┐ ┌───▼────┐
        │Supabase  │ │Supa  │ │Supa     │ │Supa   │ │Trigger │
        │PostgreSQL│ │Auth  │ │Storage  │ │Real-  │ │.dev    │
        │+ RLS     │ │      │ │(files)  │ │time   │ │(jobs)  │
        └──────────┘ └──────┘ └─────────┘ └───────┘ └────────┘
                                    │
              ┌─────────┬───────────┼───────────┬─────────┐
              │         │           │           │         │
        ┌─────▼────┐ ┌──▼───┐ ┌────▼────┐ ┌───▼───┐ ┌───▼────┐
        │AWS       │ │AWS   │ │Zoom     │ │WhatsApp│ │Stripe  │
        │Bedrock   │ │SES   │ │Video SDK│ │Business│ │(billing│
        │(Claude)  │ │(email│ │         │ │API     │ │)       │
        └──────────┘ └──────┘ └─────────┘ └───────┘ └────────┘
```

### Request Flow

```
Browser → Vercel Edge → Middleware (subdomain routing + auth)
  │
  ├── Portal request ({client}.tims.com)
  │   └── app/(portal)/... routes
  │       ├── Public: career pages (SSR, cached at edge)
  │       └── Auth'd: candidate dashboard, assessments
  │
  ├── Admin request (app.tims.com)
  │   └── app/(admin)/... routes
  │       └── All admin screens (CSR, protected)
  │
  └── API request (api.tims.com or /api/trpc)
      └── tRPC router
          ├── Auth middleware (Supabase JWT)
          ├── RLS middleware (inject org_id)
          ├── Permission middleware (RBAC check)
          └── Route handler → Prisma → PostgreSQL
```

---

## 4. Multi-Tenancy Model

```
Organization (Holding/Group)         ← org_id (RLS filter on every query)
  │── Config: branding, features, billing, AI budgets
  │
  ├── Company (Subsidiary/Country)   ← company_id
  │     │── Config: language, legal rules, currency, timezone
  │     │
  │     ├── Business Unit (Dept)     ← business_unit_id
  │     │     │── Config: SLAs, evaluators, KPIs
  │     │     │
  │     │     └── Team               ← team_id
  │     │           │── Members, leader, OKRs
  │     │
  │     └── Business Unit
  │           └── Team
  │
  └── Company (Another Country)
        └── Business Unit
              └── Team

Config cascade: Org → Company → Unit → Team
Each level inherits parent config, can override via JSONB settings column.
```

### RLS Implementation

```sql
-- Every table has organization_id
-- Supabase RLS policy (set via Prisma migration + raw SQL)

ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON vacancies
  USING (organization_id = current_setting('app.current_org_id')::uuid);

-- Set in tRPC middleware before every query:
-- SET LOCAL app.current_org_id = '<org-uuid>';
```

### Prisma + RLS Pattern

```typescript
// packages/db/src/client.ts
import { PrismaClient } from '@prisma/client'

export function createTenantClient(orgId: string) {
  const prisma = new PrismaClient()

  // Run SET LOCAL before every query via Prisma middleware
  prisma.$use(async (params, next) => {
    await prisma.$executeRawUnsafe(
      `SET LOCAL app.current_org_id = '${orgId}'`
    )
    return next(params)
  })

  return prisma
}
```

---

## 5. Application Architecture

### Single App, Multiple Faces

```
next.config.ts:
  - No special config needed for subdomains on Vercel

middleware.ts:
  - Extract subdomain from request hostname
  - "app" subdomain → rewrite to /(admin)/...
  - Any other subdomain → rewrite to /(portal)/...
  - Set x-org-slug header for portal tenant resolution

Route Groups:
  app/
  ├── (admin)/          ← app.tims.com
  │   ├── layout.tsx    (admin shell: sidebar, topbar)
  │   ├── page.tsx      (Command Center)
  │   ├── recruitment/
  │   ├── people/
  │   ├── talent/
  │   ├── engagement/
  │   ├── learning/
  │   ├── compensation/
  │   ├── monitoring/
  │   └── settings/
  │
  ├── (portal)/         ← {client}.tims.com
  │   ├── layout.tsx    (portal shell: client-branded)
  │   ├── page.tsx      (career home)
  │   ├── vacancies/
  │   ├── apply/
  │   ├── dashboard/    (candidate authenticated)
  │   ├── assessments/
  │   └── messages/
  │
  ├── (assessment)/     ← embedded test player (shared)
  │   ├── lobby/
  │   ├── player/
  │   └── complete/
  │
  ├── (auth)/           ← shared auth pages
  │   ├── login/
  │   ├── register/
  │   └── sso/
  │
  └── api/
      └── trpc/[trpc]/  ← tRPC HTTP handler
```

### Shared Component Library (packages/ui)

Build once, use in 10+ places each:

```
COMPONENT              USED IN                                    PRIORITY
─────────────────────  ──────────────────────────────────────     ────────
DataTable              Vacancies, candidates, courses, surveys    Phase 0
FormWizard             Vacancy creation, offer, evaluation setup  Phase 0
KanbanBoard            Pipeline, onboarding tasks, commitments    Phase 0
DashboardCard          Every dashboard (25+ dashboards)           Phase 0
StatCard               KPIs, metrics, counters                    Phase 0
ApprovalFlow           Vacancy approval, offer, adjustments       Phase 1
ScoreRadar             FIT breakdown, gap analysis, team comp     Phase 2
TimelineView           Candidate history, audit trail             Phase 1
ComparisonView         Candidate comparison, evaluator compare    Phase 2
AlertBanner            SLA alerts, risk alerts, system alerts     Phase 1
FileUploader           Documents, medical, CV, recordings         Phase 1
SearchPanel            Global search, talent search               Phase 1
MessageComposer        Email templates, WhatsApp, notifications   Phase 1
HeatmapView            Evaluations, climate, competency coverage  Phase 7
NineBoxGrid            Nine Box (reused in multiple contexts)     Phase 7
VideoRoom              Interviews, coaching sessions              Phase 3
```

---

## 6. Monorepo Structure

```
tims-ats/
│
├── apps/
│   └── web/                          # THE single Next.js app
│       ├── app/
│       │   ├── (admin)/              # app.tims.com routes
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx          # Command Center
│       │   │   ├── recruitment/
│       │   │   │   ├── vacancies/
│       │   │   │   ├── pipeline/
│       │   │   │   ├── assessments/
│       │   │   │   ├── interviews/
│       │   │   │   ├── talent-pools/
│       │   │   │   ├── fit-engine/
│       │   │   │   ├── offers/
│       │   │   │   └── analytics/
│       │   │   ├── people/
│       │   │   │   ├── directory/
│       │   │   │   ├── onboarding/
│       │   │   │   ├── performance/
│       │   │   │   ├── coaching/
│       │   │   │   ├── evaluations/
│       │   │   │   └── commitments/
│       │   │   ├── talent/
│       │   │   │   ├── nine-box/
│       │   │   │   ├── succession/
│       │   │   │   └── team-intelligence/
│       │   │   ├── engagement/
│       │   │   │   ├── surveys/
│       │   │   │   ├── climate/
│       │   │   │   └── dei/
│       │   │   ├── learning/
│       │   │   ├── compensation/
│       │   │   ├── monitoring/
│       │   │   └── settings/
│       │   │       ├── organization/
│       │   │       ├── integrations/
│       │   │       ├── billing/
│       │   │       └── audit/
│       │   │
│       │   ├── (portal)/             # {client}.tims.com routes
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx          # Career home (SSR)
│       │   │   ├── vacancies/
│       │   │   ├── apply/
│       │   │   ├── dashboard/
│       │   │   ├── assessments/
│       │   │   ├── interviews/
│       │   │   ├── messages/
│       │   │   ├── documents/
│       │   │   └── offers/
│       │   │
│       │   ├── (assessment)/         # Embedded test player
│       │   ├── (auth)/               # Login, register, SSO
│       │   └── api/trpc/[trpc]/      # tRPC endpoint
│       │
│       ├── components/               # App-specific components
│       ├── hooks/                    # App-specific hooks
│       ├── lib/                      # App utilities
│       ├── middleware.ts             # Subdomain routing + auth
│       ├── next.config.ts
│       └── tailwind.config.ts
│
├── packages/
│   ├── db/                           # Prisma schema + client
│   │   ├── prisma/
│   │   │   ├── schema/              # Split schema files (per module)
│   │   │   │   ├── organization.prisma
│   │   │   │   ├── vacancy.prisma
│   │   │   │   ├── candidate.prisma
│   │   │   │   ├── assessment.prisma
│   │   │   │   ├── interview.prisma
│   │   │   │   ├── offer.prisma
│   │   │   │   ├── fit.prisma
│   │   │   │   └── ... (added per phase)
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── client.ts            # Prisma client with RLS
│   │       └── index.ts             # Re-exports
│   │
│   ├── api/                          # tRPC routers
│   │   └── src/
│   │       ├── routers/
│   │       │   ├── vacancy.ts
│   │       │   ├── pipeline.ts
│   │       │   ├── candidate.ts
│   │       │   ├── assessment.ts
│   │       │   ├── interview.ts
│   │       │   ├── offer.ts
│   │       │   ├── fit.ts
│   │       │   ├── organization.ts
│   │       │   ├── user.ts
│   │       │   └── ... (added per phase)
│   │       ├── middleware/
│   │       │   ├── auth.ts
│   │       │   ├── rls.ts
│   │       │   ├── permissions.ts
│   │       │   └── audit.ts
│   │       ├── context.ts
│   │       └── root.ts
│   │
│   ├── ui/                           # Shared component library
│   │   └── src/
│   │       ├── data-table/
│   │       ├── form-wizard/
│   │       ├── kanban-board/
│   │       ├── dashboard-card/
│   │       ├── stat-card/
│   │       ├── approval-flow/
│   │       ├── score-radar/
│   │       ├── timeline/
│   │       ├── comparison-view/
│   │       ├── alert-banner/
│   │       ├── file-uploader/
│   │       ├── search-panel/
│   │       ├── message-composer/
│   │       ├── video-room/           # Zoom Video SDK session (ported from Oaklet Suite)
│   │       └── index.ts
│   │
│   ├── ai/                           # AI client + agents (Node.js)
│   │   └── src/
│   │       ├── gateway.ts            # LLM routing (Haiku/Sonnet)
│   │       ├── cache.ts              # Response caching
│   │       ├── batch.ts              # Batch API client
│   │       ├── budget.ts             # Per-org token budget tracking
│   │       ├── prompts/              # Versioned prompt templates
│   │       │   ├── vacancy-writer.ts
│   │       │   ├── cv-parser.ts
│   │       │   ├── gap-analyst.ts
│   │       │   ├── interview-coach.ts
│   │       │   ├── interview-summarizer.ts
│   │       │   ├── bias-detector.ts
│   │       │   ├── medical-analyzer.ts
│   │       │   ├── chatbot.ts
│   │       │   └── ... (32 agents)
│   │       └── agents/               # Agent orchestration
│   │           ├── types.ts
│   │           ├── registry.ts
│   │           └── invoke.ts
│   │
│   ├── auth/                         # Supabase Auth utilities
│   │   └── src/
│   │       ├── client.ts
│   │       ├── server.ts
│   │       └── middleware.ts
│   │
│   ├── email/                        # AWS SES client
│   │   └── src/
│   │       ├── client.ts
│   │       └── templates/
│   │
│   ├── whatsapp/                     # WhatsApp Business client
│   │   └── src/
│   │       └── client.ts
│   │
│   ├── video/                        # Zoom Video SDK wrapper (ported from Oaklet Suite)
│   │   └── src/
│   │       ├── client.ts             # ZoomVideo.createClient() + init
│   │       ├── signature.ts          # JWT signature generation (server-side)
│   │       └── types.ts              # ZoomUser, ZoomStream, etc.
│   │
│   ├── storage/                      # Supabase Storage wrapper
│   │   └── src/
│   │       └── client.ts
│   │
│   ├── events/                       # Event definitions + Trigger.dev
│   │   └── src/
│   │       ├── definitions.ts        # All event types
│   │       └── emit.ts               # Event emitter
│   │
│   ├── i18n/                         # Shared translations
│   │   └── messages/
│   │       ├── es.json
│   │       └── en.json
│   │
│   └── shared/                       # Types, utils, constants
│       └── src/
│           ├── types/
│           ├── constants/
│           ├── validators/           # Shared Zod schemas
│           └── utils/
│
├── workers/                          # Trigger.dev job definitions
│   ├── src/
│   │   ├── assessment-sync.ts        # Sync with TIMS assessment APIs
│   │   ├── notification.ts           # Send emails, WhatsApp, push
│   │   ├── sla-checker.ts            # Cron: check SLA breaches
│   │   ├── ai-batch-processor.ts     # Process batch AI results
│   │   ├── analytics-aggregator.ts   # Aggregate source analytics
│   │   ├── hris-sync.ts              # HRIS data sync (Phase 10)
│   │   └── ... (added per phase)
│   └── trigger.config.ts
│
├── docs/
│   ├── ARCHITECTURE.md               # This file
│   ├── API.md                        # Endpoint documentation
│   └── DECISIONS.md                  # ADR log
│
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── .env.example
└── .gitignore
```

---

## 7. Database Strategy

### Phase-Based Schema Design

Only build tables needed per phase. Total at MVP (Phases 0-3): ~45 tables.

```
PHASE 0 — Foundation (~12 tables)
  organizations, companies, business_units, teams,
  users, roles, permissions, role_permissions, user_roles,
  feature_flags, sessions, audit_logs

PHASE 1 — ATS Core (~14 tables, total: ~26)
  positions, job_requisitions, approval_flows,
  vacancies, job_profiles, publication_channels,
  candidates, candidate_profiles, candidate_documents,
  applications, pipeline_stages, stage_movements,
  stage_checklists, stage_slas

PHASE 2 — Assessments & FIT (~12 tables, total: ~38)
  assessments, assessment_assignments, assessment_sessions,
  assessment_results, proctoring_sessions, proctoring_events,
  scorecards, candidate_tags,
  fit_models, fit_model_weights, fit_scores, prediction_outputs

PHASE 3 — Interviews & Offers (~12 tables, total: ~50)
  interviews, interview_guides, interview_scorecards,
  interview_transcripts, interview_summaries,
  offers, offer_approvals,
  preemployment_checks, medical_documents, medical_reviews,
  legal_checklists, hire_transitions

PHASES 4-10 — Remaining (~150 tables added incrementally)
  Added module by module as each phase ships.
```

### Key Schema Patterns

```
EVERY TABLE:
  id                  UUID DEFAULT gen_random_uuid()
  organization_id     UUID NOT NULL (RLS filter)
  created_at          TIMESTAMPTZ DEFAULT now()
  updated_at          TIMESTAMPTZ DEFAULT now()
  created_by          UUID REFERENCES users(id)

SOFT DELETES (user-facing entities only):
  deleted_at          TIMESTAMPTZ NULL

FLEXIBLE CONFIG:
  settings            JSONB DEFAULT '{}'

STATUS FIELDS:
  status              TEXT (Prisma enum) — not DB enum (easier to migrate)

AUDIT ON SENSITIVE TABLES:
  last_accessed_by    UUID
  access_count        INTEGER DEFAULT 0
```

### Indexing Strategy

```
ALWAYS INDEX:
  - organization_id (RLS filter, every query)
  - status (frequently filtered)
  - created_at (sorting, time-based queries)
  - Foreign keys (Prisma does NOT auto-index these)

COMPOUND INDEXES:
  - (organization_id, status) on high-volume tables
  - (vacancy_id, current_stage_id) on applications
  - (candidate_id, vacancy_id) UNIQUE on applications

PARTIAL INDEXES:
  - WHERE deleted_at IS NULL (skip soft-deleted rows)
  - WHERE status = 'active' (common filter)
```

---

## 8. API Layer

### tRPC Architecture

```
packages/api/src/
  ├── root.ts           # Root router (merges all sub-routers)
  ├── context.ts        # Request context (user, org, permissions)
  ├── middleware/
  │   ├── auth.ts       # Validate Supabase JWT, extract user
  │   ├── rls.ts        # Set org_id on Prisma client
  │   ├── permissions.ts # Check role + permission for action
  │   └── audit.ts      # Log sensitive data access
  └── routers/
      ├── vacancy.ts    # CRUD + approval + AI generate + publish
      ├── pipeline.ts   # Kanban, stage moves, command center
      ├── candidate.ts  # Profile, documents, tags, search
      ├── assessment.ts # Assign, results, compare, proctoring
      ├── interview.ts  # Schedule, scorecards, transcripts, AI
      ├── offer.ts      # Create, approve, send, accept
      ├── fit.ts        # Calculate, rank, weights, simulate
      ├── portal.ts     # Candidate-facing (register, apply, status)
      ├── organization.ts # Org/company/unit/team CRUD
      ├── user.ts       # User management, roles
      └── ... (added per phase)
```

### API Design Rules

```
1. Cursor-based pagination (not offset) for all list endpoints
2. Prisma-style filtering via Zod-validated input schemas
3. All mutations emit domain events via packages/events
4. Response shape: { data, meta? } (no envelope on queries)
5. Error shape: TRPCError with code + message
6. All inputs validated with Zod (shared validators in packages/shared)
7. No business logic in routers — call service functions
```

### Middleware Chain

```
Every tRPC procedure:

  1. auth()        → Validate JWT, get user from Supabase
  2. rls(orgId)    → Create tenant-scoped Prisma client
  3. permission()  → Check user role has required permission
  4. audit()       → Log if accessing sensitive data (Level 3-4)
  5. handler()     → Execute business logic
  6. event()       → Emit domain event (in handler, post-mutation)
```

---

## 9. Auth & Permissions

### Auth Flow

```
ADMIN USERS (HR, Leaders, Employees):
  Browser → Supabase Auth (email/password or SSO)
  → JWT with custom claims: { org_id, user_id, roles[] }
  → Stored in httpOnly cookie
  → Validated in tRPC auth middleware

CANDIDATES:
  Portal → Supabase Auth (email/password, no SSO)
  → JWT with claims: { org_id, candidate_id, role: "candidate" }
  → Stored in httpOnly cookie

SSO PROVIDERS:
  - Google Workspace (via Supabase)
  - Microsoft Entra ID (via Supabase)
  - SAML (enterprise, via Supabase Pro)

MFA:
  - Required for: Super Admin, HR Admin, HRBP
  - Optional for: others
  - Method: TOTP (authenticator app) via Supabase
```

### Permission Model

```typescript
// packages/shared/src/types/permissions.ts

type Module =
  | 'vacancy' | 'pipeline' | 'assessment' | 'interview'
  | 'offer' | 'candidate' | 'onboarding' | 'performance'
  | 'coaching' | 'evaluation' | 'commitment' | 'ninebox'
  | 'talent' | 'team' | 'engagement' | 'lnd'
  | 'compensation' | 'monitoring' | 'dei' | 'organization'
  | 'billing' | 'integration' | 'audit'

type Action = 'create' | 'read' | 'update' | 'delete' | 'approve'

type Scope = 'own' | 'team' | 'unit' | 'company' | 'organization'

// Permission check in middleware:
// Can user X perform action Y on module Z within scope W?
```

### 9 Roles (Hierarchical)

```
ROLE              DEFAULT SCOPE    MODULES
────────────────  ──────────────   ──────────────────────────────
super_admin       organization     ALL (full access)
hr_admin          organization     ALL HR modules
hrbp              unit             Assigned units, all HR modules
recruiter         organization     ATS modules only
leader            team             Own team + assigned vacancies
committee         none             Review panels only (evaluation, calibration)
employee          own              Self-service (own data, courses, evals)
candidate         own              Portal only (own applications)
external          api              API access, results only
```

---

## 10. AI Architecture (Cost-Optimized)

### AI Pipeline (Every Call)

```
Agent Request
    │
    ▼
┌─────────────────┐
│ 1. BUDGET CHECK  │ ← Is org within monthly AI budget?
│    If over limit  │   → Return cached/degraded response
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ 2. RESPONSE      │ ← Hash(agent_type + key_inputs)
│    CACHE CHECK   │   → If cache hit (TTL valid), return cached
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ 3. MODEL TIER    │ ← Route to Haiku or Sonnet based on agent
│    SELECTION     │   (config table, not hardcoded)
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ 4. CONTEXT TRIM  │ ← Send only relevant fields, not full objects
│                  │   CV summary (400 tokens) not full CV (2000)
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ 5. PROMPT CACHE  │ ← Anthropic cache_control on system prompt
│    (Anthropic)   │   90% off input tokens after first call
└────────┬────────┘
         │
    ▼
┌─────────────────┐     ┌───────────────────┐
│ 6. BATCH OR      │────▶│ BATCH API (async)  │ 50% off
│    REAL-TIME?    │     │ Results via webhook │
│                  │────▶│ REAL-TIME (stream)  │ Full price
└────────┬────────┘     └───────────────────┘
         │
    ▼
┌─────────────────┐
│ 7. VALIDATE      │ ← Check output against Zod schema
│    OUTPUT        │   If invalid → retry once with Sonnet
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ 8. LOG & TRACK   │ ← Store: tokens, cost, latency, model
│                  │   Update org budget tracker
└─────────────────┘
```

### Model Routing Table

```
AGENT                        MODEL     BATCH?   CACHE TTL   COST/CALL
───────────────────────────  ────────  ───────  ──────────  ─────────
CV Parser              ★MVP  Haiku     Yes      none        $0.003
Vacancy Writer         ★MVP  Sonnet    Yes      30 days     $0.02
Gap Analyst            ★MVP  Sonnet    Yes      none        $0.025
Candidate Comparator   ★MVP  Sonnet    Yes      none        $0.02
Interview Coach        ★MVP  Sonnet    Yes      7 days      $0.015
Interview Summarizer   ★MVP  Sonnet    Yes      none        $0.02
Bias Detector          ★MVP  Sonnet    Yes      none        $0.015
Recruiter Assistant    ★MVP  Haiku     No*      1 hour      $0.004
Candidate Chatbot      ★MVP  Haiku     No*      24 hours    $0.003
SLA Monitor            ★MVP  Haiku     Yes      none        $0.001
Attraction Advisor     ★MVP  Haiku     Yes      7 days      $0.003
Employer Brand               Haiku     Yes      30 days     $0.005
Leader Briefer               Sonnet    Yes      none        $0.03
Auto-Assigner                Haiku     Yes      7 days      $0.003
Talent Scout                 Haiku     Yes      7 days      $0.005
Mobility Recommender         Haiku     Yes      7 days      $0.005
Pool Nurturer                Haiku     Yes      none        $0.003
Referral Manager             Haiku     Yes      none        $0.003
Assessment Guide             Haiku     Yes      30 days     $0.003
Offer Companion              Haiku     No*      24 hours    $0.005
Onboarding Bridge            Haiku     Yes      none        $0.003
Bottleneck Analyst           Haiku     Yes      none        $0.008
QoH Analyst                  Sonnet    Yes      none        $0.04
Recalibration Advisor        Sonnet    Yes      none        $0.04
Coaching Summarizer          Sonnet    Yes      none        $0.04
Feedback Recommender         Haiku     Yes      none        $0.005
Movement Predictor           Haiku     Yes      none        $0.008
Scenario Simulator           Haiku     No*      none        $0.008
Sentiment Analyzer           Haiku     Yes      none        $0.005
Retention Predictor          Haiku     Yes      none        $0.008
Composition Advisor          Haiku     Yes      none        $0.005
Ideal Hire Profiler          Sonnet    Yes      7 days      $0.03
Risk Prioritizer             Haiku     Yes      none        $0.005
Next-Best-Action             Haiku     No*      1 hour      $0.008
Executive Narrator           Sonnet    Yes      none        $0.04
Path Recommender             Haiku     Yes      7 days      $0.005
Fairness Auditor             Sonnet    Yes      none        $0.04
Medical Document Analyzer    Sonnet    Yes      none        $0.05

* No* = Must be real-time (user-facing, interactive)

MODEL SPLIT:   19 Haiku (59%)  |  13 Sonnet (41%)  |  0 Opus   (★11 MVP agents)
BATCH SPLIT:   32 batch-eligible (83%)  |  6 real-time only (17%)
```

### Cost Tracking Schema

```
ai_budgets
  id                UUID PK
  organization_id   UUID FK
  monthly_budget    DECIMAL(10,2)     -- USD limit
  current_spend     DECIMAL(10,2)     -- running total
  alert_at          DECIMAL(3,2)      -- 0.80 = alert at 80%
  hard_limit        BOOLEAN           -- stop or just alert?
  period_start      DATE

ai_invocations
  id                UUID PK
  organization_id   UUID FK
  agent_type        VARCHAR(50)
  model_used        VARCHAR(30)       -- haiku-4.5, sonnet-4.6
  batch             BOOLEAN
  cached            BOOLEAN           -- response cache hit
  prompt_cached     BOOLEAN           -- Anthropic prompt cache
  tokens_input      INTEGER
  tokens_output     INTEGER
  cost_usd          DECIMAL(10,6)
  latency_ms        INTEGER
  status            TEXT              -- success, error, cache_hit
  created_at        TIMESTAMPTZ
  -- PARTITIONED BY created_at (monthly) for fast aggregation
```

### Cost Projections (Fully Optimized)

**Scale clarification**: This is primarily TIMS International's platform, not a
100-client SaaS. 100K+ candidates accumulate over the platform's lifetime, not
monthly. Realistic monthly active: 500-2,000 candidates/mo at peak.

```
                    LAUNCH         GROWTH          MAX SCALE
                    <500 cands/mo  ~1K cands/mo    ~2K cands/mo
────────────────    ───────────    ────────────    ────────────
Before optimization $60/mo         $150/mo         $300/mo

After (all optimizations stacked):
  Haiku routing     -50%           -50%            -50%
  Prompt caching    -30%           -35%            -40%
  Batch API         -35%           -38%            -40%
  Response caching  -20%           -25%            -30%
  Context trimming  -15%           -15%            -15%

OPTIMIZED TOTAL     $15-30/mo      $30-60/mo       $60-120/mo

WITH RESPONSE CACHE (20-30% hit rate):
                    $10-25/mo      $25-45/mo       $45-100/mo
```

### MVP Agent Cost Detail (11 Agents, at Max Scale ~2K candidates/mo)

```
AGENT                   MODEL    BATCH  CALLS/MO  COST/CALL  MONTHLY
──────────────────────  ───────  ─────  ────────  ─────────  ───────
CV Parser               Haiku    Yes    2,000     $0.003     $6
Vacancy Writer          Sonnet   Yes    50        $0.02      $1
Gap Analyst             Sonnet   Yes    2,000     $0.025     $50
Candidate Comparator    Sonnet   Yes    500       $0.02      $10
Interview Coach         Sonnet   Yes    200       $0.015     $3
Interview Summarizer    Sonnet   Yes    200       $0.02      $4
Bias Detector           Sonnet   Yes    200       $0.015     $3
Recruiter Assistant     Haiku    No*    1,000     $0.004     $4
Candidate Chatbot       Haiku    No*    3,000     $0.003     $9
SLA Monitor             Haiku    Yes    4,000     $0.001     $4
Attraction Advisor      Haiku    Yes    50        $0.003     $0.15
──────────────────────  ───────  ─────  ────────  ─────────  ───────
TOTAL (before cache)                                         ~$94/mo
WITH RESPONSE CACHE (20-30% hit rate)                       ~$65-75/mo
```

---

## 11. Real-Time & Background Jobs

### Supabase Realtime (Replaces Socket.io + Redis)

```
CHANNEL PATTERN                EVENTS                           PHASE
───────────────────────────    ──────────────────────────────   ─────
vacancy:{vacancyId}            candidate_moved, sla_breach      1
user:{userId}                  notification, task_assigned       1
org:{orgId}                    broadcast (system alerts)         1
assessment:{sessionId}         proctoring_event, completed       2
interview:{interviewId}        video_joined, scorecard_submitted 3
team:{teamId}                  coaching_scheduled, recognition   6

IMPLEMENTATION:
  Supabase postgres_changes → listen to INSERT/UPDATE on tables
  + Supabase broadcast channel for custom events

  Client: @supabase/supabase-js realtime subscription
  Server: Trigger.dev jobs emit via Supabase broadcast API
```

### Background Jobs (Trigger.dev)

```
JOB                           TRIGGER                    PHASE
───────────────────────────   ────────────────────────   ─────
send-notification             event: any notification     1
send-whatsapp                 event: whatsapp.send        1
check-sla-breaches            cron: every 15 min          1
aggregate-source-analytics    cron: daily                 1
sync-tims-assessment          event: assessment.completed  2
process-ai-batch-results      webhook: Anthropic batch     2
run-cv-parser                 event: application.created   2
calculate-fit-score           event: assessment.completed  2
generate-interview-summary    event: scorecard.submitted   3
process-medical-document      event: medical.uploaded      3
check-offer-expirations       cron: daily                 3
run-engagement-analysis       event: survey.completed      8
calculate-ninebox             event: eval_cycle.closed     7
run-fairness-audit            cron: weekly                 9
sync-hris                     cron: configurable          10
```

---

## 12. Video & Communication

### Video Interviews (Zoom Video SDK — In-App)

```
APPROACH: In-app video sessions using Zoom Video SDK (@zoom/videosdk)
          Ported from NexaDev's Oaklet Suite project (tafurfede/OSF on GitHub)

HOW IT WORKS:
  1. Recruiter creates interview in TIMS platform
  2. Platform generates Zoom Video SDK session (JWT signed server-side)
  3. Candidate receives interview link via email/WhatsApp
  4. Both join in-app video room (no external app needed)
  5. Recruiter sees: video (left) + scorecard/notes (right) — split layout
  6. AI Interview Coach shows real-time prompts on the side panel
  7. AI Bias Detector flags potentially biased language
  8. On session end: AI Interview Summarizer processes scorecard + notes

LAYOUT (same as Oaklet Suite VideoSession.tsx):
  ┌──────────────────────────────────────────────────────────────┐
  │ ┌─────────┐  ┌─────────────────────┐  ┌──────────────────┐  │
  │ │ Self    │  │ Candidate Info      │  │ Interview        │  │
  │ │ Video   │  │ (name, position,    │  │ Scorecard        │  │
  │ │ (18%)   │  │  FIT score, assess) │  │ (structured form │  │
  │ └─────────┘  └─────────────────────┘  │  competencies,   │  │
  │ ┌────────────────────────────────────┐│  ratings, notes)  │  │
  │ │                                    ││                    │  │
  │ │  Participant Video                 ││ AI Coach prompts   │  │
  │ │  (expandable)                      ││ Bias alerts        │  │
  │ │                                    ││ Past notes         │  │
  │ └────────────────────────────────────┘│                    │  │
  │  [🎥 Video] [🎤 Audio] [📝 Notes] [💬 Chat] [🚪 Leave]  │  │
  │                                       └──────────────────┘  │
  └──────────────────────────────────────────────────────────────┘

ZOOM VIDEO SDK (not Zoom Meetings API):
  - Lower-level SDK for custom video experiences
  - No Zoom UI, no Zoom branding — fully custom
  - JWT signature generated server-side (SDK Key + Secret)
  - Works in browser, no app download required
  - Supports: video, audio, screen share, chat, recording

COST (session-minutes model):
  Free tier: 10,000 session minutes/mo
  Overage:   $0.0035/minute

  Interview = ~45 min × 2 participants = ~90 session-minutes

  Launch (<500 candidates/mo):  ~100-150 interviews = ~$0/mo (free tier)
  Growth (~1K candidates/mo):   ~200-300 interviews = ~$0-25/mo
  Max (~2K candidates/mo):      ~400-600 interviews = ~$50-125/mo

IMPLEMENTATION:
  packages/video/src/client.ts    → ZoomVideo.createClient() + init
  packages/video/src/signature.ts → JWT generation (tRPC server procedure)
  packages/video/src/types.ts     → ZoomUser, ZoomStream interfaces
  packages/ui/src/video-room/     → React component (ported from Oaklet)

SOURCE CODE REFERENCE:
  tafurfede/OSF (GitHub) → frontend/src/pages/telehealth/VideoSession.tsx
  ~1,200 lines, already working — port to Next.js 'use client' component
```

### Async Video (Candidate Self-Recording)

```
  Candidate records via MediaRecorder API (browser)
  → Upload to Supabase Storage (async-video/ bucket)
  → No external service cost
```

### Email (AWS SES)

```
Transactional only. No marketing emails.

TEMPLATES:
  - Assessment invitation
  - Interview invitation
  - Offer letter
  - Application status update
  - Password reset
  - Onboarding tasks
  - Reminder (SLA, overdue)

COST: $0.10 per 1,000 emails
  At ~2K candidates/mo: ~5-20K emails/mo = $1-5/mo (negligible)
```

### WhatsApp (Business Cloud API)

```
USE CASES:
  - Assessment invitation (utility template)
  - Interview reminder (utility template)
  - Application status update (utility template)
  - Candidate chatbot (service message, after candidate initiates)

PRICING (2025-2026, Colombia market):
  - Service conversations: FREE (candidate-initiated within 24h)
  - Utility templates within 24h window: FREE (since July 2025)
  - Marketing templates: ~$0.014/msg (Colombia)
  - Most messages are service/utility, NOT marketing

COST ESTIMATE:
  Launch (<500 candidates/mo): $2-5/mo
  Growth (~1K candidates/mo): $5-15/mo
  Max (~2K candidates/mo): $10-30/mo

  (vs. old estimate of $500-800 which assumed all messages cost $0.05-0.08)

IMPLEMENTATION:
  packages/whatsapp/src/client.ts → WhatsApp Cloud API
  Template messages require pre-approval from Meta
  Session messages (chatbot) are free within 24h window
```

### E-Signature (OpenSign — Open Source)

```
REPLACES: DocuSign API ($50-480/mo)

OpenSign is open-source, ESIGN Act + UETA compliant (legally binding).
Self-hosted or free cloud tier.

USE CASES:
  - Offer letter signing
  - Employment contracts
  - NDA / confidentiality agreements
  - Onboarding document acknowledgments

COST: $0/mo (self-hosted or free tier)

IMPLEMENTATION:
  - OpenSign API integration or embed
  - Signed documents stored in Supabase Storage (documents/ bucket)
  - Audit trail stored in platform database
```

---

## 13. File Storage & CDN

### Supabase Storage

```
BUCKETS:
  resumes/           ← Candidate CVs (private, signed URLs)
  documents/         ← Contracts, signed docs, medical docs (private, encrypted)
  avatars/           ← Profile photos (public CDN)
  career-assets/     ← Career page images/videos (public CDN)
  exports/           ← Generated reports (private, TTL: 24h)
  async-video/       ← Candidate async video responses (private)

POLICIES:
  - resumes: org members with candidate:read permission
  - documents: org members with document:read permission + audit log
  - avatars: public read, authenticated write
  - career-assets: public read, hr_admin write
  - async-video: org members with candidate:read permission

COST: Supabase Pro includes 100GB storage + 250GB bandwidth
  Additional: $0.021/GB storage, $0.09/GB bandwidth
  At ~2K candidates/mo: well within Pro limits (no recordings = much less storage)
  100K candidates × ~500KB avg docs = ~50GB (years of data)
```

---

## 14. External Integrations

### Integration Priority by Phase

```
PHASE 1 (MUST HAVE):
  ├── AWS SES (email)
  ├── WhatsApp Business Cloud API
  ├── Supabase Auth (SSO: Google, Microsoft)
  └── Stripe (billing — can be Phase 3 if manual billing initially)

PHASE 2 (MUST HAVE):
  ├── TIMS Assessment APIs (PCA, MIL, Integrity, Personality, IE)
  ├── TIMS JCA API (job profiles)
  └── AWS Bedrock (Claude — AI agents)

PHASE 3 (MUST HAVE):
  ├── Zoom Video SDK (in-app video interviews, ported from Oaklet Suite)
  ├── Google Calendar API (scheduling)
  ├── Microsoft Graph API (Outlook calendar)
  └── OpenSign (e-signature, open-source)

PHASE 4 (NICE TO HAVE):
  ├── LinkedIn Jobs API (post vacancies)
  ├── Google Jobs (structured data, free)
  ├── Indeed API
  └── Local boards (Computrabajo, Bumeran)

PHASE 10 (ENTERPRISE):
  ├── HRIS connectors (Workday, SAP, BambooHR)
  ├── Power BI embed (optional)
  └── SAML SSO (via Supabase Enterprise)
```

### TIMS Assessment API Integration Pattern

```
APPROACH: Trigger.dev job calls TIMS APIs, stores results locally

1. Recruiter assigns assessment in TIMS platform
2. Platform creates assessment_assignment record
3. Candidate takes test via embedded player
4. Player submits responses to TIMS assessment API
5. TIMS API returns scores
6. Trigger.dev job:
   a. Stores raw results in assessment_results.raw_data (JSONB)
   b. Maps scores to normalized format in score_map
   c. Triggers AI gap analysis (batch)
   d. Triggers FIT recalculation
   e. Emits assessment.completed event

FALLBACK: If TIMS API is down, queue and retry (Trigger.dev handles this)
```

---

## 15. Deployment & Infrastructure

### Environments

```
ENVIRONMENT    URL                        DATABASE           PURPOSE
───────────    ────────────────────────   ────────────────   ──────────
Development    localhost:3000             Supabase local     Dev
Preview        pr-{n}.tims-ats.     Supabase staging   PR review
               vercel.app
Staging        staging.tims.com          Supabase staging   QA/demo
Production     app.tims.com /            Supabase prod      Live
               {client}.tims.com
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# On every PR:
  - pnpm install (cached)
  - turbo lint
  - turbo type-check
  - turbo test (Vitest)
  - Vercel preview deploy

# On merge to main:
  - All of above
  - Prisma migrate deploy (staging → production)
  - Vercel production deploy
  - Trigger.dev deploy (workers)
  - Sentry release

# On schedule (daily):
  - Dependency audit
  - Type coverage report
```

### Domain Setup

```
DNS (Vercel):
  app.tims.com          → Vercel (admin)
  *.tims.com            → Vercel (wildcard for client portals)
  api.tims.com          → Vercel (API, optional — can use /api/trpc)
  staging.tims.com      → Vercel (staging)

Middleware resolves:
  app.tims.com          → route to (admin) group
  {anything}.tims.com   → lookup org by slug → route to (portal) group
```

---

## 16. Cost Model

> **Revised 2026-05-25** — Updated with real 2025-2026 pricing, corrected scale
> assumptions, and removed unnecessary services.

### Scale Assumptions

```
This is primarily TIMS International's platform, NOT a 100-client SaaS.

  - 100K+ candidates accumulate over the platform's LIFETIME, not monthly
  - Realistic monthly active: 500-2,000 candidates/mo at peak
  - HR staff users: 20-100 concurrent
  - Monthly email volume: 5-20K emails/mo
  - WhatsApp: mostly free (service + utility within 24h window)
  - Video interviews: ~20-30% of candidates reach interview stage
  - Zoom Video SDK: 10,000 free session-minutes/mo
```

### Monthly Infrastructure Cost

```
                         LAUNCH         GROWTH          MAX SCALE
SERVICE                  (<500/mo)      (~1K/mo)        (~2K+/mo)
───────────────────────  ────────────   ────────────    ────────────
Supabase Pro             $25            $25             $25-50
Vercel Pro (1 seat)      $20            $20             $20
AI (Bedrock, optimized)  $15-30         $30-60          $60-120
Zoom Video SDK           $0 (free)      $0-25           $50-125
AWS SES                  $1             $2-3            $3-5
WhatsApp                 $2-5           $5-15           $10-30
Trigger.dev              $0 (free)      $0-10           $10-20
Sentry                   $0 (free)      $0 (free)       $0 (free)
OpenSign (e-sign)        $0 (free)      $0 (free)       $0 (free)
Domain + SSL             $15            $15             $15
Stripe fees              Variable       Variable        Variable
───────────────────────  ────────────   ────────────    ────────────
TOTAL                    $78-96/mo      $97-173/mo      $193-405/mo
```

### What Changed vs. Previous Estimate

```
SERVICE              OLD ESTIMATE (max)   NEW ESTIMATE (max)   WHY
──────────────────   ──────────────────   ──────────────────   ────────────────────
WhatsApp             $500-800/mo          $10-30/mo            Service msgs FREE, utility FREE in 24h
Daily.co             $200-300/mo          $50-125/mo           Zoom Video SDK: 10K free min, $0.0035 after
AWS Transcribe       $100-200/mo          $0/mo                Removed — summarize from scorecards
DocuSign             $100/mo              $0/mo                REPLACED by OpenSign (open-source)
AI (Bedrock)         $400-700/mo          $60-120/mo           Real volume ~2K/mo, not 20K/mo
Supabase             $75/mo               $25-50/mo            Pro plan sufficient (8GB DB, 100GB)
Trigger.dev          $60-100/mo           $0-20/mo             Free tier: $5 credit, 20 concurrent
Sentry               $30/mo               $0/mo                Free tier: 5K errors/mo sufficient
──────────────────   ──────────────────   ──────────────────   ────────────────────
TOTAL (max scale)    $1,530-2,370/mo      $193-405/mo          73-83% savings
```

### Comparison Across All Revisions

```
                    ORIGINAL PLAN       FIRST OPTIMIZED     REVISED (CURRENT)
Launch              $3,400-11,000/mo    $200-330/mo         $78-96/mo
Growth              $8,000-25,000/mo    $745-1,165/mo       $97-173/mo
Max scale           Not estimated       $1,530-2,370/mo     $193-405/mo

TARGET: Under $500/mo at max scale — ACHIEVED at $193-405/mo
  (includes in-app video interviews via Zoom Video SDK)
```

### Revenue vs. Cost

```
Assuming TIMS International as primary client, $15/user/month:

  20 HR users  = $300 MRR   vs. ~$85/mo cost  = 72% margin  (launch, video free)
  50 HR users  = $750 MRR   vs. ~$135/mo cost = 82% margin  (growth)
  100 HR users = $1,500 MRR vs. ~$300/mo cost = 80% margin  (max, with video overage)

If expanded to additional clients:
  5 clients × 30 users = $2,250 MRR vs. ~$200/mo = 91% margin

BREAK-EVEN: TIMS International alone covers all infrastructure costs.
```

---

## 17. Phasing & What Ships When

### MVP Phases (0-3): ~19-23 weeks

```
PHASE 0: Foundation (4-5 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Week 1: Monorepo + Supabase + Auth + Multi-tenant schema
  Week 2: Design system + shared components (DataTable, FormWizard, etc.)
  Week 3: tRPC skeleton + middleware chain + RLS
  Week 4: i18n + subdomain routing + CI/CD
  Week 5: Buffer / polish

  TABLES: ~12 (organization domain)
  SCREENS: Login, admin shell, settings skeleton

PHASE 1: ATS Core (5-6 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Week 1: Vacancy schema + API + wizard UI
  Week 2: Pipeline schema + Kanban + stage management
  Week 3: Candidate model + application flow + portal (basic)
  Week 4: Command Center + source analytics
  Week 5: WhatsApp + email integration
  Week 6: Buffer / testing

  TABLES: +14 (vacancy + candidate + pipeline)
  SCREENS: ~22 admin + ~10 portal
  AI AGENTS: Vacancy Writer, Inclusive Language Checker (2 agents)

  ── v3.0 MVP Gap Additions ──

  Module 1 — Attraction (enhanced):
    - Multichannel campaign manager: schedule, publish, and track across channels
    - Quality-of-Hire (QoH) by source: track which channels produce best hires
    - Cost per qualified candidate: ROI per channel and campaign
    - Inclusive language AI check: flag biased/exclusionary terms in vacancy descriptions

  Module 2 — Pipeline (enhanced):
    - Configurable SLA per stage (not just global): each client sets thresholds per stage
    - Recruiter productivity metrics: candidates processed, avg time per stage, SLA compliance
    - High-FIT at-risk highlights: surface top candidates stuck or at risk of dropping out
    - Structured next-best-action per candidate: AI recommends next step based on pipeline state

  Module 5 — Communication (enhanced):
    - Candidate NPS per stage: survey after key touchpoints (application, assessment, interview)
    - Consent tracking: granular opt-in/out for email, WhatsApp, SMS per candidate
    - Bulk messaging with merge tags: personalized mass communication
    - Chatbot human escalation: auto-escalate to recruiter when chatbot confidence is low

  Module 7 — Recruitment Analytics (enhanced):
    - Robust QoH scheduler: automated 30/60/90/180/365-day check-ins (lightweight, MVP version)
    - Time-to-fill prediction: AI estimates days remaining based on pipeline velocity
    - Long-term source quality: track QoH by source over time (not just volume)
    - Recruiter audit: who moved whom, when, with what justification (full audit trail)

  Module 12 — Candidate Portal (enhanced):
    - Privacy controls: candidates can request data deletion (GDPR/Habeas Data compliance)
    - Rejection feedback: configurable auto-feedback with personalized recommendations
    - Professional development library: public resources, courses, tips for candidates
    - Candidate NPS: post-process satisfaction survey

  Cross-cutting — DEI Fairness (partial, MVP):
    - Language bias detection in vacancy descriptions (AI-powered)
    - Selection rate analysis by demographic group (4/5ths rule dashboard)
    - AI decision audit log: every AI recommendation logged with rationale
    - Fairness report: monthly auto-generated DEI snapshot for HR Admin

  Cross-cutting — Security & Sensitive Data (MVP):
    - RBAC matrix for sensitive data: who can see psychometric scores, medical docs, etc.
    - Consent management: explicit consent tracking before collecting sensitive data
    - Anonymization mode: view aggregate data without identifying individuals (for analytics)
    - Psychometric audit trail: log every access to assessment results with viewer + timestamp

PHASE 2: Assessments & FIT (5-6 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Week 1: Assessment schema + TIMS API integration
  Week 2: Assessment player (embedded)
  Week 3: Proctoring (TensorFlow.js client-side)
  Week 4: FIT engine (rule-based) + ranking
  Week 5: Gap analysis + comparison views
  Week 6: AI agents (CV parser, gap analyst, auto-assigner)

  TABLES: +14 (assessment + fit + scoring)
  SCREENS: ~18 admin + ~6 portal (assessment player)
  AI AGENTS: +5 (CV Parser, Gap Analyst, Auto-Assigner, Comparator, chatbot)

  ── v3.0 MVP Gap Additions ──

  Module 3 — Assessments (enhanced):
    - All 5 TIMS tests in MVP: PCA, MIL, Integrity, Personality, IE (not "at least 2")
    - Score normalization: standardized 0-100 scale across all assessment types
    - Model versioning: track which scoring model version produced each result
    - Critical proctoring alerts: real-time escalation for high-severity events (not just log)
    - Score explainability: AI-generated plain-language interpretation of each assessment result

  Module 9 — FIT Engine (enhanced):
    - Sub-scores visible: break FIT into dimensions (cognitive, personality, experience, etc.)
    - Hierarchical weights: org-level defaults → position family → specific vacancy overrides
    - Incomplete data rules: calculate partial FIT when not all assessments are complete
    - QoH recalibration: adjust FIT weights based on QoH outcomes (feedback loop)

PHASE 3: Interviews & Offers (5-6 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Week 1: Interview scheduling + calendar integration
  Week 2: Zoom Video SDK integration (port from Oaklet Suite)
  Week 3: Video room layout — scorecard panel + AI coach sidebar
  Week 4: AI interview summary + bias detection
  Week 5: Offers + approval + OpenSign e-signature + pre-hire validations
  Week 6: Candidate → employee conversion

  TABLES: +14 (interview + offer + validation + quality)
  SCREENS: ~24 admin + ~4 portal
  AI AGENTS: +5 (Interview Coach, Summarizer, Bias Detector, Medical Analyzer, Offer Companion)

  ── v3.0 MVP Gap Additions ──

  Module 6 — Interviews (enhanced):
    - Interview quality checker: rate interview quality (structured questions asked, evidence documented)
    - Evaluator bias analytics: compare inter-rater reliability, flag outlier scores
    - Required evidence per competency: enforce that evaluators provide behavioral evidence
    - Question-to-competency traceability: map every interview question to assessed competency

  Module 10 — Validations (enhanced):
    - Blocking vs non-blocking rules: define which validations must pass before hire vs. advisory
    - Country-specific checklists: auto-load legal requirements based on company country
    - External verifier roles: third-party verifiers submit results directly via secure portal
    - Validation audit trail: full history of each check (who requested, who completed, when)

  Module 11 — Quality of Hire (enhanced):
    - QoH scheduler 30/60/90/180/365: automated check-ins with configurable survey templates
    - Performance/engagement connection: correlate QoH scores with performance reviews (when available)
    - Leader input: direct leader provides QoH input via simple survey
    - Source effectiveness: rank recruitment sources by long-term QoH (not just hire count)
    - QoH algorithm: weighted formula (performance + retention + cultural fit + leader satisfaction)

MVP TOTAL (v3.0):
  Tables: ~55
  Screens: ~64 admin + ~20 portal + ~8 assessment + video room = ~93 screens
  AI Agents: 12 of 32 (core ones + Inclusive Language Checker)
  Cross-cutting: DEI Fairness (partial) + Sensitive Data Controls
  Timeline: 19-23 weeks (includes in-app video)
```

### Post-MVP Phases (4-10): ~30-40 weeks

```
PHASE 4:  Talent Pools + Advanced Analytics    3-4 weeks    +10 screens, +7 tables
PHASE 5:  Onboarding                          4-5 weeks    +12 screens, +10 tables
PHASE 6:  Performance + Coaching              5-6 weeks    +14 screens, +14 tables
PHASE 7:  Eval 360 + Commitments + Nine Box   5-6 weeks    +22 screens, +22 tables
PHASE 8:  L&D + Engagement + Team Intel       6-8 weeks    +34 screens, +32 tables
PHASE 9:  Succession + Compensation + DEI     5-6 weeks    +28 screens, +24 tables
          + Strategic Monitoring
PHASE 10: HRIS/API + Enterprise               4-5 weeks    +18 screens, +14 tables

FULL PLATFORM: ~55-65 weeks total (~13-16 months)

See Section 19 for full functional annexes per phase.
```

### Post-MVP Acceptance Criteria (v3.0)

```
PHASE 4 — Talent Pools + Advanced Analytics
  ✓ Talent pool with smart search (filters + AI tags) returning results in <2s
  ✓ Re-engagement campaign sent to pooled candidates
  ✓ Recruitment funnel dashboard with real-time data
  ✓ Report builder generating PDF/Excel exports
  ✓ Source ROI report comparing cost-per-qualified-candidate across channels

PHASE 5 — Onboarding
  ✓ Onboarding plan auto-created from offer acceptance (30/60/90 day tasks)
  ✓ Digital document center with e-signature (contracts, NDA, policies)
  ✓ Buddy/mentor assignment functioning with notification
  ✓ Check-in surveys at 30/60/90 days with results visible to HRBP
  ✓ L&D route auto-generated from assessment gap analysis
  ✓ Onboarding completion rate dashboard

PHASE 6 — Performance + Coaching
  ✓ OKR creation with hierarchical alignment (team → unit → company)
  ✓ OKR progress tracking with automated check-in reminders
  ✓ Video coaching session within platform with AI summary
  ✓ Coaching log with extracted commitments linked to OKRs
  ✓ Peer recognition (kudos) system with leaderboard
  ✓ Performance cycle: goal setting → mid-cycle → final review

PHASE 7 — Eval 360 + Commitments + Nine Box
  ✓ 360 evaluation cycle: configure evaluators, launch, collect, close
  ✓ Anonymous responses with configurable anonymity threshold
  ✓ Individual 360 report with heatmap and sentiment analysis
  ✓ Commitment tracker with evidence upload and escalation rules
  ✓ KPI dashboard per employee with progress tracking
  ✓ Nine Box 3x3 grid populated from performance + potential data
  ✓ Calibration session tool for committees
  ✓ Nine Box simulator ("what-if" scenarios)

PHASE 8 — L&D + Engagement + Team Intelligence
  ✓ Course catalog with multimedia player (video, docs, quizzes)
  ✓ Learning paths with prerequisites and certifications
  ✓ Course completion tracked and linked to competency gaps
  ✓ Climate survey: create, distribute, collect, analyze with AI sentiment
  ✓ Pulse surveys (quick, recurring) with trend tracking
  ✓ Action plans from climate results with owner assignment and follow-up
  ✓ Team profile: competency balance radar, health score, composition simulator
  ✓ Ideal hire profile generated from team gaps

PHASE 9 — Succession + Compensation + DEI + Strategic Monitoring
  ✓ Talent map: visual org chart with potential/performance overlay
  ✓ Succession plan per critical role with readiness indicators
  ✓ Salary bands by role family with equity analysis
  ✓ Compensation adjustment workflow with approval chain
  ✓ Full DEI dashboard: diversity metrics, pay equity, selection rate parity
  ✓ AI fairness audit: automated bias detection across all AI models
  ✓ Strategic monitoring dashboard: executive KPIs across all modules
  ✓ Executive narrative AI: auto-generated board-ready summaries

PHASE 10 — HRIS/API + Enterprise
  ✓ REST API with OAuth2 + API key authentication
  ✓ Webhook system for event-driven integrations
  ✓ At least 1 HRIS connector (Workday or SAP) syncing employee data
  ✓ Billing: subscription plans, usage metering, Stripe invoicing
  ✓ Advanced audit log: searchable, filterable, exportable
  ✓ Consent management portal: employees manage their data preferences
  ✓ Data migration toolkit: CSV/JSON import with validation and rollback
  ✓ Power BI embed (optional) for custom reporting
```

---

## 18. Migration & Scale Triggers

### When to Add Complexity

```
TRIGGER                              ADD                        ESTIMATED TIMING
──────────────────────────────────   ────────────────────────   ────────────────
Supabase Realtime hits connection    Redis + Socket.io          50+ clients
  limits (~500 concurrent)

Need custom ML model training        Python FastAPI AI service  500+ QoH records
  (FIT v2, retention predictor)       on AWS ECS/Lambda         (~6-12 months)

Portal SEO requires independent      Separate Next.js app       If measured need
  caching / edge config               for portal only

Full-text search too slow on PG      pgvector + embeddings      Phase 4 (talent pools)
  (>100K candidates)

Need SAML SSO for enterprise         Supabase Enterprise plan   Phase 10
  clients

WhatsApp volume > 1000 msg/day       Message queue (SQS)        50+ clients

Zoom Video SDK free tier exceeded     Pay-as-you-go ($0.0035/min) ~400+ interviews/mo
  (>10K session-min/mo)               or self-host LiveKit
```

### Data Migration Plan

```
FROM TIMS LEGACY:
  1. Assessment historical data → assessment_results (JSONB raw_data)
  2. JCA profiles → positions + job_profiles
  3. Client configurations → organizations + feature_flags
  4. Candidate databases → candidates + candidate_profiles

APPROACH:
  - Build CSV/JSON import tool (admin settings screen)
  - Per-client migration, not big-bang
  - Validate data integrity post-import
  - Keep legacy system running in parallel during transition
```

---

## 19. Functional Annexes — Phases 4-10

> Full specifications for every post-MVP phase. Each annex includes: scope, key features,
> screens, database tables, domain events, acceptance criteria, and exclusions.

---

### Annex 1: Onboarding (Phase 5)

**Scope**: Structured new-hire onboarding from offer acceptance through probation completion.

**Key Features**:
```
1. Onboarding plan templates (30/60/90 day, configurable per role family)
2. Task assignment engine: auto-assign tasks to new hire, buddy, leader, HR, IT
3. Digital document center: upload, e-sign, acknowledge policies
4. Buddy/mentor assignment with automated introduction email
5. Check-in surveys at configurable milestones (default: 30/60/90 days)
6. L&D route auto-generation from assessment gap analysis
7. Onboarding dashboard: completion rate, bottlenecks, at-risk new hires
8. Pre-boarding: tasks assigned before day 1 (document upload, IT setup request)
```

**Screens**:
```
ADMIN:
  - Onboarding dashboard (completion rates, at-risk)
  - Plan template builder
  - Active onboarding list (filterable by status, department, buddy)
  - Individual onboarding detail (tasks, documents, check-ins)
  - Check-in survey results
  - Buddy assignment manager

PORTAL (NEW HIRE):
  - My onboarding: task list with deadlines
  - Document upload + e-sign center
  - Meet my buddy / team introduction
  - Check-in survey form

LEADER:
  - My team's onboarding status
  - Check-in survey input
```

**Database Tables** (~10):
```
onboarding_plans, onboarding_plan_templates, onboarding_tasks,
onboarding_task_assignments, onboarding_documents, onboarding_checkins,
onboarding_checkin_responses, buddy_assignments, onboarding_milestones,
preboarding_tasks
```

**Domain Events**:
```
onboarding.plan_created, onboarding.task_completed, onboarding.document_signed,
onboarding.checkin_submitted, onboarding.milestone_reached, onboarding.completed,
onboarding.at_risk_detected
```

**Acceptance Criteria**: See Post-MVP Acceptance Criteria (Phase 5).

**Exclusions**: Payroll integration (Phase 10), IT provisioning automation (future).

---

### Annex 2: Performance + Coaching (Phase 6)

**Scope**: OKR management, coaching sessions, peer recognition, performance review cycles.

**Key Features**:
```
1. OKR management: create, align (individual → team → unit → company), track progress
2. Performance review cycles: goal setting → mid-cycle check → final review
3. Coaching sessions via integrated video (Zoom Video SDK, same as interviews)
4. AI coaching summarizer: extract commitments + action items from session
5. Coaching log (bitacora): full history of leader-employee conversations
6. Peer recognition (kudos): send recognition tied to company values
7. Recognition leaderboard and history
8. Performance dashboard: OKR completion rates, coaching frequency, recognition activity
```

**Screens** (~14):
```
ADMIN/HR:
  - Performance cycle manager (create, configure, launch, close)
  - Organization OKR alignment view (tree)
  - Coaching analytics dashboard
  - Recognition analytics

LEADER:
  - My team's OKRs (progress, status)
  - Coaching scheduler + session room (video + notes)
  - Coaching log / bitacora per employee
  - Performance review form (mid-cycle, final)
  - Send recognition

EMPLOYEE:
  - My OKRs (create, update progress, add evidence)
  - My coaching sessions (history, commitments)
  - My performance reviews (self-assessment, view feedback)
  - Send/receive recognition
```

**Database Tables** (~14):
```
performance_cycles, okrs, okr_key_results, okr_progress_entries,
coaching_sessions, coaching_session_notes, coaching_commitments,
performance_reviews, performance_review_ratings, performance_review_comments,
recognitions, recognition_values, recognition_reactions, performance_dashboards
```

**Domain Events**:
```
performance.cycle_started, okr.created, okr.progress_updated,
coaching.session_completed, coaching.commitment_created,
performance.review_submitted, recognition.sent, performance.cycle_closed
```

**Exclusions**: 360 evaluation (Phase 7), compensation link (Phase 9).

---

### Annex 3: L&D / eLearning (Phase 8)

**Scope**: Course catalog, learning paths, certifications, competency development tracking.

**Key Features**:
```
1. Course catalog: video, documents, quizzes, SCORM-compatible
2. Multimedia player: in-app video playback with progress tracking
3. Learning paths: ordered sequences with prerequisites
4. Certifications: auto-issue on path completion, expiration tracking
5. AI course recommender: suggest courses based on competency gaps
6. Manager-assigned courses: leader assigns learning based on performance gaps
7. Course completion dashboard: by employee, team, department
8. Integration with competency model: courses tagged to competencies
```

**Screens** (~12):
```
ADMIN/HR:
  - Course management (CRUD, content upload)
  - Learning path builder
  - Certification manager
  - L&D analytics dashboard (completion rates, popular courses, gap coverage)
  - Assign courses to employees/groups

EMPLOYEE:
  - Course catalog browser (search, filter by competency)
  - My learning: assigned courses, progress, certifications
  - Course player (video + quiz)
  - My certifications

LEADER:
  - Team learning progress
  - Assign courses to team members
```

**Database Tables** (~12):
```
courses, course_modules, course_content, learning_paths,
learning_path_courses, course_enrollments, course_progress,
quiz_questions, quiz_responses, certifications, certification_awards,
course_competency_tags
```

**Domain Events**:
```
course.enrolled, course.module_completed, course.completed,
certification.awarded, certification.expired, learning_path.completed
```

**Exclusions**: External LMS integration (future), live virtual classroom (future).

---

### Annex 4: Evaluation 360 (Phase 7)

**Scope**: Multi-directional evaluation cycles with anonymity, heatmaps, and action plans.

**Key Features**:
```
1. Evaluation cycle configuration: define evaluator relationships (self, boss, peers, reports, clients)
2. Evaluator nomination: auto-suggest + manual override
3. Configurable questionnaires per competency with rating scales
4. Anonymity controls: configurable minimum respondents for anonymity threshold
5. Individual 360 report: radar chart, heatmap, blind spots, strengths
6. AI sentiment analysis on open-ended responses
7. Team-level heatmap: aggregate competency coverage across team
8. Action plan generation: AI suggests development actions based on 360 results
```

**Screens** (~8):
```
ADMIN/HR:
  - 360 cycle manager (create, configure evaluators, launch, close)
  - Cycle progress dashboard (response rates)
  - Organization-wide competency heatmap

EMPLOYEE:
  - Evaluate others (questionnaire)
  - My 360 results (report, radar, development suggestions)

LEADER:
  - Team 360 results overview
  - Individual employee 360 detail
```

**Database Tables** (~10):
```
eval360_cycles, eval360_cycle_participants, eval360_evaluator_assignments,
eval360_questionnaires, eval360_questions, eval360_responses,
eval360_response_items, eval360_reports, eval360_action_plans,
eval360_action_plan_items
```

**Domain Events**:
```
eval360.cycle_launched, eval360.evaluation_submitted, eval360.cycle_closed,
eval360.report_generated, eval360.action_plan_created
```

**Exclusions**: External evaluation vendors (future), competency model editor (Phase 10 settings).

---

### Annex 5: Commitments / KPIs (Phase 7)

**Scope**: Track commitments from coaching, 360, performance reviews with evidence and escalation.

**Key Features**:
```
1. Commitment creation from any source (coaching, 360, performance review, ad-hoc)
2. Due dates with automated reminders (configurable frequency)
3. Evidence upload: documents, links, screenshots proving completion
4. Escalation rules: overdue → notify leader → notify HRBP → flag in dashboard
5. KPI dashboard per employee: commitments completed, overdue, in progress
6. Team commitment overview for leaders
7. Link commitments to OKRs and competency development
8. Commitment history with audit trail
```

**Screens** (~4):
```
EMPLOYEE:
  - My commitments (list, filter by source/status, upload evidence)

LEADER:
  - Team commitments dashboard (status, overdue alerts)
  - Create/assign commitment

HR:
  - Commitment analytics (completion rates by department, escalation frequency)
```

**Database Tables** (~6):
```
commitments, commitment_evidence, commitment_reminders,
commitment_escalations, commitment_okr_links, commitment_history
```

**Domain Events**:
```
commitment.created, commitment.evidence_uploaded, commitment.completed,
commitment.overdue, commitment.escalated
```

**Exclusions**: Automated KPI calculation from external systems (Phase 10 HRIS).

---

### Annex 6: Nine Box Predictive (Phase 7)

**Scope**: Interactive 3x3 potential-vs-performance grid with AI prediction and calibration.

**Key Features**:
```
1. Nine Box 3x3 grid: visual placement based on performance + potential scores
2. Data sources: performance reviews, 360 results, OKR achievement, coaching engagement
3. AI movement predictor: predict likely box movement in next cycle
4. Calibration sessions: committee can drag-and-drop to adjust placements
5. Calibration audit trail: who moved whom, with justification
6. "What-if" simulator: test hypothetical scenarios without affecting real data
7. Historical tracking: see individual's box history over time
8. Action recommendations per box: e.g., "High Potential / Low Performance → coaching plan"
```

**Screens** (~6):
```
HR:
  - Nine Box grid (interactive, filterable by department/team)
  - Calibration session (committee view with drag-and-drop)
  - Nine Box history per employee
  - Simulator

LEADER:
  - My team Nine Box (read-only)
  - Individual employee detail (box history, recommendation)
```

**Database Tables** (~6):
```
ninebox_snapshots, ninebox_placements, ninebox_calibration_sessions,
ninebox_calibration_moves, ninebox_predictions, ninebox_action_recommendations
```

**Domain Events**:
```
ninebox.snapshot_created, ninebox.placement_calibrated, ninebox.prediction_generated,
ninebox.session_closed
```

**Exclusions**: Automated potential scoring from psychometrics (requires 500+ data points).

---

### Annex 7: Talent Maps & Succession (Phase 9)

**Scope**: Visual talent mapping, critical role identification, succession planning with readiness.

**Key Features**:
```
1. Critical role identification: flag roles where vacancy = high business risk
2. Succession plan per critical role: primary, secondary, emergency successors
3. Readiness indicators: ready now, ready in 1 year, ready in 2+ years
4. Development plan per successor: specific actions to close readiness gap
5. Talent map: visual org chart with performance/potential overlay
6. Risk dashboard: critical roles without successors, successors at risk of leaving
7. AI mobility recommender: suggest internal candidates for open critical roles
8. Succession pipeline health: overall organizational readiness score
```

**Screens** (~8):
```
HR:
  - Talent map (visual org chart with overlays)
  - Critical roles list
  - Succession plan per role (assign successors, set readiness)
  - Succession risk dashboard
  - Succession pipeline health

LEADER:
  - My team talent map
  - Succession plans for my critical roles

EXECUTIVE:
  - Strategic succession overview
```

**Database Tables** (~8):
```
critical_roles, succession_plans, succession_candidates,
succession_readiness_assessments, talent_map_snapshots,
development_plans, development_plan_actions, succession_risk_flags
```

**Domain Events**:
```
succession.plan_created, succession.candidate_assigned, succession.readiness_updated,
succession.risk_flagged, talent_map.snapshot_created
```

**Exclusions**: External assessment of successors (uses existing TIMS assessments).

---

### Annex 8: Team Intelligence (Phase 8)

**Scope**: Team composition analysis, competency balance, and hiring recommendations.

**Key Features**:
```
1. Team profile: aggregate competency radar from all team members
2. Competency balance analysis: strengths, gaps, redundancies
3. Team health score: engagement, retention risk, performance balance
4. Composition simulator: "what happens if person X leaves / person Y joins?"
5. Ideal hire profile: AI generates candidate profile to optimize team balance
6. Team comparison: compare teams across the organization
7. Leader dashboard: team-specific insights and recommendations
8. Historical team evolution: track how team composition changed over time
```

**Screens** (~6):
```
HR:
  - Team intelligence dashboard (all teams, comparison)
  - Team detail (competency radar, health score, members)

LEADER:
  - My team profile (radar, balance, health)
  - Composition simulator
  - Ideal hire profile for open positions
  - Team evolution history
```

**Database Tables** (~6):
```
team_profiles, team_competency_scores, team_health_metrics,
team_composition_snapshots, ideal_hire_profiles, team_comparisons
```

**Domain Events**:
```
team.profile_updated, team.health_calculated, team.ideal_hire_generated,
team.composition_changed
```

**Exclusions**: Cross-team mobility optimization (future, requires ML).

---

### Annex 9: Strategic Monitoring (Phase 9)

**Scope**: Executive dashboard aggregating KPIs from all modules for C-suite visibility.

**Key Features**:
```
1. Executive dashboard: top-level KPIs from recruitment, performance, talent, engagement
2. Drill-down: click any KPI to see detailed data by company/unit/team
3. AI executive narrator: generates board-ready summaries in natural language
4. Alert prioritization: AI ranks alerts by business impact
5. Trend analysis: historical KPI trends with prediction
6. Configurable dashboards: each executive can customize their view
7. Scheduled reports: auto-email weekly/monthly executive summary
8. Benchmark data: compare org metrics against industry (when available)
```

**Screens** (~6):
```
EXECUTIVE:
  - Strategic dashboard (configurable widgets)
  - KPI drill-down views
  - Alert center (prioritized by impact)

HR ADMIN:
  - Dashboard configuration
  - Scheduled report manager
  - AI narrative review and approval
```

**Database Tables** (~6):
```
strategic_dashboards, dashboard_widgets, dashboard_configurations,
strategic_kpis, strategic_alerts, scheduled_reports
```

**Domain Events**:
```
strategic.dashboard_viewed, strategic.report_generated, strategic.alert_created,
strategic.narrative_generated
```

**Exclusions**: External BI tool integration (Phase 10 optional Power BI embed).

---

### Annex 10: HRIS/API (Phase 10)

**Scope**: Public REST API, webhook system, HRIS connectors, billing, advanced audit.

**Key Features**:
```
1. REST API: full CRUD for all entities with OAuth2 + API key auth
2. Webhook system: subscribe to domain events, configurable per integration
3. HRIS connectors: Workday, SAP SuccessFactors, BambooHR (at least 1 at launch)
4. Data sync: bi-directional employee data synchronization on schedule
5. Billing: Stripe integration, subscription plans, usage metering, invoices
6. Advanced audit log: searchable, filterable, exportable, retention policies
7. Consent management: employee data preference portal (GDPR/Habeas Data)
8. Data migration toolkit: CSV/JSON import with validation, preview, rollback
9. API documentation: auto-generated OpenAPI spec + developer portal
10. Rate limiting and usage analytics per API consumer
```

**Screens** (~18):
```
ADMIN:
  - API key management
  - Webhook configuration
  - HRIS connector setup (Workday, SAP, BambooHR)
  - Sync status dashboard (last sync, errors, records)
  - Billing: plans, invoices, usage
  - Audit log viewer (search, filter, export)
  - Consent management settings
  - Data migration wizard

DEVELOPER:
  - API documentation portal
  - Webhook event explorer
  - API usage analytics

EMPLOYEE:
  - My data preferences (consent portal)
  - Data export request
```

**Database Tables** (~14):
```
api_keys, api_usage_logs, webhooks, webhook_deliveries,
hris_connectors, hris_sync_logs, hris_field_mappings,
billing_subscriptions, billing_invoices, billing_usage_records,
audit_logs_extended, consent_records, data_migration_jobs,
data_migration_validation_results
```

**Domain Events**:
```
api.key_created, webhook.delivered, hris.sync_completed, hris.sync_failed,
billing.invoice_created, billing.subscription_changed, audit.export_requested,
consent.updated, migration.completed
```

**Exclusions**: Custom connector SDK (future), real-time sync (batch only at launch).

---

### Annex 11: Security & Sensitive Data (Cross-cutting)

**Scope**: Data protection, access control for sensitive data, compliance frameworks.

**Key Features**:
```
1. RBAC matrix for sensitive data: granular permissions per data type per role
2. Data classification: 4 levels (Public, Internal, Confidential, Restricted)
3. Sensitive data access logging: who viewed what, when, from where
4. Consent management: explicit consent before collecting sensitive data
5. Data anonymization: strip PII for analytics and reporting
6. Data retention policies: configurable per data type, auto-archive/delete
7. Encryption: at rest (Supabase default) + in transit (TLS) + field-level for PII
8. GDPR/Habeas Data compliance: right to access, rectification, erasure
9. Breach notification framework: incident response playbook
10. Psychometric data protection: additional access controls for assessment results
```

**Implementation**:
```
MVP (Phases 0-3):
  - RBAC matrix for sensitive data (see Section 21)
  - Consent tracking table
  - Sensitive data access audit log
  - Field-level encryption for medical documents and psychometric raw data

Post-MVP (Phases 4-10):
  - Full anonymization engine
  - Data retention automation
  - Consent management portal (Phase 10)
  - Breach notification system
```

**Database Tables** (~6, added incrementally):
```
consent_records, data_access_logs, data_retention_policies,
data_classification_rules, anonymization_configs, breach_incidents
```

---

### Annex 12: Climate & Engagement (Phase 8)

**Scope**: Climate surveys, pulse surveys, culture assessment, action plans.

**Key Features**:
```
1. Climate survey builder: configurable questions, scales, demographic segmentation
2. Pulse surveys: short recurring surveys (weekly/biweekly)
3. AI sentiment analysis: extract themes and sentiment from open-ended responses
4. Results dashboard: by team, department, company with heatmaps
5. Trend tracking: compare results across survey cycles
6. Action plans: create improvement actions from survey results
7. Action plan tracking: assign owners, set deadlines, follow up
8. Anonymity guarantees: minimum respondents per group for visibility
9. eNPS (Employee Net Promoter Score) tracking
10. Retention risk correlation: link engagement scores to turnover prediction
```

**Screens** (~10):
```
HR:
  - Survey builder
  - Survey distribution manager
  - Results dashboard (heatmaps, trends, AI themes)
  - Action plan tracker
  - eNPS dashboard

LEADER:
  - My team's engagement results
  - My team's action plans

EMPLOYEE:
  - Survey response form
  - My team's results (anonymized aggregate)
```

**Database Tables** (~10):
```
engagement_surveys, survey_questions, survey_distributions,
survey_responses, survey_response_items, survey_ai_analysis,
engagement_action_plans, action_plan_items, action_plan_updates,
enps_scores
```

**Domain Events**:
```
survey.launched, survey.response_submitted, survey.closed,
survey.analysis_completed, action_plan.created, action_plan.item_completed
```

**Exclusions**: External survey tool import (future), real-time sentiment during meetings.

---

### Annex 13: Compensation (Phase 9)

**Scope**: Salary bands, equity analysis, adjustment workflows, compensation benchmarking.

**Key Features**:
```
1. Salary band management: define bands per role family, level, geography
2. Compa-ratio calculation: employee salary vs. band midpoint
3. Pay equity analysis: detect disparities by gender, age, ethnicity
4. Adjustment workflow: request → leader approval → HR approval → execution
5. Budget simulation: model cost impact of proposed adjustments
6. Compensation history: full salary history per employee
7. Total compensation view: salary + benefits + bonuses + equity
8. Benchmark integration: compare against market data (manual upload or API)
```

**Screens** (~8):
```
HR:
  - Salary band manager
  - Pay equity dashboard
  - Adjustment workflow (pending, approved, rejected)
  - Budget simulator
  - Compensation analytics

LEADER:
  - My team compensation overview (compa-ratios)
  - Request adjustment

EMPLOYEE:
  - My total compensation summary
```

**Database Tables** (~8):
```
salary_bands, employee_compensation, compensation_history,
compensation_adjustments, adjustment_approvals, budget_simulations,
compensation_benchmarks, total_compensation_components
```

**Domain Events**:
```
compensation.adjustment_requested, compensation.adjustment_approved,
compensation.adjustment_rejected, compensation.equity_alert,
compensation.band_updated
```

**Exclusions**: Payroll execution (external system), stock option management (future).

---

### Annex 14: DEI Full (Phase 9)

**Scope**: Comprehensive diversity, equity, and inclusion analytics and auditing.

**Key Features**:
```
1. Diversity dashboard: workforce composition by gender, ethnicity, age, disability
2. Hiring funnel DEI analysis: conversion rates by demographic group per stage
3. 4/5ths rule monitoring: automated adverse impact detection with alerts
4. Pay equity by demographic: gender pay gap, ethnicity pay gap analysis
5. Promotion equity: promotion rates by demographic group
6. AI fairness audit: test all AI models for bias (selection, ranking, recommendation)
7. Inclusive language scanner: organization-wide content audit
8. DEI goal tracking: set and monitor diversity targets
9. Compliance reporting: auto-generate reports for regulatory requirements
10. Intersectional analysis: cross-demographic insights (e.g., gender × ethnicity)
```

**Screens** (~8):
```
HR ADMIN:
  - DEI dashboard (workforce composition, trends)
  - Hiring funnel DEI analysis
  - Pay equity analysis
  - AI fairness audit results
  - DEI goal tracker
  - Compliance report generator

EXECUTIVE:
  - DEI executive summary
  - Year-over-year DEI trends
```

**Database Tables** (~8):
```
dei_demographic_data, dei_goals, dei_goal_progress,
dei_hiring_analysis, dei_pay_equity_snapshots, dei_ai_audit_results,
dei_compliance_reports, dei_alerts
```

**Domain Events**:
```
dei.adverse_impact_detected, dei.goal_updated, dei.audit_completed,
dei.compliance_report_generated, dei.pay_gap_alert
```

**Exclusions**: Self-identification collection (uses existing HR data), accommodation management (future).

---

## 20. Data Continuity Map

> Shows how data flows across all modules throughout the employee lifecycle.
> This ensures no data is orphaned and every module builds on previous insights.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA CONTINUITY — FULL LIFECYCLE                     │
└─────────────────────────────────────────────────────────────────────────────┘

RECRUITMENT FLOW:
  Vacancy Description
    → AI Inclusive Language Check → Cleaned Description
    → Publication Channels → Source Tracking
    → Applications → Pipeline

  Application
    → CV Parser → Structured Profile
    → Assessment Assignment → Assessment Results
    → FIT Score Calculation → Ranking

  Assessment Results
    → FIT Score (weighted composite)
    → Gap Analysis (vs. JCA profile)
    → Interview Guide (personalized questions)

  Interview
    → Scorecard + AI Summary
    → Bias Detection Results
    → Updated FIT Score (interview component added)

  Offer + Validation
    → Pre-employment Checks
    → Medical Review (AI-assisted)
    → E-Signature → Hire Transition

HIRE TRANSITION (candidate → employee):
  Candidate Profile + Assessment Results + Interview Scores
    → Employee Record
    → Onboarding Plan (auto-generated from gap analysis)
    → Initial L&D Route (from competency gaps)
    → QoH Baseline (day-0 snapshot)

ONBOARDING → PERFORMANCE:
  Onboarding Completion + Check-in Results
    → QoH 30-day Score
    → Initial OKRs (informed by role profile)
    → Coaching Topics (from assessment gaps)

PERFORMANCE → TALENT:
  OKR Achievement + Performance Reviews
    → Nine Box: Performance Axis
  360 Evaluation + Coaching Progress
    → Nine Box: Potential Axis
  Nine Box Placement
    → Succession Readiness
    → L&D Priority
    → Compensation Adjustment Eligibility

ENGAGEMENT → RETENTION:
  Climate Survey Results + eNPS
    → Engagement Score
  Engagement Score + Performance Trend + Tenure
    → Retention Risk Prediction
  Retention Risk
    → Strategic Monitoring Alerts
    → Leader Action Recommendations

FEEDBACK LOOPS:
  QoH Results (30/60/90/180/365)
    → FIT Model Recalibration (adjust weights)
    → Source Quality Ranking (update)
    → Assessment Predictive Validity (track)

  Performance Outcomes
    → Nine Box Movement Prediction (train)
    → Succession Readiness Updates
    → Compensation Equity Analysis

  DEI Analysis
    → AI Fairness Recalibration
    → Hiring Process Adjustments
    → Pay Equity Corrections

CROSS-MODULE CONNECTIONS:
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  Assessment   │────▶│  FIT Score    │────▶│  Nine Box    │
  │  Results      │     │  + Gap       │     │  (potential)  │
  └──────────────┘     └──────┬───────┘     └──────┬───────┘
                              │                     │
                              ▼                     ▼
                       ┌──────────────┐     ┌──────────────┐
                       │  Onboarding  │     │  Succession  │
                       │  L&D Route   │     │  Planning    │
                       └──────┬───────┘     └──────────────┘
                              │
                              ▼
                       ┌──────────────┐     ┌──────────────┐
                       │  Coaching    │────▶│  Commitments │
                       │  Sessions    │     │  + KPIs      │
                       └──────────────┘     └──────┬───────┘
                                                   │
                              ┌─────────────────────┘
                              ▼
                       ┌──────────────┐     ┌──────────────┐
                       │  Performance │────▶│  Nine Box    │
                       │  Reviews     │     │  (perform.)  │
                       └──────────────┘     └──────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  Climate     │────▶│  Engagement  │────▶│  Retention   │
  │  Surveys     │     │  Score       │     │  Risk        │
  └──────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │  Strategic   │
                                            │  Monitoring  │
                                            └──────────────┘

  ┌──────────────┐     ┌──────────────┐
  │  360 Eval    │────▶│  L&D Route   │────▶  Certification
  │  Results     │     │  + Courses   │
  └──────────────┘     └──────────────┘
```

---

## 21. Sensitive Data Permission Matrix

> Defines who can access sensitive data types. Enforced via RBAC middleware + audit logging.
> Access levels: **FULL** (read+write), **READ** (view only), **AGGREGATE** (anonymized stats only),
> **NONE** (no access). Additional controls: **AUDIT** = access is logged, **CONSENT** = requires
> explicit consent from data subject.

```
DATA TYPE              super_admin   hr_admin   hrbp        recruiter   leader     employee   candidate
─────────────────────  ───────────   ────────   ─────────   ─────────   ────────   ────────   ─────────
Health / Medical       FULL+AUDIT    READ+AUDIT READ+AUDIT  NONE        NONE       OWN        OWN
                                                (assigned)                          +CONSENT   +CONSENT

Psychometric Scores    FULL+AUDIT    READ+AUDIT READ+AUDIT  READ+AUDIT  NONE       OWN        OWN
(assessment results)                             (assigned)  (assigned)             (summary)  (summary)

Psychometric Raw Data  FULL+AUDIT    NONE       NONE        NONE        NONE       NONE       NONE
(item-level responses)

Compensation / Salary  FULL+AUDIT    FULL+AUDIT READ+AUDIT  NONE        OWN TEAM   OWN        NONE
                                                (assigned)               +AUDIT

Nine Box Placement     FULL          FULL       READ        NONE        OWN TEAM   NONE       NONE
                                                (assigned)               (read)

Potential Score        FULL          FULL       READ        NONE        NONE       NONE       NONE
                                                (assigned)

DEI Demographics       FULL+AUDIT    AGGREGATE  AGGREGATE   NONE        NONE       OWN        OWN
                                                                                   +CONSENT   +CONSENT

Integrity Test Results FULL+AUDIT    READ+AUDIT READ+AUDIT  NONE        NONE       NONE       NONE
                                                (assigned)

Interview Recordings   FULL+AUDIT    READ+AUDIT READ+AUDIT  READ+AUDIT  READ       NONE       OWN
(if enabled)                                    (assigned)  (assigned)  (own team)

Coaching Notes         FULL+AUDIT    READ+AUDIT NONE        NONE        OWN TEAM   OWN        NONE
                                                                        (own)

Performance Reviews    FULL          FULL       READ        NONE        OWN TEAM   OWN        NONE
                                                (assigned)               (own)

Engagement Responses   FULL+AUDIT    AGGREGATE  AGGREGATE   NONE        AGGREGATE  NONE       NONE
(individual)                                    (assigned)               (team, if
                                                                         threshold)

Retention Risk Score   FULL          FULL       READ        NONE        OWN TEAM   NONE       NONE
                                                (assigned)

Background Check       FULL+AUDIT    READ+AUDIT READ+AUDIT  READ+AUDIT  NONE       NONE       OWN
Results                                         (assigned)  (assigned)                         (status)
```

### Access Control Implementation

```
1. RBAC MIDDLEWARE (tRPC):
   - permission check includes data_classification level
   - Level 3-4 data (Confidential, Restricted) requires audit log entry
   - "assigned" scope = user must be assigned to that unit/vacancy/employee

2. AUDIT LOGGING:
   - All +AUDIT access writes to data_access_logs table
   - Fields: user_id, data_type, record_id, action, timestamp, ip_address
   - Retention: 7 years (configurable per org)

3. CONSENT ENFORCEMENT:
   - +CONSENT data requires consent_records entry before collection
   - Consent can be withdrawn → data is anonymized within 30 days
   - Consent status checked at query time via middleware

4. ANONYMIZATION:
   - AGGREGATE access returns only statistical summaries (min 5 records)
   - PII stripped: name, email, ID replaced with anonymous identifiers
   - Implemented via database views + middleware layer

5. FIELD-LEVEL ENCRYPTION:
   - medical_documents.content → AES-256 encrypted
   - assessment_results.raw_data → AES-256 encrypted (item-level responses)
   - Encryption keys managed via Supabase Vault (or AWS KMS at scale)
```

---

## Decision Log

| # | Decision | Rationale | Reversible? |
|---|----------|-----------|-------------|
| 1 | Single Next.js app with subdomain routing | Cuts deployment + CI cost, shared code | Yes — split later |
| 2 | Supabase for DB + Auth + Storage + Realtime | One bill, built-in RLS, fast to ship | Yes — migrate to RDS |
| 3 | No Python AI service at launch | All AI is LLM calls, Node.js handles it | Yes — add when ML needed |
| 4 | No Redis at launch | Supabase Realtime + PG pub/sub sufficient | Yes — add at scale |
| 5 | Zoom Video SDK for in-app video interviews | 10K free min/mo, ported from Oaklet Suite (OSF), no Zoom branding | Yes — switch to LiveKit |
| 6 | Trigger.dev for background jobs | Serverless, no containers, already known | Yes — migrate to BullMQ |
| 7 | Haiku-first AI routing | 60% of agents run on Haiku (10x cheaper) | Yes — promote to Sonnet |
| 8 | Anthropic Batch API for 83% of AI calls | 50% discount on non-real-time tasks | Yes — switch to real-time |
| 9 | Prompt caching on all agents | 90% off cached input tokens | Free — just SDK flag |
| 10 | Response caching with TTL | 20-30% dedup on repeated patterns | Yes — reduce TTL |
| 11 | Schema-per-phase (~45 tables for MVP) | Prevents premature abstraction | Yes — add tables anytime |
| 12 | Prisma with split schema files | Per-module organization, easy to maintain | N/A |
| 13 | TensorFlow.js for proctoring (client-side) | Zero server cost, good enough accuracy | Yes — add AWS Rekognition |
| 14 | Cursor-based pagination everywhere | Consistent, performant at scale | N/A |
| 15 | Text enums (not DB enums) | Easier migration, Prisma-friendly | N/A |
| 16 | OpenSign for e-signature (replaces DocuSign) | Open-source, ESIGN+UETA compliant, $0/mo | Yes — switch to DocuSign |
| 17 | No AWS Transcribe at MVP | Summarize from scorecards + notes, not recordings | Yes — add when recording enabled |
| 18 | Revised cost model (2026-05-25) | Real volume ~2K/mo; Zoom free tier; WhatsApp mostly free; max $405/mo | N/A |
| 19 | Zoom Video SDK over Daily.co | Free 10K min/mo, existing code from Oaklet Suite, fully custom UI | Yes — switch to LiveKit/Daily |
