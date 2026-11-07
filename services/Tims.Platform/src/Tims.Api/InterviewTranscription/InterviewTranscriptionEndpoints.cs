using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.InterviewTranscription;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.InterviewTranscription;

namespace Tims.Api.InterviewTranscription;

/// <summary>
/// Interview transcription (video interviews with AI listening), dark by default behind
/// <see cref="PlatformOptions.InterviewTranscriptionEnabled"/>:
/// <list type="bullet">
///   <item><description><c>GET /tenant/interviews/{id}/transcription</c> — interview:read + scope. Candidate decision,
///   the viewer's acknowledgement, transcript state. No names, no transcript.</description></item>
///   <item><description><c>POST /tenant/interviews/{id}/transcription/acknowledgement</c> — interview:read + scope. The
///   evaluator acknowledges the notice (audited). Body <c>{ consentVersion }</c>.</description></item>
///   <item><description><c>POST /tenant/interviews/{id}/transcription/start</c> — interview:create + scope (the grant
///   createVideoRoom needs). Starts a TRANSCRIPT in the interview's own Daily room once the candidate accepted and the
///   caller acknowledged. Body <c>{ language: "es" | "en" }</c>.</description></item>
///   <item><description><c>GET /tenant/interviews/{id}/transcript</c> — interview:read + scope. The stored transcript,
///   speakers pseudonymized to roles, plus the vacancy's competencies (input of the AI analysis in apps/web).</description></item>
///   <item><description><c>POST /webhooks/daily/interview-transcription</c> — anonymous; the Daily HMAC signature is
///   the authentication (<see cref="DailyWebhookSignature"/>).</description></item>
/// </list>
/// Order: auth (401/403) → scope (404) → body (400) → use case (TRAP 9: bodies are parsed after the gate).
/// </summary>
public static class InterviewTranscriptionEndpoints
{
    public const string WebhookPath = "/webhooks/daily/interview-transcription";
    private const int MaxBodyBytes = 1024;

    public static void MapInterviewTranscriptionEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant/interviews/{interviewId:guid}/transcription", async (Guid interviewId,
                ClaimsPrincipal user, HttpContext http, PrincipalResolver principals, PermissionService permissions,
                IOptions<PlatformOptions> platform, IAnchorLoaderFactory anchors, ScopedProbe probe,
                InterviewTranscriptionUseCase useCase, CancellationToken ct) =>
            {
                http.Response.Headers.CacheControl = "no-store";
                var gate = await InterviewTranscriptionStaffGate.AuthorizeAsync(interviewId, "read", user, http,
                    principals, permissions, platform.Value, anchors, probe, ct);
                if (gate.Failure is not null) return gate.Failure;
                return ToResult(await useCase.GetStatusAsync(gate.OrganizationId, gate.UserId, interviewId, ct));
            })
            .RequireAuthorization()
            .Produces<TranscriptionStatusView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("InterviewTranscriptionStatus").WithTags("InterviewTranscription");

        app.MapPost("/tenant/interviews/{interviewId:guid}/transcription/acknowledgement", async (Guid interviewId,
                ClaimsPrincipal user, HttpContext http, PrincipalResolver principals, PermissionService permissions,
                IOptions<PlatformOptions> platform, IAnchorLoaderFactory anchors, ScopedProbe probe,
                InterviewTranscriptionUseCase useCase, CancellationToken ct) =>
            {
                http.Response.Headers.CacheControl = "no-store";
                var gate = await InterviewTranscriptionStaffGate.AuthorizeAsync(interviewId, "read", user, http,
                    principals, permissions, platform.Value, anchors, probe, ct);
                if (gate.Failure is not null) return gate.Failure;
                var version = await ReadSingleStringAsync(http, "consentVersion", 64, ct);
                if (version is null) return Results.BadRequest(new { error = "invalid_input" });
                var userAgent = http.Request.Headers.UserAgent.ToString();
                return ToResult(await useCase.AcknowledgeAsync(gate.OrganizationId, gate.UserId, interviewId, version,
                    http.ClientIpFor(), string.IsNullOrEmpty(userAgent) ? null : userAgent, ct));
            })
            .RequireAuthorization()
            .Accepts<AcknowledgementBody>("application/json")
            .Produces<TranscriptionStatusView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("InterviewTranscriptionAcknowledge").WithTags("InterviewTranscription");

        app.MapPost("/tenant/interviews/{interviewId:guid}/transcription/start", async (Guid interviewId,
                ClaimsPrincipal user, HttpContext http, PrincipalResolver principals, PermissionService permissions,
                IOptions<PlatformOptions> platform, IAnchorLoaderFactory anchors, ScopedProbe probe,
                InterviewTranscriptionUseCase useCase, CancellationToken ct) =>
            {
                http.Response.Headers.CacheControl = "no-store";
                var gate = await InterviewTranscriptionStaffGate.AuthorizeAsync(interviewId, "create", user, http,
                    principals, permissions, platform.Value, anchors, probe, ct);
                if (gate.Failure is not null) return gate.Failure;
                var language = await ReadSingleStringAsync(http, "language", 8, ct);
                if (language is null) return Results.BadRequest(new { error = "invalid_input" });
                return ToResult(await useCase.StartAsync(gate.OrganizationId, gate.UserId, interviewId, language, ct));
            })
            .RequireAuthorization()
            .Accepts<StartBody>("application/json")
            .Produces<TranscriptionStatusView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict).Produces(StatusCodes.Status502BadGateway)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("InterviewTranscriptionStart").WithTags("InterviewTranscription");

        app.MapGet("/tenant/interviews/{interviewId:guid}/transcript", async (Guid interviewId,
                ClaimsPrincipal user, HttpContext http, PrincipalResolver principals, PermissionService permissions,
                IOptions<PlatformOptions> platform, IAnchorLoaderFactory anchors, ScopedProbe probe,
                InterviewTranscriptionUseCase useCase, CancellationToken ct) =>
            {
                http.Response.Headers.CacheControl = "no-store";
                var gate = await InterviewTranscriptionStaffGate.AuthorizeAsync(interviewId, "read", user, http,
                    principals, permissions, platform.Value, anchors, probe, ct);
                if (gate.Failure is not null) return gate.Failure;
                return ToResult(await useCase.GetTranscriptAsync(gate.OrganizationId, interviewId, ct));
            })
            .RequireAuthorization()
            .Produces<TranscriptView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound).Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status502BadGateway)
            .WithName("InterviewTranscriptGet").WithTags("InterviewTranscription");

        app.MapPost(WebhookPath, async (HttpContext http, IOptions<DailyWebhookOptions> webhook,
                InterviewTranscriptionUseCase useCase, TimeProvider clock, ILoggerFactory loggers,
                CancellationToken ct) =>
            {
                var body = await ReadBoundedAsync(http, DailyWebhookSignature.MaxBodyBytes, ct);
                var secret = webhook.Value.HasUsableSecret ? webhook.Value.WebhookSecret : null;
                if (body is null || !DailyWebhookSignature.Verify(secret,
                        http.Request.Headers["X-Webhook-Timestamp"].FirstOrDefault(),
                        http.Request.Headers["X-Webhook-Signature"].FirstOrDefault(), body, clock.GetUtcNow()))
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                var parsed = DailyWebhookEvents.Parse(body);
                if (parsed is null) return Results.Ok(new WebhookAnswer("ignored"));
                try
                {
                    var handled = await useCase.HandleWebhookAsync(parsed, ct);
                    // Type + outcome only: never room names, ids or payload fields.
                    loggers.CreateLogger("Tims.Api.InterviewTranscription").LogInformation(
                        "Daily webhook {Type} handled as {Outcome}", parsed.IsTranscriptEvent ? parsed.Type : "other",
                        handled);
                    return Results.Ok(new WebhookAnswer(handled.ToString().ToLowerInvariant()));
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    loggers.CreateLogger("Tims.Api.InterviewTranscription")
                        .LogError(exception, "Daily webhook handler failed");
                    return Results.Json(new WebhookAnswer("retry"), statusCode: StatusCodes.Status500InternalServerError);
                }
            })
            .AllowAnonymous()
            .Accepts<string>("application/json")
            .Produces<WebhookAnswer>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status500InternalServerError)
            .WithName("DailyInterviewTranscriptionWebhook").WithTags("InterviewTranscription");
    }

    /// <summary>Startup signal: the surface is on but the webhook secret is unusable (every delivery answers 401).</summary>
    public static bool WarnIfWebhookUnconfigured(ILogger logger, bool enabled, DailyWebhookOptions webhook)
    {
        if (!enabled || webhook.HasUsableSecret) return false;
        logger.LogWarning("Platform:InterviewTranscriptionEnabled is on but Daily:WebhookSecret is not a usable base64 " +
                          "secret: every Daily webhook will be rejected and no transcript will be stored.");
        return true;
    }

    private static IResult ToResult<T>(TranscriptionResult<T> result) =>
        result.Status == StatusCodes.Status200OK
            ? Results.Ok(result.Value)
            : Results.Json(new { code = result.Code, message = result.Message }, statusCode: result.Status);

    /// <summary>A JSON object with EXACTLY one bounded string property <paramref name="name"/>; anything else is null.</summary>
    internal static async Task<string?> ReadSingleStringAsync(HttpContext http, string name, int maxLength,
        CancellationToken ct)
    {
        if (http.Request.ContentType?.Split(';')[0].Trim() != "application/json") return null;
        var bytes = await ReadBoundedAsync(http, MaxBodyBytes, ct);
        if (bytes is null || bytes.Length == 0) return null;
        try
        {
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 2 });
            var properties = document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().ToArray()
                : [];
            if (properties.Length != 1 || properties[0].Name != name ||
                properties[0].Value.ValueKind != JsonValueKind.String) return null;
            var value = properties[0].Value.GetString();
            return value is { Length: > 0 } && value.Length <= maxLength ? value : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task<byte[]?> ReadBoundedAsync(HttpContext http, int max, CancellationToken ct)
    {
        var buffer = new byte[max + 1];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await http.Request.Body.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        return length > max ? null : buffer[..length];
    }

    public sealed class AcknowledgementBody
    {
        [Required, MaxLength(64)] public string ConsentVersion { get; init; } = "";
    }

    public sealed class StartBody
    {
        [Required, MaxLength(8)] public string Language { get; init; } = "";
    }

    public sealed record WebhookAnswer(string Handled);
}
