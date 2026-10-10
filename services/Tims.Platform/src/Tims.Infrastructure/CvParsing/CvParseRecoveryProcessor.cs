namespace Tims.Infrastructure.CvParsing;

public enum CvRecoveryOutcome { Completed, Ineligible, Failed }

/// <summary>
/// Executes one already-claimed CV recovery. Public application submission is
/// independent of this path. Any failed step leaves the original document
/// visible and unparsed; only a validated model response can complete it.
/// </summary>
public sealed class CvParseRecoveryProcessor(
    CvParseLeaseRepository leases,
    ICvObjectStore objects,
    ICvParser parser)
{
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
        try { cvText = CvTextExtractor.Extract(bytes, lease.FileKey); }
        catch (CvDocumentException)
        {
            await leases.FailAsync(lease, CvParseFailureCode.InvalidDocument, DateTime.UtcNow, ct).ConfigureAwait(false);
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
            await leases.FailAsync(lease, CvParseFailureCode.BudgetDenied, DateTime.UtcNow, ct).ConfigureAwait(false);
            return CvRecoveryOutcome.Failed;
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
