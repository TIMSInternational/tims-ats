using System.Text;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// The contract's TIMS-Signature scheme: v1 = hex(HMAC-SHA256(secret, t + "." + raw body)), 300 s replay window, one
/// v1 per active secret during a rotation, constant-time compare.
/// </summary>
public sealed class WebhookSignatureTests
{
    private const string Secret = "whsec_current";
    private const string Previous = "whsec_previous";
    private static readonly byte[] Body = Encoding.UTF8.GetBytes("""{"event_id":"c0ffee00-4444-4555-8666-777788889999"}""");
    private static readonly DateTimeOffset Now = DateTimeOffset.FromUnixTimeSeconds(1_762_700_000);

    [Fact]
    public void Compute_matches_an_independent_hmac_of_t_dot_body()
    {
        // Independent reference: HMAC-SHA256 over the literal "<t>.<body>" string, lowercase hex.
        var reference = Convert.ToHexStringLower(System.Security.Cryptography.HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes("1762700000." + Encoding.UTF8.GetString(Body))));

        Assert.Equal(reference, WebhookSignature.Compute(Secret, 1_762_700_000, Body));
    }

    [Fact]
    public void A_fresh_correct_signature_is_valid()
    {
        var header = WebhookSignature.BuildHeader(Secret, Now.ToUnixTimeSeconds(), Body);

        Assert.Equal(WebhookSignatureCheck.Valid, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Fact]
    public void The_previous_secret_still_verifies_during_a_rotation()
    {
        var header = WebhookSignature.BuildHeader(Previous, Now.ToUnixTimeSeconds(), Body);

        Assert.Equal(WebhookSignatureCheck.Valid, WebhookSignature.Verify(header, Body, [Secret, Previous], Now));
        Assert.Equal(WebhookSignatureCheck.Mismatch, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Fact]
    public void A_header_with_two_v1_values_is_valid_when_either_matches()
    {
        var t = Now.ToUnixTimeSeconds();
        var header = $"t={t},v1={WebhookSignature.Compute("someone-else", t, Body)},v1={WebhookSignature.Compute(Secret, t, Body)}";

        Assert.Equal(WebhookSignatureCheck.Valid, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Fact]
    public void A_tampered_body_does_not_verify()
    {
        var header = WebhookSignature.BuildHeader(Secret, Now.ToUnixTimeSeconds(), Body);
        var tampered = Encoding.UTF8.GetBytes("""{"event_id":"c0ffee00-4444-4555-8666-777788889998"}""");

        Assert.Equal(WebhookSignatureCheck.Mismatch, WebhookSignature.Verify(header, tampered, [Secret], Now));
    }

    [Fact]
    public void A_signature_made_with_another_secret_does_not_verify()
    {
        var header = WebhookSignature.BuildHeader("whsec_attacker", Now.ToUnixTimeSeconds(), Body);

        Assert.Equal(WebhookSignatureCheck.Mismatch, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Theory]
    [InlineData(301)] // a captured delivery replayed after the window
    [InlineData(-301)] // a timestamp from the future
    [InlineData(86_400)]
    public void A_correctly_signed_delivery_outside_the_300_second_window_is_a_replay(long skewSeconds)
    {
        // Correctly signed for its OWN timestamp: only the window can reject it.
        var t = Now.ToUnixTimeSeconds() - skewSeconds;
        var header = WebhookSignature.BuildHeader(Secret, t, Body);

        Assert.Equal(WebhookSignatureCheck.OutsideReplayWindow, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Theory]
    [InlineData(300)]
    [InlineData(-300)]
    [InlineData(0)]
    public void The_window_edges_are_inclusive(long skewSeconds)
    {
        var t = Now.ToUnixTimeSeconds() - skewSeconds;

        Assert.Equal(WebhookSignatureCheck.Valid,
            WebhookSignature.Verify(WebhookSignature.BuildHeader(Secret, t, Body), Body, [Secret], Now));
    }

    [Fact]
    public void Re_signing_an_old_body_with_a_fresh_timestamp_needs_the_secret()
    {
        // An attacker who captured a delivery can change t, but not the v1 that covers it.
        var old = WebhookSignature.Compute(Secret, Now.ToUnixTimeSeconds() - 3600, Body);
        var header = $"t={Now.ToUnixTimeSeconds()},v1={old}";

        Assert.Equal(WebhookSignatureCheck.Mismatch, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Theory]
    [InlineData("v1=abc")]
    [InlineData("t=176270000,v1=0000000000000000000000000000000000000000000000000000000000000000")] // 9 digits
    [InlineData("t=1762700000,v1=ABCDEF0000000000000000000000000000000000000000000000000000000000")] // uppercase hex
    [InlineData("t=1762700000,v0=0000000000000000000000000000000000000000000000000000000000000000")]
    [InlineData("t=1762700000,v1=00,v1=11")]
    [InlineData("v1=0000000000000000000000000000000000000000000000000000000000000000,t=1762700000")]
    [InlineData(" t=1762700000,v1=0000000000000000000000000000000000000000000000000000000000000000")]
    public void A_header_off_the_contract_pattern_is_malformed(string header)
    {
        Assert.Equal(WebhookSignatureCheck.Malformed, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_missing_header_is_rejected(string? header)
    {
        Assert.Equal(WebhookSignatureCheck.Missing, WebhookSignature.Verify(header, Body, [Secret], Now));
    }

    [Fact]
    public void With_no_secret_nothing_verifies_not_even_an_empty_key_signature()
    {
        // An HMAC with an empty key is still an HMAC: a receiver with no secret must refuse, not compare.
        var header = WebhookSignature.BuildHeader(string.Empty, Now.ToUnixTimeSeconds(), Body);

        Assert.Equal(WebhookSignatureCheck.NoSecretConfigured, WebhookSignature.Verify(header, Body, [], Now));
        Assert.Equal(WebhookSignatureCheck.NoSecretConfigured, WebhookSignature.Verify(header, Body, [string.Empty], Now));
    }
}
