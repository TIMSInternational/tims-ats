using Tims.Application.PlatformInvitations;
using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// The organization locale profile (country, time zone, currency, number locale) the creation forms send and
/// the platform owner's edit merges: the C# twin of <c>packages/shared/src/org-locale-profile.ts</c>. The
/// preset TABLE is pinned equal to the TS one by <c>tests/organization/org-locale-profile.test.ts</c>; these
/// pin the RULES and the two create validators that apply them.
/// </summary>
public class OrgLocaleProfileRulesTests
{
    private static readonly OrgLocaleProfile Guatemala = new("GT", "America/Guatemala", "GTQ", "es-GT");

    [Fact]
    public void Every_preset_satisfies_every_rule()
    {
        Assert.Equal(12, OrgLocaleProfileRules.Presets.Count);
        Assert.All(OrgLocaleProfileRules.Presets, preset => Assert.True(OrgLocaleProfileRules.IsValid(preset), preset.Country));
        Assert.Equal("CR", OrgLocaleProfileRules.Presets[0].Country);
        Assert.Contains(Guatemala, OrgLocaleProfileRules.Presets);
    }

    [Theory]
    [InlineData("gt", "America/Guatemala", "GTQ", "es-GT")]
    [InlineData("GTM", "America/Guatemala", "GTQ", "es-GT")]
    [InlineData("GT\n", "America/Guatemala", "GTQ", "es-GT")]
    [InlineData("GT", "America/Nowhere", "GTQ", "es-GT")]
    [InlineData("GT", "", "GTQ", "es-GT")]
    [InlineData("GT", "America/Guatemala", "XYZ", "es-GT")]
    [InlineData("GT", "America/Guatemala", "Q", "es-GT")]
    [InlineData("GT", "America/Guatemala", "GTQ", "es_GT")]
    [InlineData("GT", "America/Guatemala", "GTQ", "ES-GT")]
    [InlineData("GT", "America/Guatemala", "GTQ", "es-GT\n")]
    public void A_profile_with_any_invalid_member_is_rejected(string country, string timezone, string currency, string locale) =>
        Assert.False(OrgLocaleProfileRules.IsValid(new OrgLocaleProfile(country, timezone, currency, locale)));

    [Fact]
    public void A_bare_language_locale_and_a_non_preset_country_are_valid()
    {
        Assert.True(OrgLocaleProfileRules.IsValid(new OrgLocaleProfile("AR", "America/Argentina/Buenos_Aires", "ARS", "es")));
        Assert.False(OrgLocaleProfileRules.IsTimeZone(new string('a', 65)));
    }

    [Fact]
    public void SettingsJson_writes_the_four_keys_like_the_TS_orgLocaleSettings()
    {
        Assert.Equal(
            """{"country":"GT","timezone":"America/Guatemala","currency":"GTQ","locale":"es-GT"}""",
            OrgLocaleProfileRules.SettingsJson(Guatemala));
    }

    [Fact]
    public void Organization_create_accepts_no_profile_or_a_valid_one_and_rejects_an_invalid_one()
    {
        var input = new PlatformOrganizationCreateInput("Acme", "acme", "trial", "admin@tims.test", null);
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(input));
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(input with { LocaleProfile = Guatemala }));
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(
            input with { LocaleProfile = Guatemala with { Currency = "XYZ" } }));
        // The billing-email rule still applies alongside the profile.
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(
            input with { BillingEmail = "not-an-email", LocaleProfile = Guatemala }));
    }

    [Fact]
    public void Organization_invitation_accepts_no_profile_or_a_valid_one_and_rejects_an_invalid_one()
    {
        var input = new OrganizationInvitationInput("admin@example.test", "Org Piloto", "org-piloto");
        Assert.True(OrganizationInvitationCreateUseCase.IsValid(input));
        Assert.True(OrganizationInvitationCreateUseCase.IsValid(input with { LocaleProfile = Guatemala }));
        Assert.False(OrganizationInvitationCreateUseCase.IsValid(
            input with { LocaleProfile = Guatemala with { Timezone = "Mars/Olympus" } }));
    }
}
