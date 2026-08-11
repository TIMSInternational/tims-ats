using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Domain.Identity;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 21 (issue #76) endpoint boot matrix: a real host over a real Postgres, driving the REAL
/// HTTP pipeline through the Supabase JWT scheme + <c>PrincipalResolver</c> + <c>PlatformOwnerGate</c>.
///
/// <para><b>Why this file is not optional.</b> Every repository test in this slice calls the repository
/// directly, so <c>PlatformOwnerGate.AuthorizeAsync</c> could be deleted from the handler and the entire
/// rest of the suite would still pass green. This is a cross-tenant CREATE endpoint whose one-active-writer
/// guarantee rests on a deploy flag, so the gate and the flag are the two controls that most need a bite
/// proof rather than a docblock.</para>
///
/// <para>Covered: platform owner → 200 with all seven tables written; resolvable ordinary org-user → 403
/// AND nothing written; missing/tampered JWT → 401; the flag at its default → 404; duplicate slug → 409;
/// the 400 matrix for the hand-written body parser including both bounds of every Zod limit; the
/// auth-BEFORE-validation ordering tRPC's middleware-before-Zod implies; the deliberately UNBOUNDED
/// email, so a future silent tightening surfaces as a failure rather than a parity surprise; and an
/// IMPERSONATING owner → 403, which is the first test on ANY platform-owner surface in this service to drive
/// <c>PlatformOwnerGate</c> through an impersonated session rather than assert the property in prose.</para>
/// </summary>
[Collection("PlatformOrganizationsCreate")]
public sealed class PlatformOrganizationsCreateEndpointAuthTests(PlatformOrganizationsCreateFixture fixture)
{
    private const string Path = "/platform/organizations";
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "plat-orgs-create-test-key" };

    private readonly PlatformOrganizationsCreateFixture _fixture = fixture;

    /// <summary>The HMAC secret the impersonation cookie is signed with — see A11.</summary>
    private const string ImpersonationSecret = "slice21-endpoint-impersonation-secret";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformOrganizationsCreateEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            builder.UseSetting("Platform:ImpersonationSecret", ImpersonationSecret);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    /// <summary>The flag left at its default. No DB is reachable on purpose — a mapped route would fail
    /// LOUDLY here rather than 404, so this cannot pass for the wrong reason.</summary>
    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

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

    /// <summary>A valid body with a fresh slug — <c>organizations_slug_key</c> is global and nothing is torn
    /// down between tests, so every 200-producing case must mint its own.</summary>
    private static object ValidBody(string? slug = null, string? name = null, string? adminEmail = null) => new
    {
        name = name ?? "Endpoint Org",
        slug = slug ?? Guid.NewGuid().ToString(),
        plan = "trial",
        adminEmail = adminEmail ?? "admin@tims.test",
    };

    private static async Task<HttpResponseMessage> Send(HttpClient client, object? body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> SendRaw(HttpClient client, string rawBody, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Path)
        {
            Content = new StringContent(rawBody, Encoding.UTF8, "application/json"),
        };

        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── A1: the happy path, end to end ───────────────────────────────────────────────────────────

    [Fact]
    public async Task PlatformOwner_creates_the_organization_and_all_seven_tables()
    {
        var slug = Guid.NewGuid().ToString();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, ValidBody(slug, "Owner Created"), Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        // 200, not 201: every C# write endpoint in this service returns Results.Ok, matching tRPC mutations.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var orgId = await ReadIdBySlugAsync(slug);
        Assert.NotNull(orgId);
        var counts = await _fixture.CountAllProvisionedRowsAsync(orgId!.Value);
        Assert.Equal(
            new PlatformOrganizationsCreateFixture.ProvisionedCounts(
                1, 1, 1, 1, 1, 1, PlatformOrganizationsCreateFixture.AtsBaseModules.Length),
            counts);
        Assert.Single(await _fixture.ReadAuditRowsAsync(orgId.Value));
    }

    // ── A2: the gate must stop the WRITE, not merely change the status code ──────────────────────

    [Fact]
    public async Task OrdinaryOrgUser_is_403_and_nothing_at_all_is_written()
    {
        var slug = Guid.NewGuid().ToString();
        var countsBefore = await _fixture.CountAllRowsAsync();
        var createdBefore = await _fixture.CountAuditRowsAsync("org_created");
        var deniedBefore = await _fixture.CountAuditRowsAsync("authz_denied");
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, ValidBody(slug), Mint(PlatformOrganizationsCreateFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // The gate must have stopped it BEFORE the write, not merely changed the status code.
        Assert.Null(await ReadIdBySlugAsync(slug));
        Assert.Equal(countsBefore, await _fixture.CountAllRowsAsync());
        Assert.Equal(createdBefore, await _fixture.CountAuditRowsAsync("org_created"));

        // ...and the denial is NOT silent: SecurityDenialAuditMiddleware (#173) records an authz_denied row
        // for every 401/403 the service returns, so this new surface participates in that control by
        // construction rather than by being told to. Asserted here because a bare audit-table total would
        // otherwise make the "nothing was written" claim above look violated.
        Assert.Equal(deniedBefore + 1, await _fixture.CountAuditRowsAsync("authz_denied"));
    }

    // ── A3: credentials ──────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-jwt")]
    public async Task MissingOrTamperedCredential_is_401(string? token)
    {
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, ValidBody(), token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── A4: auth BEFORE validation ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task AuthRunsBeforeValidation_so_a_non_owner_with_a_bad_body_gets_403_not_400()
    {
        // tRPC runs middleware before Zod. Getting this backwards leaks the existence of validation rules to
        // callers who are not allowed to reach the procedure at all.
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(client, "{ this is not json", Mint(PlatformOrganizationsCreateFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── A5: the dark flag — the one-active-writer control ────────────────────────────────────────

    [Fact]
    public async Task The_route_is_404_when_the_flag_is_left_at_its_default()
    {
        using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, ValidBody(), Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        // Not mapped at all — TS remains the single active writer of all seven tables. And it can never stop
        // being one: self-serve signup shares the same provisioning helpers.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── A6: duplicate slug ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ADuplicateSlug_is_409_rather_than_the_TS_500()
    {
        var slug = Guid.NewGuid().ToString();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub);

        Assert.Equal(HttpStatusCode.OK, (await Send(client, ValidBody(slug, "First"), token)).StatusCode);

        var countsBefore = await _fixture.CountAllRowsAsync();
        var second = await Send(client, ValidBody(slug, "Second"), token);

        // Documented divergence: TS leaks the raw Prisma P2002 text as an INTERNAL_SERVER_ERROR, which
        // create-org-modal.tsx renders verbatim to the operator.
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(countsBefore, await _fixture.CountAllRowsAsync());
    }

    // ── A7: the 400 matrix for the hand-written parser ───────────────────────────────────────────

    public static TheoryData<string> InvalidCreateBodies() =>
    [
        "",                                                              // absent body: four required fields missing
        "null",                                                          // JSON null is not an object
        "[]",                                                            // nor an array
        "\"x\"",                                                         // nor a bare string
        "{}",                                                            // all four required fields missing
        """{"slug":"acme","plan":"trial","adminEmail":"a@b.co"}""",       // missing name
        """{"name":"Acme","plan":"trial","adminEmail":"a@b.co"}""",       // missing slug
        """{"name":"Acme","slug":"acme","adminEmail":"a@b.co"}""",        // missing plan
        """{"name":"Acme","slug":"acme","plan":"trial"}""",               // missing adminEmail
        """{"name":null,"slug":"acme","plan":"trial","adminEmail":"a@b.co"}""",  // z.string() rejects null
        """{"name":123,"slug":"acme","plan":"trial","adminEmail":"a@b.co"}""",   // and does not coerce
        """{"name":"Acme","slug":"acme","plan":"gold","adminEmail":"a@b.co"}""", // not a plan member
        """{"name":"Acme","slug":"Not Lower","plan":"trial","adminEmail":"a@b.co"}""",     // regex: uppercase + space
        """{"name":"Acme","slug":"has_underscore","plan":"trial","adminEmail":"a@b.co"}""", // regex: underscore
        """{"name":"Acme","slug":"a","plan":"trial","adminEmail":"a@b.co"}""",   // slug min(2)
        """{"name":"A","slug":"acme","plan":"trial","adminEmail":"a@b.co"}""",   // name min(2)
        """{"name":"Acme","slug":"acme","plan":"trial","adminEmail":"nope"}""",  // not an email
        """{"name":"Acme","slug":"acme","plan":"trial","adminEmail":"a@b.co","billingEmail":null}""", // .optional() rejects null
        """{"name":"Acme","slug":"acme","plan":"trial","adminEmail":"a@b.co","billingEmail":"nope"}""", // present ⇒ must be valid
        """{"name":"first","name":"second","slug":"acme","plan":"trial","adminEmail":"a@b.co"}""", // duplicate keys
        """{ this is not json""",                                        // malformed
    ];

    [Theory]
    [MemberData(nameof(InvalidCreateBodies))]
    public async Task InvalidCreateBody_is_400_and_writes_nothing(string body)
    {
        var countsBefore = await _fixture.CountAllRowsAsync();
        var auditBefore = await _fixture.CountAuditRowsAsync("org_created");
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(client, body, Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(countsBefore, await _fixture.CountAllRowsAsync());
        Assert.Equal(auditBefore, await _fixture.CountAuditRowsAsync("org_created"));
    }

    // ── A8: both sides of every Zod bound. Reject, never clamp ───────────────────────────────────

    [Fact]
    public async Task NameAndSlugAreAcceptedAtTheirLimitsAndRejectedOneStepOutside()
    {
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub);

        // name: min 2, max 100.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, ValidBody(name: "ab"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, ValidBody(name: new string('a', 100)), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, ValidBody(name: "a"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, ValidBody(name: new string('a', 101)), token)).StatusCode);

        // slug: min 2, max 50, and every character must satisfy ^[a-z0-9-]+$.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, ValidBody(slug: "ab"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, ValidBody(slug: new string('b', 50)), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, ValidBody(slug: "a"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, ValidBody(slug: new string('c', 51)), token)).StatusCode);
    }

    // ── A9: unknown keys ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UnknownKeys_are_ignored_because_Zod_strips_them()
    {
        // No .strict() on the TS schema, so rejecting here would refuse requests TS accepts.
        var slug = Guid.NewGuid().ToString();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client,
            $$"""{"name":"Extras","slug":"{{slug}}","plan":"trial","adminEmail":"a@b.co","nope":1}""",
            Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(await ReadIdBySlugAsync(slug));
    }

    // ── A10: the UNBOUNDED email, ported as-is ───────────────────────────────────────────────────

    [Fact]
    public async Task AVeryLongButWellFormedAdminEmail_is_accepted_because_Zod_bounds_neither_email()
    {
        // organizations.ts:109-110 is `.email()` with no `.max()`. That violates
        // .claude/rules/api-security.md and is reproduced deliberately — narrowing during a port makes a
        // step-5 parity diff uninterpretable, so the bound is issue #207 instead. THIS ASSERTION
        // INVERTS when #207 lands; if it fails before then, the port silently added a bound TS does not have.
        var slug = Guid.NewGuid().ToString();
        var email = new string('a', 5000) + "@example.com";
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, ValidBody(slug, adminEmail: email), Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── A11: an IMPERSONATING platform owner is denied, and mints nothing ────────────────────────

    [Fact]
    public async Task AnImpersonatingPlatformOwner_is_403_and_creates_nothing()
    {
        // THE PROPERTY EVERY PLATFORM-OWNER SURFACE HAS RELIED ON IN PROSE SINCE SLICE 19, asserted here for
        // the first time on any of them. PlatformOwnerGate's docblock states that an impersonated owner
        // resolves to PrincipalType.OrgUser and is therefore denied "with NO special-case code" — but before
        // this test, `grep -rln "mpersonat" services/Tims.Platform/tests/` hit only Identity-layer files and
        // NONE of them drove the gate. A change to StaffContextResolver that let an impersonated session
        // resolve to PlatformOwner would have let an owner MINT ORGANIZATIONS while impersonating a tenant
        // user, with the entire slice-19/20/21 suite green.
        //
        // The JWT is the REAL owner's (impersonation never re-mints a token); the cookie is what redirects
        // the resolution to the target. TS's ctx.user.isPlatformOwner is checked against the real,
        // non-impersonated user row, so a denial here is parity, not a C# tightening.
        var slug = Guid.NewGuid().ToString();
        var countsBefore = await _fixture.CountAllRowsAsync();
        var createdBefore = await _fixture.CountAuditRowsAsync("org_created");

        var token = ImpersonationCookie.SignImpersonationToken(
            ImpersonationSecret,
            PlatformOrganizationsCreateFixture.Actor.ToString(),
            PlatformOrganizationsCreateFixture.NonOwner.ToString(),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, Path)
        {
            Content = JsonContent.Create(ValidBody(slug, "Impersonated Mint")),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub)}");
        request.Headers.Add("Cookie", $"{ImpersonationCookie.CookieName}={token}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Null(await ReadIdBySlugAsync(slug));
        Assert.Equal(countsBefore, await _fixture.CountAllRowsAsync());
        Assert.Equal(createdBefore, await _fixture.CountAuditRowsAsync("org_created"));
    }

    /// <summary>
    /// The anti-vacuity control for A11: the SAME owner, the same body shape, with no impersonation cookie,
    /// is allowed. Without it, A11 would also pass if the owner had simply lost access — which is the
    /// failure mode a 403-asserting test is most likely to hide.
    /// </summary>
    [Fact]
    public async Task TheSameOwner_without_the_impersonation_cookie_is_allowed()
    {
        var slug = Guid.NewGuid().ToString();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(
            client, ValidBody(slug, "Not Impersonated"), Mint(PlatformOrganizationsCreateFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(await ReadIdBySlugAsync(slug));
    }

    private async Task<Guid?> ReadIdBySlugAsync(string slug)
    {
        await using var connection = new Npgsql.NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id FROM organizations WHERE slug = @slug";
        command.Parameters.AddWithValue("slug", slug);
        var value = await command.ExecuteScalarAsync();
        return value is Guid id ? id : null;
    }
}
