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
using Tims.Application.CandidateConsent;
using Tims.Application.Email;
using Tims.Application.PlatformInvitations;

namespace Tims.IntegrationTests.CandidateConsent;

/// <summary>
/// #312/#313 endpoint matrix over the REAL host + real Postgres (RLS forced, app_tenant): JWT → PrincipalResolver →
/// PermissionService <c>candidate:read|update</c> → org-scope → TenantScope read/write + in-transaction audit, and
/// the self-service route's confirmed-email gate (a fake auth service stands in for Supabase's /auth/v1/user).
/// </summary>
[Collection("CandidateConsent")]
public sealed class CandidateConsentEndpointTests(CandidateConsentFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Portal = "/portal/consent/withdrawal";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "candidate-consent-test-key" };

    private readonly CandidateConsentFixture _fixture = fixture;

    private static string Consent(Guid candidateId) => $"/tenant/candidates/{candidateId}/consent";

    private static string Withdraw(Guid candidateId) => $"/tenant/candidates/{candidateId}/consent/withdrawal";

    private WebApplicationFactory<Program> Factory(
        bool enabled = true, FakeIdentities? identities = null, IAuthSettingsProbe? authSettings = null,
        FakeEmails? emails = null, bool realProbe = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:CandidateConsentEnabled", enabled ? "true" : "false");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            if (realProbe)
            {
                builder.UseSetting("Invitations:SupabaseServiceKey", "REPLACE_ME_OUT_OF_BAND"); // the terraform placeholder
            }

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
                services.RemoveAll<IInvitationIdentityProvider>();
                services.AddSingleton<IInvitationIdentityProvider>(identities ?? new FakeIdentities());
                if (!realProbe)
                {
                    services.RemoveAll<IAuthSettingsProbe>();
                    services.AddSingleton(authSettings ?? new FakeAuthSettings(RequiresConfirmation: true));
                }

                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(emails ?? new FakeEmails());
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

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object? body, string? token)
    {
        var request = new HttpRequestMessage(method, path);
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

    // ── GET status + evidence ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_Admin_ReturnsStatusAndEvidence_WithoutRawRequestMetadata()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Get, Consent(CandidateConsentFixture.Granted), null,
            Mint(CandidateConsentFixture.AdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal(["candidateId", "consent", "deletionRequest", "evidence"],
            body.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        var consent = body.GetProperty("consent");
        Assert.Equal("granted", consent.GetProperty("status").GetString());
        Assert.Equal("portal-apply-2026-09-29", consent.GetProperty("textVersion").GetString());
        Assert.Equal("2026-09-30T10:00:00.000Z", consent.GetProperty("agreedAt").GetString());

        var evidence = body.GetProperty("evidence").EnumerateArray().ToArray();
        Assert.Equal(2, evidence.Length);
        // Newest first; the live row carries the hash and metadata presence, the backfilled one neither.
        Assert.Equal(CandidateConsentFixture.GrantedApplication.ToString(), evidence[0].GetProperty("applicationId").GetString());
        Assert.Equal(new string('a', 64), evidence[0].GetProperty("textSha256").GetString());
        Assert.True(evidence[0].GetProperty("hasRequestMetadata").GetBoolean());
        Assert.False(evidence[0].GetProperty("isBackfilled").GetBoolean());
        Assert.True(evidence[1].GetProperty("isBackfilled").GetBoolean());
        Assert.False(evidence[1].GetProperty("hasRequestMetadata").GetBoolean());
        // The pseudonymous IP hash and the user agent never leave the database through this read.
        var raw = body.GetRawText();
        Assert.DoesNotContain(new string('b', 64), raw, StringComparison.Ordinal);
        Assert.DoesNotContain("Mozilla", raw, StringComparison.Ordinal);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("deletionRequest").ValueKind);
    }

    [Fact]
    public async Task Get_NoConsentRow_IsStatusNone_AndUnknownIs404()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Get, Consent(CandidateConsentFixture.Untouched), null,
            Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        var consent = body.GetProperty("consent");
        Assert.Equal("none", consent.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, consent.GetProperty("textVersion").ValueKind);
        Assert.Empty(body.GetProperty("evidence").EnumerateArray());

        var unknown = await Send(client, HttpMethod.Get, Consent(Guid.NewGuid()), null, Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task Get_CrossOrgCandidate_Is404()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Get, Consent(CandidateConsentFixture.OrgBCandidate), null,
            Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(CandidateConsentFixture.NarrowSub, HttpStatusCode.Forbidden)]
    public async Task Get_Unauthorized_Or_NarrowScope(string? sub, HttpStatusCode expected)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Get, Consent(CandidateConsentFixture.Granted), null,
            sub is null ? null : Mint(sub));
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task DarkFlag_RoutesAreNotMapped()
    {
        await using var factory = Factory(enabled: false);
        using var client = factory.CreateClient();
        var get = await Send(client, HttpMethod.Get, Consent(CandidateConsentFixture.Granted), null,
            Mint(CandidateConsentFixture.AdminSub));
        var post = await Send(client, HttpMethod.Post, Withdraw(CandidateConsentFixture.Granted), new { channel = "email" },
            Mint(CandidateConsentFixture.AdminSub));
        var portal = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" },
            Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, portal.StatusCode);
    }

    // ── Staff withdrawal ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Withdraw_Admin_MarksWithdrawn_FilesDeletionRequest_Audits_AndIsIdempotent()
    {
        var target = CandidateConsentFixture.StaffTarget;
        var emails = new FakeEmails();
        await using var factory = Factory(emails: emails);
        using var client = factory.CreateClient();
        var token = Mint(CandidateConsentFixture.AdminSub);

        var response = await Send(client, HttpMethod.Post, Withdraw(target),
            new { channel = "email", reason = "Lo pidió por correo", requestDeletion = true }, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        var consent = body.GetProperty("consent");
        Assert.Equal("withdrawn", consent.GetProperty("status").GetString());
        Assert.Equal("email", consent.GetProperty("withdrawalChannel").GetString());
        Assert.Equal("Lo pidió por correo", consent.GetProperty("withdrawalReason").GetString());
        Assert.Equal("staff", consent.GetProperty("withdrawnBy").GetString());
        // The original authorization stays on record — a withdrawal never rewrites the evidence.
        Assert.Equal("portal-apply-2026-09-29", consent.GetProperty("textVersion").GetString());
        Assert.Equal("2026-09-30T10:00:00.000Z", consent.GetProperty("agreedAt").GetString());
        var request = body.GetProperty("deletionRequest");
        Assert.Equal("pending", request.GetProperty("status").GetString());
        Assert.Equal("staff", request.GetProperty("source").GetString());

        Assert.Equal(CandidateConsentFixture.AdminId, await _fixture.ScalarAsync<Guid>(
            "SELECT withdrawn_by_user_id FROM data_consents WHERE subject_user_id = @c", ("c", target)));
        Assert.Equal(1, await _fixture.CountDeletionRequestsAsync(target));
        Assert.Equal(1, await _fixture.CountAuditAsync(target));
        var metadata = await _fixture.ScalarAsync<string>(
            "SELECT metadata::text FROM audit_logs WHERE entity_id = @e", ("e", target.ToString()));
        Assert.DoesNotContain("correo", metadata, StringComparison.Ordinal); // the reason text is not copied into the audit
        Assert.Equal(CandidateConsentFixture.AdminId, await _fixture.ScalarAsync<Guid>(
            "SELECT actor_id FROM audit_logs WHERE entity_id = @e", ("e", target.ToString())));

        // The org's admins are alerted in the same transaction: the active hr_admin+super_admin user ONCE (deduped),
        // never the inactive hr_admin nor OrgB's hr_admin; and emailed after commit.
        Assert.Equal(1, await _fixture.CountAlertsAsync(target));
        Assert.Equal(CandidateConsentFixture.HrAdminId, await _fixture.ScalarAsync<Guid>(
            "SELECT n.user_id FROM notifications n JOIN data_subject_requests r ON r.id = n.entity_id WHERE r.candidate_id = @c",
            ("c", target)));
        var alert = await _fixture.ScalarAsync<string>(
            "SELECT n.title || '|' || n.message || '|' || n.action_url || '|' || n.type || '|' || n.organization_id FROM notifications n " +
            "JOIN data_subject_requests r ON r.id = n.entity_id WHERE r.candidate_id = @c", ("c", target));
        Assert.Contains("|/settings/data-requests|data_subject_request|" + CandidateConsentFixture.OrgA, alert, StringComparison.Ordinal);
        Assert.Contains("Un candidato", alert, StringComparison.Ordinal);
        Assert.DoesNotContain("Sol", alert, StringComparison.Ordinal); // no candidate name
        Assert.Equal([CandidateConsentFixture.HrAdminEmail], emails.Sent.Select(m => m.To).ToArray());
        Assert.Contains("https://tims-ats.vercel.app/settings/data-requests", emails.Sent[0].Html, StringComparison.Ordinal);

        // Again: nothing new is written.
        var again = await Send(client, HttpMethod.Post, Withdraw(target),
            new { channel = "phone", requestDeletion = true }, token);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal("email", (await ReadJson(again)).GetProperty("consent").GetProperty("withdrawalChannel").GetString());
        Assert.Equal(1, await _fixture.CountDeletionRequestsAsync(target));
        Assert.Equal(1, await _fixture.CountAuditAsync(target));
        Assert.Equal(1, await _fixture.CountAlertsAsync(target));
        Assert.Single(emails.Sent);
    }

    [Fact]
    public async Task Withdraw_CandidateWithoutConsentRow_CreatesWithdrawalOnlyMarker_NeverAnAuthorization()
    {
        var target = CandidateConsentFixture.NoConsent;
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(target), new { channel = "in_person" },
            Mint(CandidateConsentFixture.AdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var consent = (await ReadJson(response)).GetProperty("consent");
        Assert.Equal("withdrawn", consent.GetProperty("status").GetString());
        Assert.Equal("none:withdrawal-only", consent.GetProperty("textVersion").GetString());
        Assert.Equal(JsonValueKind.Null, consent.GetProperty("agreedAt").ValueKind);
        Assert.Equal(1, await _fixture.CountWithdrawnAsync(target));
        Assert.Equal(0, await _fixture.CountDeletionRequestsAsync(target));
        Assert.Equal(0, await _fixture.CountAlertsAsync(target)); // no new request → no alert
    }

    [Fact]
    public async Task Withdraw_AlreadyWithdrawn_WithDeletionRequest_FilesOnlyTheRequest()
    {
        var target = CandidateConsentFixture.AlreadyWithdrawn;
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(target), new { channel = "letter", requestDeletion = true },
            Mint(CandidateConsentFixture.AdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var consent = (await ReadJson(response)).GetProperty("consent");
        Assert.Equal("2026-09-15T10:00:00.000Z", consent.GetProperty("withdrawnAt").GetString());
        Assert.Equal(JsonValueKind.Null, consent.GetProperty("withdrawalChannel").ValueKind);
        Assert.Equal(1, await _fixture.CountDeletionRequestsAsync(target));
        Assert.Equal(1, await _fixture.CountAuditAsync(target));
    }

    [Fact]
    public async Task Withdraw_ConcurrentRequests_WriteExactlyOnce()
    {
        var target = CandidateConsentFixture.Concurrent;
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var token = Mint(CandidateConsentFixture.AdminSub);
        var responses = await Task.WhenAll(Enumerable.Range(0, 16).Select(_ =>
            Send(client, HttpMethod.Post, Withdraw(target), new { channel = "email", requestDeletion = true }, token)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await _fixture.CountWithdrawnAsync(target));
        Assert.Equal(1, await _fixture.CountDeletionRequestsAsync(target));
        Assert.Equal(1, await _fixture.CountAuditAsync(target));
        Assert.Equal(1, await _fixture.CountAlertsAsync(target));
        Assert.Equal(1, await _fixture.CountAlertsAsync(target));
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(CandidateConsentFixture.ReadOnlySub, HttpStatusCode.Forbidden)]
    [InlineData(CandidateConsentFixture.NarrowSub, HttpStatusCode.Forbidden)]
    public async Task Withdraw_Unauthorized_NoGrant_NarrowScope_WriteNothing(string? sub, HttpStatusCode expected)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(CandidateConsentFixture.Granted),
            new { channel = "email", requestDeletion = true }, sub is null ? null : Mint(sub));
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(0, await _fixture.CountWithdrawnAsync(CandidateConsentFixture.Granted));
        Assert.Equal(0, await _fixture.CountDeletionRequestsAsync(CandidateConsentFixture.Granted));
    }

    [Fact]
    public async Task Withdraw_AnonymousWithMalformedBody_Is401_NotA400()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(CandidateConsentFixture.Granted), "{not json", null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"channel":"portal"}""")]
    [InlineData("""{"channel":"email","extra":1}""")]
    [InlineData("""{not json""")]
    public async Task Withdraw_BadBody_Is400(string raw)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(CandidateConsentFixture.Granted), raw,
            Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Withdraw_CrossOrgCandidate_Is404_AndWritesNothing()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Withdraw(CandidateConsentFixture.OrgBCandidate),
            new { channel = "email", requestDeletion = true }, Mint(CandidateConsentFixture.AdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0, await _fixture.CountWithdrawnAsync(CandidateConsentFixture.OrgBCandidate));
        Assert.Equal(0, await _fixture.CountDeletionRequestsAsync(CandidateConsentFixture.OrgBCandidate));
    }

    // ── Candidate self-service ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Portal_VerifiedEmail_WithdrawsEveryExactVariantInTheOrg_Only()
    {
        const string sub = "candidate-luz";
        var identities = new FakeIdentities();
        var token = Mint(sub);
        identities.Confirmed[token] = new SetupIdentity(sub, "LUZ@example.com");
        var emails = new FakeEmails();
        await using var factory = Factory(identities: identities, emails: emails);
        using var client = factory.CreateClient();

        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal("""{"received":true}""", await response.Content.ReadAsStringAsync());
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        foreach (var variant in new[] { CandidateConsentFixture.PortalLower, CandidateConsentFixture.PortalMixedDeleted })
        {
            Assert.Equal(1, await _fixture.CountWithdrawnAsync(variant));
            Assert.Equal(1, await _fixture.CountDeletionRequestsAsync(variant));
            Assert.Equal("portal", await _fixture.ScalarAsync<string>(
                "SELECT withdrawal_channel FROM data_consents WHERE subject_user_id = @c", ("c", variant)));
            Assert.Equal("candidate_portal", await _fixture.ScalarAsync<string>(
                "SELECT source FROM data_subject_requests WHERE candidate_id = @c", ("c", variant)));
            Assert.Equal(1, await _fixture.CountAuditAsync(variant));
            Assert.Equal(1, await _fixture.CountAlertsAsync(variant)); // one alert per new request
        }

        // One email per admin per withdrawal, however many requests it filed.
        Assert.Equal([CandidateConsentFixture.HrAdminEmail], emails.Sent.Select(m => m.To).ToArray());

        // The data subject is the actor: no staff user on the status row or the audit row.
        Assert.Equal(0, await _fixture.CountAsync(
            "SELECT COUNT(*) FROM data_consents WHERE subject_user_id = @c AND withdrawn_by_user_id IS NOT NULL",
            ("c", CandidateConsentFixture.PortalLower)));
        Assert.Equal(0, await _fixture.CountAsync(
            "SELECT COUNT(*) FROM audit_logs WHERE entity_id = @e AND actor_id IS NOT NULL",
            ("e", CandidateConsentFixture.PortalLower.ToString())));
        // `_` is not a wildcard, and another tenant's candidate with the same email is untouched.
        Assert.Equal(0, await _fixture.CountWithdrawnAsync(CandidateConsentFixture.PortalWildcardNeighbour));
        Assert.Equal(0, await _fixture.CountWithdrawnAsync(CandidateConsentFixture.PortalOtherOrg));
        Assert.Equal(0, await _fixture.CountDeletionRequestsAsync(CandidateConsentFixture.PortalOtherOrg));
    }

    [Fact]
    public async Task Portal_UnconfirmedEmail_Is403_AndWritesNothing()
    {
        const string sub = "candidate-unverified";
        var token = Mint(sub);
        await using var factory = Factory(identities: new FakeIdentities()); // the auth service reports no confirmed identity
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("email_not_verified", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Portal_IdentityForAnotherSubject_Is403()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-a");
        identities.Confirmed[token] = new SetupIdentity("candidate-b", "ana@example.com");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await _fixture.CountWithdrawnAsync(CandidateConsentFixture.Granted));
    }

    [Fact]
    public async Task Portal_NoCandidateWithThatEmail_IsTheSameUniformAnswer()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-nobody");
        identities.Confirmed[token] = new SetupIdentity("candidate-nobody", "nobody@example.com");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal("""{"received":true}""", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("nope")]
    [InlineData("dormida")] // inactive org
    public async Task Portal_UnknownOrInactiveOrg_Is404(string slug)
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-x");
        identities.Confirmed[token] = new SetupIdentity("candidate-x", "x@example.com");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = slug }, token);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Portal_Anonymous_Is401_AndAuthServiceDown_Is503()
    {
        await using (var factory = Factory())
        {
            using var client = factory.CreateClient();
            var anonymous = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, null);
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        }

        await using var down = Factory(identities: new FakeIdentities { Unconfigured = true });
        using var downClient = down.CreateClient();
        var response = await Send(downClient, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, Mint("candidate-y"));
        await AssertSelfServiceUnavailable(response);
    }

    [Fact]
    public async Task Portal_AutoconfirmOn_Is503_BeforeTheIdentityIsEvenAsked()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-auto");
        identities.Confirmed[token] = new SetupIdentity("candidate-auto", "luz@example.com");
        await using var factory = Factory(identities: identities, authSettings: new FakeAuthSettings(RequiresConfirmation: false));
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        await AssertSelfServiceUnavailable(response);
        Assert.Equal(0, identities.VerifyCalls);
    }

    [Fact]
    public async Task Portal_AuthSettingsUnreachable_Is503_FailClosed()
    {
        // The REAL probe with no usable Invitations:SupabaseUrl/ServiceKey: the settings fetch fails → closed.
        var identities = new FakeIdentities();
        var token = Mint("candidate-nofetch");
        identities.Confirmed[token] = new SetupIdentity("candidate-nofetch", "luz@example.com");
        await using var factory = Factory(identities: identities, realProbe: true);
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        await AssertSelfServiceUnavailable(response);
    }

    [Fact]
    public async Task Portal_AutoconfirmOff_Proceeds()
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-ok");
        identities.Confirmed[token] = new SetupIdentity("candidate-ok", "nobody-else@example.com");
        await using var factory = Factory(identities: identities, authSettings: new FakeAuthSettings(RequiresConfirmation: true));
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, new { organizationSlug = "acme" }, token);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    private static async Task AssertSelfServiceUnavailable(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal("self_service_unavailable", body.GetProperty("code").GetString());
        Assert.StartsWith("Esta opción no está disponible en este momento.", body.GetProperty("message").GetString(),
            StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"organizationSlug":"acme","email":"ana@example.com"}""")]
    [InlineData("""{"organizationSlug":"ACME"}""")]
    public async Task Portal_BadBody_Is400(string raw)
    {
        var identities = new FakeIdentities();
        var token = Mint("candidate-z");
        identities.Confirmed[token] = new SetupIdentity("candidate-z", "z@example.com");
        await using var factory = Factory(identities: identities);
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Portal, raw, token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>Stands in for Supabase's /auth/v1/user: a token maps to a CONFIRMED identity, or to nothing.</summary>
    private sealed class FakeIdentities : IInvitationIdentityProvider
    {
        public ConcurrentDictionary<string, SetupIdentity> Confirmed { get; } = new(StringComparer.Ordinal);

        public bool Unconfigured { get; init; }

        public Task<bool> CreateAsync(string email, string password, CancellationToken ct) => Task.FromResult(false);

        public int VerifyCalls => _verifyCalls;

        private int _verifyCalls;

        public Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct)
        {
            Interlocked.Increment(ref _verifyCalls);
            return Unconfigured
                ? throw new InvalidOperationException("Invitation identity service is not configured")
                : Task.FromResult(Confirmed.TryGetValue(accessToken, out var identity) ? identity : null);
        }
    }

    private sealed record FakeAuthSettings(bool RequiresConfirmation) : IAuthSettingsProbe
    {
        public Task<bool> RequiresEmailConfirmationAsync(CancellationToken cancellationToken) =>
            Task.FromResult(RequiresConfirmation);
    }

    internal sealed class FakeEmails : IEmailSender
    {
        public ConcurrentQueue<(string To, string Subject, string Html)> Queue { get; } = new();

        public List<(string To, string Subject, string Html)> Sent => [.. Queue];

        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        {
            Queue.Enqueue((to, subject, html));
            return Task.FromResult(true);
        }
    }
}
