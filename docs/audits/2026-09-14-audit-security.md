# Security audit integrity — implementation wave 1

Scope: GitHub #181, C#/.NET 10 backend. No production changes performed.

## Existing fixes verified in source

- SecurityDenialAuditMiddleware and MfaStepUpMiddleware pass CancellationToken.None to the audit writer, preventing caller disconnects from cancelling their own security event.
- TrustedProxyHeaderMiddleware strips x-real-ip by default before downstream consumers; explicit trust requires the exact configuration value "true". Production's App Runner contract uses the last X-Forwarded-For hop. Direct deployments must supply a trusted appending edge before relying on this contract.
- MFA middleware runs after the rate limiter, inside denial auditing.
- Security denial auditing has an explicit disable switch; audit writer resolution is lazy.

## Changes in this wave

- Removed the rate-limit exemptions for /require-permission and /require-org-scope. These authenticated denial-producing endpoints can no longer bypass the query quota.
- Infrastructure exemptions apply only when no resolved principal exists. This is defensive limiter behavior: the current principal-resolution middleware skips /whoami, /health and /openapi, so those routes currently have no resolved staff context and also skip MFA/denial auditing. Anonymous health checks retain their exemption.
- SecurityEventWriter now requests cancellation after five seconds through a linked token; this is cooperative cancellation, not a hard completion-time guarantee. HTTP denial callers still supply an independent token; failures remain logged and do not replace the denied response.
- Corrected the writer's misleading assertion that all callers are platform owners.

## Verification

`dotnet test services/Tims.Platform/tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj --no-restore --filter 'FullyQualifiedName~RateLimitMiddlewareTests|FullyQualifiedName~SecurityAuditCancellationTests' --verbosity quiet -m:1`

Passed: 14 tests, zero failures, .NET 10. Includes proof that disconnecting after the denial does not cancel its audit write and that the two authorization probe paths respect quota. The three infrastructure-path cases manually supply a resolved principal and verify defensive limiter behavior; they do not exercise the production principal-resolution pipeline. This targeted run preceded the final writer timeout edit; the subsequent combined run passed 1,318 unit and 1,614 integration tests.

## Remaining work — do not close #181 yet

- SecurityEventWriter still uses the privileged AuditLogDbContext without TenantScope. Its forced-RLS INSERT privilege needs a production-role assertion and a production-equivalent RLS integration test, or an explicit tenant-scoped writer redesign covering all callers. Existing fail-soft persistence can still lose rows during database failures; a durable queue/outbox is a separate design decision.
- Review/add action-oriented audit indexes using the actual ownership/migration mechanism.
- Define retention and legal deletion handling consistent with the append-only controls; do not weaken triggers ad hoc.
- Implement/verify a security-event consumer and dropped-audit alerting. Logs alone are not evidence of operational alert coverage.
- Production deployment and verification of this wave remain outstanding.
