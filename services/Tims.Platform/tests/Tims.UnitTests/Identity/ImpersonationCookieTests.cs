using Tims.Domain.Identity;

namespace Tims.UnitTests.Identity;

/// <summary>
/// WP2.4 pure-port parity: the fail-closed impersonation-cookie primitives ported verbatim from
/// packages/api/src/lib/impersonation.ts — <c>signImpersonationToken</c>,
/// <c>verifyImpersonationToken</c>, and <c>readImpersonationCookie</c>. No IO; <c>now</c> is passed
/// in as epoch milliseconds.
/// </summary>
public sealed class ImpersonationCookieTests
{
    private const string Secret = "test-nextauth-secret";
    private const string ImpersonatorId = "11111111-1111-1111-1111-111111111111";
    private const string TargetUserId = "22222222-2222-2222-2222-222222222222";
    private const long Now = 1_700_000_000_000L; // fixed epoch ms

    // ---- sign/verify round-trip ------------------------------------------------------
    [Fact]
    public void Sign_then_Verify_round_trips_the_payload()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);

        var payload = ImpersonationCookie.VerifyImpersonationToken(token, Secret, Now);

        Assert.NotNull(payload);
        Assert.Equal(ImpersonatorId, payload.ImpersonatorId);
        Assert.Equal(TargetUserId, payload.TargetUserId);
        Assert.Equal(Now + ImpersonationCookie.DefaultTtlMs, payload.Exp);
    }

    [Fact]
    public void Token_shape_is_body_dot_sig()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);

        var parts = token.Split('.');
        Assert.Equal(2, parts.Length);
        Assert.NotEmpty(parts[0]);
        Assert.NotEmpty(parts[1]);
    }

    // ---- tampering -------------------------------------------------------------------
    [Fact]
    public void Tampered_signature_returns_null()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);
        var dot = token.IndexOf('.', StringComparison.Ordinal);
        // Flip the last character of the signature.
        var lastChar = token[^1] == 'A' ? 'B' : 'A';
        var tampered = token[..^1] + lastChar;
        Assert.True(dot > 0 && tampered != token);

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(tampered, Secret, Now));
    }

    [Fact]
    public void Tampered_body_returns_null()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);
        // Mint a token for a DIFFERENT target, then splice its body onto the original signature.
        var other = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, "99999999-9999-9999-9999-999999999999", Now);
        var forgedBody = other[..other.IndexOf('.', StringComparison.Ordinal)];
        var originalSig = token[(token.IndexOf('.', StringComparison.Ordinal) + 1)..];
        var forged = $"{forgedBody}.{originalSig}";

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(forged, Secret, Now));
    }

    [Fact]
    public void Wrong_secret_returns_null()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, "a-different-secret", Now));
    }

    // ---- expiry ----------------------------------------------------------------------
    [Fact]
    public void Expired_token_returns_null_when_now_past_exp()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);
        var afterExpiry = Now + ImpersonationCookie.DefaultTtlMs + 1;

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, Secret, afterExpiry));
    }

    [Fact]
    public void Token_valid_exactly_at_exp_boundary()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);
        var atExpiry = Now + ImpersonationCookie.DefaultTtlMs; // now == exp, TS uses `now > exp`

        Assert.NotNull(ImpersonationCookie.VerifyImpersonationToken(token, Secret, atExpiry));
    }

    // ---- missing secret / token ------------------------------------------------------
    [Fact]
    public void No_secret_returns_null()
    {
        var token = ImpersonationCookie.SignImpersonationToken(Secret, ImpersonatorId, TargetUserId, Now);

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, null, Now));
        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, string.Empty, Now));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("no-dot-here")]
    [InlineData(".onlysig")] // dot at index 0 -> dot <= 0
    public void Missing_or_malformed_token_returns_null(string? token)
    {
        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, Secret, Now));
    }

    // ---- missing required fields -----------------------------------------------------
    [Theory]
    [InlineData("""{"targetUserId":"t","exp":9999999999999}""")] // no impersonatorId
    [InlineData("""{"impersonatorId":"i","exp":9999999999999}""")] // no targetUserId
    [InlineData("""{"impersonatorId":"i","targetUserId":"t"}""")] // no exp
    [InlineData("""{"impersonatorId":"","targetUserId":"t","exp":9999999999999}""")] // empty impersonatorId
    [InlineData("""{"impersonatorId":"i","targetUserId":"","exp":9999999999999}""")] // empty targetUserId
    [InlineData("""{"impersonatorId":"i","targetUserId":"t","exp":"9999999999999"}""")] // exp is a string, not a number
    [InlineData("[1,2,3]")] // not an object
    public void Missing_or_wrong_typed_fields_return_null(string bodyJson)
    {
        // Re-sign an arbitrary body so the signature is VALID; only the payload contents are the defect.
        var token = SignRawBody(Secret, bodyJson);

        Assert.Null(ImpersonationCookie.VerifyImpersonationToken(token, Secret, Now));
    }

    // ---- readImpersonationCookie -----------------------------------------------------
    [Fact]
    public void ReadImpersonationCookie_finds_and_url_decodes_the_value()
    {
        // 'body.sig' as a cookie value; also prove URL-decoding of an encoded '='-free token is a no-op here,
        // and that a percent-encoded value is decoded.
        var header = "session=abc; tims_impersonation=body%2Bpart.sig; other=x";

        var value = ImpersonationCookie.ReadImpersonationCookie(header);

        Assert.Equal("body+part.sig", value);
    }

    [Fact]
    public void ReadImpersonationCookie_returns_null_when_absent()
    {
        Assert.Null(ImpersonationCookie.ReadImpersonationCookie("session=abc; other=x"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void ReadImpersonationCookie_returns_null_for_empty_header(string? header)
    {
        Assert.Null(ImpersonationCookie.ReadImpersonationCookie(header));
    }

    [Fact]
    public void ReadImpersonationCookie_trims_key_whitespace()
    {
        var header = "  tims_impersonation=xyz  ";

        Assert.Equal("xyz", ImpersonationCookie.ReadImpersonationCookie(header));
    }

    // Signs an arbitrary body string (bypassing SignImpersonationToken's JSON builder) so a VALID
    // signature can be paired with a deliberately-malformed payload.
    private static string SignRawBody(string secret, string bodyJson)
    {
        var body = System.Buffers.Text.Base64Url.EncodeToString(System.Text.Encoding.UTF8.GetBytes(bodyJson));
        var sig = System.Buffers.Text.Base64Url.EncodeToString(
            System.Security.Cryptography.HMACSHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(secret),
                System.Text.Encoding.UTF8.GetBytes(body)));
        return $"{body}.{sig}";
    }
}
