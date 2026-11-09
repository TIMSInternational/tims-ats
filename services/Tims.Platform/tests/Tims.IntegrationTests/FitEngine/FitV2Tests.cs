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
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// FIT v2 against real Postgres (RLS on, app_tenant) and the real host:
///   the ATS native-quiz adapter — only assignments WITH a result, integrity from status + proctoring severity +
///     breakdown.pendingManual (a mixed choice/essay result awaiting manual grading is needs review),
///     an OrgB-stamped row for the same candidate/vacancy ids never returned, completedAt re-kinded UTC;
///   the provider connector OFF (this fixture has no provider tables, as production before migration
///     20261107232524): every v2 compute below runs without them, so the provider adapter must not be composed;
///     FitV2ProviderTests covers the connector ON;
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

        // Both attempts are the same quiz, so only its most recent result is read (slice "fit": the latest result of
        // EACH quiz is picked in SQL): the older clean attempt never stands in for the newer flagged one.
        Assert.Equal([FitEngineFixture.AsgV2FlaggedNew.ToString()], results.Select(r => r.ResultId).ToArray());
        var newest = results[0];
        Assert.Equal(ResultIntegrity.NeedsReview, newest.Integrity);
        Assert.Equal(90, newest.NormalizedScore);
        Assert.Equal(new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero), newest.CompletedAt);
        Assert.Equal("0e000000-0000-0000-0000-000000000001", newest.Variant); // the quiz (assessment_type_id)
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

        // One quiz: the dated valid attempt is its latest (a NULL completed_at sorts last, in SQL as in the kernel), so
        // the cancelled, undated one is not read. (Cancelled = needs review is pinned by the integrity-rule theory.)
        Assert.Equal([FitEngineFixture.AsgV2Valid.ToString()], results.Select(r => r.ResultId).ToArray());
        Assert.Equal(ResultIntegrity.Valid, results[0].Integrity); // 'low' session, pendingManual [] — not blocked
        Assert.Equal(75, results[0].NormalizedScore);
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

    // ── the concurrent-recompute race (Codex round 6 [P1]) ──
    [Fact]
    public async Task Race_StaleComputeWhoseLaterReadFails_NeverLeavesACleanScore_OverANewerNeedsReview()
    {
        // Codex's reproduction, deterministically: compute A reads a valid result; the assignment is cancelled; compute
        // B runs; A then writes, and any read A makes after that fails. Before the fix A's read sat outside the write,
        // B finished first and A's stale clean 80 overwrote B's needs_review, and A's failed check left it there. Now
        // A reads inside the locked write, so B waits for A's commit and then reads the cancel: needs_review stands.
        await _fixture.ExecuteScalarAsync(
            "UPDATE assessment_assignments SET status = 'completed' WHERE id = @a", ("a", FitEngineFixture.AsgV2Race));
        await _fixture.ExecuteScalarAsync(
            "DELETE FROM fit_scores WHERE candidate_id = @c", ("c", FitEngineFixture.CandV2Race));
        var now = new DateTimeOffset(2026, 11, 8, 12, 0, 0, TimeSpan.Zero);

        await using var dbA = _fixture.NewWriteContext();
        await using var dbB = _fixture.NewWriteContext();
        var gated = new GatedSource(new AtsAssessmentResultSource(dbA));
        var computeA = new FitEngineWriteUseCase(new FitEngineWriteRepository(dbA), gated);
        var computeB = new FitEngineWriteUseCase(
            new FitEngineWriteRepository(dbB), new AtsAssessmentResultSource(dbB));

        var taskA = Task.Run(() => computeA.ComputeForVacancyAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacFitV2Race, now, fitV2Enabled: true, CancellationToken.None));
        await gated.FirstReadDone.Task.WaitAsync(TimeSpan.FromSeconds(30));

        await _fixture.ExecuteScalarAsync(
            "UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", FitEngineFixture.AsgV2Race));
        var taskB = Task.Run(() => computeB.ComputeForVacancyAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacFitV2Race, now, fitV2Enabled: true, CancellationToken.None));

        // Let B run as far as it can: to the end (no lock held by A), or until it waits on A's advisory lock.
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!taskB.IsCompleted && DateTime.UtcNow < deadline)
        {
            var waiting = (long)(await _fixture.ExecuteScalarAsync(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"))!;
            if (waiting > 0)
            {
                break;
            }

            await Task.Delay(25);
        }

        gated.Release.SetResult();
        try
        {
            await taskA;
        }
        catch (InvalidOperationException)
        {
            // the pre-fix path: A's post-write check read fails (that is the scenario under test)
        }

        await taskB;

        var row = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Race, FitEngineFixture.VacFitV2Race);
        Assert.NotNull(row);
        var breakdown = JsonNode.Parse(row.Breakdown)!;
        Assert.True(breakdown["reviewPending"]!.GetValue<bool>());
        Assert.True(row.IsPartial);
        Assert.Null(breakdown["assessment"]);
        Assert.Equal("needs_review", breakdown["assessments"]![0]!["status"]!.GetValue<string>());
        Assert.Equal(1, gated.Calls); // A read once, inside its write
    }

    [Fact]
    public async Task InLockReadFails_TheTransactionRollsBack_TheStoredRowIsUntouched()
    {
        await _fixture.ExecuteScalarAsync(
            "UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", FitEngineFixture.AsgV2Race));
        await _fixture.ExecuteScalarAsync(
            "DELETE FROM fit_scores WHERE candidate_id = @c", ("c", FitEngineFixture.CandV2Race));
        var now = new DateTimeOffset(2026, 11, 8, 12, 0, 0, TimeSpan.Zero);

        await using (var db = _fixture.NewWriteContext())
        {
            await new FitEngineWriteUseCase(new FitEngineWriteRepository(db), new AtsAssessmentResultSource(db))
                .ComputeForVacancyAsync(
                    FitEngineFixture.OrgA, FitEngineFixture.VacFitV2Race, now, fitV2Enabled: true, CancellationToken.None);
        }

        var before = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Race, FitEngineFixture.VacFitV2Race);
        Assert.NotNull(before);
        Assert.True(JsonNode.Parse(before.Breakdown)!["reviewPending"]!.GetValue<bool>());

        // The assessment is reinstated, and the next compute's in-lock read is cancelled after it has read it.
        await _fixture.ExecuteScalarAsync(
            "UPDATE assessment_assignments SET status = 'completed' WHERE id = @a", ("a", FitEngineFixture.AsgV2Race));
        using var cts = new CancellationTokenSource();
        await using (var db = _fixture.NewWriteContext())
        {
            var cancelling = new CancelAfterReadSource(new AtsAssessmentResultSource(db), cts);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                new FitEngineWriteUseCase(new FitEngineWriteRepository(db), cancelling).ComputeForVacancyAsync(
                    FitEngineFixture.OrgA, FitEngineFixture.VacFitV2Race, now.AddMinutes(1), fitV2Enabled: true,
                    cts.Token));
        }

        var after = await _fixture.GetFitScoreAsync(FitEngineFixture.CandV2Race, FitEngineFixture.VacFitV2Race);
        Assert.NotNull(after);
        Assert.Equal(before.Breakdown, after.Breakdown);
        Assert.Equal(before.UpdatedAt, after.UpdatedAt);
        Assert.Equal(0, (long)(await _fixture.ExecuteScalarAsync(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'"))!);
    }

    // Lets the first read through, then holds the caller until released; every later read fails.
    private sealed class GatedSource(IAssessmentResultSource inner) : IAssessmentResultSource
    {
        public TaskCompletionSource FirstReadDone { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Calls { get; private set; }

        public async Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
        {
            Calls++;
            if (Calls > 1)
            {
                throw new InvalidOperationException("the post-write read failed");
            }

            var results = await inner.GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken);
            FirstReadDone.SetResult();
            await Release.Task;
            return results;
        }
    }

    // Reads for real, then cancels the compute's token before returning.
    private sealed class CancelAfterReadSource(IAssessmentResultSource inner, CancellationTokenSource cts)
        : IAssessmentResultSource
    {
        public async Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
        {
            var results = await inner.GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken);
            await cts.CancelAsync();
            cancellationToken.ThrowIfCancellationRequested();
            return results;
        }
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
