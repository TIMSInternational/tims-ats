using System.Net.Mail;

namespace Tims.Infrastructure.Email;

public sealed class EmailOptions
{
    public const string SectionName = "Email";
    public bool Enabled { get; init; }
    public string Region { get; init; } = "";
    public string FromAddress { get; init; } = "";
    public int TimeoutSeconds { get; init; } = 10;

    public bool IsValid() => TimeoutSeconds is >= 1 and <= 60
        && (!Enabled || (IsMailbox(FromAddress)
            && Amazon.RegionEndpoint.EnumerableAllRegions.Any(region => region.SystemName == Region)));

    // SES requires ASCII mailbox addresses. Reject display names, lists and header controls;
    // callers send one message per recipient to avoid disclosing addresses across tenants.
    internal static bool IsMailbox(string? value) => value is { Length: > 0 and <= 254 }
        && value.All(character => character is > ' ' and < '\u007f')
        && MailAddress.TryCreate(value, out var address)
        && address.Address == value && address.DisplayName.Length == 0;
}
