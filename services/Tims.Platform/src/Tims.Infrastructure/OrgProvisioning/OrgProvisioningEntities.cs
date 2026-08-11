namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>
/// EF entities for the shared org-provisioning service (Phase-5 slice 21, issue #76) — the C# port of
/// <c>packages/api/src/services/org-provisioning.ts</c>.
///
/// <para>Every table here stays Prisma-OWNED. This slice adds a SECOND, deploy-gated writer; it retires
/// nothing. See <c>docs/architecture/table-ownership.md</c>, note
/// <c>platform_organizations_create_slice21</c>.</para>
///
/// <para><b>Columns that carry a DB default and are never sent are deliberately NOT MAPPED at all</b> —
/// <c>created_at</c>, <c>settings</c>, <c>is_active</c>, <c>currency</c>, <c>timezone</c>, <c>language</c>,
/// <c>activated_at</c>, <c>unit_price</c>. Mapping them would let EF start emitting values Prisma leaves to
/// the database, which is exactly the kind of drift a parity diff would surface at step 5. <c>updated_at</c>
/// is the opposite case and IS mapped everywhere: it is <c>NOT NULL</c> with no DB default (Prisma fills it
/// client-side via <c>@updatedAt</c>), so an INSERT that omits it fails <c>23502</c>.</para>
/// </summary>
public sealed class CompanyWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Hard-coded <c>'CO'</c> by the TS helper (<c>org-provisioning.ts:19</c>) regardless of the
    /// organization, which is a real defect for a non-Colombian tenant. Reproduced, not fixed.
    /// </summary>
    public string Country { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// <c>business_units</c> (<c>org-provisioning.ts:24-26</c>).
///
/// <para><b><see cref="OrganizationId"/> has NO FOREIGN KEY in production.</b> Verified against the prod
/// baseline: the only FKs on this table are <c>business_units_company_id_fkey</c> and
/// <c>business_units_parent_id_fkey</c>; the Prisma model declares <c>organizationId</c> as a bare column
/// with <c>@@index</c> and no <c>@relation</c>. The value is denormalised and unenforced by any
/// constraint — yet it is the ENTIRE basis of this table's <c>tenant_isolation</c> RLS predicate. Under
/// <c>TenantScope</c> a wrong value is caught by <c>WITH CHECK</c>; without a scope it commits silently and
/// the rows become permanently invisible to the tenant. That is why the create path runs scoped.</para>
/// </summary>
public sealed class BusinessUnitWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CompanyId { get; set; }

    public string Name { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// <c>teams</c> (<c>org-provisioning.ts:28-30</c>). <see cref="OrganizationId"/> carries the same
/// no-foreign-key hazard as <see cref="BusinessUnitWriteEntity.OrganizationId"/>.
/// </summary>
public sealed class TeamWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid BusinessUnitId { get; set; }

    public string Name { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// The single <c>roles</c> row created by <c>createOrganization</c> itself
/// (<c>organizations.ts:133-135</c>) — NOT by the shared helper. It lives in this file because the EF map
/// is shared: #75's invitation flow creates the same row.
///
/// <para><b>The role gets no permissions and no members</b> — zero <c>role_permissions</c>, zero
/// <c>user_roles</c>. A "Super Administrador" that grants nothing to nobody is what the TS creates, and it
/// is reproduced verbatim.</para>
/// </summary>
public sealed class RoleWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public bool IsSystem { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// One <c>org_entitlements</c> row (<c>org-provisioning.ts:56-65</c>).
///
/// <para><c>unit_price</c> is deliberately absent: the TS <c>create</c> never copies
/// <c>Module.defaultUnitPrice</c>, so a metered module is granted with a NULL price. Reproduced.
/// <c>activated_at</c> is left to its DB default.</para>
/// </summary>
public sealed class OrgEntitlementWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string ModuleCode { get; set; } = string.Empty;

    public bool Enabled { get; set; }

    public string Source { get; set; } = string.Empty;

    public int? Limit { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// The <c>plan_modules</c> catalogue projection the entitlement grant reads
/// (<c>org-provisioning.ts:51-54</c> selects <c>{ moduleCode, limit }</c>). READ-ONLY —
/// <c>efcoreReadOnly</c>; nothing in C# writes this table.
///
/// <para>The table has NO RLS in production (nor do <c>modules</c>/<c>plans</c>) and <c>app_tenant</c> holds
/// <c>SELECT</c> on it, which is why the catalogue read works from inside the new org's
/// <c>TenantScope</c>.</para>
/// </summary>
public sealed class PlanModuleReadEntity
{
    public Guid Id { get; set; }

    public string PlanCode { get; set; } = string.Empty;

    public string ModuleCode { get; set; } = string.Empty;

    public int? Limit { get; set; }
}
