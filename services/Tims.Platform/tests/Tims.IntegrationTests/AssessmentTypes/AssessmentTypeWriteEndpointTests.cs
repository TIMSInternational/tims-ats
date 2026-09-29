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
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.AssessmentTypes;

/// <summary>
/// F13 endpoint matrix over the REAL host + real Postgres (RLS forced, app_tenant): JWT → PrincipalResolver →
/// PermissionService <c>assessment:create|update</c> → org-scope → TenantScope write + in-transaction audit.
/// Covers 401 (no/tampered token, and before body validation), 403 (no grant, narrow scope), 400 (bad body),
/// 404 (dark flag, cross-org id, missing id), 409 (case-insensitive duplicate name), audit rows, and the
/// create → update → deactivate lifecycle.
/// </summary>
[Collection("AssessmentTypeWrite")]
public sealed class AssessmentTypeWriteEndpointTests(AssessmentTypeWriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Types = "/assessments/types";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "assessment-type-write-test-key" };

    private readonly AssessmentTypeWriteFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AssessmentTypeWriteEnabled", "true");
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

    private Task<long> CountTypesNamed(string name) => _fixture.CountAsync(
        "SELECT COUNT(*) FROM assessment_types WHERE name = @n", ("n", name));

    [Fact]
    public async Task Create_Admin_Is200_WritesRowAndAuditInOrg()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Types,
            new { name = "Prueba Lógica Alfa", description = "Razonamiento", duration = 30 },
            Mint(AssessmentTypeWriteFixture.AdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal("prueba_logica_alfa", body.GetProperty("code").GetString());
        Assert.Equal(AssessmentTypeWriteFixture.OrgA.ToString(), body.GetProperty("organizationId").GetString());
        Assert.True(body.GetProperty("isActive").GetBoolean());
        Assert.EndsWith("Z", body.GetProperty("createdAt").GetString());
        var id = Guid.Parse(body.GetProperty("id").GetString()!);

        Assert.Equal(AssessmentTypeWriteFixture.OrgA, await _fixture.ScalarAsync<Guid>(
            "SELECT organization_id FROM assessment_types WHERE id = @id", ("id", id)));
        Assert.Equal(1, await _fixture.CountAuditAsync(id, "assessment_type_created"));
        Assert.Equal(AssessmentTypeWriteFixture.AdminId, await _fixture.ScalarAsync<Guid>(
            "SELECT actor_id FROM audit_logs WHERE entity_id = @e", ("e", id.ToString())));
    }

    [Fact]
    public async Task Create_WithoutOrTamperedToken_Is401_EvenWithMalformedBody()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Send(client, HttpMethod.Post, Types, "{not json", token: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Send(client, HttpMethod.Post, Types, new { name = "Nope" },
                Mint(AssessmentTypeWriteFixture.AdminSub) + "x")).StatusCode);
        Assert.Equal(0, await CountTypesNamed("Nope"));
    }

    [Theory]
    [InlineData(AssessmentTypeWriteFixture.ReadOnlySub)] // assessment:read only
    [InlineData(AssessmentTypeWriteFixture.NarrowSub)] // create @ team: org catalog needs org scope
    public async Task Create_WithoutOrgScopedCreateGrant_Is403_NothingWritten(string sub)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var name = $"Denied {sub}";
        var response = await Send(client, HttpMethod.Post, Types, new { name }, Mint(sub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await CountTypesNamed(name));
    }

    [Theory]
    [InlineData("""{"name":""}""")]
    [InlineData("""{"name":"X","duration":0}""")]
    [InlineData("""{"name":"X","organizationId":"22222222-2222-2222-2222-222222222222"}""")]
    [InlineData("{not json")]
    public async Task Create_InvalidBody_Is400(string json)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Types, json, Mint(AssessmentTypeWriteFixture.AdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateNameCaseInsensitive_Is409_NoRowNoAudit()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var before = await _fixture.CountAsync("SELECT COUNT(*) FROM audit_logs");
        var response = await Send(client, HttpMethod.Post, Types, new { name = "EXISTENTE" },
            Mint(AssessmentTypeWriteFixture.AdminSub));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(0, await CountTypesNamed("EXISTENTE"));
        Assert.Equal(before, await _fixture.CountAsync("SELECT COUNT(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Create_SameNameInAnotherOrg_IsAllowed()
    {
        // "Existente" exists only in OrgA — OrgB may use the same name (uniqueness is per org).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, Types, new { name = "Existente" },
            Mint(AssessmentTypeWriteFixture.OrgBAdminSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(AssessmentTypeWriteFixture.OrgB.ToString(), (await ReadJson(response)).GetProperty("organizationId").GetString());
    }

    [Fact]
    public async Task FlagOff_RoutesAreNotMapped_404()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, Types, new { name = "X" }, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(client, HttpMethod.Post, $"{Types}/{Guid.NewGuid()}/deactivate", null, null)).StatusCode);
    }

    [Fact]
    public async Task CrossOrgId_UpdateAndDeactivate_Are404_AndOrgBRowUntouched()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(AssessmentTypeWriteFixture.AdminSub);
        var orgBType = AssessmentTypeWriteFixture.OrgBTypeId;

        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(client, HttpMethod.Patch, $"{Types}/{orgBType}", new { name = "Hijacked" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(client, HttpMethod.Post, $"{Types}/{orgBType}/deactivate", null, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(client, HttpMethod.Patch, $"{Types}/{Guid.NewGuid()}", new { name = "Ghost" }, token)).StatusCode);

        Assert.Equal("Tipo OrgB", await _fixture.ScalarAsync<string>(
            "SELECT name FROM assessment_types WHERE id = @id", ("id", orgBType)));
        Assert.True(await _fixture.ScalarAsync<bool>(
            "SELECT is_active FROM assessment_types WHERE id = @id", ("id", orgBType)));
    }

    [Fact]
    public async Task Update_ReadOnlyCaller_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Patch, $"{Types}/{AssessmentTypeWriteFixture.ExistingTypeId}",
            new { name = "Renamed by reader" }, Mint(AssessmentTypeWriteFixture.ReadOnlySub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await CountTypesNamed("Renamed by reader"));
    }

    [Fact]
    public async Task Lifecycle_CreateUpdateDeactivate_AuditsEachChange()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(AssessmentTypeWriteFixture.AdminSub);

        var created = await ReadJson(await Send(client, HttpMethod.Post, Types, new { name = "Ciclo Beta" }, token));
        var id = Guid.Parse(created.GetProperty("id").GetString()!);

        // Renaming onto another type's name → 409, row unchanged.
        var dup = await Send(client, HttpMethod.Patch, $"{Types}/{id}", new { name = "existente" }, token);
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);

        var updated = await Send(client, HttpMethod.Patch, $"{Types}/{id}",
            new { name = "Ciclo Beta 2", description = "Nueva", duration = 20 }, token);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var updatedBody = await ReadJson(updated);
        Assert.Equal("Ciclo Beta 2", updatedBody.GetProperty("name").GetString());
        Assert.Equal("ciclo_beta", updatedBody.GetProperty("code").GetString()); // code is immutable
        Assert.Equal(20, updatedBody.GetProperty("duration").GetInt32());

        var cleared = await ReadJson(await Send(client, HttpMethod.Patch, $"{Types}/{id}", """{"description":null}""", token));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("description").ValueKind);

        var deactivated = await Send(client, HttpMethod.Post, $"{Types}/{id}/deactivate", null, token);
        Assert.Equal(HttpStatusCode.OK, deactivated.StatusCode);
        Assert.False((await ReadJson(deactivated)).GetProperty("isActive").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, $"{Types}/{id}/deactivate", null, token)).StatusCode);

        Assert.False(await _fixture.ScalarAsync<bool>("SELECT is_active FROM assessment_types WHERE id = @id", ("id", id)));
        Assert.Equal(1, await _fixture.CountAsync("SELECT COUNT(*) FROM assessment_types WHERE id = @id", ("id", id))); // soft
        Assert.Equal(1, await _fixture.CountAuditAsync(id, "assessment_type_created"));
        Assert.Equal(2, await _fixture.CountAuditAsync(id, "assessment_type_updated"));
        Assert.Equal(1, await _fixture.CountAuditAsync(id, "assessment_type_deactivated")); // idempotent 2nd call
    }
}
