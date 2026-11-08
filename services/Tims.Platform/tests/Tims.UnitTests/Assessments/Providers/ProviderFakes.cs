using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>In-memory provider: canned answers per call, and a record of every call made.</summary>
internal sealed class FakeProvider : IAssessmentProvider
{
    public const string Secret = "whsec_test_current_secret_value";

    public bool IsConfigured { get; set; } = true;

    public List<string> Calls { get; } = [];

    public List<(ProviderSubjectRequest Request, string Key)> Subjects { get; } = [];

    public List<(ProviderAssignmentRequest Request, string Key)> Assignments { get; } = [];

    public List<(Guid SubjectId, ProviderConsentRequest Request, string Key)> Consents { get; } = [];

    public Func<ProviderAssignmentRequest, ProviderCall<ProviderAssignment>>? OnCreateAssignment { get; set; }

    public Func<ProviderCall<ProviderConsentRecord>>? OnRecordConsent { get; set; }

    public Func<Guid, ProviderCall<ProviderAssignment>>? OnGetAssignment { get; set; }

    public string[] WebhookSecrets { get; set; } = [Secret];

    public Func<Guid, ProviderCall<ProviderLaunch>>? OnLaunch { get; set; }

    public Func<Guid, ProviderCall<ParsedProviderResult>>? OnGetResult { get; set; }

    public Guid TenantId { get; set; } = Guid.Parse("3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12");

    public Guid SubjectId { get; set; } = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");

    public Task<ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>> ListInstrumentsAsync(CancellationToken cancellationToken)
    {
        Calls.Add("catalog");
        IReadOnlyList<ProviderCatalogInstrument> catalog = ProviderInstruments.All
            .Select(i => new ProviderCatalogInstrument(i, [new ProviderCatalogVersion("1.0", "ga", "native", i != ProviderInstruments.Mi, ["es"], ["assessment"])]))
            .ToList();
        return Task.FromResult(ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>.Success(catalog));
    }

    public Task<ProviderCall<ProviderTenant>> EnsureTenantAsync(
        ProviderTenantRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("tenant");
        return Task.FromResult(ProviderCall<ProviderTenant>.Success(new ProviderTenant(TenantId, request.ExternalOrgRef, "active")));
    }

    /// <summary>Per external_ref, whether the subject the provider holds has names and email (first create wins).</summary>
    public Dictionary<string, bool> SubjectHasNames { get; } = new(StringComparer.Ordinal);

    // Like the real provider: idempotent on (tenant, external_ref), and an existing subject comes back UNCHANGED
    // whatever the new request carries (the contract has no subject update).
    public Task<ProviderCall<ProviderSubject>> EnsureSubjectAsync(
        ProviderSubjectRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("subject");
        Subjects.Add((request, idempotencyKey));
        if (!SubjectHasNames.TryGetValue(request.ExternalRef, out var hasNames))
        {
            hasNames = request.GivenName is not null && request.FamilyName is not null && request.Email is not null;
            SubjectHasNames[request.ExternalRef] = hasNames;
        }

        return Task.FromResult(ProviderCall<ProviderSubject>.Success(new ProviderSubject(SubjectId, "active", hasNames)));
    }

    public Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
        ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("assignment:" + request.Instrument);
        Assignments.Add((request, idempotencyKey));
        var answer = OnCreateAssignment?.Invoke(request) ?? Created(request);
        return Task.FromResult(answer);
    }

    /// <summary>The provider's success answer for a create (also usable from an <see cref="OnCreateAssignment"/> hook).</summary>
    public static ProviderCall<ProviderAssignment> Created(ProviderAssignmentRequest request) =>
        ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            Guid.NewGuid(), request.TenantId, request.SubjectId, request.Instrument, "1.0", "content-2026.11.1", "created",
            ["assessment"], ["assessment"], new DateTimeOffset(2026, 11, 23, 14, 0, 0, TimeSpan.Zero), request.ExternalRef));

    public Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        Calls.Add("get_assignment");
        return Task.FromResult(OnGetAssignment?.Invoke(assignmentId)
            ?? ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(404, "not_found", false, [])));
    }

    public Task<ProviderCall<ProviderConsentRecord>> RecordConsentAsync(
        Guid subjectId, ProviderConsentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("consent:" + request.Purpose);
        Consents.Add((subjectId, request, idempotencyKey));
        return Task.FromResult(OnRecordConsent?.Invoke()
            ?? ProviderCall<ProviderConsentRecord>.Success(new ProviderConsentRecord(Guid.NewGuid(), request.Purpose, "active")));
    }

    public Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        Calls.Add("launch");
        return Task.FromResult(OnLaunch?.Invoke(assignmentId) ?? ProviderCall<ProviderLaunch>.Success(new ProviderLaunch(
            "native", "test-candidate-token-" + new string('x', 24), new DateTimeOffset(2026, 11, 9, 16, 0, 0, TimeSpan.Zero),
            "https://assessments.example.com", null)));
    }

    public Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken)
    {
        Calls.Add("result");
        return Task.FromResult(OnGetResult?.Invoke(resultId)
            ?? ProviderCall<ParsedProviderResult>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true)));
    }

    public WebhookSignatureCheck VerifyWebhook(string? signatureHeader, ReadOnlySpan<byte> rawBody, DateTimeOffset now) =>
        WebhookSignature.Verify(signatureHeader, rawBody, WebhookSecrets, now);
}

/// <summary>In-memory repository: the state the use cases read and the writes they make.</summary>
internal sealed class FakeRepository : IAssessmentProviderRepository
{
    public static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid Candidate = Guid.Parse("c0000000-0000-4000-8000-000000000001");
    public static readonly Guid Vacancy = Guid.Parse("a0000000-0000-4000-8000-000000000001");

    public ProviderBindingRow? Binding { get; set; } = new(
        Guid.Parse("b0000000-0000-4000-8000-000000000001"), Org, Guid.Parse("3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12"),
        [.. ProviderInstruments.All], "es");

    public AssignmentContext Context { get; set; } = new(
        true, true, true, false,
        """{"assessments":[{"instrument":"lia","use":"scored","reason":"Análisis de datos bajo presión de tiempo"},{"instrument":"english","use":"gate"},{"instrument":"pca","use":"advisory","reason":"Perfil conductual"}]}""",
        "Ana", "Pérez", "ana@example.com");

    /// <summary>When set, the withdrawal committed between the pre-check and the reserve lock.</summary>
    public bool WithdrawnUnderLock { get; set; }

    public List<AttemptRow> Attempts { get; } = [];

    public List<string> Writes { get; } = [];

    public Dictionary<Guid, string> Inbox { get; } = [];

    public List<(Guid AuditId, string Purpose, bool Recorded)> ConsentAudits { get; } = [];

    public List<ParsedProviderResult> StoredResults { get; } = [];

    public Guid? OrganizationForTenant { get; set; } = Org;

    public bool CandidateActive { get; set; } = true;

    public bool LaunchWithdrawn { get; set; }

    public string? CandidateEmail { get; set; } = "ana@example.com";

    public Task<ProviderBindingRow?> GetActiveBindingAsync(Guid organizationId, CancellationToken cancellationToken) =>
        Task.FromResult(Binding);

    public Task<AssignmentContext> LoadAssignmentContextAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) => Task.FromResult(Context);

    public Task<ReserveOutcome> ReserveAttemptsAsync(
        Guid organizationId, Guid actorId, ProviderBindingRow binding, Guid candidateId, Guid vacancyId,
        IReadOnlyList<NewAttempt> attempts, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("reserve");
        if (WithdrawnUnderLock)
        {
            return Task.FromResult(new ReserveOutcome(true, []));
        }

        var rows = new List<AttemptRow>();
        foreach (var attempt in attempts)
        {
            var open = Attempts.FirstOrDefault(a => a.CandidateId == candidateId && a.VacancyId == vacancyId
                && a.Instrument == attempt.Instrument && ProviderAttemptStates.IsOpen(a.State));
            if (open is not null)
            {
                rows.Add(open with { IsNew = false });
                continue;
            }

            var row = new AttemptRow(Guid.NewGuid(), organizationId, candidateId, vacancyId, attempt.Instrument,
                ProviderAttemptStates.PendingCreate, attempt.Reason, attempt.Locale, attempt.TimeMultiplier, attempt.Aids,
                attempt.ExpiresAt, null, null, null, null, [], null, null, true);
            Attempts.Add(row);
            rows.Add(row);
        }

        return Task.FromResult(new ReserveOutcome(false, rows));
    }

    // Mirrors the real repository: only a pending_create attempt is changed; the state afterwards is returned.
    public Task<string?> MarkCreatedAsync(
        Guid organizationId, Guid attemptId, ProviderAssignment assignment, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("created");
        Replace(attemptId, a => a.State != ProviderAttemptStates.PendingCreate ? a : a with
        {
            State = ProviderAttemptStates.Created,
            ProviderAssignmentId = assignment.AssignmentId,
            ProviderSubjectId = assignment.SubjectId,
            InstrumentVersion = assignment.InstrumentVersion,
            RequiredConsents = assignment.RequiredConsents,
            ExpiresAt = assignment.ExpiresAt,
        });
        return Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId)?.State);
    }

    public Task MarkCreateFailedAsync(
        Guid organizationId, Guid attemptId, string errorCode, bool cancel, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add(cancel ? "cancelled:" + errorCode : "pending:" + errorCode);
        Replace(attemptId, a => a.State != ProviderAttemptStates.PendingCreate ? a : a with
        {
            State = cancel ? ProviderAttemptStates.Cancelled : a.State,
            LastErrorCode = errorCode,
        });
        return Task.CompletedTask;
    }

    public Task<(Guid OrganizationId, Guid CandidateId)?> FindAttemptOwnerAsync(Guid attemptId, CancellationToken cancellationToken) =>
        Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId) is { } a
            ? ((Guid, Guid)?)(a.OrganizationId, a.CandidateId)
            : null);

    public Task<LaunchContext?> LoadLaunchContextAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken) =>
        Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId && a.OrganizationId == organizationId) is { } a
            ? new LaunchContext(a, CandidateEmail, CandidateActive, LaunchWithdrawn)
            : null);

    public Task AuditConsentCapturedAsync(
        Guid organizationId, Guid auditId, Guid candidateId, Guid attemptId, string purpose, string textVersion, string locale,
        bool recordedAtProvider, CancellationToken cancellationToken)
    {
        ConsentAudits.Add((auditId, purpose, recordedAtProvider));
        return Task.CompletedTask;
    }

    public Task MarkLaunchedAsync(
        Guid organizationId, Guid attemptId, Guid candidateId, string delivery, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("launched");
        Replace(attemptId, a => a with { State = a.State == ProviderAttemptStates.Created ? ProviderAttemptStates.Launched : a.State });
        return Task.CompletedTask;
    }

    public Task MarkExpiredAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("expired");
        return Task.CompletedTask;
    }

    public Task<Guid?> FindOrganizationByProviderTenantAsync(Guid providerTenantId, CancellationToken cancellationToken) =>
        Task.FromResult(OrganizationForTenant);

    public Task<InboxOutcome> RecordInboxAsync(
        Guid organizationId, ProviderEventEnvelope envelope, int? deliveryAttempt, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!Inbox.TryGetValue(envelope.EventId, out var status))
        {
            Inbox[envelope.EventId] = InboxStatuses.Received;
            return Task.FromResult(InboxOutcome.New);
        }

        return Task.FromResult(status is InboxStatuses.Processed or InboxStatuses.Ignored ? InboxOutcome.Done : InboxOutcome.Retry);
    }

    public Task CompleteInboxAsync(
        Guid organizationId, Guid eventId, string status, string? errorCode, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Inbox[eventId] = status;
        return Task.CompletedTask;
    }

    public Task<AttemptRow?> FindAttemptAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken) =>
        Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId && a.OrganizationId == organizationId));

    public Task<AttemptRow?> FindAttemptByProviderAssignmentAsync(
        Guid organizationId, Guid providerAssignmentId, CancellationToken cancellationToken) =>
        Task.FromResult(Attempts.FirstOrDefault(a => a.ProviderAssignmentId == providerAssignmentId));

    public Task<bool> AdvanceAttemptAsync(
        Guid organizationId, Guid attemptId, string toState, DateTimeOffset? at, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("advance:" + toState);
        return Task.FromResult(true);
    }

    public Task<bool> StoreResultAsync(
        Guid organizationId, AttemptRow attempt, ParsedProviderResult result, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("result:" + result.ResultRevision);
        StoredResults.Add(result);
        return Task.FromResult(true);
    }

    public Task<int> EraseSubjectAsync(Guid organizationId, Guid providerSubjectId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("erase");
        return Task.FromResult(1);
    }

    public Task<IReadOnlyList<ProviderFitRow>> GetFitRowsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<ProviderFitRow>>([]);

    public Task<ProviderBindingRow> UpsertBindingAsync(
        Guid organizationId, Guid providerTenantId, IReadOnlyList<string> instruments, string defaultLocale, Guid actorId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("binding");
        Binding = new ProviderBindingRow(Guid.NewGuid(), organizationId, providerTenantId, instruments, defaultLocale);
        return Task.FromResult(Binding);
    }

    public Task<string?> GetActiveOrganizationNameAsync(Guid organizationId, CancellationToken cancellationToken) =>
        Task.FromResult<string?>("INVU");

    public AttemptRow AddCreatedAttempt(string instrument, string state = ProviderAttemptStates.Created, DateTimeOffset? expiresAt = null)
    {
        var row = new AttemptRow(Guid.NewGuid(), Org, Candidate, Vacancy, instrument, state, "Razón válida", "es", 1m, [],
            null, Guid.NewGuid(), Guid.NewGuid(), "1.0", "content-1", ["assessment"],
            expiresAt ?? new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero), null, false);
        Attempts.Add(row);
        return row;
    }

    private void Replace(Guid attemptId, Func<AttemptRow, AttemptRow> change)
    {
        var index = Attempts.FindIndex(a => a.Id == attemptId);
        if (index >= 0)
        {
            Attempts[index] = change(Attempts[index]);
        }
    }
}
