# Notification recipient security — issue #248

Implemented for TypeScript `notification.create`/`bulkCreate` and C#/.NET 10 `POST /notifications` and `/notifications/bulk`.

Recipients must exist, belong to the resolved caller organization, be active, and have no deletion timestamp. No organization fails closed. Foreign, missing, inactive and deleted recipients return a generic bad-request response without disclosing which target failed. Any invalid target rejects the entire batch before insertion. Duplicate valid targets still produce duplicate notifications, preserving existing behavior.

The TypeScript router delegates to a service and repository. The repository uses `runTenantTransaction`, not a nested transaction on `tenantDb` (whose extension opens separate per-query transactions). Both implementations check recipients with parameterized SQL and ordered `FOR SHARE` row locks inside the same transaction as notification insertion. The locks prevent concurrent organization transfers, deactivation and deletion between validation and commit. The committed migration and test fixture grant `app_tenant` SELECT/UPDATE on users, which support these locks. No schema migration is proposed; the current production grants still need rollout verification.

## Verification

- `npx vitest run tests/security/notification-recipients.test.ts`: 6 passed. Covers transaction query contract, invalid target, mixed batch rejection, duplicates (including UUID case variants) and missing organization.
- `pnpm --filter @tims/api exec tsc --noEmit`: passed.
- `dotnet test tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj --filter FullyQualifiedName~Notification --no-restore --verbosity quiet -m:1`: 84 passed using real PostgreSQL and the .NET 10 host. Includes eight new create/bulk rejection cases for foreign, missing, inactive and deleted users; mixed batches leave valid-recipient notification counts unchanged. Existing successful creates, duplicate semantics, authentication and flag gates remain covered.

The .NET check required escalation because sandbox restrictions blocked MSBuild IPC; its approved rerun passed. Changes are local and are not deployed. This patch intentionally covers the grant-gated notification creation endpoints, not separate privileged platform broadcast writers or existing malformed historical records.
