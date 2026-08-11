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
/// The platform-owner organization CREATE endpoint (Phase-5 slice 21, issue #76) — the C# port of
/// <c>createOrganization</c> (<c>routers/platform/organizations.ts:104-169</c>).
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented</b> — identical disposition to
/// slices 19 and 20, including the impersonation case (an impersonated owner resolves to
/// <c>PrincipalType.OrgUser</c> and is denied with no special-case code). It runs BEFORE the body is read:
/// tRPC runs middleware before Zod, so a non-owner sending a malformed body must get 403, not 400. Pinned
/// by <c>PlatformOrganizationsCreateEndpointAuthTests</c>, which is the only thing standing between this
/// slice and a deleted gate — every repository test calls the repository directly.</para>
///
/// <para><b>200, not 201.</b> Verified with
/// <c>grep -rn "Results.Created\|Status201Created" src --include=*.cs</c>, which found zero hits across
/// this whole service: every C# write endpoint returns <c>Results.Ok</c>, matching tRPC mutations, which are
/// 200. (Re-running it today returns ONE hit — this very sentence. Exclude the comment, or grep
/// <c>--include=*.cs -e "Results\.Created(" -e "Status201Created"</c> against code lines only. The
/// substantive result is unchanged: <c>Results.NoContent</c> and <c>Results.Accepted</c> are also absent, so
/// <c>Results.Ok</c> genuinely is the only success shape here.) A 201 would also break the parity harness's
/// response check.</para>
///
/// <para><b>Two deliberate divergences, both recorded in
/// <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c>.</b>
/// (1) The audit write is
/// FAIL-CLOSED inside the creation transaction, where TS swallows its failure with
/// <c>.catch(() =&gt; {})</c> AFTER the transaction — Federico's decision on #76, already shipped for
/// update/suspend. (2) A duplicate slug is <b>409</b>, where TS leaks the raw Prisma <c>P2002</c> text as a
/// 500 into the operator's modal (<c>create-org-modal.tsx:93-97</c>); same precedent as
/// <c>SuccessionWriteEndpoints</c>, and only the NAMED <c>organizations_slug_key</c> constraint is treated
/// that way.</para>
///
/// <para><b>What is NOT a divergence and must not be "fixed" at step 5: a notify failure is a 500 after a
/// committed create.</b> <c>organizations.ts:149</c> awaits <c>notify</c> with no <c>try</c> and no
/// <c>.catch</c>, so the TS behaves identically. See
/// <see cref="PlatformOrganizationsCreateUseCase.CreateAsync"/>.</para>
///
/// INTERNAL staff mutation ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope, matching slices 19/20.
/// Dark-by-default behind <see cref="PlatformOptions.PlatformOrganizationsCreateEnabled"/>, which is the
/// one-active-writer control for all seven tables.
/// </summary>
public static class PlatformOrganizationsCreateEndpoints
{
    public static void MapPlatformOrganizationsCreateEndpoints(this WebApplication app)
    {
        // ---- createOrganization — POST /platform/organizations. 200 / 400 / 401 / 403 / 409. ----
        // No 404: nothing is looked up, so there is no not-found path.
        app.MapPost(
                "/platform/organizations",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsCreateUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // UNTESTED AND UNREACHABLE THROUGH THE FIXTURE, stated so rather than implied: the gate
                    // has already resolved a principal, and PrincipalResolver only ever yields a `users.id`
                    // uuid, so no request can take this branch. A3 covers a null/garbage token, which fails
                    // at the JWT layer long before here. It is kept because `UserId` is typed `string` and a
                    // future resolver that widened it must not reach `actorId` with a non-uuid — but treat it
                    // as an assertion, not as covered behaviour.
                    if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                    {
                        return Results.StatusCode(StatusCodes.Status401Unauthorized);
                    }

                    var (readOk, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                    if (!readOk
                        || !TryBuildCreateInput(node, out var input)
                        || !PlatformOrganizationsCreateUseCase.IsValidCreateInput(input))
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }

                    var result = await useCase.CreateAsync(input, actorId, cancellationToken);
                    return result.Outcome switch
                    {
                        CreateOrganizationOutcome.Created => Results.Ok(result.Row),
                        CreateOrganizationOutcome.SlugTaken => Results.Conflict(new { error = "slug_taken" }),
                        _ => throw new InvalidOperationException($"unhandled create outcome {result.Outcome}"),
                    };
                })
            .AllowAnonymous()
            // NOT isOptional: unlike the update, all four required fields are missing from an empty body, so
            // it must fail validation rather than succeed as a no-field create.
            .Accepts<CreateOrganizationBody>("application/json")
            .Produces<PlatformOrganizationRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("CreatePlatformOrganization")
            .WithTags("PlatformOrganizations");
    }

    /// <summary>
    /// Reads the Zod-shaped body (<c>organizations.ts:105-111</c>), distinguishing ABSENT from present.
    ///
    /// <para>Hand-parsed for the same reason the update body is: <c>billingEmail</c> is
    /// <c>.optional()</c>, which REJECTS an explicit <c>null</c>, and a bound DTO collapses absent and null
    /// into the same value. The four required fields must be PRESENT and a JSON string — a number, a bool,
    /// an object or an explicit null is a 400, because <c>z.string()</c> does not coerce.</para>
    ///
    /// <para>Unknown keys are IGNORED, not rejected: Zod objects strip them by default (no
    /// <c>.strict()</c>), so rejecting here would refuse requests TS accepts.</para>
    ///
    /// <para><b>An absent body is a 400 here, unlike the update.</b> <c>updateOrganization({ id })</c> is a
    /// valid input with every other field omitted; <c>createOrganization</c> has four required fields, so an
    /// empty body fails the schema. That is expressed by returning false for a null node rather than by a
    /// second check at the call site.</para>
    /// </summary>
    private static bool TryBuildCreateInput(JsonNode? node, out PlatformOrganizationCreateInput input)
    {
        input = new PlatformOrganizationCreateInput(string.Empty, string.Empty, string.Empty, string.Empty, null);

        if (node is not JsonObject body)
        {
            return false;
        }

        if (!TryReadRequiredString(body, "name", out var name)
            || !TryReadRequiredString(body, "slug", out var slug)
            || !TryReadRequiredString(body, "plan", out var plan)
            || !TryReadRequiredString(body, "adminEmail", out var adminEmail)
            || !TryReadOptionalString(body, "billingEmail", out var billingEmail))
        {
            return false;
        }

        input = new PlatformOrganizationCreateInput(name, slug, plan, adminEmail, billingEmail);
        return true;
    }

    /// <summary>Present and a JSON string → true. Absent, an explicit null, or any other JSON type → false,
    /// i.e. 400. All four of these fields are required and unwrapped in Zod.</summary>
    private static bool TryReadRequiredString(JsonObject body, string key, out string value)
    {
        value = string.Empty;

        if (!body.TryGetPropertyValue(key, out var raw)
            || raw is not JsonValue jsonValue
            || !jsonValue.TryGetValue<string>(out var parsed))
        {
            return false;
        }

        value = parsed;
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

    /// <summary>
    /// Reads the body as a <see cref="JsonNode"/>, or reports a malformed one. Copied from
    /// <see cref="PlatformOrganizationsWriteEndpoints"/> with ONE behavioural difference: an empty body
    /// yields a null node, which <see cref="TryBuildCreateInput"/> turns into a 400 rather than the 200 the
    /// id-only update returns.
    ///
    /// <para><b>The <see cref="ArgumentException"/> catch is not defensive padding.</b>
    /// <see cref="JsonObject"/> materialises its backing dictionary lazily — on the first
    /// <c>TryGetPropertyValue</c>, not at parse time — so a body with DUPLICATE keys
    /// (<c>{"name":"a","name":"b"}</c>) throws "An item with the same key has already been added" from
    /// inside the property reads rather than from the parse. Parsing eagerly here keeps that failure in one
    /// place, as a 400 rather than the 500 it would otherwise be. <c>JSON.parse</c> is last-wins, so TS
    /// returns 200 — this IS a divergence, but rejecting an ambiguous body is the safer of the two and is
    /// recorded in <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c>, exactly as for slice 20.</para>
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
    /// OpenAPI request shape for <c>createOrganization</c>. Never bound — see
    /// <see cref="TryBuildCreateInput"/> on why the body is hand-parsed — it exists so the generated
    /// contract documents the accepted fields.
    ///
    /// <para><b>Init-only NON-NULLABLE properties, not constructor parameters.</b> A positional record's
    /// parameters are ALL emitted as <c>required</c>, which would be wrong for <see cref="BillingEmail"/>;
    /// a nullable property is emitted as <c>"type": ["null","string"]</c>, which would advertise an explicit
    /// null as acceptable when Zod's <c>.optional()</c> rejects it (400). Requiredness is therefore stated
    /// per-field with <see cref="RequiredAttribute"/> — and unlike the update body, four fields here
    /// genuinely ARE required. Verified against the emitted <c>contracts/openapi/Tims.Api.json</c>, not
    /// assumed.</para>
    ///
    /// <para><b>No <c>[MaxLength]</c> on either email, deliberately.</b> Zod bounds neither
    /// (<c>organizations.ts:109-110</c> is <c>.email()</c> with no <c>.max()</c>). That violates
    /// <c>.claude/rules/api-security.md</c> and is ported as-is: advertising a bound the API does not
    /// enforce is worse than the missing bound, and narrowing during a port makes a step-5 parity diff
    /// uninterpretable. Filed as <b>#207</b> instead, and pinned by an endpoint test so a future silent
    /// tightening shows up as a failure.</para>
    ///
    /// <para><b>Every OTHER attribute here is DESCRIPTIVE, never enforcement.</b> This type is never bound,
    /// so no <c>DataAnnotations</c> validator ever runs on it — the 400s come from
    /// <see cref="TryBuildCreateInput"/> plus
    /// <see cref="PlatformOrganizationsCreateUseCase.IsValidCreateInput"/>. The attributes exist so the
    /// published contract stops UNDER-specifying constraints the server does enforce with a 400, which is
    /// how a generated client ends up sending <c>{"name":"A"}</c>, seeing it validate locally, and getting an
    /// opaque <c>{"error":"invalid_input"}</c>. Note that
    /// <see cref="RegularExpressionAttribute"/> carries the ECMA-262 anchors
    /// (<see cref="PlatformOrganizationsCreateUseCase.SlugPattern"/>) because OpenAPI patterns are ECMA-262,
    /// while the actual .NET validator uses <c>\A</c>/<c>\z</c> for the reasons given there. Adding a
    /// validating BIND to this type would CHANGE behaviour, not merely tighten documentation.</para>
    ///
    /// <para><b>Two constraints stay UNDER-specified in the contract, and it is not for want of trying.</b>
    /// <c>plan</c> emits no <c>enum</c> and neither email emits <c>"format": "email"</c>.
    /// <c>[AllowedValues]</c> and <c>[EmailAddress]</c> were both applied and both were IGNORED by this
    /// project's OpenAPI emitter — verified by reading the regenerated
    /// <c>contracts/openapi/Tims.Api.json</c>, not assumed, which is the only way to tell (the same read
    /// confirmed <c>minLength</c>/<c>maxLength</c>/<c>pattern</c> DID land). They were removed rather than
    /// left in place, because a no-op attribute reads as enforcement that is not there. Closing the
    /// remaining gap needs a document transformer, which is out of scope for a port; until then a client
    /// generated from this contract can send <c>{"plan":"gold"}</c> and learn it is wrong only from the
    /// server's 400. Under-specification is additive and cannot break an existing consumer, so this is a
    /// documented limitation rather than a contract break.</para>
    /// </summary>
    public sealed class CreateOrganizationBody
    {
        [Required]
        [MinLength(PlatformOrganizationsCreateUseCase.MinNameLength)]
        [MaxLength(PlatformOrganizationsCreateUseCase.MaxNameLength)]
        public string Name { get; init; } = string.Empty;

        /// <summary>Lower-case letters, digits and hyphens only (<c>^[a-z0-9-]+$</c>). Globally unique.</summary>
        [Required]
        [MinLength(PlatformOrganizationsCreateUseCase.MinSlugLength)]
        [MaxLength(PlatformOrganizationsCreateUseCase.MaxSlugLength)]
        [RegularExpression(PlatformOrganizationsCreateUseCase.SlugPattern)]
        public string Slug { get; init; } = string.Empty;

        /// <summary>One of <c>trial</c>, <c>starter</c>, <c>professional</c>, <c>enterprise</c>. NOT emitted
        /// as an <c>enum</c> in the contract — see the type remarks.</summary>
        [Required]
        public string Plan { get; init; } = string.Empty;

        /// <summary>Validated as an email and then used ONLY as the <c>billingEmail</c> fallback — no user
        /// is created or invited from it. Reproduced from the TS, which does the same. No
        /// <c>[MaxLength]</c> (#207) and no emitted <c>format</c> — see the type remarks.</summary>
        [Required]
        public string AdminEmail { get; init; } = string.Empty;

        /// <summary>Optional. When absent or empty, <see cref="AdminEmail"/> is stored instead
        /// (<c>input.billingEmail || input.adminEmail</c>). No <c>[MaxLength]</c> — see #207.</summary>
        public string BillingEmail { get; init; } = string.Empty;
    }
}
