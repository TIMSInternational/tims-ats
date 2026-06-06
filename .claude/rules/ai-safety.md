---
paths:
  - "packages/ai/**"
  - "workers/**"
  - "services/**"
---

# AI Agent Architecture & PII Handling

> Full technical doc: `docs/AI-AGENT-ARCHITECTURE.md`

## Why Microservice (not monorepo)

At thousands of concurrent users, AI calls (3-15 seconds each for Bedrock) WILL block the main API. CV batch processing (500+ at a time) needs independent scaling. PII proxy (Presidio) is Python-based. Cost isolation per tenant requires separate metering.

## Architecture

```
apps/web (Next.js)
  ↓ REST/gRPC
services/ai-gateway (Docker, ECS Fargate)
  ├── PII Proxy (Presidio — strip/re-inject)
  ├── Agent Router (32 agents, budget check, cache)
  ├── Bedrock Client (Claude Haiku/Sonnet)
  └── Audit Logger
  ↓ async via SQS
workers/ (Trigger.dev)
  └── Batch jobs (CV parsing, assessments, reports)
```

## Shared Types (Stay in Monorepo)

```
packages/ai/          → Agent configs, prompt templates, Zod output schemas
                        Imported by BOTH services/ai-gateway AND workers/
                        Ensures type safety without coupling
```

## Communication

- **Real-time (6 agents):** REST or gRPC from Next.js API routes → AI gateway. Streaming via SSE.
- **Batch (26 agents):** tRPC enqueues to SQS → AI gateway processes → webhook callback to API.
- **Message broker:** SQS for batch jobs (managed, cheap, scales). Redis Streams if sub-second latency needed later.

## Agent Pipeline (8 steps)

```
Request → Budget Check → Cache Lookup → PII Strip → Bedrock Call → Output Validation → PII Re-inject → Audit Log
```

> **Implemented today (2026-06-05), in-process in `packages/ai`** — the microservice
> above is the scale-target, not yet built. Every agent now goes through
> ONE gated door, `invokeAgent` (`packages/ai/src/invoke.ts`):
> `budget (fail-closed) → cache (org-scoped, per-agent TTL) → PII (input sanitize/wrap + Bedrock Guardrails) → bedrockGenerate (circuit-broken) → Zod-validate → usage log → cache store`.
> Raw Bedrock access lives ONLY in `packages/ai/src/client.ts` (`bedrockGenerate`);
> no router/service may import `@ai-sdk` or call Bedrock directly — enforced by a
> CI grep-gate + Vitest test. Budget failures throw; a malformed model response
> returns the agent's obviously-degraded fallback, never fabricated data.
> PII tokenization (Presidio) is deferred.

## Guardrails

- **System prompt hardening.** User content as DATA in XML delimiters, never INSTRUCTIONS.
- **Input sanitization.** Strip injection patterns from CVs/job descriptions.
- **Zod output validation.** 100% of outputs parsed. Malformed → retry.
- **Tool-level permissions.** CV Parser accesses `candidates` only, not `salary_adjustments`.
- **Per-org budget.** Hard limits in `AiAgentOrgConfig.monthlyBudget`. Alert 80%, block 100%.

## Scaling

- Auto-scale ECS tasks based on SQS queue depth.
- Concurrency limit: 20 parallel Bedrock calls (API rate limit).
- Cold start mitigation: min 2 tasks always warm.
- Bedrock Batch API for bulk operations (50% cost savings).

## PII Handling (CRITICAL)

### Architecture
```
App → PII Proxy (strip) → Bedrock → PII Proxy (validate + re-inject) → App
```

### Classification
```
CRITICAL (blocked):     SSN, bank accounts, medical, criminal records
HIGH (tokenized):       Full name, salary, address, DOB, phone, personal email
MEDIUM (anonymized):    Job title + dept, dates, education
LOW (pass, log access): Job descriptions, company policies
```

### Implementation
- **Input sanitization — IMPLEMENTED** (`packages/ai/src/pii.ts`): strips control/
  zero-width/bidi chars, defangs prompt-injection markers, and `wrapAsData()` wraps
  user content in a delimiter it cannot break out of. Applied by every agent when
  building the Bedrock message.
- **Bedrock Guardrails (MASK) — IMPLEMENTED, env-gated** defense-in-depth: when
  `BEDROCK_GUARDRAIL_ID` is set, `bedrockGenerate` references the guardrail so PII is
  masked server-side. The MASK policy lives in the AWS guardrail config.
- **Presidio strip/re-inject — DEFERRED** to a measured scale-trigger:
  - **Presidio** (Microsoft, open-source) + custom HR recognizers (salary, visa, cedula).
  - **Deterministic tokens** scoped per-request: `"John Smith" → "<<PERSON_1>>"`.
  - **Token vault:** In-memory only, destroyed immediately after response.
  - **Output validation:** Re-scan LLM response for leaked PII.

### Compliance
- **Colombian Habeas Data (Ley 1581/2012):** Prior express consent. AI processing clause. SIC registry.
- **GDPR:** Data minimization, DPIA, right to explanation.
- **CCPA/CPRA 2026:** Full consumer rights on employee data.

### Audit Logging (PII-free)
- Log what happened, never actual content. 7-year retention. Debug logs 30-day auto-purge.
