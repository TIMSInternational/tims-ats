using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Audit;
using Tims.Domain.Csv;
using Tims.Domain.Json;

namespace Tims.Api.Audit;

/// <summary>
/// The cross-org audit-log READ endpoints (Phase-5 Slice 17) — the C# port of
/// <c>platform.getCrossOrgAuditLogs</c>/<c>exportAuditLogsCsv</c>. Both gated by
/// <see cref="PlatformOwnerGate"/> (platform-owner-only; NO tenant RLS — see
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/>). Dark-by-default behind
/// <see cref="PlatformOptions.AuditLogReadEnabled"/>.
/// </summary>
public static class AuditReadEndpoints
{
    private const int DefaultTake = 20;
    private const int MaxTake = 50;
    private const int MaxFilterLength = 100;

    public static void MapAuditReadEndpoints(this WebApplication app)
    {
        app.MapGet("/audit/logs", async (
                Guid? userId, Guid? organizationId, string? action, string? entity,
                DateTime? dateFrom, DateTime? dateTo, int? take, Guid? cursor,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                IAuditReadRepository repository, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (IsTooLong(action) || IsTooLong(entity))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var resolvedTake = Math.Clamp(take ?? DefaultTake, 1, MaxTake);
                var filter = new AuditLogFilter(userId, organizationId, action, entity, dateFrom, dateTo);
                var (logs, nextCursor, total) = await repository.ListAsync(filter, resolvedTake, cursor, cancellationToken);

                return Results.Ok(new { logs, nextCursor, total });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AuditGetCrossOrgLogs");

        app.MapGet("/audit/logs/export", async (
                string? format, Guid? organizationId, string? action, string? entity,
                DateTime? dateFrom, DateTime? dateTo,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                IAuditReadRepository repository, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (IsTooLong(action) || IsTooLong(entity))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var filter = new AuditLogFilter(null, organizationId, action, entity, dateFrom, dateTo);
                var rows = await repository.ExportAsync(filter, cancellationToken);

                if (format == "json")
                {
                    return Results.Ok(new { format = "json", data = BuildJson(rows), count = rows.Count });
                }

                return Results.Ok(new { format = "csv", data = BuildCsv(rows), count = rows.Count });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AuditExportCrossOrgLogsCsv");
    }

    // Matches TS `z.string().max(100)` on `action`/`entity` in both getCrossOrgAuditLogsInput
    // and exportAuditLogsCsvInput (system.schemas.ts) — an unbounded query-string param is
    // exactly what CLAUDE.md's "bound all strings" rule forbids.
    private static bool IsTooLong(string? value) => value is not null && value.Length > MaxFilterLength;

    // Matches TS exactly (system.ts's `actorName` helper): firstName+lastName trimmed, falling
    // back to email if that's blank, falling back to "Sistema" only when there's no actor at all
    // (ActorFirstName/LastName/Email are all null exactly when the row had no actor join).
    private static string ActorName(AuditLogExportRow r)
    {
        if (r.ActorEmail is null)
        {
            return "Sistema";
        }

        var name = $"{r.ActorFirstName} {r.ActorLastName}".Trim();
        return name.Length > 0 ? name : r.ActorEmail;
    }

    private static string BuildCsv(IReadOnlyList<AuditLogExportRow> rows)
    {
        var header = CsvCell.Row(["Fecha", "Organizacion", "Actor", "Accion", "Entidad", "ID Entidad", "IP"]);
        var lines = rows.Select(r => CsvCell.Row([
            NodeIsoDateTimeConverter.ToNodeIso(r.CreatedAt),
            r.OrganizationName, // non-nullable — AuditLog.organization is a required FK relation
            ActorName(r),
            r.Action,
            r.Entity,
            r.EntityId ?? "-",
            r.IpAddress ?? "-",
        ]));
        return string.Join('\n', new[] { header }.Concat(lines));
    }

    private static object BuildJson(IReadOnlyList<AuditLogExportRow> rows) => rows.Select(r => new
    {
        date = NodeIsoDateTimeConverter.ToNodeIso(r.CreatedAt),
        organization = r.OrganizationName,
        actor = ActorName(r),
        action = r.Action,
        entity = r.Entity,
        entityId = r.EntityId,
        ip = r.IpAddress,
    });
}
