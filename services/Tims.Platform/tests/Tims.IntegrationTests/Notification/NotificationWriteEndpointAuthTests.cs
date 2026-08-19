using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Notification;

/// <summary>
/// Phase-5 Slice 25 WRITE endpoint boot matrix (real host + real Postgres) for the 8 mutations, across the
/// slice's TWO authorization models:
/// <list type="bullet">
///   <item><description>the six SELF-SERVICE mutations — <c>SelfServiceGate</c>, so a user with NO notification
///   grant must succeed, and one user's id must never mutate another's row (the count-0 shape, not a
///   404);</description></item>
///   <item><description><c>create</c>/<c>bulkCreate</c> — <c>notification:create</c>, so an ungranted caller is
///   403, and a garbage body must NOT pre-empt that 403 (TRAP 9: a 400 before the gate would suppress the
///   <c>authz_denied</c> audit row, since SecurityDenialAuditMiddleware records only 401/403).</description></item>
/// </list>
/// Every mutating test owns rows no other test asserts on, or restores what it changed.
/// </summary>
[Collection("Notification")]
public sealed class NotificationWriteEndpointAuthTests(NotificationFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "notification-write-test-key" };

    private readonly NotificationFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:NotificationWriteEnabled", "true");
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

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string path, string? token, string? json = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(request);
    }

    private static async Task<int> CountOf(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!["count"]!.GetValue<int>();

    // ══ markAsRead ══

    [Fact]
    public async Task MarkAsRead_OwnUnreadRow_SetsReadAndReadAt_Returns1()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Post, $"/notifications/{NotificationFixture.N2}/read",
                Mint(NotificationFixture.MemberSub));

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(1, await CountOf(response));

            var state = await _fixture.GetNotificationStateAsync(NotificationFixture.N2);
            Assert.True(state!.Value.Read);
            Assert.NotNull(state.Value.ReadAt);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                $"UPDATE notifications SET read = false, read_at = NULL WHERE id = '{NotificationFixture.N2}'");
        }
    }

    [Fact]
    public async Task MarkAsRead_AnotherUsersRow_Returns0_AndDoesNotMutateIt()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var before = await _fixture.GetNotificationStateAsync(NotificationFixture.NAdminOwn);
        var response = await Send(
            client, HttpMethod.Post, $"/notifications/{NotificationFixture.NAdminOwn}/read",
            Mint(NotificationFixture.MemberSub));

        // The TS returns the updateMany BatchPayload verbatim, so a row the caller does not own is {count:0},
        // NOT a 404 — which is also what stops the endpoint confirming that someone else's id exists.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, await CountOf(response));

        var after = await _fixture.GetNotificationStateAsync(NotificationFixture.NAdminOwn);
        Assert.Equal(before!.Value.Read, after!.Value.Read);
        Assert.Equal(before.Value.ReadAt, after.Value.ReadAt);
    }

    [Fact]
    public async Task MarkAsRead_UnknownId_Returns0()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/read", Mint(NotificationFixture.MemberSub));

        Assert.Equal(0, await CountOf(response));
    }

    // ══ markAllAsRead ══

    [Fact]
    public async Task MarkAllAsRead_IncludesArchivedUnread_TheTsWhereHasNoArchivedFilter()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Post, "/notifications/read-all", Mint(NotificationFixture.MemberSub));

            // N1 + N2 + NArchivedUnread = 3. The archived-unread row IS marked read: the TS where is
            // { userId, read: false } with NO archived filter, so a count of 2 would mean the port added one.
            Assert.Equal(3, await CountOf(response));
            Assert.True((await _fixture.GetNotificationStateAsync(NotificationFixture.NArchivedUnread))!.Value.Read);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                "UPDATE notifications SET read = false, read_at = NULL WHERE id IN "
                + $"('{NotificationFixture.N1}','{NotificationFixture.N2}','{NotificationFixture.NArchivedUnread}')");
        }
    }

    // ══ archive / archiveAllRead ══

    [Fact]
    public async Task Archive_OwnRow_SetsArchived()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Post, $"/notifications/{NotificationFixture.N1}/archive",
                Mint(NotificationFixture.MemberSub));

            Assert.Equal(1, await CountOf(response));
            Assert.True((await _fixture.GetNotificationStateAsync(NotificationFixture.N1))!.Value.Archived);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                $"UPDATE notifications SET archived = false WHERE id = '{NotificationFixture.N1}'");
        }
    }

    [Fact]
    public async Task ArchiveAllRead_ArchivesOnlyReadAndNotYetArchived()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Post, "/notifications/archive-read", Mint(NotificationFixture.MemberSub));

            // Only N3 (read, not archived). NArchived is read but already archived; N1/N2 are unread.
            Assert.Equal(1, await CountOf(response));
            Assert.True((await _fixture.GetNotificationStateAsync(NotificationFixture.N3))!.Value.Archived);
            Assert.False((await _fixture.GetNotificationStateAsync(NotificationFixture.N1))!.Value.Archived);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                $"UPDATE notifications SET archived = false WHERE id = '{NotificationFixture.N3}'");
        }
    }

    // ══ delete ══

    [Fact]
    public async Task Delete_AnotherUsersRow_Returns0_AndTheRowSurvives()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, $"/notifications/{NotificationFixture.NAdminOwn}",
            Mint(NotificationFixture.MemberSub));

        Assert.Equal(0, await CountOf(response));
        Assert.NotNull(await _fixture.GetNotificationStateAsync(NotificationFixture.NAdminOwn));
    }

    [Fact]
    public async Task Delete_OwnRow_HardDeletesIt()
    {
        var scratch = Guid.NewGuid();
        await _fixture.ExecuteAsync(
            "INSERT INTO notifications (id, organization_id, user_id, type, title, created_at) VALUES "
            + $"('{scratch}', '{NotificationFixture.OrgA}', '{NotificationFixture.MemberId}', 'info', 'scratch', "
            + "'2026-05-09 10:00:00')");

        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, $"/notifications/{scratch}", Mint(NotificationFixture.MemberSub));

        Assert.Equal(1, await CountOf(response));
        Assert.Null(await _fixture.GetNotificationStateAsync(scratch));
    }

    // ══ updatePreferences ══

    [Fact]
    public async Task UpdatePreferences_PartialBody_WritesOnlySentKeys_AndReturnsTwoKeys()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.AdminSub),
                """{"pushEnabled": false}""");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

            // The TS upsert selects ONLY these two — reproducing that narrowness is the point.
            Assert.Equal(2, body.AsObject().Count);
            Assert.False(body["pushEnabled"]!.GetValue<bool>());
            Assert.False(body["emailEnabled"]!.GetValue<bool>());

            // emailEnabled/categories/quietHoursStart were NOT sent, so they must be untouched.
            var stored = await _fixture.GetPreferencesAsync(NotificationFixture.AdminId);
            Assert.False(stored!.Value.EmailEnabled);
            Assert.Equal("22:00", stored.Value.QuietStart);
            Assert.Contains("\"critical\": true", stored.Value.Categories);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                "UPDATE notification_preferences SET push_enabled = true "
                + $"WHERE user_id = '{NotificationFixture.AdminId}'");
        }
    }

    [Fact]
    public async Task UpdatePreferences_ExplicitNullQuietHours_WritesNull_WhileOmittingItDoesNot()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            // .nullable().optional() — an explicitly sent null CLEARS the column.
            await Send(
                client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.AdminSub),
                """{"quietHoursStart": null}""");
            Assert.Null((await _fixture.GetPreferencesAsync(NotificationFixture.AdminId))!.Value.QuietStart);

            // ...while OMITTING the key leaves the stored value alone. Both halves are needed: without the
            // second, a repository that always wrote NULL would pass the first.
            await _fixture.ExecuteAsync(
                "UPDATE notification_preferences SET quiet_hours_start = '23:30' "
                + $"WHERE user_id = '{NotificationFixture.AdminId}'");
            await Send(
                client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.AdminSub),
                """{"emailEnabled": false}""");
            Assert.Equal("23:30", (await _fixture.GetPreferencesAsync(NotificationFixture.AdminId))!.Value.QuietStart);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                "UPDATE notification_preferences SET quiet_hours_start = '22:00' "
                + $"WHERE user_id = '{NotificationFixture.AdminId}'");
        }
    }

    [Fact]
    public async Task UpdatePreferences_NoExistingRow_InsertsWithSuppliedValueNotTheDatabaseDefault()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Null(await _fixture.GetPreferencesAsync(NotificationFixture.MemberId));
        try
        {
            // emailEnabled:false is the CLR default for bool. An EF Add with ValueGeneratedOnAdd would drop it
            // by sentinel and store the database default TRUE — the exact inversion the raw INSERT avoids.
            var response = await Send(
                client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.MemberSub),
                """{"emailEnabled": false}""");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var stored = await _fixture.GetPreferencesAsync(NotificationFixture.MemberId);
            Assert.False(stored!.Value.EmailEnabled);

            // Unsent keys took their database defaults on insert.
            Assert.True(stored.Value.PushEnabled);
            Assert.Contains("\"success\": true", stored.Value.Categories);
        }
        finally
        {
            await _fixture.ExecuteAsync(
                $"DELETE FROM notification_preferences WHERE user_id = '{NotificationFixture.MemberId}'");
        }
    }

    [Fact]
    public async Task UpdatePreferences_EmptyBody_Is200_EveryKeyIsOptional()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.AdminSub));

        // ReadFromJsonAsync rejects an EMPTY body as malformed, which would be a 400 for an input whose every
        // key is .optional(). Zod parses `{}` here, so the endpoint must too.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"emailEnabled": "yes"}""")]
    [InlineData("""{"emailEnabled": null}""")]
    [InlineData("""{"categories": {"a": "not-a-bool"}}""")]
    [InlineData("""{"categories": []}""")]
    [InlineData("""{"quietHoursStart": "12345678901"}""")]
    [InlineData("not json at all")]
    public async Task UpdatePreferences_InvalidBody_Is400(string json)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, "/notifications/preferences", Mint(NotificationFixture.AdminSub), json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ the self-service positive control ══

    [Fact]
    public async Task SelfServiceMutations_UserWithNoNotificationGrant_AreNot403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(NotificationFixture.MemberSub);

        // Member holds NO notification grant. Every self-service mutation must still work — this is what
        // catches one of them being wired to NotificationStaffGate, which the 403 tests below cannot see.
        foreach (var (method, path) in new (HttpMethod, string)[]
                 {
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/read"),
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/archive"),
                     (HttpMethod.Delete, $"/notifications/{Guid.NewGuid()}"),
                 })
        {
            var response = await Send(client, method, path, token);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    // ══ create / bulkCreate — the grant gate ══

    [Fact]
    public async Task Create_GrantedAdmin_Returns201ShapedRow_WithTheSelectProjection()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            var response = await Send(
                client, HttpMethod.Post, "/notifications", Mint(NotificationFixture.AdminSub),
                $$"""
                  {"userId":"{{NotificationFixture.MemberId}}","type":"success","title":"Created",
                   "message":"hello","module":"platform"}
                  """);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

            Assert.Equal(11, body.AsObject().Count);
            Assert.Equal("success", body["type"]!.GetValue<string>());
            Assert.Equal("Created", body["title"]!.GetValue<string>());
            Assert.False(body["read"]!.GetValue<bool>());
            Assert.Null(body["readAt"]);
            Assert.Null(body["entityId"]);

            // created_at came from the column default and still serialises through the Node-ISO converter.
            Assert.EndsWith("Z", body["createdAt"]!.GetValue<string>());
        }
        finally
        {
            await _fixture.ExecuteAsync("DELETE FROM notifications WHERE title = 'Created'");
        }
    }

    [Fact]
    public async Task Create_UngrantedMember_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, "/notifications", Mint(NotificationFixture.MemberSub),
            $$"""{"userId":"{{NotificationFixture.MemberId}}","type":"info","title":"nope"}""");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Create_UngrantedMember_WithGarbageBody_Is403_NotBadRequest()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, "/notifications", Mint(NotificationFixture.MemberSub), "{ not json");

        // TRAP 9's real cost. If the body were bound/parsed before the gate this would be 400, and because
        // SecurityDenialAuditMiddleware records only 401/403, an ungranted caller could enumerate this surface
        // with a garbage body and leave NO authz_denied row behind. The 403 is what keeps the audit honest.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Create_GrantedAdmin_WithGarbageBody_Is400_TheOtherDirection()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, "/notifications", Mint(NotificationFixture.AdminSub), "{ not json");

        // Both directions pinned: without this half, a handler that answered 403 unconditionally would pass.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"userId":"not-a-uuid","type":"info","title":"t"}""")]
    [InlineData("""{"type":"info","title":"t"}""")]
    [InlineData("""{"userId":"c0000000-0000-0000-0000-000000000002","type":"nope","title":"t"}""")]
    [InlineData("""{"userId":"c0000000-0000-0000-0000-000000000002","type":"info","title":""}""")]
    public async Task Create_InvalidBody_WithGrant_Is400(string json)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, "/notifications", Mint(NotificationFixture.AdminSub), json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task BulkCreate_GrantedAdmin_InsertsOnePerId_DuplicatesNotRemoved()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        try
        {
            // The same id twice: createMany has no skipDuplicates here, so the count is 3, not 2.
            var response = await Send(
                client, HttpMethod.Post, "/notifications/bulk", Mint(NotificationFixture.AdminSub),
                $$"""
                  {"userIds":["{{NotificationFixture.MemberId}}","{{NotificationFixture.AdminId}}",
                   "{{NotificationFixture.MemberId}}"],"type":"warning","title":"Bulk"}
                  """);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(3, await CountOf(response));
        }
        finally
        {
            await _fixture.ExecuteAsync("DELETE FROM notifications WHERE title = 'Bulk'");
        }
    }

    [Theory]
    [InlineData("""{"userIds":[],"type":"info","title":"t"}""")]
    [InlineData("""{"userIds":["nope"],"type":"info","title":"t"}""")]
    [InlineData("""{"type":"info","title":"t"}""")]
    public async Task BulkCreate_InvalidBody_WithGrant_Is400(string json)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Post, "/notifications/bulk", Mint(NotificationFixture.AdminSub), json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task BulkCreate_Over500Ids_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var ids = string.Join(",", Enumerable.Range(0, 501).Select(_ => $"\"{Guid.NewGuid()}\""));
        var response = await Send(
            client, HttpMethod.Post, "/notifications/bulk", Mint(NotificationFixture.AdminSub),
            $$"""{"userIds":[{{ids}}],"type":"info","title":"t"}""");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ auth matrix ══

    [Fact]
    public async Task AnyWrite_NoToken_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        foreach (var (method, path) in new (HttpMethod, string)[]
                 {
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/read"),
                     (HttpMethod.Post, "/notifications/read-all"),
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/archive"),
                     (HttpMethod.Post, "/notifications/archive-read"),
                     (HttpMethod.Delete, $"/notifications/{Guid.NewGuid()}"),
                     (HttpMethod.Patch, "/notifications/preferences"),
                     (HttpMethod.Post, "/notifications"),
                     (HttpMethod.Post, "/notifications/bulk"),
                 })
        {
            var response = await Send(client, method, path, null);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Fact]
    public async Task AnyWrite_FlagDefault_Is404_DarkByDefault()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var token = Mint(NotificationFixture.MemberSub);

        foreach (var (method, path) in new (HttpMethod, string)[]
                 {
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/read"),
                     (HttpMethod.Post, "/notifications/read-all"),
                     (HttpMethod.Post, $"/notifications/{Guid.NewGuid()}/archive"),
                     (HttpMethod.Post, "/notifications/archive-read"),
                     (HttpMethod.Delete, $"/notifications/{Guid.NewGuid()}"),
                     (HttpMethod.Patch, "/notifications/preferences"),
                     (HttpMethod.Post, "/notifications"),
                     (HttpMethod.Post, "/notifications/bulk"),
                 })
        {
            var response = await Send(client, method, path, token);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task ReadRoutes_AreNotMapped_ByTheWriteFlagAlone()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(NotificationFixture.MemberSub);

        // With ONLY the write flag on, every read route must be unreachable. All three answer 405 rather than
        // 404, and the reason is worth recording because it is not obvious:
        //   GET /notifications            → POST /notifications exists, so the path does.
        //   GET /notifications/preferences → PATCH /notifications/preferences exists.
        //   GET /notifications/unread-count → DELETE /notifications/{id:guid} SHADOWS it. Measured, not
        //     assumed: the response carries `Allow: DELETE`. ASP.NET keeps that endpoint in the 405 candidate
        //     set even though "unread-count" fails the :guid constraint, so a 404 assertion here goes red for
        //     a routing reason that has nothing to do with the flags. (This shadowing is harmless in
        //     production — no read route and write route share a method+path — but it WILL confuse the next
        //     person who probes a 2-segment GET under /notifications.)
        foreach (var path in new[] { "/notifications", "/notifications/preferences", "/notifications/unread-count" })
        {
            var response = await Send(client, HttpMethod.Get, path, token);
            Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        }
    }
}
