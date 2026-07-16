namespace Tims.Domain.Hris;

/// <summary>
/// Lifecycle state of an HRIS connector. <c>Disconnected</c> is the initial state (created but not
/// yet authenticated), <c>Connected</c> once a sync has succeeded, <c>Error</c> after a failure that
/// needs operator attention. Stored as a wire string in <c>hris_connectors.status</c>.
/// </summary>
public enum ConnectorStatus
{
    Disconnected,
    Connected,
    Error,
}

public static class ConnectorStatuses
{
    public static string ToWire(this ConnectorStatus status) => status switch
    {
        ConnectorStatus.Disconnected => "disconnected",
        ConnectorStatus.Connected => "connected",
        ConnectorStatus.Error => "error",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown ConnectorStatus"),
    };

    public static bool TryParse(string? value, out ConnectorStatus status)
    {
        switch (value)
        {
            case "disconnected":
                status = ConnectorStatus.Disconnected;
                return true;
            case "connected":
                status = ConnectorStatus.Connected;
                return true;
            case "error":
                status = ConnectorStatus.Error;
                return true;
            default:
                status = default;
                return false;
        }
    }

    /// <summary>Strict parse for an EF-OWNED column value (unknown string → corruption → throw).</summary>
    public static ConnectorStatus FromWire(string value) =>
        TryParse(value, out var status)
            ? status
            : throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown ConnectorStatus wire value");

    /// <summary>
    /// Whether a background sync should run this connector. <see cref="ConnectorStatus.Error"/> means the
    /// connector needs operator attention, so it is QUARANTINED (skipped) until fixed; both
    /// <see cref="ConnectorStatus.Disconnected"/> (awaiting its first pull) and
    /// <see cref="ConnectorStatus.Connected"/> are eligible. This is the single definition of "active"
    /// the enumerate-read and the per-connector inactive guard both use.
    /// </summary>
    public static bool IsSyncable(this ConnectorStatus status) => status != ConnectorStatus.Error;
}
