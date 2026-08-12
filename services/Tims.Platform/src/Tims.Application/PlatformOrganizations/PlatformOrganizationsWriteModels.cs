using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

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
///
/// <para><b>Date converters added 2026-08-11 (#211).</b> #211's original scope was the READ models, and the
/// fix stopped there — but this record is the response body of <c>POST /platform/organizations</c>,
/// <c>PATCH /platform/organizations/{id}</c> and <c>POST /platform/organizations/{id}/suspend</c>, and it
/// had the identical defect. <c>organizations.created_at</c>/<c>updated_at</c>/<c>deleted_at</c> are
/// <c>timestamp(3) without time zone</c>, so Npgsql materialises <see cref="DateTimeKind.Unspecified"/> and
/// STJ emits <c>"2026-08-11T12:00:00.123"</c> — no offset, therefore NOT RFC 3339, while the same contract
/// publishes these three properties as <c>{"type":"string","format":"date-time"}</c>. A generated client
/// parsing that per RFC 3339 either throws or (JS <c>new Date(...)</c>) reads it as LOCAL time, shifting
/// every timestamp by the client's UTC offset. The TS side goes through
/// <c>Date.prototype.toISOString()</c>, which is what <see cref="NodeIsoDateTimeConverter"/> reproduces
/// byte-for-byte.</para>
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
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? DeletedAt);

/// <summary>
/// Validated input for <c>updateOrganization</c> (<c>organizations.ts:244-258</c>).
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
/// The <c>settings</c> sub-object (<c>organizations.ts:251-257</c>). Each member is
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
