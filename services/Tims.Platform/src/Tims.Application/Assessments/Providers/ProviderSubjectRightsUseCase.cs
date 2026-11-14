namespace Tims.Application.Assessments.Providers;

public enum ProviderErasureOutcome
{
    /// <summary>Every provider subject of the candidate has an accepted erasure (or none existed).</summary>
    Requested,
    CandidateNotFound,
    ProviderUnconfigured,

    /// <summary>At least one subject's erasure could not be requested; the others are recorded. Retrying is safe.</summary>
    Incomplete,
}

public sealed record ProviderErasureResult(ProviderErasureOutcome Outcome, int Subjects, int Requested);

public enum ProviderExportOutcome
{
    /// <summary>The ATS's tables and every provider subject's own export (or its confirmed absence).</summary>
    Exported,
    CandidateNotFound,
    ProviderUnconfigured,

    /// <summary>A provider subject's export could not be read; nothing is returned or audited. Retrying is safe.</summary>
    Incomplete,
}

public sealed record ProviderSubjectExportResult(ProviderExportOutcome Outcome, ProviderSubjectExport? Export);

/// <summary>
/// Data-subject rights over the provider connector (owner default D15, 2026-11-08), on the C# path (the survival rule):
/// <list type="bullet">
/// <item><b>Access.</b> The ATS's own provider tables for one candidate (attempts and stored results) AND what the
/// PROVIDER holds for each of the candidate's provider subjects: its <c>GET /v1/subjects/{id}/export</c> (consents,
/// assignments, sessions, results rendered for <c>tenant_hr</c>, media links, its access log), called with the
/// <c>subjects:export</c> scope alone. Fail closed: if any subject's export cannot be read, nothing is returned or
/// audited (retry later); a subject the provider confirms it no longer holds is listed as <c>erased</c> or
/// <c>not_found</c>. The audit row is committed with the export.</item>
/// <item><b>Erasure.</b> ATS-initiated: <c>DELETE /v1/subjects/{id}</c> for every provider subject of the candidate. The
/// provider erases asynchronously and then emits <c>subject.erased</c>. The ATS erases its own stored results for the
/// subject as soon as the request is accepted (or the provider confirms the subject gone, 410 or a 404 its lookup
/// confirms), never waiting on that event, which may be lost. From the accepted request on, no result is fetched or stored
/// for those attempts.</item>
/// </list>
/// </summary>
public sealed class ProviderSubjectRightsUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<ProviderSubjectExportResult> ExportAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var subjects = await ResolveSubjectsAsync(organizationId, candidateId, mayCreate: false, cancellationToken)
            .ConfigureAwait(false);
        if (subjects.Outcome is not null)
        {
            return new ProviderSubjectExportResult(subjects.Outcome.Value switch
            {
                ProviderErasureOutcome.CandidateNotFound => ProviderExportOutcome.CandidateNotFound,
                ProviderErasureOutcome.ProviderUnconfigured => ProviderExportOutcome.ProviderUnconfigured,
                _ => ProviderExportOutcome.Incomplete,
            }, null);
        }

        var held = new List<ProviderHeldSubjectExport>();
        foreach (var subject in subjects.Subjects)
        {
            if (!await AddHeldAsync(held, subject, subjects.Erased.Contains(subject), cancellationToken).ConfigureAwait(false))
            {
                return new ProviderSubjectExportResult(ProviderExportOutcome.Incomplete, null);
            }
        }

        // An access export is a read: it never POSTs /v1/subjects (Codex ats round 13, runs 1 to 5). The provider keeps
        // one subject per (tenant, external_ref = candidate id) and forgets the external_ref when it erases the subject
        // (from the erasure REQUEST on, while it may still hold the data), so past the 24 h idempotency window that POST
        // creates a NEW subject, also when the ATS never learned of the erasure (a lost subject.erased; a recorded subject
        // then answers 410 above), and there is no read-only lookup by external_ref. A subject no attempt records exists
        // only behind an unanswered create (a create records the subject it resolved before anything can end its fence,
        // and a refusal ends it only when the attempt records that subject). So while a create is unanswered the export
        // is complete only when a subject recorded on a LIVE attempt is held: that one IS the external_ref's subject, so
        // the create could not have made another, provided the provider still reports it active (Codex ats round 13 run
        // 5): an erasure requested directly at the provider releases the external_ref while the export may still be
        // served (erasure_pending). Otherwise it is Incomplete (an erasure run resolves and erases it).
        if (subjects.ExportFacts is { } facts
            && !await HoldsACurrentLiveSubjectAsync(held, facts.LiveSubjects ?? [], cancellationToken).ConfigureAwait(false))
        {
            return new ProviderSubjectExportResult(ProviderExportOutcome.Incomplete, null);
        }

        var export = await _repository.ExportCandidateAsync(
            organizationId, candidateId, actorId, held.Count(h => h.Status == "exported"), now, cancellationToken)
            .ConfigureAwait(false);
        return export is null
            ? new ProviderSubjectExportResult(ProviderExportOutcome.CandidateNotFound, null)
            : new ProviderSubjectExportResult(ProviderExportOutcome.Exported, export with { ProviderExports = held });
    }

    /// <summary>
    /// Whether some exported subject recorded on a live attempt is, by the provider's own subject lookup, still the
    /// active subject (status <c>active</c>): then it is the candidate's subject for (tenant, external_ref).
    /// </summary>
    private async Task<bool> HoldsACurrentLiveSubjectAsync(
        IReadOnlyList<ProviderHeldSubjectExport> held, IReadOnlyList<Guid> liveSubjects, CancellationToken cancellationToken)
    {
        foreach (var subject in held.Where(h => h.Status == "exported" && liveSubjects.Contains(h.SubjectId)).Select(h => h.SubjectId))
        {
            var current = await _provider.GetSubjectAsync(subject, cancellationToken).ConfigureAwait(false);
            if (current.Ok && current.Value!.SubjectId == subject && current.Value.Status == "active")
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Adds what the provider holds for one subject: its own export, or a confirmed absence (410, or a 404 the client's
    /// subject lookup confirmed). False on any other failure: the provider may still hold data the export would omit.
    /// </summary>
    private async Task<bool> AddHeldAsync(
        List<ProviderHeldSubjectExport> held, Guid subject, bool erasedLocally, CancellationToken cancellationToken)
    {
        if (erasedLocally)
        {
            // The provider confirmed this subject's erasure (subject.erased): terminal, nothing left to read there.
            held.Add(new ProviderHeldSubjectExport(subject, "erased", null));
            return true;
        }

        var exported = await _provider.ExportSubjectAsync(subject, cancellationToken).ConfigureAwait(false);
        if (exported.Ok)
        {
            using var document = System.Text.Json.JsonDocument.Parse(exported.Value!.Json);
            held.Add(new ProviderHeldSubjectExport(subject, "exported", document.RootElement.Clone()));
            return true;
        }

        var status = exported.Failure!.HttpStatus switch
        {
            410 => "erased",
            404 => "not_found",
            _ => null,
        };
        if (status is null)
        {
            return false;
        }

        held.Add(new ProviderHeldSubjectExport(subject, status, null));
        return true;
    }

    /// <summary>
    /// The provider subject for (tenant, external_ref = candidate id), by the idempotent <c>POST /v1/subjects</c>, or
    /// null when it cannot be resolved (no binding, or the call failed). In force or not (round 12): an org the platform
    /// owner unbound keeps its provider tenant, and its candidates' data must still be exportable and erasable.
    /// </summary>
    private async Task<Guid?> EnsureSubjectByExternalRefAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        var binding = await _repository.GetBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (binding is null)
        {
            return null;
        }

        var request = new ProviderSubjectRequest(binding.ProviderTenantId, candidateId.ToString(), null, null, null, null);
        var resolved = await _provider.EnsureSubjectAsync(
            request, IdempotencyKeys.Subject(organizationId, request), cancellationToken).ConfigureAwait(false);
        return resolved.Ok ? resolved.Value!.SubjectId : null;
    }

    /// <summary>
    /// The candidate's provider subjects: those recorded on its attempts, plus, for an erasure, the one the provider
    /// resolves for (tenant, candidate id) whenever resolution is needed (a failed or crashed create can leave a subject
    /// no attempt names). <see cref="ResolvedSubjects.Outcome"/> is set when they cannot be resolved.
    /// </summary>
    /// <param name="mayCreate">
    /// False for an access export: nothing is resolved here, since a <c>POST /v1/subjects</c> may CREATE a fresh subject
    /// for an erased person. The recorded subjects are returned with <see cref="ResolvedSubjects.ExportFacts"/>, and the
    /// export decides once it has read them; it is Incomplete at once when a create is unanswered and no subject is
    /// recorded on a live attempt.
    /// </param>
    private async Task<ResolvedSubjects> ResolveSubjectsAsync(
        Guid organizationId, Guid candidateId, bool mayCreate, CancellationToken cancellationToken)
    {
        var known = await _repository.ListProviderSubjectsAsync(organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        if (known is null)
        {
            return new ResolvedSubjects([], [], ProviderErasureOutcome.CandidateNotFound);
        }

        var erased = known.ErasedSubjects ?? [];
        var live = known.Subjects.Where(s => !erased.Contains(s)).ToList();
        if (known.HasAttempts && !_provider.IsConfigured && (live.Count > 0 || known.NeedsResolution))
        {
            return new ResolvedSubjects(known.Subjects, erased, ProviderErasureOutcome.ProviderUnconfigured);
        }

        var subjects = known.Subjects.ToList();
        // A stored erasure is terminal (DSAR mismatch 8): once every attempt is erased or under an accepted erasure
        // request, the subject is NOT resolved again. The provider forgets the subject's external_ref when its erasure is
        // requested, so a re-POST of (tenant, candidate id) after the 24 h idempotency window would create a fresh, empty
        // provider subject, and the export or erasure would then run against that new subject.
        if (!mayCreate)
        {
            // The access export (see ExportAsync). No unanswered create: no subject can exist that the attempts do not
            // record. One, with no subject recorded on a live attempt: Incomplete at once, only an erasure may resolve it.
            if (!known.HasAttempts || !known.UnansweredCreates)
            {
                return new ResolvedSubjects(subjects, erased, null, known.ReadAt);
            }

            return (known.LiveSubjects ?? []).Count == 0
                ? new ResolvedSubjects(subjects, erased, ProviderErasureOutcome.Incomplete, known.ReadAt)
                : new ResolvedSubjects(subjects, erased, null, known.ReadAt) { ExportFacts = known };
        }

        if (known.HasAttempts && known.NeedsResolution)
        {
            // The subject is created BEFORE its assignment and recorded only with it, so a failed or crashed create can
            // leave a provider subject (possibly with names and email) no attempt names. Subjects are idempotent on
            // (tenant, external_ref = candidate id): resolve it that way, never trusting the local record alone.
            if (await EnsureSubjectByExternalRefAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false)
                is not { } resolved)
            {
                return new ResolvedSubjects(subjects, erased, ProviderErasureOutcome.Incomplete, known.ReadAt);
            }

            if (!subjects.Contains(resolved))
            {
                subjects.Add(resolved);
            }

            return new ResolvedSubjects(subjects, erased, null, known.ReadAt, known.OnlyUnansweredCreatesNeedResolution)
            {
                ResolvedSubject = resolved,
            };
        }

        return new ResolvedSubjects(subjects, erased, null, known.ReadAt, known.NeedsResolution && known.OnlyUnansweredCreatesNeedResolution);
    }

    /// <param name="ReadAt">The database clock of the subject facts read (null from a store that does not report it).</param>
    /// <param name="ResolvedForUnansweredCreates">The subject was resolved only because of unanswered creates on erased attempts.</param>
    private sealed record ResolvedSubjects(
        IReadOnlyList<Guid> Subjects, IReadOnlyList<Guid> Erased, ProviderErasureOutcome? Outcome,
        DateTimeOffset? ReadAt = null, bool ResolvedForUnansweredCreates = false)
    {
        /// <summary>Export only: the subject facts when an unanswered create may call for a resolution, else null.</summary>
        public ProviderCandidateSubjects? ExportFacts { get; init; }

        /// <summary>Erasure only: the subject the provider resolved for (tenant, candidate id), when resolved.</summary>
        public Guid? ResolvedSubject { get; init; }
    }

    public async Task<ProviderErasureResult> EraseAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var result = await EraseSubjectsAsync(organizationId, candidateId, actorId, now, cancellationToken)
            .ConfigureAwait(false);
        if (result.Outcome != ProviderErasureOutcome.CandidateNotFound)
        {
            // Every run is on record (round 12), whatever it achieved: the platform owner's request, its outcome and
            // counts. Per-subject requests are audited where they are recorded.
            await _repository.AuditErasureRunAsync(
                organizationId, candidateId, actorId, result.Outcome.ToString(), result.Subjects, result.Requested,
                cancellationToken).ConfigureAwait(false);
        }

        return result;
    }

    private async Task<ProviderErasureResult> EraseSubjectsAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var resolved = await ResolveSubjectsAsync(organizationId, candidateId, mayCreate: true, cancellationToken)
            .ConfigureAwait(false);
        if (resolved.Outcome is { } failed)
        {
            return new ProviderErasureResult(failed, resolved.Subjects.Count, 0);
        }

        var subjects = resolved.Subjects;
        var requested = 0;
        var resolvedGone = false;
        foreach (var subject in subjects)
        {
            if (resolved.Erased.Contains(subject))
            {
                // Already erased at the provider (subject.erased recorded, its handler deleted what the ATS stored).
                requested++;
                continue;
            }

            var erased = await _provider.EraseSubjectAsync(subject, cancellationToken).ConfigureAwait(false);
            string? status = erased.Ok ? erased.Value!.Status : erased.Failure!.HttpStatus switch
            {
                410 => "already_erased",
                404 => "not_found",
                _ => null,
            };
            if (status is null)
            {
                continue;
            }

            if (subject == resolved.ResolvedSubject)
            {
                // The provider holds nothing for it any more (not merely a request accepted, while the data may remain).
                resolvedGone = status is "already_erased" or "not_found" or "erased";
            }

            // The ATS's own copy is erased NOW, for an accepted request as for a confirmed 410/404: it never depends on
            // the provider's subject.erased event, which may never arrive (a delivery that exhausts its retries, or no
            // event at all for a subject already gone) and which the D17 poller cannot replace (it skips attempts under
            // an erasure request). That event's handler, when it lands, repeats this idempotently. It runs BEFORE the
            // marker, each in its own transaction: an interruption between them leaves the results deleted (and the
            // attempts erased, which refuses any later result) with the marker missing, so this run is not counted as
            // requested and a retry, safe at any point, records it. The reverse order could strand the results.
            await _repository.EraseSubjectAsync(organizationId, subject, now, cancellationToken).ConfigureAwait(false);
            // The subject resolved by (tenant, candidate id) is recorded on the attempts with none (Codex ats round 13
            // run 6): a crashed create's subject is otherwise named by no attempt, and once its fence is retired below a
            // later export would no longer list it while the provider still holds its data (erasure_pending).
            await _repository.MarkErasureRequestedAsync(organizationId, candidateId, subject, status, actorId, now, cancellationToken,
                    recordOnUnmapped: subject == resolved.ResolvedSubject)
                .ConfigureAwait(false);

            requested++;
        }

        if (requested == subjects.Count)
        {
            // Codex ats-final run 2 [P1]: a create whose fence committed before the markers above may still send
            // EnsureSubject. The provider forgot the erased subject's external_ref, so that call can create a NEW subject
            // (with names and email) outside the list erased here. Read again AFTER the markers (a create that begins
            // after them is refused): a live create, or a subject recorded meanwhile, keeps the erasure incomplete, and a
            // retry erases what it made (recorded on its attempt, or resolved by external_ref once its fence is stale).
            var after = await _repository.ListProviderSubjectsAsync(organizationId, candidateId, cancellationToken)
                .ConfigureAwait(false);
            if (after is null || after.CreatesInFlight || after.Subjects.Except(subjects).Any())
            {
                return new ProviderErasureResult(ProviderErasureOutcome.Incomplete, subjects.Count, requested);
            }

            // Only once a later export can still account for the resolved subject (Codex ats round 13 run 6): it is
            // recorded on an attempt (it is the subject those fences stood for), or the provider confirmed it holds nothing
            // for it. When no attempt could take it (each already names another) and its erasure is only accepted, the
            // provider may still hold its data, so the fences stay and the export stays Incomplete; a run after the
            // provider confirms the erasure (within its 24 h idempotency window, which resolves the same subject) retires them.
            if (resolved.ResolvedForUnansweredCreates && resolved.ReadAt is { } readAt
                && resolved.ResolvedSubject is { } resolvedSubject
                && (after.Subjects.Contains(resolvedSubject) || resolvedGone))
            {
                // Codex ats round 13 [P2]: the fences that were stale BEFORE this run resolved (tenant, candidate id) belong
                // to creates that were dead by then, so any subject they made was the one resolved and erased above. Left in
                // place, they would make every later export or erasure POST /v1/subjects again, which creates a fresh
                // subject once the provider's 24 h idempotency window has passed. Younger fences stay.
                await _repository.RetireStaleCreateFencesAsync(organizationId, candidateId, readAt, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        return new ProviderErasureResult(
            requested == subjects.Count ? ProviderErasureOutcome.Requested : ProviderErasureOutcome.Incomplete,
            subjects.Count, requested);
    }
}
