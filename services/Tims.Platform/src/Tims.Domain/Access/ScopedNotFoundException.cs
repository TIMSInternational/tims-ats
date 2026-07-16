namespace Tims.Domain.Access;

/// <summary>
/// The IDOR probe's fail-closed throw — the C# port of the
/// <c>TRPCError({ code: 'NOT_FOUND', message })</c> raised by <c>assertScoped</c>
/// (packages/api/src/access/scoped-probe.ts). NOT_FOUND (never FORBIDDEN) so the
/// response does not confirm the id exists to a narrow-scoped id-guesser.
///
/// The Spanish message is looked up from <see cref="NotFoundMessages"/>, ported
/// verbatim from the TS <c>NOT_FOUND_MESSAGES</c> record (all 21 entities).
/// </summary>
public sealed class ScopedNotFoundException(ScopedEntity entity)
    : Exception(NotFoundMessages.For(entity))
{
    /// <summary>The scoped entity whose by-id probe failed.</summary>
    public ScopedEntity Entity { get; } = entity;
}

/// <summary>
/// The 21 Spanish NOT_FOUND messages, ported 1:1 from <c>NOT_FOUND_MESSAGES</c>
/// (scoped-probe.ts). Keyed by <see cref="ScopedEntity"/>.
/// </summary>
public static class NotFoundMessages
{
    private static readonly IReadOnlyDictionary<ScopedEntity, string> Messages = new Dictionary<ScopedEntity, string>
    {
        [ScopedEntity.Vacancy] = "Vacante no encontrada",
        [ScopedEntity.Candidate] = "Candidato no encontrado",
        [ScopedEntity.Application] = "Aplicacion no encontrada",
        [ScopedEntity.Interview] = "Entrevista no encontrada",
        [ScopedEntity.Offer] = "Oferta no encontrada",
        [ScopedEntity.AssessmentAssignment] = "Asignacion no encontrada",
        [ScopedEntity.Okr] = "OKR no encontrado",
        [ScopedEntity.CoachingSession] = "Sesion de coaching no encontrada",
        [ScopedEntity.Feedback] = "Feedback no encontrado",
        [ScopedEntity.OnboardingPlan] = "Plan de onboarding no encontrado",
        [ScopedEntity.Enrollment] = "Inscripcion no encontrada",
        [ScopedEntity.Certificate] = "Certificado no encontrado",
        [ScopedEntity.NineBoxEvaluation] = "Evaluacion no encontrada",
        [ScopedEntity.Successor] = "Sucesor no encontrado",
        [ScopedEntity.CriticalRole] = "Rol critico no encontrado",
        [ScopedEntity.EmployeeCompensation] = "Compensacion no encontrada",
        [ScopedEntity.SalaryAdjustment] = "Ajuste salarial no encontrado",
        [ScopedEntity.Team] = "Equipo no encontrado",
        [ScopedEntity.ActionPlan] = "Plan de accion no encontrado",
        [ScopedEntity.LeaderCommitment] = "Compromiso no encontrado",
        [ScopedEntity.Commitment] = "Compromiso no encontrado",
    };

    /// <summary>The verbatim Spanish NOT_FOUND message for an entity.</summary>
    public static string For(ScopedEntity entity) => Messages.TryGetValue(entity, out var message)
        ? message
        : throw new ArgumentOutOfRangeException(nameof(entity), entity, "No NOT_FOUND message registered");
}
