using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Identity;
using Tims.Application.Proctoring;
using Tims.Domain.Identity;

namespace Tims.Api.Proctoring;

public sealed record CandidateProctoringCapabilities(bool Camera, bool Screen);
public sealed record CandidateProctoringStartRequest(
    bool AssessmentConsentAccepted,
    bool ProctoringConsentAccepted,
    CandidateProctoringCapabilities? Capabilities);
public sealed record CandidateProctoringEventRequest(Guid EventId, string? Type, DateTimeOffset? ClientTimestamp);
public sealed record CandidateMediaConsentRequest(bool Accepted);
public sealed record CandidateMediaIntentRequest(Guid ClientCaptureId, string? MediaType,
    string? CaptureReason, string? ContentType);
public sealed record CandidateMediaConfirmRequest(Guid EvidenceId);
public sealed record CandidateExplanationRequest(Guid SubmissionId, string? Text);

/// <summary>
/// Authenticated candidate endpoints. The JWT supplies sub/email; the route
/// supplies only the organization slug and assignment id. Candidate identity is
/// resolved staff-first by PrincipalResolver and is never client-submitted.
/// </summary>
public static class CandidateProctoringEndpoints
{
    public static void MapCandidateProctoringEndpoints(this WebApplication app,
        bool mediaRoutesEnabled = false)
    {
        var group = app.MapGroup("/candidate/{orgSlug}/assessments/{assignmentId:guid}/proctoring")
            .RequireAuthorization();

        group.MapPost("/start", async (
            string orgSlug, Guid assignmentId, CandidateProctoringStartRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext, principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                var result = await useCase.StartAsync(gate.OrgId, gate.CandidateId, assignmentId,
                    request.AssessmentConsentAccepted, request.ProctoringConsentAccepted,
                    request.Capabilities?.Camera == true, request.Capabilities?.Screen == true,
                    httpContext.ClientIpFor(), httpContext.Request.Headers.UserAgent.FirstOrDefault(), ct);
                return Results.Ok(result);
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateStartProctoring");

        group.MapPost("/events", async (
            string orgSlug, Guid assignmentId, CandidateProctoringEventRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext, principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                var result = await useCase.ReportEventAsync(gate.OrgId, gate.CandidateId, assignmentId,
                    request.EventId, request.Type, request.ClientTimestamp, ct);
                return Results.Ok(result);
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateReportProctoringEvent");

        group.MapPost("/heartbeat", async (
            string orgSlug, Guid assignmentId,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext, principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await useCase.HeartbeatAsync(gate.OrgId, gate.CandidateId, assignmentId, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateHeartbeatProctoring");

        group.MapPost("/complete", async (
            string orgSlug, Guid assignmentId,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext, principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await useCase.CompleteAsync(gate.OrgId, gate.CandidateId, assignmentId, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateCompleteProctoring");

        group.MapGet("/explanation", async (
            string orgSlug, Guid assignmentId,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            CandidateExplanationUseCase explanationUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                httpContext.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await explanationUseCase.GetAsync(
                    gate.OrgId, gate.CandidateId, assignmentId, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateGetProctoringExplanation");

        group.MapPost("/explanation", async (
            string orgSlug, Guid assignmentId, CandidateExplanationRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            CandidateExplanationUseCase explanationUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                httpContext.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await explanationUseCase.SubmitAsync(
                    gate.OrgId, gate.CandidateId, assignmentId,
                    request.SubmissionId, request.Text, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithMetadata(new RequestSizeLimitAttribute(16 * 1024))
            .WithName("CandidateSubmitProctoringExplanation");

        if (!mediaRoutesEnabled) return;

        group.MapPost("/media-consent", async (
            string orgSlug, Guid assignmentId, CandidateMediaConsentRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            ProctoringEvidenceUseCase evidenceUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await evidenceUseCase.AcceptMediaConsentAsync(
                    gate.OrgId, gate.CandidateId, assignmentId, request.Accepted, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateAcceptProctoringMediaConsent");

        group.MapPost("/media-stop", async (
            string orgSlug, Guid assignmentId,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            ProctoringEvidenceUseCase evidenceUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await evidenceUseCase.StopMediaCaptureAsync(
                    gate.OrgId, gate.CandidateId, assignmentId, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateStopProctoringMedia");

        group.MapPost("/media-intents", async (
            string orgSlug, Guid assignmentId, CandidateMediaIntentRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            ProctoringEvidenceUseCase evidenceUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await evidenceUseCase.CreateIntentAsync(gate.OrgId,
                    gate.CandidateId, assignmentId, request.ClientCaptureId,
                    request.MediaType, request.CaptureReason, request.ContentType, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateCreateProctoringMediaIntent");

        group.MapPost("/media-confirm", async (
            string orgSlug, Guid assignmentId, CandidateMediaConfirmRequest request,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, IOptions<PlatformOptions> options,
            CandidateProctoringUseCase useCase,
            ProctoringEvidenceUseCase evidenceUseCase, CancellationToken ct) =>
        {
            try
            {
                var gate = await GateAsync(orgSlug, user, httpContext,
                    principalResolver, options.Value, useCase, ct);
                if (gate.Failure is not null) return gate.Failure;
                return Results.Ok(await evidenceUseCase.ConfirmAsync(gate.OrgId,
                    gate.CandidateId, assignmentId, request.EvidenceId,
                    options.Value.CloudInferenceEnabled,
                    options.Value.ProctoringModelRevision, ct));
            }
            catch (ProctoringException ex) { return Error(ex); }
        }).WithName("CandidateConfirmProctoringMedia");
    }

    private static async Task<(Guid OrgId, Guid CandidateId, IResult? Failure)> GateAsync(
        string orgSlug, ClaimsPrincipal user, HttpContext httpContext,
        PrincipalResolver principalResolver, PlatformOptions options,
        CandidateProctoringUseCase useCase, CancellationToken ct)
    {
        var sub = user.FindFirstValue("sub");
        var email = user.FindFirstValue("email");
        if (string.IsNullOrWhiteSpace(sub) || string.IsNullOrWhiteSpace(email))
            return (default, default, Results.Unauthorized());
        var orgId = await useCase.ResolveOrganizationBySlugAsync(orgSlug, ct);
        if (orgId is null) return (default, default, Results.NotFound());
        var resolved = await principalResolver.ResolveAsync(sub, email, orgId.Value.ToString(),
            httpContext.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
            DateTime.UtcNow, ct);
        if (resolved is not { PrincipalType: PrincipalType.Candidate }
            || !Guid.TryParse(resolved.UserId, out var candidateId)
            || !string.Equals(resolved.OrganizationId, orgId.Value.ToString(), StringComparison.OrdinalIgnoreCase))
            return (default, default, Results.Unauthorized());
        return (orgId.Value, candidateId, null);
    }

    private static IResult Error(ProctoringException ex) => ex.Error switch
    {
        ProctoringError.InvalidInput => Results.BadRequest(new { error = ex.Code }),
        ProctoringError.NotFound => Results.NotFound(new { error = ex.Code }),
        ProctoringError.Forbidden => Results.Json(new { error = ex.Code }, statusCode: StatusCodes.Status403Forbidden),
        ProctoringError.TooManyRequests => Results.Json(new { error = ex.Code }, statusCode: StatusCodes.Status429TooManyRequests),
        _ => Results.Conflict(new { error = ex.Code }),
    };
}
