using System.Collections.Concurrent;
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
using Tims.Application.Assessments.Providers;
using Tims.Application.CandidateConsent;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-5 route matrix over the REAL host + real Postgres (RLS forced, app_tenant), with a fake provider in place of
/// the remote TIMS Assessments API. Pins what lives only in the endpoints: the dark flag, the staff gate (401/403),
/// the vacancy scope probe (narrow scope and cross-org → 404, nothing written) on assign and cancel, the platform-owner
/// gate on bindings, the launch's identity checks (sub must equal the confirmed identity, unconfirmed email, autoconfirm
/// fail-closed) and the webhook's raw-body cap.
/// </summary>
[Collection("AssessmentProviderEndpoints")]
public sealed class ProviderEndpointTests(ProviderEndpointFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Assign = "/assessments/provider-assignments";
    private const string Bindings = "/platform/assessment-providers/bindings";
    private const string Webhook = "/webhooks/tims-assessments";
    private const string WebhookSecret = "whsec_endpoint_test_value";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "assessment-provider-endpoint-test-key" };

    private static string Cancel(Guid attempt) => $"{Assign}/{attempt}/cancel";

    private static string Launch(Guid attempt) => $"/portal/assessment-attempts/{attempt}/launch";

    private WebApplicationFactory<Program> Factory(
        bool enabled = true, FakeProvider? provider = null, FakeIdentities? identities = null, bool requiresConfirmation = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:AssessmentProvidersEnabled", enabled ? "true" : "false");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
                services.RemoveAll<IAssessmentProvider>();
                services.AddSingleton<IAssessmentProvider>(provider ?? new FakeProvider());
                services.RemoveAll<IInvitationIdentityProvider>();
                services.AddSingleton<IInvitationIdentityProvider>(identities ?? new FakeIdentities());
                services.RemoveAll<IAuthSettingsProbe>();
                services.AddSingleton<IAuthSettingsProbe>(new FakeAuthSettings(requiresConfirmation));
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

    private static Task<HttpResponseMessage> Send(HttpClient client, string path, object? body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (body is string raw)
        {
            request.Content = new StringContent(raw, Encoding.UTF8, "application/json");
        }
        else if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return client.SendAsync(request);
    }

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static object AssignBody(Guid candidate, Guid vacancy, decimal multiplier = 1.5m) => new
    {
        candidateId = candidate,
        vacancyId = vacancy,
        instruments = new[] { new { instrument = "lia" } },
        timeMultiplier = multiplier,
        aids = new[] { "extended_breaks" },
    };

    private Task<object?> AttemptCount(Guid candidate) =>
        fixture.ScalarAsync($"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'");

    private Task<object?> State(Guid attempt) =>
        fixture.ScalarAsync($"SELECT state FROM assessment_provider_attempts WHERE id = '{attempt}'");

    // ── Dark flag ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DarkFlag_NoRouteIsMapped()
    {
        await using var factory = Factory(enabled: false);
        using var client = factory.CreateClient();
        var admin = Mint(ProviderEndpointFixture.AdminSub);

        var responses = new[]
        {
            await Send(client, Assign, AssignBody(ProviderEndpointFixture.AssignCandidate, ProviderEndpointFixture.VacancyA), admin),
            await Send(client, Cancel(ProviderEndpointFixture.GuardedAttempt), null, admin),
            await Send(client, Bindings, new { organizationId = ProviderEndpointFixture.OrgC, instruments = Array.Empty<string>(), defaultLocale = "es" },
                Mint(ProviderEndpointFixture.OwnerSub)),
            await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, Mint("candidate-dark")),
            await Send(client, Webhook, "{}", null),
            await Send(client, Erasure(ProviderEndpointFixture.AssignCandidate), null, Mint(ProviderEndpointFixture.OwnerSub)),
            await Get(client, Export(ProviderEndpointFixture.AssignCandidate), Mint(ProviderEndpointFixture.OwnerSub)),
            await Get(client, "/portal/assessment-attempts?organizationSlug=org-a", Mint("candidate-dark")),
            await Get(client, $"/portal/assessment-attempts/{ProviderEndpointFixture.LaunchAttempt}/consent-templates?locale=es",
                Mint("candidate-dark")),
        };

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.NotFound, r.StatusCode));
    }

    // ── Assign ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Assign_Admin_Is200_EchoesTheTermsInForce_AndARetryWithOtherTermsIs409()
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var admin = Mint(ProviderEndpointFixture.AdminSub);
        var candidate = ProviderEndpointFixture.TermsCandidate;

        var first = await Send(client, Assign, AssignBody(candidate, ProviderEndpointFixture.VacancyA), admin);
        var corrected = await Send(client, Assign, AssignBody(candidate, ProviderEndpointFixture.VacancyA, multiplier: 2m), admin);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var item = (await ReadJson(first)).GetProperty("items")[0];
        Assert.Equal("created", item.GetProperty("state").GetString());
        Assert.Equal(1.5m, item.GetProperty("timeMultiplier").GetDecimal());
        Assert.Equal("extended_breaks", item.GetProperty("aids")[0].GetString());
        Assert.Equal(HttpStatusCode.Conflict, corrected.StatusCode);
        var conflict = await ReadJson(corrected);
        Assert.Equal("open_attempt_terms_differ", conflict.GetProperty("error").GetString());
        Assert.Equal(item.GetProperty("attemptId").GetString(), conflict.GetProperty("attempt").GetProperty("attemptId").GetString());
        Assert.Equal(1.5m, conflict.GetProperty("attempt").GetProperty("timeMultiplier").GetDecimal());
        Assert.Equal(1L, await AttemptCount(candidate));
        Assert.Single(provider.Created);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(ProviderEndpointFixture.ReaderSub, HttpStatusCode.Forbidden)] // assessment:read only
    [InlineData(ProviderEndpointFixture.OwnSub, HttpStatusCode.NotFound)] // own scope: the vacancy is not theirs
    public async Task Assign_WithoutTheGrantOrTheVacancyInScope_WritesNothing(string? sub, HttpStatusCode expected)
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();

        var response = await Send(client, Assign, AssignBody(ProviderEndpointFixture.ScopeCandidate, ProviderEndpointFixture.VacancyA),
            sub is null ? null : Mint(sub));

        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(0L, await AttemptCount(ProviderEndpointFixture.ScopeCandidate));
        Assert.Empty(provider.Calls);
    }

    [Fact]
    public async Task Assign_AnotherOrgsVacancy_Is404_AndWritesNothing()
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();

        var response = await Send(client, Assign, AssignBody(ProviderEndpointFixture.ScopeCandidate, ProviderEndpointFixture.VacancyB),
            Mint(ProviderEndpointFixture.AdminSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0L, await AttemptCount(ProviderEndpointFixture.ScopeCandidate));
        Assert.Empty(provider.Calls);
    }

    [Fact]
    public async Task Assign_AnonymousWithMalformedBody_Is401_NotA400()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Send(client, Assign, "{not json", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Cancel ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Cancel_Admin_CancelsAtTheProviderThenHere_WithAnAuditRow_AndIsIdempotent()
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var admin = Mint(ProviderEndpointFixture.AdminSub);

        var response = await Send(client, Cancel(ProviderEndpointFixture.CancelAttempt), null, admin);
        var again = await Send(client, Cancel(ProviderEndpointFixture.CancelAttempt), null, admin);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("cancelled", (await ReadJson(response)).GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal("cancelled", await State(ProviderEndpointFixture.CancelAttempt));
        Assert.Single(provider.CancelledAssignments); // the repeat sends nothing more
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE entity_id = '{ProviderEndpointFixture.CancelAttempt}' AND action = 'assessment_provider_attempt_cancelled' AND actor_id = '{ProviderEndpointFixture.AdminId}'"));
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(ProviderEndpointFixture.ReaderSub, HttpStatusCode.Forbidden)] // needs assessment:update
    [InlineData(ProviderEndpointFixture.OwnSub, HttpStatusCode.NotFound)] // the attempt's vacancy is out of scope
    [InlineData(ProviderEndpointFixture.OrgBSub, HttpStatusCode.NotFound)] // another org's attempt
    public async Task Cancel_WithoutTheGrantOrTheAttemptInScope_ChangesNothing(string? sub, HttpStatusCode expected)
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();

        var response = await Send(client, Cancel(ProviderEndpointFixture.GuardedAttempt), null, sub is null ? null : Mint(sub));

        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("created", await State(ProviderEndpointFixture.GuardedAttempt));
        Assert.Empty(provider.Calls);
    }

    [Fact]
    public async Task Cancel_AnotherOrgsAttemptOrAnUnknownId_IsTheSame404()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var admin = Mint(ProviderEndpointFixture.AdminSub);

        var foreign = await Send(client, Cancel(ProviderEndpointFixture.OrgBAttempt), null, admin);
        var unknown = await Send(client, Cancel(Guid.NewGuid()), null, admin);

        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(await foreign.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.Equal("created", await State(ProviderEndpointFixture.OrgBAttempt));
    }

    // ── Bindings (platform owner) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(ProviderEndpointFixture.AdminSub, HttpStatusCode.Forbidden)] // an org admin is not the platform owner
    public async Task Bindings_OnlyThePlatformOwner(string? sub, HttpStatusCode expected)
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();

        // OrgA is bound to TenantA with lia + english: the refused request would re-point it.
        var response = await Send(client, Bindings,
            new { organizationId = ProviderEndpointFixture.OrgA, instruments = new[] { "lia", "english", "itcia" }, defaultLocale = "en" },
            sub is null ? null : Mint(sub));

        Assert.Equal(expected, response.StatusCode);
        Assert.Empty(provider.Calls);
        Assert.Equal("lia,english|es", await fixture.ScalarAsync(
            $"SELECT array_to_string(enabled_instruments, ',') || '|' || default_locale FROM assessment_provider_bindings WHERE organization_id = '{ProviderEndpointFixture.OrgA}'"));
    }

    [Fact]
    public async Task Bindings_ThePlatformOwnerBindsAnOrg()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Send(client, Bindings,
            new { organizationId = ProviderEndpointFixture.OrgC, instruments = new[] { "lia" }, defaultLocale = "es" },
            Mint(ProviderEndpointFixture.OwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("lia", await fixture.ScalarAsync(
            $"SELECT array_to_string(enabled_instruments, ',') FROM assessment_provider_bindings WHERE organization_id = '{ProviderEndpointFixture.OrgC}'"));
    }

    // ── DSAR export and erasure (platform owner, D15) ────────────────────────────────────

    private static string SubjectRights(Guid candidate) =>
        $"/platform/assessment-providers/organizations/{ProviderEndpointFixture.OrgA}/candidates/{candidate}";

    private static string Export(Guid candidate) => SubjectRights(candidate) + "/export";

    private static string Erasure(Guid candidate) => SubjectRights(candidate) + "/erasure";

    private static Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return client.SendAsync(request);
    }

    private async Task<(Guid Candidate, Guid Subject)> SubjectWithAttemptAsync()
    {
        var candidate = Guid.NewGuid();
        var subject = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
             VALUES ('{candidate}', '{ProviderEndpointFixture.OrgA}', 'Dee', 'Sar', '{candidate}@a.example');
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 instrument_version, content_version, assigned_by_id)
             SELECT gen_random_uuid(), organization_id, id, '{candidate}', '{ProviderEndpointFixture.VacancyA}', 'lia', 'completed',
                 'selection', 'Análisis de datos', 'es', 1, '{subject}', gen_random_uuid(), '1.0', 'content-1', gen_random_uuid()
               FROM assessment_provider_bindings WHERE organization_id = '{ProviderEndpointFixture.OrgA}';
             """);
        return (candidate, subject);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(ProviderEndpointFixture.AdminSub, HttpStatusCode.Forbidden)] // an org admin is not the platform owner
    public async Task SubjectRights_OnlyThePlatformOwner(string? sub, HttpStatusCode expected)
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var (candidate, _) = await SubjectWithAttemptAsync();
        var token = sub is null ? null : Mint(sub);

        var erasure = await Send(client, Erasure(candidate), null, token);
        var export = await Get(client, Export(candidate), token);

        Assert.Equal(expected, erasure.StatusCode);
        Assert.Equal(expected, export.StatusCode);
        Assert.Empty(provider.Calls);
        Assert.Equal(0L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}' AND provider_erasure_requested_at IS NOT NULL"));
    }

    [Fact]
    public async Task SubjectRights_TheOwnerExportsThenErasesEveryProviderSubject()
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var (candidate, subject) = await SubjectWithAttemptAsync();
        var owner = Mint(ProviderEndpointFixture.OwnerSub);

        var export = await Get(client, Export(candidate), owner);
        var erasure = await Send(client, Erasure(candidate), null, owner);
        var unknown = await Send(client, Erasure(Guid.NewGuid()), null, owner);

        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal("no-store", export.Headers.CacheControl?.ToString());
        var exported = await ReadJson(export);
        Assert.Equal("lia", exported.GetProperty("attempts")[0].GetProperty("instrument").GetString());
        // D15 access includes what the provider holds: its own export for the recorded subject and the resolved one.
        var held = exported.GetProperty("providerExports");
        Assert.Equal(2, held.GetArrayLength());
        Assert.Contains(held.EnumerateArray(), h => h.GetProperty("subjectId").GetGuid() == subject
            && h.GetProperty("status").GetString() == "exported"
            && h.GetProperty("export").GetProperty("subject").GetProperty("subject_id").GetGuid() == subject);
        Assert.Equal(HttpStatusCode.Accepted, erasure.StatusCode);
        // The recorded subject, plus the one the provider resolves for (tenant, candidate id) (this fake mints a new id).
        Assert.Equal(2, provider.ErasedSubjects.Count);
        Assert.Contains(subject, provider.ErasedSubjects);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_attempts WHERE candidate_id = '{candidate}' AND provider_erasure_requested_at IS NOT NULL"));
    }

    // ── Launch (the candidate, by confirmed email) ──────────────────────────────────────

    [Fact]
    public async Task Launch_ConfirmedEmailOfTheAttemptsCandidate_GetsTheHostedPlayerUrlInANoStoreBody()
    {
        const string sub = "candidate-luz";
        var identities = new FakeIdentities();
        var token = Mint(sub);
        identities.Confirmed[token] = new SetupIdentity(sub, "LUZ@a.example");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();

        var response = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var json = await ReadJson(response);
        Assert.Equal(FakeProvider.PlayerUrl, json.GetProperty("hostedUrl").GetString());
        Assert.Equal("https://ats.test", json.GetProperty("frameAncestors")[0].GetString());
        Assert.False(json.TryGetProperty("candidateToken", out _)); // D16: no candidate token exists on this path
    }

    // ── Portal reads (the candidate, by confirmed email; D16) ────────────────────────────

    [Fact]
    public async Task Portal_TheCandidateListsOnlyTheirOwnAttempts_WithACoarseStatusAndNoScores()
    {
        const string sub = "candidate-luz-list";
        var identities = new FakeIdentities();
        var token = Mint(sub);
        identities.Confirmed[token] = new SetupIdentity(sub, " Luz@A.example ");
        var stranger = Mint("candidate-stranger");
        identities.Confirmed[stranger] = new SetupIdentity("candidate-stranger", "nobody@a.example");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();

        var mine = await Get(client, "/portal/assessment-attempts?organizationSlug=org-a", token);
        var theirs = await Get(client, "/portal/assessment-attempts?organizationSlug=org-a", stranger);
        var otherOrg = await Get(client, "/portal/assessment-attempts?organizationSlug=org-b", token);
        var unknown = await Get(client, "/portal/assessment-attempts?organizationSlug=no-such-org", token);

        Assert.Equal(HttpStatusCode.OK, mine.StatusCode);
        Assert.Equal("no-store", mine.Headers.CacheControl?.ToString());
        var attempt = Assert.Single((await ReadJson(mine)).GetProperty("attempts").EnumerateArray());
        Assert.Equal(ProviderEndpointFixture.LaunchAttempt, attempt.GetProperty("attemptId").GetGuid());
        Assert.Equal("lia", attempt.GetProperty("instrument").GetString());
        Assert.Equal("native", attempt.GetProperty("delivery").GetString());
        Assert.Contains(attempt.GetProperty("status").GetString(), new[] { "ready", "consent_needed", "in_progress" });
        Assert.False(attempt.TryGetProperty("providerAssignmentId", out _));
        Assert.Empty((await ReadJson(theirs)).GetProperty("attempts").EnumerateArray());
        Assert.Empty((await ReadJson(otherOrg)).GetProperty("attempts").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task Portal_ConsentTemplates_AreServedOnlyForTheCandidatesAttemptThatNeedsConsent()
    {
        const string sub = "candidate-luz-templates";
        var identities = new FakeIdentities();
        var token = Mint(sub);
        identities.Confirmed[token] = new SetupIdentity(sub, ProviderEndpointFixture.LaunchEmail);
        var stranger = Mint("candidate-stranger-2");
        identities.Confirmed[stranger] = new SetupIdentity("candidate-stranger-2", "nobody@a.example");
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider, identities: identities);
        using var client = factory.CreateClient();
        var path = $"/portal/assessment-attempts/{ProviderEndpointFixture.LaunchAttempt}/consent-templates?locale=en";
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET missing_consents = ARRAY['assessment'] WHERE id = '{ProviderEndpointFixture.LaunchAttempt}'");
        try
        {
            var templates = await Get(client, path, token);
            var foreign = await Get(client, path, stranger);
            var badLocale = await Get(client, path.Replace("locale=en", "locale=fr", StringComparison.Ordinal), token);

            Assert.Equal(HttpStatusCode.OK, templates.StatusCode);
            var template = Assert.Single((await ReadJson(templates)).GetProperty("templates").EnumerateArray());
            Assert.Equal(("assessment", "en"), (template.GetProperty("purpose").GetString(), template.GetProperty("locale").GetString()));
            Assert.Equal("assessment-v1", template.GetProperty("textVersion").GetString());
            Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, badLocale.StatusCode);
        }
        finally
        {
            await fixture.ExecuteAsync(
                $"UPDATE assessment_provider_attempts SET missing_consents = '{{}}' WHERE id = '{ProviderEndpointFixture.LaunchAttempt}'");
        }

        // Nothing left to consent to: the same 404 as a stranger's attempt.
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, path, token)).StatusCode);
    }

    [Fact]
    public async Task Portal_AnUnconfirmedOrForeignIdentity_GetsNothing()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-x");
        identities.Confirmed[token] = new SetupIdentity("candidate-y", ProviderEndpointFixture.LaunchEmail);
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();

        var mismatched = await Get(client, "/portal/assessment-attempts?organizationSlug=org-a", token);
        var anonymous = await Get(client, "/portal/assessment-attempts?organizationSlug=org-a", null);

        Assert.Equal(HttpStatusCode.Forbidden, mismatched.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    [Fact]
    public async Task Launch_AnIdentityForAnotherSubject_Is403()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-a");
        identities.Confirmed[token] = new SetupIdentity("candidate-b", ProviderEndpointFixture.LaunchEmail);
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider, identities: identities);
        using var client = factory.CreateClient();

        var response = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(provider.Calls);
    }

    [Fact]
    public async Task Launch_AnUnconfirmedEmail_Is403()
    {
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider, identities: new FakeIdentities()); // no confirmed identity
        using var client = factory.CreateClient();

        var response = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, Mint("candidate-unconfirmed"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("email_not_verified", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Empty(provider.Calls);
    }

    [Fact]
    public async Task Launch_WithAutoconfirmOn_Is503_BeforeTheIdentityIsEvenAsked()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-auto");
        identities.Confirmed[token] = new SetupIdentity("candidate-auto", ProviderEndpointFixture.LaunchEmail);
        await using var factory = Factory(identities: identities, requiresConfirmation: false);
        using var client = factory.CreateClient();

        var response = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, token);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(0, identities.VerifyCalls);
    }

    [Fact]
    public async Task Launch_AnotherEmailOrNoToken_IsNotFoundOr401()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-other");
        identities.Confirmed[token] = new SetupIdentity("candidate-other", "someone@a.example");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();

        var other = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, token);
        var anonymous = await Send(client, Launch(ProviderEndpointFixture.LaunchAttempt), null, null);

        Assert.Equal(HttpStatusCode.NotFound, other.StatusCode); // never 403: no oracle on attempt ids
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    // ── Webhook ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Webhook_ASignedEventIsAccepted_AndABodyOverTheCapIsRejectedUnread()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var eventId = Guid.NewGuid();
        var body = $$"""{"event_id":"{{eventId}}","event_type":"subject.erased","event_version":1,"occurred_at":"2026-11-09T14:38:06Z","producer":"tims-assessments","tenant_id":"{{ProviderEndpointFixture.TenantA}}","data":{"subject_id":"{{Guid.NewGuid()}}" """
            + "}}";

        var signed = await SendWebhook(client, Encoding.UTF8.GetBytes(body), eventId, "subject.erased");
        var oversized = Encoding.UTF8.GetBytes(body + new string(' ', ProviderWebhookUseCase.MaxBodyBytes));
        var tooLarge = await SendWebhook(client, oversized, eventId, "subject.erased");

        Assert.Equal(HttpStatusCode.OK, signed.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLarge.StatusCode);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM assessment_provider_webhook_inbox WHERE event_id = '{eventId}'"));
    }

    private static Task<HttpResponseMessage> SendWebhook(HttpClient client, byte[] body, Guid eventId, string type)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Webhook) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new("application/json");
        request.Headers.Add(WebhookSignature.HeaderName,
            WebhookSignature.BuildHeader(WebhookSecret, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), body));
        request.Headers.Add("TIMS-Event-Id", eventId.ToString());
        request.Headers.Add("TIMS-Event-Type", type);
        return client.SendAsync(request);
    }

    /// <summary>The remote TIMS Assessments API, faked: canned success answers and a record of every call.</summary>
    private sealed class FakeProvider : IAssessmentProvider
    {
        public const string PlayerUrl = "https://player.test/launch/single-use-code";

        public ConcurrentQueue<string> Calls { get; } = new();

        public ConcurrentQueue<Guid> Created { get; } = new();

        public ConcurrentQueue<Guid> CancelledAssignments { get; } = new();

        public bool IsConfigured => true;

        public Task<ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>> ListInstrumentsAsync(CancellationToken cancellationToken)
        {
            Calls.Enqueue("catalog");
            IReadOnlyList<ProviderCatalogInstrument> catalog = ProviderInstruments.All
                .Select(i => new ProviderCatalogInstrument(i, [new ProviderCatalogVersion("1.0", "ga", "native", true, ["es"], ["assessment"])]))
                .ToList();
            return Task.FromResult(ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>.Success(catalog));
        }

        public Task<ProviderCall<ProviderTenant>> EnsureTenantAsync(
            ProviderTenantRequest request, string idempotencyKey, CancellationToken cancellationToken)
        {
            Calls.Enqueue("tenant");
            return Task.FromResult(ProviderCall<ProviderTenant>.Success(new ProviderTenant(Guid.NewGuid(), request.ExternalOrgRef, "active")));
        }

        public Task<ProviderCall<ProviderSubject>> EnsureSubjectAsync(
            ProviderSubjectRequest request, string idempotencyKey, CancellationToken cancellationToken)
        {
            Calls.Enqueue("subject");
            return Task.FromResult(ProviderCall<ProviderSubject>.Success(new ProviderSubject(Guid.NewGuid(), "active")));
        }

        public ConcurrentQueue<Guid> ErasedSubjects { get; } = new();

        public Task<ProviderCall<ProviderSubject>> UpdateSubjectAsync(
            Guid subjectId, ProviderSubjectUpdate update, CancellationToken cancellationToken)
        {
            Calls.Enqueue("update_subject");
            return Task.FromResult(ProviderCall<ProviderSubject>.Success(new ProviderSubject(subjectId, "active", true)));
        }

        public Task<ProviderCall<ProviderConsentTemplate>> GetConsentTemplateAsync(
            string purpose, string locale, CancellationToken cancellationToken)
        {
            Calls.Enqueue("consent_template");
            return Task.FromResult(ProviderCall<ProviderConsentTemplate>.Success(new ProviderConsentTemplate(
                purpose, purpose + "-v1", locale, "Consentimiento", [new ConsentTextBlock("paragraph", "Texto.")], ["purpose"])));
        }

        public Task<ProviderCall<ProviderHeldExport>> ExportSubjectAsync(Guid subjectId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("export_subject");
            return Task.FromResult(ProviderCall<ProviderHeldExport>.Success(new ProviderHeldExport(subjectId,
                "{\"subject\":{\"subject_id\":\"" + subjectId + "\"},\"generated_at\":\"2026-11-09T14:00:00Z\",\"consents\":[],"
                + "\"assignments\":[],\"sessions\":[],\"results\":[],\"media\":[],\"access_log\":[]}")));
        }

        public Task<ProviderCall<ProviderErasureReceipt>> EraseSubjectAsync(Guid subjectId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("erase_subject");
            ErasedSubjects.Enqueue(subjectId);
            return Task.FromResult(ProviderCall<ProviderErasureReceipt>.Success(new ProviderErasureReceipt(subjectId, "accepted")));
        }

        public Task<ProviderCall<IReadOnlyList<ProviderConsentRecord>>> ListConsentsAsync(
            Guid subjectId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("list_consents");
            return Task.FromResult(ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success([]));
        }

        public Task<ProviderCall<ProviderConsentRecord>> WithdrawConsentAsync(
            Guid subjectId, Guid consentId, DateTimeOffset withdrawnAt, CancellationToken cancellationToken)
        {
            Calls.Enqueue("withdraw_consent");
            return Task.FromResult(ProviderCall<ProviderConsentRecord>.Success(new ProviderConsentRecord(consentId, "assessment", "withdrawn")));
        }

        public Task<ProviderCall<ProviderAssignmentLookup>> FindAssignmentByExternalRefAsync(
            Guid tenantId, string externalRef, CancellationToken cancellationToken)
        {
            Calls.Enqueue("lookup");
            return Task.FromResult(ProviderCall<ProviderAssignmentLookup>.Success(new ProviderAssignmentLookup(null)));
        }

        public Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
            ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken)
        {
            Calls.Enqueue("assignment");
            var id = Guid.NewGuid();
            Created.Enqueue(id);
            return Task.FromResult(ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
                id, request.TenantId, request.SubjectId, request.Instrument, "1.0", "content-1", "created", ["assessment"],
                ["assessment"], DateTimeOffset.UtcNow.AddDays(14), request.ExternalRef)));
        }

        public Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("get_assignment");
            return Task.FromResult(ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(404, "not_found", false, [])));
        }

        public Task<ProviderCall<ProviderAssignment>> CancelAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("cancel");
            CancelledAssignments.Enqueue(assignmentId);
            return Task.FromResult(ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
                assignmentId, ProviderEndpointFixture.TenantA, Guid.NewGuid(), "lia", "1.0", "content-1", "cancelled",
                ["assessment"], [], DateTimeOffset.UtcNow.AddDays(14))));
        }

        public Task<ProviderCall<ProviderConsentRecord>> RecordConsentAsync(
            Guid subjectId, ProviderConsentRequest request, string idempotencyKey, CancellationToken cancellationToken)
        {
            Calls.Enqueue("consent");
            return Task.FromResult(ProviderCall<ProviderConsentRecord>.Success(new ProviderConsentRecord(Guid.NewGuid(), request.Purpose, "active")));
        }

        public Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, string? returnPath, CancellationToken cancellationToken)
        {
            Calls.Enqueue("launch");
            return Task.FromResult(ProviderCall<ProviderLaunch>.Success(new ProviderLaunch(
                "native", DateTimeOffset.UtcNow.AddMinutes(5), PlayerUrl, ["https://ats.test"])));
        }

        public Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken)
        {
            Calls.Enqueue("result");
            return Task.FromResult(ProviderCall<ParsedProviderResult>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true)));
        }

        public WebhookSignatureCheck VerifyWebhook(string? signatureHeader, ReadOnlySpan<byte> rawBody, DateTimeOffset now) =>
            WebhookSignature.Verify(signatureHeader, rawBody, [WebhookSecret], now);
    }

    /// <summary>Stands in for Supabase's /auth/v1/user: a token maps to a CONFIRMED identity, or to nothing.</summary>
    private sealed class FakeIdentities : IInvitationIdentityProvider
    {
        private int _verifyCalls;

        public ConcurrentDictionary<string, SetupIdentity> Confirmed { get; } = new(StringComparer.Ordinal);

        public int VerifyCalls => _verifyCalls;

        public Task<bool> CreateAsync(string email, string password, CancellationToken ct) => Task.FromResult(false);

        public Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct)
        {
            Interlocked.Increment(ref _verifyCalls);
            return Task.FromResult(Confirmed.TryGetValue(accessToken, out var identity) ? identity : null);
        }
    }

    private sealed record FakeAuthSettings(bool RequiresConfirmation) : IAuthSettingsProbe
    {
        public Task<bool> RequiresEmailConfirmationAsync(CancellationToken cancellationToken) => Task.FromResult(RequiresConfirmation);
    }
}
