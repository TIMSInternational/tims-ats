using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// FIT v2 against real Postgres (RLS on, app_tenant) and the real host:
///   the ATS native-quiz adapter — only assignments WITH a result, integrity from status + proctoring severity +
///     breakdown.pendingManual (a mixed choice/essay result awaiting manual grading is needs review),
///     an OrgB-stamped row for the same candidate/vacancy ids never returned, completedAt re-kinded UTC;
///   the provider stub — returns nothing;
///   the flag — compute on VacFitV2 with FitEngineV2Enabled OFF writes the v1 breakdown (latest-of-any-type,
///     NULLS FIRST: 90 and 99), ON writes v2 (the flagged latest attempt is needs review and excluded; the
///     cancelled attempt is needs review; the valid 75 scores 100 against min 50), OFF again restores the v1
///     bytes exactly; and the v2 flag alone maps no route.
/// Rows: VacFitV2 / CandV2* only (FitV2SeedSql), so no other test's expectations move.
/// </summary>
[Collection("FitEngine")]
public sealed class FitV2Tests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-v2-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    // ── the ATS adapter ──
    [Fact]
    public async Task AtsSource_FlaggedLatestAttempt_IsNeedsReview_OlderCleanAttemptIsValid()
    {
        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2Flagged, FitEngineFixture.VacFitV2, CancellationToken.None);

        Assert.Equal(
            [FitEngineFixture.AsgV2FlaggedNew.ToString(), FitEngineFixture.AsgV2FlaggedOld.ToString()],
            results.Select(r => r.ResultId).ToArray());
        var newest = results[0];
        Assert.Equal(ResultIntegrity.NeedsReview, newest.Integrity);
        Assert.Equal(90, newest.NormalizedScore);
        Assert.Equal(new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero), newest.CompletedAt);
        Assert.Equal(ResultIntegrity.Valid, results[1].Integrity);
        Assert.All(results, r =>
        {
            Assert.Equal(FitInstruments.NativeQuiz, r.Instrument);
            Assert.Equal(AtsAssessmentResultSource.SourceName, r.Source);
            Assert.Null(r.ContentVersion);
            Assert.Null(r.NormVersion);
        });
    }

    [Fact]
    public async Task AtsSource_ExcludesNoResultAndOtherOrgRows_CancelledIsNeedsReview_NullDateSortsLast()
    {
        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2Valid, FitEngineFixture.VacFitV2, CancellationToken.None);

        Assert.Equal(
            [FitEngineFixture.AsgV2Valid.ToString(), FitEngineFixture.AsgV2Cancelled.ToString()],
            results.Select(r => r.ResultId).ToArray());
        Assert.Equal(ResultIntegrity.Valid, results[0].Integrity); // 'low' session, pendingManual [] — not blocked
        Assert.Equal(75, results[0].NormalizedScore);
        Assert.Equal(ResultIntegrity.NeedsReview, results[1].Integrity);
        Assert.Null(results[1].CompletedAt);
        Assert.DoesNotContain(results, r => r.ResultId == FitEngineFixture.AsgV2OtherOrg.ToString());
        Assert.DoesNotContain(results, r => r.ResultId == FitEngineFixture.AsgV2NoResult.ToString());
    }

    [Fact]
    public async Task AtsSource_OtherOrgScope_SeesNothing_AndNoAssignmentsIsEmpty()
    {
        await using var db = _fixture.NewWriteContext();
        var source = new AtsAssessmentResultSource(db);

        // Under OrgB's scope only the OrgB-stamped assignment (whose result is OrgB too) is visible, none of OrgA's.
        var orgB = await source.GetResultsAsync(
            FitEngineFixture.OrgB, FitEngineFixture.CandV2Valid, FitEngineFixture.VacFitV2, CancellationToken.None);
        Assert.Equal([FitEngineFixture.AsgV2OtherOrg.ToString()], orgB.Select(r => r.ResultId).ToArray());

        var none = await source.GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2None, FitEngineFixture.VacFitV2, CancellationToken.None);
        Assert.Empty(none);
    }

    [Theory]
    [InlineData("completed", null, false, ResultIntegrity.Valid)]
    [InlineData("completed", "low", false, ResultIntegrity.Valid)]
    [InlineData("completed", "medium", false, ResultIntegrity.Valid)]
    [InlineData("completed", "high", false, ResultIntegrity.NeedsReview)]
    [InlineData("completed", "CRITICAL", false, ResultIntegrity.NeedsReview)]
    [InlineData("cancelled", null, false, ResultIntegrity.NeedsReview)]
    [InlineData("in_progress", null, false, ResultIntegrity.NeedsReview)]
    [InlineData("Completed", null, false, ResultIntegrity.NeedsReview)]
    [InlineData("completed", null, true, ResultIntegrity.NeedsReview)]
    [InlineData("completed", "low", true, ResultIntegrity.NeedsReview)]
    public void AtsIntegrity_OnlyACompletedUnflaggedFullyGradedAssignmentIsValid(
        string status, string? severity, bool pendingManual, ResultIntegrity expected) =>
        Assert.Equal(expected, AtsAssessmentResultSource.IntegrityOf(status, severity, pendingManual));

    [Theory]
    [InlineData(null, false)]
    [InlineData("""{"autoScored":3,"pendingManual":[]}""", false)]
    [InlineData("""{"autoScored":3}""", false)]
    [InlineData("""[]""", false)]
    [InlineData("""{"autoScored":1,"pendingManual":["q-essay"]}""", true)]
    [InlineData("""{"pendingManual":"q-essay"}""", true)]
    [InlineData("""{"pendingManual":null}""", true)]
    public void AtsPendingManualGrading_NonEmptyOrMalformedListIsPending(string? breakdown, bool expected) =>
        Assert.Equal(expected, AtsAssessmentResultSource.HasPendingManualGrading(breakdown));

    [Fact]
    public async Task AtsSource_MixedChoiceAndEssay_AwaitingManualGrading_IsNeedsReview_NotAScoreOf100()
    {
        // The TS submission of one correct choice plus an ungraded essay: completed, normalized_score 100 over the
        // auto-scored question only, breakdown.pendingManual = [the essay]. Codex round 5 [P1].
        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2Pending, FitEngineFixture.VacFitV2, CancellationToken.None);

        var result = Assert.Single(results);
        Assert.Equal(FitEngineFixture.AsgV2Pending.ToString(), result.ResultId);
        Assert.Equal(100, result.NormalizedScore);
        Assert.Equal(ResultIntegrity.NeedsReview, result.Integrity);
    }

    [Fact]
    public async Task ProviderStub_ReturnsNothing()
    {
        var results = await new ProviderAssessmentResultSource().GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2Valid, FitEngineFixture.VacFitV2, CancellationToken.None);
        Assert.Empty(results);
    }

    // ── the flag, end to end ──
    [Fact]
    public async Task Compute_V2FlagOffOnOff_WritesV1_ThenV2_ThenTheSameV1BytesAgain()
    {
        // 1. Flag OFF → v1: latest-of-any-type with NULLS FIRST (90 for Flagged, the cancelled 99 for Valid).
        await ComputeAsync(v2: false);
        var v1Flagged = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Flagged, FitEngineFixture.VacFitV2);
        var v1Valid = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Valid, FitEngineFixture.VacFitV2);
        Assert.NotNull(v1Flagged);
        Assert.NotNull(v1Valid);
        Assert.Equal(90, JsonNode.Parse(v1Flagged.Breakdown)!["assessment"]!.GetValue<double>());
        Assert.Equal(99, JsonNode.Parse(v1Valid.Breakdown)!["assessment"]!.GetValue<double>());
        Assert.Null(JsonNode.Parse(v1Valid.Breakdown)!["fitVersion"]);
        Assert.Equal(97, v1Flagged.OverallScore); // (90 + 100 + 100) × 0.2 / 0.6 = 96.67
        var v1PendingRow = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Pending, FitEngineFixture.VacFitV2);
        Assert.NotNull(v1PendingRow);

        // 2. Flag ON → v2.
        await ComputeAsync(v2: true);
        var v2Flagged = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Flagged, FitEngineFixture.VacFitV2);
        var v2Valid = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Valid, FitEngineFixture.VacFitV2);
        Assert.NotNull(v2Flagged);
        Assert.NotNull(v2Valid);

        var flagged = JsonNode.Parse(v2Flagged.Breakdown)!;
        Assert.Equal(2, flagged["fitVersion"]!.GetValue<int>());
        Assert.Null(flagged["assessment"]); // the flagged latest attempt is excluded, NOT read as 0 and NOT 90
        Assert.Equal(100, v2Flagged.OverallScore); // experience 100 + languages 100, renormalized
        Assert.True(v2Flagged.IsPartial);
        Assert.True(flagged["reviewPending"]!.GetValue<bool>()); // the number is provisional until a person reviews
        var flaggedQuiz = flagged["assessments"]![0]!;
        Assert.Equal("needs_review", flaggedQuiz["status"]!.GetValue<string>());
        Assert.Equal(FitEngineFixture.AsgV2FlaggedNew.ToString(), flaggedQuiz["resultId"]!.GetValue<string>());
        Assert.Equal("quiz técnico", flaggedQuiz["reason"]!.GetValue<string>());
        var liaGate = flagged["assessments"]![1]!;
        Assert.Equal("unknown", liaGate["gate"]!.GetValue<string>());
        Assert.Equal("no_result", liaGate["status"]!.GetValue<string>());

        var valid = JsonNode.Parse(v2Valid.Breakdown)!;
        Assert.Equal(100, valid["assessment"]!.GetValue<double>()); // 75 vs min 50 → capped 100 (not the cancelled 99)
        Assert.Equal(83, v2Valid.OverallScore); // (100 + 50 + 100) × 0.2 / 0.6 = 83.33
        Assert.False(valid["reviewPending"]!.GetValue<bool>()); // the cancelled attempt has no completedAt: not judged
        Assert.Equal(FitEngineFixture.AsgV2Valid.ToString(), valid["assessments"]![0]!["resultId"]!.GetValue<string>());
        Assert.Equal(v1Valid.Id, v2Valid.Id); // the same row, updated

        // Mixed choice/essay awaiting manual grading: v1 reads the auto-only 100; v2 holds it as needs review.
        var v1Pending = JsonNode.Parse(v1PendingRow.Breakdown)!;
        Assert.Equal(100, v1Pending["assessment"]!.GetValue<double>());
        var v2PendingRow = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Pending, FitEngineFixture.VacFitV2);
        Assert.NotNull(v2PendingRow);
        var pending = JsonNode.Parse(v2PendingRow.Breakdown)!;
        Assert.Null(pending["assessment"]);
        Assert.True(pending["reviewPending"]!.GetValue<bool>());
        Assert.True(v2PendingRow.IsPartial);
        Assert.Equal("needs_review", pending["assessments"]![0]!["status"]!.GetValue<string>());
        Assert.Equal(FitEngineFixture.AsgV2Pending.ToString(), pending["assessments"]![0]!["resultId"]!.GetValue<string>());

        // 3. Flag OFF again → the v1 bytes come back exactly.
        await ComputeAsync(v2: false);
        var again = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Flagged, FitEngineFixture.VacFitV2);
        Assert.NotNull(again);
        Assert.Equal(v1Flagged.Breakdown, again.Breakdown);
        Assert.Equal(v1Flagged.OverallScore, again.OverallScore);
        Assert.Equal(v1Flagged.IsPartial, again.IsPartial);
    }

    [Fact]
    public async Task V2FlagAlone_MapsNoRoute()
    {
        await using var factory = Factory(write: false, v2: true);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, $"/fit-engine/vacancies/{FitEngineFixture.VacFitV2}/compute");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private async Task ComputeAsync(bool v2)
    {
        await using var factory = Factory(write: true, v2: v2);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, $"/fit-engine/vacancies/{FitEngineFixture.VacFitV2}/compute");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":3}", await response.Content.ReadAsStringAsync());
    }

    private WebApplicationFactory<Program> Factory(bool write, bool v2) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FitEngineWriteEnabled", write ? "true" : "false");
            builder.UseSetting("Platform:FitEngineV2Enabled", v2 ? "true" : "false");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static string Mint(string sub)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}
