# TIMS Platform — Owner Console Specification

> **Date**: 2026-05-31
> **Scope**: Platform Owner pages + Security hardening
> **Roles**: Federico Tafur, Andres Tafur (NexaDev founders)

---

## 1. Dashboard (`/dashboard`)

The executive overview of the entire TIMS platform.

### KPI Cards (top row, 5 cards)
| KPI | Source | Description |
|-----|--------|-------------|
| Total Organizations | `organization.count()` | Active client orgs |
| Total Users | `user.count()` | All users across all orgs |
| MRR (Monthly Recurring Revenue) | `subscription` table | Sum of active plan prices |
| Active Trials | `subscription.count({ status: 'trialing' })` | Orgs in trial period |
| System Uptime | External / mock | API uptime % last 30 days |

### Sections
| Section | Content |
|---------|---------|
| **Recent Activity** | Timeline of recent platform events: new org signups, subscription changes, user registrations (last 24h) |
| **Organizations by Plan** | Donut chart: trial / starter / professional / enterprise |
| **User Growth** | Line chart: new users per week (last 12 weeks) |
| **Revenue Trend** | Bar chart: MRR per month (last 6 months) |
| **Alerts** | Critical system alerts: expiring trials, failed payments, high error rates, orgs approaching limits |
| **Quick Actions** | Buttons: Create Organization, Invite User, View Audit Log, System Health |

---

## 2. Organizations (`/platform/organizations`)

Manage all client organizations.

### List View (default)
| Column | Description |
|--------|-------------|
| Logo + Name | Org name with avatar |
| Slug | URL slug |
| Plan | Badge: trial / starter / pro / enterprise |
| Status | Active / Suspended / Cancelled |
| Users | User count in this org |
| Created | Date created |
| Trial Ends | If trialing, days remaining |
| Actions | View, Edit, Suspend, Impersonate |

### Filters
- Search by name/slug
- Filter by plan
- Filter by status
- Sort by created date, user count, name

### Actions
- **Create Organization** — Modal: name, slug, plan, admin email, billing email
- **View Organization** — Detail page with:
  - Org info (name, slug, domain, plan, created, billing email)
  - Companies/Units/Teams tree
  - User list for this org
  - Subscription details
  - Feature flags enabled
  - Usage stats (AI calls, storage, assessments)
  - Audit log filtered to this org
- **Edit Organization** — Edit name, plan, settings, features
- **Suspend Organization** — Confirmation modal, sets org inactive
- **Impersonate** — Login as this org's admin (for support), with visual indicator banner

---

## 3. Subscriptions (`/platform/subscriptions`)

Billing and subscription management.

### KPI Cards
| KPI | Description |
|-----|-------------|
| MRR | Total monthly recurring revenue |
| Active Subscriptions | Count by status |
| Trials Expiring Soon | Within 7 days |
| Failed Payments | Past due subscriptions |

### Subscription Table
| Column | Description |
|--------|-------------|
| Organization | Name + logo |
| Plan | trial / starter / pro / enterprise |
| Status | active / trialing / past_due / cancelled |
| MRR | Monthly amount |
| Period | Current billing period |
| Trial Ends | If applicable |
| Actions | View, Change Plan, Cancel |

### Actions
- **Change Plan** — Upgrade/downgrade org's plan
- **Extend Trial** — Add days to trial
- **Cancel Subscription** — With reason
- **View Invoice History** — Per org

---

## 4. Users (`/platform/users`)

All users across all organizations.

### User Table
| Column | Description |
|--------|-------------|
| Avatar + Name | User name with avatar |
| Email | Email address |
| Organization | Which org they belong to (or "Platform Owner") |
| Role | Their role within their org |
| Status | Active / Inactive |
| Last Login | When they last signed in |
| Created | Account creation date |
| Actions | View, Edit, Deactivate, Impersonate |

### Filters
- Search by name/email
- Filter by organization
- Filter by role
- Filter by status
- Filter by platform owner (yes/no)

### Actions
- **Create Platform Owner** — Invite another platform admin (restricted to existing platform owners)
- **View User** — Full profile, activity log, sessions
- **Edit User** — Change role, org assignment
- **Deactivate User** — Soft-delete
- **Reset Password** — Send password reset email
- **Impersonate** — Login as this user (support tool)

---

## 5. System Health (`/platform/health`)

Real-time system monitoring.

### Service Status Grid
| Service | What to Show |
|---------|-------------|
| API | Response time, error rate, uptime |
| Database (Supabase) | Connection pool, query latency, table sizes |
| Auth | Login success rate, failed attempts, active sessions |
| Storage | Used space, upload/download rates |
| Background Jobs | Queue depth, processing time, failed jobs |
| AI (Bedrock) | Calls today, avg latency, cost, budget remaining |
| Email (SES) | Sent today, bounce rate, complaints |
| Realtime | Active connections, messages/sec |

### Charts
- **API Response Time** — Line chart (last 24h, p50/p95/p99)
- **Error Rate** — Area chart (last 24h)
- **Database Connections** — Gauge (current / max)
- **Background Job Queue** — Bar chart (pending / processing / failed)

### Alerts
- Active system alerts with severity
- Alert history (last 7 days)
- Alert configuration (thresholds)

---

## 6. Feature Flags (`/platform/feature-flags`)

Toggle features per organization.

### Flag Table
| Column | Description |
|--------|-------------|
| Flag Key | Unique identifier (e.g., `nine_box_enabled`) |
| Description | What the flag controls |
| Global Default | On/Off for all orgs |
| Overrides | Count of per-org overrides |
| Last Changed | When it was last modified |
| Actions | Toggle, Configure per-org |

### Default Flags
| Key | Description | Default |
|-----|-------------|---------|
| `ai_enabled` | AI features (CV parsing, summaries, etc.) | On |
| `nine_box_enabled` | Nine Box Talent Review module | Off |
| `dei_enabled` | DEI Analytics module | Off |
| `compensation_enabled` | Compensation & Benefits module | Off |
| `succession_enabled` | Succession Planning module | Off |
| `video_interviews` | In-app video interviews | Off |
| `whatsapp_enabled` | WhatsApp candidate communication | Off |
| `advanced_analytics` | Advanced analytics dashboards | Off |
| `api_access` | External API access | Off |
| `sso_saml` | SAML SSO for enterprise | Off |

### Actions
- **Toggle Global** — Enable/disable for all orgs
- **Per-Org Override** — Modal showing all orgs with toggle per each
- **Create Flag** — New flag with key, description, default
- **Delete Flag** — Remove flag (with confirmation)

---

## 7. Analytics (`/platform/analytics`)

Platform-wide usage and growth metrics.

### Sections
| Section | Charts/Data |
|---------|-------------|
| **Growth** | New orgs per month, new users per month, churn rate |
| **Engagement** | DAU/MAU ratio, avg sessions per user, most used modules |
| **Feature Adoption** | % of orgs using each module (pipeline, ninebox, etc.) |
| **AI Usage** | Total AI calls, cost per org, model split (Haiku/Sonnet), budget utilization |
| **Revenue** | MRR trend, ARPU, LTV, churn revenue |
| **Geographic** | Users by country, orgs by country |

---

## 8. Audit (`/platform/audit`)

Cross-organization audit trail.

### Audit Log Table
| Column | Description |
|--------|-------------|
| Timestamp | When the action occurred |
| Actor | Who performed the action (name + email) |
| Organization | Which org context |
| Action | What was done (create, update, delete, access, login) |
| Entity | What was affected (user, vacancy, candidate, etc.) |
| Details | JSON diff of changes |
| IP Address | Source IP |

### Filters
- Date range
- Organization
- Actor (user)
- Action type
- Entity type
- Search in details

### Actions
- **Export** — CSV/JSON export of filtered logs
- **Alert Rules** — Configure alerts for specific actions (e.g., "alert when any user exports candidate data")

---

## 9. Support (`/platform/support`)

Support tools for helping clients.

### Sections
| Section | Content |
|---------|---------|
| **Impersonate** | Search for a user, login as them with a banner showing "Viewing as [User]" |
| **Password Reset** | Send password reset email to any user |
| **Session Management** | View active sessions, force logout a user |
| **Error Lookup** | Search recent errors by org, user, or error code |
| **Communication** | Send system notification to an org or all orgs |
| **Data Export** | Generate data export for GDPR/Habeas Data requests |

---

## Security Hardening Checklist

### Authentication
| Item | Status | Action |
|------|--------|--------|
| Supabase Auth with JWT | Done | — |
| Google SSO | Done | Configured in Supabase |
| Microsoft SSO | Done | Configured in Supabase |
| Email/password login | Done | Min 8 chars |
| Password reset flow | Done | Via Supabase |
| MFA (TOTP) | Not done | Enable for platform owners + super_admin |
| Session expiry | Supabase default (1h JWT, refresh token) | Configure to 24h |
| Logout clears all cookies | Done | Via Supabase signOut |
| OAuth callback validates state | Done | Supabase handles PKCE |

### Authorization
| Item | Status | Action |
|------|--------|--------|
| RBAC middleware in tRPC | Done | `permissionProcedure()` |
| Platform owner bypasses RLS | Done | `isPlatformOwner` check |
| Super admin bypasses permissions | Done | Role check in middleware |
| HR admin scoped to org | Done | RLS via `SET LOCAL` |
| Row-Level Security on Supabase | Not done | Need to create RLS policies on all tables |
| Platform owner whitelist | Done | Hardcoded email list (move to DB) |
| Role assignment validation | Partial | Prevent privilege escalation |
| API route auth check | Done | Middleware redirects unauthenticated |

### Rate Limiting
| Item | Status | Action |
|------|--------|--------|
| Supabase Auth rate limits | Built-in | Default: 30 req/5min for auth endpoints |
| API rate limiting | Not done | Add rate limiter middleware to tRPC |
| Login attempt throttling | Supabase built-in | Lockout after failed attempts |
| AI endpoint rate limiting | Not done | Per-org token budget in AI gateway |
| File upload size limits | Not done | Add to storage config |
| Pagination limits | Done | Max 100 per page in all list endpoints |

### Input Validation
| Item | Status | Action |
|------|--------|--------|
| All tRPC inputs use Zod | Done | Every procedure validates input |
| SQL injection prevention | Done | Prisma parameterized queries |
| XSS prevention | Done | React auto-escapes, no dangerouslySetInnerHTML |
| CSRF protection | Done | Supabase uses httpOnly cookies + SameSite |
| Email validation | Done | Zod email validator |
| UUID validation | Done | Zod uuid validator on all IDs |

### Data Security
| Item | Status | Action |
|------|--------|--------|
| Tenant isolation (RLS) | Partial | App-level via Prisma, need DB-level RLS policies |
| Sensitive data encryption | Not done | Encrypt PII at rest (SSN, medical) |
| Audit logging | Done | AuditLog table + middleware |
| API key hashing | Done | SHA-256 hash, prefix only shown |
| Environment variables | Done | .env not committed, .env.example provided |
| Database password | In .env | Rotate before production |
| Service role key protection | In .env | Never exposed to client |

### Infrastructure Security
| Item | Status | Action |
|------|--------|--------|
| HTTPS enforced | Vercel default | — |
| CORS configuration | Not done | Add to Next.js config |
| Security headers | Not done | Add CSP, HSTS, X-Frame-Options |
| Dependency audit | Not done | Run `pnpm audit` |
| Error messages don't leak internals | Partial | tRPC error formatter needs review |
| Production .env separate from dev | Partial | Vercel env vars for production |

---

## Priority Order for Building

### Phase 1 — Security First (before any more features)
1. Supabase RLS policies on all tables
2. Rate limiting middleware for tRPC
3. Security headers (CSP, HSTS)
4. Move platform owner whitelist from code to database
5. MFA for platform owners

### Phase 2 — Platform Owner Pages
1. Dashboard (KPIs + charts)
2. Organizations (list + CRUD + detail)
3. Users (list + management)
4. Subscriptions (list + plan management)
5. Feature Flags (toggle UI)
6. System Health (status grid)
7. Audit (log viewer)
8. Analytics (charts)
9. Support (impersonate + tools)
