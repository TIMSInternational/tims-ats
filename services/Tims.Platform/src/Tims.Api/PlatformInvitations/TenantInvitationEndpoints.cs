using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.PlatformInvitations;

namespace Tims.Api.PlatformInvitations;

/// <summary>
/// F8: a company admin invites users to THEIR OWN organization. The organization is taken from the resolved
/// principal only (no organization id is accepted in any route or body). Every route requires
/// <c>user:create</c> at organization scope (<see cref="TenantInvitationGate"/>); creation additionally
/// enforces InvitationGrantPolicy, so nobody can grant a role above their own. Rate limiting is the global
/// RateLimitMiddleware (same as the platform invitation routes). Dark unless TenantInvitationsEnabled.
/// </summary>
public static class TenantInvitationEndpoints
{
    public static void MapTenantInvitationEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant-invitations/roles", async (ClaimsPrincipal user, HttpContext http, PrincipalResolver resolver,
            PermissionService permissions, IOptions<PlatformOptions> platform, TenantInvitationsUseCase useCase, CancellationToken ct) =>
        {
            var gate = await TenantInvitationGate.AuthorizeAsync(user, http, resolver, permissions, platform.Value, false, ct);
            if (gate.Failure is not null) return gate.Failure;
            var roles = await useCase.ListGrantableRolesAsync(gate.OrganizationId, gate.Context!.Roles, ct);
            return roles is null ? Results.NotFound() : Results.Ok(new InvitationRolesResponse(roles));
        }).RequireAuthorization().Produces<InvitationRolesResponse>().Produces(400).Produces(401).Produces(403).Produces(404)
            .WithName("ListTenantInvitationRoles").WithTags("TenantInvitations");

        app.MapGet("/tenant-invitations", async (ClaimsPrincipal user, HttpContext http, PrincipalResolver resolver,
            PermissionService permissions, IOptions<PlatformOptions> platform, TenantInvitationsUseCase useCase, CancellationToken ct) =>
        {
            var gate = await TenantInvitationGate.AuthorizeAsync(user, http, resolver, permissions, platform.Value, false, ct);
            if (gate.Failure is not null) return gate.Failure;
            return Results.Ok(new TenantInvitationsResponse(await useCase.ListAsync(gate.OrganizationId, ct)));
        }).RequireAuthorization().Produces<TenantInvitationsResponse>().Produces(400).Produces(401).Produces(403)
            .WithName("ListTenantInvitations").WithTags("TenantInvitations");

        app.MapPost("/tenant-invitations", async (ClaimsPrincipal user, HttpContext http, PrincipalResolver resolver,
            PermissionService permissions, IOptions<PlatformOptions> platform, IOptions<InvitationDeliveryOptions> delivery,
            TenantInvitationsUseCase useCase, ISecurityEventWriter audit, CancellationToken ct) =>
        {
            var gate = await TenantInvitationGate.AuthorizeAsync(user, http, resolver, permissions, platform.Value, true, ct);
            if (gate.Failure is not null) return gate.Failure;
            var input = await ReadInput(http, ct);
            if (input is null) return Results.BadRequest(new { message = "Invalid user invitation" });
            var result = await useCase.CreateAsync(gate.OrganizationId, gate.Context!.Roles, input.Value.Email,
                input.Value.RoleSlug, gate.ActorId, new Uri(delivery.Value.AppOrigin), ct);
            if (result.Outcome == TenantInvitationCreateOutcome.RoleNotGrantable)
            {
                await audit.WriteAsync(new SecurityEvent(gate.OrganizationId, gate.ActorId, "user_invitation_denied",
                    "platform_invitation", null, new JsonObject { ["reason"] = "role_not_grantable", ["roleSlug"] = input.Value.RoleSlug },
                    http.ClientIpFor()), CancellationToken.None);
                return Results.Json(new { message = "You cannot grant a role above your own" }, statusCode: 403);
            }
            if (result.Outcome != TenantInvitationCreateOutcome.Created)
            {
                return result.Outcome switch
                {
                    TenantInvitationCreateOutcome.Duplicate => Results.Conflict(new { message = "An invitation for this email already exists" }),
                    TenantInvitationCreateOutcome.OrganizationUnavailable => Results.NotFound(new { message = "Organization is unavailable" }),
                    TenantInvitationCreateOutcome.RoleUnavailable => Results.BadRequest(new { message = "Role is unavailable in your organization" }),
                    _ => Results.BadRequest(new { message = "Invalid user invitation" }),
                };
            }
            var response = result.Response!;
            await audit.WriteAsync(new SecurityEvent(gate.OrganizationId, gate.ActorId, "user_invitation_delivery",
                "platform_invitation", response.Id.ToString(), new JsonObject { ["outcome"] = response.Delivery, ["surface"] = "tenant" },
                http.ClientIpFor()), CancellationToken.None);
            // A committed creation is a success even if delivery is unconfirmed; the UI shows the outcome.
            return Results.Ok(response);
        }).RequireAuthorization().Accepts<TenantInvitationBody>("application/json")
            .Produces<OrganizationInvitationResponse>().Produces(400).Produces(401).Produces(403).Produces(404).Produces(409)
            .WithName("CreateTenantInvitation").WithTags("TenantInvitations");

        app.MapPost("/tenant-invitations/{id}/resend", async (string id, ClaimsPrincipal user, HttpContext http,
            PrincipalResolver resolver, PermissionService permissions, IOptions<PlatformOptions> platform,
            IOptions<InvitationDeliveryOptions> delivery, TenantInvitationsUseCase useCase, ISecurityEventWriter audit, CancellationToken ct) =>
        {
            // Bind id as string: authorization precedes GUID validation, including malformed ids.
            var gate = await TenantInvitationGate.AuthorizeAsync(user, http, resolver, permissions, platform.Value, true, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParseExact(id, "D", out var invitationId)) return Results.BadRequest();
            var result = await useCase.ResendAsync(gate.OrganizationId, invitationId, new Uri(delivery.Value.AppOrigin), ct);
            await audit.WriteAsync(new SecurityEvent(gate.OrganizationId, gate.ActorId, "invitation_resend", "platform_invitation", id,
                new JsonObject { ["outcome"] = result.Outcome.ToString(), ["surface"] = "tenant" }, http.ClientIpFor()), CancellationToken.None);
            return result.Outcome switch
            {
                InvitationResendOutcome.Sent => Results.Ok(result.Response),
                InvitationResendOutcome.NotFound => Results.NotFound(new { message = "Invitacion no encontrada" }),
                InvitationResendOutcome.InvalidStatus => Results.BadRequest(new { message = "Cannot resend accepted or revoked invitation" }),
                InvitationResendOutcome.ChangedDuringDelivery => Results.Conflict(new { message = "Invitation changed during delivery; refresh before resending" }),
                InvitationResendOutcome.StateUnconfirmed => Results.Json(new { message = "Email accepted but invitation status is unconfirmed; refresh before resending" }, statusCode: 503),
                _ => Results.Json(new { message = "Email delivery unconfirmed; invitation was not marked sent" }, statusCode: 503),
            };
        }).RequireAuthorization().Produces<InvitationResendResponse>().Produces(400).Produces(401).Produces(403).Produces(404).Produces(409).Produces(503)
            .WithName("ResendTenantInvitation").WithTags("TenantInvitations");

        app.MapPost("/tenant-invitations/{id}/revoke", async (string id, ClaimsPrincipal user, HttpContext http,
            PrincipalResolver resolver, PermissionService permissions, IOptions<PlatformOptions> platform,
            TenantInvitationsUseCase useCase, CancellationToken ct) =>
        {
            var gate = await TenantInvitationGate.AuthorizeAsync(user, http, resolver, permissions, platform.Value, true, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParseExact(id, "D", out var invitationId)) return Results.BadRequest();
            // The revoke and its audit row commit atomically inside the repository's TenantScope.
            return await useCase.RevokeAsync(gate.OrganizationId, invitationId, gate.ActorId, ct) switch
            {
                TenantInvitationRevokeOutcome.Revoked => Results.Ok(new TenantInvitationRevokeResponse(invitationId, "revoked")),
                TenantInvitationRevokeOutcome.NotFound => Results.NotFound(new { message = "Invitacion no encontrada" }),
                _ => Results.BadRequest(new { message = "Cannot revoke an accepted or revoked invitation" }),
            };
        }).RequireAuthorization().Produces<TenantInvitationRevokeResponse>().Produces(400).Produces(401).Produces(403).Produces(404)
            .WithName("RevokeTenantInvitation").WithTags("TenantInvitations");
    }

    private static async Task<(string Email, string RoleSlug)?> ReadInput(HttpContext http, CancellationToken ct)
    {
        // Bound the body before parsing, including chunked requests. Authorization runs before this read.
        var buffer = new byte[4097];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await http.Request.Body.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        if (length is 0 or > 4096) return null;
        try
        {
            using var json = JsonDocument.Parse(buffer.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 4 });
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            // Exactly {email, roleSlug}: an organizationId (or any other key) is rejected, never ignored.
            var keys = root.EnumerateObject().Select(p => p.Name).ToArray();
            if (keys.Length != 2 || !keys.Contains("email", StringComparer.Ordinal) || !keys.Contains("roleSlug", StringComparer.Ordinal))
                return null;
            if (root.GetProperty("email").ValueKind != JsonValueKind.String ||
                root.GetProperty("roleSlug").ValueKind != JsonValueKind.String) return null;
            return (root.GetProperty("email").GetString()!, root.GetProperty("roleSlug").GetString()!);
        }
        catch (JsonException) { return null; }
    }

    // Documentation DTO; the handler parses manually so unknown keys (e.g. organizationId) are rejected.
    public sealed class TenantInvitationBody
    {
        [Required, MaxLength(254)] public string Email { get; init; } = "";
        [Required, MinLength(1), MaxLength(50)] public string RoleSlug { get; init; } = "";
    }
}
