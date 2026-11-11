namespace Tims.Application.Assessments.Providers;

/// <summary>
/// How often the erasure sweep asks about one subject, and how many subjects one run asks about. Bound from
/// <c>Platform:AssessmentProviderErasureCheckIntervalDays</c> and <c>Platform:AssessmentProviderErasureCheckMaxSubjects</c>.
/// </summary>
public sealed record ProviderErasureSweepSettings(TimeSpan CheckInterval, int MaxSubjectsPerRun)
{
    public const int DefaultCheckIntervalDays = 7;
    public const int DefaultMaxSubjectsPerRun = 200;

    public static ProviderErasureSweepSettings Default { get; } =
        new(TimeSpan.FromDays(DefaultCheckIntervalDays), DefaultMaxSubjectsPerRun);
}

/// <summary>What one sweep did: subjects asked about, subjects erased locally, lookups that failed (retried next run).</summary>
public sealed record ErasureSweep(int Checked, int Erased, int Failed);

/// <summary>One run of the erasure sweep over every organization.</summary>
public interface IProviderErasureSweep
{
    Task<ErasureSweep> RunAsync(DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>
/// The erasure sweep (Codex r13 P1, coordinator decision 2026-11-11): <c>subject.erased</c> is the primary signal, but a
/// lost or exhausted delivery must not leave an erased subject's scores with staff and FIT. The D17 poller re-reads only
/// attempts inside the 30-day revision window, so this sweep covers EVERY subject that still holds a stored result,
/// whatever its age (an unbound binding's retained results included):
/// <list type="number">
/// <item>lists, pre-tenant, the subjects due for a check (never checked, or checked
/// <see cref="ProviderErasureSweepSettings.CheckInterval"/> or more ago), oldest-checked first, at most
/// <see cref="ProviderErasureSweepSettings.MaxSubjectsPerRun"/>;</item>
/// <item>per subject, under its organization's tenant scope, claims the check (a conditional stamp, so two instances never
/// ask about one subject in one interval) and asks <c>GET /v1/subjects/{id}</c>;</item>
/// <item>applies the confirmed-erasure rule of <see cref="ProviderSubjectErasure"/>: only a confirmed erasure runs the
/// webhook's own local erasure (audited <c>via: sweep</c>). A definitive non-erasure keeps the stamp (asked again after
/// the interval); an inconclusive lookup gives the claim back, so the next run (one poll tick later) asks again.</item>
/// </list>
/// A failed subject never stops the others.
/// </summary>
public sealed class ProviderErasureSweepUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, ProviderErasureSweepSettings settings)
    : IProviderErasureSweep
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly ProviderErasureSweepSettings _settings = settings ?? throw new ArgumentNullException(nameof(settings));

    public async Task<ErasureSweep> RunAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!_provider.IsConfigured)
        {
            // Nothing could be asked; claiming would only push every subject's next check back.
            return new ErasureSweep(0, 0, 0);
        }

        var due = await _repository.ListSubjectsDueForErasureCheckAsync(
                _settings.CheckInterval, _settings.MaxSubjectsPerRun, cancellationToken)
            .ConfigureAwait(false);
        int asked = 0, erased = 0, failed = 0;
        foreach (var subject in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            DateTimeOffset? claimed = null;
            try
            {
                claimed = await _repository.ClaimSubjectErasureCheckAsync(
                        subject.OrganizationId, subject.ProviderSubjectId, _settings.CheckInterval, cancellationToken)
                    .ConfigureAwait(false);
                if (claimed is null)
                {
                    continue; // another instance asked about it meanwhile
                }

                asked++;
                var answer = await ProviderSubjectErasure.AskAsync(_provider, subject.ProviderSubjectId, cancellationToken)
                    .ConfigureAwait(false);
                if (answer == SubjectErasureAnswer.Erased)
                {
                    if (await _repository.EraseSubjectAsync(subject.OrganizationId, subject.ProviderSubjectId, now,
                            cancellationToken, via: "sweep").ConfigureAwait(false) > 0)
                    {
                        erased++;
                    }
                }
                else if (answer == SubjectErasureAnswer.Inconclusive)
                {
                    failed++;
                    await ReleaseAsync(subject, claimed.Value, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                failed++;
                if (claimed is { } stamp)
                {
                    await ReleaseAsync(subject, stamp, cancellationToken).ConfigureAwait(false);
                }
            }
        }

        return new ErasureSweep(asked, erased, failed);
    }

    private async Task ReleaseAsync(SubjectErasureCheck subject, DateTimeOffset claimed, CancellationToken cancellationToken)
    {
        try
        {
            await _repository.ReleaseSubjectErasureCheckAsync(subject.OrganizationId, subject.ProviderSubjectId, claimed,
                subject.LastCheckedAt, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // The stamp stays: the subject is asked about again after the interval instead of at the next run.
        }
    }
}
