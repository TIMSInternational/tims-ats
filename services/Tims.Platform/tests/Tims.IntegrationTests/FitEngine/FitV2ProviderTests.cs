using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tims.Infrastructure.Assessments.Providers;
using Tims.IntegrationTests.Assessments;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// FIT v2 × the TIMS Assessments provider connector, end to end: the real host, real Postgres (RLS on, app_tenant),
/// the FIT-engine tables of <see cref="FitEngineFixture"/> AND the four provider tables created by the ACTUAL migration
/// <c>20261107232524_assessment_providers</c>.
/// <list type="bullet">
/// <item>Connector ON: a valid provider LIA percentile and ITC-IA level are scored against the vacancy's minimums, an
/// English gate is judged on the provider's CEFR, each entry names the provider result and its versions; a voided
/// result and a result sat at another time multiplier are needs review and held apart (reviewPending), never read as
/// low scores; another tenant's newer, higher result for the same candidate and vacancy ids is never read.</item>
/// <item>Connector OFF: the same stored provider results do not feed FIT (the adapter is not composed), so each provider
/// instrument shows as no_result.</item>
/// </list>
/// The connector-off case WITHOUT the provider tables (production before the migration) is <see cref="FitV2Tests"/>:
/// its fixture has no provider tables and every v2 compute there must still succeed.
/// </summary>
[Collection("FitV2Provider")]
public sealed class FitV2ProviderTests(FitV2ProviderFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-v2-provider-test-key" };

    private readonly FitV2ProviderFixture _fixture = fixture;

    [Fact]
    public async Task ConnectorOn_ProviderResultsFeedFitV2_PerInstrument()
    {
        await ComputeAsync(providers: true);

        var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
        Assert.Equal(2, scored.Breakdown["fitVersion"]!.GetValue<int>());
        Assert.Equal(58, scored.Breakdown["assessment"]!.GetValue<double>()); // (LIA 75 + ITC-IA 40) / 2 = 57.5 → 58
        Assert.False(scored.Breakdown["reviewPending"]!.GetValue<bool>());

        var lia = Entry(scored.Breakdown, "lia");
        Assert.Equal("completed", lia["status"]!.GetValue<string>());
        Assert.Equal(75, lia["score"]!.GetValue<double>()); // percentile 30 vs min 40 — NOT the other tenant's 99
        Assert.Equal("provider", lia["source"]!.GetValue<string>());
        Assert.Equal(FitV2ProviderFixture.ResultLia.ToString(), lia["resultId"]!.GetValue<string>());
        Assert.Equal("lia-2026.11.1", lia["contentVersion"]!.GetValue<string>());
        Assert.Equal("lia-norms-2026.1", lia["normVersion"]!.GetValue<string>());

        var itcia = Entry(scored.Breakdown, "itcia");
        Assert.Equal("completed", itcia["status"]!.GetValue<string>());
        Assert.Equal(40, itcia["score"]!.GetValue<double>()); // level 2 below the required 3 → round(2 / 5 × 100)

        var english = Entry(scored.Breakdown, "english");
        Assert.Equal("met", english["gate"]!.GetValue<string>()); // C1 ≥ B2
        Assert.Equal("completed", english["status"]!.GetValue<string>());

        var review = await ReadBreakdownAsync(FitV2ProviderFixture.CandReview);
        Assert.Null(review.Breakdown["assessment"]); // both scored results are held apart, never read as 0
        Assert.True(review.Breakdown["reviewPending"]!.GetValue<bool>());
        Assert.True(review.IsPartial);
        var voided = Entry(review.Breakdown, "lia");
        Assert.Equal("needs_review", voided["status"]!.GetValue<string>());
        Assert.Null(voided["score"]);
        Assert.Equal(FitV2ProviderFixture.ResultLiaVoided.ToString(), voided["resultId"]!.GetValue<string>());
        var otherMultiplier = Entry(review.Breakdown, "itcia");
        Assert.Equal("needs_review", otherMultiplier["status"]!.GetValue<string>()); // assigned at 1.5, sat at 1
        Assert.Null(otherMultiplier["score"]);
        var noEnglish = Entry(review.Breakdown, "english");
        Assert.Equal("no_result", noEnglish["status"]!.GetValue<string>());
        Assert.Equal("unknown", noEnglish["gate"]!.GetValue<string>());
    }

    [Fact]
    public async Task ConnectorOff_TheSameStoredResultsDoNotFeedFit()
    {
        await ComputeAsync(providers: false);

        var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
        Assert.Equal(2, scored.Breakdown["fitVersion"]!.GetValue<int>());
        Assert.Null(scored.Breakdown["assessment"]);
        Assert.False(scored.Breakdown["reviewPending"]!.GetValue<bool>());
        foreach (var instrument in new[] { "lia", "itcia", "english" })
        {
            var entry = Entry(scored.Breakdown, instrument);
            Assert.Equal("no_result", entry["status"]!.GetValue<string>());
            Assert.Null(entry["resultId"]);
        }

        Assert.Equal("unknown", Entry(scored.Breakdown, "english")["gate"]!.GetValue<string>());
    }

    // The #312 cascade's scheduled retry is registered with the connector and only with it (its tables exist only then).
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_withdrawal_sweep_is_registered_only_with_the_connector_on(bool providers)
    {
        await using var factory = Factory(providers);

        var hosted = factory.Services.GetServices<IHostedService>();

        Assert.Equal(providers, hosted.Any(h => h is Tims.Api.Assessments.ProviderWithdrawalSweepHostedService));
    }

    // D17: the polling fallback is registered with the connector and only with it, like the sweep.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_attempt_poller_is_registered_only_with_the_connector_on(bool providers)
    {
        await using var factory = Factory(providers);

        var hosted = factory.Services.GetServices<IHostedService>();

        Assert.Equal(providers, hosted.Any(h => h is Tims.Api.Assessments.ProviderAttemptPollHostedService));
    }

    private static JsonNode Entry(JsonNode breakdown, string instrument) =>
        Assert.Single(breakdown["assessments"]!.AsArray(), e => e!["instrument"]!.GetValue<string>() == instrument)!;

    private async Task<(JsonNode Breakdown, bool IsPartial)> ReadBreakdownAsync(Guid candidateId)
    {
        var row = await _fixture.Fit.GetFitScoreAsync(candidateId, FitV2ProviderFixture.VacProvider);
        Assert.NotNull(row);
        return (JsonNode.Parse(row.Breakdown)!, row.IsPartial);
    }

    private async Task ComputeAsync(bool providers)
    {
        await using var factory = Factory(providers);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(
            HttpMethod.Post, $"/fit-engine/vacancies/{FitV2ProviderFixture.VacProvider}/compute");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":2}", await response.Content.ReadAsStringAsync());
    }

    private WebApplicationFactory<Program> Factory(bool providers) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.Fit.ConnectionString);
            builder.UseSetting("Platform:FitEngineWriteEnabled", "true");
            builder.UseSetting("Platform:FitEngineV2Enabled", "true");
            builder.UseSetting("Platform:AssessmentProvidersEnabled", providers ? "true" : "false");
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

/// <summary>
/// A <see cref="FitEngineFixture"/> database (its own container) plus the provider migration applied on top, in the
/// production privilege shape (<c>anon</c>/<c>authenticated</c> exist, so the migration's REVOKEs run), and a seed of
/// one vacancy that lists three provider instruments, two candidates, and their provider attempts and results.
/// </summary>
public sealed class FitV2ProviderFixture : IAsyncLifetime
{
    public static readonly Guid VacProvider = Guid.Parse("7ac00000-0000-0000-0000-0000000000fa");
    public static readonly Guid CandScored = Guid.Parse("ca000000-0000-0000-0000-0000000000fa");
    public static readonly Guid CandReview = Guid.Parse("ca000000-0000-0000-0000-0000000000fb");
    public static readonly Guid ResultLia = Guid.Parse("d0000000-0000-4000-8000-0000000000a1");
    public static readonly Guid ResultLiaVoided = Guid.Parse("d0000000-0000-4000-8000-0000000000b1");

    public FitEngineFixture Fit { get; } = new();

    public async Task InitializeAsync()
    {
        await Fit.InitializeAsync();
        await ExecuteAsync(ProviderTestDatabase.CreateRolesSql);
        await using (var db = new AssessmentProviderDbContext(
            new DbContextOptionsBuilder<AssessmentProviderDbContext>().UseNpgsql(Fit.ConnectionString).Options))
        {
            await db.Database.MigrateAsync();
        }

        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => Fit.DisposeAsync();

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Fit.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    // OrgA = 1111…, OrgB = 2222…, OrgAdmin = c000…0001 (FitEngineFixture). Provider result ids: d000…a* (scored
    // candidate), d000…b* (review candidate), d000…c1 (OrgB's row for the SAME candidate and vacancy ids, assigned
    // later and scoring higher, so reading it would change the asserted LIA entry).
    private const string SeedSql =
        """
        INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
          ('7ac00000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'FIT v2 provider', NULL, NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
        INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
          ('9f000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-0000000000fa',
           '{"minYearsExperience":2,"assessments":[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"análisis de datos"},{"instrument":"itcia","use":"scored","min":{"level":3},"reason":"uso de IA"},{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"clientes"}]}');
        INSERT INTO candidates (id, organization_id, email, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
          ('ca000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'prov-scored@fit.test', 'Paz', 'Scored', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-0000000000fb', '11111111-1111-1111-1111-111111111111', 'prov-review@fit.test', 'Rui', 'Review', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
        INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
          ('ab000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'active'),
          ('ab000000-0000-0000-0000-0000000000fb', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'active');

        INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale) VALUES
          ('b0000000-0000-4000-8000-0000000000a0', '11111111-1111-1111-1111-111111111111', 'tims-assessments', 'b0000000-0000-4000-8000-0000000000a1', ARRAY['lia','english','itcia'], 'es'),
          ('b0000000-0000-4000-8000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'tims-assessments', 'b0000000-0000-4000-8000-0000000000b1', ARRAY['lia'], 'es');

        INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
            purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
            instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES
          ('e0000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'result_ready',
           'selection', 'análisis de datos', 'es', 1.5, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'itcia', 'result_ready',
           'selection', 'uso de IA', 'es', 1, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a2', '1.0', 'itcia-2026.11.1', 'd0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'english', 'result_ready',
           'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a3', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000a3', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'voided',
           'selection', 'análisis de datos', 'es', 1, 'f0000000-0000-4000-8000-0000000000b1', 'aa000000-0000-4000-8000-0000000000b1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'itcia', 'result_ready',
           'selection', 'uso de IA', 'es', 1.5, 'f0000000-0000-4000-8000-0000000000b1', 'aa000000-0000-4000-8000-0000000000b2', '1.0', 'itcia-2026.11.1', 'd0000000-0000-4000-8000-0000000000b2', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-4000-8000-0000000000b0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'result_ready',
           'selection', 'análisis de datos', 'es', 1, 'f0000000-0000-4000-8000-0000000000c1', 'aa000000-0000-4000-8000-0000000000c1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', '2026-11-05 09:00:00+00');

        INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
            result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
            scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied,
            rendered_for, rendered_level, completed_at, scored_at) VALUES
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 1,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('a', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 30, NULL, NULL, 1.5,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a2', 1,
           'ItciaResultV1', 'itcia', '1.0', 'itcia-2026.11.1', repeat('b', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, NULL, 2, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000a3', 1,
           'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('c', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000b1', 2,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('d', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'voided', 'complete', 88, NULL, NULL, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-0000000000b2', 1,
           'ItciaResultV1', 'itcia', '1.0', 'itcia-2026.11.1', repeat('e', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, NULL, 5, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'e0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000c1', 1,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('f', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 99, NULL, NULL, 1,
           'tenant_hr', 'full', '2026-11-06 10:00:00+00', '2026-11-06 10:00:05+00');
        """;
}

[CollectionDefinition("FitV2Provider")]
public sealed class FitV2ProviderCollection : ICollectionFixture<FitV2ProviderFixture>;
