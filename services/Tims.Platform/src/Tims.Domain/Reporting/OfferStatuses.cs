namespace Tims.Domain.Reporting;

/// <summary>
/// Stored <c>offers.status</c> values the reporting reads care about. <c>convertToEmployee</c> moves an
/// accepted offer to <c>converted</c>, so a converted offer IS a hire for every KPI: reporting filters
/// through <see cref="AcceptedLike"/>, never a bare <c>accepted</c> literal.
/// </summary>
public static class OfferStatuses
{
    public const string Accepted = "accepted";
    public const string Converted = "converted";

    /// <summary>Statuses that count as an accepted offer (a hire): accepted, and accepted-then-converted.</summary>
    public static readonly string[] AcceptedLike = [Accepted, Converted];
}
