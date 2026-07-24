using Tims.Application.Identity;

namespace Tims.UnitTests.Identity;

/// <summary>
/// Red-if-regressed guard for the 2026-07-24 auth misconfig: JwtBearer's
/// MetadataAddress must be the OIDC discovery document, not a raw JWKS URL (a
/// JWKS URL loads zero signing keys → every token 401s "signature key not found").
/// </summary>
public sealed class SupabaseJwtMetadataTests
{
    private const string Oidc = "https://ref.supabase.co/auth/v1/.well-known/openid-configuration";

    [Fact]
    public void Rewrites_a_raw_jwks_url_to_its_openid_configuration_sibling()
    {
        var result = SupabaseJwtMetadata.NormalizeDiscoveryAddress(
            "https://ref.supabase.co/auth/v1/.well-known/jwks.json");

        Assert.Equal(Oidc, result);
    }

    [Fact]
    public void Leaves_an_openid_configuration_address_unchanged()
    {
        Assert.Equal(Oidc, SupabaseJwtMetadata.NormalizeDiscoveryAddress(Oidc));
    }

    [Fact]
    public void Is_case_insensitive_on_the_jwks_suffix()
    {
        var result = SupabaseJwtMetadata.NormalizeDiscoveryAddress(
            "https://ref.supabase.co/auth/v1/.well-known/JWKS.JSON");

        Assert.Equal(Oidc, result);
    }

    [Fact]
    public void Tolerates_a_trailing_slash_on_a_jwks_url()
    {
        var result = SupabaseJwtMetadata.NormalizeDiscoveryAddress(
            "https://ref.supabase.co/auth/v1/.well-known/jwks.json/");

        Assert.Equal(Oidc, result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Passes_blank_addresses_through(string blank)
    {
        Assert.Equal(blank, SupabaseJwtMetadata.NormalizeDiscoveryAddress(blank));
    }

    [Fact]
    public void Leaves_an_authority_root_or_other_address_unchanged()
    {
        const string authority = "https://ref.supabase.co/auth/v1";
        Assert.Equal(authority, SupabaseJwtMetadata.NormalizeDiscoveryAddress(authority));
    }
}
