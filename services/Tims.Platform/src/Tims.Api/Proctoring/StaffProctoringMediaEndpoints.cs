using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.Proctoring;
using Tims.Infrastructure.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// Audited, scope-limited reviewer access to sampled stills and detector cues.
/// URLs are issued only for sealed, unexpired objects and last at most 55 seconds.
/// </summary>
public static class StaffProctoringMediaEndpoints
{
    public static void MapStaffProctoringMediaEndpoints(this WebApplication app)
    {
        app.MapGet("/proctoring/assignments/{assignmentId:guid}/media", ListMediaAsync)
            .RequireAuthorization().WithName("ListProctoringMedia")
            .WithTags("Proctoring").Produces<StaffMediaResponse>()
            .Produces(401).Produces(403).Produces(404);
        app.MapGet("/proctoring/assignments/{assignmentId:guid}/media/{evidenceId:guid}/view",
                CreateReadGrantAsync)
            .RequireAuthorization().WithName("ViewProctoringMedia")
            .WithTags("Proctoring").Produces<StaffMediaReadResponse>()
            .Produces(401).Produces(403).Produces(404);
    }

    private static async Task<IResult> ListMediaAsync(
        Guid assignmentId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store,
        CancellationToken ct)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(user, http,
            resolver, permissions, options.Value, "read", ct);
        if (gate.Failure is not null) return gate.Failure;
        try
        {
            var context = gate.Context!;
            var scope = await store.ResolveScopeAsync(Guid.Parse(context.OrganizationId),
                Guid.Parse(context.UserId), context.PrincipalType, "read", ct);
            var result = await store.ListMediaAsync(scope, assignmentId,
                Guid.Parse(AuditActor.ActorFor(context)), http.ClientIpFor(),
                UserAgent(http), ct);
            NoStore(http);
            return Results.Ok(result);
        }
        catch (StaffProctoringFailure failure) { return Failure(failure); }
    }

    private static async Task<IResult> CreateReadGrantAsync(
        Guid assignmentId, Guid evidenceId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store,
        IProctoringEvidenceStore objectStore, CancellationToken ct)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(user, http,
            resolver, permissions, options.Value, "read", ct);
        if (gate.Failure is not null) return gate.Failure;
        try
        {
            var context = gate.Context!;
            var scope = await store.ResolveScopeAsync(Guid.Parse(context.OrganizationId),
                Guid.Parse(context.UserId), context.PrincipalType, "read", ct);
            var media = await store.GetMediaForReadAsync(scope, assignmentId, evidenceId,
                Guid.Parse(AuditActor.ActorFor(context)), http.ClientIpFor(),
                UserAgent(http), ct);
            var now = DateTime.UtcNow;
            var expiresAt = media.ExpiresAt < now.AddSeconds(55)
                ? media.ExpiresAt : now.AddSeconds(55);
            if (expiresAt <= now.AddSeconds(2))
                return Results.NotFound(new { error = "evidence_unavailable" });
            var grant = await objectStore.CreateReadGrantAsync(media.SealedObjectKey,
                media.ContentType, expiresAt, ct);
            NoStore(http);
            return Results.Ok(new StaffMediaReadResponse(media.EvidenceId,
                media.ContentType, grant.Url, grant.ExpiresAt));
        }
        catch (StaffProctoringFailure failure) { return Failure(failure); }
    }

    private static void NoStore(HttpContext http)
    {
        http.Response.Headers.CacheControl = "no-store, private";
        http.Response.Headers.Pragma = "no-cache";
    }

    private static IResult Failure(StaffProctoringFailure failure) =>
        Results.Json(new { error = failure.Code }, statusCode: failure.StatusCode);

    private static string? UserAgent(HttpContext http)
    {
        var value = http.Request.Headers.UserAgent.ToString();
        return value.Length == 0 ? null : value[..Math.Min(value.Length, 512)];
    }
}

public sealed record StaffMediaReadResponse(Guid EvidenceId,
    string ContentType, string Url, DateTime ExpiresAt);
