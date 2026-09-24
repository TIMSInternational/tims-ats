using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Infrastructure.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>Staff-authorized, one-assignment proctoring accommodation.</summary>
public static class StaffProctoringAccommodationEndpoints
{
    public static void MapStaffProctoringAccommodationEndpoints(this WebApplication app)
    {
        app.MapPost("/proctoring/assignments/{assignmentId}/accommodation", AccommodateAsync)
            .RequireAuthorization().WithName("AccommodateProctoringAssignment")
            .WithTags("Proctoring").Produces<StaffAccommodationResponse>()
            .Produces(400).Produces(401).Produces(403).Produces(404).Produces(409);
    }

    private static async Task<IResult> AccommodateAsync(
        string assignmentId, ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions,
        IOptions<PlatformOptions> options, StaffProctoringStore store, CancellationToken ct)
    {
        var gate = await StaffProctoringGate.AuthorizeAsync(
            user, http, resolver, permissions, options.Value, "update", ct);
        if (gate.Failure is not null) return gate.Failure;
        if (!Guid.TryParse(assignmentId, out var id)) return Results.BadRequest();

        string? reason;
        try
        {
            using var body = await ReadBodyAsync(http, ct);
            if (body is null || body.RootElement.ValueKind != JsonValueKind.Object
                || body.RootElement.EnumerateObject().Count() != 1
                || !body.RootElement.TryGetProperty("reason", out var value)
                || value.ValueKind != JsonValueKind.String)
            {
                return Results.BadRequest();
            }
            reason = value.GetString();
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }

        if (!StaffProctoringStore.IsAccommodationReason(reason)) return Results.BadRequest();

        try
        {
            var context = gate.Context!;
            var scope = await store.ResolveScopeAsync(Guid.Parse(context.OrganizationId),
                Guid.Parse(context.UserId), gate.Scope!.Value, ct);
            return Results.Ok(await store.AccommodateAsync(scope, id,
                Guid.Parse(AuditActor.ActorFor(context)), reason!,
                http.ClientIpFor(), UserAgent(http), ct));
        }
        catch (StaffProctoringFailure failure)
        {
            return Results.Json(new { error = failure.Code }, statusCode: failure.StatusCode);
        }
    }

    private static async Task<JsonDocument?> ReadBodyAsync(HttpContext http, CancellationToken ct)
    {
        const int maxBytes = 512;
        using var buffer = new MemoryStream();
        var chunk = new byte[512];
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

    private static string? UserAgent(HttpContext http)
    {
        var value = http.Request.Headers.UserAgent.ToString();
        return value.Length == 0 ? null : value[..Math.Min(value.Length, 512)];
    }
}
