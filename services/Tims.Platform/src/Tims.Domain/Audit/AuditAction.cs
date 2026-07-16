namespace Tims.Domain.Audit;

/// <summary>
/// The action recorded on a data_access_logs row — a faithful port of the TS
/// <c>DataAccessEvent.action</c> union <c>'read' | 'export' | 'update'</c>. Stored as the
/// lowercase wire string via <see cref="AuditActionExtensions.ToWire"/>.
/// </summary>
public enum AuditAction
{
    Read,
    Export,
    Update,
}

/// <summary>Maps <see cref="AuditAction"/> to the exact lowercase string the TS layer writes.</summary>
public static class AuditActionExtensions
{
    public static string ToWire(this AuditAction action) => action switch
    {
        AuditAction.Read => "read",
        AuditAction.Export => "export",
        AuditAction.Update => "update",
        _ => throw new ArgumentOutOfRangeException(nameof(action), action, "unknown audit action"),
    };
}
