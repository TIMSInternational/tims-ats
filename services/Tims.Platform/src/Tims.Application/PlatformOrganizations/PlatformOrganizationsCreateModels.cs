namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Validated input for <c>createOrganization</c> (<c>routers/platform/organizations.ts:149-242</c>),
/// Phase-5 slice 21 / issue #76.
///
/// <para>Four fields are REQUIRED in Zod (<c>:106-109</c>) and therefore non-nullable here.
/// <see cref="BillingEmail"/> is the only <c>.optional()</c> member (<c>:110</c>), so <c>null</c> means
/// ABSENT — <c>.optional()</c> rejects an explicit JSON <c>null</c>, exactly as in slice 20.</para>
///
/// <para>There is NO <c>settings</c>, <c>domain</c>, <c>logo</c> or <c>isActive</c> member: the TS
/// <c>organization.create</c> writes only <c>name</c>, <c>slug</c>, <c>plan</c> and <c>billingEmail</c>
/// (<c>:115-120</c>) and leaves everything else to the Prisma/DB defaults.</para>
/// </summary>
public sealed record PlatformOrganizationCreateInput(
    string Name,
    string Slug,
    string Plan,
    string AdminEmail,
    string? BillingEmail);

/// <summary>
/// What <c>CreateAsync</c> did.
///
/// <para><see cref="SlugTaken"/> is a DELIBERATE DIVERGENCE from TS, recorded as divergence (2) in
/// <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c>. <c>organizations.ts</c> has no <c>P2002</c> handling, <c>trpc.ts:17-19</c>'s
/// <c>errorFormatter</c> is a pass-through and there is no Prisma-error interceptor, so a duplicate slug
/// surfaces to the operator as an <c>INTERNAL_SERVER_ERROR</c> carrying the raw Prisma text, which
/// <c>create-org-modal.tsx:93-97</c> renders verbatim. The house precedent for improving that is
/// <c>SuccessionWriteRepository.cs:129-134</c>, including the discipline that ONLY the named constraint
/// (<c>organizations_slug_key</c>) may be matched — anything else must propagate.</para>
/// </summary>
public enum CreateOrganizationOutcome
{
    Created,
    SlugTaken,
}

/// <summary>
/// The outcome of a create attempt. <see cref="Row"/> is non-null iff
/// <see cref="Outcome"/> is <see cref="CreateOrganizationOutcome.Created"/>.
///
/// <para>The row type is <see cref="PlatformOrganizationRow"/>, REUSED VERBATIM from slice 20. The TS
/// <c>organization.create</c> call carries no <c>select:</c> (<c>:114-121</c>), so it resolves to the full
/// Prisma row in model declaration order — which is exactly the twelve fields that record already carries
/// and exactly what <c>PlatformOrganizationsWriteRepository.Map</c> already emits. Defining a second row
/// type here would be a silent opportunity for the two response shapes to drift.</para>
/// </summary>
public sealed record CreateOrganizationResult(CreateOrganizationOutcome Outcome, PlatformOrganizationRow? Row);
