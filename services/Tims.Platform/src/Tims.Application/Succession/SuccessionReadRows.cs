using Tims.Domain.Succession;

namespace Tims.Application.Succession;

/// <summary>listCriticalRoles input filters (all optional; each only intersects the org + scope where).</summary>
public sealed record CriticalRoleFilters(
    Guid? CompanyId,
    Guid? UnitId,
    string? Criticality,
    string? Search);

/// <summary>getCompGapAlerts repo bundle: the candidate roles, the matched salary bands, and the (field-auth
/// filtered) compensations — fed verbatim to <see cref="SuccessionKernels.BuildCompGapAlerts"/>.</summary>
public sealed record CompGapData(
    IReadOnlyList<CompGapRoleInput> Roles,
    IReadOnlyList<CompGapBandInput> Bands,
    IReadOnlyList<CompGapCompInput> Comps);

/// <summary>getSuggestedSuccessors repo bundle: the scope-filtered evaluations (pre-ordered) + the ids of
/// users already a successor for the role — fed to <see cref="SuccessionKernels.BuildSuggestedSuccessors"/>.</summary>
public sealed record SuggestedData(
    IReadOnlyList<SuggestedEvaluationInput> Evaluations,
    IReadOnlyList<string> ExistingUserIds);

/// <summary>simulateExit repo bundle: the raw role + holder + (scope-filtered, readiness-asc) successors. The
/// use case derives the kernel decision from the successors and assembles the full response.</summary>
public sealed record ExitData(
    ExitRole Role,
    ExitHolder? Holder,
    IReadOnlyList<ExitSuccessorRow> Successors);
