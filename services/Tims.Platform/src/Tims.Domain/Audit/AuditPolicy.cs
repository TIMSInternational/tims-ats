namespace Tims.Domain.Audit;

/// <summary>
/// Port of <c>auditRequiredFor</c> (packages/api/src/access/audit.ts): a read/export of
/// <paramref name="entity"/> must write a data_access_logs row iff its headline data-class is
/// at least <see cref="DataClass.Confidential"/> (i.e. confidential OR restricted). public/internal
/// entities need no audit row. The integer enum values ARE the TS <c>DATA_CLASS_RANK</c>.
/// </summary>
public static class AuditPolicy
{
    public static bool AuditRequiredFor(string entity) =>
        (int)DataClassification.Of(entity) >= (int)DataClass.Confidential;
}
