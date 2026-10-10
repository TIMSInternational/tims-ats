using Tims.Application.Audit;

namespace Tims.UnitTests.Audit;

/// <summary>#181 — the audit IP column can only ever hold an address or nothing; the UA is bounded and single-line.</summary>
public sealed class AuditAttributionTests
{
    [Theory]
    [InlineData("203.0.113.7", "203.0.113.7")]
    [InlineData(" 203.0.113.7 ", "203.0.113.7")]
    [InlineData("2001:DB8::1", "2001:db8::1")]
    [InlineData("::ffff:203.0.113.7", "203.0.113.7")] // IPv4-mapped is unmapped: one client, one spelling
    [InlineData("::", "::")]
    public void A_literal_address_is_kept_in_canonical_form(string input, string expected) =>
        Assert.Equal(expected, AuditAttribution.Ip(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("unknown")]
    [InlineData("10.0.0.9, 203.0.113.7")] // a hop LIST is never an address
    [InlineData("203.0.113.7'); DROP TABLE audit_logs;--")]
    [InlineData("1")] // inet_aton shorthands that IPAddress.TryParse would otherwise accept
    [InlineData("127.1")]
    [InlineData("0x7f.0.0.1")]
    [InlineData("203.0.113.7:443")]
    // Review LOW-7 probes: socket/URL notation and zone ids are not addresses.
    [InlineData("[::1]")]
    [InlineData("[2001:db8::1]:8080")]
    [InlineData("fe80::1%eth0")]
    [InlineData("fe80::1%2")]
    [InlineData("01.2.3.4")]
    public void Anything_that_is_not_an_unambiguous_address_is_recorded_as_unknown(string? input) =>
        Assert.Null(AuditAttribution.Ip(input));

    [Fact]
    public void An_over_long_value_is_rejected_without_parsing() =>
        Assert.Null(AuditAttribution.Ip(new string('1', 46)));

    [Fact]
    public void User_agent_loses_control_characters_so_it_cannot_forge_lines() =>
        Assert.Equal("Mozilla/5.0 forged: row", AuditAttribution.UserAgent("Mozilla/5.0\r\n forged: row\u0000"));

    [Theory]
    [InlineData('\u2028')] // line separator
    [InlineData('\u2029')] // paragraph separator
    [InlineData('\u202E')] // right-to-left override
    [InlineData('\u200B')] // zero-width space
    [InlineData('\u0085')] // next line (a C1 control)
    public void User_agent_loses_invisible_and_line_breaking_unicode(char forged) =>
        Assert.Equal("ab", AuditAttribution.UserAgent("a" + forged + "b"));

    [Fact]
    public void User_agent_is_bounded()
    {
        var bounded = AuditAttribution.UserAgent(new string('a', 5000));
        Assert.Equal(AuditAttribution.MaxUserAgentLength, bounded!.Length);
    }

    [Fact]
    public void User_agent_bound_never_splits_a_surrogate_pair()
    {
        var value = new string('a', AuditAttribution.MaxUserAgentLength - 1) + "\U0001F600";
        var bounded = AuditAttribution.UserAgent(value)!;
        Assert.False(char.IsHighSurrogate(bounded[^1]));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("\r\n\t")]
    public void An_empty_user_agent_is_null(string? input) => Assert.Null(AuditAttribution.UserAgent(input));
}
