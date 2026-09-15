using System.Text.Json;
using System.Text.Encodings.Web;
using Tims.Domain.Audit;
using Tims.Domain.Csv;
using Tims.Domain.Json;

namespace Tims.Application.Audit;

public sealed partial class TenantAuditReadUseCase
{
    // Export data is a JSON string inside a JSON response, never embedded as raw HTML.
    // Match JSON.stringify's Unicode/HTML-character behavior for downloadable JSON.
    private static readonly JsonSerializerOptions ExportJsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public async Task<TenantAuditExport> ExportAsync(Guid organizationId, TenantAuditFilter filter,
        string format, CancellationToken cancellationToken)
    {
        if (format is not ("csv" or "json")) throw new ArgumentException("Invalid export format", nameof(format));
        var rows = await repository.ExportAsync(organizationId, filter, cancellationToken);
        var records = rows.Take(10_000).Select(row => new
        {
            timestamp = NodeIsoDateTimeConverter.ToNodeIso(row.CreatedAt),
            actorName = row.ActorName,
            actorEmail = row.ActorEmail,
            action = row.Action,
            entity = row.Entity,
            entityId = row.EntityId ?? "",
            ipAddress = row.IpAddress ?? "",
            userAgent = row.UserAgent ?? "",
        }).ToList();
        var data = format == "json" ? JsonSerializer.Serialize(records, ExportJsonOptions) : string.Join('\n',
            new[] { CsvCell.Row(["Timestamp", "Actor Name", "Actor Email", "Action", "Entity", "Entity ID", "IP Address", "User Agent"]) }
            .Concat(records.Select(row => CsvCell.Row([row.timestamp, row.actorName, row.actorEmail,
                row.action, row.entity, row.entityId, row.ipAddress, row.userAgent]))));
        return new(data, records.Count, rows.Count > 10_000, format);
    }
}
