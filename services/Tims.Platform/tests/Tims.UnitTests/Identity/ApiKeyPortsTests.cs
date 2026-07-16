using System.Security.Cryptography;
using System.Text;
using Tims.Domain.Identity;

namespace Tims.UnitTests.Identity;

/// <summary>
/// WP2.3 pure-port parity: the three fail-closed API-key primitives ported verbatim from the TS
/// 1.6 surface — <c>hashApiKey</c>, <c>extractBearerToken</c>, and <c>parseScopes</c>. No IO.
/// </summary>
public sealed class ApiKeyPortsTests
{
    // ---- ApiKeyHash.Sha256Hex (hashApiKey) ------------------------------------------
    [Fact]
    public void Sha256Hex_matches_lowercase_hex_of_utf8_bytes()
    {
        const string raw = "tims_production_abc123";
        var expected = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)))
            .ToLowerInvariant();

        var actual = ApiKeyHash.Sha256Hex(raw);

        Assert.Equal(expected, actual);
        Assert.Equal(64, actual.Length); // 32 bytes → 64 hex chars
        Assert.Equal(actual, actual.ToLowerInvariant()); // lowercase digest
    }

    [Fact]
    public void Sha256Hex_is_stable_and_input_sensitive()
    {
        Assert.Equal(ApiKeyHash.Sha256Hex("same"), ApiKeyHash.Sha256Hex("same"));
        Assert.NotEqual(ApiKeyHash.Sha256Hex("a"), ApiKeyHash.Sha256Hex("b"));
    }

    // ---- BearerToken.ExtractBearerToken (extractBearerToken) -------------------------
    [Theory]
    [InlineData("Bearer tims_abc", "tims_abc")]
    [InlineData("bearer tims_abc", "tims_abc")] // scheme case-insensitive
    [InlineData("BEARER   tims_abc  ", "tims_abc")] // extra internal + trailing ws trimmed
    [InlineData("  Bearer tims_abc", "tims_abc")] // leading header ws trimmed
    public void ExtractBearerToken_returns_token_for_valid_headers(string header, string expected)
    {
        Assert.Equal(expected, BearerToken.ExtractBearerToken(header));
    }

    [Theory]
    [InlineData(null)] // no header
    [InlineData("")] // empty
    [InlineData("tims_abc")] // no scheme
    [InlineData("Basic abc")] // wrong scheme
    [InlineData("Bearer")] // scheme, no token
    [InlineData("Bearer    ")] // scheme, only whitespace token
    public void ExtractBearerToken_fails_closed_for_bad_headers(string? header)
    {
        Assert.Null(BearerToken.ExtractBearerToken(header));
    }

    [Fact]
    public void ExtractBearerToken_rejects_overlong_header()
    {
        var overlong = "Bearer " + new string('x', 2048); // total length > 2048
        Assert.True(overlong.Length > 2048);
        Assert.Null(BearerToken.ExtractBearerToken(overlong));
    }

    // ---- ApiKeyScopes.ParseScopes (parseScopes) -------------------------------------
    [Fact]
    public void ParseScopes_returns_list_for_valid_string_array()
    {
        var scopes = ApiKeyScopes.ParseScopes("""["read:candidates","write:notes"]""");
        Assert.NotNull(scopes);
        Assert.Equal(new[] { "read:candidates", "write:notes" }, scopes);
    }

    [Fact]
    public void ParseScopes_empty_array_is_valid_and_empty()
    {
        var scopes = ApiKeyScopes.ParseScopes("[]");
        Assert.NotNull(scopes);
        Assert.Empty(scopes);
    }

    [Theory]
    [InlineData("""[1,2]""")] // numbers, not strings
    [InlineData("""["ok",2]""")] // mixed: one non-string element
    [InlineData("\"x\"")] // a bare string, not an array
    [InlineData("123")] // a number
    [InlineData("{}")] // an object
    [InlineData("null")] // JSON null
    [InlineData("true")] // a boolean
    [InlineData("not json at all")] // unparseable
    public void ParseScopes_fails_closed_for_malformed(string json)
    {
        Assert.Null(ApiKeyScopes.ParseScopes(json));
    }

    [Fact]
    public void ParseScopes_null_input_fails_closed()
    {
        Assert.Null(ApiKeyScopes.ParseScopes(null));
    }
}
