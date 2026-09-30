using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Tims.Api.Http;
using Tims.Application.InterviewJoin;
using Tims.Infrastructure.InterviewJoin;

namespace Tims.Api.InterviewJoin;

/// <summary>
/// WP-H: the candidate's anonymous, capability-token video-interview join. Mapped only when
/// <c>Platform:CandidateInterviewJoinEnabled</c> is on (or during OpenAPI generation). Rate-limited on the
/// strict <c>auth</c> tier by IP (<see cref="Tims.Api.RateLimiting.RateLimitHttp"/>).
/// </summary>
public static class CandidateInterviewJoinEndpoints
{
    public const string RoutePath = "/interviews/candidate-join";
    private const int MaxBodyBytes = 1024;

    /// <summary>
    /// True for this route in any spelling ASP.NET routing also matches — case-insensitive and with or without a
    /// trailing slash — so the rate-limit tier and the relay allow-list cannot be sidestepped by <c>.../candidate-join/</c>.
    /// </summary>
    public static bool IsRoute(PathString path) =>
        path.Value is { Length: > 0 } value &&
        string.Equals(value.TrimEnd('/'), RoutePath, StringComparison.OrdinalIgnoreCase);

    public static void MapCandidateInterviewJoinEndpoints(this WebApplication app)
    {
        app.MapPost(RoutePath, async (HttpContext http, CandidateInterviewJoin join, ILoggerFactory loggers,
            CancellationToken ct) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            http.Response.Headers["Referrer-Policy"] = "no-referrer";
            var body = await ReadAsync(http, ct);
            if (body is null) return Results.BadRequest();
            var userAgent = http.Request.Headers.UserAgent.ToString();
            var result = await join.JoinAsync(body.Token, http.ClientIpFor(),
                string.IsNullOrEmpty(userAgent) ? null : userAgent, ct);
            // Outcome only: the token, the join URL and the caller's attribution are never logged.
            loggers.CreateLogger("Tims.Api.InterviewJoin").LogInformation(
                "Candidate interview join outcome {Outcome}", result.Outcome);
            return Results.Ok(result);
        }).AllowAnonymous().Accepts<JoinBody>("application/json").Produces<CandidateJoinResult>()
            .Produces(400).Produces(429).WithName("CandidateInterviewJoin").WithTags("CandidateInterviewJoin");
    }

    /// <summary>
    /// Startup signal (warning, never a failure): the join is ON but <c>Daily:ApiKey</c> is blank or still the
    /// terraform placeholder, so every joinable interview answers <c>unavailable</c>. Without this line the only
    /// symptom is candidates retrying a dead page. Returns whether it warned.
    /// </summary>
    public static bool WarnIfVideoUnconfigured(ILogger logger, bool joinEnabled, DailyOptions daily)
    {
        if (!joinEnabled || daily.HasUsableApiKey) return false;
        logger.LogWarning(
            "Platform:CandidateInterviewJoinEnabled is on but Daily:ApiKey is not configured (blank or the " +
            "terraform placeholder): every candidate video join will answer 'unavailable'. Set Daily__ApiKey.");
        return true;
    }

    /// <summary>Strict body: JSON object with exactly one string property <c>token</c>, bounded size.</summary>
    internal static async Task<JoinBody?> ReadAsync(HttpContext http, CancellationToken ct)
    {
        if (http.Request.ContentType?.Split(';')[0].Trim() != "application/json") return null;
        var bytes = new byte[MaxBodyBytes + 1];
        var length = 0;
        while (length < bytes.Length)
        {
            var read = await http.Request.Body.ReadAsync(bytes.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        if (length is 0 or > MaxBodyBytes) return null;
        try
        {
            using var document = JsonDocument.Parse(bytes.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 2 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var properties = root.EnumerateObject().ToArray();
            if (properties.Length != 1 || properties[0].Name != "token" ||
                properties[0].Value.ValueKind != JsonValueKind.String) return null;
            return new JoinBody { Token = properties[0].Value.GetString() ?? "" };
        }
        catch (JsonException) { return null; }
    }

    public sealed class JoinBody
    {
        [Required, StringLength(43, MinimumLength = 43)] public string Token { get; init; } = "";
    }
}
