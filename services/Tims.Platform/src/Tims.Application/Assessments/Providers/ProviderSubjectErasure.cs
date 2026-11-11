namespace Tims.Application.Assessments.Providers;

/// <summary>What the provider's <c>getSubject</c> says about one subject's erasure.</summary>
public enum SubjectErasureAnswer
{
    /// <summary>Confirmed: 410 <c>subject_erased</c>, or the subject itself reported <c>erasure_pending</c>/<c>erased</c>.</summary>
    Erased,

    /// <summary>A definitive answer that is not an erasure (an active subject, a 404, another 410 code, a refusal).</summary>
    NotErased,

    /// <summary>An outage, a timeout or an unconfigured client: nothing is known; ask again soon.</summary>
    Inconclusive,
}

/// <summary>
/// The one rule that lets the ATS apply a provider erasure without its <c>subject.erased</c> webhook (Codex r13 P1): only
/// the provider's own subject lookup confirming it. A gone assignment, a 404 on the subject (also what a route the
/// provider does not serve answers) or any other code is never read as an erasure.
/// </summary>
public static class ProviderSubjectErasure
{
    public const string SubjectErasedCode = "subject_erased";

    public static async Task<SubjectErasureAnswer> AskAsync(
        IAssessmentProvider provider, Guid subjectId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(provider);
        var subject = await provider.GetSubjectAsync(subjectId, cancellationToken).ConfigureAwait(false);
        if (subject.Ok)
        {
            return subject.Value!.SubjectId == subjectId && subject.Value.Status is "erasure_pending" or "erased"
                ? SubjectErasureAnswer.Erased
                : SubjectErasureAnswer.NotErased;
        }

        var failure = subject.Failure!;
        if (failure.HttpStatus == 410 && failure.Code == SubjectErasedCode)
        {
            return SubjectErasureAnswer.Erased;
        }

        return failure.Transient || failure.Code == ProviderFailure.Unconfigured
            ? SubjectErasureAnswer.Inconclusive
            : SubjectErasureAnswer.NotErased;
    }
}
