using System.Text.Json;
using Tims.Domain.RateLimiting;

namespace Tims.Api.RateLimiting;

/// <summary>
/// Shared HTTP-shaping helpers for the rate-limit seam, used by BOTH the
/// <see cref="RateLimitMiddleware"/> (product surfaces) and the <see cref="ApiKeyRateLimitFilter"/>
/// (per-key quota on the ApiKey-policy endpoints). Keeps the category derivation and the 429 payload
/// (the Spanish retry message, byte-identical to the TS <c>TRPCError</c>) in ONE place.
/// </summary>
internal static class RateLimitHttp
{
    /// <summary>Selects the category for a request (dotted-path + GET/HEAD→query / other→mutation).</summary>
    public static RateLimitCategory CategoryFor(HttpRequest request)
    {
        // These are fixed non-AI operations. The org slug and assignment id are
        // dynamic URL segments, so passing the raw URL to the tRPC keyword policy
        // lets a slug containing "screen" or "medical" consume the 10/min AI
        // budget (and share an org-wide bucket) during a live assessment.
        if (TryCandidateProctoringPath(request.Path, out _))
            return RequestTypeOf(request.Method) == RateLimitRequestType.Mutation
                ? RateLimitCategory.Mutation : RateLimitCategory.Query;
        return RateLimitPolicy.CategoryFor(ToDottedPath(request.Path), RequestTypeOf(request.Method));
    }

    /// <summary>
    /// Matches only the four mapped candidate proctoring operations. Do not parse
    /// or trust the dynamic segments here; the endpoint and candidate resolver
    /// validate the slug and assignment independently.
    /// </summary>
    public static bool TryCandidateProctoringPath(PathString path, out string orgSlug)
    {
        orgSlug = string.Empty;
        var parts = (path.Value ?? string.Empty).Trim('/').Split('/');
        if (parts.Length != 6
            || !parts[0].Equals("candidate", StringComparison.OrdinalIgnoreCase)
            || parts[1].Length == 0
            || !parts[2].Equals("assessments", StringComparison.OrdinalIgnoreCase)
            || parts[3].Length == 0
            || !parts[4].Equals("proctoring", StringComparison.OrdinalIgnoreCase)
            || !(parts[5].Equals("start", StringComparison.OrdinalIgnoreCase)
                || parts[5].Equals("events", StringComparison.OrdinalIgnoreCase)
                || parts[5].Equals("heartbeat", StringComparison.OrdinalIgnoreCase)
                || parts[5].Equals("complete", StringComparison.OrdinalIgnoreCase)))
            return false;
        orgSlug = parts[1];
        return true;
    }

    /// <summary>Maps a URL path to the dotted-path shape the category rules expect (/candidate/export → candidate.export).</summary>
    public static string ToDottedPath(PathString path) =>
        (path.Value ?? string.Empty).Trim('/').Replace('/', '.');

    public static RateLimitRequestType RequestTypeOf(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method)
            ? RateLimitRequestType.Query
            : RateLimitRequestType.Mutation;

    /// <summary>
    /// Builds the 429 rejection: the retry-after seconds + the JSON body
    /// (<c>TOO_MANY_REQUESTS</c> + the Spanish retry message). The single source of the throttle
    /// response shape shared by the middleware and the per-key endpoint filter.
    /// </summary>
    public static (int RetryAfter, string Json) BuildRejection(RateLimitResult result)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var retryAfter = result.RetryAfterSeconds(nowMs);
        var json = JsonSerializer.Serialize(new
        {
            code = "TOO_MANY_REQUESTS",
            message = $"Demasiadas solicitudes. Intenta de nuevo en {retryAfter} segundos.",
        });
        return (retryAfter, json);
    }
}
