using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.PlatformInvitations;

namespace Tims.Api.PlatformInvitations;

public static class InvitationResendEndpoints
{
    public static void MapInvitationResendEndpoints(this WebApplication app)
    {
        app.MapPost("/platform/invitations/{id}/resend", async (string id, ClaimsPrincipal user,
            HttpContext http, PrincipalResolver resolver, IOptions<PlatformOptions> platform,
            IOptions<InvitationDeliveryOptions> delivery, InvitationResendUseCase useCase,
            ISecurityEventWriter audit, CancellationToken ct) =>
        {
            // Bind id as string: authorization must precede GUID validation, including malformed ids.
            var gate = await PlatformOwnerGate.AuthorizeAsync(user, http, resolver, platform.Value, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParseExact(id, "D", out var invitationId)) return Results.BadRequest();
            var result = await useCase.ExecuteAsync(invitationId, new Uri(delivery.Value.AppOrigin), ct);

            // Target tenant for a known invitation, otherwise actor's tenant. The generic audit schema
            // requires an org; genuinely pre-tenant/unknown targets with an org-less actor are skipped.
            var organization = result.OrganizationId;
            if (organization is null && Guid.TryParse(gate.Context!.OrganizationId, out var actorOrg)) organization = actorOrg;
            if (organization is { } org && Guid.TryParse(gate.Context!.UserId, out var actor))
                await audit.WriteAsync(new SecurityEvent(org, actor, "invitation_resend", "platform_invitation", id,
                    new JsonObject { ["outcome"] = result.Outcome.ToString() }, http.ClientIpFor()), CancellationToken.None);

            return result.Outcome switch
            {
                InvitationResendOutcome.Sent => Results.Ok(result.Response),
                InvitationResendOutcome.NotFound => Results.NotFound(new { message = "Invitacion no encontrada" }),
                InvitationResendOutcome.InvalidStatus => Results.BadRequest(new { message = "Cannot resend accepted or revoked invitation" }),
                InvitationResendOutcome.ChangedDuringDelivery => Results.Conflict(new { message = "Invitation changed during delivery; refresh before resending" }),
                InvitationResendOutcome.StateUnconfirmed => Results.Json(new { message = "Email accepted but invitation status is unconfirmed; refresh before resending" }, statusCode: 503),
                _ => Results.Json(new { message = "Email delivery unconfirmed; invitation was not marked sent" }, statusCode: 503),
            };
        }).RequireAuthorization().WithName("ResendPlatformInvitation").WithTags("PlatformInvitations")
            .Produces<InvitationResendResponse>().Produces(400).Produces(401).Produces(403).Produces(404).Produces(409).Produces(503);
    }
}
