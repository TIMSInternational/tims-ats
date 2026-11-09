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
        var subjects = await ResolveSubjectsAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false);
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
            if (subjects.Erased.Contains(subject))
            {
                // The provider confirmed this subject's erasure (subject.erased): terminal, nothing left to read there.
                held.Add(new ProviderHeldSubjectExport(subject, "erased", null));
                continue;
            }

            var exported = await _provider.ExportSubjectAsync(subject, cancellationToken).ConfigureAwait(false);
            if (exported.Ok)
            {
                using var document = System.Text.Json.JsonDocument.Parse(exported.Value!.Json);
                held.Add(new ProviderHeldSubjectExport(subject, "exported", document.RootElement.Clone()));
                continue;
            }

            // Only a CONFIRMED absence is an answer (the client confirms a 404 with the subject lookup); anything else
            // means the provider may still hold data the export would omit.
            var status = exported.Failure!.HttpStatus switch
            {
                410 => "erased",
                404 => "not_found",
                _ => null,
            };
            if (status is null)
            {
                return new ProviderSubjectExportResult(ProviderExportOutcome.Incomplete, null);
            }

            held.Add(new ProviderHeldSubjectExport(subject, status, null));
        }

        var export = await _repository.ExportCandidateAsync(
            organizationId, candidateId, actorId, held.Count(h => h.Status == "exported"), now, cancellationToken)
            .ConfigureAwait(false);
        return export is null
            ? new ProviderSubjectExportResult(ProviderExportOutcome.CandidateNotFound, null)
            : new ProviderSubjectExportResult(ProviderExportOutcome.Exported, export with { ProviderExports = held });
    }

    /// <summary>
    /// The candidate's provider subjects: those recorded on its attempts, plus the one the provider resolves for
    /// (tenant, candidate id) whenever the candidate has attempts (a failed or crashed create can leave a subject no
    /// attempt names). <see cref="ResolvedSubjects.Outcome"/> is set when they cannot be resolved.
    /// </summary>
    private async Task<ResolvedSubjects> ResolveSubjectsAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
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
        if (known.HasAttempts && known.NeedsResolution)
        {
            // The subject is created BEFORE its assignment and recorded only with it, so a failed or crashed create can
            // leave a provider subject (possibly with names and email) no attempt names. Subjects are idempotent on
            // (tenant, external_ref = candidate id): resolve it that way, never trusting the local record alone.
            var binding = await _repository.GetActiveBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
            if (binding is null)
            {
                return new ResolvedSubjects(subjects, erased, ProviderErasureOutcome.Incomplete);
            }

            var request = new ProviderSubjectRequest(binding.ProviderTenantId, candidateId.ToString(), null, null, null, null);
            var resolved = await _provider.EnsureSubjectAsync(
                request, IdempotencyKeys.Subject(organizationId, request), cancellationToken).ConfigureAwait(false);
            if (!resolved.Ok)
            {
                return new ResolvedSubjects(subjects, erased, ProviderErasureOutcome.Incomplete);
            }

            if (!subjects.Contains(resolved.Value!.SubjectId))
            {
                subjects.Add(resolved.Value.SubjectId);
            }
        }

        return new ResolvedSubjects(subjects, erased, null);
    }

    private sealed record ResolvedSubjects(
        IReadOnlyList<Guid> Subjects, IReadOnlyList<Guid> Erased, ProviderErasureOutcome? Outcome);

    public async Task<ProviderErasureResult> EraseAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var resolved = await ResolveSubjectsAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false);
        if (resolved.Outcome is { } failed)
        {
            return new ProviderErasureResult(failed, resolved.Subjects.Count, 0);
        }

        var subjects = resolved.Subjects;
        var requested = 0;
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

            // The ATS's own copy is erased NOW, for an accepted request as for a confirmed 410/404: it never depends on
            // the provider's subject.erased event, which may never arrive (a delivery that exhausts its retries, or no
            // event at all for a subject already gone) and which the D17 poller cannot replace (it skips attempts under
            // an erasure request). That event's handler, when it lands, repeats this idempotently. It runs BEFORE the
            // marker, each in its own transaction: an interruption between them leaves the results deleted (and the
            // attempts erased, which refuses any later result) with the marker missing, so this run is not counted as
            // requested and a retry, safe at any point, records it. The reverse order could strand the results.
            await _repository.EraseSubjectAsync(organizationId, subject, now, cancellationToken).ConfigureAwait(false);
            await _repository.MarkErasureRequestedAsync(organizationId, candidateId, subject, status, actorId, now, cancellationToken)
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
        }

        return new ProviderErasureResult(
            requested == subjects.Count ? ProviderErasureOutcome.Requested : ProviderErasureOutcome.Incomplete,
            subjects.Count, requested);
    }
}
