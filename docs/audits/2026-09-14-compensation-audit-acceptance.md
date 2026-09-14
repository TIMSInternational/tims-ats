# Compensation migration: salary-read audit acceptance

PR #143 retired TypeScript compensation readers with unresolved claims about C# audit coverage.
This follow-up adds nine audit-focused real-host tests over the existing PostgreSQL fixture for the
employee-by-id, own-compensation, and salary-adjustment simulation endpoints:

- A controlled auditor holds completion; neither endpoint finishes its response before the audit.
- An audit failure aborts the request or returns an error without a salary DTO; all three endpoints request fail-closed auditing.
- The real audit writer persists exactly one row for the requested compensation record with the correct tenant, actor, entity and read action, correlated by a unique synthetic user-agent.

All 49 CompensationReadEndpointAuthTests passed, including 19 additions. Simulation tests also
exercise real database projection for HR versus team-lead callers, deny missing grants and
out-of-scope subjects, and reject non-finite/non-positive salary inputs. The production change
adds double.IsFinite validation: positive infinity previously passed the positive-number guard.
No schema changes are included. Impersonation-specific compensation attribution and remaining
ownership documentation still need separate verification. This is local acceptance evidence, not a production canary.
