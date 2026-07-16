namespace Tims.Domain.Audit;

/// <summary>
/// A single sensitive read/export/update to be appended to data_access_logs — a faithful port of
/// the TS <c>DataAccessEvent</c> (packages/api/src/access/audit.ts). <see cref="Entity"/> becomes the
/// row's <c>data_type</c>; <see cref="ActorId"/> is the resolved actor (the real owner under
/// impersonation — see AuditActor.ActorFor). Ids are strings to mirror the TS surface; the writer
/// parses them to the underlying uuid columns.
/// </summary>
public sealed record DataAccessEvent(
    string OrganizationId,
    string ActorId,
    string Entity,
    string RecordId,
    AuditAction Action,
    string? IpAddress = null,
    string? UserAgent = null);
