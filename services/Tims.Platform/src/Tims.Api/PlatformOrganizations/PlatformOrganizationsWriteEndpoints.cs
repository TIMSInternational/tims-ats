using System.ComponentModel.DataAnnotations;
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
/// UPDATE's transaction. It is intended and recorded in the slice doc; step 5 must not "fix" it back.</para>
///
/// <para><b>It is NOT pinned by a parity fixture, contrary to what #76's decision comment required.</b>
/// That was an obligation, not a fact, and this slice does not discharge it: the surface has no
/// <c>scripts/parity/surfaces.ts</c> entry at all (#195 — the registry covers 4 of ~15 C# domains), so
/// nothing will diff it against TS at step 5. What DOES pin the behaviour is
/// <c>PlatformOrganizationsWriteRepositoryTests</c>, which proves it by mutation against a real Postgres.</para>
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
            // isOptional: true — an absent body is the id-only update, which is a 200. See TryReadJsonAsync.
            .Accepts<UpdateOrganizationBody>(isOptional: true, "application/json")
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
    /// things here and a bound DTO collapses them: every UPDATABLE field is <c>.optional()</c> (<c>id</c> is
    /// required, but it is the route segment here), which Zod satisfies
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

    /// <summary>
    /// Reads the body as a <see cref="JsonNode"/>, or reports a malformed one.
    ///
    /// <para><b>An EMPTY body is not an error.</b> The tRPC input carries <c>id</c> and nothing else is
    /// required, so <c>updateOrganization({ id })</c> is a valid 200 that still UPDATEs (bumping
    /// <c>updated_at</c> via Prisma's <c>@updatedAt</c>) and still writes the audit row. Here <c>id</c> is
    /// the route segment, so the REST equivalent is a request with no body at all — which
    /// <c>ReadFromJsonAsync</c> would reject as malformed JSON. The body is therefore buffered and an
    /// empty/whitespace one is treated as <c>{}</c>. Anything non-empty must still be valid JSON.</para>
    ///
    /// <para><b>The <see cref="ArgumentException"/> catch is not defensive padding.</b>
    /// <see cref="JsonObject"/> materialises its backing dictionary lazily — on the first
    /// <c>TryGetPropertyValue</c>, not at parse time — so a body with DUPLICATE keys
    /// (<c>{"name":"a","name":"b"}</c>) throws "An item with the same key has already been added" from
    /// inside the property reads rather than from the parse. Parsing eagerly here keeps that failure in
    /// one place. It is a 400 rather than the 500 it would otherwise be, which is also the closer parity:
    /// <c>JSON.parse</c> is last-wins, so TS returns 200. Rejecting an ambiguous body is the safer of the
    /// two divergences and is recorded in the slice doc.</para>
    /// </summary>
    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(httpContext.Request.Body);
        var raw = await reader.ReadToEndAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(raw))
        {
            return (true, null);
        }

        try
        {
            var node = JsonNode.Parse(raw);

            // Force the dictionary to materialise now, so a duplicate-key body fails HERE (400) instead of
            // escaping as an unhandled ArgumentException from a later property read (500).
            if (node is JsonObject obj)
            {
                _ = obj.Count;
            }

            return (true, node);
        }
        catch (JsonException)
        {
            return (false, null);
        }
        catch (ArgumentException)
        {
            return (false, null);
        }
    }

    /// <summary>
    /// OpenAPI request shape for <c>updateOrganization</c>. Never bound — see
    /// <see cref="TryBuildUpdateInput"/> on why the body is hand-parsed — it exists so the generated
    /// contract documents the accepted fields.
    ///
    /// <para><b>Init-only properties, not constructor parameters, and non-nullable.</b> Both choices are
    /// load-bearing for the generated schema rather than style. A positional record's parameters are
    /// emitted as <c>required</c>, which would tell every generated client it MUST send all four fields —
    /// the exact opposite of a partial update. And a nullable property is emitted as
    /// <c>"type": ["null","string"]</c>, advertising <c>null</c> as the way to say "leave this alone",
    /// when an explicit null is in fact a 400 (Zod <c>.optional()</c> rejects it). Optionality here is
    /// expressed the way JSON Schema expresses it — by the field being absent — so these are plain
    /// non-nullable optional properties. Verified against the emitted
    /// <c>contracts/openapi/Tims.Api.json</c>, not assumed.</para>
    /// </summary>
    public sealed class UpdateOrganizationBody
    {
        [MaxLength(PlatformOrganizationsWriteUseCase.MaxNameLength)]
        public string Name { get; init; } = string.Empty;

        /// <summary>One of <c>trial</c>, <c>starter</c>, <c>professional</c>, <c>enterprise</c>.</summary>
        public string Plan { get; init; } = string.Empty;

        public bool IsActive { get; init; }

        /// <summary>REPLACES the stored settings object; it is not merged into it.</summary>
        public UpdateOrganizationSettingsBody Settings { get; init; } = new();
    }

    public sealed class UpdateOrganizationSettingsBody
    {
        [MaxLength(PlatformOrganizationsWriteUseCase.MaxLocaleLength)]
        public string Locale { get; init; } = string.Empty;

        [MaxLength(PlatformOrganizationsWriteUseCase.MaxTimezoneLength)]
        public string Timezone { get; init; } = string.Empty;

        [MaxLength(PlatformOrganizationsWriteUseCase.MaxCurrencyLength)]
        public string Currency { get; init; } = string.Empty;
    }

    /// <summary><c>suspend</c> genuinely IS required (<c>organizations.ts:213</c>) — absent is a 400, which
    /// is why this one carries <see cref="RequiredAttribute"/> while none of the update fields does.</summary>
    public sealed class SuspendOrganizationBody
    {
        [Required]
        public bool Suspend { get; init; }
    }
}
