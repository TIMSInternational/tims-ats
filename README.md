# TIMS Platform

**Human Capital Management by TIMS International**
Built by [NexaDev](https://nexadev.ai)

---

## Overview

Full-cycle HCM platform connecting TIMS International's psychometric assessments (PCA, MIL, Integrity, Personality, IE) with recruitment, talent management, and workforce analytics. Single deployment serving multiple client organizations with isolated data, custom branding, and AI-powered automation.

## Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm |
| **Framework** | Next.js 15+ (App Router) |
| **UI** | Tailwind CSS 4 + shadcn/ui |
| **API** | tRPC 11 (end-to-end type safety) |
| **Database** | Supabase (PostgreSQL 16 + Auth + Storage + Realtime) |
| **ORM** | Prisma 6 |
| **AI** | Vercel AI SDK + AWS Bedrock (Claude Haiku/Sonnet) |
| **Video** | Zoom Video SDK (in-app interviews) |
| **Background Jobs** | Trigger.dev v3 |
| **Email** | AWS SES |
| **WhatsApp** | WhatsApp Business Cloud API |
| **E-Signature** | OpenSign (open-source) |
| **Deployment** | Vercel |
| **Monitoring** | Sentry |

## Monorepo Structure

```
tims-platform/
├── apps/
│   └── web/                    # Next.js app (admin + portal via subdomain routing)
├── packages/
│   ├── db/                     # Prisma schema + client
│   ├── api/                    # tRPC routers
│   ├── ui/                     # Shared component library
│   ├── ai/                     # AI client + 32 agent prompts
│   ├── auth/                   # Supabase Auth utilities
│   ├── email/                  # AWS SES client + templates
│   ├── whatsapp/               # WhatsApp Business client
│   ├── video/                  # Zoom Video SDK wrapper
│   ├── storage/                # Supabase Storage wrapper
│   ├── events/                 # Event definitions + Trigger.dev
│   ├── i18n/                   # ES + EN translations
│   └── shared/                 # Types, utils, constants, validators
├── workers/                    # Trigger.dev job definitions
└── docs/                       # Architecture + API docs
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 11+
- Supabase account (or local via Docker)

### Setup

```bash
# Clone
git clone https://github.com/tafurfede/tims-platform.git
cd tims-platform

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local
# Fill in your Supabase, AWS, Zoom SDK credentials

# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Start development
pnpm dev
```

### Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Lint all packages |
| `pnpm type-check` | TypeScript type checking |
| `pnpm test` | Run all tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Prisma Studio |

## Architecture

- **Multi-tenancy**: Row-Level Security (RLS) via Supabase — each org's data is isolated at the database level
- **Subdomain routing**: `app.tims.com` → admin panel, `{client}.tims.com` → branded candidate portal
- **AI optimization**: Haiku-first routing (60%), prompt caching, batch API, response caching, context trimming
- **Video interviews**: Zoom Video SDK with split-screen layout (video + scorecard + AI coach)

Full architecture: [`docs/TIMS ATS - Architecture.md`](docs/TIMS%20ATS%20-%20Architecture.md)

## Development Phases

| Phase | Scope | Weeks |
|---|---|---|
| **0** | Foundation (auth, RLS, multi-tenancy, design system) | 1–3 |
| **1** | ATS Core (vacancies, pipeline, candidates, portal) | 4–7 |
| **2** | Assessments & FIT (TIMS API, proctoring, scoring) | 8–11 |
| **3** | Interviews & Offers (Zoom video, scorecards, e-sign) | 12–16 |
| | **MVP Launch** | **Week 16** |
| 4–10 | Post-MVP modules (onboarding → enterprise) | 17–39 |

## License

Proprietary — TIMS International / NexaDev
