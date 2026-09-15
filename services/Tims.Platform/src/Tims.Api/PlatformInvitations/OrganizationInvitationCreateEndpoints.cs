using System.Security.Claims;
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

public static class OrganizationInvitationCreateEndpoints
{
    public static void MapOrganizationInvitationCreateEndpoints(this WebApplication app)
    {
        app.MapPost("/platform/invitations/organizations", async (ClaimsPrincipal user, HttpContext http,
            PrincipalResolver resolver, IOptions<PlatformOptions> platform, IOptions<InvitationDeliveryOptions> delivery,
            OrganizationInvitationCreateUseCase useCase, ISecurityEventWriter audit, CancellationToken ct) =>
        {
            var gate = await PlatformOwnerGate.AuthorizeAsync(user, http, resolver, platform.Value, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParse(gate.Context!.UserId, out var actor)) return Results.Unauthorized();
            var input = await ReadInput(http, ct);
            if (input is null || !OrganizationInvitationCreateUseCase.IsValid(input))
                return Results.BadRequest(new { message = "Invalid organization invitation" });
            var result = await useCase.ExecuteAsync(input, actor, new Uri(delivery.Value.AppOrigin), ct);
            if (result is null) return Results.Conflict(new { message = "Organization slug is already in use" });
            await audit.WriteAsync(new SecurityEvent(result.OrganizationId, actor, "org_invitation_delivery",
                "platform_invitation", result.Id.ToString(), new JsonObject { ["outcome"] = result.Delivery },
                http.ClientIpFor()), CancellationToken.None);
            // A committed creation is a success even if delivery is unconfirmed. The UI must show the
            // delivery result and refresh; no automatic retry or second creation is safe here.
            return Results.Ok(result);
        }).RequireAuthorization().Accepts<OrganizationInvitationInput>("application/json")
            .Produces<OrganizationInvitationResponse>().Produces(400).Produces(401).Produces(403).Produces(409)
            .WithName("CreateOrganizationInvitation").WithTags("PlatformInvitations");
    }

    private static async Task<OrganizationInvitationInput?> ReadInput(HttpContext http, CancellationToken ct)
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
            if (!String(root, "email", out var email) || !String(root, "organizationName", out var name) ||
                !String(root, "organizationSlug", out var slug)) return null;
            var plan = "trial";
            if (root.TryGetProperty("organizationPlan", out _) && !String(root, "organizationPlan", out plan)) return null;
            return new(email, name, slug, plan);
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
}
