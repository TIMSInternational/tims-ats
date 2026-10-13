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
    /// A budget/configuration denial is a property of the tenant or platform, not
    /// of the CV, so the claim is always released WITHOUT consuming an attempt and
    /// a budget cap can never push a candidate's CV into the terminal exhausted
    /// state. The deferral length depends on why it was denied (see
    /// <see cref="BudgetDeferralUntil"/>): a spent monthly budget cannot recover
    /// before the next UTC month, so re-claiming it sooner only burns claim
    /// throughput that other tenants' CVs need. Tenants that opted out are never
    /// claimed at all (see <see cref="CvParseLeaseRepository.ClaimDueAsync"/>).
    /// </summary>
    public static readonly TimeSpan ConfigurationDeferral = TimeSpan.FromHours(1);
    public static readonly TimeSpan ExtractorSaturatedDeferral = TimeSpan.FromMinutes(10);
    private readonly ICvTextExtractor _extractor =
        extractor ?? new BoundedCvTextExtractor(BoundedCvTextExtractor.DefaultTimeout);

    /// <summary>When a denied document becomes due again.</summary>
    public static DateTime BudgetDeferralUntil(CvAiBudgetDenial reason, DateTime nowUtc) => reason switch
    {
        // The ledger sums spend from date_trunc('month', now) in UTC: nothing frees
        // budget before the first instant of next month.
        CvAiBudgetDenial.MonthlyBudgetSpent =>
            new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1),
        // Opt-out set after the claim (the claim itself skips opted-out tenants), or
        // the catalog agent is not active: re-check hourly.
        _ => nowUtc + ConfigurationDeferral
    };

    public async Task<CvRecoveryOutcome> RunOneAsync(CvParseLease lease, CancellationToken ct)
    {
        // Budget first: a denied tenant must not cost an S3 GET and a document decode.
        try { await parser.AuthorizeAsync(lease.OrganizationId, ct).ConfigureAwait(false); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (CvAiBudgetDeniedException denied) { return await DeferForBudgetAsync(lease, denied, ct).ConfigureAwait(false); }
        catch (Exception)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InferenceError, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
        }

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
        catch (CvAiBudgetDeniedException denied)
        {
            return await DeferForBudgetAsync(lease, denied, ct).ConfigureAwait(false);
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

    private async Task<CvRecoveryOutcome> DeferForBudgetAsync(CvParseLease lease,
        CvAiBudgetDeniedException denied, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        await leases.DeferAsync(lease, CvParseFailureCode.BudgetDenied,
            BudgetDeferralUntil(denied.Reason, now) - now, now, ct).ConfigureAwait(false);
        return CvRecoveryOutcome.Deferred;
    }
}
