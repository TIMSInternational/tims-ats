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
    public static RateLimitCategory CategoryFor(HttpRequest request) =>
        IsCapabilityTokenRoute(request.Path)
            ? RateLimitCategory.Auth
            : RateLimitPolicy.CategoryFor(ToDottedPath(request.Path), RequestTypeOf(request.Method));

    /// <summary>
    /// Anonymous capability-token routes get the strict <c>auth</c> tier (IP-keyed), not the default mutation
    /// tier: the candidate interview join (WP-H). Referenced as a constant so it cannot drift from the route.
    /// </summary>
    private static bool IsCapabilityTokenRoute(PathString path) => string.Equals(path.Value,
        Tims.Api.InterviewJoin.CandidateInterviewJoinEndpoints.RoutePath, StringComparison.OrdinalIgnoreCase);

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
