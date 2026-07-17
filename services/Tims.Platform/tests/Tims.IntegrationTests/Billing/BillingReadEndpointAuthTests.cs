using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 3 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the billing
/// invoice READ endpoints — the FIRST staff-JWT C# product surface. Proves the full gate through the
/// actual Supabase JWT scheme + PrincipalResolver + PermissionService billing:read grant:
///
///   billing:read grant → 200 (list + getInvoice, real data incl. nested subscription);
///   resolvable staff WITHOUT the grant → 403; no token / tampered JWT / valid-but-not-staff sub → 401;
///   flag OFF (the PlatformOptions DEFAULT) → 404 (dark — TS stays the sole active reader; bite-proven).
/// </summary>
[Collection("BillingRead")]
public sealed class BillingReadEndpointAuthTests(BillingReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ListPath = "/billing/invoices";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "billing-test-key" };

    private readonly BillingReadFixture _fixture = fixture;

    private static string GetOnePath(Guid id) => $"/billing/invoices/{id}";

    // Flag ON (routes mapped) + trusts the locally-minted JWKS + points at the fixture DB.
    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:BillingReadEnabled", "true");
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

    // Flag left at its DEFAULT (false) — relies on the PlatformOptions default so flipping it to true
    // makes the 404 cases fail (the intended dark-by-default bite). Placeholder DB (lazy DbContext).
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ---- 200: billing:read grant returns real data on BOTH endpoints -------------------------------
    [Fact]
    public async Task GrantedStaff_List_Is200_WithItems()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("items", body);
        Assert.Contains(BillingReadFixture.InvoiceI1.ToString(), body);
        // FIX3: OrgA has 4 invoices < the default take 20 → last page → nextCursor OMITTED (never null).
        Assert.DoesNotContain("nextCursor", body);
        // FIX2: listInvoices has no include → the nested subscription key is ABSENT from every row.
        Assert.DoesNotContain("\"subscription\":", body);
        // FIX1: no schemaVersion on the billing wire (raw Prisma row).
        Assert.DoesNotContain("schemaVersion", body);
    }

    [Fact]
    public async Task GrantedStaff_GetInvoice_Is200_WithNestedSubscription()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, GetOnePath(BillingReadFixture.InvoiceI1), Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("schemaVersion", body); // FIX1: no schemaVersion on the billing wire
        Assert.Contains("\"subscription\":", body); // getInvoice includes the nested subscription
    }

    [Fact]
    public async Task GrantedStaff_GetInvoice_WithoutSubscription_EmitsSubscriptionNull()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, GetOnePath(BillingReadFixture.InvoiceI2), Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // FIX2: getInvoice ALWAYS emits the subscription key — null when the invoice has none (never omitted).
        Assert.Contains("\"subscription\":null", body);
    }

    [Fact]
    public async Task GrantedStaff_GetInvoice_UnknownId_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, GetOnePath(Guid.NewGuid()), Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- 403: resolvable staff whose roles LACK billing:read ---------------------------------------
    [Theory]
    [InlineData(ListPath)]
    [InlineData("/billing/invoices/d0000000-0000-0000-0000-000000000001")]
    public async Task NoGrantStaff_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(BillingReadFixture.NoGrantUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token / tampered JWT / valid-signature-but-sub-not-staff --------------------------
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new()
    {
        null,
        TamperedBearer,
    };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_List_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, ListPath, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        // A validly-signed JWT whose sub is not an active staff/owner row → ctx.user === null → 401.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, Mint("sub-with-no-user-row"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 (bite: flipping the default
    // to true makes these fail). ---------------------------------------------------------------------
    [Fact]
    public async Task ListRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ListPath);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetInvoiceRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(GetOnePath(BillingReadFixture.InvoiceI1));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ---
    [Fact]
    public async Task ListRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ListPath);

        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
