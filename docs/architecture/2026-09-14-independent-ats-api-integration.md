# Decision: independent TIMS ATS with API integration

Date: 2026-09-14
Authority: Federico's clarification during the completion implementation session.

TIMS ATS is the new independently functioning application. `tims.configuration.core` is the existing TIMS International software and remains a separate system. TIMS ATS must communicate with it and other systems through APIs.

This supersedes the earlier Phase-6 assumption that Team Suite domain code and data access must be absorbed into TIMS ATS. Legacy source ingestion, replacement of its UI and migration of its internal database are not requirements of this completion effort. The C#/.NET 10 ATS backend migration remains in scope.

Integration work requires an agreed API contract, authentication/scopes, per-entity source of truth, tenant/company mapping, synchronization triggers and error/retry semantics. Credentials and legacy data must not be copied into ATS merely to avoid that contract. Do not assume shared tenant IDs or trust organization IDs supplied by an external caller; bind access to the authenticated integration principal.

Initial delivery should prove one scoped end-to-end exchange against a test environment with idempotency and failed-request visibility, then extend to the required workflows. No API endpoints or vendor-specific schemas are invented by this decision. Legacy API URL/documentation and the required first exchange remain discovery inputs.

The older documents are retained as historical plans; this decision controls the current completion plan wherever they require Team Suite absorption.
