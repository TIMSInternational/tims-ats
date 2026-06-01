# TIMS ATS — Complete Product Map

> **Last updated**: 2026-06-01 | **Status**: MVP Phase 1 (Recruitment)

---

## What Is TIMS ATS

Multi-tenant enterprise HR/HCM platform that integrates TIMS International's psychometric assessments with a full-cycle hiring and people management system. Designed for thousands of concurrent users from day one.

**The complete workflow**: Vacancy → Candidate → Assessment → Interview → Offer → Onboarding → Performance → Succession

---

## Two User Levels

### 1. Platform Owner (Federico / NexaDev)
Manages the entire SaaS platform across all customer organizations. Sells subscriptions, tracks revenue, configures AI agents, monitors system health.

**Platform Owner Pages** (`/platform/*`):
| Page | Purpose | Status |
|------|---------|--------|
| Dashboard | MRR, org count, user growth, plan distribution, recent activity | Built |
| Organizations | Create/edit/suspend orgs, manage subscriptions | Built |
| Subscriptions | Plan changes, trial extensions, MRR trends | Built |
| Invoices | Create invoices (Mercury-style wizard), track payments, billing profiles | Built |
| Invitations | Invite new orgs + users, track acceptance | Built |
| Users | Platform-wide user management, role assignment | Built |
| AI Agents | Configure 32 agents, per-org budgets, usage tracking | Built |
| Feature Flags | Enable/disable features per org (A/B testing, rollouts) | Built |
| Analytics | Platform-wide metrics (DAU, churn, ARPU) | Built |
| Audit | Cross-org audit logs (who did what, when) | Built |
| Health | System status, DB latency, service health | Built |
| Notifications | Notification management | Built |
| Support | Platform owner email whitelist, impersonation | Built |

### 2. Organization Users (TIMS's Clients — Bancolombia, Rappi, Ecopetrol, etc.)
HR teams within each customer organization. Each org has its own data, users, and configuration.

**8 Roles within each org:**
| Role | Access |
|------|--------|
| Super Admin | Everything within their org |
| HR Admin | All HR modules |
| HRBP | Assigned business units only |
| Recruiter | ATS only (vacancies, candidates, pipeline, interviews) |
| Leader/Manager | Own team + assigned vacancies + performance |
| Committee Member | Interview panels + scorecards only |
| Employee | Self-service (own profile, onboarding, performance, surveys) |
| Candidate | Portal only (apply, assessments, view offers) |

---

## Feature Modules (8 phases)

### Phase 1: Recruitment (MVP) — Build Next
| Page | What It Does |
|------|-------------|
| `/recruitment/vacancies` | Create job requisitions, approval workflows, publish to LinkedIn/Indeed |
| `/recruitment/candidates` | Candidate database, resume upload, AI parsing, skill tagging |
| `/recruitment/pipeline` | Kanban pipeline per vacancy, drag candidates between stages |
| `/recruitment/interviews` | Schedule phone/video/panel interviews, Zoom integration, scorecards |
| `/recruitment/offers` | Create offers, approval workflow, background checks, e-signature |
| `/recruitment/talent-pools` | CRM for passive candidates, sourcing campaigns |
| `/recruitment/analytics` | Time-to-fill, cost-per-hire, funnel conversion, recruiter productivity |

**Hiring Flow:**
```
Create Vacancy → Publish → Source Candidates → Screen (AI) → Assess (TIMS tests)
→ Interview (video + scorecard) → Offer (approval + e-sign) → Pre-employment checks → Hire
```

### Phase 2: Assessments & FIT
Integrated into recruitment pipeline. TIMS's core differentiator.
- Assign psychometric tests (PCA, MIL, Integrity, Personality, IE)
- Proctored sessions with anti-cheating detection
- AI scoring with breakdown and interpretation
- FIT score engine (candidate profile vs job profile requirements)

### Phase 3: Onboarding
| Page | What It Does |
|------|-------------|
| `/people/onboarding` | Structured plans (Day 1-30, 30-90, 90+), task checklists, buddy assignment, check-ins, risk scoring |

### Phase 4: Performance & Talent
| Page | What It Does |
|------|-------------|
| `/people/performance` | OKRs, coaching sessions, 360 feedback, peer recognition |
| `/talent/nine-box` | Performance vs Potential grid, calibration sessions with panel voting |
| `/talent/succession` | Critical role mapping, successor readiness, bench strength |
| `/talent/team-intelligence` | Team demographics, retention analytics, manager effectiveness |

### Phase 5: Compensation
| Page | What It Does |
|------|-------------|
| `/compensation` | Salary bands (min/mid/max), compa ratios, adjustment workflows, benefits enrollment |

### Phase 6: Learning
| Page | What It Does |
|------|-------------|
| `/learning` | Course catalog, learning paths (AI-generated from skill gaps), enrollment tracking, certificates |

### Phase 7: Engagement & Culture
| Page | What It Does |
|------|-------------|
| `/engagement/climate` | Pulse surveys, sentiment analysis, action plans, leader commitments |
| `/engagement/dei` | DEI analytics (gender, ethnicity, age, pay equity), bias detection |

### Phase 8: Monitoring & Integrations
| Page | What It Does |
|------|-------------|
| `/monitoring` | Alert rules (SLA breaches, open positions > 60 days), severity levels |
| `/settings/integrations` | HRIS connectors (Workday, SAP), webhooks, API keys |

---

## 32 AI Agents

### Real-Time (6 — streaming responses):
| Agent | Model | What It Does |
|-------|-------|-------------|
| Recruiter Assistant | Sonnet | Multi-turn chat for recruiters (search candidates, draft emails) |
| Candidate Chatbot | Haiku | Candidate-facing Q&A on job portal |
| Interview Assistant | Sonnet | Live interview support (suggested questions, note-taking) |
| Email Composer | Haiku | Draft personalized candidate emails |
| Inclusive Language | Haiku | Real-time job description review for bias |
| HR Chatbot | Haiku | General HR Q&A for employees |

### Batch (26 — background processing):
| Category | Agents |
|----------|--------|
| Recruitment | CV Parser, Candidate Screener, Candidate Matcher, Skills Extractor, Job Classifier, Reference Checker |
| Interview | Question Generator, Summarizer, Video Analyzer, Interview Coach |
| Assessment | Assessment Evaluator, Assessment Designer, Bias Detector, Sentiment Analyzer |
| Talent | Insights, Succession Planner, Performance Reviewer, OKR Assistant, Onboarding Planner, DEI Analyzer, Compensation Benchmarker, Learning Recommender, Engagement Predictor, Nine-Box Evaluator, Workforce Planner |
| Pipeline | Pipeline Optimizer, Report Generator |
| Offers | Offer Letter Generator, Vacancy Writer |

---

## Implementation Status

| Layer | Status | Details |
|-------|--------|---------|
| Database Schema | 100% | 92 models across 23 Prisma files, all indexed, enums defined |
| API Routers | 80% | All routers exist, core procedures implemented, some stubs |
| Platform Owner Pages | 100% | All 13 pages built and functional |
| Org User Pages | 5% | All pages exist as stubs (return null), waiting for design completion |
| HTML Designs | 50% | 10/20 screens designed, remaining 10 are post-MVP modules |
| AI Agents | 0% | Architecture defined, microservice not yet built |
| Integrations | 0% | Schema defined, connectors not implemented |
| Seed Data | 100% | 11 orgs, 13 invoices, 15 invitations, 5 billing profiles |

---

## What Needs Building Next

**Priority 1: Recruitment MVP (the product people will use)**
1. Vacancy creation + approval workflow page
2. Candidate pipeline (kanban) page
3. Candidate 360 profile page
4. Interview scheduling + scorecard page
5. Offer management + approval page
6. Recruitment analytics dashboard

**Priority 2: Assessment Integration**
7. TIMS assessment assignment flow
8. Assessment results + FIT score display
9. Proctoring session UI

**Priority 3: Candidate Portal**
10. Public job board
11. Candidate application flow
12. Assessment completion interface
13. Offer acceptance + e-signature
