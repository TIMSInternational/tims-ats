namespace Tims.Application.Identity;

/// <summary>
/// Normalizes the Supabase JWT metadata address for ASP.NET Core JwtBearer.
///
/// .NET's <c>JwtBearerOptions.MetadataAddress</c> / <c>Authority</c> expect the OpenID
/// Connect DISCOVERY document (<c>…/.well-known/openid-configuration</c>), from which the
/// framework follows <c>jwks_uri</c> to load the signing keys. Pointed at a RAW JWKS URL
/// (<c>…/.well-known/jwks.json</c>) it parses the JWKS as a discovery document, finds no
/// <c>jwks_uri</c>, and loads ZERO signing keys — so every otherwise-valid token is
/// rejected with <c>"The signature key was not found"</c> (a silent misconfig that
/// cost real debugging time on 2026-07-24, because the config option is named
/// <c>SupabaseJwksMetadataAddress</c>, inviting exactly the JWKS URL).
///
/// This maps a mistaken JWKS URL to its <c>openid-configuration</c> sibling (always the
/// correct OIDC location); any other address is returned unchanged.
/// </summary>
public static class SupabaseJwtMetadata
{
    private const string JwksSuffix = "/.well-known/jwks.json";
    private const string OidcSuffix = "/.well-known/openid-configuration";

    /// <summary>
    /// Returns the OIDC discovery address for <paramref name="address"/>: a
    /// <c>…/.well-known/jwks.json</c> URL is rewritten to its
    /// <c>…/.well-known/openid-configuration</c> sibling; anything else (already a
    /// discovery URL, an authority root, or blank) is returned unchanged.
    /// </summary>
    public static string NormalizeDiscoveryAddress(string address)
    {
        if (string.IsNullOrWhiteSpace(address))
        {
            return address;
        }

        var trimmed = address.TrimEnd('/');
        return trimmed.EndsWith(JwksSuffix, StringComparison.OrdinalIgnoreCase)
            ? trimmed[..^JwksSuffix.Length] + OidcSuffix
            : address;
    }
}
