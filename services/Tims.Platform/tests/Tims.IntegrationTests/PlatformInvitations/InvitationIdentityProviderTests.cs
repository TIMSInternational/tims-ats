using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed class InvitationIdentityProviderTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> response) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string Body { get; private set; } = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            return response(request);
        }
    }

    private static IConfiguration Config(string origin = "https://project.supabase.co") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Invitations:SupabaseUrl"] = origin,
            ["Invitations:SupabaseServiceKey"] = "test-service-key",
        }).Build();

    [Fact]
    public async Task Create_uses_admin_endpoint_and_confirmed_email_without_leaking_key_into_body()
    {
        var handler = new Handler(_ => new(HttpStatusCode.Created));
        var provider = new InvitationIdentityProvider(new HttpClient(handler), Config());

        Assert.True(await provider.CreateAsync("invitee@example.test", "private-credential", default));
        Assert.Equal("https://project.supabase.co/auth/v1/admin/users", handler.Request!.RequestUri!.ToString());
        Assert.Equal("Bearer", handler.Request.Headers.Authorization!.Scheme);
        Assert.Equal("test-service-key", handler.Request.Headers.Authorization.Parameter);
        Assert.Contains("\"email_confirm\":true", handler.Body);
        Assert.DoesNotContain("test-service-key", handler.Body);
    }

    [Fact]
    public async Task Verify_accepts_only_confirmed_well_formed_identity()
    {
        var id = Guid.NewGuid();
        var handler = new Handler(_ => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                id,
                email = "invitee@example.test",
                email_confirmed_at = "2026-09-22T10:00:00Z",
            })),
        });
        var provider = new InvitationIdentityProvider(new HttpClient(handler), Config());

        var identity = await provider.VerifyAsync("user-access-token", default);
        Assert.Equal(id.ToString(), identity!.Id);
        Assert.Equal("invitee@example.test", identity.Email);
        Assert.Equal("Bearer user-access-token", handler.Request!.Headers.Authorization!.ToString());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"id\":\"invalid\",\"email\":\"invitee@example.test\",\"email_confirmed_at\":\"2026-09-22T10:00:00Z\"}")]
    [InlineData("{\"id\":\"11111111-1111-4111-8111-111111111111\",\"email\":\"invitee@example.test\",\"email_confirmed_at\":null}")]
    public async Task Verify_rejects_malformed_or_unconfirmed_provider_response(string body)
    {
        var provider = new InvitationIdentityProvider(new HttpClient(new Handler(_ => new(HttpStatusCode.OK)
        { Content = new StringContent(body) })), Config());
        Assert.Null(await provider.VerifyAsync("user-access-token", default));
    }

    [Theory]
    [InlineData("http://project.supabase.co")]
    [InlineData("https://user@project.supabase.co")]
    [InlineData("https://project.supabase.co/other")]
    public async Task Invalid_provider_origin_fails_closed_before_dispatch(string origin)
    {
        var provider = new InvitationIdentityProvider(new HttpClient(new Handler(_ => new(HttpStatusCode.OK))), Config(origin));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            provider.CreateAsync("invitee@example.test", "private-credential", default));
    }
}
