namespace Tims.Infrastructure.CvParsing;

public enum CvRecoveryOutcome { Completed, Ineligible, Failed, Deferred }

/// <summary>
/// Executes one already-claimed CV recovery. Public application submission is
/// independent of this path. Any failed step leaves the original document
/// visible and unparsed; only a validated model response can complete it.
/// </summary>
public sealed class CvParseRecoveryProcessor(
    CvParseLeaseRepository leases,
    ICvObjectStore objects,
    ICvParser parser,
    ICvTextExtractor? extractor = null)
{
    /// <summary>
    /// A budget/configuration denial is a property of the tenant (monthly budget
    /// spent, agent disabled), not of the CV. The claim is released WITHOUT
    /// consuming an attempt and retried hourly, so a month-end budget cap can
    /// never push a candidate's CV into the terminal exhausted state.
    /// </summary>
    public static readonly TimeSpan BudgetDeferral = TimeSpan.FromHours(1);
    public static readonly TimeSpan ExtractorSaturatedDeferral = TimeSpan.FromMinutes(10);
    private readonly ICvTextExtractor _extractor =
        extractor ?? new BoundedCvTextExtractor(BoundedCvTextExtractor.DefaultTimeout);

    public async Task<CvRecoveryOutcome> RunOneAsync(CvParseLease lease, CancellationToken ct)
    {
        byte[] bytes;
        try
        {
            using var fetchTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            fetchTimeout.CancelAfter(TimeSpan.FromSeconds(20));
            bytes = await objects.FetchAsync(lease.OrganizationId, lease.FileKey, fetchTimeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (CvDocumentException)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InvalidDocument, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }
        catch (Exception)
        {
            await leases.FailAsync(lease, CvParseFailureCode.FetchError, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }

        string cvText;
        try { cvText = await _extractor.ExtractAsync(bytes, lease.FileKey, ct).ConfigureAwait(false); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (CvDocumentException)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InvalidDocument, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }
        catch (CvExtractorSaturatedException)
        {
            await leases.DeferAsync(lease, CvParseFailureCode.ExtractionError, ExtractorSaturatedDeferral,
                DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Deferred;
        }
        catch (CvExtractionTimeoutException)
        {
            // Retryable with backoff: a transient CPU stall must not be terminal,
            // and a decoder that hangs every time exhausts after MaxAttempts.
            await leases.FailAsync(lease, CvParseFailureCode.ExtractionError, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }

        CvParsedResult? parsed;
        try
        {
            parsed = await leases.RunWithConsentGateAsync(lease,
                token => parser.ParseAsync(lease.OrganizationId, cvText, token),
                DateTime.UtcNow, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (CvAiBudgetDeniedException)
        {
            await leases.DeferAsync(lease, CvParseFailureCode.BudgetDenied, BudgetDeferral,
                DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Deferred;
        }
        catch (CvInvalidOutputException)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InvalidOutput, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }
        catch (Exception)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InferenceError, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }

        if (parsed is null) return CvRecoveryOutcome.Ineligible;
        return await leases.CompleteAsync(lease, parsed.ParsedJson, parsed.EducationJson,
            parsed.LanguagesJson, DateTime.UtcNow, ct).ConfigureAwait(false)
            ? CvRecoveryOutcome.Completed : CvRecoveryOutcome.Ineligible;
    }
}
