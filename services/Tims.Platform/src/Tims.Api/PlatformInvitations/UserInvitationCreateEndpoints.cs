using System.Security.Claims;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.PlatformInvitations;

namespace Tims.Api.PlatformInvitations;

public static class UserInvitationCreateEndpoints
{
    public static void MapUserInvitationCreateEndpoints(this WebApplication app)
    {
        app.MapGet("/platform/invitations/organizations/{id}/roles", async (string id, ClaimsPrincipal user, HttpContext http,
            PrincipalResolver resolver, IOptions<PlatformOptions> platform, UserInvitationCreateUseCase useCase, CancellationToken ct) =>
        {
            var gate = await PlatformOwnerGate.AuthorizeAsync(user, http, resolver, platform.Value, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParseExact(id, "D", out var org) || org == Guid.Empty) return Results.BadRequest();
            var roles = await useCase.ListRolesAsync(org, ct);
            return roles is null ? Results.NotFound() : Results.Ok(new InvitationRolesResponse(roles));
        }).RequireAuthorization().Produces<InvitationRolesResponse>().Produces(400).Produces(401).Produces(403).Produces(404)
            .WithName("ListUserInvitationRoles").WithTags("PlatformInvitations");

        app.MapPost("/platform/invitations/users", async (ClaimsPrincipal user, HttpContext http,
            PrincipalResolver resolver, IOptions<PlatformOptions> platform, IOptions<InvitationDeliveryOptions> delivery,
            UserInvitationCreateUseCase useCase, ISecurityEventWriter audit, CancellationToken ct) =>
        {
            var gate = await PlatformOwnerGate.AuthorizeAsync(user, http, resolver, platform.Value, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParse(gate.Context!.UserId, out var actor)) return Results.Unauthorized();
            var input = await ReadInput(http, ct);
            if (input is null || !UserInvitationCreateUseCase.IsValid(input))
                return Results.BadRequest(new { message = "Invalid user invitation" });
            var result = await useCase.ExecuteAsync(input, actor, new Uri(delivery.Value.AppOrigin), ct);
            if (result.Outcome == UserInvitationCreateOutcome.OrganizationUnavailable)
                return Results.NotFound(new { message = "Organization is unavailable" });
            if (result.Outcome == UserInvitationCreateOutcome.RoleUnavailable)
                return Results.BadRequest(new { message = "Role is unavailable in the selected organization" });
            var response = result.Response!;
            await audit.WriteAsync(new SecurityEvent(response.OrganizationId, actor, "user_invitation_delivery",
                "platform_invitation", response.Id.ToString(), new JsonObject { ["outcome"] = response.Delivery },
                http.ClientIpFor()), CancellationToken.None);
            // A committed creation is a success even if delivery is unconfirmed. The UI must show the
            // delivery result and refresh; no automatic retry or second creation is safe here.
            return Results.Ok(response);
        }).RequireAuthorization().Accepts<UserInvitationBody>("application/json")
            .Produces<OrganizationInvitationResponse>().Produces(400).Produces(401).Produces(403).Produces(404)
            .WithName("CreateUserInvitation").WithTags("PlatformInvitations");
    }

    private static async Task<UserInvitationInput?> ReadInput(HttpContext http, CancellationToken ct)
    {
        // Bound the body before parsing, including chunked requests. Authorization runs before this read.
        var buffer = new byte[8193];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await http.Request.Body.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        if (length is 0 or > 8192) return null;
        try
        {
            using var json = JsonDocument.Parse(buffer.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 8 });
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var keys = root.EnumerateObject().Select(p => p.Name).ToArray();
            if (keys.Distinct(StringComparer.Ordinal).Count() != keys.Length) return null;
            if (!String(root, "email", out var email) || !String(root, "organizationId", out var organization) ||
                !Guid.TryParseExact(organization, "D", out var organizationId)) return null;
            string? role = null;
            if (root.TryGetProperty("roleSlug", out _))
            {
                if (!String(root, "roleSlug", out var parsedRole)) return null;
                role = parsedRole;
            }
            return new(email, organizationId, role);
        }
        catch (JsonException) { return null; }
    }

    private static bool String(JsonElement root, string name, out string value)
    {
        value = "";
        if (!root.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String) return false;
        value = element.GetString()!;
        return true;
    }
    // Documentation DTO; manual parsing preserves absent vs explicit-null role semantics.
    public sealed class UserInvitationBody
    {
        [Required, MaxLength(254)] public string Email { get; init; } = "";
        [Required] public Guid OrganizationId { get; init; }
        [MinLength(1), MaxLength(50)] public string RoleSlug { get; init; } = default!;
    }

}
