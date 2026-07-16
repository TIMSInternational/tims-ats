namespace Tims.Domain.Audit;

/// <summary>
/// The rising-sensitivity data-class ladder, a faithful port of the TS
/// <c>DataClass</c> union + <c>DATA_CLASS_RANK</c> (packages/api/src/access/classification.ts).
/// The explicit integer values ARE the rank (public &lt; internal &lt; confidential &lt; restricted),
/// so callers compare <c>(int)</c> directly instead of a parallel lookup table.
///
///   - confidential/restricted reads MUST write a data_access_logs row (see
///     <see cref="AuditPolicy.AuditRequiredFor"/>).
///   - restricted reads abort if the audit write fails (fail-closed; see the audit writer).
/// </summary>
public enum DataClass
{
    Public = 0,
    Internal = 1,
    Confidential = 2,
    Restricted = 3,
}
