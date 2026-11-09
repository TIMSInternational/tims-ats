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

    public List<(string Purpose, string Locale)> TemplateRequests { get; } = [];

    public Func<string, string, ProviderCall<ProviderConsentTemplate>>? OnConsentTemplate { get; set; }

    public static ProviderConsentTemplate Template(string purpose, string locale) => new(
        purpose, purpose + "-v2026-11", locale, "Consentimiento: " + purpose,
        [new ConsentTextBlock("paragraph", "Texto de prueba."), new ConsentTextBlock("list", null, Ordered: false, Items: ["Uno"])],
        ["purpose", "retention"]);

    public Task<ProviderCall<ProviderConsentTemplate>> GetConsentTemplateAsync(
        string purpose, string locale, CancellationToken cancellationToken)
    {
        Calls.Add("consent_template:" + purpose + ":" + locale);
        TemplateRequests.Add((purpose, locale));
        return Task.FromResult(OnConsentTemplate?.Invoke(purpose, locale)
            ?? ProviderCall<ProviderConsentTemplate>.Success(Template(purpose, locale)));
    }

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

    public List<(Guid SubjectId, ProviderSubjectUpdate Update)> SubjectUpdates { get; } = [];

    public Func<Guid, ProviderCall<ProviderSubject>>? OnUpdateSubject { get; set; }

    // Like the real provider: merge semantics, so the subject holds names and email afterwards.
    public Task<ProviderCall<ProviderSubject>> UpdateSubjectAsync(
        Guid subjectId, ProviderSubjectUpdate update, CancellationToken cancellationToken)
    {
        Calls.Add("update_subject");
        SubjectUpdates.Add((subjectId, update));
        if (OnUpdateSubject is { } hook)
        {
            return Task.FromResult(hook(subjectId));
        }

        foreach (var key in SubjectHasNames.Keys.ToList())
        {
            SubjectHasNames[key] = true;
        }

        return Task.FromResult(ProviderCall<ProviderSubject>.Success(new ProviderSubject(subjectId, "active", true)));
    }

    public List<Guid> ErasedSubjects { get; } = [];

    public Func<Guid, ProviderCall<ProviderErasureReceipt>>? OnEraseSubject { get; set; }

    public Task<ProviderCall<ProviderErasureReceipt>> EraseSubjectAsync(Guid subjectId, CancellationToken cancellationToken)
    {
        Calls.Add("erase_subject");
        ErasedSubjects.Add(subjectId);
        return Task.FromResult(OnEraseSubject?.Invoke(subjectId)
            ?? ProviderCall<ProviderErasureReceipt>.Success(new ProviderErasureReceipt(subjectId, "accepted")));
    }

    public List<Guid> ExportedSubjects { get; } = [];

    public Func<Guid, ProviderCall<ProviderHeldExport>>? OnExportSubject { get; set; }

    public static string ExportJson(Guid subjectId) =>
        $$"""{"subject":{"subject_id":"{{subjectId}}","status":"active"},"generated_at":"2026-11-09T14:00:00Z","consents":[],"assignments":[],"sessions":[],"results":[],"media":[{"media_id":"{{Guid.Empty}}","kind":"speaking_audio"}],"access_log":[]}""";

    public Task<ProviderCall<ProviderHeldExport>> ExportSubjectAsync(Guid subjectId, CancellationToken cancellationToken)
    {
        Calls.Add("export_subject");
        ExportedSubjects.Add(subjectId);
        return Task.FromResult(OnExportSubject?.Invoke(subjectId)
            ?? ProviderCall<ProviderHeldExport>.Success(new ProviderHeldExport(subjectId, ExportJson(subjectId))));
    }

    /// <summary>The consents each subject holds at the provider; a withdrawal marks one withdrawn.</summary>
    public Dictionary<Guid, List<ProviderConsentRecord>> SubjectConsents { get; } = [];

    public Func<Guid, ProviderCall<IReadOnlyList<ProviderConsentRecord>>>? OnListConsents { get; set; }

    public Task<ProviderCall<IReadOnlyList<ProviderConsentRecord>>> ListConsentsAsync(Guid subjectId, CancellationToken cancellationToken)
    {
        Calls.Add("list_consents");
        if (OnListConsents is { } hook)
        {
            return Task.FromResult(hook(subjectId));
        }

        IReadOnlyList<ProviderConsentRecord> records = SubjectConsents.TryGetValue(subjectId, out var list) ? list.ToList() : [];
        return Task.FromResult(ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Success(records));
    }

    public List<(Guid SubjectId, Guid ConsentId)> WithdrawnConsents { get; } = [];

    public Func<Guid, ProviderCall<ProviderConsentRecord>>? OnWithdrawConsent { get; set; }

    public Task<ProviderCall<ProviderConsentRecord>> WithdrawConsentAsync(
        Guid subjectId, Guid consentId, DateTimeOffset withdrawnAt, CancellationToken cancellationToken)
    {
        Calls.Add("withdraw_consent");
        WithdrawnConsents.Add((subjectId, consentId));
        if (OnWithdrawConsent is { } hook)
        {
            return Task.FromResult(hook(consentId));
        }

        if (SubjectConsents.TryGetValue(subjectId, out var list))
        {
            var index = list.FindIndex(c => c.ConsentId == consentId);
            if (index >= 0)
            {
                list[index] = list[index] with { Status = "withdrawn" };
            }
        }

        return Task.FromResult(ProviderCall<ProviderConsentRecord>.Success(new ProviderConsentRecord(consentId, "assessment", "withdrawn")));
    }

    /// <summary>What the provider holds per external_ref (D11 lookups). Filled by every successful create.</summary>
    public Dictionary<string, ProviderAssignment> ByExternalRef { get; } = new(StringComparer.Ordinal);

    public Func<string, ProviderCall<ProviderAssignmentLookup>>? OnLookup { get; set; }

    public Task<ProviderCall<ProviderAssignmentLookup>> FindAssignmentByExternalRefAsync(
        Guid tenantId, string externalRef, CancellationToken cancellationToken)
    {
        Calls.Add("lookup");
        if (OnLookup is { } hook)
        {
            return Task.FromResult(hook(externalRef));
        }

        return Task.FromResult(ProviderCall<ProviderAssignmentLookup>.Success(
            new ProviderAssignmentLookup(ByExternalRef.TryGetValue(externalRef, out var found) ? found : null)));
    }

    public Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
        ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("assignment:" + request.Instrument);
        Assignments.Add((request, idempotencyKey));
        var answer = OnCreateAssignment?.Invoke(request) ?? Created(request);
        if (answer.Ok && answer.Value!.ExternalRef is { } externalRef)
        {
            ByExternalRef[externalRef] = answer.Value;
        }

        return Task.FromResult(answer);
    }

    /// <summary>The provider's success answer for a create (also usable from an <see cref="OnCreateAssignment"/> hook).</summary>
    public static ProviderCall<ProviderAssignment> Created(ProviderAssignmentRequest request) =>
        ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            Guid.NewGuid(), request.TenantId, request.SubjectId, request.Instrument, "1.0", "content-2026.11.1", "created",
            ["assessment"], ["assessment"], new DateTimeOffset(2026, 11, 23, 14, 0, 0, TimeSpan.Zero), request.ExternalRef));

    /// <summary>An asynchronous answer that sees the call's cancellation (a slow provider).</summary>
    public Func<Guid, CancellationToken, Task<ProviderCall<ProviderAssignment>>>? OnGetAssignmentAsync { get; set; }

    public Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        Calls.Add("get_assignment");
        if (OnGetAssignmentAsync is { } slow)
        {
            return slow(assignmentId, cancellationToken);
        }

        return Task.FromResult(OnGetAssignment?.Invoke(assignmentId)
            ?? ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(404, "not_found", false, [])));
    }

    public List<Guid> Cancelled { get; } = [];

    public Func<Guid, ProviderCall<ProviderAssignment>>? OnCancelAssignment { get; set; }

    public Task<ProviderCall<ProviderAssignment>> CancelAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        Calls.Add("cancel_assignment");
        Cancelled.Add(assignmentId);
        return Task.FromResult(OnCancelAssignment?.Invoke(assignmentId) ?? ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            assignmentId, TenantId, SubjectId, "lia", "1.0", "content-1", "cancelled", ["assessment"], [],
            new DateTimeOffset(2026, 11, 23, 14, 0, 0, TimeSpan.Zero))));
    }

    public Task<ProviderCall<ProviderConsentRecord>> RecordConsentAsync(
        Guid subjectId, ProviderConsentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("consent:" + request.Purpose);
        Consents.Add((subjectId, request, idempotencyKey));
        if (OnRecordConsent is { } hook)
        {
            return Task.FromResult(hook());
        }

        var record = new ProviderConsentRecord(Guid.NewGuid(), request.Purpose, "active");
        if (!SubjectConsents.TryGetValue(subjectId, out var list))
        {
            SubjectConsents[subjectId] = list = [];
        }

        list.Add(record);
        return Task.FromResult(ProviderCall<ProviderConsentRecord>.Success(record));
    }

    public const string PlayerUrl = "https://player.example.com/launch/single-use-code";

    public List<string?> LaunchReturnPaths { get; } = [];

    public Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, string? returnPath, CancellationToken cancellationToken)
    {
        Calls.Add("launch");
        LaunchReturnPaths.Add(returnPath);
        return Task.FromResult(OnLaunch?.Invoke(assignmentId) ?? ProviderCall<ProviderLaunch>.Success(new ProviderLaunch(
            "native", new DateTimeOffset(2026, 11, 9, 14, 5, 0, TimeSpan.Zero), PlayerUrl, ["https://ats.example.com"])));
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

        // Mirrors the real repository: an open attempt with other terms is reported before anything is written.
        foreach (var attempt in attempts)
        {
            if (OpenAttempt(candidateId, vacancyId, attempt.Instrument) is { } open && !attempt.SameTermsAs(open))
            {
                return Task.FromResult(new ReserveOutcome(false, [], open));
            }
        }

        var rows = new List<AttemptRow>();
        foreach (var attempt in attempts)
        {
            var open = OpenAttempt(candidateId, vacancyId, attempt.Instrument);
            if (open is not null)
            {
                rows.Add(open with { IsNew = false });
                continue;
            }

            var row = new AttemptRow(Guid.NewGuid(), organizationId, candidateId, vacancyId, attempt.Instrument,
                ProviderAttemptStates.PendingCreate, attempt.Reason, attempt.Locale, attempt.TimeMultiplier, attempt.Aids,
                attempt.ExpiresAt, null, null, null, null, [], null, null, true, AgeBand: attempt.AgeBand);
            Attempts.Add(row);
            rows.Add(row);
        }

        return Task.FromResult(new ReserveOutcome(false, rows));
    }

    private AttemptRow? OpenAttempt(Guid candidateId, Guid vacancyId, string instrument) =>
        Attempts.FirstOrDefault(a => a.CandidateId == candidateId && a.VacancyId == vacancyId
            && a.Instrument == instrument && ProviderAttemptStates.IsOpen(a.State));

    /// <summary>Runs once just before the next local cancel takes its lock (a concurrent writer committing first).</summary>
    public Action<Guid>? BeforeNextMarkCancelled { get; set; }

    // Mirrors the real repository: cancels only a cancellable attempt still mapped to the expected provider assignment.
    public Task<string?> MarkCancelledAsync(
        Guid organizationId, Guid attemptId, Guid? expectedProviderAssignmentId, Guid actorId, bool cancelledAtProvider,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var before = BeforeNextMarkCancelled;
        BeforeNextMarkCancelled = null;
        before?.Invoke(attemptId);
        var current = Attempts.FirstOrDefault(a => a.Id == attemptId);
        if (current is not null && ProviderAttemptStates.IsCancellable(current.State)
            && current.ProviderAssignmentId == expectedProviderAssignmentId)
        {
            Writes.Add(cancelledAtProvider ? "staff_cancel:provider" : "staff_cancel:local");
            Replace(attemptId, a => a with { State = ProviderAttemptStates.Cancelled });
        }

        return Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId)?.State);
    }

    public void MapAttempt(Guid attemptId, Guid providerAssignmentId) =>
        Replace(attemptId, a => a with
        {
            State = ProviderAttemptStates.Created,
            ProviderAssignmentId = providerAssignmentId,
            ProviderSubjectId = Guid.NewGuid(),
        });

    // Mirrors the real repository: a pending_create attempt is mapped; a cancelled one with no ids records the orphan
    // (ids + the cleanup marker); nothing else changes. The state afterwards is returned.
    public Task<string?> MarkCreatedAsync(
        Guid organizationId, Guid attemptId, ProviderAssignment assignment, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("created");
        Replace(attemptId, a => a.State == ProviderAttemptStates.PendingCreate
            ? a with
            {
                State = ProviderAttemptStates.Created,
                ProviderAssignmentId = assignment.AssignmentId,
                ProviderSubjectId = assignment.SubjectId,
                InstrumentVersion = assignment.InstrumentVersion,
                RequiredConsents = assignment.RequiredConsents,
                ExpiresAt = assignment.ExpiresAt,
            }
            : a.State == ProviderAttemptStates.Cancelled && a.ProviderAssignmentId is null
                ? a with
                {
                    ProviderAssignmentId = assignment.AssignmentId,
                    ProviderSubjectId = assignment.SubjectId,
                    LastErrorCode = ProviderCleanup.CancelPending,
                }
                : a);
        return Task.FromResult(Attempts.FirstOrDefault(a => a.Id == attemptId)?.State);
    }

    public Task MarkProviderCancelledAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("orphan_cancelled");
        Replace(attemptId, a => a.LastErrorCode == ProviderCleanup.CancelPending ? a with { LastErrorCode = null } : a);
        return Task.CompletedTask;
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

    /// <summary>Runs before every launch-context read (a withdrawal committing between two reads).</summary>
    public Action? BeforeLoadLaunchContext { get; set; }

    /// <summary>Runs once, right after the next launch-context read (a withdrawal staging right after the check).</summary>
    public Action? AfterLoadLaunchContext { get; set; }

    public Task<LaunchContext?> LoadLaunchContextAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        BeforeLoadLaunchContext?.Invoke();
        var context = Attempts.FirstOrDefault(a => a.Id == attemptId && a.OrganizationId == organizationId) is { } a
            ? new LaunchContext(a, CandidateEmail, CandidateActive, LaunchWithdrawn, "Ana", "Pérez")
            : null;
        var after = AfterLoadLaunchContext;
        AfterLoadLaunchContext = null;
        after?.Invoke();
        return Task.FromResult(context);
    }

    public Task ReopenWithdrawalAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("withdrawal_reopened");
        Replace(attemptId, a => a.WithdrawalState == ProviderWithdrawalStates.Done ? a with { WithdrawalState = ProviderWithdrawalStates.Pending } : a);
        return Task.CompletedTask;
    }

    public Task AuditConsentCapturedAsync(
        Guid organizationId, Guid auditId, Guid candidateId, Guid attemptId, string purpose, string textVersion, string locale,
        bool recordedAtProvider, CancellationToken cancellationToken)
    {
        ConsentAudits.Add((auditId, purpose, recordedAtProvider));
        return Task.CompletedTask;
    }

    /// <summary>Runs once, after the locks are taken and before the fresh checks (a withdrawal committed just before them).</summary>
    public Action? BeforeLockedLaunchChecks { get; set; }

    /// <summary>Runs once, after the provider call and before the conditional record (a sibling's withdrawal staging it).</summary>
    public Action? DuringLockedLaunchCall { get; set; }

    public string? OrganizationSlug { get; set; } = "invu";

    // Mirrors the real repository: fresh checks under the locks, the call, then a write conditional on no withdrawal.
    public async Task<LockedLaunch> LaunchUnderCandidateLockAsync(
        Guid organizationId, Guid attemptId, Func<AttemptRow, CancellationToken, Task<ProviderCall<ProviderLaunch>>> launch,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var before = BeforeLockedLaunchChecks;
        BeforeLockedLaunchChecks = null;
        before?.Invoke();
        Writes.Add("launch_locked");
        if (Attempts.FirstOrDefault(a => a.Id == attemptId && a.OrganizationId == organizationId) is not { } attempt)
        {
            return new LockedLaunch(LockedLaunchOutcome.NotFound, null, null);
        }

        if (attempt.WithdrawalState is not null || LaunchWithdrawn || WithdrawnCandidates.Contains(attempt.CandidateId))
        {
            return new LockedLaunch(LockedLaunchOutcome.ConsentWithdrawn, null, attempt.State);
        }

        if (!ProviderAttemptStates.IsLaunchable(attempt.State))
        {
            return new LockedLaunch(LockedLaunchOutcome.NotLaunchable, null, attempt.State);
        }

        var call = await launch(attempt, cancellationToken);
        var during = DuringLockedLaunchCall;
        DuringLockedLaunchCall = null;
        during?.Invoke();
        if (!call.Ok)
        {
            return new LockedLaunch(LockedLaunchOutcome.Called, call, attempt.State);
        }

        if (Attempts.First(a => a.Id == attemptId).WithdrawalState is not null)
        {
            return new LockedLaunch(LockedLaunchOutcome.ConsentWithdrawn, call, attempt.State);
        }

        Writes.Add("launched");
        Replace(attemptId, a => a with { State = a.State == ProviderAttemptStates.Created ? ProviderAttemptStates.Launched : a.State });
        return new LockedLaunch(LockedLaunchOutcome.Called, call, Attempts.First(a => a.Id == attemptId).State);
    }

    public Task<string?> GetActiveOrganizationSlugAsync(Guid organizationId, CancellationToken cancellationToken) =>
        Task.FromResult(OrganizationSlug);

    public Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken) =>
        Task.FromResult(slug == OrganizationSlug ? (Guid?)Org : null);

    /// <summary>What the portal listing returns for the verified email (by default: every attempt, when it is CandidateEmail).</summary>
    public Task<IReadOnlyList<AttemptRow>> ListCandidateAttemptsByEmailAsync(
        Guid organizationId, string verifiedEmail, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AttemptRow>>(
            string.Equals(verifiedEmail.Trim(), CandidateEmail, StringComparison.OrdinalIgnoreCase) && !LaunchWithdrawn
                ? Attempts.Where(a => a.OrganizationId == organizationId).ToList()
                : []);

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

    /// <summary>When set, the next lookup by provider assignment id misses (the mapping commits just after it).</summary>
    public bool MissNextLookupByAssignment { get; set; }

    public Task<AttemptRow?> FindAttemptByProviderAssignmentAsync(
        Guid organizationId, Guid providerAssignmentId, CancellationToken cancellationToken)
    {
        if (MissNextLookupByAssignment)
        {
            MissNextLookupByAssignment = false;
            return Task.FromResult<AttemptRow?>(null);
        }

        return Task.FromResult(Attempts.FirstOrDefault(a => a.ProviderAssignmentId == providerAssignmentId));
    }

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

    public List<Guid> LocallyErasedSubjects { get; } = [];

    public Task<int> EraseSubjectAsync(Guid organizationId, Guid providerSubjectId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Writes.Add("erase");
        LocallyErasedSubjects.Add(providerSubjectId);
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

    /// <summary>Candidates whose #312 consent is withdrawn (what StageConsentWithdrawalAsync's predicate sees).</summary>
    public HashSet<Guid> WithdrawnCandidates { get; } = [];

    // Mirrors ProviderWithdrawalSql: open attempts cancelled (mapped ones get the cleanup marker), all marked pending.
    public Task<int> StageConsentWithdrawalAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!WithdrawnCandidates.Contains(candidateId))
        {
            return Task.FromResult(0);
        }

        var staged = 0;
        foreach (var attempt in Attempts.Where(a => a.CandidateId == candidateId && a.WithdrawalState is null
            && a.State != ProviderAttemptStates.Erased).ToList())
        {
            var cancellable = ProviderAttemptStates.IsCancellable(attempt.State);
            Replace(attempt.Id, a => a with
            {
                State = cancellable ? ProviderAttemptStates.Cancelled : a.State,
                LastErrorCode = cancellable && a.ProviderAssignmentId is not null ? ProviderCleanup.CancelPending : a.LastErrorCode,
                WithdrawalState = ProviderWithdrawalStates.Pending,
            });
            staged++;
        }

        if (staged > 0)
        {
            Writes.Add("withdrawal_staged");
        }

        return Task.FromResult(staged);
    }

    /// <summary>Extra organizations the pre-tenant listing reports (for multi-organization sweeps).</summary>
    public List<Guid> ExtraPendingOrganizations { get; } = [];

    /// <summary>An organization whose pending-attempt listing throws (a failing pass).</summary>
    public Guid? FailingOrganization { get; set; }

    public int PendingListings { get; private set; }

    public Task<IReadOnlyList<Guid>> ListOrganizationsWithPendingWithdrawalsAsync(int max, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Guid>>(
            ExtraPendingOrganizations
                .Concat(Attempts.Where(a => a.WithdrawalState == ProviderWithdrawalStates.Pending).Select(a => a.OrganizationId))
                .Distinct().Take(max).ToList());

    public Task<IReadOnlyList<AttemptRow>> ListPendingWithdrawalsAsync(Guid organizationId, int max, CancellationToken cancellationToken)
    {
        PendingListings++;
        if (organizationId == FailingOrganization)
        {
            throw new InvalidOperationException("listing failed");
        }

        return Task.FromResult<IReadOnlyList<AttemptRow>>(
            Attempts.Where(a => a.OrganizationId == organizationId && a.WithdrawalState == ProviderWithdrawalStates.Pending)
                .Take(max).ToList());
    }

    /// <summary>Consent-capture fence state per attempt (mirrors the three attempt columns).</summary>
    public Dictionary<Guid, (int Generation, int InFlight, DateTimeOffset? StartedAt)> Captures { get; } = [];

    /// <summary>The "database clock" the fake judges capture staleness with.</summary>
    public DateTimeOffset DbNow { get; set; } = new(2026, 11, 9, 14, 0, 0, TimeSpan.Zero);

    /// <summary>Runs once, right after the fences are read (a launch interleaving with the pass).</summary>
    public Action? AfterReadFences { get; set; }

    private (int Generation, int InFlight, DateTimeOffset? StartedAt) CaptureOf(Guid attemptId) =>
        Captures.TryGetValue(attemptId, out var capture) ? capture : (0, 0, null);

    public Task<IReadOnlyList<WithdrawalFence>> ReadWithdrawalFencesAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, CancellationToken cancellationToken)
    {
        IReadOnlyList<WithdrawalFence> fences = attemptIds
            .Where(id => Attempts.Any(a => a.Id == id))
            .Select(id =>
            {
                var (generation, inFlight, startedAt) = CaptureOf(id);
                return new WithdrawalFence(id, generation, inFlight > 0,
                    inFlight > 0 && startedAt < DbNow - ProviderCleanup.ConsentCaptureStaleAfter);
            })
            .ToList();
        var hook = AfterReadFences;
        AfterReadFences = null;
        hook?.Invoke();
        return Task.FromResult(fences);
    }

    public Task<int> MarkWithdrawalDoneAsync(
        Guid organizationId, IReadOnlyList<WithdrawalFence> fences, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var moved = 0;
        foreach (var fence in fences)
        {
            var capture = CaptureOf(fence.AttemptId);
            if (Attempts.FirstOrDefault(a => a.Id == fence.AttemptId) is { WithdrawalState: ProviderWithdrawalStates.Pending } a
                && a.LastErrorCode != ProviderCleanup.CancelPending
                && capture.Generation == fence.CaptureGeneration
                && (capture.InFlight == 0 || fence.CaptureStale))
            {
                Replace(fence.AttemptId, x => x with { WithdrawalState = ProviderWithdrawalStates.Done });
                moved++;
            }
        }

        Writes.Add("withdrawal_done:" + moved);
        return Task.FromResult(moved);
    }

    public Task<bool> BeginConsentCaptureAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (Attempts.FirstOrDefault(a => a.Id == attemptId) is not { WithdrawalState: null })
        {
            Writes.Add("capture_refused");
            return Task.FromResult(false);
        }

        var (generation, inFlight, _) = CaptureOf(attemptId);
        Captures[attemptId] = (generation + 1, inFlight + 1, DbNow);
        Writes.Add("capture_begun");
        return Task.FromResult(true);
    }

    public Task EndConsentCaptureAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var (generation, inFlight, startedAt) = CaptureOf(attemptId);
        Captures[attemptId] = (generation + 1, Math.Max(inFlight - 1, 0), inFlight <= 1 ? null : startedAt);
        Writes.Add("capture_ended");
        return Task.CompletedTask;
    }

    public List<int> ExportAudits { get; } = [];

    public Task<ProviderSubjectExport?> ExportCandidateAsync(
        Guid organizationId, Guid candidateId, Guid actorId, int providerExports, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (candidateId != Candidate)
        {
            return Task.FromResult<ProviderSubjectExport?>(null);
        }

        ExportAudits.Add(providerExports);
        return Task.FromResult<ProviderSubjectExport?>(new ProviderSubjectExport([], []));
    }

    public Task<ProviderCandidateSubjects?> ListProviderSubjectsAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        Task.FromResult(candidateId != Candidate
            ? null
            : new ProviderCandidateSubjects(
                Attempts.Where(a => a.CandidateId == candidateId && a.ProviderSubjectId is not null)
                    .Select(a => a.ProviderSubjectId!.Value).Distinct().ToList(),
                Attempts.Any(a => a.CandidateId == candidateId)));

    public Task MarkErasureRequestedAsync(
        Guid organizationId, Guid candidateId, Guid providerSubjectId, string receiptStatus, Guid actorId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Writes.Add("erasure_requested:" + receiptStatus);
        foreach (var attempt in Attempts.Where(a => a.ProviderSubjectId == providerSubjectId || a.ProviderSubjectId is null).ToList())
        {
            Replace(attempt.Id, a => a with { ErasureRequestedAt = now });
        }

        return Task.CompletedTask;
    }

    /// <summary>Attempts currently leased by a poll (a claim skips them, like the real lease predicate).</summary>
    public Dictionary<Guid, Guid> Leases { get; } = [];

    public List<(Guid AttemptId, Guid Owner)> Released { get; } = [];

    /// <summary>An organization whose claim throws (a failing org in a poll).</summary>
    public Guid? FailingClaimOrganization { get; set; }

    /// <summary>Attempts the fake treats as holding a stored result (what latest_result_id records).</summary>
    public HashSet<Guid> WithStoredResult { get; } = [];

    private bool IsPollable(AttemptRow a) =>
        a.ProviderAssignmentId is not null && a.WithdrawalState is null && a.ErasureRequestedAt is null
        && !Leases.ContainsKey(a.Id) && !Released.Any(r => r.AttemptId == a.Id)
        && (ProviderAttemptPolling.SittingStates.Contains(a.State)
            || (ProviderAttemptPolling.RevisionStates.Contains(a.State)
                && (a.State == ProviderAttemptStates.ResultReady || WithStoredResult.Contains(a.Id))));

    public Task<IReadOnlyList<Guid>> ListOrganizationsWithPollableAttemptsAsync(int max, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Guid>>(Attempts.Where(IsPollable).Select(a => a.OrganizationId).Distinct().Take(max).ToList());

    public Task<IReadOnlyList<PolledAttempt>> ClaimPollableAttemptsAsync(
        Guid organizationId, Guid owner, int max, CancellationToken cancellationToken)
    {
        if (organizationId == FailingClaimOrganization)
        {
            throw new InvalidOperationException("claim failed");
        }

        var claimed = Attempts.Where(a => a.OrganizationId == organizationId && IsPollable(a)).Take(max).ToList();
        foreach (var attempt in claimed)
        {
            Leases[attempt.Id] = owner;
        }

        Writes.Add("claim:max=" + max);
        Writes.Add("claimed:" + claimed.Count);
        return Task.FromResult<IReadOnlyList<PolledAttempt>>(
            claimed.Select(a => new PolledAttempt(a, Binding?.ProviderTenantId ?? Guid.Empty)).ToList());
    }

    public Task ReleasePollLeaseAsync(Guid organizationId, Guid attemptId, Guid owner, CancellationToken cancellationToken)
    {
        if (Leases.TryGetValue(attemptId, out var holder) && holder == owner)
        {
            Leases.Remove(attemptId);
            Released.Add((attemptId, owner));
            Writes.Add("released");
        }

        return Task.CompletedTask;
    }

    public Task SetMissingConsentsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> missingConsents, CancellationToken cancellationToken)
    {
        Writes.Add("missing:" + string.Join(",", missingConsents));
        Replace(attemptId, a => a with { MissingConsents = missingConsents.ToList() });
        return Task.CompletedTask;
    }

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
