using Tims.Application.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// <see cref="ProviderCatalogInstrument.VersionToName"/>: the provider serves its first GA version when none is named and
/// a beta only when named, so a first assignment names a version exactly when that default is not open for hiring.
/// </summary>
public sealed class ProviderCatalogVersionToNameTests
{
    private static ProviderCatalogVersion V(string version, string status, bool selection) =>
        new(version, status, "native", selection, ["es"], ["assessment"]);

    private static string? ToName(params ProviderCatalogVersion[] versions) =>
        new ProviderCatalogInstrument("itcia", versions).VersionToName;

    [Fact]
    public void The_providers_default_open_for_hiring_names_none() =>
        Assert.Null(ToName(V("1.0", "ga", true), V("2.0", "beta", true)));

    [Fact]
    public void Only_a_beta_open_for_hiring_names_that_beta() =>
        Assert.Equal("1.0", ToName(V("1.0", "beta", true)));

    [Fact]
    public void A_default_closed_to_hiring_names_the_beta_that_is_open() =>
        Assert.Equal("2.0", ToName(V("1.0", "ga", false), V("2.0", "beta", true)));

    [Fact]
    public void A_default_closed_to_hiring_prefers_another_open_ga_over_a_beta() =>
        Assert.Equal("1.1", ToName(V("1.0", "ga", false), V("2.0", "beta", true), V("1.1", "ga", true)));

    [Fact]
    public void Nothing_open_for_hiring_names_none() =>
        Assert.Null(ToName(V("1.0", "ga", false), V("2.0", "beta", false), V("0.9", "retired", true)));
}
