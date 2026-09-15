namespace Tims.Api.Configuration;

public sealed class InvitationDeliveryOptions
{
    public const string SectionName = "Invitations";
    public string AppOrigin { get; init; } = "https://tims-ats.vercel.app";
    public bool IsValid() => Uri.TryCreate(AppOrigin, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0
        && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0;
}
