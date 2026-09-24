using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Infrastructure.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// Staff-only proctoring policy and human review endpoints. These are advisory observations;
/// the API neither verifies identity nor renders an automated cheating decision.
/// </summary>
public static class StaffProctoringEndpoints
{
    public static void MapStaffProctoringEndpoints(this WebApplication app)
    {
        app.MapPost("/proctoring/types/{typeId}/policy", PolicyAsync)
            .RequireAuthorization().WithName("SetProctoringPolicy").WithTags("Proctoring")
            .Produces<StaffPolicyResponse>().Produces(400).Produces(401).Produces(403)
            .Produces(404).Produces(409);
        app.MapGet("/proctoring/reviews", QueueAsync)
            .RequireAuthorization().WithName("ListProctoringReviews").WithTags("Proctoring")
            .Produces<StaffReviewQueueResponse>().Produces(400).Produces(401).Produces(403);
        app.MapGet("/proctoring/assignments/{assignmentId}/events", EvidenceAsync)
            .RequireAuthorization().WithName("GetProctoringEvents").WithTags("Proctoring")
            .Produces<StaffEvidenceResponse>().Produces(400).Produces(401).Produces(403)
            .Produces(404);
        app.MapPost("/proctoring/assignments/{assignmentId}/review", ReviewAsync)
            .RequireAuthorization().WithName("ReviewProctoring").WithTags("Proctoring")
            .Produces<StaffReviewResponse>().Produces(400).Produces(401).Produces(403)
            .Produces(404).Produces(409);
    }

    private static async Task<IResult> PolicyAsync(
        string typeId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store, CancellationToken ct)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(
            user, http, resolver, permissions, options.Value, "update", ct);
        if (gate.Failure is not null) return gate.Failure;
        // Type policy affects every future assignment in the organization; a narrow
        // vacancy/assignment grant is insufficient to change this org-wide setting.
        if (!CanSetOrgPolicy(gate.Scope!.Value)) return Results.StatusCode(403);
        if (!Guid.TryParse(typeId, out var typeGuid)) return Results.BadRequest();
        using var body = await ReadBodyAsync(http, ct);
        if (body is null || !HasOnlyProperties(body.RootElement, "enabled")
            || !body.RootElement.TryGetProperty("enabled", out var enabled)
            || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            return Results.BadRequest();

        try
        {
            var context = gate.Context!;
            var result = await store.SetPolicyAsync(Guid.Parse(context.OrganizationId), typeGuid,
                enabled.GetBoolean(), Guid.Parse(AuditActor.ActorFor(context)),
                http.ClientIpFor(), UserAgent(http), ct);
            return Results.Ok(result);
        }
        catch (StaffProctoringFailure error) { return Failure(error); }
    }

    private static async Task<IResult> QueueAsync(
        ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store, CancellationToken ct,
        [FromQuery] string? limit = null, [FromQuery] string? cursor = null)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(
            user, http, resolver, permissions, options.Value, "read", ct);
        if (gate.Failure is not null) return gate.Failure;
        if (!TryLimit(limit, 25, 50, out var pageSize) || !TryCursor(cursor, out var cursorId))
            return Results.BadRequest();

        try
        {
            var context = gate.Context!;
            var orgId = Guid.Parse(context.OrganizationId);
            var userId = Guid.Parse(context.UserId);
            var scope = await store.ResolveScopeAsync(orgId, userId, gate.Scope!.Value, ct);
            return Results.Ok(await store.ListQueueAsync(scope,
                Guid.Parse(AuditActor.ActorFor(context)), pageSize, cursorId,
                http.ClientIpFor(), UserAgent(http), ct));
        }
        catch (StaffProctoringFailure error) { return Failure(error); }
    }

    private static async Task<IResult> EvidenceAsync(
        string assignmentId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store, CancellationToken ct,
        [FromQuery] string? limit = null, [FromQuery] string? cursor = null)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(
            user, http, resolver, permissions, options.Value, "read", ct);
        if (gate.Failure is not null) return gate.Failure;
        if (!Guid.TryParse(assignmentId, out var id)
            || !TryLimit(limit, 100, 200, out var pageSize)
            || !TryCursor(cursor, out var cursorId)) return Results.BadRequest();

        try
        {
            var context = gate.Context!;
            var scope = await store.ResolveScopeAsync(Guid.Parse(context.OrganizationId),
                Guid.Parse(context.UserId), gate.Scope!.Value, ct);
            return Results.Ok(await store.GetEvidenceAsync(scope, id,
                Guid.Parse(AuditActor.ActorFor(context)), pageSize, cursorId,
                http.ClientIpFor(), UserAgent(http), ct));
        }
        catch (StaffProctoringFailure error) { return Failure(error); }
    }

    private static async Task<IResult> ReviewAsync(
        string assignmentId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store, CancellationToken ct)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(
            user, http, resolver, permissions, options.Value, "update", ct);
        if (gate.Failure is not null) return gate.Failure;
        if (!Guid.TryParse(assignmentId, out var id)) return Results.BadRequest();
        using var body = await ReadBodyAsync(http, ct);
        if (body is null || !HasOnlyProperties(body.RootElement, "status", "notes")
            || !body.RootElement.TryGetProperty("status", out var statusValue)
            || statusValue.ValueKind != JsonValueKind.String) return Results.BadRequest();
        var status = statusValue.GetString();
        if (status is not ("clear" or "concern" or "inconclusive")) return Results.BadRequest();
        string? notes = null;
        if (body.RootElement.TryGetProperty("notes", out var notesValue))
        {
            if (notesValue.ValueKind != JsonValueKind.String) return Results.BadRequest();
            notes = notesValue.GetString()?.Trim();
            if (notes?.Length > 2000) return Results.BadRequest();
        }

        try
        {
            var context = gate.Context!;
            var scope = await store.ResolveScopeAsync(Guid.Parse(context.OrganizationId),
                Guid.Parse(context.UserId), gate.Scope!.Value, ct);
            return Results.Ok(await store.ReviewAsync(scope, id,
                Guid.Parse(AuditActor.ActorFor(context)), status, notes,
                http.ClientIpFor(), UserAgent(http), ct));
        }
        catch (StaffProctoringFailure error) { return Failure(error); }
    }

    private static bool TryLimit(string? raw, int fallback, int maximum, out int value)
    {
        if (raw is null) { value = fallback; return true; }
        return int.TryParse(raw, out value) && value >= 1 && value <= maximum;
    }

    public static bool CanSetOrgPolicy(AccessScope scope) =>
        scope is AccessScope.Company or AccessScope.Organization;

    private static bool TryCursor(string? raw, out Guid? value)
    {
        value = null;
        if (raw is null) return true;
        if (!Guid.TryParse(raw, out var parsed)) return false;
        value = parsed;
        return true;
    }

    private static bool HasOnlyProperties(JsonElement body, params string[] names) =>
        body.ValueKind == JsonValueKind.Object
        && body.EnumerateObject().All(property => names.Contains(property.Name));

    private static async Task<JsonDocument?> ReadBodyAsync(HttpContext http, CancellationToken ct)
    {
        const int maxBytes = 4096;
        using var buffer = new MemoryStream();
        var chunk = new byte[1024];
        while (true)
        {
            var count = await http.Request.Body.ReadAsync(chunk, ct);
            if (count == 0) break;
            if (buffer.Length + count > maxBytes) return null;
            buffer.Write(chunk, 0, count);
        }
        try { return JsonDocument.Parse(buffer.ToArray()); }
        catch (JsonException) { return null; }
    }

    private static IResult Failure(StaffProctoringFailure failure) =>
        Results.Json(new { error = failure.Code }, statusCode: failure.StatusCode);

    private static string? UserAgent(HttpContext http)
    {
        var value = http.Request.Headers.UserAgent.ToString();
        return value.Length == 0 ? null : value[..Math.Min(value.Length, 512)];
    }
}
