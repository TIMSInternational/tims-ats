using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Api.RateLimiting;
using Tims.Application.Identity;
using Tims.Application.Proctoring;
using Tims.Domain.Identity;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

public sealed class CandidateProctoringRateLimitMiddlewareTests
{
    private static readonly Guid OrgId = Guid.NewGuid();
    private static readonly Guid AssignmentId = Guid.NewGuid();
    private const string Slug = "screen-medical";

    [Fact]
    public async Task TwoResolvedCandidatesBehindOneIp_ReceiveIndependentMutationBudgets()
    {
        using var services = Services();
        var guard = Guard();
        var allowed = 0;
        var middleware = new RateLimitMiddleware(_ =>
        {
            Interlocked.Increment(ref allowed);
            return Task.CompletedTask;
        });
        var path = $"/candidate/{Slug}/assessments/{AssignmentId}/proctoring/heartbeat";

        // A real heartbeat is every few seconds, but a burst here makes the
        // shared-IP regression deterministic. Each authenticated candidate has
        // 30 mutation tokens despite the same proxy address and organization.
        var requests = Enumerable.Range(0, RateLimits.Tokens(RateLimitCategory.Mutation))
            .SelectMany(_ => new[]
            {
                Request(services, "first@tims.test", path),
                Request(services, "second@tims.test", path),
            }).ToArray();
        await Task.WhenAll(requests.Select(ctx => middleware.InvokeAsync(ctx, guard)));

        Assert.All(requests, ctx => Assert.NotEqual(StatusCodes.Status429TooManyRequests,
            ctx.Response.StatusCode));
        Assert.Equal(60, allowed);

        foreach (var email in new[] { "first@tims.test", "second@tims.test" })
        {
            var blocked = Request(services, email, path);
            await middleware.InvokeAsync(blocked, guard);
            Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
        }
    }

    [Fact]
    public async Task TwentyFiveCandidatesBehindOneIp_CanRequestAndConfirmMedia()
    {
        using var services = Services();
        var guard = Guard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);
        var requests = Enumerable.Range(1, 25)
            .SelectMany(index => new[] { "media-intents", "media-confirm" }
                .Select(action => Request(services, $"cohort{index}@tims.test",
                    $"/candidate/{Slug}/assessments/{AssignmentId}/proctoring/{action}")))
            .ToArray();

        await Task.WhenAll(requests.Select(context => middleware.InvokeAsync(context, guard)));

        Assert.All(requests, context => Assert.NotEqual(StatusCodes.Status429TooManyRequests,
            context.Response.StatusCode));
    }

    [Theory]
    [InlineData("start")]
    [InlineData("events")]
    [InlineData("heartbeat")]
    [InlineData("complete")]
    [InlineData("explanation")]
    [InlineData("media-consent")]
    [InlineData("media-stop")]
    [InlineData("media-intents")]
    [InlineData("media-confirm")]
    public async Task DynamicOrgSlugAndAssignmentSegment_CannotChooseAiOrExportTier(string action)
    {
        using var services = Services();
        var guard = Guard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);
        // Both dynamic segments contain keywords that the generic tRPC path
        // matcher treats as AI/export. Even a malformed assignment id remains
        // a non-AI URL shape; endpoint GUID validation still rejects it later.
        var path = $"/candidate/{Slug}/assessments/generate-export/proctoring/{action}";

        for (var i = 0; i < 11; i++)
        {
            var context = Request(services, "first@tims.test", path);
            await middleware.InvokeAsync(context, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        }
    }

    [Fact]
    public async Task UnauthenticatedClaimsNeverCreateCandidateIdentityBuckets()
    {
        using var services = Services();
        var guard = Guard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);
        var path = $"/candidate/{Slug}/assessments/{AssignmentId}/proctoring/events";

        for (var i = 0; i < RateLimits.Tokens(RateLimitCategory.Mutation); i++)
        {
            var email = i % 2 == 0 ? "first@tims.test" : "second@tims.test";
            var context = Request(services, email, path, authenticated: false);
            await middleware.InvokeAsync(context, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        }

        var blocked = Request(services, "second@tims.test", path, authenticated: false);
        await middleware.InvokeAsync(blocked, guard);
        Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task TransientSlugOrCandidateResolutionFailure_FallsBackToIpBudget(
        bool slugLookupFails, bool candidateLookupFails)
    {
        using var services = Services(slugLookupFails, candidateLookupFails);
        var guard = Guard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);
        var path = $"/candidate/{Slug}/assessments/{AssignmentId}/proctoring/heartbeat";

        for (var i = 0; i < RateLimits.Tokens(RateLimitCategory.Mutation); i++)
        {
            var email = i % 2 == 0 ? "first@tims.test" : "second@tims.test";
            var context = Request(services, email, path);
            await middleware.InvokeAsync(context, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        }

        var blocked = Request(services, "second@tims.test", path);
        await middleware.InvokeAsync(blocked, guard);
        Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
    }

    [Fact]
    public async Task DualStaffAndCandidateEmail_UsesStaffIdentity_AndNeverCandidateOrIpBucket()
    {
        using var services = Services();
        var guard = Guard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);
        var path = $"/candidate/{Slug}/assessments/{AssignmentId}/proctoring/events";

        // Consume the shared anonymous IP bucket first. A linked staff account
        // with a matching candidate email must still get its own staff bucket.
        for (var i = 0; i < RateLimits.Tokens(RateLimitCategory.Mutation); i++)
        {
            var anonymous = Request(services, "first@tims.test", path, authenticated: false);
            await middleware.InvokeAsync(anonymous, guard);
        }

        for (var i = 0; i < RateLimits.Tokens(RateLimitCategory.Mutation); i++)
        {
            var dual = Request(services, "dual@tims.test", path);
            await middleware.InvokeAsync(dual, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, dual.Response.StatusCode);
        }

        var staffBlocked = Request(services, "dual@tims.test", path);
        await middleware.InvokeAsync(staffBlocked, guard);
        Assert.Equal(StatusCodes.Status429TooManyRequests, staffBlocked.Response.StatusCode);

        // This candidate row deliberately has the same id as dual's candidate
        // email match. If the limiter used that row, this would be blocked too.
        var candidate = Request(services, "first@tims.test", path);
        await middleware.InvokeAsync(candidate, guard);
        Assert.NotEqual(StatusCodes.Status429TooManyRequests, candidate.Response.StatusCode);
    }

    private static RateLimitGuard Guard() => new(null,
        new InMemorySlidingWindowRateLimiter(() => 1_000_000_000, startCleanupTimer: false),
        new TestHostEnvironment(Environments.Development));

    private static ServiceProvider Services(bool slugLookupFails = false, bool candidateLookupFails = false)
    {
        var candidates = new TestCandidates(candidateLookupFails);
        return new ServiceCollection()
            .AddSingleton(new CandidateProctoringUseCase(new TestProctoringRepository(slugLookupFails)))
            .AddSingleton(new PrincipalResolver(new TestStaffRepository(), new CandidateResolver(candidates)))
            .AddSingleton<IOptions<PlatformOptions>>(Options.Create(new PlatformOptions()))
            .BuildServiceProvider();
    }

    private static DefaultHttpContext Request(
        IServiceProvider services, string email, string path, bool authenticated = true)
    {
        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = HttpMethods.Post;
        context.Request.Path = path;
        context.Request.Headers["x-forwarded-for"] = "203.0.113.44";
        context.Response.Body = new MemoryStream();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", $"supabase-{email}"), new Claim("email", email)],
            authenticated ? "Bearer" : null));
        context.Items[ResolvedPrincipal.HttpContextKey] = new ResolvedPrincipal(null);
        return context;
    }

    private sealed class TestStaffRepository : IIdentityRepository
    {
        public Task<AppUserRow?> FindBySupabaseUserIdAsync(string supabaseUserId, CancellationToken ct) =>
            Task.FromResult<AppUserRow?>(supabaseUserId == "supabase-dual@tims.test"
                ? new AppUserRow(
                    "448898fc-8603-4fdc-a5cd-d1a91d319e6e", supabaseUserId, "dual@tims.test",
                    OrgId.ToString(), true, false, ["recruiter"])
                : null);
        public Task<AppUserRow?> FindByIdAsync(string userId, CancellationToken ct) =>
            Task.FromResult<AppUserRow?>(null);
    }

    private sealed class TestCandidates(bool failLookup) : ICandidateRepository
    {
        private static readonly IReadOnlyDictionary<string, Guid> Ids = new Dictionary<string, Guid>
        {
            ["first@tims.test"] = Guid.Parse("13bf8bfd-8ebe-4a4c-8ae2-901375e287bb"),
            ["second@tims.test"] = Guid.Parse("76086562-a88b-4fdb-a00e-6a71f1b9b5a5"),
            ["dual@tims.test"] = Guid.Parse("13bf8bfd-8ebe-4a4c-8ae2-901375e287bb"),
        }.Concat(Enumerable.Range(1, 25).Select(index =>
            new KeyValuePair<string, Guid>($"cohort{index}@tims.test", new Guid(index, 0, 0, new byte[8]))))
            .ToDictionary(pair => pair.Key, pair => pair.Value);

        public Task<CandidateRow?> FindByEmailAsync(string email, string organizationId, CancellationToken ct) =>
            failLookup ? throw new InvalidOperationException("candidate lookup unavailable")
                : Task.FromResult(organizationId == OrgId.ToString() && Ids.TryGetValue(email, out var id)
                    ? new CandidateRow(id.ToString(), organizationId, email) : null);
    }

    private sealed class TestProctoringRepository(bool failLookup) : ICandidateProctoringRepository
    {
        public Task<Guid?> ResolveOrganizationBySlugAsync(string slug, CancellationToken ct) =>
            failLookup ? throw new InvalidOperationException("org lookup unavailable")
                : Task.FromResult<Guid?>(slug == Slug ? OrgId : null);

        public Task<ProctoringStartResult> StartAsync(Guid orgId, Guid candidateId, Guid assignmentId,
            string? ipAddress, string? userAgent, CancellationToken ct) => throw new NotImplementedException();
        public Task<ProctoringEventResult> ReportEventAsync(Guid orgId, Guid candidateId, Guid assignmentId,
            Guid eventId, string type, string severity, DateTime? clientAt, CancellationToken ct) =>
            throw new NotImplementedException();
        public Task<ProctoringHeartbeatResult> HeartbeatAsync(Guid orgId, Guid candidateId,
            Guid assignmentId, CancellationToken ct) => throw new NotImplementedException();
        public Task<ProctoringCompleteResult> CompleteAsync(Guid orgId, Guid candidateId,
            Guid assignmentId, CancellationToken ct) => throw new NotImplementedException();
    }
}
