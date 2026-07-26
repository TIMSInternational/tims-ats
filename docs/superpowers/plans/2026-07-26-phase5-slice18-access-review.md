# Phase-5 Slice-18 (Access Review, CB-2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 4 platform-owner-only access-review procedures (report, CSV export, attestation write, attestation history) from `packages/api/src/routers/platform/access-review.ts` to a new dark-by-default C# surface in `services/Tims.Platform`, reusing Slice-17's `PlatformOwnerGate` verbatim and adding a new generic `SecurityEventWriter` for audit-trail parity.

**Architecture:** One privileged `AccessReviewDbContext` (no `TenantScope`) covers both the report reads (users/roles/user_roles/role_permissions/permissions/organizations, local read-entities, no EF navigation properties — batched lookups, not joins-via-navigation, matching the `AuditReadDbContext` precedent) and the `access_reviews` read/write. A pure `Tims.Domain.AccessReview.AccessRiskKernel` computes the 6 risk flags. `AccessReviewService` orchestrates (fetch → kernel → shape → summarize; attest = org-exists check → rebuild report → refuse-if-truncated → insert). `AccessReviewEndpoints` (2 extension methods, gated by 2 separate `PlatformOptions` flags) call `PlatformOwnerGate` then the service, then fire the new `SecurityEventWriter` for audit-trail parity.

**Tech Stack:** .NET 10 minimal APIs, EF Core (Npgsql), xUnit + Testcontainers.PostgreSql (integration), xUnit (unit), TypeScript/Vitest (golden-fixture parity tests).

## Global Constraints

- Every new endpoint requires `PlatformOwnerGate.AuthorizeAsync` (401 unresolvable principal, 403 non-platform-owner) — reused verbatim, zero changes to that file.
- Both new feature flags (`AccessReviewReadEnabled`, `AccessReviewWriteEnabled`) default `false` — every route must 404 when its flag is off, matching every prior Phase-5 slice.
- `notes` input is bounded `.max(2000)` chars (matches the real TS Zod schema — CLAUDE.md's "bound all strings" rule).
- `limit` (attestation history) is bounded 1–100, default 20.
- No EF navigation properties on the new read entities — batched lookups in the repository (matches `AuditReadDbContext`/`AuditReadRepository`'s established Phase-5 convention, not `IdentityDbContext`'s nav-property style).
- `AccessReviewDbContext` and the new `SecurityEventWriter` never use `TenantScope` — this is the privileged, cross-org path (a platform owner isn't a tenant member).
- All committed code must build clean (`dotnet build`, 0 warnings) and all tests must pass (`dotnet test`) before every commit.
- Every task ends with a commit. Never batch multiple tasks into one commit.

---

### Task 1: TS golden fixtures — characterize the real access-review behavior

**Files:**

- Create: `contracts/access-review-fixtures/access-review-report.json`
- Create: `contracts/access-review-fixtures/export-access-review-csv.json`
- Create: `contracts/access-review-fixtures/risk-flags.json`
- Test: `tests/parity/access-review-fixtures.test.ts`

**Interfaces:**

- Produces: three JSON fixture files consumed by name (`contracts/access-review-fixtures/<name>.json`) by later C# tests (Tasks 6–8) — the fixture VALUES (not any TS type) are the cross-language contract.

- [ ] **Step 1: Write the report-shape fixture**

```json
{
  "rows": [
    {
      "userId": "c0000000-0000-0000-0000-000000000002",
      "name": "Rick Recruiter",
      "email": "orguser@tims.test",
      "organizationId": "11111111-1111-1111-1111-111111111111",
      "orgName": "Acme Corp",
      "status": "active",
      "isPlatformOwner": false,
      "lastLoginAt": "2026-07-25T10:00:00.000Z",
      "roles": [
        {
          "slug": "recruiter",
          "name": "Recruiter",
          "roleActive": true,
          "assignedAt": "2026-01-01T00:00:00.000Z",
          "assignedBy": "c0000000-0000-0000-0000-000000000001",
          "companyScope": null,
          "unitScope": null,
          "expiresAt": null,
          "grants": ["candidate:read:own", "candidate:update:own"]
        }
      ],
      "flags": {
        "neverLoggedIn": false,
        "stale": false,
        "privileged": false,
        "deprovisionGap": false,
        "expiredGrant": false,
        "crossOrgRole": false
      }
    }
  ],
  "summary": {
    "userCount": 1,
    "privilegedCount": 0,
    "staleCount": 0,
    "deprovisionGapCount": 0,
    "expiredGapCount": 0
  },
  "crossOrgRoleCount": 0,
  "truncated": false
}
```

- [ ] **Step 2: Write the CSV export fixture**

```json
{
  "header": "\"Usuario\",\"Email\",\"Organizacion\",\"Estado\",\"Rol\",\"Alcance\",\"AsignadoPor\",\"Privilegiado\",\"Inactivo\",\"SinAcceso\",\"BrechaBaja\",\"Expirado\",\"RolCruzado\"",
  "sample": {
    "name": "=cmd|' /c calc'!A0",
    "email": "orguser@tims.test",
    "orgName": "Acme Corp",
    "status": "active",
    "roleSlug": "recruiter",
    "companyScope": "22222222-0000-0000-0000-000000000001",
    "unitScope": null,
    "assignedBy": "c0000000-0000-0000-0000-000000000001",
    "privileged": "N",
    "stale": "N",
    "neverLoggedIn": "N",
    "deprovisionGap": "N",
    "expiredGrant": "N",
    "crossOrgRole": "N"
  },
  "expectedCsvRow": "\"'=cmd|' /c calc'!A0\",\"orguser@tims.test\",\"Acme Corp\",\"active\",\"recruiter\",\"22222222-0000-0000-0000-000000000001\",\"c0000000-0000-0000-0000-000000000001\",\"N\",\"N\",\"N\",\"N\",\"N\",\"N\""
}
```

- [ ] **Step 3: Write the risk-flags fixture (one scenario per flag + precedence + boundary, matching the real `tests/security/access-review.test.ts` exactly)**

```json
{
  "now": "2026-07-17T00:00:00.000Z",
  "org": "11111111-1111-1111-1111-111111111111",
  "otherOrg": "22222222-2222-2222-2222-222222222222",
  "scenarios": {
    "healthyActiveRecruiter": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedStatus": "active",
      "expectedFlags": {
        "neverLoggedIn": false,
        "stale": false,
        "privileged": false,
        "deprovisionGap": false,
        "expiredGrant": false,
        "crossOrgRole": false
      }
    },
    "neverLoggedIn": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": null,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedFlags": { "neverLoggedIn": true }
    },
    "staleAtBoundaryOver": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 91,
      "roles": [],
      "isPlatformOwner": false,
      "expectedFlags": { "stale": true }
    },
    "staleAtBoundaryUnder": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 89,
      "roles": [],
      "isPlatformOwner": false,
      "expectedFlags": { "stale": false }
    },
    "privilegedBySuperAdminRole": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "super_admin", "organizationId": "SAME", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedFlags": { "privileged": true }
    },
    "privilegedByPlatformOwner": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [],
      "isPlatformOwner": true,
      "expectedFlags": { "privileged": true }
    },
    "deprovisionGapInactiveWithRole": {
      "isActive": false,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedStatus": "inactive",
      "expectedFlags": { "deprovisionGap": true, "neverLoggedIn": false, "stale": false, "expiredGrant": false }
    },
    "deprovisionGapDeletedWithRole": {
      "isActive": true,
      "deletedAtIsNow": true,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedStatus": "deleted",
      "expectedFlags": { "deprovisionGap": true }
    },
    "noDeprovisionGapWhenNoRoleAndInactive": {
      "isActive": false,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [],
      "isPlatformOwner": false,
      "expectedFlags": { "deprovisionGap": false }
    },
    "expiredGrantActive": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": 1 }],
      "isPlatformOwner": false,
      "expectedFlags": { "expiredGrant": true }
    },
    "expiredGrantFutureExpiryIsFine": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": -30 }],
      "isPlatformOwner": false,
      "expectedFlags": { "expiredGrant": false }
    },
    "expiredGrantNotCountedWhenInactive": {
      "isActive": false,
      "deletedAt": null,
      "lastLoginAtDaysAgo": null,
      "roles": [{ "slug": "recruiter", "organizationId": "SAME", "expiresAtDaysAgo": 1 }],
      "isPlatformOwner": false,
      "expectedFlags": { "expiredGrant": false, "deprovisionGap": true }
    },
    "crossOrgRole": {
      "isActive": true,
      "deletedAt": null,
      "lastLoginAtDaysAgo": 1,
      "roles": [{ "slug": "recruiter", "organizationId": "OTHER", "expiresAtDaysAgo": null }],
      "isPlatformOwner": false,
      "expectedFlags": { "crossOrgRole": true }
    }
  }
}
```

- [ ] **Step 4: Write the vitest that pins these fixtures against the REAL kernel/CSV code**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvCell } from '../../packages/shared/src/csv';
import {
  assessUserAccess,
  accessStatusOf,
  type UserAccessInput,
} from '../../packages/api/src/access/access-review-kernel';

const ROOT = join(__dirname, '..', '..');
const fixture = (p: string) => JSON.parse(readFileSync(join(ROOT, 'contracts/access-review-fixtures', p), 'utf8'));

describe('access-review-report fixture', () => {
  it('pins the report shape: rows[], summary, crossOrgRoleCount, truncated', () => {
    const f = fixture('access-review-report.json');
    expect(f).toHaveProperty('rows');
    expect(f).toHaveProperty('summary');
    expect(f).toHaveProperty('crossOrgRoleCount');
    expect(f).toHaveProperty('truncated');
    const row = f.rows[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'userId',
        'name',
        'email',
        'organizationId',
        'orgName',
        'status',
        'isPlatformOwner',
        'lastLoginAt',
        'roles',
        'flags',
      ].sort(),
    );
    const role = row.roles[0];
    expect(Object.keys(role).sort()).toEqual(
      [
        'slug',
        'name',
        'roleActive',
        'assignedAt',
        'assignedBy',
        'companyScope',
        'unitScope',
        'expiresAt',
        'grants',
      ].sort(),
    );
  });
});

describe('export-access-review-csv fixture', () => {
  it('pins the 13-column header + a formula-injection row, byte-for-byte via csvCell', () => {
    const f = fixture('export-access-review-csv.json');
    const header = [
      'Usuario',
      'Email',
      'Organizacion',
      'Estado',
      'Rol',
      'Alcance',
      'AsignadoPor',
      'Privilegiado',
      'Inactivo',
      'SinAcceso',
      'BrechaBaja',
      'Expirado',
      'RolCruzado',
    ]
      .map(csvCell)
      .join(',');
    expect(f.header).toBe(header);

    const s = f.sample;
    const row = [
      csvCell(s.name),
      csvCell(s.email),
      csvCell(s.orgName),
      csvCell(s.status),
      csvCell(s.roleSlug),
      csvCell([s.companyScope, s.unitScope].filter(Boolean).join('|') || '-'),
      csvCell(s.assignedBy),
      csvCell(s.privileged),
      csvCell(s.stale),
      csvCell(s.neverLoggedIn),
      csvCell(s.deprovisionGap),
      csvCell(s.expiredGrant),
      csvCell(s.crossOrgRole),
    ].join(',');
    expect(row).toBe(f.expectedCsvRow);
    expect(row).toContain("'="); // the neutralization prefix survived quoting
  });
});

describe('risk-flags fixture — pins assessUserAccess against every named scenario', () => {
  const f = fixture('risk-flags.json');
  const now = new Date(f.now);
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const toInput = (s: (typeof f.scenarios)[string]): UserAccessInput => ({
    organizationId: f.org,
    isActive: s.isActive,
    deletedAt: s.deletedAtIsNow ? now : null,
    lastLoginAt: s.lastLoginAtDaysAgo == null ? null : daysAgo(s.lastLoginAtDaysAgo),
    roles: (s.roles ?? []).map((r: { slug: string; organizationId: string; expiresAtDaysAgo: number | null }) => ({
      slug: r.slug,
      organizationId: r.organizationId === 'OTHER' ? f.otherOrg : f.org,
      expiresAt: r.expiresAtDaysAgo == null ? null : daysAgo(r.expiresAtDaysAgo),
    })),
    isPlatformOwner: s.isPlatformOwner,
    now,
  });

  for (const [name, scenario] of Object.entries(f.scenarios) as [string, (typeof f.scenarios)[string]][]) {
    it(`scenario "${name}" matches assessUserAccess + accessStatusOf`, () => {
      const input = toInput(scenario);
      const result = assessUserAccess(input);
      if (scenario.expectedStatus) {
        expect(result.status).toBe(scenario.expectedStatus);
        expect(accessStatusOf({ isActive: input.isActive, deletedAt: input.deletedAt })).toBe(scenario.expectedStatus);
      }
      for (const [flag, expected] of Object.entries(scenario.expectedFlags)) {
        expect(result.flags[flag as keyof typeof result.flags]).toBe(expected);
      }
    });
  }
});
```

- [ ] **Step 5: Run the fixture tests**

Run: `npx vitest run tests/parity/access-review-fixtures.test.ts`
Expected: all `it` blocks pass (13 scenario tests + 2 shape/CSV tests).

- [ ] **Step 6: Commit**

```bash
git add contracts/access-review-fixtures/ tests/parity/access-review-fixtures.test.ts
git commit -m "test(parity): golden fixtures for access-review report/CSV/risk-flags"
```

---

### Task 2: C# domain layer — AccessRiskKernel + view records

**Files:**

- Create: `services/Tims.Platform/src/Tims.Domain/AccessReview/AccessRiskKernel.cs`
- Create: `services/Tims.Platform/src/Tims.Domain/AccessReview/AccessReviewView.cs`
- Modify: `services/Tims.Platform/src/Tims.Domain/Json/NodeIsoDateTimeOffsetConverter.cs` (add a nullable plain-`DateTime` converter — none exists yet, needed for `LastLoginAt`/`ExpiresAt`)
- Test: `services/Tims.Platform/tests/Tims.UnitTests/AccessReview/AccessRiskKernelTests.cs`

**Interfaces:**

- Produces: `AccessStatus` enum, `RoleAssignment` record, `AccessRiskFlags` record, `UserAccessInput` record, `AccessRiskKernel.AccessStatusOf(bool, DateTime?)`, `AccessRiskKernel.IsMfaPrivileged(IEnumerable<string>, bool)`, `AccessRiskKernel.AssessUserAccess(UserAccessInput)` returning `(AccessStatus Status, AccessRiskFlags Flags)`. Also `RoleGrantView`, `AccessReviewRow`, `AccessReviewSummary`, `AccessReviewReport` records, and `NodeIsoNullableDateTimeConverter`. Task 4 (repository) and Task 6 (service) consume these exact names/shapes.

- [ ] **Step 1: Write the failing kernel test**

```csharp
using Tims.Domain.AccessReview;
using Xunit;

namespace Tims.UnitTests.AccessReview;

public sealed class AccessRiskKernelTests
{
    private static readonly DateTime Now = new(2026, 7, 17, 0, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherOrg = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static DateTime DaysAgo(int n) => Now.AddDays(-n);

    private static RoleAssignment Role(string slug, Guid? organizationId = null, DateTime? expiresAt = null) =>
        new(slug, organizationId ?? Org, expiresAt);

    private static UserAccessInput Base(
        bool isActive = true, DateTime? deletedAt = null, DateTime? lastLoginAt = null,
        IReadOnlyList<RoleAssignment>? roles = null, bool isPlatformOwner = false) =>
        new(Org, isActive, deletedAt, lastLoginAt ?? DaysAgo(1), roles ?? [Role("recruiter")], isPlatformOwner, Now);

    [Fact]
    public void AccessStatusOf_DeletedBeatsInactiveBeatsActive()
    {
        Assert.Equal(AccessStatus.Deleted, AccessRiskKernel.AccessStatusOf(isActive: true, deletedAt: Now));
        Assert.Equal(AccessStatus.Inactive, AccessRiskKernel.AccessStatusOf(isActive: false, deletedAt: null));
        Assert.Equal(AccessStatus.Active, AccessRiskKernel.AccessStatusOf(isActive: true, deletedAt: null));
    }

    [Fact]
    public void HealthyActiveRecruiter_RaisesNoFlags()
    {
        var (status, flags) = AccessRiskKernel.AssessUserAccess(Base());
        Assert.Equal(AccessStatus.Active, status);
        Assert.Equal(new AccessRiskFlags(false, false, false, false, false, false), flags);
    }

    [Fact]
    public void NeverLoggedIn_ActiveWithNoLogin()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: null)).Flags.NeverLoggedIn);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.NeverLoggedIn);
    }

    [Theory]
    [InlineData(91, true)]
    [InlineData(89, false)]
    public void Stale_BoundaryAtNinetyDays(int daysAgo, bool expectedStale)
    {
        Assert.Equal(expectedStale, AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: DaysAgo(daysAgo))).Flags.Stale);
    }

    [Fact]
    public void Stale_NeverFiresWhenNoLogin()
    {
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: null)).Flags.Stale);
    }

    [Fact]
    public void Privileged_BySuperAdminRoleOrPlatformOwnerFlag()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("super_admin")])).Flags.Privileged);
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(isPlatformOwner: true)).Flags.Privileged);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.Privileged);
    }

    [Fact]
    public void DeprovisionGap_InactiveOrDeletedButStillHoldsARole()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(isActive: false)).Flags.DeprovisionGap);
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(deletedAt: Now)).Flags.DeprovisionGap);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(isActive: false, roles: [])).Flags.DeprovisionGap);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.DeprovisionGap);
    }

    [Fact]
    public void ExpiredGrant_ActiveUserHoldingAnExpiredRole_IsLiveLingeringAccess()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", expiresAt: DaysAgo(1))])).Flags.ExpiredGrant);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", expiresAt: DaysAgo(-30))])).Flags.ExpiredGrant);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.ExpiredGrant);
    }

    [Fact]
    public void ExpiredGrant_NotCountedWhenUserIsInactive_CountsAsDeprovisionGapInstead()
    {
        var (_, flags) = AccessRiskKernel.AssessUserAccess(
            Base(isActive: false, lastLoginAt: null, roles: [Role("recruiter", expiresAt: DaysAgo(1))]));
        Assert.False(flags.ExpiredGrant);
        Assert.True(flags.DeprovisionGap);
    }

    [Fact]
    public void CrossOrgRole_RoleBelongsToADifferentOrgThanTheUser()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", organizationId: OtherOrg)])).Flags.CrossOrgRole);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.CrossOrgRole);
    }

    [Fact]
    public void InactiveAccount_NeverRaisesActiveOnlyFlags()
    {
        var (_, flags) = AccessRiskKernel.AssessUserAccess(
            Base(isActive: false, lastLoginAt: null, roles: [Role("recruiter", expiresAt: DaysAgo(1))]));
        Assert.False(flags.NeverLoggedIn);
        Assert.False(flags.Stale);
        Assert.False(flags.ExpiredGrant);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.UnitTests --filter "FullyQualifiedName~AccessRiskKernelTests"`
Expected: FAIL (compile error — `Tims.Domain.AccessReview` namespace does not exist yet).

- [ ] **Step 3: Write the nullable-DateTime converter (append to the existing file)**

```csharp
/// <summary>
/// Nullable variant of <see cref="NodeIsoDateTimeConverter"/> — for `timestamp without time zone`
/// columns that are also nullable (e.g. `users.last_login_at`, `user_roles.expires_at`). A `null`
/// serializes as JSON `null` (matching the TS `Date | null → null`).
/// </summary>
public sealed class NodeIsoNullableDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null
            ? null
            : DateTime.Parse(
                reader.GetString() ?? throw new JsonException("expected an ISO-8601 date string"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind);

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is { } instant)
        {
            writer.WriteStringValue(NodeIsoDateTimeConverter.ToNodeIso(instant));
        }
        else
        {
            writer.WriteNullValue();
        }
    }
}
```

- [ ] **Step 4: Write the pure kernel**

```csharp
namespace Tims.Domain.AccessReview;

/// <summary>
/// Port of `packages/api/src/access/access-review-kernel.ts` — pure, deterministic risk
/// classification for a quarterly access review (SOC 2 CC6.2–6.3 / ISO A.5.18). `now` is injected
/// (never `DateTime.UtcNow` read internally) so callers are golden-testable.
/// </summary>
public enum AccessStatus
{
    Active,
    Inactive,
    Deleted,
}

/// <summary>A role assignment as the kernel needs it — <see cref="OrganizationId"/> is the ROLE's
/// owning org (compared to the user's org to detect grant corruption), not the user's.</summary>
public sealed record RoleAssignment(string Slug, Guid OrganizationId, DateTime? ExpiresAt);

public sealed record AccessRiskFlags(
    bool NeverLoggedIn,
    bool Stale,
    bool Privileged,
    bool DeprovisionGap,
    bool ExpiredGrant,
    bool CrossOrgRole);

public sealed record UserAccessInput(
    Guid OrganizationId,
    bool IsActive,
    DateTime? DeletedAt,
    DateTime? LastLoginAt,
    IReadOnlyList<RoleAssignment> Roles,
    bool IsPlatformOwner,
    DateTime Now);

public static class AccessRiskKernel
{
    public const int StaleLoginDays = 90;
    private const double DayMs = 24d * 60 * 60 * 1000;

    public static AccessStatus AccessStatusOf(bool isActive, DateTime? deletedAt)
    {
        if (deletedAt is not null)
        {
            return AccessStatus.Deleted;
        }

        return isActive ? AccessStatus.Active : AccessStatus.Inactive;
    }

    /// <summary>Port of `packages/shared/src/mfa.ts`'s `isMfaPrivileged` — the single-source-of-truth
    /// privileged-role set shared with the MFA gate in TS. Only this decision is needed here, not the
    /// session/AAL logic the rest of that module carries.</summary>
    public static bool IsMfaPrivileged(IEnumerable<string> roleSlugs, bool isPlatformOwner) =>
        isPlatformOwner || roleSlugs.Any(slug => slug is "super_admin" or "platform_owner");

    public static (AccessStatus Status, AccessRiskFlags Flags) AssessUserAccess(UserAccessInput u)
    {
        var status = AccessStatusOf(u.IsActive, u.DeletedAt);
        var active = status == AccessStatus.Active;
        var hasGrant = u.IsPlatformOwner || u.Roles.Count > 0;

        var flags = new AccessRiskFlags(
            NeverLoggedIn: active && u.LastLoginAt is null,
            Stale: active && u.LastLoginAt is { } lastLogin && (u.Now - lastLogin).TotalMilliseconds > StaleLoginDays * DayMs,
            Privileged: IsMfaPrivileged(u.Roles.Select(r => r.Slug), u.IsPlatformOwner),
            DeprovisionGap: !active && hasGrant,
            ExpiredGrant: active && u.Roles.Any(r => r.ExpiresAt is { } expiresAt && expiresAt < u.Now),
            CrossOrgRole: u.Roles.Any(r => r.OrganizationId != u.OrganizationId));

        return (status, flags);
    }
}
```

- [ ] **Step 5: Write the view records (report/row/summary shapes)**

```csharp
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.AccessReview;

/// <summary>
/// Orchestration-output shapes for the access-review report — independent of any EF entity
/// (mirrors `AuditLogView.cs`'s split from the repository layer). Field names/shapes match
/// `access-review.service.ts`'s `RoleGrantView`/`AccessReviewRow`/`AccessReviewSummary`/
/// `AccessReviewReport` interfaces exactly (pinned by Task 1's `access-review-report.json` fixture).
/// </summary>
public sealed record RoleGrantView(
    string Slug,
    string Name,
    bool RoleActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime AssignedAt,
    Guid? AssignedBy,
    Guid? CompanyScope,
    Guid? UnitScope,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? ExpiresAt,
    IReadOnlyList<string> Grants);

public sealed record AccessReviewRow(
    Guid UserId,
    string Name,
    string Email,
    Guid OrganizationId,
    string? OrgName,
    AccessStatus Status,
    bool IsPlatformOwner,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastLoginAt,
    IReadOnlyList<RoleGrantView> Roles,
    AccessRiskFlags Flags);

public sealed record AccessReviewSummary(
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount);

public sealed record AccessReviewReport(
    IReadOnlyList<AccessReviewRow> Rows,
    AccessReviewSummary Summary,
    int CrossOrgRoleCount,
    bool Truncated);

/// <summary>The attestation row as returned by an INSERT (no reviewer join — matches
/// `access-review.repository.ts`'s `insertAttestation` select exactly).</summary>
public sealed record AccessReviewAttestation(
    Guid Id,
    Guid OrganizationId,
    Guid ReviewerId,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ReviewedAt,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes);

/// <summary>One attestation-history item — WITH the nested reviewer join (matches
/// `listAttestations`'s select, which DIFFERS from `insertAttestation`'s: no `organizationId`/
/// `reviewerId` scalar, but a nested `reviewer` object instead).</summary>
public sealed record AccessReviewAttestationHistoryItem(
    Guid Id,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ReviewedAt,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes,
    AccessReviewReviewerView Reviewer);

public sealed record AccessReviewReviewerView(string FirstName, string LastName, string Email);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.UnitTests --filter "FullyQualifiedName~AccessRiskKernelTests"`
Expected: PASS (12 tests).

- [ ] **Step 7: Commit**

```bash
git add services/Tims.Platform/src/Tims.Domain/AccessReview/ services/Tims.Platform/src/Tims.Domain/Json/NodeIsoDateTimeOffsetConverter.cs services/Tims.Platform/tests/Tims.UnitTests/AccessReview/
git commit -m "feat(csharp): Phase-5 Slice-18 — AccessRiskKernel + view records"
```

---

### Task 3: AccessReviewDbContext + entities (Infrastructure)

**Files:**

- Create: `services/Tims.Platform/src/Tims.Infrastructure/AccessReview/AccessReviewDbContext.cs`

**Interfaces:**

- Consumes: nothing from earlier tasks (pure EF mapping).
- Produces: `AccessReviewDbContext` with `DbSet<AccessReviewUserEntity> Users`, `DbSet<AccessReviewRoleEntity> Roles`, `DbSet<AccessReviewUserRoleEntity> UserRoles`, `DbSet<AccessReviewRolePermissionEntity> RolePermissions`, `DbSet<AccessReviewPermissionEntity> Permissions`, `DbSet<AccessReviewOrganizationEntity> Organizations`, `DbSet<AccessReviewEntity> AccessReviews`. Task 4 (repository) queries these directly (no navigation properties — batched lookups).

- [ ] **Step 1: Write the context + entities**

```csharp
using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.AccessReview;

/// <summary>
/// ONE privileged EF context covering both the access-review REPORT reads (users/roles/user_roles/
/// role_permissions/permissions/organizations — Prisma-owned, `efcoreReadOnly` since Phase 2) and the
/// `access_reviews` read+write (Prisma-owned until this slice ships; moves to `efcoreStranglerWrite`
/// in the table-ownership ledger, Task 9). NEVER wrapped in <see cref="Tims.Infrastructure.TenantScope"/>
/// — a platform owner isn't a tenant member, so there's no `SET LOCAL ROLE app_tenant` + org GUC to
/// wrap either path in (see the Slice-18 design doc's "Why this is a new pattern" section for why one
/// context, not a read/write split, is correct here — unlike other Phase-5 domains, there is no
/// scoping-boundary difference between the two paths to isolate).
///
/// NO navigation properties on the read entities (matches <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/>'s
/// convention, not <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>'s) — Task 4's repository
/// does batched lookups (fetch users, then user_roles for those user ids, then roles for those role
/// ids, then role_permissions+permissions for those role ids), never one deep nested query.
///
/// Local entities carry ONLY the columns access-review needs, which is a RICHER column set than
/// <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>'s minimal principal-resolution
/// mapping (that context is reserved for the hot pre-tenant-resolution path — do not extend it).
/// </summary>
public sealed class AccessReviewDbContext(DbContextOptions<AccessReviewDbContext> options) : DbContext(options)
{
    public DbSet<AccessReviewUserEntity> Users => Set<AccessReviewUserEntity>();

    public DbSet<AccessReviewRoleEntity> Roles => Set<AccessReviewRoleEntity>();

    public DbSet<AccessReviewUserRoleEntity> UserRoles => Set<AccessReviewUserRoleEntity>();

    public DbSet<AccessReviewRolePermissionEntity> RolePermissions => Set<AccessReviewRolePermissionEntity>();

    public DbSet<AccessReviewPermissionEntity> Permissions => Set<AccessReviewPermissionEntity>();

    public DbSet<AccessReviewOrganizationEntity> Organizations => Set<AccessReviewOrganizationEntity>();

    public DbSet<AccessReviewEntity> AccessReviews => Set<AccessReviewEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AccessReviewUserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.OrganizationId).HasColumnName("organization_id");
            entity.Property(u => u.FirstName).HasColumnName("first_name");
            entity.Property(u => u.LastName).HasColumnName("last_name");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.IsActive).HasColumnName("is_active");
            entity.Property(u => u.DeletedAt).HasColumnName("deleted_at");
            entity.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
            entity.Property(u => u.IsPlatformOwner).HasColumnName("is_platform_owner");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<AccessReviewRoleEntity>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Slug).HasColumnName("slug");
            entity.Property(r => r.Name).HasColumnName("name");
            entity.Property(r => r.IsActive).HasColumnName("is_active");
        });

        modelBuilder.Entity<AccessReviewUserRoleEntity>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(ur => ur.Id);
            entity.Property(ur => ur.Id).HasColumnName("id");
            entity.Property(ur => ur.UserId).HasColumnName("user_id");
            entity.Property(ur => ur.RoleId).HasColumnName("role_id");
            entity.Property(ur => ur.AssignedAt).HasColumnName("assigned_at");
            entity.Property(ur => ur.AssignedBy).HasColumnName("assigned_by");
            entity.Property(ur => ur.CompanyScope).HasColumnName("company_scope");
            entity.Property(ur => ur.UnitScope).HasColumnName("unit_scope");
            entity.Property(ur => ur.ExpiresAt).HasColumnName("expires_at");
        });

        modelBuilder.Entity<AccessReviewRolePermissionEntity>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(rp => rp.Id);
            entity.Property(rp => rp.Id).HasColumnName("id");
            entity.Property(rp => rp.RoleId).HasColumnName("role_id");
            entity.Property(rp => rp.PermissionId).HasColumnName("permission_id");
            entity.Property(rp => rp.Scope).HasColumnName("scope");
        });

        modelBuilder.Entity<AccessReviewPermissionEntity>(entity =>
        {
            entity.ToTable("permissions");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.Module).HasColumnName("module");
            entity.Property(p => p.Action).HasColumnName("action");
        });

        modelBuilder.Entity<AccessReviewOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
        });

        modelBuilder.Entity<AccessReviewEntity>(entity =>
        {
            entity.ToTable("access_reviews");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.ReviewerId).HasColumnName("reviewer_id");
            entity.Property(a => a.ReviewedAt).HasColumnName("reviewed_at").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
            entity.Property(a => a.UserCount).HasColumnName("user_count");
            entity.Property(a => a.PrivilegedCount).HasColumnName("privileged_count");
            entity.Property(a => a.StaleCount).HasColumnName("stale_count");
            entity.Property(a => a.DeprovisionGapCount).HasColumnName("deprovision_gap_count");
            entity.Property(a => a.ExpiredGapCount).HasColumnName("expired_gap_count");
            entity.Property(a => a.Notes).HasColumnName("notes").HasMaxLength(2000);
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
        });
    }
}

public sealed class AccessReviewUserEntity
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public bool IsPlatformOwner { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AccessReviewRoleEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class AccessReviewUserRoleEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid RoleId { get; set; }
    public DateTime AssignedAt { get; set; }
    public Guid? AssignedBy { get; set; }
    public Guid? CompanyScope { get; set; }
    public Guid? UnitScope { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public sealed class AccessReviewRolePermissionEntity
{
    public Guid Id { get; set; }
    public Guid RoleId { get; set; }
    public Guid PermissionId { get; set; }
    public string Scope { get; set; } = string.Empty;
}

public sealed class AccessReviewPermissionEntity
{
    public Guid Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
}

public sealed class AccessReviewOrganizationEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
}

/// <summary>Full CRUD mapping of `access_reviews` — the ONE table this slice writes to (a history
/// table, no unique constraint: multiple attestations per org over time are expected).</summary>
public sealed class AccessReviewEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid ReviewerId { get; set; }
    public DateTime ReviewedAt { get; set; }
    public int UserCount { get; set; }
    public int PrivilegedCount { get; set; }
    public int StaleCount { get; set; }
    public int DeprovisionGapCount { get; set; }
    public int ExpiredGapCount { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd services/Tims.Platform && dotnet build`
Expected: `Build succeeded. 0 Warning(s). 0 Error(s).`

- [ ] **Step 3: Commit**

```bash
git add services/Tims.Platform/src/Tims.Infrastructure/AccessReview/
git commit -m "feat(csharp): Phase-5 Slice-18 — AccessReviewDbContext (privileged, no TenantScope)"
```

---

### Task 4: AccessReviewFixture (Testcontainers) + AccessReviewRepository + repository tests

**Files:**

- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewFixture.cs`
- Create: `services/Tims.Platform/src/Tims.Application/AccessReview/IAccessReviewRepository.cs`
- Create: `services/Tims.Platform/src/Tims.Infrastructure/AccessReview/AccessReviewRepository.cs`
- Test: `services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewRepositoryTests.cs`

**Interfaces:**

- Consumes: `AccessReviewDbContext` + entities (Task 3).
- Produces: `IAccessReviewRepository` with `FetchUsersForReviewAsync(Guid organizationId, int cap, CancellationToken)`, `OrgExistsAsync(Guid organizationId, CancellationToken)`, `InsertAttestationAsync(AccessReviewAttestationInsert, CancellationToken)`, `ListAttestationsAsync(Guid organizationId, int limit, CancellationToken)`; `AccessReviewUserRecord`/`AccessReviewUserRoleRecord` raw-fetch DTOs. Task 6 (service) consumes this interface exactly.

- [ ] **Step 1: Write the Testcontainers fixture (2 orgs, users hitting every risk flag, roles/permissions data)**

```csharp
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.AccessReview;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Phase-5 Slice 18 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED identity
/// tables (RICHER column set than <see cref="Tims.IntegrationTests.Audit.AuditReadFixture"/>'s
/// schema-only roles/user_roles — access-review actually reads assigned_at/assigned_by/scopes/
/// expires_at/role name/isActive/role_permissions/permissions, so those columns are POPULATED here,
/// not just present) + `access_reviews`. Seeds 2 orgs so org-scoping is provably correct (Task 8),
/// and rows hitting every one of the 6 risk flags (Task 2's kernel) so the report/repository tests
/// have real data to assert against.
/// </summary>
public sealed class AccessReviewFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_access_review";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-access-review-platform-owner";
    public const string OrgUserSub = "sub-access-review-org-user";

    public static readonly Guid PlatformOwnerId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    // OrgA users, one per risk-flag scenario. OrgB carries just enough to prove cross-org isolation.
    public static readonly Guid HealthyUserId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid NeverLoggedInUserId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid StaleUserId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid DeprovisionGapUserId = Guid.Parse("a0000000-0000-0000-0000-000000000004");
    public static readonly Guid ExpiredGrantUserId = Guid.Parse("a0000000-0000-0000-0000-000000000005");
    public static readonly Guid OrgBUserId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    public static readonly Guid RecruiterRoleOrgA = Guid.Parse("e0000000-0000-0000-0000-000000000001");
    public static readonly Guid RecruiterRoleOrgB = Guid.Parse("e0000000-0000-0000-0000-000000000002");
    public static readonly Guid CandidateReadPermissionId = Guid.Parse("f0000000-0000-0000-0000-000000000001");

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

        foreach (var sql in new[] { SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public AccessReviewDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AccessReviewDbContext>().UseNpgsql(ConnectionString).Options);

    // Full column set the UNION of what IdentityDbContext (auth resolution) AND AccessReviewDbContext
    // (report data) both need on the SAME physical tables — Slice-17's Task 8 hit a real bug from an
    // under-specified fixture schema; this fixture is built to avoid that class of bug from the start.
    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamp NULL,
            last_login_at timestamp NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL,
            name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id),
            assigned_at timestamp NOT NULL DEFAULT now(),
            assigned_by uuid NULL,
            company_scope uuid NULL,
            unit_scope uuid NULL,
            expires_at timestamp NULL
        );
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id),
            scope text NOT NULL DEFAULT 'own'
        );
        CREATE TABLE access_reviews (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id),
            reviewer_id uuid NOT NULL REFERENCES users (id),
            reviewed_at timestamp NOT NULL DEFAULT now(),
            user_count int NOT NULL,
            privileged_count int NOT NULL,
            stale_count int NOT NULL,
            deprovision_gap_count int NOT NULL,
            expired_gap_count int NOT NULL,
            notes varchar(2000) NULL,
            created_at timestamp NOT NULL DEFAULT now()
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON access_reviews TO app_tenant;
        ALTER TABLE access_reviews ENABLE ROW LEVEL SECURITY;
        ALTER TABLE access_reviews FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON access_reviews
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corp', true),
          ('22222222-2222-2222-2222-222222222222', 'Globex Inc', true);

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_active, deleted_at, last_login_at, is_platform_owner, created_at) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-access-review-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', true, NULL, NULL, true, '2026-01-01T00:00:00Z'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-access-review-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', true, NULL, now() - interval '1 day', false, '2026-01-01T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-healthy', 'healthy@tims.test', 'Hana', 'Healthy', true, NULL, now() - interval '1 day', false, '2026-01-02T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-never', 'never@tims.test', 'Nate', 'NeverLoggedIn', true, NULL, NULL, false, '2026-01-03T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-stale', 'stale@tims.test', 'Stan', 'Stale', true, NULL, now() - interval '91 days', false, '2026-01-04T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-deprovision', 'deprovision@tims.test', 'Dana', 'Deprovisioned', false, NULL, now() - interval '1 day', false, '2026-01-05T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-expired', 'expired@tims.test', 'Ed', 'ExpiredGrant', true, NULL, now() - interval '1 day', false, '2026-01-06T00:00:00Z'),
          ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'sub-orgb', 'orgb@tims.test', 'Bea', 'OrgB', true, NULL, now() - interval '1 day', false, '2026-01-01T00:00:00Z');

        INSERT INTO roles (id, organization_id, slug, name, is_active) VALUES
          ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter', true),
          ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'recruiter', 'Recruiter', true);

        INSERT INTO permissions (id, module, action) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'candidate', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('11110000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'own');

        -- healthy: active recruiter, recent login, no expiry — raises NO flags.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '2026-01-02T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', NULL);

        -- deprovisionGap: inactive but still holds a role.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', '2026-01-05T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', NULL);

        -- expiredGrant: active, role's expiry is in the past.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', '2026-01-06T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', now() - interval '1 day');

        -- OrgB user, its own org's role — proves org-scoping in Task 8.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', '2026-01-01T00:00:00Z', NULL, NULL);
        """;
}

[CollectionDefinition("AccessReview")]
public sealed class AccessReviewCollection : ICollectionFixture<AccessReviewFixture>;
```

- [ ] **Step 2: Write the repository interface + raw-fetch DTOs**

```csharp
using Tims.Domain.AccessReview;

namespace Tims.Application.AccessReview;

/// <summary>Raw fetch shape for one reviewed user — BEFORE the kernel/service shapes it into an
/// <see cref="AccessReviewRow"/>. Mirrors `access-review.repository.ts`'s `reviewUserSelect` exactly.</summary>
public sealed record AccessReviewUserRecord(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    Guid? OrganizationId,
    bool IsActive,
    DateTime? DeletedAt,
    DateTime? LastLoginAt,
    bool IsPlatformOwner,
    string? OrgName,
    IReadOnlyList<AccessReviewUserRoleRecord> Roles);

public sealed record AccessReviewUserRoleRecord(
    string Slug,
    string Name,
    bool RoleActive,
    Guid RoleOrganizationId,
    DateTime AssignedAt,
    Guid? AssignedBy,
    Guid? CompanyScope,
    Guid? UnitScope,
    DateTime? ExpiresAt,
    IReadOnlyList<string> Grants);

public sealed record AccessReviewAttestationInsert(
    Guid OrganizationId,
    Guid ReviewerId,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes);

public interface IAccessReviewRepository
{
    /// <summary>Bounded `cap + 1` so the caller can report truncation honestly (no silent cap) — matches
    /// Slice-17's cursor-pagination honesty convention.</summary>
    Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(Guid organizationId, int cap, CancellationToken cancellationToken);

    Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken);

    Task<AccessReviewAttestation> InsertAttestationAsync(AccessReviewAttestationInsert data, CancellationToken cancellationToken);

    Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(Guid organizationId, int limit, CancellationToken cancellationToken);
}
```

- [ ] **Step 3: Write the failing repository tests**

```csharp
using Tims.Application.AccessReview;
using Tims.Infrastructure.AccessReview;
using Xunit;

namespace Tims.IntegrationTests.AccessReview;

[Collection("AccessReview")]
public sealed class AccessReviewRepositoryTests(AccessReviewFixture fixture)
{
    private readonly AccessReviewFixture _fixture = fixture;

    private AccessReviewRepository NewRepository() => new(_fixture.NewContext());

    [Fact]
    public async Task FetchUsersForReviewAsync_ReturnsOnlyOrgAUsers_WhenOrgAQueried()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);

        var ids = users.Select(u => u.Id).ToHashSet();
        Assert.Equal(5, users.Count); // Rick + healthy + never + stale + deprovision + expired = 6... see step 4 note
        Assert.DoesNotContain(AccessReviewFixture.OrgBUserId, ids);
    }

    [Fact]
    public async Task FetchUsersForReviewAsync_PopulatesNestedRoleAndGrants()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);

        var healthy = users.Single(u => u.Id == AccessReviewFixture.HealthyUserId);
        Assert.Single(healthy.Roles);
        Assert.Equal("recruiter", healthy.Roles[0].Slug);
        Assert.Contains("candidate:read:own", healthy.Roles[0].Grants);
    }

    [Fact]
    public async Task FetchUsersForReviewAsync_HonestlyReportsTruncation_WhenCapExceeded()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 2, CancellationToken.None);

        Assert.True(users.Count > 2); // cap+1 (or more) returned — the SERVICE (Task 6) decides truncated from this
    }

    [Fact]
    public async Task OrgExistsAsync_TrueForRealOrg_FalseForUnknown()
    {
        var repo = NewRepository();
        Assert.True(await repo.OrgExistsAsync(AccessReviewFixture.OrgA, CancellationToken.None));
        Assert.False(await repo.OrgExistsAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task InsertAttestationAsync_PersistsAndReturnsTheRow()
    {
        var attestation = await NewRepository().InsertAttestationAsync(
            new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 6, 0, 1, 1, 1, "quarterly review"),
            CancellationToken.None);

        Assert.Equal(AccessReviewFixture.OrgA, attestation.OrganizationId);
        Assert.Equal(6, attestation.UserCount);
        Assert.Equal("quarterly review", attestation.Notes);
    }

    [Fact]
    public async Task ListAttestationsAsync_ReturnsNewestFirst_WithReviewerJoin()
    {
        var repo = NewRepository();
        await repo.InsertAttestationAsync(new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 1, 0, 0, 0, 0, "first"), CancellationToken.None);
        await repo.InsertAttestationAsync(new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 2, 0, 0, 0, 0, "second"), CancellationToken.None);

        var history = await repo.ListAttestationsAsync(AccessReviewFixture.OrgA, limit: 20, CancellationToken.None);

        Assert.True(history.Count >= 2);
        Assert.Equal("second", history[0].Notes); // newest first
        Assert.Equal("Olivia", history[0].Reviewer.FirstName);
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~AccessReviewRepositoryTests"`
Expected: FAIL (compile error — `AccessReviewRepository` does not exist yet). Note: the seeded OrgA user count is 6 (Rick + healthy + never + stale + deprovision + expired) — fix the first test's `Assert.Equal(5, ...)` to `Assert.Equal(6, ...)` once you count the actual seed rows before moving to Step 6; this is exactly the kind of fixture/test mismatch the per-task review (Task 4's own review round) should catch, matching the rigor documented in Slice-17's ledger.

- [ ] **Step 5: Write the repository (batched lookups, no navigation properties)**

```csharp
using Microsoft.EntityFrameworkCore;
using Tims.Application.AccessReview;
using Tims.Domain.AccessReview;

namespace Tims.Infrastructure.AccessReview;

/// <summary>
/// Read-only port of `access-review.repository.ts`'s four methods. Batched lookups (fetch users →
/// batch-fetch their user_roles → batch-fetch those roles → batch-fetch role_permissions+permissions
/// for those roles), never one deep nested query — matches `AuditReadRepository`'s "batch, not N+1"
/// discipline, scaled up one more join level. `InsertAttestationAsync`/`ListAttestationsAsync` are the
/// ONLY writes/reads against `access_reviews` in this slice.
/// </summary>
public sealed class AccessReviewRepository(AccessReviewDbContext db) : IAccessReviewRepository
{
    private readonly AccessReviewDbContext _db = db;

    public async Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(
        Guid organizationId, int cap, CancellationToken cancellationToken)
    {
        var org = await _db.Organizations.AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == organizationId, cancellationToken).ConfigureAwait(false);

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.OrganizationId == organizationId)
            .OrderByDescending(u => u.CreatedAt)
            .Take(cap + 1)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var userIds = users.Select(u => u.Id).ToList();
        var userRoles = await _db.UserRoles.AsNoTracking()
            .Where(ur => userIds.Contains(ur.UserId))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var roleIds = userRoles.Select(ur => ur.RoleId).Distinct().ToList();
        var roles = await _db.Roles.AsNoTracking()
            .Where(r => roleIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, cancellationToken).ConfigureAwait(false);

        var rolePermissions = await _db.RolePermissions.AsNoTracking()
            .Where(rp => roleIds.Contains(rp.RoleId))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var permissionIds = rolePermissions.Select(rp => rp.PermissionId).Distinct().ToList();
        var permissions = await _db.Permissions.AsNoTracking()
            .Where(p => permissionIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, cancellationToken).ConfigureAwait(false);

        var rolePermissionsByRole = rolePermissions
            .GroupBy(rp => rp.RoleId)
            .ToDictionary(g => g.Key, g => g
                .Select(rp => $"{permissions[rp.PermissionId].Module}:{permissions[rp.PermissionId].Action}:{rp.Scope}")
                .ToList() as IReadOnlyList<string>);

        var userRolesByUser = userRoles.GroupBy(ur => ur.UserId).ToDictionary(g => g.Key, g => g.ToList());

        return users.Select(u => new AccessReviewUserRecord(
            u.Id, u.FirstName, u.LastName, u.Email, u.OrganizationId, u.IsActive, u.DeletedAt,
            u.LastLoginAt, u.IsPlatformOwner, org?.Name,
            userRolesByUser.TryGetValue(u.Id, out var ownRoles)
                ? ownRoles.Select(ur =>
                {
                    var role = roles[ur.RoleId];
                    return new AccessReviewUserRoleRecord(
                        role.Slug, role.Name, role.IsActive, role.OrganizationId,
                        ur.AssignedAt, ur.AssignedBy, ur.CompanyScope, ur.UnitScope, ur.ExpiresAt,
                        rolePermissionsByRole.TryGetValue(role.Id, out var grants) ? grants : []);
                }).ToList()
                : [])).ToList();
    }

    public Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken) =>
        _db.Organizations.AsNoTracking().AnyAsync(o => o.Id == organizationId, cancellationToken);

    public async Task<AccessReviewAttestation> InsertAttestationAsync(
        AccessReviewAttestationInsert data, CancellationToken cancellationToken)
    {
        var entity = new AccessReviewEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = data.OrganizationId,
            ReviewerId = data.ReviewerId,
            UserCount = data.UserCount,
            PrivilegedCount = data.PrivilegedCount,
            StaleCount = data.StaleCount,
            DeprovisionGapCount = data.DeprovisionGapCount,
            ExpiredGapCount = data.ExpiredGapCount,
            Notes = data.Notes,
        };
        _db.AccessReviews.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return new AccessReviewAttestation(
            entity.Id, entity.OrganizationId, entity.ReviewerId, entity.ReviewedAt,
            entity.UserCount, entity.PrivilegedCount, entity.StaleCount, entity.DeprovisionGapCount,
            entity.ExpiredGapCount, entity.Notes);
    }

    public async Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(
        Guid organizationId, int limit, CancellationToken cancellationToken)
    {
        var attestations = await _db.AccessReviews.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId)
            .OrderByDescending(a => a.ReviewedAt)
            .Take(limit)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var reviewerIds = attestations.Select(a => a.ReviewerId).Distinct().ToList();
        var reviewers = await _db.Users.AsNoTracking()
            .Where(u => reviewerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        return attestations.Select(a =>
        {
            var reviewer = reviewers[a.ReviewerId];
            return new AccessReviewAttestationHistoryItem(
                a.Id, a.ReviewedAt, a.UserCount, a.PrivilegedCount, a.StaleCount,
                a.DeprovisionGapCount, a.ExpiredGapCount, a.Notes,
                new AccessReviewReviewerView(reviewer.FirstName, reviewer.LastName, reviewer.Email));
        }).ToList();
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~AccessReviewRepositoryTests"`
Expected: PASS (6 tests). If the org-A user count assertion fails, count the actual seeded rows and fix the test — do not change the fixture to match a wrong assertion.

- [ ] **Step 7: Commit**

```bash
git add services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewFixture.cs services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewRepositoryTests.cs services/Tims.Platform/src/Tims.Application/AccessReview/ services/Tims.Platform/src/Tims.Infrastructure/AccessReview/AccessReviewRepository.cs
git commit -m "feat(csharp): Phase-5 Slice-18 — AccessReviewFixture + AccessReviewRepository (batched, no nav properties)"
```

---

### Task 5: SecurityEventWriter (new, generic, privileged — NOT BillingAuditWriter)

**Files:**

- Create: `services/Tims.Platform/src/Tims.Application/Audit/ISecurityEventWriter.cs`
- Create: `services/Tims.Platform/src/Tims.Infrastructure/Audit/SecurityEventWriter.cs`
- Test: `services/Tims.Platform/tests/Tims.IntegrationTests/Audit/SecurityEventWriterTests.cs`

**Interfaces:**

- Consumes: `AuditLogDbContext`/`AuditLogEntity` (already exist, reused verbatim — no changes to that file).
- Produces: `ISecurityEventWriter.WriteAsync(SecurityEvent, CancellationToken)`; `SecurityEvent` record. Task 7 (endpoints) calls this after each of the 3 audited actions.

- [ ] **Step 1: Write the interface**

```csharp
using System.Text.Json.Nodes;

namespace Tims.Application.Audit;

/// <summary>
/// A generic, privileged, fail-soft writer into `audit_logs` — the C# port of TS's
/// `logSecurityEvent`/`logPlatformExport` (`packages/api/src/access/security-audit.ts`). UNLIKE
/// `IBillingAuditWriter` (entity-hardcoded, wraps writes in `TenantScope` — a tenant-attributed
/// write), this is the cross-org/pre-tenant write pattern: no TenantScope, `entity`/`action` supplied
/// by the caller, `organizationId` set explicitly. A lost security-audit row must NEVER fail the
/// caller's request — every implementation must swallow its own failures.
/// </summary>
public interface ISecurityEventWriter
{
    Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken);
}

public sealed record SecurityEvent(
    Guid OrganizationId,
    Guid? ActorId,
    string Action,
    string Entity,
    string? EntityId,
    JsonObject? Metadata);
```

- [ ] **Step 2: Write the failing test**

```csharp
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

[Collection("AuditWriter")]
public sealed class SecurityEventWriterTests(AuditWriterFixture fixture)
{
    private readonly AuditWriterFixture _fixture = fixture;

    [Fact]
    public async Task WriteAsync_InsertsARow_WithTheGivenEntityActionAndMetadata()
    {
        await using var db = _fixture.NewAuditLogContext();
        var writer = new SecurityEventWriter(db);
        var orgId = Guid.NewGuid();
        var actorId = Guid.NewGuid();

        await writer.WriteAsync(
            new SecurityEvent(orgId, actorId, "access_review_viewed", "access_review", null,
                new System.Text.Json.Nodes.JsonObject { ["targetOrgId"] = orgId.ToString(), ["userCount"] = 6 }),
            CancellationToken.None);

        await using var readback = _fixture.NewAuditLogContext();
        var row = readback.AuditLogs.Single(a => a.OrganizationId == orgId);
        Assert.Equal("access_review_viewed", row.Action);
        Assert.Equal("access_review", row.Entity);
        Assert.Equal(actorId, row.ActorId);
        Assert.Contains("targetOrgId", row.Metadata);
    }

    [Fact]
    public async Task WriteAsync_NeverThrows_WhenTheUnderlyingWriteFails()
    {
        await using var db = _fixture.NewAuditLogContext();
        await db.Database.EnsureDeletedAsync(); // force the next write to fail (table gone)
        var writer = new SecurityEventWriter(db);

        var exception = await Record.ExceptionAsync(() =>
            writer.WriteAsync(new SecurityEvent(Guid.NewGuid(), null, "access_review_viewed", "access_review", null, null), CancellationToken.None));

        Assert.Null(exception); // fail-soft: never throws into the caller
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~SecurityEventWriterTests"`
Expected: FAIL (compile error — `SecurityEventWriter` does not exist yet).

- [ ] **Step 4: Write the writer**

```csharp
using Microsoft.Extensions.Logging;
using Tims.Application.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// See <see cref="ISecurityEventWriter"/>'s doc comment for the full rationale (new sibling to
/// <see cref="Tims.Application.Billing.IBillingAuditWriter"/>'s implementation, not a replacement).
/// NO <see cref="TenantScope"/> — the caller is always a resolved platform owner, never a tenant
/// context. Reuses <see cref="AuditLogEntity"/>/<see cref="AuditLogDbContext"/> verbatim.
/// </summary>
public sealed class SecurityEventWriter(AuditLogDbContext db, ILogger<SecurityEventWriter>? logger = null) : ISecurityEventWriter
{
    private readonly AuditLogDbContext _db = db;
    private readonly ILogger<SecurityEventWriter>? _logger = logger;

    public async Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
    {
        try
        {
            _db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = securityEvent.OrganizationId,
                ActorId = securityEvent.ActorId,
                Action = securityEvent.Action,
                Entity = securityEvent.Entity,
                EntityId = securityEvent.EntityId,
                Metadata = securityEvent.Metadata?.ToJsonString(),
            });

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // fail-soft: a lost security-audit row must never block the caller's mutation/read.
            _logger?.LogWarning(ex, "security event write dropped (fail-soft): action={Action} entity={Entity} org={OrganizationId}",
                securityEvent.Action, securityEvent.Entity, securityEvent.OrganizationId);
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~SecurityEventWriterTests"`
Expected: PASS (2 tests). If `AuditWriterFixture`'s existing `NewAuditLogContext()` helper doesn't already exist with that exact name, check `services/Tims.Platform/tests/Tims.IntegrationTests/AuditWriterFixture.cs` (it backs the existing `BillingAuditWriterTests`/`DataAccessAuditWriterTests`) and reuse its real accessor name instead of inventing one.

- [ ] **Step 6: Commit**

```bash
git add services/Tims.Platform/src/Tims.Application/Audit/ISecurityEventWriter.cs services/Tims.Platform/src/Tims.Infrastructure/Audit/SecurityEventWriter.cs services/Tims.Platform/tests/Tims.IntegrationTests/Audit/SecurityEventWriterTests.cs
git commit -m "feat(csharp): Phase-5 Slice-18 — SecurityEventWriter (generic privileged audit-write, sibling to BillingAuditWriter)"
```

---

### Task 6: AccessReviewService (orchestration)

**Files:**

- Create: `services/Tims.Platform/src/Tims.Application/AccessReview/AccessReviewService.cs`
- Test: `services/Tims.Platform/tests/Tims.UnitTests/AccessReview/AccessReviewServiceTests.cs`

**Interfaces:**

- Consumes: `IAccessReviewRepository` (Task 4), `AccessRiskKernel`/view records (Task 2).
- Produces: `AccessReviewService.BuildReportAsync(Guid, DateTime, CancellationToken) -> Task<AccessReviewReport>`, `AccessReviewService.AttestAsync(Guid organizationId, Guid reviewerId, string? notes, DateTime now, CancellationToken) -> Task<AccessReviewAttestOutcome>`, `AccessReviewService.ListAttestationsAsync(Guid, int, CancellationToken)`. `AccessReviewAttestOutcome` (a closed result type — `Success`/`OrgNotFound`/`Truncated` — matches this codebase's established null/outcome convention, e.g. `SuccessionWriteUseCase`, rather than throwing exceptions for expected business outcomes). Task 7 (endpoints) pattern-matches this exactly.

- [ ] **Step 1: Write the failing tests (using an in-memory fake repository — fast, no Testcontainers needed for pure orchestration logic)**

```csharp
using Tims.Application.AccessReview;
using Tims.Domain.AccessReview;
using Xunit;

namespace Tims.UnitTests.AccessReview;

/// <summary>In-memory fake — AccessReviewService's orchestration logic (org-exists check, truncation
/// refusal, summary computation) doesn't need a real database to verify; reserve Testcontainers for
/// genuine DB-behavior proofs (Tasks 4/7/8).</summary>
public sealed class FakeAccessReviewRepository : IAccessReviewRepository
{
    public List<AccessReviewUserRecord> Users { get; } = [];
    public HashSet<Guid> ExistingOrgs { get; } = [];
    public List<AccessReviewAttestationInsert> Inserted { get; } = [];

    public Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(Guid organizationId, int cap, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AccessReviewUserRecord>>(Users.Take(cap + 1).ToList());

    public Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken) =>
        Task.FromResult(ExistingOrgs.Contains(organizationId));

    public Task<AccessReviewAttestation> InsertAttestationAsync(AccessReviewAttestationInsert data, CancellationToken cancellationToken)
    {
        Inserted.Add(data);
        return Task.FromResult(new AccessReviewAttestation(
            Guid.NewGuid(), data.OrganizationId, data.ReviewerId, DateTime.UtcNow,
            data.UserCount, data.PrivilegedCount, data.StaleCount, data.DeprovisionGapCount, data.ExpiredGapCount, data.Notes));
    }

    public Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(Guid organizationId, int limit, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AccessReviewAttestationHistoryItem>>([]);
}

public sealed class AccessReviewServiceTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly DateTime Now = new(2026, 7, 26, 0, 0, 0, DateTimeKind.Utc);

    private static AccessReviewUserRecord HealthyUser(Guid id) =>
        new(id, "Hana", "Healthy", "hana@tims.test", Org, true, null, Now.AddDays(-1), false, "Acme", []);

    [Fact]
    public async Task BuildReportAsync_ComputesSummaryFromFlaggedRows()
    {
        var repo = new FakeAccessReviewRepository();
        repo.Users.Add(HealthyUser(Guid.NewGuid()));
        repo.Users.Add(new AccessReviewUserRecord(Guid.NewGuid(), "Nate", "Never", "nate@tims.test", Org, true, null, null, false, "Acme", []));
        var service = new AccessReviewService(repo);

        var report = await service.BuildReportAsync(Org, Now, CancellationToken.None);

        Assert.Equal(2, report.Summary.UserCount);
        Assert.True(report.Rows.Single(r => r.Name == "Nate Never").Flags.NeverLoggedIn);
        Assert.False(report.Truncated);
    }

    [Fact]
    public async Task BuildReportAsync_ReportsTruncation_WhenMoreThanCapRowsExist()
    {
        var repo = new FakeAccessReviewRepository();
        for (var i = 0; i < 3; i++)
        {
            repo.Users.Add(HealthyUser(Guid.NewGuid()));
        }
        var service = new AccessReviewService(repo);

        var report = await service.BuildReportAsync(Org, Now, CancellationToken.None, cap: 2);

        Assert.True(report.Truncated);
        Assert.Equal(2, report.Rows.Count); // truncated to cap
    }

    [Fact]
    public async Task AttestAsync_ReturnsOrgNotFound_WhenOrgDoesNotExist()
    {
        var repo = new FakeAccessReviewRepository();
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, Guid.NewGuid(), null, Now, CancellationToken.None);

        Assert.IsType<AccessReviewAttestOutcome.OrgNotFound>(outcome);
        Assert.Empty(repo.Inserted);
    }

    [Fact]
    public async Task AttestAsync_RefusesToInsert_WhenReportIsTruncated()
    {
        var repo = new FakeAccessReviewRepository();
        repo.ExistingOrgs.Add(Org);
        for (var i = 0; i < 3; i++)
        {
            repo.Users.Add(HealthyUser(Guid.NewGuid()));
        }
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, Guid.NewGuid(), null, Now, CancellationToken.None, cap: 2);

        Assert.IsType<AccessReviewAttestOutcome.Truncated>(outcome);
        Assert.Empty(repo.Inserted);
    }

    [Fact]
    public async Task AttestAsync_InsertsTheComputedSummary_WhenNotTruncated()
    {
        var repo = new FakeAccessReviewRepository();
        repo.ExistingOrgs.Add(Org);
        repo.Users.Add(HealthyUser(Guid.NewGuid()));
        var reviewerId = Guid.NewGuid();
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, reviewerId, "quarterly", Now, CancellationToken.None);

        var success = Assert.IsType<AccessReviewAttestOutcome.Success>(outcome);
        Assert.Equal(1, success.Summary.UserCount);
        Assert.Equal(reviewerId, repo.Inserted.Single().ReviewerId);
        Assert.Equal("quarterly", repo.Inserted.Single().Notes);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.UnitTests --filter "FullyQualifiedName~AccessReviewServiceTests"`
Expected: FAIL (compile error — `AccessReviewService` does not exist yet).

- [ ] **Step 3: Write the service**

```csharp
using Tims.Application.AccessReview;
using Tims.Domain.AccessReview;

namespace Tims.Application.AccessReview;

/// <summary>
/// Orchestration mirroring `access-review.service.ts` exactly: `BuildReportAsync` (fetch → kernel →
/// shape → summarize), `AttestAsync` (org-exists → rebuild report → refuse-if-truncated → insert).
/// Deliberately carries NO audit-logging concerns (matches the TS file split: the ROUTER calls
/// `logSecurityEvent`/`logPlatformExport`, not the service) — Task 7's endpoints call
/// <see cref="Tims.Application.Audit.ISecurityEventWriter"/> directly, after calling this service.
/// </summary>
public sealed class AccessReviewService(IAccessReviewRepository repository)
{
    public const int DefaultOrgCap = 10000;

    private readonly IAccessReviewRepository _repository = repository;

    public async Task<AccessReviewReport> BuildReportAsync(
        Guid organizationId, DateTime now, CancellationToken cancellationToken, int cap = DefaultOrgCap)
    {
        var users = await _repository.FetchUsersForReviewAsync(organizationId, cap, cancellationToken).ConfigureAwait(false);
        var truncated = users.Count > cap;
        var rows = (truncated ? users.Take(cap) : users).Select(u => ToRow(u, now)).ToList();

        return new AccessReviewReport(
            Rows: rows,
            Summary: Summarize(rows),
            CrossOrgRoleCount: rows.Count(r => r.Flags.CrossOrgRole),
            Truncated: truncated);
    }

    public async Task<AccessReviewAttestOutcome> AttestAsync(
        Guid organizationId, Guid reviewerId, string? notes, DateTime now, CancellationToken cancellationToken, int cap = DefaultOrgCap)
    {
        if (!await _repository.OrgExistsAsync(organizationId, cancellationToken).ConfigureAwait(false))
        {
            return new AccessReviewAttestOutcome.OrgNotFound();
        }

        var report = await BuildReportAsync(organizationId, now, cancellationToken, cap).ConfigureAwait(false);
        if (report.Truncated)
        {
            return new AccessReviewAttestOutcome.Truncated(cap);
        }

        var summary = report.Summary;
        var attestation = await _repository.InsertAttestationAsync(
            new AccessReviewAttestationInsert(
                organizationId, reviewerId, summary.UserCount, summary.PrivilegedCount,
                summary.StaleCount, summary.DeprovisionGapCount, summary.ExpiredGapCount, notes),
            cancellationToken).ConfigureAwait(false);

        return new AccessReviewAttestOutcome.Success(attestation, summary);
    }

    public Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(
        Guid organizationId, int limit, CancellationToken cancellationToken) =>
        _repository.ListAttestationsAsync(organizationId, limit, cancellationToken);

    private static AccessReviewRow ToRow(AccessReviewUserRecord u, DateTime now)
    {
        // Defensive fallback (u.OrganizationId is nullable on the User schema, but the repository's
        // own `where organizationId = @orgId` guarantees every fetched row has one) — mirrors TS's
        // `u.organizationId ?? ''` defensive coalesce, never expected to actually trigger.
        var organizationId = u.OrganizationId ?? Guid.Empty;

        var (status, flags) = AccessRiskKernel.AssessUserAccess(new UserAccessInput(
            organizationId, u.IsActive, u.DeletedAt, u.LastLoginAt,
            u.Roles.Select(r => new RoleAssignment(r.Slug, r.RoleOrganizationId, r.ExpiresAt)).ToList(),
            u.IsPlatformOwner, now));

        return new AccessReviewRow(
            u.Id, $"{u.FirstName} {u.LastName}".Trim(), u.Email, organizationId, u.OrgName, status,
            u.IsPlatformOwner, u.LastLoginAt,
            u.Roles.Select(r => new RoleGrantView(
                r.Slug, r.Name, r.RoleActive, r.AssignedAt, r.AssignedBy, r.CompanyScope, r.UnitScope,
                r.ExpiresAt, r.Grants)).ToList(),
            flags);
    }

    private static AccessReviewSummary Summarize(IReadOnlyList<AccessReviewRow> rows) => new(
        UserCount: rows.Count,
        PrivilegedCount: rows.Count(r => r.Flags.Privileged),
        StaleCount: rows.Count(r => r.Flags.Stale),
        DeprovisionGapCount: rows.Count(r => r.Flags.DeprovisionGap),
        ExpiredGapCount: rows.Count(r => r.Flags.ExpiredGrant));
}

/// <summary>Outcome of <see cref="AccessReviewService.AttestAsync"/> — the endpoint (Task 7) pattern-matches
/// this to a status code (200/404/412), matching this codebase's established outcome-type convention
/// (e.g. <c>SuccessionWriteUseCase</c>'s null-return pattern) rather than throwing for expected outcomes.</summary>
public abstract record AccessReviewAttestOutcome
{
    public sealed record Success(AccessReviewAttestation Attestation, AccessReviewSummary Summary) : AccessReviewAttestOutcome;

    public sealed record OrgNotFound : AccessReviewAttestOutcome;

    public sealed record Truncated(int Cap) : AccessReviewAttestOutcome;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.UnitTests --filter "FullyQualifiedName~AccessReviewServiceTests"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/Tims.Platform/src/Tims.Application/AccessReview/AccessReviewService.cs services/Tims.Platform/tests/Tims.UnitTests/AccessReview/AccessReviewServiceTests.cs
git commit -m "feat(csharp): Phase-5 Slice-18 — AccessReviewService (report/attest orchestration)"
```

---

### Task 7: AccessReviewEndpoints (API layer) + feature flags + Program.cs wiring + auth-matrix tests

**Files:**

- Create: `services/Tims.Platform/src/Tims.Api/AccessReview/AccessReviewEndpoints.cs`
- Modify: `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs` (add 2 flags)
- Modify: `services/Tims.Platform/src/Tims.Api/Program.cs` (DI registration + endpoint mapping, mirroring the `AuditLogReadEnabled` block exactly)
- Test: `services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewEndpointAuthTests.cs`

**Interfaces:**

- Consumes: `PlatformOwnerGate` (reused verbatim, no changes), `AccessReviewService` (Task 6), `ISecurityEventWriter` (Task 5), `CsvCell` (existing, reused verbatim).
- Produces: `AccessReviewEndpoints.MapAccessReviewReadEndpoints(WebApplication)`, `AccessReviewEndpoints.MapAccessReviewWriteEndpoints(WebApplication)`.

- [ ] **Step 1: Add the two feature flags to `PlatformOptions`**

Append to the end of the class body (after `EngagementWriteEnabled`), before the closing `}`:

```csharp
    /// <summary>
    /// Phase-5 Slice 18 (efcoreReadOnly on users/roles/user_roles/role_permissions/permissions/
    /// organizations — Phase 2; access_reviews stays Prisma-owned until this flips): when true, the
    /// C# access-review READ surface is mapped and live — <c>GET /access-review</c> (the report),
    /// <c>/access-review/export</c> (CSV), <c>/access-review/attestations</c> (history).
    /// Platform-owner-only (PlatformOwnerGate, reused verbatim from Slice 17 — NO permission grant,
    /// NO tenant scope), org-scoped by a required <c>organizationId</c> query parameter (NOT RLS — see
    /// docs/architecture/csharp-migration/phase-5-slice-18-access-review.md). DEFAULT false (dark) —
    /// TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool AccessReviewReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 18 (moves `access_reviews` to efcoreStranglerWrite in the table-ownership
    /// ledger, Task 9): when true, the C# access-review WRITE surface is mapped and live —
    /// <c>POST /access-review/attest</c>. The FIRST C# write to `access_reviews`; refuses (412) a
    /// truncated org rather than persist under-counted compliance evidence, matching TS exactly.
    /// DEFAULT false (dark) — TS remains the single active writer until Federico flips it at canary.
    /// </summary>
    public bool AccessReviewWriteEnabled { get; init; }
```

- [ ] **Step 2: Write the failing auth-matrix test**

```csharp
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Phase-5 Slice 18 endpoint boot matrix — mirrors `AuditReadEndpointAuthTests` exactly:
/// platform-owner → 200; resolvable org-user → 403; no/tampered JWT → 401; flags OFF (default) → 404.
/// </summary>
[Collection("AccessReview")]
public sealed class AccessReviewEndpointAuthTests(AccessReviewFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ReportPath = "/access-review";
    private const string ExportPath = "/access-review/export";
    private const string AttestPath = "/access-review/attest";
    private const string HistoryPath = "/access-review/attestations";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "access-review-test-key" };

    private readonly AccessReviewFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AccessReviewReadEnabled", "true");
            builder.UseSetting("Platform:AccessReviewWriteEnabled", "true");
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
    public async Task PlatformOwner_Report_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("neverLoggedIn", body);
    }

    [Fact]
    public async Task OrdinaryOrgUser_Report_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Report_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagsDefaultOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{ReportPath}?organizationId={AccessReviewFixture.OrgA}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync(AttestPath, JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }))).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Export_Is200_WithHardenedCsv()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var csv = json.RootElement.GetProperty("data").GetString();
        Assert.Contains("\"Usuario\",\"Email\",\"Organizacion\"", csv);
    }

    [Fact]
    public async Task PlatformOwner_Attest_Is200_ThenOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA, notes = "Q3 review" }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var forbiddenRequest = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }),
        };
        forbiddenRequest.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.OrgUserSub)}");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(forbiddenRequest)).StatusCode);
    }

    [Fact]
    public async Task Attest_Is404_WhenOrgDoesNotExist()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = Guid.NewGuid() }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Attestations_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{HistoryPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~AccessReviewEndpointAuthTests"`
Expected: FAIL (build error — `AccessReviewEndpoints`/flags don't exist yet).

- [ ] **Step 4: Write the endpoints**

```csharp
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit; // PlatformOwnerGate
using Tims.Api.Configuration;
using Tims.Application.AccessReview;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Csv;

namespace Tims.Api.AccessReview;

/// <summary>
/// The 4 access-review endpoints (Phase-5 Slice 18) — the C# port of `platform.getAccessReview` /
/// `exportAccessReviewCsv` / `attestAccessReview` / `listAccessReviewAttestations`. All gated by
/// <see cref="PlatformOwnerGate"/> (reused verbatim). Read endpoints behind
/// <see cref="PlatformOptions.AccessReviewReadEnabled"/>; the attest write behind
/// <see cref="PlatformOptions.AccessReviewWriteEnabled"/> — split so Federico can canary them
/// independently, matching every other Phase-5 read/write-flag-split domain.
/// </summary>
public static class AccessReviewEndpoints
{
    private const int DefaultAttestationLimit = 20;
    private const int MaxAttestationLimit = 100;
    private const int MaxNotesLength = 2000;

    public static void MapAccessReviewReadEndpoints(this WebApplication app)
    {
        app.MapGet("/access-review", async (
                Guid organizationId,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var report = await service.BuildReportAsync(organizationId, DateTime.UtcNow, cancellationToken);

                await securityEventWriter.WriteAsync(
                    new SecurityEvent(organizationId, Guid.Parse(gate.Context!.UserId), "access_review_viewed", "access_review", null,
                        new JsonObject { ["targetOrgId"] = organizationId.ToString(), ["userCount"] = report.Summary.UserCount }),
                    cancellationToken);

                return Results.Ok(report);
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetAccessReview");

        app.MapGet("/access-review/export", async (
                Guid organizationId,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var report = await service.BuildReportAsync(organizationId, DateTime.UtcNow, cancellationToken);

                await securityEventWriter.WriteAsync(
                    new SecurityEvent(organizationId, Guid.Parse(gate.Context!.UserId), "platform_export", "export:access_review", null,
                        new JsonObject
                        {
                            ["resource"] = "access_review",
                            ["count"] = report.Rows.Count,
                            ["format"] = "csv",
                            ["targetOrgId"] = organizationId.ToString(),
                            ["truncated"] = report.Truncated,
                        }),
                    cancellationToken);

                return Results.Ok(new { format = "csv", data = BuildCsv(report), count = report.Rows.Count, truncated = report.Truncated });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ExportAccessReviewCsv");

        app.MapGet("/access-review/attestations", async (
                Guid organizationId, int? limit,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedLimit = Math.Clamp(limit ?? DefaultAttestationLimit, 1, MaxAttestationLimit);
                var history = await service.ListAttestationsAsync(organizationId, resolvedLimit, cancellationToken);
                return Results.Ok(history);
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ListAccessReviewAttestations");
    }

    public static void MapAccessReviewWriteEndpoints(this WebApplication app)
    {
        app.MapPost("/access-review/attest", async (
                AttestAccessReviewRequest body,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (body.Notes is { Length: > MaxNotesLength })
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var reviewerId = Guid.Parse(gate.Context!.UserId);
                var outcome = await service.AttestAsync(body.OrganizationId, reviewerId, body.Notes, DateTime.UtcNow, cancellationToken);

                switch (outcome)
                {
                    case AccessReviewAttestOutcome.OrgNotFound:
                        return Results.NotFound(new { error = "org_not_found" });
                    case AccessReviewAttestOutcome.Truncated:
                        return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
                    case AccessReviewAttestOutcome.Success success:
                        await securityEventWriter.WriteAsync(
                            new SecurityEvent(body.OrganizationId, reviewerId, "access_recertified", "access_review", success.Attestation.Id.ToString(),
                                new JsonObject
                                {
                                    ["userCount"] = success.Summary.UserCount,
                                    ["privilegedCount"] = success.Summary.PrivilegedCount,
                                    ["staleCount"] = success.Summary.StaleCount,
                                    ["deprovisionGapCount"] = success.Summary.DeprovisionGapCount,
                                    ["expiredGapCount"] = success.Summary.ExpiredGapCount,
                                }),
                            cancellationToken);
                        return Results.Ok(success.Attestation);
                    default:
                        throw new InvalidOperationException($"Unhandled outcome: {outcome.GetType()}");
                }
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status412PreconditionFailed)
            .WithName("AttestAccessReview");
    }

    private static string BuildCsv(Domain.AccessReview.AccessReviewReport report)
    {
        var header = CsvCell.Row([
            "Usuario", "Email", "Organizacion", "Estado", "Rol", "Alcance", "AsignadoPor",
            "Privilegiado", "Inactivo", "SinAcceso", "BrechaBaja", "Expirado", "RolCruzado",
        ]);

        var lines = new List<string>();
        foreach (var row in report.Rows)
        {
            var roleList = row.Roles.Count > 0 ? row.Roles : [null];
            foreach (var role in roleList)
            {
                lines.Add(CsvCell.Row([
                    row.Name,
                    row.Email,
                    row.OrgName,
                    row.Status.ToString().ToLowerInvariant(),
                    role?.Slug ?? "-",
                    ScopeOf(role),
                    role?.AssignedBy?.ToString() ?? "-",
                    row.Flags.Privileged ? "Y" : "N",
                    row.Flags.Stale ? "Y" : "N",
                    row.Flags.NeverLoggedIn ? "Y" : "N",
                    row.Flags.DeprovisionGap ? "Y" : "N",
                    row.Flags.ExpiredGrant ? "Y" : "N",
                    row.Flags.CrossOrgRole ? "Y" : "N",
                ]));
            }
        }

        return string.Join('\n', new[] { header }.Concat(lines));
    }

    // Matches TS: [companyScope, unitScope].filter(Boolean).join('|') || '-'.
    private static string ScopeOf(Domain.AccessReview.RoleGrantView? role)
    {
        if (role is null)
        {
            return "-";
        }

        var parts = new[] { role.CompanyScope?.ToString(), role.UnitScope?.ToString() }.Where(p => p is not null);
        var joined = string.Join('|', parts);
        return joined.Length > 0 ? joined : "-";
    }
}

public sealed record AttestAccessReviewRequest(Guid OrganizationId, string? Notes);
```

- [ ] **Step 5: Wire DI + endpoint mapping in `Program.cs`** (immediately after the existing `AuditLogReadEnabled` block at line ~1008)

```csharp
    // DI registration — place alongside the AuditReadDbContext registration (~line 414):
    builder.Services.AddDbContext<AccessReviewDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IAccessReviewRepository, AccessReviewRepository>();
    builder.Services.AddScoped<ISecurityEventWriter, SecurityEventWriter>();
    builder.Services.AddScoped<AccessReviewService>();
```

```csharp
    // Endpoint mapping — place immediately after the AuditLogReadEnabled block:
    // Access-review READ surface (Phase-5 Slice 18): GET /access-review (getAccessReview),
    // /access-review/export (exportAccessReviewCsv), /access-review/attestations
    // (listAccessReviewAttestations). Platform-owner-only, org-scoped (required organizationId, NOT
    // RLS). Dark unless the flag is on.
    if (externalOptions.AccessReviewReadEnabled || isOpenApiDocGeneration)
    {
        app.MapAccessReviewReadEndpoints();
    }

    // Access-review WRITE surface (Phase-5 Slice 18): POST /access-review/attest. The FIRST C# write
    // to access_reviews. Dark unless the flag is on (separate from the read flag for independent
    // canary control).
    if (externalOptions.AccessReviewWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapAccessReviewWriteEndpoints();
    }
```

Also confirm `AuditLogDbContext` is registered exactly once (it already is, at the Billing Self-Serve block ~line 463) — do NOT re-register it; `SecurityEventWriter` reuses that existing registration.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~AccessReviewEndpointAuthTests"`
Expected: PASS (9 tests).

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `cd services/Tims.Platform && dotnet build && dotnet test`
Expected: `Build succeeded. 0 Warning(s). 0 Error(s).` and all tests pass (unit + integration).

- [ ] **Step 8: Commit**

```bash
git add services/Tims.Platform/src/Tims.Api/AccessReview/ services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs services/Tims.Platform/src/Tims.Api/Program.cs services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewEndpointAuthTests.cs
git commit -m "feat(csharp): Phase-5 Slice-18 — access-review endpoints, dark behind AccessReviewRead/WriteEnabled"
```

---

### Task 8: AccessReviewOrgScopeTests (data-correctness proof) + table-ownership ledger update

**Files:**

- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewOrgScopeTests.cs`
- Modify: `docs/architecture/table-ownership.md` (`access_reviews`: `defaultOwner: prisma` → `efcoreStranglerWrite`)

**Interfaces:**

- Consumes: `AccessReviewRepository`/`AccessReviewFixture` (Task 4), `AccessReviewService` (Task 6).

- [ ] **Step 1: Write the org-scope proof (NOT an RLS test — a data-correctness test, per the design doc's explicit distinction)**

```csharp
using Tims.Application.AccessReview;
using Tims.Infrastructure.AccessReview;
using Xunit;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Proves the `organizationId` filter actually filters — NOT an RLS-isolation proof (there is none on
/// this privileged path; see the Slice-18 design doc's "Why this is a new pattern" section). A
/// platform owner CAN query any org; this test proves that when they query org A, org B's data never
/// leaks in, and vice versa.
/// </summary>
[Collection("AccessReview")]
public sealed class AccessReviewOrgScopeTests(AccessReviewFixture fixture)
{
    private readonly AccessReviewFixture _fixture = fixture;

    [Fact]
    public async Task FetchUsersForReviewAsync_OrgA_NeverReturnsOrgBUsers()
    {
        var repo = new AccessReviewRepository(_fixture.NewContext());

        var orgAUsers = await repo.FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);
        var orgBUsers = await repo.FetchUsersForReviewAsync(AccessReviewFixture.OrgB, cap: 10000, CancellationToken.None);

        Assert.DoesNotContain(orgAUsers, u => u.Id == AccessReviewFixture.OrgBUserId);
        Assert.Contains(orgBUsers, u => u.Id == AccessReviewFixture.OrgBUserId);
        Assert.DoesNotContain(orgBUsers, u => u.Id == AccessReviewFixture.HealthyUserId);
    }

    [Fact]
    public async Task BuildReportAsync_OrgAReport_OrgNameIsAcme_NotGlobex()
    {
        var service = new AccessReviewService(new AccessReviewRepository(_fixture.NewContext()));

        var report = await service.BuildReportAsync(AccessReviewFixture.OrgA, DateTime.UtcNow, CancellationToken.None);

        Assert.All(report.Rows, r => Assert.Equal("Acme Corp", r.OrgName));
    }

    [Fact]
    public async Task AttestAsync_OrgAAttestation_DoesNotAppearInOrgBsHistory()
    {
        var service = new AccessReviewService(new AccessReviewRepository(_fixture.NewContext()));

        await service.AttestAsync(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, "org-a-only", DateTime.UtcNow, CancellationToken.None);

        var orgBHistory = await service.ListAttestationsAsync(AccessReviewFixture.OrgB, limit: 20, CancellationToken.None);

        Assert.DoesNotContain(orgBHistory, a => a.Notes == "org-a-only");
    }
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd services/Tims.Platform && dotnet test tests/Tims.IntegrationTests --filter "FullyQualifiedName~AccessReviewOrgScopeTests"`
Expected: PASS (3 tests). If any fail, the bug is in `AccessReviewRepository`'s `WHERE organization_id = @orgId` filter (Task 4) — fix there, not by weakening this test.

- [ ] **Step 3: Update the table-ownership ledger**

Open `docs/architecture/table-ownership.md`, find the `access_reviews` entry (currently `defaultOwner: prisma`, likely listed with no `efcore*` classification), and change it to `efcoreStranglerWrite` with a note:

```
access_reviews: efcoreStranglerWrite — Phase-5 Slice 18. COEXISTENCE: TS keeps writing it live
  (packages/api/src/repositories/access-review.repository.ts's insertAttestation) until this surface
  is cut over and prod-verified; the C# write (AccessReviewRepository.InsertAttestationAsync) ships
  dark behind AccessReviewWriteEnabled. No ownership flip until cutover.
```

(Match the exact ledger's existing formatting/section for `efcoreStranglerWrite` entries — look at how `subscriptions` or `salary_adjustments` are listed there and follow that format precisely rather than inventing new formatting.)

- [ ] **Step 4: Run the ledger's CI check locally**

Run: `cd services/Tims.Platform && dotnet test --filter "FullyQualifiedName~TableOwnership"` (or whatever the actual ledger-check test/script is named — grep `table-ownership` in the CI workflow if the test name isn't obvious)
Expected: PASS — the ledger stays internally consistent (every table mentioned in code has an entry, format matches).

- [ ] **Step 5: Commit**

```bash
git add services/Tims.Platform/tests/Tims.IntegrationTests/AccessReview/AccessReviewOrgScopeTests.cs docs/architecture/table-ownership.md
git commit -m "test(csharp): Phase-5 Slice-18 — org-scope data-correctness proof + access_reviews ledger update"
```

---

### Task 9: Parity harness — auth-matrix entry

**Files:**

- Modify: `scripts/parity/surfaces.ts` (new entry)

**Interfaces:**

- Consumes: the now-fixed `platform_owner` seed path from Slice-17's own harness-bug fix (`scripts/parity/seed.ts`'s `upsertPublicUser`/`isPlatformOwner` handling). No `seed.ts` changes needed — `platform_owner`/`org_admin` are already-seeded roles.

**Why this is a Tier-1 (static-path, no `idScopeKey`) entry, not a by-id entry:** `EndpointDef.input` is NEVER sent to the C# caller (`callCsharp` in `scripts/parity/callers.ts` ignores it entirely — only `csharpPath` becomes the real request URL; `input` only feeds the TS-side `callTs`'s tRPC query-string builder). So `organizationId` MUST be embedded directly in `csharpPath` as a literal query string. `idScopeKey`/`{id}` substitution (`scripts/parity/ids.ts`) exists to bind a REAL seeded resource id for by-id IDOR probing (a foreign org's id → expect a 403/404 denial) — semantically WRONG here, since a platform owner querying ANY org (including one that doesn't exist) is supposed to succeed on the read endpoints (an unknown org just yields an empty report — only `attest` 404s on a missing org, and this entry only covers the 3 READ endpoints, matching the design doc's explicit scope). Since neither `platform_owner`'s 200 nor `org_admin`'s 403 depends on the org id being real (`PlatformOwnerGate` fires before any org-existence check), a **fixed, arbitrary UUID literal** in `csharpPath` is correct and sufficient — matching `audit-log`'s own Tier-1, no-`idScopeKey` entry exactly (confirmed by reading it directly: `key`/`flag`/`roles`/`probeRole`/`endpoints[].{name,csharpPath,tsProcedure,input,expectedByRole,globalScope}`, `input: {}`, no `idScopeKey`).

- [ ] **Step 1: Add the `access-review` entry to the surfaces object**

Add immediately before the closing `};` of the surfaces object in `scripts/parity/surfaces.ts` (the object the real `'audit-log'` entry, at line 664, is the last member of):

```typescript
  'access-review': {
    key: 'access-review',
    flag: 'Platform__AccessReviewReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    probeRole: 'org_admin', // org-scoped role — RLS/cross-tenant probing is N/A here; see globalScope below.
    endpoints: [
      {
        name: 'report',
        csharpPath: '/access-review?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.getAccessReview',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // Platform-owner-gated (not org-RBAC), like audit-log — see that entry's own comment. The
        // fixed org id is arbitrary and need not exist: neither the 200 (platform_owner) nor the 403
        // (org_admin, blocked by PlatformOwnerGate before any org lookup) depends on org existence.
        globalScope: true,
      },
      {
        name: 'export',
        csharpPath: '/access-review/export?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.exportAccessReviewCsv',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      {
        name: 'attestations',
        csharpPath: '/access-review/attestations?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.listAccessReviewAttestations',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
    ],
  },
```

This deliberately covers only the 3 READ endpoints (matching the design doc's explicit scope for this harness entry) — `attest` is a write, out of scope for this read-only auth-matrix harness; `AccessReviewEndpointAuthTests` (Task 7) already covers attest's auth matrix at the C# integration-test level.

- [ ] **Step 2: Run the TS type check + existing parity tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run scripts/parity/surfaces.test.ts`
Expected: no new type errors; `surfaces.test.ts` (which asserts structural invariants across every registered surface) still passes with the new entry included.

- [ ] **Step 3: Run the parity harness against a live/seeded environment, if one is reachable**

Run: `npx tsx scripts/parity/cli.ts --surface access-review` (confirm this is the real invocation via `scripts/parity/README.md` before running, and adjust flags to match its actual documented usage)
Expected: `platform_owner → 200`, `org_admin → 403` for all 3 endpoints. This requires a live C# instance with `AccessReviewReadEnabled=true` and a seeded Supabase project reachable — if neither is available in this environment, say so explicitly rather than claiming an unobserved pass (matches Slice-17's own precedent for this exact situation).

- [ ] **Step 4: Commit**

```bash
git add scripts/parity/surfaces.ts
git commit -m "feat(parity): register the access-review surface (platform-owner-gate, fixed org id, read-only)"
```

---

## Final step: whole-branch review

After Task 9, do NOT merge or push. Follow the same gate as Slice-17: dispatch `superpowers:requesting-code-review` (general-purpose subagent, range = branch base commit `e0b70ed` → tip) for a whole-branch review, and attempt the Codex adversarial pass per `.claude/rules/verification.md` (retry it for real this time if the usage limit has reset — check `node "$CODEX_COMPANION_PATH" status <job-id>` before assuming it's still blocked). Fix any Critical/Important findings, re-verify against the real TS source (not just the plan text) before trusting any finding, then proceed to `superpowers:finishing-a-development-branch`.
