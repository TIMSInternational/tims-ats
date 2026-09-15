using System.ComponentModel.DataAnnotations;
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

public static class BulkInvitationEndpoints
{
    public static void MapBulkInvitationEndpoints(this WebApplication app)
    {
        app.MapPost("/platform/invitations/bulk", async (ClaimsPrincipal user, HttpContext http, PrincipalResolver resolver,
            IOptions<PlatformOptions> platform, IOptions<InvitationDeliveryOptions> delivery, BulkInvitationUseCase useCase,
            ISecurityEventWriter audit, CancellationToken ct) =>
        {
            var gate = await PlatformOwnerGate.AuthorizeAsync(user, http, resolver, platform.Value, ct);
            if (gate.Failure is not null) return gate.Failure;
            if (!Guid.TryParse(gate.Context!.UserId, out var actor)) return Results.Unauthorized();
            var input = await ReadInput(http, ct);
            if (input is null || !BulkInvitationUseCase.IsValid(input)) return Results.BadRequest(new { message = "Invalid bulk invitation input" });
            var response = await useCase.ExecuteAsync(input, actor, new Uri(delivery.Value.AppOrigin), ct);
            if (response is null) return Results.NotFound(new { message = "Organization is unavailable" });
            await audit.WriteAsync(new SecurityEvent(input.OrganizationId, actor, "bulk_invitation_delivery", "platform_invitation", null,
                new JsonObject { ["total"] = response.Summary.Total, ["sent"] = response.Summary.Sent, ["duplicates"] = response.Summary.Duplicates, ["errors"] = response.Summary.Errors },
                http.ClientIpFor()), CancellationToken.None);
            return Results.Ok(response);
        }).RequireAuthorization().Accepts<BulkInvitationBody>("application/json").Produces<BulkInvitationResponse>()
            .Produces(400).Produces(401).Produces(403).Produces(404).WithName("BulkInviteUsers").WithTags("PlatformInvitations");
    }

    private static async Task<BulkInvitationInput?> ReadInput(HttpContext http, CancellationToken ct)
    {
        var buffer = new byte[131073]; var length = 0;
        while (length < buffer.Length)
        {
            var read = await http.Request.Body.ReadAsync(buffer.AsMemory(length), ct); if (read == 0) break; length += read;
        }
        if (length is 0 or > 131072) return null;
        try
        {
            using var doc = JsonDocument.Parse(buffer.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 8 }); var root = doc.RootElement;
            if (!UniqueObject(root) || !String(root, "organizationId", out var org) || !Guid.TryParseExact(org, "D", out var id) ||
               !root.TryGetProperty("users", out var users) || users.ValueKind != JsonValueKind.Array || users.GetArrayLength() is < 1 or > 200) return null;
            var parsed = new List<BulkInvitee>();
            foreach (var user in users.EnumerateArray())
            {
                if (!UniqueObject(user) || !String(user, "email", out var email)) return null;
                string? role = null;
                if (user.TryGetProperty("roleSlug", out _)) { if (!String(user, "roleSlug", out var value)) return null; role = value; }
                // Names are accepted/validated for the existing CSV contract, but are not persisted by either stack.
                foreach (var key in new[] { "firstName", "lastName" })
                    if (user.TryGetProperty(key, out _) && (!String(user, key, out var value) || value.Length > 100)) return null;
                parsed.Add(new(email, role));
            }
            return new(id, parsed);
        }
        catch (JsonException) { return null; }
    }
    private static bool UniqueObject(JsonElement value) => value.ValueKind == JsonValueKind.Object &&
        value.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() == value.EnumerateObject().Count();
    private static bool String(JsonElement root, string key, out string value)
    {
        value = ""; if (!root.TryGetProperty(key, out var field) || field.ValueKind != JsonValueKind.String) return false;
        value = field.GetString()!; return true;
    }
    public sealed class BulkInvitationBody
    {
        [Required] public Guid OrganizationId { get; init; }
        [Required, MinLength(1), MaxLength(200)] public BulkInviteeBody[] Users { get; init; } = [];
    }
    public sealed class BulkInviteeBody
    {
        [Required, MaxLength(254)] public string Email { get; init; } = "";
        [MinLength(1), MaxLength(50)] public string RoleSlug { get; init; } = default!;
        [MaxLength(100)] public string FirstName { get; init; } = default!;
        [MaxLength(100)] public string LastName { get; init; } = default!;
    }
}
