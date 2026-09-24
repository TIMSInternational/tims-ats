using System.Text.Json.Serialization;
using Tims.Domain.Json;
using Tims.Domain.Proctoring;

namespace Tims.Application.Proctoring;

public enum ProctoringError
{
    InvalidInput,
    NotFound,
    Forbidden,
    Conflict,
    TooManyRequests,
}

public sealed class ProctoringException(ProctoringError error, string code) : Exception(code)
{
    public ProctoringError Error { get; } = error;
    public string Code { get; } = code;
}

public sealed record ProctoringStartResult(Guid SessionId, string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime StartedAt);
public sealed record ProctoringEventResult(bool Accepted, Guid EventId);
public sealed record ProctoringHeartbeatResult(
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ServerTime, bool Active);
public sealed record ProctoringCompleteResult(Guid SessionId, string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime EndedAt);

public interface ICandidateProctoringRepository
{
    Task<Guid?> ResolveOrganizationBySlugAsync(string slug, CancellationToken ct);
    Task<ProctoringStartResult> StartAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        string? ipAddress, string? userAgent, CancellationToken ct);
    Task<ProctoringEventResult> ReportEventAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        Guid eventId, string type, string severity, DateTime? clientAt, CancellationToken ct);
    Task<ProctoringHeartbeatResult> HeartbeatAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct);
    Task<ProctoringCompleteResult> CompleteAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct);
}

/// <summary>Candidate-authenticated orchestration. Repository provides tenant transaction and RLS.</summary>
public sealed class CandidateProctoringUseCase(ICandidateProctoringRepository repository)
{
    private readonly ICandidateProctoringRepository _repository = repository;

    public Task<Guid?> ResolveOrganizationBySlugAsync(string slug, CancellationToken ct)
    {
        if (slug.Length is < 1 or > 100 || slug.Any(c => !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')))
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_org_slug");
        return _repository.ResolveOrganizationBySlugAsync(slug, ct);
    }

    public Task<ProctoringStartResult> StartAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        bool assessmentConsentAccepted, bool proctoringConsentAccepted, bool cameraReady, bool screenReady,
        string? ipAddress, string? userAgent, CancellationToken ct)
    {
        if (!assessmentConsentAccepted || !proctoringConsentAccepted)
            throw new ProctoringException(ProctoringError.InvalidInput, "consent_required");
        if (!cameraReady || !screenReady)
            throw new ProctoringException(ProctoringError.InvalidInput, "camera_and_screen_required");
        return _repository.StartAsync(orgId, candidateId, assignmentId, ipAddress,
            userAgent?.Length > 512 ? userAgent[..512] : userAgent, ct);
    }

    public Task<ProctoringEventResult> ReportEventAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        Guid eventId, string? type, DateTimeOffset? clientTimestamp, CancellationToken ct)
    {
        if (eventId == Guid.Empty || type is null || type.Length is < 1 or > 40)
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_event");
        var severity = ProctoringSignalPolicy.SeverityFor(type);
        if (severity is null)
            throw new ProctoringException(ProctoringError.InvalidInput, "invalid_event_type");
        var clientAt = clientTimestamp is null ? (DateTime?)null
            : DateTime.SpecifyKind(clientTimestamp.Value.UtcDateTime, DateTimeKind.Unspecified);
        return _repository.ReportEventAsync(orgId, candidateId, assignmentId, eventId, type, severity, clientAt, ct);
    }

    public Task<ProctoringHeartbeatResult> HeartbeatAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct) => _repository.HeartbeatAsync(orgId, candidateId, assignmentId, ct);

    public Task<ProctoringCompleteResult> CompleteAsync(Guid orgId, Guid candidateId, Guid assignmentId,
        CancellationToken ct) => _repository.CompleteAsync(orgId, candidateId, assignmentId, ct);
}
