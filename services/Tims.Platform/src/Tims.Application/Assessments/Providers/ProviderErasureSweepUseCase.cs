namespace Tims.Application.Assessments.Providers;

/// <summary>
/// How often the erasure sweep asks about one subject, and how many subjects one run asks about. Bound from
/// <c>Platform:AssessmentProviderErasureCheckIntervalDays</c> and <c>Platform:AssessmentProviderErasureCheckMaxSubjects</c>.
/// </summary>
public sealed record ProviderErasureSweepSettings(TimeSpan CheckInterval, int MaxSubjectsPerRun)
{
    public const int DefaultCheckIntervalDays = 7;
    public const int DefaultMaxSubjectsPerRun = 200;

    /// <summary>The first retry after an inconclusive lookup; it doubles per consecutive failure, up to the interval.</summary>
    public static readonly TimeSpan RetryBackoff = TimeSpan.FromMinutes(15);

    /// <summary>How long a claim holds a subject (a check is one provider read, bounded by the client's timeout).</summary>
    public static readonly TimeSpan ClaimLease = TimeSpan.FromMinutes(10);

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
/// <item>lists, pre-tenant, the subjects due for a check, least recently ATTEMPTED first, at most
/// <see cref="ProviderErasureSweepSettings.MaxSubjectsPerRun"/>;</item>
/// <item>per subject, under its organization's tenant scope, claims the check (a conditional stamp with a short lease,
/// so two instances never ask about one subject at once) and asks <c>GET /v1/subjects/{id}</c>;</item>
/// <item>applies the confirmed-erasure rule of <see cref="ProviderSubjectErasure"/>: only a confirmed erasure runs the
/// webhook's own local erasure (audited <c>via: sweep</c>). Any conclusive answer makes the subject due again after
/// <see cref="ProviderErasureSweepSettings.CheckInterval"/>; an inconclusive one after a bounded backoff
/// (<see cref="ProviderErasureSweepSettings.RetryBackoff"/>, doubling, at most the interval). Either way the claim moved
/// the subject to the back of the queue (Codex r13 run 3: restoring a failed subject's old stamp kept it first, so a
/// subject that always failed starved every subject behind it under the per-run cap).</item>
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

        var due = await _repository.ListSubjectsDueForErasureCheckAsync(_settings.MaxSubjectsPerRun, cancellationToken)
            .ConfigureAwait(false);
        int asked = 0, erased = 0, failed = 0;
        foreach (var subject in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            DateTimeOffset? claimed = null;
            try
            {
                claimed = await _repository.ClaimSubjectErasureCheckAsync(
                        subject.OrganizationId, subject.ProviderSubjectId, cancellationToken)
                    .ConfigureAwait(false);
                if (claimed is null)
                {
                    continue; // another instance asked about it meanwhile
                }

                asked++;
                var answer = await ProviderSubjectErasure.AskAsync(_provider, subject.ProviderSubjectId, cancellationToken)
                    .ConfigureAwait(false);
                if (answer == SubjectErasureAnswer.Erased
                    && await _repository.EraseSubjectAsync(subject.OrganizationId, subject.ProviderSubjectId, now,
                        cancellationToken, via: "sweep").ConfigureAwait(false) > 0)
                {
                    erased++;
                }

                var conclusive = answer != SubjectErasureAnswer.Inconclusive;
                if (!conclusive)
                {
                    failed++;
                }

                await RecordAsync(subject, claimed.Value, conclusive, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                failed++;
                if (claimed is { } stamp)
                {
                    await RecordAsync(subject, stamp, conclusive: false, cancellationToken).ConfigureAwait(false);
                }
            }
        }

        return new ErasureSweep(asked, erased, failed);
    }

    private async Task RecordAsync(
        SubjectErasureCheck subject, DateTimeOffset claimed, bool conclusive, CancellationToken cancellationToken)
    {
        try
        {
            await _repository.RecordSubjectErasureCheckAsync(subject.OrganizationId, subject.ProviderSubjectId, claimed,
                conclusive, _settings.CheckInterval, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // The claim's lease lapses on its own (ClaimLease), and the claim already moved the subject to the back.
        }
    }
}
