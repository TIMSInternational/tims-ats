namespace Tims.Application.Audit;

/// <summary>
/// Thrown when a fail-CLOSED (restricted) audit write fails, so the caller aborts before returning
/// the restricted data. The C# analog of the TS <c>TRPCError({ code: 'INTERNAL_SERVER_ERROR', ... })</c>
/// in <c>logDataAccess</c>: it carries the SAME Spanish message and preserves the underlying write
/// failure as <see cref="Exception.InnerException"/> (the TS <c>cause</c>).
/// </summary>
public sealed class AuditWriteFailedException : Exception
{
    /// <summary>The exact TS message: "No se pudo registrar el acceso a datos restringidos; acceso abortado".</summary>
    public const string RestrictedMessage =
        "No se pudo registrar el acceso a datos restringidos; acceso abortado";

    public AuditWriteFailedException(Exception cause)
        : base(RestrictedMessage, cause)
    {
    }
}
