using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// Issue #213 — <c>organizations.domain</c> and <c>organizations.billing_email</c> were unbounded on the TS
/// tenant <c>organization.update</c> (<c>packages/shared/src/validators/organization.ts</c>), which is now
/// bounded at 253 (hostname pattern) and 254.
///
/// <para><b>What the C# side carries today.</b> No C# endpoint writes <c>domain</c> at all, and the only C#
/// writer of <c>billing_email</c> is the platform-owner CREATE, already bounded at 254 by #207
/// (<see cref="PlatformOrganizationsCreateUseCase.IsValidEmail"/>, pinned in
/// <c>PlatformOrganizationsCreateUseCaseTests</c>). The platform PATCH ignores unknown keys (Zod strip
/// parity), so a <c>domain</c>/<c>billingEmail</c> sent there is dropped, never written.</para>
///
/// <para>These tests are a TRIPWIRE for that state, not a re-test of #207: if someone adds a
/// <c>Domain</c> or <c>BillingEmail</c> member to one of these inputs (for example while porting the tenant
/// <c>organization.update</c>), this fails and points them at the bounds the TS schema now enforces, so the
/// port cannot silently re-open #213.</para>
/// </summary>
public class PlatformOrganizationsColumnBoundsTripwireTests
{
    [Fact]
    public void Email_bound_matches_the_TS_organization_schemas_254()
    {
        // `MAX_ORG_EMAIL_LENGTH` in packages/shared/src/validators/organization.ts, and `.max(254)` on the two
        // platform-owner writers (#207). RFC 5321 §4.5.3.1.3.
        Assert.Equal(254, PlatformOrganizationsCreateUseCase.MaxEmailLength);
    }

    [Theory]
    [InlineData(typeof(PlatformOrganizationCreateInput))]
    [InlineData(typeof(PlatformOrganizationUpdateInput))]
    public void No_CSharp_organization_input_accepts_domain_without_a_253_bound(Type inputType)
    {
        // If this fails, a C# writer of `organizations.domain` now exists. Bound it to 253 with the hostname
        // pattern of `ORG_DOMAIN_PATTERN` (trim first), add boundary tests, then update this tripwire.
        Assert.Null(inputType.GetProperty("Domain"));
    }

    [Fact]
    public void Platform_update_input_does_not_accept_billingEmail()
    {
        // The platform PATCH (`updateOrganization`) has no billingEmail in Zod either. If one is added, it must
        // go through `PlatformOrganizationsCreateUseCase.IsValidEmail` (the 254 bound), not a bare string.
        Assert.Null(typeof(PlatformOrganizationUpdateInput).GetProperty("BillingEmail"));
    }
}
