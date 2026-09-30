using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tims.Application.InterviewJoin;

namespace Tims.IntegrationTests.InterviewJoin;

public sealed class CandidateInterviewJoinEndpointTests
{
    private const string Route = "/interviews/candidate-join";
    private const string Token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

    private sealed class Repository : ICandidateInterviewJoinRepository
    {
        public Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct) =>
            Task.FromResult<CandidateJoinInterview?>(tokenHash == CandidateInterviewJoin.HashToken(Token)
                ? new(Guid.NewGuid(), Guid.NewGuid(), "video", "scheduled", DateTime.UtcNow.AddDays(2), 60, null,
                    null, null, "Ana", "Pérez")
                : null);
        public Task<string?> ClaimMeetingUrlAsync(Guid interviewId, Guid organizationId, string roomUrl,
            CancellationToken ct) => Task.FromResult<string?>(roomUrl);
        public Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct) => Task.FromResult(true);
    }

    private static WebApplicationFactory<Program> Factory(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x");
            builder.UseSetting("Platform:CandidateInterviewJoinEnabled", enabled.ToString());
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICandidateInterviewJoinRepository>();
                services.AddSingleton<ICandidateInterviewJoinRepository, Repository>();
            });
        });

    [Fact]
    public async Task Anonymous_join_answers_a_discriminated_outcome_and_is_never_cacheable()
    {
        await using var factory = Factory(true);
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync(Route, new { token = Token });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"outcome\":\"too_early\"", body);
        Assert.Contains("\"joinOpensAt\":", body);

        var unknown = await client.PostAsJsonAsync(Route, new { token = new string('x', 43) });
        Assert.Contains("\"outcome\":\"invalid\"", await unknown.Content.ReadAsStringAsync());
        var malformed = await client.PostAsJsonAsync(Route, new { token = "not-a-token" });
        Assert.Contains("\"outcome\":\"invalid\"", await malformed.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Body_is_strict_and_bounded()
    {
        await using var factory = Factory(true);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync(Route, new { token = Token, organizationId = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync(Route,
            new StringContent($"{{\"token\":\"{Token}\",\"token\":\"{Token}\"}}", Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync(Route, new { token = 42 })).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.PostAsync(Route,
            new StringContent($"token={Token}", Encoding.UTF8, "application/x-www-form-urlencoded"))).StatusCode);
        using var oversized = new ByteArrayContent(new byte[1025]);
        oversized.Headers.ContentType = new("application/json");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync(Route, oversized)).StatusCode);
    }

    [Fact]
    public async Task Join_route_is_dark_by_default()
    {
        await using var factory = Factory(false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Route, new { token = Token })).StatusCode);
    }
}
