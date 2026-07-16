namespace Tims.Application.ExternalVendor;

/// <summary>
/// Thrown by <see cref="ExternalValidationSubmitUseCase"/> when the read gate finds no validation with the
/// given id in the caller's org — the C# equivalent of the TS
/// <c>TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' })</c>. A cross-org / missing id
/// both land here indistinguishably (IDOR-safe). The API layer maps this to a 404 with the same message.
/// </summary>
public sealed class ExternalValidationNotFoundException()
    : Exception(NotFoundMessage)
{
    public const string NotFoundMessage = "Validacion no encontrada";
}

/// <summary>
/// Thrown when the atomic pending-only write matched 0 rows (INV-4): the validation is gone, not this org,
/// or already finalized — the C# equivalent of the TS
/// <c>TRPCError({ code: 'CONFLICT', message: 'La validacion no esta abierta para envio de resultados' })</c>.
/// The API layer maps this to a 409 with the same message.
/// </summary>
public sealed class ExternalValidationConflictException()
    : Exception(ConflictMessage)
{
    public const string ConflictMessage = "La validacion no esta abierta para envio de resultados";
}
