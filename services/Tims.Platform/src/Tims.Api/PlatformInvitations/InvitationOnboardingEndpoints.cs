using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Tims.Application.PlatformInvitations;

namespace Tims.Api.PlatformInvitations;

public static class InvitationOnboardingEndpoints
{
    public static void MapInvitationOnboardingEndpoints(this WebApplication app)
    {
        app.MapPost("/invitations/setup/preview", async (HttpContext http, InvitationOnboarding setup,
            CancellationToken ct) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            var body = await ReadAsync(http, ct);
            if (body is null || !InvitationOnboarding.ValidToken(body.Token)) return Results.BadRequest();
            var invitation = await setup.PreviewAsync(body.Token, ct);
            return invitation is null ? Results.NotFound() : Results.Ok(invitation);
        }).AllowAnonymous().Accepts<SetupBody>("application/json").Produces<InvitationSetup>()
            .Produces(400).Produces(404).Produces(429).WithName("PreviewInvitationSetup").WithTags("InvitationSetup");

        app.MapPost("/invitations/setup/register", async (HttpContext http, InvitationOnboarding setup,
            CancellationToken ct) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            var body = await ReadAsync(http, ct);
            if (body is null) return Results.BadRequest();
            return Results.Ok(await setup.RegisterAsync(body.Token, body.Password, ct));
        }).AllowAnonymous().Accepts<SetupBody>("application/json").Produces<SetupResult>()
            .Produces(400).Produces(429).WithName("RegisterInvitedAccount").WithTags("InvitationSetup");

        app.MapPost("/invitations/setup/complete", async (HttpContext http, InvitationOnboarding setup,
            CancellationToken ct) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            var body = await ReadAsync(http, ct);
            var authorization = http.Request.Headers.Authorization.ToString();
            if (body is null) return Results.BadRequest();
            if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal)) return Results.Unauthorized();
            return Results.Ok(await setup.CompleteAsync(body.Token, authorization[7..],
                new(body.FirstName, body.LastName), ct));
        }).RequireAuthorization().Accepts<SetupBody>("application/json").Produces<SetupResult>()
            .Produces(400).Produces(401).Produces(429).WithName("CompleteInvitedAccount").WithTags("InvitationSetup");
    }

    private static async Task<SetupBody?> ReadAsync(HttpContext http, CancellationToken ct)
    {
        if (http.Request.ContentType?.Split(';')[0] != "application/json") return null;
        var bytes = new byte[8193];
        var length = 0;
        while (length < bytes.Length)
        {
            var read = await http.Request.Body.ReadAsync(bytes.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        if (length is 0 or > 8192) return null;
        try
        {
            using var document = JsonDocument.Parse(bytes.AsMemory(0, length),
                new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var names = root.EnumerateObject().Select(property => property.Name).ToArray();
            if (names.Distinct(StringComparer.Ordinal).Count() != names.Length ||
                names.Any(name => name is not ("token" or "password" or "firstName" or "lastName"))) return null;
            string Read(string name) => root.TryGetProperty(name, out var value) ? value.GetString() ?? "" : "";
            return new()
            {
                Token = Read("token"),
                Password = Read("password"),
                FirstName = Read("firstName"),
                LastName = Read("lastName")
            };
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException) { return null; }
    }

    public sealed class SetupBody
    {
        [Required, StringLength(36, MinimumLength = 36)] public string Token { get; init; } = "";
        [MaxLength(128)] public string Password { get; init; } = "";
        [MaxLength(100)] public string FirstName { get; init; } = "";
        [MaxLength(100)] public string LastName { get; init; } = "";
    }
}
