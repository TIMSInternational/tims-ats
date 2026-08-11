using System.Text.Json.Nodes;

namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Write models for the platform-owner organizations surface (Phase-5 slice 20, issue #76) — the C# port
/// of <c>updateOrganization</c> and <c>suspendOrganization</c> in <c>routers/platform/organizations.ts</c>.
///
/// <para><b><c>createOrganization</c> is deliberately NOT here — it SHIPPED as slice 21.</b> It is a
/// 7-table provisioning transaction (organizations + companies + business_units + teams + org_entitlements
/// + roles + subscriptions) that had to first port the shared <c>org-provisioning</c> service, and #75
/// depends on THAT service's C# shape. See <see cref="PlatformOrganizationCreateInput"/> /
/// <see cref="CreateOrganizationResult"/> in <c>PlatformOrganizationsCreateModels.cs</c> and
/// <c>OrgProvisioningWriter</c>. Splitting it out kept THIS slice to single-row updates, which is what
/// makes the transactional fail-closed audit reviewable.</para>
/// </summary>
/// <remarks>
/// <see cref="PlatformOrganizationRow"/> mirrors the Prisma scalar field set of <c>Organization</c> in its
/// declaration order (<c>organization.prisma:31-42</c>) because both TS mutations
/// <c>return org</c> — the full row that <c>db.organization.update()</c> resolves to, relations excluded.
/// <c>Settings</c> is the raw <c>settings</c> jsonb re-emitted as JSON, not a typed record: the column is
/// <c>Json @default("{}")</c> and nothing constrains its shape, so typing it here would silently drop keys
/// a tenant already has.
/// </remarks>
public sealed record PlatformOrganizationRow(
    string Id,
    string Name,
    string Slug,
    string? Domain,
    string? Logo,
    string Plan,
    JsonNode? Settings,
    string? BillingEmail,
    bool IsActive,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime? DeletedAt);

/// <summary>
/// Validated input for <c>updateOrganization</c> (<c>organizations.ts:171-181</c>).
///
/// <para><b>null means ABSENT, not "clear it".</b> Every UPDATABLE field on the Zod schema is
/// <c>.optional()</c> — which rejects an explicit <c>null</c> — and the TS body only copies a field into
/// <c>updateData</c> when <c>rest.x !== undefined</c>. So omitting <c>name</c> must leave the stored name
/// untouched; there is no input that can null a column here, and adding one would be a divergence.</para>
///
/// <para><see cref="Settings"/> distinguishes the two cases that matter: <c>null</c> = the key was absent
/// (the <c>settings</c> column is not written at all), a non-null instance with three null members =
/// <c>"settings": {}</c> was sent (the column IS written, to an empty object — Prisma REPLACES the jsonb,
/// it does not merge).</para>
/// </summary>
public sealed record PlatformOrganizationUpdateInput(
    string? Name,
    string? Plan,
    bool? IsActive,
    PlatformOrganizationSettingsInput? Settings);

/// <summary>
/// The <c>settings</c> sub-object (<c>organizations.ts:177-181</c>). Each member is
/// <c>.optional()</c> with a max length, so <c>null</c> = absent here too and an absent member is omitted
/// from the written JSON entirely (Zod strips unknown keys; <c>JSON.stringify</c> drops <c>undefined</c>).
/// </summary>
public sealed record PlatformOrganizationSettingsInput(string? Locale, string? Timezone, string? Currency);

/// <summary>
/// One <c>notifications</c> row as the TS <c>notify()</c> helper builds it (<c>lib/notify.ts:16-41</c>),
/// fanned out to every platform owner. Carried through the Application layer so the repository does not
/// have to know the suspension copy.
/// </summary>
public sealed record PlatformOwnerNotification(
    Guid OrganizationId,
    string Type,
    string Title,
    string? Message,
    string? Module,
    string? EntityType,
    Guid? EntityId,
    string? ActionUrl);
