using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Tims.Application.PlatformInvitations;

namespace Tims.Infrastructure.PlatformInvitations;

public sealed class InvitationIdentityProvider(HttpClient client, IConfiguration configuration)
    : IInvitationIdentityProvider
{
    private Uri AuthUrl(string path)
    {
        var origin = configuration["Invitations:SupabaseUrl"];
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("Invitation identity service is not configured");
        return new Uri(uri, "/auth/v1/" + path);
    }

    private string Key => configuration["Invitations:SupabaseServiceKey"]
        ?? throw new InvalidOperationException("Invitation identity service is not configured");

    public async Task<bool> CreateAsync(string email, string password, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, AuthUrl("admin/users"));
        request.Headers.Add("apikey", Key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Key);
        request.Content = JsonContent.Create(new { email, password, email_confirm = true });
        using var response = await client.SendAsync(request, ct);
        return response.IsSuccessStatusCode;
    }

    public async Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, AuthUrl("user"));
        request.Headers.Add("apikey", Key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return null;
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = document.RootElement;
        if (!root.TryGetProperty("id", out var id) || !Guid.TryParse(id.GetString(), out _) ||
            !root.TryGetProperty("email", out var email) || string.IsNullOrWhiteSpace(email.GetString()) ||
            !root.TryGetProperty("email_confirmed_at", out var confirmed) ||
            confirmed.ValueKind != JsonValueKind.String || !DateTimeOffset.TryParse(confirmed.GetString(), out _))
            return null;
        return new(id.GetString()!, email.GetString()!);
    }
}
