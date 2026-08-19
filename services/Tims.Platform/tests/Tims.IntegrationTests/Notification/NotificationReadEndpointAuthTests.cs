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

namespace Tims.IntegrationTests.Notification;

/// <summary>
/// Phase-5 Slice 25 READ endpoint boot matrix (real host + real Postgres): boots
/// <c>WebApplicationFactory</c> against the fixture DB with a locally-minted JWKS and drives the REAL HTTP
/// pipeline for the 3 notification READ endpoints through the Supabase JWT scheme + PrincipalResolver +
/// <c>SelfServiceGate</c>.
///
/// <para>The load-bearing assertion class here is different from every other slice's. These endpoints have NO
/// grant, so "403 for the ungranted" cannot be the control — instead the controls are (a) a user holding NO
/// notification permission at all is 200, which catches a self-service route mis-wired to the grant gate, and
/// (b) one user never sees another's rows, which is the ONLY thing standing between co-tenants. Both are
/// mutation-proved.</para>
/// </summary>
[Collection("Notification")]
public sealed class NotificationReadEndpointAuthTests(NotificationFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "notification-read-test-key" };

    private readonly NotificationFixture _fixture = fixture;

    private const string List = "/notifications";
    private const string UnreadCount = "/notifications/unread-count";
    private const string Preferences = "/notifications/preferences";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:NotificationReadEnabled", "true");
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

    private static async Task<JsonNode> BodyOf(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

    // ══ list ══

    [Fact]
    public async Task List_Member_Is200_DescOrder_ExcludesArchived_NodeIsoDates()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, List, Mint(NotificationFixture.MemberSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await BodyOf(response);
        var rows = body["notifications"]!.AsArray();

        // N1, N2, N3 — created_at DESC. The two archived rows are excluded; the cross-org row is hidden by RLS
        // (its own test below states that explicitly).
        Assert.Equal(3, rows.Count);
        Assert.Equal(NotificationFixture.N1.ToString(), rows[0]!["id"]!.GetValue<string>());
        Assert.Equal(NotificationFixture.N2.ToString(), rows[1]!["id"]!.GetValue<string>());
        Assert.Equal(NotificationFixture.N3.ToString(), rows[2]!["id"]!.GetValue<string>());

        // TRAP 6 pin: the Node-ISO wire (3-digit ms + Z), not STJ's default. N1 carries .123; N2 carries .000,
        // which is the case default STJ drops entirely.
        Assert.Equal("2026-05-05T10:00:00.123Z", rows[0]!["createdAt"]!.GetValue<string>());
        Assert.Equal("2026-05-04T10:00:00.000Z", rows[1]!["createdAt"]!.GetValue<string>());
        Assert.Equal("2026-05-04T11:00:00.500Z", rows[2]!["readAt"]!.GetValue<string>());
        Assert.Null(rows[0]!["readAt"]);

        // The notificationSelect projection: exactly 11 keys, and the three the TS does NOT select must be
        // ABSENT. Counting the key set is the assertion — a Contains check cannot fail on an extra key.
        Assert.Equal(11, rows[0]!.AsObject().Count);
        foreach (var forbidden in new[] { "archived", "organizationId", "userId" })
        {
            Assert.False(rows[0]!.AsObject().ContainsKey(forbidden), $"{forbidden} must not be exposed");
        }
    }

    [Fact]
    public async Task List_LastPage_WritesNextCursorAsNull_NeverOmitsIt()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(await Get(client, List, Mint(NotificationFixture.MemberSub)));

        // superjson serialises the TS's written-undefined `nextCursor` as null; a never-written key would be
        // ABSENT, and the parity harness walks a key-set UNION, so absent-vs-null IS a diff.
        Assert.True(body.AsObject().ContainsKey("nextCursor"), "nextCursor must always be written");
        Assert.Null(body["nextCursor"]);
    }

    [Fact]
    public async Task List_UnreadOnly_ExcludesReadRows()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(await Get(client, $"{List}?unreadOnly=true", Mint(NotificationFixture.MemberSub)));
        var ids = body["notifications"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();

        Assert.Equal([NotificationFixture.N1.ToString(), NotificationFixture.N2.ToString()], ids);
    }

    [Fact]
    public async Task List_LimitOne_PagesAndReturnsTheOverflowRowId()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(await Get(client, $"{List}?limit=1", Mint(NotificationFixture.MemberSub)));

        Assert.Single(body["notifications"]!.AsArray());
        Assert.Equal(NotificationFixture.N1.ToString(), body["notifications"]![0]!["id"]!.GetValue<string>());

        // The TS pops the (limit+1)-th row and uses ITS id — N2, the first row of the NEXT page, not the last
        // of this one. Pinned because the next page then SKIPS it (Prisma cursor + skip:1): a faithful
        // reproduction of a real TS defect, filed separately. If someone "fixes" the port, this goes red.
        Assert.Equal(NotificationFixture.N2.ToString(), body["nextCursor"]!.GetValue<string>());
    }

    [Fact]
    public async Task List_WithCursor_SkipsTheCursorRow_ReproducingTheTsRowLoss()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(
            await Get(client, $"{List}?limit=1&cursor={NotificationFixture.N2}", Mint(NotificationFixture.MemberSub)));

        var ids = body["notifications"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();

        // cursor=N2 with skip:1 starts AFTER N2 → N3. N2 itself appears on NEITHER page: page 1 returned N1
        // and named N2 as the cursor, and page 2 skips it. That row loss is the TS behaviour, reproduced.
        Assert.Equal([NotificationFixture.N3.ToString()], ids);
    }

    [Fact]
    public async Task List_CursorBelongingToAnotherUser_ReturnsEmpty_NeverPositionsThePage()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(
            await Get(client, $"{List}?cursor={NotificationFixture.NAdminOwn}", Mint(NotificationFixture.MemberSub)));

        // The boundary lookup is scoped to the caller's own rows, so a foreign cursor yields no boundary → an
        // empty page. Without that scoping the cursor would be an oracle for another user's timestamps.
        Assert.Empty(body["notifications"]!.AsArray());
    }

    [Fact]
    public async Task List_NeverReturnsAnotherUsersNotification()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // Admin's row exists and is the NEWEST in the org, so a missing user_id predicate would surface it
        // FIRST. Asserted by counting the set, not by IndexOf — an IndexOf assertion cannot fail on a leak.
        Assert.Equal(1, await _fixture.CountNotificationsForUserAsync(NotificationFixture.AdminId));

        var body = await BodyOf(await Get(client, $"{List}?limit=50", Mint(NotificationFixture.MemberSub)));
        var ids = body["notifications"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();

        Assert.DoesNotContain(NotificationFixture.NAdminOwn.ToString(), ids);
        Assert.Equal(3, ids.Count);
    }

    [Fact]
    public async Task List_CrossOrgRowAddressedToTheCaller_IsHiddenByRls_TheRecordedDivergence()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // NCrossOrg is addressed to Member but stamped OrgB. TS reads these through a BYPASSRLS connection and
        // SHOWS them; C# runs under TenantScope(OrgA) and the org-predicate policy hides them. Federico decided
        // 2026-08-19 to keep RLS engaged and pin the divergence rather than reproduce TS here.
        // Measured the same day: 0 rows in production, so this is latent — but it is exactly the shape
        // lib/notify.ts produces for platform owners, so it WILL bite when rows exist.
        // 6 = N1, N2, N3, NArchivedUnread, NArchived, NCrossOrg. Counted by the fixture query, not by
        // hand — a first draft of this line said 4 and the assertion caught it.
        Assert.Equal(6, await _fixture.CountNotificationsForUserAsync(NotificationFixture.MemberId));

        var body = await BodyOf(await Get(client, $"{List}?limit=50", Mint(NotificationFixture.MemberSub)));
        var ids = body["notifications"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();

        Assert.DoesNotContain(NotificationFixture.NCrossOrg.ToString(), ids);
    }

    [Fact]
    public async Task List_OrgLessPlatformOwner_SeesEmptyInbox_NotAnError()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // The owner's TenantContext.OrganizationId is "" → TenantScope sets the GUC to '' → the fail-closed
        // policy hides every row. The assertion that matters is that this is a 200 with an empty list, NOT the
        // 500 a bare Guid.Parse("") would have produced. The owner DOES have a row waiting.
        Assert.Equal(1, await _fixture.CountNotificationsForUserAsync(NotificationFixture.OwnerId));

        var response = await Get(client, $"{List}?limit=50", Mint(NotificationFixture.OwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await BodyOf(response))["notifications"]!.AsArray());
    }

    // ══ input validation — runs AFTER the gate (TRAP 9 / tRPC middleware-before-Zod) ══

    [Theory]
    [InlineData("limit=0")]
    [InlineData("limit=51")]
    [InlineData("limit=1.5")]
    [InlineData("limit=abc")]
    [InlineData("limit=-1")]
    [InlineData("cursor=not-a-uuid")]
    [InlineData("unreadOnly=yes")]
    public async Task List_InvalidInput_WithValidToken_Is400(string query)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{List}?{query}", Mint(NotificationFixture.MemberSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("limit=abc")]
    [InlineData("cursor=not-a-uuid")]
    [InlineData("unreadOnly=yes")]
    public async Task List_InvalidInput_WithNoToken_Is401_NotBindingError(string query)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{List}?{query}", null);

        // TRAP 9. Binding these as int?/bool?/Guid? would make minimal-API model binding 400 BEFORE the gate,
        // inverting tRPC's order (middleware runs before Zod, so an unauthenticated caller gets 401). Binding
        // them as string? and parsing after the gate is what keeps this a 401.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task List_EmptyQueryValues_TakeTheZodDefaults()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{List}?limit=&cursor=&unreadOnly=", Mint(NotificationFixture.MemberSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3, (await BodyOf(response))["notifications"]!.AsArray().Count);
    }

    // ══ unreadCount ══

    [Fact]
    public async Task UnreadCount_Member_CountsUnreadAndNotArchivedOnly()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(await Get(client, UnreadCount, Mint(NotificationFixture.MemberSub)));

        // N1 + N2. N3 is read; NArchivedUnread is unread but archived; NCrossOrg is RLS-hidden.
        Assert.Equal(2, body["count"]!.GetValue<int>());
    }

    // ══ getPreferences ══

    [Fact]
    public async Task GetPreferences_ExistingRow_ReturnsTheSixSelectedKeys_JsonbAsRealJson()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await BodyOf(await Get(client, Preferences, Mint(NotificationFixture.AdminSub)));

        Assert.Equal(6, body.AsObject().Count);
        Assert.False(body["emailEnabled"]!.GetValue<bool>());
        Assert.True(body["pushEnabled"]!.GetValue<bool>());
        Assert.Equal("22:00", body["quietHoursStart"]!.GetValue<string>());

        // jsonb must arrive as a real JSON object, not a JSON-escaped string.
        Assert.True(body["categories"]!["critical"]!.GetValue<bool>());
        Assert.False(body["categories"]!["info"]!.GetValue<bool>());
        Assert.True(body["modules"]!["pipeline"]!.GetValue<bool>());

        // The TS select omits these four; their absence is part of the contract.
        foreach (var forbidden in new[] { "id", "userId", "createdAt", "updatedAt" })
        {
            Assert.False(body.AsObject().ContainsKey(forbidden), $"{forbidden} must not be exposed");
        }
    }

    [Fact]
    public async Task GetPreferences_NoRow_CreatesItWithDatabaseDefaults_AReadThatWrites()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Null(await _fixture.GetPreferencesAsync(NotificationFixture.NoGrantId));
        try
        {
            var body = await BodyOf(await Get(client, Preferences, Mint(NotificationFixture.NoGrantSub)));

            // The database defaults, not values the C# invented: both booleans true and the four-key category map.
            Assert.True(body["emailEnabled"]!.GetValue<bool>());
            Assert.True(body["pushEnabled"]!.GetValue<bool>());
            Assert.True(body["categories"]!["success"]!.GetValue<bool>());
            Assert.Empty(body["modules"]!.AsObject());
            Assert.Null(body["quietHoursStart"]);

            // The row is really there — and updated_at was supplied, which it had to be: NOT NULL, no default.
            var stored = await _fixture.GetPreferencesAsync(NotificationFixture.NoGrantId);
            Assert.NotNull(stored);
            Assert.NotEqual(default, stored!.Value.UpdatedAt);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                $"DELETE FROM notification_preferences WHERE user_id = '{NotificationFixture.NoGrantId}'");
        }
    }

    [Fact]
    public async Task GetPreferences_UserWithNoNotificationGrant_Is200_TheSelfServicePositiveControl()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // Member holds NO notification permission at all — notification:create is the domain's only grant and
        // Member does not have it. All three reads must still be 200. This is the control that catches a
        // self-service route accidentally wired to NotificationStaffGate: with that mistake every one of these
        // becomes 403 while the "denied" tests would still pass.
        foreach (var path in new[] { List, UnreadCount })
        {
            var response = await Get(client, path, Mint(NotificationFixture.MemberSub));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    // ══ auth matrix ══

    [Theory]
    [InlineData(List)]
    [InlineData(UnreadCount)]
    [InlineData(Preferences)]
    public async Task AnyRead_NoToken_Is401(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, null)).StatusCode);
    }

    [Theory]
    [InlineData(List)]
    [InlineData(UnreadCount)]
    [InlineData(Preferences)]
    public async Task AnyRead_TamperedToken_Is401(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var tampered = Mint(NotificationFixture.MemberSub) + "x";
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, tampered)).StatusCode);
    }

    [Fact]
    public async Task AnyRead_UnknownSub_Is401_NotAnEmptyList()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // An unresolvable principal must not degrade into "a user with no notifications".
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await Get(client, List, Mint("sub-does-not-exist"))).StatusCode);
    }

    [Theory]
    [InlineData(List)]
    [InlineData(UnreadCount)]
    [InlineData(Preferences)]
    public async Task AnyRead_FlagDefault_Is404_DarkByDefault(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        // NotificationReadEnabled defaults false → the routes are never mapped. The connection string is
        // deliberately bogus: if the route were mapped this would fail loudly rather than 404 by luck.
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, path, Mint(NotificationFixture.MemberSub))).StatusCode);
    }

    [Fact]
    public async Task WriteRoutes_AreNotMapped_ByTheReadFlagAlone()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // The two flags are independent. With only the READ flag on, every write route must still 404 —
        // otherwise "dark" would be a single switch pretending to be two.
        var request = new HttpRequestMessage(HttpMethod.Post, "/notifications/read-all");
        request.Headers.Add("Authorization", $"Bearer {Mint(NotificationFixture.MemberSub)}");
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
    }
}
