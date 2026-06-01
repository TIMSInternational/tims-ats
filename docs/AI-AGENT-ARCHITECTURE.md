# TIMS ATS — AI Agent Architecture: Production Microservice Design

> **Date**: 2026-06-01 | **Author**: NexaDev | **Status**: Approved
> **Scale target**: Thousands of concurrent users, 500+ simultaneous CV parses

---

## Decision: AI is a Separate Microservice

At enterprise scale (thousands of DAU), AI calls (3-15s each for Bedrock) block the main API. Batch processing (500+ CVs) needs independent scaling. PII proxy (Presidio) is Python-native. The AI layer deploys independently as `services/ai-gateway/` within the monorepo.

---

## 1. Architecture Overview

```
apps/web (Next.js + tRPC)
  |
  |-- REST + SSE (real-time: 6 agents)
  |-- SQS FIFO (batch: 26 agents)
  v
services/ai-gateway (Python/FastAPI, Docker, ECS Fargate)
  ├── PII Proxy (Presidio, integrated — not sidecar)
  ├── Agent Router (32 agents, model selection)
  ├── Budget Enforcer (per-org limits)
  ├── Bedrock Client (Haiku/Sonnet, connection pooling)
  ├── Response Cache (DynamoDB)
  └── Audit Logger (PII-free)
  |
  |-- SQS FIFO (batch results)
  v
workers/ (Trigger.dev)
  └── Orchestration: batch uploads, progress tracking, notifications
```

### Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Repo | Monorepo (`services/ai-gateway/`) | Type sharing at build time, independent deploy at runtime |
| Language | **Python (FastAPI)** | Native Presidio/spaCy, NLP ecosystem, 10K+ req/s on Uvicorn |
| Sync protocol | REST + SSE | Streaming AI responses, no gRPC complexity needed |
| Async protocol | SQS FIFO | $0 at current scale, ECS integration, exactly-once, per-org ordering |
| PII layer | Integrated in gateway | No sidecar latency, in-process Presidio calls |
| Compute | **ECS Fargate** | No cold starts, no K8s overhead, ~$58/mo baseline |
| Batch | Bedrock Batch API + SQS | 50% cost savings for bulk operations |
| Scaling | CPU (real-time) + queue depth (batch) | Scale up fast, scale down slow |
| Model routing | Haiku first → Sonnet escalation | 50-70% cost reduction, 95% resolves on Haiku |
| Deployment | Blue/green via CodeDeploy | Zero-downtime, <60s rollback |
| Type sharing | OpenAPI spec → `openapi-typescript` | Compile-time safety, no runtime coupling |

---

## 2. Communication Patterns

### Real-Time (6 agents: chatbot, recruiter assistant, interview assistant)
```
Browser → Next.js API → HTTP POST → AI Gateway → PII Strip → Bedrock stream → SSE → Browser
```
- SSE with 30s heartbeats (prevents proxy timeouts)
- ALB idle timeout: 300s for streaming routes
- 120s max per streaming request

### Batch (26 agents: CV parsing, screening, assessments)
```
tRPC mutation → SQS FIFO (msgGroupId = orgId) → return jobId immediately
                    ↓
AI Gateway polls SQS → PII strip → Bedrock Batch API → validate → PII re-inject
                    ↓
Write results to DB → webhook to main API → notify via SSE/Pusher
```
- SQS FIFO for ordered, exactly-once processing
- Bedrock Batch API for 1000+ items (50% discount, JSONL in S3)
- Under 1000: concurrent real-time calls with semaphore (max 50/org)

### Timeouts
| Type | Timeout | Pattern |
|------|---------|---------|
| Real-time streaming | 120s | SSE + 30s heartbeat |
| Single-shot | 60s | HTTP + 3x exponential retry |
| Batch per item | 90s | SQS visibility 5 min |
| Full batch job | 30 min | Step Functions orchestration |

---

## 3. PII Proxy (Integrated)

```
Request → [Presidio Detector + HR Recognizers] → [Token Vault] → [Bedrock]
                                                     ↓
Response ← [Output Scanner] ← [Re-injector] ← [Bedrock Response]
                                    ↓
                          Vault destroyed immediately
```

### Custom HR Recognizers (beyond default Presidio)
- `salary_recognizer.py` — `$XX,XXX`, COP salary ranges
- `cedula_recognizer.py` — Colombian ID numbers
- `visa_recognizer.py` — H-1B, OPT, work permit numbers
- `hr_medical_recognizer.py` — Medical/disability terms

### Multi-Turn Conversations
Session-scoped vault with deterministic tokens. Same value → same token across turns.
- Vault keyed by `org_id + conversation_id`
- ALB sticky sessions pin conversations to same ECS task
- 60-minute TTL, background eviction every 5 min
- Memory: ~1-5KB per vault, 500 concurrent = 2.5MB total

---

## 4. Scaling

### Auto-Scaling Policies

**Real-time service:**
- Scale on CPU > 60% (target tracking)
- Secondary: active connections > 100 per task
- Min 2 tasks (HA), max 20 tasks
- Scale up: 60s cooldown. Scale down: 300s cooldown.

**Batch workers (separate ECS service):**
- Scale on SQS queue depth (target: 5 messages per task)
- Min 0 tasks (scale to zero), max 10 tasks
- Scale up: 30s (aggressive). Scale down: 600s (conservative).

### Bedrock Connection Pooling
```python
bedrock_config = Config(
    max_pool_connections=50,  # Default 10 is too low
    connect_timeout=5,
    read_timeout=120,
    retries={"max_attempts": 3, "mode": "adaptive"}
)
```

### Cost Optimization
| Strategy | Savings | When |
|----------|---------|------|
| Bedrock Batch API | 50% | All non-real-time (26 agents) |
| Haiku → Sonnet escalation | 50-70% | 95% resolves on Haiku |
| Prompt caching | 30-40% | Shared system prompts |
| Response caching (DynamoDB) | Variable | Same job desc + criteria = cached rubric |

---

## 5. Deployment

### ECS Fargate (not Lambda, not K8s)
- **Not Lambda:** 5-8s cold starts for Presidio/spaCy loading, now fully billed. 15-min limit. No persistent SSE.
- **Not K8s:** Operational overhead unjustified. EKS = $73/mo before workloads. TIMS has one engineering team.
- **Fargate:** Zero infra management, native ALB/SQS/CloudWatch integration. ~$58/mo baseline.

### Blue/Green via CodeDeploy
- New task def → CodeDeploy creates new target group → health checks → shift traffic → terminate old
- Rollback: <60 seconds (shift back to old target group)

### Health Checks
- `/health/live` — ALB check, every 10s, 2 failures = unhealthy
- `/health/ready` — Checks Presidio loaded, Bedrock reachable, SQS accessible. Gates traffic on deploy.

---

## 6. Folder Structure

```
services/ai-gateway/
├── Dockerfile
├── docker-compose.yml           # Local dev: gateway + localstack (SQS)
├── requirements.txt
├── pyproject.toml
│
├── infra/                       # Terraform/CDK
│   ├── task-definition.json
│   ├── appspec.yml
│   ├── service.tf
│   ├── sqs.tf
│   ├── iam.tf
│   └── autoscaling.tf
│
├── src/
│   ├── main.py                  # FastAPI app, lifespan (model preload)
│   ├── config.py                # Pydantic Settings (env vars)
│   ├── dependencies.py          # FastAPI Depends: auth, org, budget
│   │
│   ├── api/
│   │   ├── routes_realtime.py   # POST /agents/{id}/invoke (SSE)
│   │   ├── routes_batch.py      # POST /batch/submit, GET /batch/{id}
│   │   ├── routes_health.py     # /health/live, /health/ready
│   │   └── middleware.py        # Request ID, tenant context
│   │
│   ├── agents/
│   │   ├── registry.py          # Agent → config mapping
│   │   ├── base.py              # BaseAgent protocol
│   │   ├── recruitment/         # cv_parser, screener, interview_questions, ...
│   │   ├── talent/              # gap_analyst, succession_planner, ...
│   │   ├── engagement/          # survey_analyzer, sentiment_scorer, ...
│   │   └── assistants/          # recruiter_assistant, chatbot, interview_assistant
│   │
│   ├── pii/
│   │   ├── detector.py          # Presidio + custom recognizers
│   │   ├── tokenizer.py         # PII → <<TOKEN>>
│   │   ├── vault.py             # In-memory per-request/conversation
│   │   ├── reinjector.py        # <<TOKEN>> → original
│   │   ├── output_scanner.py    # Second-pass output validation
│   │   └── recognizers/         # salary, cedula, visa, medical
│   │
│   ├── llm/
│   │   ├── bedrock_client.py    # boto3 with connection pooling
│   │   ├── model_router.py      # Haiku vs Sonnet decision tree
│   │   ├── prompt_builder.py    # Templates with XML delimiters
│   │   ├── streaming.py         # SSE handler
│   │   └── retry.py             # Exponential backoff + circuit breaker
│   │
│   ├── budget/                  # Per-org enforcement
│   ├── cache/                   # DynamoDB response cache
│   ├── batch/                   # SQS consumer, orchestrator, webhook
│   ├── observability/           # Structured logging, metrics, audit
│   └── schemas/                 # Pydantic models (mirrors Zod in packages/shared)
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
│       └── locustfile.py        # 500 concurrent CV parses
│
└── scripts/
    ├── export_openapi.py
    └── benchmark_pii.py
```

### Monorepo Integration
- `packages/ai/` stays in monorepo — shared types, prompt templates, Zod output schemas
- `services/ai-gateway/` imports from `packages/ai/` at build time (Docker COPY)
- OpenAPI spec generated from FastAPI → consumed by `openapi-typescript` for Node.js types
- `tools/generate-ai-types.ts` syncs the contract

---

## 7. Agent Inventory (32 agents)

### Real-Time (6) — REST + SSE
| Agent | Model | Use Case |
|-------|-------|----------|
| Recruiter Assistant | Sonnet | Multi-turn chat for recruiters |
| Candidate Chatbot | Haiku | Candidate-facing Q&A |
| Interview Assistant | Sonnet | Live interview support |
| Email Composer | Haiku | Draft candidate emails |
| Inclusive Language | Haiku | Real-time JD review |
| Chatbot Assistant | Haiku | General HR Q&A |

### Batch (26) — SQS + Bedrock Batch API
| Category | Agents | Model |
|----------|--------|-------|
| Recruitment | CV Parser, Screener, Matcher, Skills Extractor, Job Classifier, Reference Checker | Haiku (batch) |
| Interview | Question Generator, Summarizer, Video Analyzer, Interview Coach | Sonnet (batch) |
| Assessment | Assessment Evaluator, Assessment Designer, Bias Detector, Sentiment Analyzer | Sonnet (batch) |
| Talent | Insights, Succession Planner, Performance Reviewer, OKR Assistant, Onboarding Planner, DEI Analyzer, Compensation Benchmarker, Learning Recommender, Engagement Predictor, Nine-Box Evaluator, Workforce Planner | Mixed |
| Pipeline | Pipeline Optimizer, Report Generator | Sonnet (batch) |
| Offers | Offer Letter Generator, Vacancy Writer | Sonnet (batch) |
