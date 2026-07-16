using Tims.Domain.Audit;

namespace Tims.Application.Audit;

/// <summary>
/// The single data_access_log writer use case — a port of <c>logDataAccess</c>
/// (packages/api/src/access/audit.ts). Appends ONE data_access_logs row for a sensitive
/// read/export/update, with a failure policy keyed by data class:
///
///   - <b>fail-CLOSED</b> (restricted, e.g. salary / raw psychometrics): if the audit write fails
///     the call THROWS (<see cref="AuditWriteFailedException"/>) so the caller aborts BEFORE
///     returning the restricted data. An unauditable restricted read must not happen.
///   - <b>fail-SOFT</b> (confidential, e.g. demographics / survey answers): the write failure is
///     swallowed — losing one audit row must not block org analytics or roll back a completed write.
///
/// <paramref name="failClosed"/> OVERRIDES the data-class-derived default (which is
/// <c>DataClassification.Of(event.Entity) == Restricted</c>). This matters for tables that mix
/// classes per row: <c>assessmentResult</c> is restricted HEADLINE, but a recruiter reading only
/// the confidential score fields warrants fail-SOFT — pass <c>failClosed: false</c>. Omit
/// (<c>null</c>) to keep the data-class default.
///
/// Callers MUST await this BEFORE returning restricted data, so the throw lands before serialization.
/// </summary>
public interface IDataAccessAuditor
{
    Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default);
}
