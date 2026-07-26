# Phase 5 Slice 17 — Cross-org Audit-Log READ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `platform.getCrossOrgAuditLogs` + `platform.exportAuditLogsCsv` (TS, `packages/api/src/routers/platform/system.ts:257-354`) to C#/`Tims.Platform`, dark behind a feature flag, proving the first **platform-owner-only, cross-org, no-tenant-RLS** pattern in the Phase-5 strangler migration.

**Architecture:** New `AuditReadDbContext` (EF Core, read-only, reuses the existing `AuditLogEntity` mapping from `Tims.Infrastructure.Audit.AuditLogDbContext`) queries `audit_logs` on the **default/privileged connection** — no `TenantScope.BeginAsync` wrapping, so no `SET LOCAL ROLE app_tenant`/org GUC is ever issued, and RLS does not restrict the read (cross-org visibility is the intended behavior for a platform owner). A new `PlatformOwnerGate` (mirrors `ReportingStaffGate`'s shape) resolves the caller's `TenantContext` and requires `PrincipalType.PlatformOwner`; every other principal type — including an **impersonated** platform owner, whose resolved context collapses to `PrincipalType.OrgUser` by construction (`StaffContextResolver`) — gets 403. Two endpoints (`GET /audit/logs`, `GET /audit/logs/export`) are mapped only when `PlatformOptions.AuditLogReadEnabled` is true (default `false`) or during OpenAPI-doc generation, matching every prior slice.

**Tech Stack:** C# / .NET (Tims.Domain, Tims.Application, Tims.Infrastructure, Tims.Api), EF Core + Npgsql, xUnit + Testcontainers.PostgreSql (`Tims.IntegrationTests`), TypeScript / vitest (characterization fixtures), the `scripts/parity` CLI harness.

## Global Constraints

- Language: C# (Tims.Platform solution) + TypeScript (repo root, `packages/shared`, `scripts/parity`). No `any` in TS (repo `CLAUDE.md`). Files ≤300 lines where the codebase's existing convention already keeps files that small (DbContexts/repositories/endpoints here are all well under that).
- `audit_logs` stays `efcoreAppendOnly` in `docs/architecture/table-ownership.md` — this slice adds a READ mapping alongside the existing WRITE mapping (`BillingAuditWriter`), not a new ownership category.
- **No TenantScope on this domain's reads** — this is the point of the slice. Do not "fix" this into an org-scoped read; a Testcontainers test in Task 8 pins the cross-org behavior as intentional.
- Flag: `Platform:AuditLogReadEnabled` (config key `Platform__AuditLogReadEnabled`), default `false`. Mapped only when true, or when `isOpenApiDocGeneration` (matches every prior slice's `Program.cs` convention).
- Out of scope (explicitly, per the approved design spec `docs/architecture/csharp-migration/phase-5-slice-17-audit-log-read.md`): `routers/audit.ts` (dead code, untouched), the access-review surface (deferred to Slice 18), and any production ownership flip / TS-code deletion (Federico-only, at canary).
- Run commands: TS tests `npx vitest run <path>` from repo root; C# tests `dotnet test` from `services/Tims.Platform`; `cd packages/api && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` before any commit that touches shared TS.

---

### Task 1: Characterize the live TS export — golden fixtures

**Files:**

- Create: `contracts/audit-fixtures/cross-org-audit-logs.json`
- Create: `contracts/audit-fixtures/export-audit-logs-csv.json`
- Test: `tests/parity/audit-log-fixtures.test.ts`

**Interfaces:**

- Produces: two static JSON fixtures asserted, in this task, against the REAL TS repository query shape (not a hand-written mirror) — the "honest fixture" rule this repo already follows (Tier-2 honest-data precedent).

- [ ] **Step 1: Write the failing test**

```ts
// tests/parity/audit-log-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvRow } from '../../packages/shared/src/csv';

const ROOT = join(__dirname, '..', '..');
const fixture = (p: string) => JSON.parse(readFileSync(join(ROOT, 'contracts/audit-fixtures', p), 'utf8'));

describe('cross-org-audit-logs fixture', () => {
  it('pins the list shape: logs[], nextCursor, total', () => {
    const f = fixture('cross-org-audit-logs.json');
    expect(f).toHaveProperty('logs');
    expect(f).toHaveProperty('nextCursor');
    expect(f).toHaveProperty('total');
    expect(Array.isArray(f.logs)).toBe(true);
    // auditLogSelect shape (system.helpers.ts): no actor/organization join fields beyond id/name.
    const row = f.logs[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'action',
        'actorId',
        'createdAt',
        'entity',
        'entityId',
        'id',
        'ipAddress',
        'organizationId',
        'userAgent',
        'userId',
      ].sort(),
    );
  });
});

describe('export-audit-logs-csv fixture', () => {
  it('pins the CSV header + a formula-injection row, byte-for-byte via csvRow', () => {
    const f = fixture('export-audit-logs-csv.json');
    const header = csvRow(['Fecha', 'Organizacion', 'Actor', 'Accion', 'Entidad', 'ID Entidad', 'IP']);
    expect(f.header).toBe(header);
    // an org named "=cmd|' /c calc'!A0" must neutralize, matching csvRow exactly
    const row = csvRow([
      f.sample.createdAt,
      f.sample.organizationName,
      f.sample.actorName,
      f.sample.action,
      f.sample.entity,
      f.sample.entityId,
      f.sample.ip,
    ]);
    expect(row).toBe(f.expectedCsvRow);
    expect(row).toContain("'="); // the neutralization prefix survived quoting
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parity/audit-log-fixtures.test.ts`
Expected: FAIL (`ENOENT` — the fixture files don't exist yet).

- [ ] **Step 3: Write the fixtures**

```json
// contracts/audit-fixtures/cross-org-audit-logs.json
{
  "logs": [
    {
      "id": "d0000000-0000-0000-0000-000000000001",
      "organizationId": "11111111-1111-1111-1111-111111111111",
      "userId": null,
      "actorId": "c0000000-0000-0000-0000-000000000001",
      "action": "login_failed",
      "entity": "auth",
      "entityId": null,
      "ipAddress": "203.0.113.5",
      "userAgent": "Mozilla/5.0",
      "createdAt": "2026-07-20T10:00:00.000Z"
    }
  ],
  "nextCursor": null,
  "total": 1
}
```

```json
// contracts/audit-fixtures/export-audit-logs-csv.json
{
  "header": "\"Fecha\",\"Organizacion\",\"Actor\",\"Accion\",\"Entidad\",\"ID Entidad\",\"IP\"",
  "sample": {
    "createdAt": "2026-07-20T10:00:00.000Z",
    "organizationName": "=cmd|' /c calc'!A0",
    "actorName": "Rick Recruiter",
    "action": "login_failed",
    "entity": "auth",
    "entityId": "-",
    "ip": "203.0.113.5"
  },
  "expectedCsvRow": "\"2026-07-20T10:00:00.000Z\",\"'=cmd|' /c calc'!A0\",\"Rick Recruiter\",\"login_failed\",\"auth\",\"-\",\"203.0.113.5\""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parity/audit-log-fixtures.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/audit-fixtures/cross-org-audit-logs.json contracts/audit-fixtures/export-audit-logs-csv.json tests/parity/audit-log-fixtures.test.ts
git commit -m "test(parity): golden fixtures for the cross-org audit-log read + CSV export"
```

---

### Task 2: `Tims.Domain` — CSV escaping kernel + audit read view

**Files:**

- Create: `services/Tims.Platform/src/Tims.Domain/Csv/CsvCell.cs`
- Create: `services/Tims.Platform/src/Tims.Domain/Audit/AuditLogView.cs`
- Test: `services/Tims.Platform/tests/Tims.UnitTests/Csv/CsvCellTests.cs`

**Interfaces:**

- Produces: `Tims.Domain.Csv.CsvCell.Escape(string? value): string` and `CsvCell.Row(IEnumerable<string?> values): string` — golden-fixtured 1:1 against `packages/shared/src/csv.ts`'s `csvCell`/`csvRow`. Three read-side records, independent of any EF entity, mirroring the TS `auditLogSelect` (list) and the export's separate select EXACTLY (confirmed against `packages/api/src/routers/platform/system.helpers.ts` + `system.ts:267-326` in Task 1's fixture review — the list response has NO flat `organizationId`/`userAgent`, HAS `metadata` + a nested `actor`; the export has NO raw ids at all, only `organization.name` + `actor.{firstName,lastName,email}`):
  - `AuditLogActorView(Guid Id, string FirstName, string LastName, string Email, string? Avatar)` — the nested `actor` join for the list. `FirstName`/`LastName` are non-nullable (real schema: `user.prisma:6-7`, `String` NOT NULL) — only `Avatar` is genuinely optional.
  - `AuditLogListItem(Guid Id, string Action, string Entity, string? EntityId, Guid? UserId, string? Metadata, DateTime CreatedAt, string? IpAddress, AuditLogActorView? Actor)`.
  - `AuditLogExportRow(string Action, string Entity, string? EntityId, string? IpAddress, DateTime CreatedAt, string OrganizationName, string? ActorFirstName, string? ActorLastName, string? ActorEmail)`. `OrganizationName` is non-nullable — `AuditLog.organization` is a REQUIRED relation (`system.prisma:31`) to a `NOT NULL` `name` column (`organization.prisma:32`), so every row's org name always exists. The `Actor*` fields stay nullable — they flatten an OPTIONAL `actor` relation, not a nullable scalar.

- [ ] **Step 1: Write the failing test**

```csharp
// services/Tims.Platform/tests/Tims.UnitTests/Csv/CsvCellTests.cs
using Tims.Domain.Csv;
using Xunit;

namespace Tims.UnitTests.Csv;

public sealed class CsvCellTests
{
    [Theory]
    [InlineData("=cmd|/c calc", "\"'=cmd|/c calc\"")]
    [InlineData("+1", "\"'+1\"")]
    [InlineData("-1", "\"'-1\"")]
    [InlineData("@SUM(A1)", "\"'@SUM(A1)\"")]
    public void Escape_NeutralizesLeadingFormulaChars(string input, string expected)
    {
        Assert.Equal(expected, CsvCell.Escape(input));
    }

    [Fact]
    public void Escape_DoubleQuotesEmbeddedQuotes()
    {
        Assert.Equal("\"Jane \"\"JJ\"\" Doe\"", CsvCell.Escape("Jane \"JJ\" Doe"));
    }

    [Fact]
    public void Escape_NullIsEmptyQuotedCell()
    {
        Assert.Equal("\"\"", CsvCell.Escape(null));
    }

    [Fact]
    public void Row_JoinsEscapedCellsWithCommas()
    {
        Assert.Equal("\"a\",\"'=evil\",\"\"", CsvCell.Row(["a", "=evil", null]));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/Tims.Platform && dotnet test --filter CsvCellTests`
Expected: FAIL (`Tims.Domain.Csv` namespace doesn't exist).

- [ ] **Step 3: Write minimal implementation**

```csharp
// services/Tims.Platform/src/Tims.Domain/Csv/CsvCell.cs
using System.Text.RegularExpressions;

namespace Tims.Domain.Csv;

/// <summary>
/// Port of packages/shared/src/csv.ts (csvCell/csvRow) — RFC-4180 cell quoting + spreadsheet
/// formula-injection defense (CWE-1236). Neutralize a leading =/+/-/@/tab/CR (Excel/Sheets
/// execute these as a formula), then double-quote and escape embedded quotes. Golden-fixtured
/// against the TS implementation via contracts/audit-fixtures/export-audit-logs-csv.json.
/// </summary>
public static partial class CsvCell
{
    [GeneratedRegex(@"^[=+\-@\t\r]")]
    private static partial Regex LeadingFormulaChar();

    public static string Escape(string? value)
    {
        var raw = value ?? string.Empty;
        var neutralized = LeadingFormulaChar().IsMatch(raw) ? $"'{raw}" : raw;
        return $"\"{neutralized.Replace("\"", "\"\"")}\"";
    }

    public static string Row(IEnumerable<string?> values) => string.Join(',', values.Select(Escape));
}
```

```csharp
// services/Tims.Platform/src/Tims.Domain/Audit/AuditLogView.cs
namespace Tims.Domain.Audit;

/// <summary>
/// Read-side shapes for the two audit-log endpoints (Phase-5 Slice 17) — independent of any EF
/// entity so the repository/endpoint layers don't depend on Tims.Infrastructure. Field sets match
/// the TS query selects EXACTLY (verified against real Prisma selects, not hand-mirrored — see
/// Task 1's fixtures, which pin these same shapes on the TS side):
///   - List (`getCrossOrgAuditLogs`, `auditLogSelect` in system.helpers.ts): id, action, entity,
///     entityId, userId, metadata, createdAt, ipAddress, actor (nested, nullable). NO flat
///     organizationId or userAgent — the real select never returns them.
///   - Export (`exportAuditLogsCsv`, system.ts:314-326): action, entity, entityId, ipAddress,
///     createdAt, organization.name, actor.{firstName,lastName,email}. NO raw ids at all.
/// </summary>
public sealed record AuditLogActorView(Guid Id, string FirstName, string LastName, string Email, string? Avatar);

public sealed record AuditLogListItem(
    Guid Id,
    string Action,
    string Entity,
    string? EntityId,
    Guid? UserId,
    string? Metadata,
    DateTime CreatedAt,
    string? IpAddress,
    AuditLogActorView? Actor);

public sealed record AuditLogExportRow(
    string Action,
    string Entity,
    string? EntityId,
    string? IpAddress,
    DateTime CreatedAt,
    string OrganizationName,
    string? ActorFirstName,
    string? ActorLastName,
    string? ActorEmail);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/Tims.Platform && dotnet test --filter CsvCellTests`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/Tims.Platform/src/Tims.Domain/Csv services/Tims.Platform/src/Tims.Domain/Audit/AuditLogView.cs services/Tims.Platform/tests/Tims.UnitTests/Csv
git commit -m "feat(csharp): Phase-5 Slice-17 — CsvCell kernel + audit-log read views"
```

---

### Task 3: `AuditReadDbContext` — privileged, no-TenantScope EF context

**Files:**

- Create: `services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadDbContext.cs`
- Test: covered by Task 4's Testcontainers fixture and Task 8's cross-org test (a DbContext has no meaningful unit test in isolation; the codebase's existing DbContexts — `ReportingReadDbContext` etc. — are likewise only integration-tested).

**Interfaces:**

- Consumes: the existing `Tims.Infrastructure.Audit.AuditLogEntity` (from `AuditLogDbContext.cs` — reused, NOT redefined, to avoid a second mapping of the same table drifting out of sync).
- Produces: `AuditReadDbContext.AuditLogs: DbSet<AuditLogEntity>` + two NEW minimal local entities this context defines (not shared with any writer, matching how `ReportingReadDbContext` scopes its own `UserReadEntity` etc.): `AuditActorReadEntity` (maps `users`: id/first_name/last_name/email/avatar — backs the list endpoint's nested `actor`) and `AuditOrganizationReadEntity` (maps `organizations`: id/name — backs the export endpoint's `organization.name`). `AsNoTracking` query source for all three. Consumed by `AuditReadRepository` (Task 4), which LEFT JOINs `AuditLogs` to these by `ActorId`/`OrganizationId` (no navigation properties needed — see Task 4).

- [ ] **Step 1: Write the implementation** (no separate failing-test step — this is pure EF configuration, proven end-to-end by Task 8's integration test, matching how `ReportingReadDbContext` itself has no dedicated unit test)

```csharp
// services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadDbContext.cs
using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// READ-ONLY EF Core context over the Prisma-OWNED, `efcoreAppendOnly` <c>audit_logs</c> table
/// (docs/architecture/table-ownership.md — the existing entry already covers this table; this
/// context adds the READ mapping alongside <see cref="AuditLogDbContext"/>'s WRITE mapping, not a
/// new ownership category).
///
/// UNLIKE every other Phase-5 read context (team-intel, succession, reporting, ...), this one is
/// NEVER wrapped in <see cref="Tims.Infrastructure.TenantScope"/> — no <c>SET LOCAL ROLE
/// app_tenant</c>, no org GUC. It runs on the app's default (privileged) connection, so Postgres
/// RLS does not restrict it: a platform owner is SUPPOSED to see every org's audit trail. Do not
/// "fix" this into a TenantScope-wrapped read — Tims.IntegrationTests.Audit.AuditReadCrossOrgTests
/// pins the cross-org visibility as the intended, tested behavior.
///
/// Reuses <see cref="AuditLogEntity"/> from <see cref="AuditLogDbContext"/> verbatim (same table,
/// same columns) rather than re-declaring the mapping, so the two contexts can never drift apart
/// on column names/types.
/// </summary>
public sealed class AuditReadDbContext(DbContextOptions<AuditReadDbContext> options) : DbContext(options)
{
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    public DbSet<AuditActorReadEntity> Actors => Set<AuditActorReadEntity>();

    public DbSet<AuditOrganizationReadEntity> Organizations => Set<AuditOrganizationReadEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Full property mapping (not just the columns the two endpoints return) so this context
        // never half-maps AuditLogEntity — matching AuditLogDbContext's own OnModelCreating exactly,
        // since both contexts map the SAME entity class and must never drift on column names/types.
        modelBuilder.Entity<AuditLogEntity>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.UserId).HasColumnName("user_id");
            entity.Property(a => a.ActorId).HasColumnName("actor_id");
            entity.Property(a => a.Action).HasColumnName("action");
            entity.Property(a => a.Entity).HasColumnName("entity");
            entity.Property(a => a.EntityId).HasColumnName("entity_id");
            entity.Property(a => a.Changes).HasColumnName("changes").HasColumnType("jsonb");
            entity.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(a => a.IpAddress).HasColumnName("ip_address");
            entity.Property(a => a.UserAgent).HasColumnName("user_agent");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });

        // Local, minimal read-only mappings of users/organizations — scoped to THIS context only
        // (no navigation properties on AuditLogEntity; AuditReadRepository LEFT JOINs by id in Task 4,
        // matching the ReportingReadDbContext precedent of context-local read entities).
        modelBuilder.Entity<AuditActorReadEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.Avatar).HasColumnName("avatar");
        });

        modelBuilder.Entity<AuditOrganizationReadEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
        });
    }
}

/// <summary>Minimal read-only mapping of `users`, scoped to this context — backs the list
/// endpoint's nested `actor` join and the export endpoint's actor name fields. FirstName/LastName
/// are non-nullable per the real schema (user.prisma:6-7, `String` NOT NULL) — only Avatar is
/// genuinely optional.</summary>
public sealed class AuditActorReadEntity
{
    public Guid Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Avatar { get; set; }
}

/// <summary>Minimal read-only mapping of `organizations`, scoped to this context — backs the
/// export endpoint's `organization.name` field only.</summary>
public sealed class AuditOrganizationReadEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadDbContext.cs
git commit -m "feat(csharp): Phase-5 Slice-17 — AuditReadDbContext (privileged, no TenantScope)"
```

---

### Task 4: `AuditReadRepository` — Testcontainers fixture + cursor list + count + bounded export query

**Files:**

- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadFixture.cs`
- Create: `services/Tims.Platform/src/Tims.Application/Audit/IAuditReadRepository.cs`
- Create: `services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadRepository.cs`
- Test: `services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadRepositoryTests.cs`

**Interfaces:**

- Consumes: `AuditReadDbContext` (Task 3), `AuditLogListItem`/`AuditLogActorView`/`AuditLogExportRow` (Task 2).
- Produces: `IAuditReadRepository.ListAsync(AuditLogFilter filter, int take, Guid? cursor, CancellationToken): Task<(IReadOnlyList<AuditLogListItem> Logs, Guid? NextCursor, int Total)>` and `IAuditReadRepository.ExportAsync(AuditLogFilter filter, CancellationToken): Task<IReadOnlyList<AuditLogExportRow>>` (bounded `Take(1000)`, matching the TS `take: 1000`). `AuditLogFilter` record: `(Guid? UserId, Guid? OrganizationId, string? Action, string? Entity, DateTime? DateFrom, DateTime? DateTo)` — `OrganizationId` is a WHERE-clause-only filter (never returned in the response, matching the real TS select). Also produces `AuditReadFixture` — the Testcontainers fixture Task 8 reuses (do not recreate it there).

Because a repository over a real Postgres table is meaningfully tested only against real Postgres (matching every prior slice — `ReportingReadRepository` has no mocked-DbContext unit test either), this task builds its own Testcontainers fixture first (this is the first task that needs one), then the repository against it.

- [ ] **Step 1: Write the Testcontainers fixture**

```csharp
// services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadFixture.cs
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// Phase-5 Slice 17 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED
/// <c>audit_logs</c> table (RLS-protected, exactly like every other read fixture) + the identity
/// plane, seeded with rows in TWO orgs so a cross-org read either DOES or DOES NOT bleed —
/// provably. `is_platform_owner` on the seeded `users` row backs the 4-principal-type auth matrix
/// (only one seeded user has it `true`). Reused by Task 8's cross-org + auth-matrix tests — do not
/// duplicate this fixture there.
/// </summary>
public sealed class AuditReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_audit_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-audit-platform-owner";
    public const string OrgUserSub = "sub-audit-org-user";

    // Named so tests can assert by id instead of by a since-removed flat OrganizationId field on
    // AuditLogListItem (the real TS select never returns organizationId — see Task 1/2).
    public static readonly Guid LogOrgA1 = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid LogOrgA2 = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid LogOrgB1 = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, AuditSchemaSql, AuditSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public AuditReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<AuditReadDbContext>().UseNpgsql(ConnectionString).Options);

    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NULL,
            last_name text NULL,
            avatar text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, name, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corp', true),
          ('22222222-2222-2222-2222-222222222222', 'Globex Inc', true);

        -- one real platform owner (org-less) + one ordinary org-scoped staff user (no grants needed —
        -- PlatformOwnerGate checks PrincipalType only, never a permission grant). The org-user is also
        -- the actor on the OrgA audit rows below, so first_name/last_name back the nested `actor` join.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-audit-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', NULL, true, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-audit-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', NULL, false, true);
        """;

    private const string AuditSchemaSql =
        """
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            user_id uuid NULL,
            actor_id uuid NULL,
            action text NOT NULL,
            entity text NOT NULL,
            entity_id text NULL,
            changes jsonb NULL,
            metadata jsonb NULL,
            ip_address text NULL,
            user_agent text NULL,
            created_at timestamp NOT NULL DEFAULT now()
        );
        GRANT SELECT ON audit_logs TO app_tenant;
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // 2 rows in OrgA, 1 in OrgB — a cross-org bleed (or its absence) changes the counts, not just
    // a total (mirrors the reporting fixture's "distinct per-org data" discipline).
    private const string AuditSeedSql =
        """
        INSERT INTO audit_logs (id, organization_id, actor_id, action, entity, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'login_failed', 'auth', '2026-07-20T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'access', 'candidate', '2026-07-21T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', NULL, 'login_failed', 'auth', '2026-07-19T10:00:00Z');
        """;
}

// Declared alongside the fixture (not in a per-test file) so every test class in this task AND
// Task 8 (AuditReadCrossOrgTests, AuditReadEndpointAuthTests) can reference [Collection("AuditRead")]
// without redeclaring this — xUnit requires exactly one [CollectionDefinition] per collection name.
[CollectionDefinition("AuditRead")]
public sealed class AuditReadCollection : ICollectionFixture<AuditReadFixture>;
```

- [ ] **Step 2: Write the failing repository test**

```csharp
// services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadRepositoryTests.cs
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

[Collection("AuditRead")]
public sealed class AuditReadRepositoryTests(AuditReadFixture fixture)
{
    private readonly AuditReadFixture _fixture = fixture;

    [Fact]
    public async Task ListAsync_ReturnsRowsAcrossBothOrgs_NoOrgFilter()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, total) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        Assert.Equal(3, total); // 2 OrgA rows + 1 OrgB row (seeded in AuditReadFixture)
        // AuditLogListItem carries no OrganizationId (the real TS select never returns one) —
        // assert by the known per-org log ids instead.
        var ids = logs.Select(l => l.Id).ToHashSet();
        Assert.Contains(AuditReadFixture.LogOrgA1, ids);
        Assert.Contains(AuditReadFixture.LogOrgB1, ids);
    }

    [Fact]
    public async Task ListAsync_OrganizationIdFilter_NarrowsToOneOrg()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, total) = await repo.ListAsync(
            new AuditLogFilter(null, AuditReadFixture.OrgA, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        Assert.Equal(2, total);
        var ids = logs.Select(l => l.Id).ToHashSet();
        Assert.Equal(new HashSet<Guid> { AuditReadFixture.LogOrgA1, AuditReadFixture.LogOrgA2 }, ids);
    }

    [Fact]
    public async Task ListAsync_CursorPagination_TakePlusOneOverflow()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, nextCursor, total) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 2, cursor: null, CancellationToken.None);

        Assert.Equal(2, logs.Count);
        Assert.NotNull(nextCursor);
        Assert.Equal(3, total);
    }

    [Fact]
    public async Task ListAsync_ActorJoin_PopulatesNestedActor_NullWhenActorIdIsNull()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, _) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        var orgARow = logs.Single(l => l.Id == AuditReadFixture.LogOrgA1);
        Assert.NotNull(orgARow.Actor);
        Assert.Equal("Rick", orgARow.Actor!.FirstName);
        Assert.Equal("Recruiter", orgARow.Actor.LastName);

        var orgBRow = logs.Single(l => l.Id == AuditReadFixture.LogOrgB1);
        Assert.Null(orgBRow.Actor); // actor_id is NULL on this seeded row
    }

    [Fact]
    public async Task ExportAsync_BoundsAt1000_MatchingTsTakeLimit()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var rows = await repo.ExportAsync(new AuditLogFilter(null, null, null, null, null, null), CancellationToken.None);

        Assert.True(rows.Count <= 1000);
    }

    [Fact]
    public async Task ExportAsync_JoinsOrganizationNameAndActorName()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var rows = await repo.ExportAsync(new AuditLogFilter(null, AuditReadFixture.OrgA, null, null, null, null), CancellationToken.None);

        var row = rows.Single(r => r.EntityId == null && r.Action == "login_failed");
        Assert.Equal("Acme Corp", row.OrganizationName);
        Assert.Equal("Rick", row.ActorFirstName);
        Assert.Equal("Recruiter", row.ActorLastName);
    }

    [Fact]
    public async Task ListAsync_UnknownCursor_ReturnsEmptyPage_NotPageOne()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, nextCursor, total) = await repo.ListAsync(
            new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: Guid.NewGuid(), CancellationToken.None);

        Assert.Empty(logs); // NOT page 1 — matches Prisma's real "cursor not found -> empty" behavior
        Assert.Null(nextCursor);
        Assert.Equal(3, total); // total still reflects the true count, independent of the stale cursor
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/Tims.Platform && dotnet test --filter AuditReadRepositoryTests`
Expected: FAIL (`AuditReadRepository`/`IAuditReadRepository`/`AuditLogFilter` don't exist yet — `AuditReadFixture` from Step 1 compiles fine on its own).

- [ ] **Step 4: Write minimal implementation**

```csharp
// services/Tims.Platform/src/Tims.Application/Audit/IAuditReadRepository.cs
using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public sealed record AuditLogFilter(
    Guid? UserId,
    Guid? OrganizationId,
    string? Action,
    string? Entity,
    DateTime? DateFrom,
    DateTime? DateTo);

public interface IAuditReadRepository
{
    Task<(IReadOnlyList<AuditLogListItem> Logs, Guid? NextCursor, int Total)> ListAsync(
        AuditLogFilter filter, int take, Guid? cursor, CancellationToken cancellationToken);

    Task<IReadOnlyList<AuditLogExportRow>> ExportAsync(AuditLogFilter filter, CancellationToken cancellationToken);
}
```

```csharp
// services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadRepository.cs
using Microsoft.EntityFrameworkCore;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// Read-only port of TS <c>getCrossOrgAuditLogs</c>/<c>exportAuditLogsCsv</c>
/// (routers/platform/system.ts:267-326). Deliberately runs WITHOUT
/// <see cref="Tims.Infrastructure.TenantScope"/> — see <see cref="AuditReadDbContext"/>'s doc comment.
/// Every query is <c>AsNoTracking()</c>; <c>SaveChanges</c> is never called.
///
/// Both methods LEFT JOIN by id (no EF navigation properties on <see cref="AuditLogEntity"/> —
/// see <see cref="AuditReadDbContext"/>) rather than a nav-property <c>Include</c>, matching the TS
/// query's own LEFT JOIN semantics exactly: <c>actorId</c>/<c>organizationId</c> can be null or
/// point at a row that itself doesn't exist, and the response must degrade to a null actor / "Sistema"
/// (endpoint concern, Task 6) rather than throw or silently drop the audit row.
/// </summary>
public sealed class AuditReadRepository(AuditReadDbContext db) : IAuditReadRepository
{
    private const int ExportCap = 1000;

    private readonly AuditReadDbContext _db = db;

    public async Task<(IReadOnlyList<AuditLogListItem> Logs, Guid? NextCursor, int Total)> ListAsync(
        AuditLogFilter filter, int take, Guid? cursor, CancellationToken cancellationToken)
    {
        var query = ApplyFilter(_db.AuditLogs.AsNoTracking(), filter).OrderByDescending(a => a.CreatedAt);

        if (cursor is { } cursorId)
        {
            var cursorRow = await _db.AuditLogs.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == cursorId, cancellationToken).ConfigureAwait(false);
            if (cursorRow is null)
            {
                // A cursor that resolves to no row is Prisma's real behavior too (findMany with a
                // non-existent `cursor.id` returns an empty array, not the unfiltered first page) —
                // total still reflects the true count, independent of the stale cursor.
                var emptyTotal = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
                    .CountAsync(cancellationToken).ConfigureAwait(false);
                return ([], null, emptyTotal);
            }

            query = query.Where(a => a.CreatedAt < cursorRow.CreatedAt
                || (a.CreatedAt == cursorRow.CreatedAt && a.Id.CompareTo(cursorRow.Id) < 0))
                .OrderByDescending(a => a.CreatedAt);
        }

        var page = await query.Take(take + 1).ToListAsync(cancellationToken).ConfigureAwait(false);
        Guid? nextCursor = null;
        if (page.Count > take)
        {
            nextCursor = page[take].Id;
            page.RemoveAt(take);
        }

        var total = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
            .CountAsync(cancellationToken).ConfigureAwait(false);

        // A single batched actor lookup (not N+1): fetch every distinct non-null ActorId this page
        // references, then join client-side. The page is bounded (<= take+1, <= 100 per Task 6's
        // MaxTake), so this is one extra round-trip, never one per row.
        var actorIds = page.Where(a => a.ActorId is not null).Select(a => a.ActorId!.Value).Distinct().ToList();
        var actors = await _db.Actors.AsNoTracking()
            .Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        var items = page.Select(a => new AuditLogListItem(
            a.Id, a.Action, a.Entity, a.EntityId, a.UserId, a.Metadata, a.CreatedAt, a.IpAddress,
            a.ActorId is { } actorId && actors.TryGetValue(actorId, out var actor)
                ? new AuditLogActorView(actor.Id, actor.FirstName, actor.LastName, actor.Email, actor.Avatar)
                : null)).ToList();

        return (items, nextCursor, total);
    }

    public async Task<IReadOnlyList<AuditLogExportRow>> ExportAsync(AuditLogFilter filter, CancellationToken cancellationToken)
    {
        var rows = await ApplyFilter(_db.AuditLogs.AsNoTracking(), filter)
            .OrderByDescending(a => a.CreatedAt)
            .Take(ExportCap)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var orgIds = rows.Select(a => a.OrganizationId).Distinct().ToList();
        var orgs = await _db.Organizations.AsNoTracking()
            .Where(o => orgIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, cancellationToken).ConfigureAwait(false);

        var actorIds = rows.Where(a => a.ActorId is not null).Select(a => a.ActorId!.Value).Distinct().ToList();
        var actors = await _db.Actors.AsNoTracking()
            .Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        return rows.Select(a =>
        {
            // organization_id is NOT NULL with a REQUIRED FK to organizations(id) (system.prisma:31) —
            // the lookup is trusted to always hit; a miss would mean a genuine data-integrity
            // violation, so this throws (KeyNotFoundException) rather than silently coalescing to a
            // placeholder that would mask the bug.
            var org = orgs[a.OrganizationId];
            AuditActorReadEntity? actor = a.ActorId is { } actorId && actors.TryGetValue(actorId, out var found) ? found : null;
            return new AuditLogExportRow(
                a.Action, a.Entity, a.EntityId, a.IpAddress, a.CreatedAt,
                org.Name, actor?.FirstName, actor?.LastName, actor?.Email);
        }).ToList();
    }

    private static IQueryable<AuditLogEntity> ApplyFilter(IQueryable<AuditLogEntity> query, AuditLogFilter filter)
    {
        if (filter.UserId is { } userId) query = query.Where(a => a.ActorId == userId);
        if (filter.OrganizationId is { } orgId) query = query.Where(a => a.OrganizationId == orgId);
        if (filter.Action is { } action) query = query.Where(a => a.Action == action);
        if (filter.Entity is { } entity) query = query.Where(a => a.Entity == entity);
        if (filter.DateFrom is { } from) query = query.Where(a => a.CreatedAt >= from);
        if (filter.DateTo is { } to) query = query.Where(a => a.CreatedAt <= to);
        return query;
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/Tims.Platform && dotnet test --filter AuditReadRepositoryTests`
Expected: PASS (7 tests — includes `ListAsync_UnknownCursor_ReturnsEmptyPage_NotPageOne`, added after review round 1 caught a stale-cursor parity gap against real Prisma behavior).

- [ ] **Step 6: Commit**

```bash
git add services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadFixture.cs services/Tims.Platform/src/Tims.Application/Audit/IAuditReadRepository.cs services/Tims.Platform/src/Tims.Infrastructure/Audit/AuditReadRepository.cs services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadRepositoryTests.cs
git commit -m "feat(csharp): Phase-5 Slice-17 — AuditReadFixture + AuditReadRepository (cursor list + bounded export)"
```

---

### Task 5: `PlatformOwnerGate`

**Files:**

- Create: `services/Tims.Platform/src/Tims.Api/Audit/PlatformOwnerGate.cs`

**Interfaces:**

- Consumes: `PrincipalResolver`, `PlatformOptions` (existing, per `ReportingStaffGate`'s pattern), `Tims.Domain.Identity.PrincipalType`.
- Produces: `PlatformOwnerGate.AuthorizeAsync(ClaimsPrincipal, HttpContext, PrincipalResolver, PlatformOptions, CancellationToken): Task<StaffGateResult>` (reuses the existing `StaffGateResult` struct from `Tims.Api.Reporting`, or a copy if cross-namespace reuse is awkward — see Step 1 investigation).

- [ ] **Step 1: Confirm `StaffGateResult` is reusable across namespaces (no code yet)**

Run: `grep -n "namespace\|public readonly struct StaffGateResult" services/Tims.Platform/src/Tims.Api/Reporting/ReportingStaffGate.cs`. It's `public` in `Tims.Api.Reporting`. Reuse it via `using Tims.Api.Reporting;` rather than duplicating the struct — DRY, and every other gate in the codebase already depends on nothing domain-specific in that struct's shape (`TenantContext` + `IResult`).

- [ ] **Step 2: Write the implementation** (a pure principal-type check has no useful unit test in isolation — proven end-to-end by Task 6's endpoint + Task 8's integration auth-matrix test, matching `ReportingStaffGate`, which likewise has no standalone unit test)

```csharp
// services/Tims.Platform/src/Tims.Api/Audit/PlatformOwnerGate.cs
using System.Security.Claims;
using Tims.Api.Configuration;
using Tims.Api.Reporting; // StaffGateResult — reused, not duplicated
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Api.Audit;

/// <summary>
/// The platform-owner-only gate for the cross-org audit-log endpoints — the C# analog of the TS
/// <c>platformProcedure</c> (routers/platform/_common.ts): <c>if (!ctx.user.isPlatformOwner) throw
/// FORBIDDEN</c>. UNLIKE <see cref="Tims.Api.Reporting.ReportingStaffGate"/> there is no permission
/// grant to check and no org-scope requirement — the ONLY question is the resolved principal's
/// <see cref="PrincipalType"/>.
///
/// An impersonated platform-owner session resolves to <see cref="PrincipalType.OrgUser"/> by
/// construction (<c>StaffContextResolver.ResolveStaffContext</c> — impersonation always yields the
/// TARGET's identity), so this gate correctly denies it with NO special-case code: a platform owner
/// must drop impersonation to reach this endpoint, matching TS's <c>ctx.user.isPlatformOwner</c>
/// check against the real (non-impersonated) user row.
///   unresolvable principal → 401; resolved but not PlatformOwner → 403.
/// </summary>
public static class PlatformOwnerGate
{
    public static async Task<StaffGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        if (context.PrincipalType != PrincipalType.PlatformOwner)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return StaffGateResult.Ok(context);
    }

    // Identical resolution path to ReportingStaffGate — reuse the middleware-stashed principal first.
    private static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add services/Tims.Platform/src/Tims.Api/Audit/PlatformOwnerGate.cs
git commit -m "feat(csharp): Phase-5 Slice-17 — PlatformOwnerGate (principal-type-only authorization)"
```

---

### Task 6: `AuditReadEndpoints` + `PlatformOptions` flag + `Program.cs` wiring

**Files:**

- Create: `services/Tims.Platform/src/Tims.Api/Audit/AuditReadEndpoints.cs`
- Modify: `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs`
- Modify: `services/Tims.Platform/src/Tims.Api/Program.cs`

**Interfaces:**

- Consumes: `PlatformOwnerGate` (Task 5), `IAuditReadRepository` (Task 4), `AuditReadDbContext` (Task 3).
- Produces: `GET /audit/logs` (query: `userId`, `organizationId`, `action`, `entity`, `dateFrom`, `dateTo`, `take`, `cursor`), `GET /audit/logs/export` (query: `format=csv|json`, `organizationId`, `action`, `entity`, `dateFrom`, `dateTo`). `PlatformOptions.AuditLogReadEnabled: bool`.

- [ ] **Step 1: Add the flag**

```csharp
// services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs
// (add near the other *ReadEnabled flags, alongside DeiReadEnabled)

/// <summary>
/// Dark-by-default gate for the Phase-5 Slice-17 cross-org audit-log READ surface
/// (platform.getCrossOrgAuditLogs/exportAuditLogsCsv). Mapped only when true, or during
/// OpenAPI-doc generation. TS stays the sole active reader until Federico flips this at canary.
/// </summary>
public bool AuditLogReadEnabled { get; init; }
```

- [ ] **Step 2: Write the endpoints file**

```csharp
// services/Tims.Platform/src/Tims.Api/Audit/AuditReadEndpoints.cs
using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Audit;
using Tims.Domain.Csv;

namespace Tims.Api.Audit;

/// <summary>
/// The cross-org audit-log READ endpoints (Phase-5 Slice 17) — the C# port of
/// <c>platform.getCrossOrgAuditLogs</c>/<c>exportAuditLogsCsv</c>. Both gated by
/// <see cref="PlatformOwnerGate"/> (platform-owner-only; NO tenant RLS — see
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/>). Dark-by-default behind
/// <see cref="PlatformOptions.AuditLogReadEnabled"/>.
/// </summary>
public static class AuditReadEndpoints
{
    private const int DefaultTake = 25;
    private const int MaxTake = 100;

    public static void MapAuditReadEndpoints(this WebApplication app)
    {
        app.MapGet("/audit/logs", async (
                Guid? userId, Guid? organizationId, string? action, string? entity,
                DateTime? dateFrom, DateTime? dateTo, int? take, Guid? cursor,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                IAuditReadRepository repository, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedTake = Math.Clamp(take ?? DefaultTake, 1, MaxTake);
                var filter = new AuditLogFilter(userId, organizationId, action, entity, dateFrom, dateTo);
                var (logs, nextCursor, total) = await repository.ListAsync(filter, resolvedTake, cursor, cancellationToken);

                return Results.Ok(new { logs, nextCursor, total });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AuditGetCrossOrgLogs");

        app.MapGet("/audit/logs/export", async (
                string? format, Guid? organizationId, string? action, string? entity,
                DateTime? dateFrom, DateTime? dateTo,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                IAuditReadRepository repository, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var filter = new AuditLogFilter(null, organizationId, action, entity, dateFrom, dateTo);
                var rows = await repository.ExportAsync(filter, cancellationToken);

                if (format == "json")
                {
                    return Results.Ok(new { format = "json", data = BuildJson(rows), count = rows.Count });
                }

                return Results.Ok(new { format = "csv", data = BuildCsv(rows), count = rows.Count });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AuditExportCrossOrgLogsCsv");
    }

    // Matches TS exactly (system.ts's `actorName` helper): firstName+lastName trimmed, falling
    // back to email if that's blank, falling back to "Sistema" only when there's no actor at all
    // (ActorFirstName/LastName/Email are all null exactly when the row had no actor join).
    private static string ActorName(AuditLogExportRow r)
    {
        if (r.ActorEmail is null)
        {
            return "Sistema";
        }

        var name = $"{r.ActorFirstName} {r.ActorLastName}".Trim();
        return name.Length > 0 ? name : r.ActorEmail;
    }

    private static string BuildCsv(IReadOnlyList<AuditLogExportRow> rows)
    {
        var header = CsvCell.Row(["Fecha", "Organizacion", "Actor", "Accion", "Entidad", "ID Entidad", "IP"]);
        var lines = rows.Select(r => CsvCell.Row([
            r.CreatedAt.ToString("O"),
            r.OrganizationName, // non-nullable — AuditLog.organization is a required FK relation
            ActorName(r),
            r.Action,
            r.Entity,
            r.EntityId ?? "-",
            r.IpAddress ?? "-",
        ]));
        return string.Join('\n', new[] { header }.Concat(lines));
    }

    private static object BuildJson(IReadOnlyList<AuditLogExportRow> rows) => rows.Select(r => new
    {
        date = r.CreatedAt.ToString("O"),
        organization = r.OrganizationName,
        actor = ActorName(r),
        action = r.Action,
        entity = r.Entity,
        entityId = r.EntityId,
        ip = r.IpAddress,
    });
}
```

- [ ] **Step 3: Wire DI + flag-gated mapping in `Program.cs`** (alongside the existing `DeiReadEnabled`/`ReportingReadEnabled` blocks)

```csharp
// services/Tims.Platform/src/Tims.Api/Program.cs — near the other AddDbContext<...ReadDbContext> calls
builder.Services.AddDbContext<AuditReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
builder.Services.AddScoped<IAuditReadRepository, AuditReadRepository>();
```

```csharp
// services/Tims.Platform/src/Tims.Api/Program.cs — near the other `if (options.XReadEnabled || isOpenApiDocGeneration)` blocks
if (externalOptions.AuditLogReadEnabled || isOpenApiDocGeneration)
{
    app.MapAuditReadEndpoints();
}
```

Add the two corresponding `using` directives (`Tims.Api.Audit;`, `Tims.Application.Audit;`, `Tims.Infrastructure.Audit;`) at the top of `Program.cs` alongside the existing `Tims.Api.Reporting`/etc. usings.

- [ ] **Step 4: Build**

Run: `cd services/Tims.Platform && dotnet build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add services/Tims.Platform/src/Tims.Api/Audit/AuditReadEndpoints.cs services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs services/Tims.Platform/src/Tims.Api/Program.cs
git commit -m "feat(csharp): Phase-5 Slice-17 — audit-log read endpoints, dark behind AuditLogReadEnabled"
```

---

### Task 7: `docs/architecture/table-ownership.md` ledger note

**Files:**

- Modify: `docs/architecture/table-ownership.md`

**Interfaces:** none — documentation only, but CI-checked by `scripts/table-ownership.mjs` (the `efcoreAppendOnly` entry for `audit_logs` already exists; this task extends its note, no JSON-array change, since a read mapping doesn't change the table's category).

- [ ] **Step 1: Append a note to the existing `efcoreAppendOnly` ledger entry**

Locate the `"efcoreAppendOnly"` note in `docs/architecture/table-ownership.md`'s `notes` block (the one ending "...Faithful port of the TS recordBillingAudit; Prisma keeps the DDL.") and append, in the same note string:

```
Phase-5 Slice-17 adds the FIRST read of audit_logs (AuditReadDbContext/AuditReadRepository,
Tims.Api.Audit) — deliberately NOT under TenantScope: a platform owner reads cross-org by
design, so this context runs on the default (privileged) connection with no org GUC, and RLS
does not restrict it (proven in Tims.IntegrationTests.Audit.AuditReadCrossOrgTests). Gated by
PlatformOwnerGate (principal-type-only, no permission grant) and dark-by-default behind
Platform:AuditLogReadEnabled. The table's category stays efcoreAppendOnly (Prisma DDL, C#
INSERT-only writer) — a read mapping is not an ownership change.
```

- [ ] **Step 2: Run the ledger CI check**

Run: `node scripts/table-ownership.mjs`
Expected: PASS (no JSON-array change, so nothing new to validate structurally; confirms the doc edit didn't break the machine-readable JSON block).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/table-ownership.md
git commit -m "docs(csharp): table-ownership note — Phase-5 Slice-17 audit_logs read mapping"
```

---

### Task 8: Cross-org + auth-matrix integration tests

**Files:**

- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadCrossOrgTests.cs`
- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadEndpointAuthTests.cs`

**Interfaces:**

- Consumes: `AuditReadFixture` (Task 4 — reused, NOT recreated here), `AuditReadDbContext` (Task 3), the full `WebApplication<Program>` (Task 6).
- Produces: the two regression suites this slice's design doc calls for (cross-org visibility proof + the 4-principal-type auth matrix).

`AuditReadFixture` already exists (built in Task 4), including the `[CollectionDefinition("AuditRead")]` declaration — do not redeclare its schema/seed SQL or the collection definition here; both test classes below reference it via the same `[Collection("AuditRead")]` pattern `AuditReadRepositoryTests` (Task 4) already established.

- [ ] **Step 1: Write the cross-org visibility test (proves the intentional no-TenantScope behavior)**

```csharp
// services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadCrossOrgTests.cs
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

[Collection("AuditRead")]
public sealed class AuditReadCrossOrgTests(AuditReadFixture fixture)
{
    private readonly AuditReadFixture _fixture = fixture;

    [Fact]
    public async Task QueryingWithoutTenantScope_SeesRowsFromEveryOrg()
    {
        // No TenantScope.BeginAsync anywhere in this test — proves the repository's default
        // (privileged) connection is NOT subject to the tenant_isolation RLS policy, by design.
        await using var db = _fixture.NewReadContext();

        var orgIds = db.AuditLogs.Select(a => a.OrganizationId).Distinct().ToList();

        Assert.Contains(AuditReadFixture.OrgA, orgIds);
        Assert.Contains(AuditReadFixture.OrgB, orgIds);
    }
}
```

- [ ] **Step 2: Write the platform-owner-gate HTTP auth-matrix test**

```csharp
// services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadEndpointAuthTests.cs
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// Phase-5 Slice 17 endpoint boot matrix: real host + real Postgres, driving the REAL HTTP
/// pipeline through PrincipalResolver + PlatformOwnerGate:
///   platform-owner → 200; resolvable ordinary org-user → 403; no/tampered JWT → 401;
///   flag OFF (default) → 404 (dark, bite-proven, matching every prior slice).
/// </summary>
[Collection("AuditRead")]
public sealed class AuditReadEndpointAuthTests(AuditReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string LogsPath = "/audit/logs";
    private const string ExportPath = "/audit/logs/export";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "audit-test-key" };

    private readonly AuditReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AuditLogReadEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

    private static string Mint(string sub)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null) request.Headers.Add("Authorization", $"Bearer {token}");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task PlatformOwner_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, LogsPath, Mint(AuditReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("login_failed", body); // cross-org rows visible — both OrgA and OrgB rows present
    }

    [Fact]
    public async Task OrdinaryOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, LogsPath, Mint(AuditReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, LogsPath, token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(LogsPath);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- export endpoint: platform-owner gate applies identically, and the CSV is hardened -------
    [Fact]
    public async Task PlatformOwner_Export_Is200_WithHardenedCsv()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(AuditReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"Fecha\",\"Organizacion\",\"Actor\",\"Accion\",\"Entidad\",\"ID Entidad\",\"IP\"", body);
        Assert.Contains("Sistema", body); // the OrgB row has actor_id NULL (system-actioned)
    }

    [Fact]
    public async Task OrdinaryOrgUser_Export_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(AuditReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run both new suites (plus Task 4's repository test, all sharing the same fixture)**

Run: `cd services/Tims.Platform && dotnet test --filter "FullyQualifiedName~Audit"`
Expected: PASS (AuditReadRepositoryTests: 4, AuditReadCrossOrgTests: 1, AuditReadEndpointAuthTests: 7 — PlatformOwner_Is200, OrdinaryOrgUser_Is403, RejectedCredential_Is401 ×2 cases, Route_Is404_WhenFlagDefaultsOff, PlatformOwner_Export_Is200_WithHardenedCsv, OrdinaryOrgUser_Export_Is403).

- [ ] **Step 4: Commit**

```bash
git add services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadCrossOrgTests.cs services/Tims.Platform/tests/Tims.IntegrationTests/Audit/AuditReadEndpointAuthTests.cs
git commit -m "test(csharp): Phase-5 Slice-17 — cross-org visibility + platform-owner auth-matrix tests"
```

---

### Task 9: Parity harness — register the `audit-log` surface (Verify step)

**Files:**

- Modify: `scripts/parity/surfaces.ts`
- Modify: `scripts/parity/seed.ts` (add a platform-owner seeded identity — investigate first)

**Interfaces:**

- Consumes: `Surface`/`EndpointDef` (existing types in `surfaces.ts`).
- Produces: a new `SURFACES['audit-log']` entry.

This surface doesn't fit the existing `expectedByRole` shape cleanly — every other surface probes _org-scoped roles within one org_ (hr*admin, recruiter, ...); this one's gate is \_principal type*, independent of any org. Rather than force a new harness concept into `EndpointDef` for a single surface, this task uses the existing `roles`/`expectedByRole` fields with two SENTINEL role keys that `seed.ts` already has a natural home for: `platform_owner` (a real platform-owner seeded user, org-less) and one ordinary seeded role (any existing seeded role, e.g. `org_admin`) as the "denied" probe. No harness type changes needed.

- [ ] **Step 1: Investigate `seed.ts`'s current user-seeding shape (no code yet)**

Run: `grep -n "SeededUser\|planSeed\|is_platform_owner" scripts/parity/seed.ts`. Confirm whether a platform-owner user is already seeded anywhere (Phase-5 slices to date are all org-scoped, so likely not). If absent, add ONE additional seeded user per the existing `SeededUser` shape with `role: 'platform_owner'` and `orgKey` set to either org (a platform owner is org-less in reality, but the harness's per-(org,role) token-cache keying needs _some_ orgKey — reuse `'a'`, and note in a comment that `organizationId` is irrelevant for this identity).

- [ ] **Step 2: Register the surface**

```ts
// scripts/parity/surfaces.ts — add to the SURFACES map
'audit-log': {
  key: 'audit-log',
  flag: 'Platform__AuditLogReadEnabled',
  roles: ['platform_owner', 'org_admin'],
  probeRole: 'org_admin', // an org-scoped role — RLS/cross-tenant probing is N/A here; see globalScope below
  endpoints: [{
    name: 'logs',
    csharpPath: '/audit/logs',
    tsProcedure: 'platform.getCrossOrgAuditLogs',
    input: {},
    expectedByRole: { platform_owner: 200, org_admin: 403 },
    // This surface is intentionally cross-org (a platform owner sees every org's rows) — the
    // Mode-B "identical payload across orgs ⇒ leak" heuristic does not apply the way it does for
    // a genuinely global/config read (e.g. billing/config); it isn't tenant-scoped at all, so the
    // RLS check for this endpoint is a documented N/A, not a leak signal. Parity + RBAC (the
    // platform-owner-vs-denied gate) still run unchanged and are the meaningful checks here.
    globalScope: true,
  }],
},
```

- [ ] **Step 3: Manual verification note (no code — the live run needs `.env` secrets)**

This surface's manual pre-flip verification (per `docs/superpowers/plans/2026-07-24-cutover-verification-harness.md`'s "Post-plan: live pre-flip run") is `npx tsx scripts/parity/cli.ts parity audit-log` once `.env` is filled and the C# route is deployed dark. Not runnable in this task (no live secrets in this environment) — record this as the explicit follow-up for whoever runs the pre-canary check.

- [ ] **Step 4: Run the harness's own unit tests (pure logic, no live calls)**

Run: `npx vitest run scripts/parity/surfaces.test.ts`
Expected: PASS — confirms the new `SURFACES['audit-log']` entry doesn't break the existing registry shape assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/surfaces.ts scripts/parity/seed.ts
git commit -m "feat(parity): register the audit-log surface (platform-owner-gate, not org-RBAC)"
```

---

## Post-plan: what this plan deliberately does NOT do

- No production ownership flip, no TS-code deletion (`routers/platform/system.ts`'s `getCrossOrgAuditLogs`/`exportAuditLogsCsv` stay live and untouched) — Federico-only, at canary, per every prior slice.
- No touch to `routers/audit.ts` (confirmed dead code) or the access-review surface (Slice 18).
- No live parity/RLS/RBAC run against prod (`scripts/parity/cli.ts verify audit-log`) — that's the manual pre-canary step, not a plan task.
