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

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 20 (issue #76) endpoint boot matrix: a real host over a real Postgres, driving the REAL
/// HTTP pipeline through the Supabase JWT scheme + <c>PrincipalResolver</c> + <c>PlatformOwnerGate</c>.
///
/// <para><b>Why this file exists.</b> The tier-3 review panel flagged its absence as the one thing to block
/// on, and it was right: without it, <c>PlatformOwnerGate.AuthorizeAsync</c> could be deleted from both
/// handlers and every other test in this slice would still pass green — the fail-closed mutation proof
/// calls the repository directly and never touches an endpoint. Nineteen other slices ship a
/// <c>*EndpointAuthTests</c>; slice 19 and the first draft of slice 20 did not. These are cross-tenant
/// WRITE endpoints, so the gate and the dark flag are the two controls that most need a bite proof rather
/// than a docblock.</para>
///
/// <para>Covered: platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
/// flag OFF (the default) → 404; unknown organization → 404; the 400 matrix for the hand-written body
/// parser; and the auth-BEFORE-validation ordering that tRPC's middleware-before-Zod implies.</para>
/// </summary>
[Collection("PlatformOrganizationsWrite")]
public sealed class PlatformOrganizationsWriteEndpointAuthTests(PlatformOrganizationsWriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "plat-orgs-write-test-key" };

    private readonly PlatformOrganizationsWriteFixture _fixture = fixture;

    private static string UpdatePath(Guid id) => $"/platform/organizations/{id}";

    private static string SuspendPath(Guid id) => $"/platform/organizations/{id}/suspend";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformOrganizationsWriteEnabled", "true");
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

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string path, object? body, string? token)
    {
        var request = new HttpRequestMessage(method, path);
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

    private static async Task<HttpResponseMessage> SendRaw(
        HttpClient client, HttpMethod method, string path, string rawBody, string? token)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(rawBody, Encoding.UTF8, "application/json"),
        };

        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── the authorization matrix ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PlatformOwner_can_update_and_suspend()
    {
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub);

        var update = await Send(client, HttpMethod.Patch, UpdatePath(org), new { name = "Renamed By Owner" }, token);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var suspend = await Send(client, HttpMethod.Post, SuspendPath(org), new { suspend = true }, token);
        Assert.Equal(HttpStatusCode.OK, suspend.StatusCode);

        var stored = await _fixture.ReadOrganizationAsync(org);
        Assert.Equal("Renamed By Owner", stored!.Name);
        Assert.False(stored.IsActive);
    }

    [Fact]
    public async Task OrdinaryOrgUser_is_403_on_both_writes()
    {
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsWriteFixture.OrgUserSub);

        var update = await Send(client, HttpMethod.Patch, UpdatePath(org), new { name = "Nope" }, token);
        var suspend = await Send(client, HttpMethod.Post, SuspendPath(org), new { suspend = true }, token);

        Assert.Equal(HttpStatusCode.Forbidden, update.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, suspend.StatusCode);

        // The gate must have stopped it BEFORE the write, not merely changed the status code.
        var stored = await _fixture.ReadOrganizationAsync(org);
        Assert.NotEqual("Nope", stored!.Name);
        Assert.True(stored.IsActive);
        Assert.Empty(await _fixture.ReadAuditRowsAsync(org));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-jwt")]
    public async Task MissingOrTamperedCredential_is_401(string? token)
    {
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var update = await Send(client, HttpMethod.Patch, UpdatePath(org), new { name = "Nope" }, token);
        var suspend = await Send(client, HttpMethod.Post, SuspendPath(org), new { suspend = true }, token);

        Assert.Equal(HttpStatusCode.Unauthorized, update.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, suspend.StatusCode);
    }

    [Fact]
    public async Task AuthRunsBeforeValidation_so_a_non_owner_with_a_bad_body_gets_403_not_400()
    {
        // tRPC runs middleware before Zod. Getting this backwards leaks the existence of validation rules
        // to callers who are not allowed to reach the procedure at all.
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client, HttpMethod.Patch, UpdatePath(org), "{ this is not json", Mint(PlatformOrganizationsWriteFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── the dark flag: the one-active-writer control ─────────────────────────────────────────────

    [Fact]
    public async Task Routes_are_404_when_the_flag_is_left_at_its_default()
    {
        using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub);

        var update = await Send(client, HttpMethod.Patch, UpdatePath(PlatformOrganizationsWriteFixture.OrgA), new { name = "x" }, token);
        var suspend = await Send(client, HttpMethod.Post, SuspendPath(PlatformOrganizationsWriteFixture.OrgA), new { suspend = true }, token);

        // Not mapped at all — TS remains the single active writer of `organizations`.
        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, suspend.StatusCode);
    }

    // ── not found ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UnknownOrganization_is_404_not_500()
    {
        // Documented divergence: Prisma's update() throws P2025, which tRPC surfaces as a 500.
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub);

        var update = await Send(client, HttpMethod.Patch, UpdatePath(Guid.NewGuid()), new { name = "Ghost" }, token);
        var suspend = await Send(client, HttpMethod.Post, SuspendPath(Guid.NewGuid()), new { suspend = true }, token);

        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, suspend.StatusCode);
    }

    // ── the 400 matrix for the hand-written parser ───────────────────────────────────────────────

    public static TheoryData<string> InvalidUpdateBodies() =>
    [
        """{"name":null}""",                          // .optional() REJECTS an explicit null
        """{"settings":null}""",                       // same, for the nested object
        """{"isActive":"yes"}""",                      // z.boolean() does not coerce
        """{"isActive":1}""",                          // nor from a number
        """{"name":5}""",                              // z.string() does not coerce
        """{"plan":"free"}""",                         // not an OrgPlan member
        """{"plan":"Trial"}""",                        // z.nativeEnum is exact-match
        """{"settings":"es"}""",                       // settings must be an object
        """{"settings":{"locale":"a-locale-far-too-long"}}""", // max(10)
        """["not","an","object"]""",                   // body must be an object
        """{ this is not json""",                      // malformed
    ];

    [Theory]
    [MemberData(nameof(InvalidUpdateBodies))]
    public async Task InvalidUpdateBody_is_400(string body)
    {
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client, HttpMethod.Patch, UpdatePath(org), body, Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await _fixture.ReadAuditRowsAsync(org));
    }

    [Fact]
    public async Task NameAtExactlyTheLimit_is_accepted_and_one_over_is_400()
    {
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub);

        var atLimit = await Send(client, HttpMethod.Patch, UpdatePath(org), new { name = new string('a', 100) }, token);
        var overLimit = await Send(client, HttpMethod.Patch, UpdatePath(org), new { name = new string('a', 101) }, token);

        Assert.Equal(HttpStatusCode.OK, atLimit.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, overLimit.StatusCode);
    }

    [Fact]
    public async Task UnknownKeys_are_ignored_because_Zod_strips_them()
    {
        // No .strict() on the TS schema, so rejecting here would refuse requests TS accepts.
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client, HttpMethod.Patch, UpdatePath(org), """{"name":"Kept","nonsense":true}""",
            Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Kept", (await _fixture.ReadOrganizationAsync(org))!.Name);
    }

    [Fact]
    public async Task DuplicateKeysInTheBody_are_400_rather_than_an_unhandled_500()
    {
        // JsonObject materialises its dictionary on the first property READ, not at parse — so before this
        // was handled, a duplicate key escaped as an ArgumentException from inside the handler and 500'd.
        // TS is last-wins (JSON.parse) and would return 200, so this IS a divergence — but a 400 on an
        // ambiguous body is the safer of the two and is recorded in the slice doc.
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client, HttpMethod.Patch, UpdatePath(org), """{"name":"first","name":"second"}""",
            Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnEmptyBody_is_the_id_only_update_not_a_400()
    {
        // `updateOrganization({ id })` is a valid 200 in TS: it still UPDATEs (bumping updated_at via
        // @updatedAt) and still writes an audit row with `changes` = {}. Here `id` is the route segment, so
        // the REST equivalent carries no body at all.
        var org = await SeedOrganizationAsync();
        var before = await _fixture.ReadOrganizationAsync(org);
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(
            client, HttpMethod.Patch, UpdatePath(org), body: null, Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var after = await _fixture.ReadOrganizationAsync(org);
        Assert.Equal(before!.Name, after!.Name);
        Assert.NotEqual(before.UpdatedAt, after.UpdatedAt);

        var audit = Assert.Single(await _fixture.ReadAuditRowsAsync(org));
        Assert.Equal("{}", audit.ChangesText);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"suspend":"true"}""")]
    [InlineData("""{"suspend":null}""")]
    public async Task SuspendWithoutAValidFlag_is_400(string body)
    {
        // `suspend` is REQUIRED (organizations.ts:213). Defaulting it either way would silently pick a
        // destructive direction.
        var org = await SeedOrganizationAsync();
        using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await SendRaw(
            client, HttpMethod.Post, SuspendPath(org), body, Mint(PlatformOrganizationsWriteFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await _fixture.ReadOrganizationAsync(org))!.IsActive);
    }

    private async Task<Guid> SeedOrganizationAsync()
    {
        var id = Guid.NewGuid();
        await using var connection = new Npgsql.NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO organizations (id, name, slug, plan, settings, is_active)
            VALUES (@id, 'Endpoint Target', @slug, 'trial'::"OrgPlan", '{}'::jsonb, true)
            """;
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("slug", id.ToString());
        await command.ExecuteNonQueryAsync();
        return id;
    }
}
