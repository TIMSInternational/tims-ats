namespace Tims.Domain.RateLimiting;

/// <summary>
/// Pure category-selection logic — a faithful port of TS <c>getRateLimitCategory(path, type)</c>
/// (<c>packages/api/src/middleware/rate-limit.ts</c>), including the AI keyword list. Golden-fixtured
/// (<c>contracts/ratelimit-fixtures/category.json</c>) against the REAL TS function.
/// </summary>
public static class RateLimitPolicy
{
    /// <summary>
    /// The AI-endpoint keyword list, verbatim from TS <c>AI_PATH_KEYWORDS</c>. Matched
    /// case-insensitively against the lowercased path. Keep in sync with the TS array.
    /// </summary>
    public static readonly IReadOnlyList<string> AiPathKeywords =
    [
        "generate", "parse", "analyze", "inclusive", "screen", "recommend",
        "explainab", "nextbestaction", "detectbias", "wordcloud", "sentiment",
        "medical", "getguide", "faq", "assistant",
    ];

    /// <summary>
    /// Selects the rate-limit category for a tRPC path + procedure type. Order matters and mirrors
    /// TS exactly: (1) <c>auth.</c> prefix wins outright; (2) exact path
    /// <c>portal.applytovacancy</c> → ai; (3) any AI keyword substring → ai; (4) <c>export</c>
    /// substring → export; (5) otherwise the query/mutation default.
    /// </summary>
    public static RateLimitCategory CategoryFor(string path, RateLimitRequestType type)
    {
        ArgumentNullException.ThrowIfNull(path);

        // Auth endpoints — checked BEFORE lowercasing/AI so `auth.generateToken` stays auth.
        if (path.StartsWith("auth.", StringComparison.Ordinal))
        {
            return RateLimitCategory.Auth;
        }

        var p = path.ToLowerInvariant();

        // portal.applyToVacancy now synchronously invokes the AI cv-parser agent when a CV is
        // attached — the ai tier despite being an unauthenticated public mutation. Matched by
        // exact path, not an AI keyword substring: the staff-authenticated
        // candidate.applyToVacancy shares the same procedure name and never calls AI, so a
        // generic 'apply' keyword would incorrectly recategorize it too.
        if (p == "portal.applytovacancy")
        {
            return RateLimitCategory.Ai;
        }

        // AI-related endpoints (checked before export, matching TS ordering).
        foreach (var keyword in AiPathKeywords)
        {
            if (p.Contains(keyword, StringComparison.Ordinal))
            {
                return RateLimitCategory.Ai;
            }
        }

        // Export endpoints.
        if (p.Contains("export", StringComparison.Ordinal))
        {
            return RateLimitCategory.Export;
        }

        // Default by type.
        return type == RateLimitRequestType.Mutation ? RateLimitCategory.Mutation : RateLimitCategory.Query;
    }
}
