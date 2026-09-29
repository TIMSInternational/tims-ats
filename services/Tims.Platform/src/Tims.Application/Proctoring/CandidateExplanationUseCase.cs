using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.Proctoring;

public sealed record CandidateExplanation(
    Guid Id, string Text,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime SubmittedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ExpiresAt);

public sealed record CandidateExplanationState(
    CandidateExplanation? Explanation, bool CanSubmit,
    DateTime? ClosesAt);

public interface ICandidateExplanationRepository
{
    Task<CandidateExplanationState> GetAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, CancellationToken ct);
    Task<CandidateExplanation> SubmitAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, Guid submissionId, string text, CancellationToken ct);
}

/// <summary>Candidate text is a statement for a human reviewer, never a detector verdict.</summary>
public sealed class CandidateExplanationUseCase(ICandidateExplanationRepository repository)
{
    private readonly ICandidateExplanationRepository _repository = repository;

    public Task<CandidateExplanationState> GetAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, CancellationToken ct) =>
        _repository.GetAsync(organizationId, candidateId, assignmentId, ct);

    public Task<CandidateExplanation> SubmitAsync(Guid organizationId, Guid candidateId,
        Guid assignmentId, Guid submissionId, string? text, CancellationToken ct)
    {
        var trimmed = text?.Trim();
        if (submissionId == Guid.Empty || trimmed is not { Length: >= 1 and <= 2000 }
            || trimmed.Any(c => c == '\0' || char.IsControl(c) && c is not ('\n' or '\r' or '\t')))
            throw new ProctoringException(ProctoringError.InvalidInput, "explanation_invalid");
        return _repository.SubmitAsync(organizationId, candidateId, assignmentId,
            submissionId, trimmed, ct);
    }
}
