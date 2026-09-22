namespace Tims.Api.Configuration;

public sealed class InvitationSetupOptions
{
    public bool SetupEnabled { get; init; }
    public string SupabaseUrl { get; init; } = "";
    public string SupabaseServiceKey { get; init; } = "";

    public bool IsValid() => !SetupEnabled || (!string.IsNullOrWhiteSpace(SupabaseServiceKey) &&
        Uri.TryCreate(SupabaseUrl, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
        uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0);
}
