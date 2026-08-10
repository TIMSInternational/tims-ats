using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformOrganizations;

namespace Tims.Api.PlatformOrganizations;

/// <summary>
/// The platform-owner organizations WRITE endpoints (Phase-5 slice 20, issue #76) — the C# port of
/// <c>updateOrganization</c> and <c>suspendOrganization</c> in <c>routers/platform/organizations.ts</c>.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented</b> — identical disposition to
/// the slice-19 read endpoints, including the impersonation case (an impersonated owner resolves to
/// <c>PrincipalType.OrgUser</c> and is denied with no special-case code). It runs BEFORE the body is read:
/// tRPC runs middleware before Zod, so a non-owner sending a malformed body must get 403, not 400.</para>
///
/// <para><b>One deliberate divergence, decided by Federico on #76: the audit write is FAIL-CLOSED.</b> The
/// TS swallows its audit failure (<c>.catch(() =&gt; {})</c>) and returns 200 with no audit row; this port
/// fails the operation and leaves the organization unmodified, because the audit INSERT shares the org
/// UPDATE's transaction. The divergence is pinned by a parity fixture and recorded in the slice doc — it
/// is intended, and step 5 must not "fix" it back.</para>
///
/// <para><b>A second, smaller divergence: a missing organization is 404, not 500.</b> Prisma's
/// <c>update()</c> throws P2025 on a nonexistent id, which tRPC surfaces as INTERNAL_SERVER_ERROR — an
/// accident of the ORM rather than a contract worth porting. Same precedent as
/// <c>SuccessionWriteEndpoints</c> mapping a unique violation to 409 instead of the TS 500.</para>
///
/// INTERNAL staff mutations ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope, matching slice 19.
/// Dark-by-default behind <see cref="PlatformOptions.PlatformOrganizationsWriteEnabled"/>.
/// </summary>
public static class PlatformOrganizationsWriteEndpoints
{
    public static void MapPlatformOrganizationsWriteEndpoints(this WebApplication app)
    {
        // ---- updateOrganization — PATCH /platform/organizations/{id}. 200 / 400 / 401 / 403 / 404. ----
        app.MapPatch(
                "/platform/organizations/{id:guid}",
                async (
                    Guid id,
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsWriteUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                    {
                        return Results.StatusCode(StatusCodes.Status401Unauthorized);
                    }

                    var (readOk, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                    if (!readOk
                        || !TryBuildUpdateInput(node, out var input)
                        || !PlatformOrganizationsWriteUseCase.IsValidUpdateInput(input))
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }

                    var row = await useCase.UpdateAsync(id, input, actorId, cancellationToken);
                    return row is null ? Results.NotFound() : Results.Ok(row);
                })
            .AllowAnonymous()
            .Accepts<UpdateOrganizationBody>("application/json")
            .Produces<PlatformOrganizationRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("UpdatePlatformOrganization")
            .WithTags("PlatformOrganizations");

        // ---- suspendOrganization — POST /platform/organizations/{id}/suspend. 200 / 400 / 401 / 403 / 404. ----
        app.MapPost(
                "/platform/organizations/{id:guid}/suspend",
                async (
                    Guid id,
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsWriteUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                    {
                        return Results.StatusCode(StatusCodes.Status401Unauthorized);
                    }

                    // `suspend` is a REQUIRED boolean (organizations.ts:213) — absent is a 400, not a default.
                    // Defaulting it either way would silently pick a destructive direction.
                    var (readOk, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                    if (!readOk || !TryReadSuspendFlag(node, out var suspend))
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }

                    var row = await useCase.SuspendAsync(id, suspend, actorId, cancellationToken);
                    return row is null ? Results.NotFound() : Results.Ok(row);
                })
            .AllowAnonymous()
            .Accepts<SuspendOrganizationBody>("application/json")
            .Produces<PlatformOrganizationRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("SuspendPlatformOrganization")
            .WithTags("PlatformOrganizations");
    }

    /// <summary>
    /// Reads the Zod-shaped body, distinguishing ABSENT from present.
    ///
    /// <para>Hand-parsed rather than bound to a DTO because <c>null</c> and "not sent" mean different
    /// things here and a bound DTO collapses them: every field is <c>.optional()</c>, which Zod satisfies
    /// only by omission — an explicit <c>null</c> is a validation error, not a request to clear the column.
    /// A DTO would turn <c>{"name": null}</c> into a silent no-op instead of the 400 TS returns.</para>
    ///
    /// <para>Unknown keys are IGNORED, not rejected: Zod objects strip them by default (no
    /// <c>.strict()</c>), so rejecting here would refuse requests TS accepts.</para>
    /// </summary>
    private static bool TryBuildUpdateInput(JsonNode? node, out PlatformOrganizationUpdateInput input)
    {
        input = new PlatformOrganizationUpdateInput(null, null, null, null);

        // An absent body is the id-only input, which TS accepts (`{ id }` alone satisfies the schema) — it
        // still UPDATEs, bumping updated_at through Prisma's @updatedAt, and still writes `changes: {}`.
        if (node is null)
        {
            return true;
        }

        if (node is not JsonObject body)
        {
            return false;
        }

        if (!TryReadOptionalString(body, "name", out var name)
            || !TryReadOptionalString(body, "plan", out var plan)
            || !TryReadOptionalBool(body, "isActive", out var isActive)
            || !TryReadOptionalSettings(body, out var settings))
        {
            return false;
        }

        input = new PlatformOrganizationUpdateInput(name, plan, isActive, settings);
        return true;
    }

    private static bool TryReadOptionalSettings(JsonObject body, out PlatformOrganizationSettingsInput? settings)
    {
        settings = null;

        if (!body.TryGetPropertyValue("settings", out var raw))
        {
            return true;
        }

        if (raw is not JsonObject nested)
        {
            return false;
        }

        if (!TryReadOptionalString(nested, "locale", out var locale)
            || !TryReadOptionalString(nested, "timezone", out var timezone)
            || !TryReadOptionalString(nested, "currency", out var currency))
        {
            return false;
        }

        settings = new PlatformOrganizationSettingsInput(locale, timezone, currency);
        return true;
    }

    /// <summary>Absent → true with null. Present and a string → true with the value. Anything else
    /// (including an explicit JSON null, which <c>.optional()</c> rejects) → false, i.e. 400.</summary>
    private static bool TryReadOptionalString(JsonObject body, string key, out string? value)
    {
        value = null;

        if (!body.TryGetPropertyValue(key, out var raw))
        {
            return true;
        }

        if (raw is not JsonValue jsonValue || !jsonValue.TryGetValue<string>(out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static bool TryReadOptionalBool(JsonObject body, string key, out bool? value)
    {
        value = null;

        if (!body.TryGetPropertyValue(key, out var raw))
        {
            return true;
        }

        if (raw is not JsonValue jsonValue || !jsonValue.TryGetValue<bool>(out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static bool TryReadSuspendFlag(JsonNode? node, out bool suspend)
    {
        suspend = false;

        if (node is not JsonObject body
            || !body.TryGetPropertyValue("suspend", out var raw)
            || raw is not JsonValue jsonValue
            || !jsonValue.TryGetValue<bool>(out var parsed))
        {
            return false;
        }

        suspend = parsed;
        return true;
    }

    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        try
        {
            var node = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
            return (true, node);
        }
        catch (JsonException)
        {
            return (false, null);
        }
        catch (InvalidOperationException)
        {
            return (false, null);
        }
    }

    /// <summary>OpenAPI request shape for <c>updateOrganization</c>. Never bound — see
    /// <see cref="TryBuildUpdateInput"/> on why the body is hand-parsed — it exists so the generated
    /// contract documents the accepted fields.</summary>
    public sealed record UpdateOrganizationBody(string? Name, string? Plan, bool? IsActive, UpdateOrganizationSettingsBody? Settings);

    public sealed record UpdateOrganizationSettingsBody(string? Locale, string? Timezone, string? Currency);

    public sealed record SuspendOrganizationBody(bool Suspend);
}
