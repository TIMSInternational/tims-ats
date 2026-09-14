# Compensation migration: salary-read audit acceptance

PR #143 retired TypeScript compensation readers with unresolved claims about C# audit coverage.
This follow-up adds six real-host tests over the existing PostgreSQL fixture for the
employee-by-id and own-compensation endpoints:

- A controlled auditor holds completion; neither endpoint finishes its response before the audit.
- An audit failure aborts the request or returns an error without a salary DTO; both endpoints request fail-closed auditing.
- The real audit writer persists exactly one row for the requested compensation record with the correct tenant, actor, entity and read action, correlated by a unique synthetic user-agent.

All 36 CompensationReadEndpointAuthTests passed, including the six additions. No production
behavior or schema changes are included. These checks close the missing evidence for these
two salary reads, not every finding recorded in PR #143: simulate-adjustment coverage,
impersonation-specific compensation attribution, and remaining ownership documentation still
need separate verification. This is local acceptance evidence, not a production canary.
