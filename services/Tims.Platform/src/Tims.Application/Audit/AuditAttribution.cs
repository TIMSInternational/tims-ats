using System.Net;
using System.Text;

namespace Tims.Application.Audit;

/// <summary>
/// Normalizes the two caller-influenced attribution fields of a security event before they are persisted (#181).
///
/// <para><b>IP.</b> The address reaching a writer has already been through the trusted-proxy chain
/// (<c>TrustedProxyHeaderMiddleware</c> strips a client <c>x-real-ip</c>, <c>RelayAttributionMiddleware</c>
/// replaces it with the HMAC-vouched relay value, otherwise the LAST <c>x-forwarded-for</c> hop — the one App
/// Runner appends). What that chain cannot guarantee is that the value is an ADDRESS: with
/// <c>Platform:TrustXRealIpHeader</c> on, or behind a proxy that forwards a hop verbatim, it is still free text.
/// Anything that does not parse as an IPv4/IPv6 literal is recorded as unknown (null) rather than as whatever
/// string arrived, so the forensic column can only ever hold an address or nothing.</para>
///
/// <para><b>User agent.</b> Client-controlled by definition and not a trust input, but it is persisted into an
/// append-only table: it is bounded (512, the relay envelope's own limit) and stripped of control characters so a
/// caller cannot forge extra lines into log/CSV exports of these rows.</para>
/// </summary>
public static class AuditAttribution
{
    public const int MaxUserAgentLength = 512;

    /// <summary>The canonical form of a literal IP address, or null for anything else.</summary>
    public static string? Ip(string? candidate)
    {
        var trimmed = candidate?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > 45) return null;
        if (!IPAddress.TryParse(trimmed, out var address)) return null;
        // IPAddress.TryParse also accepts IPv4 inet_aton shorthands ("1", "0x7f.1", "127.1"); require the dotted-quad
        // round-trip so only an unambiguous IPv4 literal is stored. IPv6 is stored in its canonical form.
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
            && !string.Equals(address.ToString(), trimmed, StringComparison.Ordinal)) return null;
        return address.ToString();
    }

    /// <summary>Control characters removed, bounded to <see cref="MaxUserAgentLength"/>; null when nothing remains.</summary>
    public static string? UserAgent(string? candidate)
    {
        if (string.IsNullOrEmpty(candidate)) return null;
        var builder = new StringBuilder(Math.Min(candidate.Length, MaxUserAgentLength));
        foreach (var ch in candidate)
        {
            if (builder.Length == MaxUserAgentLength) break;
            if (!char.IsControl(ch)) builder.Append(ch);
        }

        if (builder.Length > 0 && char.IsHighSurrogate(builder[^1])) builder.Length--;
        var value = builder.ToString().Trim();
        return value.Length == 0 ? null : value;
    }
}
