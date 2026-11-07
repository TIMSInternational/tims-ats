using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Application.InterviewJoin;
using Tims.Application.InterviewTranscription;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;
using F = Tims.IntegrationTests.InterviewTranscription.InterviewTranscriptionFixture;

namespace Tims.IntegrationTests.InterviewTranscription;

/// <summary>
/// The transcription surface over the REAL host + real Postgres (RLS forced, app_tenant): JWT → PrincipalResolver →
/// PermissionService interview:read|create → ScopedProbe(interview) → use case, plus the signed Daily webhook and the
/// candidate join's consent step writing to the same ledger. Daily is a fake.
/// </summary>
[Collection("InterviewTranscription")]
public sealed class InterviewTranscriptionEndpointTests(F fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string JoinToken = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
    private static readonly string Secret = Convert.ToBase64String(Encoding.UTF8.GetBytes("integration-hmac-secret-0123456789"));
    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "interview-transcription-test-key" };

    private sealed class FakeProvider : ITranscriptionProvider
    {
        public bool IsConfigured => true;
        public List<(string Room, string Language)> Starts { get; } = [];
        public List<Guid> Deleted { get; } = [];

        public Task<TranscriptionStartResult> StartAsync(string roomName, string language, CancellationToken ct)
        {
            Starts.Add((roomName, language));
            return Task.FromResult(TranscriptionStartResult.Started);
        }

        public Task<string?> DownloadTranscriptAsync(Guid transcriptId, CancellationToken ct) =>
            Task.FromResult<string?>("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Laura Mora>¿Qué la motiva?</v>\n\n" +
                                     "00:00:03.000 --> 00:00:06.000\n<v Ana Pérez>Resolver problemas con datos.</v>\n");

        public Task<bool> DeleteTranscriptAsync(Guid transcriptId, CancellationToken ct)
        {
            Deleted.Add(transcriptId);
            return Task.FromResult(true);
        }

        public Task<bool> StopAsync(string roomName, CancellationToken ct) => Task.FromResult(true);
    }

    private sealed class JoinRepository(Guid interviewId) : ICandidateInterviewJoinRepository
    {
        public Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct) =>
            Task.FromResult<CandidateJoinInterview?>(tokenHash == CandidateInterviewJoin.HashToken(JoinToken)
                ? new(interviewId, F.OrgA, "video", "scheduled", DateTime.UtcNow.AddMinutes(5), 60, null, null,
                    $"https://tims.daily.co/{CandidateInterviewJoin.RoomNameFor(interviewId)}", "Ana", "Pérez")
                : null);

        public Task<string?> ClaimMeetingUrlAsync(Guid id, Guid org, string roomUrl, CancellationToken ct) =>
            Task.FromResult<string?>(roomUrl);

        public Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct) => Task.FromResult(true);

        public Task<bool> IsRoomSharedAsync(Guid id, string roomName, CancellationToken ct) => Task.FromResult(false);
    }

    private sealed class Video : ICandidateVideoProvider
    {
        public bool IsConfigured => true;

        public Task<VideoRoom?> EnsureRoomAsync(string roomName, DateTimeOffset openUntil, CancellationToken ct) =>
            Task.FromResult<VideoRoom?>(new(roomName, "https://tims.daily.co/" + roomName));

        public Task<string?> CreateGuestTokenAsync(string roomName, string userName, DateTimeOffset notBefore,
            DateTimeOffset expiresAt, CancellationToken ct) => Task.FromResult<string?>("guest.token");
    }

    private WebApplicationFactory<Program> Factory(bool enabled = true, FakeProvider? provider = null,
        Guid? joinInterview = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:InterviewTranscriptionEnabled", enabled ? "true" : "false");
            builder.UseSetting("Platform:CandidateInterviewJoinEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            builder.UseSetting("Daily:WebhookSecret", Secret);
            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
                services.RemoveAll<ITranscriptionProvider>();
                services.AddSingleton<ITranscriptionProvider>(provider ?? new FakeProvider());
                services.RemoveAll<ICandidateInterviewJoinRepository>();
                services.AddSingleton<ICandidateInterviewJoinRepository>(new JoinRepository(joinInterview ?? F.Assigned));
                services.RemoveAll<ICandidateVideoProvider>();
                services.AddSingleton<ICandidateVideoProvider>(new Video());
            });
        });

    private static string Mint(string sub) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer,
        Audience = Audience,
        Subject = new ClaimsIdentity([new Claim("sub", sub)]),
        Expires = DateTime.UtcNow.AddMinutes(10),
        SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
    });

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object? body,
        string? sub)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is string raw) request.Content = new StringContent(raw, Encoding.UTF8, "application/json");
        else if (body is not null) request.Content = JsonContent.Create(body);
        if (sub is not null) request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        return client.SendAsync(request);
    }

    private static string Status(Guid id) => $"/tenant/interviews/{id}/transcription";

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static HttpRequestMessage Webhook(string body, string? secret = null, long? timestamp = null)
    {
        var ts = (timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds()).ToString();
        var signature = Convert.ToBase64String(HMACSHA256.HashData(Convert.FromBase64String(secret ?? Secret),
            Encoding.UTF8.GetBytes(ts + "." + body)));
        var request = new HttpRequestMessage(HttpMethod.Post, InterviewTranscriptionEndpointsPath)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-Webhook-Timestamp", ts);
        request.Headers.Add("X-Webhook-Signature", signature);
        return request;
    }

    private const string InterviewTranscriptionEndpointsPath = "/webhooks/daily/interview-transcription";

    [Fact]
    public async Task Every_route_is_dark_by_default_and_the_join_keeps_its_strict_body()
    {
        await using var factory = Factory(enabled: false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.RecruiterSub)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(client, HttpMethod.Get, $"/tenant/interviews/{F.Assigned}/transcript", null, F.RecruiterSub)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Webhook("""{"test":"test"}"""))).StatusCode);
        var join = await client.PostAsJsonAsync("/interviews/candidate-join",
            new { token = JoinToken, recordingConsent = Accepted, consentVersion = ConsentTextVersion });
        Assert.Equal(HttpStatusCode.BadRequest, join.StatusCode);
        var plain = await Json(await client.PostAsJsonAsync("/interviews/candidate-join", new { token = JoinToken }));
        Assert.Equal("ready", plain.GetProperty("outcome").GetString());
        Assert.False(plain.TryGetProperty("consentVersion", out _));
    }

    [Fact]
    public async Task Status_gate_matrix_401_403_404_200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.NoGrantSub)).StatusCode);
        // own scope, not an evaluator of this interview → 404 (never confirms it exists)
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.OutsiderSub)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.OrgBRecruiterSub)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, Status(F.OrgBInterview), null, F.RecruiterSub)).StatusCode);

        var evaluator = await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.EvaluatorSub);
        Assert.Equal(HttpStatusCode.OK, evaluator.StatusCode);
        Assert.Contains("no-store", evaluator.Headers.CacheControl!.ToString());
        var body = await Json(evaluator);
        Assert.Equal(ConsentTextVersion, body.GetProperty("consentVersion").GetString());
        Assert.Equal(Pending, body.GetProperty("candidateDecision").GetString());
        Assert.False(body.GetProperty("canStart").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, Status(F.Assigned), null, F.RecruiterSub)).StatusCode);
    }

    [Fact]
    public async Task Acknowledge_and_start_parse_bodies_after_the_gate()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var ack = $"/tenant/interviews/{F.Assigned}/transcription/acknowledgement";
        // An ungranted caller with a garbage body is still 403, not 400 (TRAP 9).
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, ack, "garbage", F.NoGrantSub)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, ack, "garbage", F.EvaluatorSub)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, ack,
            new { consentVersion = ConsentTextVersion, extra = 1 }, F.EvaluatorSub)).StatusCode);
        // Start needs interview:create — the outsider (read @ own, not assigned) is 403 before scope.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post,
            $"/tenant/interviews/{F.Assigned}/transcription/start", new { language = "es" }, F.OutsiderSub)).StatusCode);
    }

    [Fact]
    public async Task End_to_end_consent_start_webhook_and_transcript()
    {
        var interview = await fixture.AddInterviewAsync();
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider, joinInterview: interview);
        using var client = factory.CreateClient();
        var start = $"/tenant/interviews/{interview}/transcription/start";

        // 1. The candidate is asked first; nothing minted until they answer.
        var asked = await Json(await client.PostAsJsonAsync("/interviews/candidate-join", new { token = JoinToken }));
        Assert.Equal("consent_required", asked.GetProperty("outcome").GetString());
        Assert.Equal(ConsentTextVersion, asked.GetProperty("consentVersion").GetString());
        var joined = await Json(await client.PostAsJsonAsync("/interviews/candidate-join",
            new { token = JoinToken, recordingConsent = Accepted, consentVersion = ConsentTextVersion }));
        Assert.Equal("ready", joined.GetProperty("outcome").GetString());
        Assert.Equal(1, await fixture.CountAuditAsync(interview, ConsentAction));

        // 2. The evaluator cannot start before acknowledging; then can.
        var refused = await Send(client, HttpMethod.Post, start, new { language = "es" }, F.EvaluatorSub);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("acknowledgement_missing", (await Json(refused)).GetProperty("code").GetString());
        var acked = await Json(await Send(client, HttpMethod.Post,
            $"/tenant/interviews/{interview}/transcription/acknowledgement", new { consentVersion = ConsentTextVersion },
            F.EvaluatorSub));
        Assert.True(acked.GetProperty("viewerAcknowledged").GetBoolean());
        Assert.True(acked.GetProperty("canStart").GetBoolean());
        var started = await Send(client, HttpMethod.Post, start, new { language = "es" }, F.EvaluatorSub);
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        Assert.Equal((CandidateInterviewJoin.RoomNameFor(interview), "es"), Assert.Single(provider.Starts));

        // 3. Daily reports the transcript: an unsigned delivery is refused, a signed one stored once.
        var transcriptId = Guid.NewGuid();
        var ready = $"{{\"version\":\"1.1.0\",\"type\":\"transcript.ready-to-download\",\"id\":\"evt-{transcriptId:N}\"," +
                    $"\"payload\":{{\"id\":\"{transcriptId}\",\"room_name\":\"{CandidateInterviewJoin.RoomNameFor(interview)}\"}}}}";
        var forged = Webhook(ready, secret: Convert.ToBase64String(Encoding.UTF8.GetBytes("attacker-secret-0123456789abcdef")));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(forged)).StatusCode);
        var stored = await client.SendAsync(Webhook(ready));
        Assert.Equal(HttpStatusCode.OK, stored.StatusCode);
        Assert.Equal("stored", (await Json(stored)).GetProperty("handled").GetString());
        Assert.Equal("duplicate", (await Json(await client.SendAsync(Webhook(ready)))).GetProperty("handled").GetString());
        Assert.Equal(TranscriptReference(transcriptId), await fixture.ScalarAsync<string>(
            "SELECT transcript_url FROM interviews WHERE id=@id", ("id", interview)));

        // 4. The transcript comes back pseudonymized.
        var transcript = await Json(await Send(client, HttpMethod.Get, $"/tenant/interviews/{interview}/transcript", null,
            F.EvaluatorSub));
        var speakers = transcript.GetProperty("segments").EnumerateArray().Select(s => s.GetProperty("speaker").GetString()!).ToArray();
        Assert.Equal(["interviewer_1", "candidate"], speakers);
        Assert.DoesNotContain("Pérez", transcript.GetRawText());
        Assert.Equal("Comunicación", transcript.GetProperty("competencies")[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task The_webhook_answers_the_creation_probe_and_rejects_stale_or_unsigned_deliveries()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var probe = await client.SendAsync(Webhook("""{"test":"test"}"""));
        Assert.Equal(HttpStatusCode.OK, probe.StatusCode);
        Assert.Equal("test", (await Json(probe)).GetProperty("handled").GetString());
        var stale = Webhook("""{"test":"test"}""", timestamp: DateTimeOffset.UtcNow.AddDays(-3).ToUnixTimeSeconds());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(stale)).StatusCode);
        using var unsigned = new HttpRequestMessage(HttpMethod.Post, InterviewTranscriptionEndpointsPath)
        {
            Content = new StringContent("""{"test":"test"}""", Encoding.UTF8, "application/json"),
        };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(unsigned)).StatusCode);
    }
}
