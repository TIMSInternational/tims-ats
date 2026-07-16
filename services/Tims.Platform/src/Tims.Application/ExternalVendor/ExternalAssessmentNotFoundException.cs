namespace Tims.Application.ExternalVendor;

/// <summary>
/// Thrown by <see cref="ExternalAssessmentReadUseCase.GetOneAsync"/> when no completed result matches the
/// assignment id in the caller's org — the C# equivalent of the TS
/// <c>TRPCError({ code: 'NOT_FOUND', message: 'Resultado de evaluacion no encontrado' })</c>. The API
/// layer maps this to a 404 with the same Spanish message (INV-G). A cross-org / missing / non-completed
/// id all land here indistinguishably (IDOR-safe: never reveals existence outside the lifecycle gate).
/// </summary>
public sealed class ExternalAssessmentNotFoundException : Exception
{
    public const string NotFoundMessage = "Resultado de evaluacion no encontrado";

    public ExternalAssessmentNotFoundException()
        : base(NotFoundMessage) { }
}
