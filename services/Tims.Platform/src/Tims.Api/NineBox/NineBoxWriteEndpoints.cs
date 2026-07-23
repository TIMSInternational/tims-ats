using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.NineBox;
using Tims.Domain.Access;
using Tims.Domain.NineBox;

namespace Tims.Api.NineBox;

/// <summary>
/// The nine-box calibration WRITE endpoints (Phase-5 Slice 15) — the C# port of the 5 mutation bodies of the TS
/// <c>ninebox</c> router (createCalibration / submitCalibrationVote / addCalibrationMember /
/// removeCalibrationMember / finalizeCalibration; all inline <c>prisma.*</c> — there is no TS service/repo). The 5
/// writes carry DIFFERENT scope mechanics on the <c>ninebox:create</c>/<c>ninebox:update</c> grants — the
/// action-parameterized <see cref="NineBoxStaffGate"/> authorizes the grant and RETURNS the resolved scope, and each
/// endpoint applies its own mechanic:
/// <list type="bullet">
///   <item><description>createCalibration → <c>ninebox:create</c> + <c>requireOrgScope</c> (org governance; a narrow
///     committee grant → 403). Also validates every memberId in-org (cross-tenant hardening → 400).</description></item>
///   <item><description>submitCalibrationVote → <c>ninebox:update</c> + MEMBERSHIP+IDENTITY (NO requireOrgScope): the
///     session must exist (→ 404), the VOTER (caller, never input) must be a calibration_member (→ 403), the
///     evaluatedUser must be in-org (→ 404). voter_id = caller so a non-member can't forge/overwrite.</description></item>
///   <item><description>addCalibrationMember → <c>ninebox:update</c> + <c>requireOrgScope</c>; session in-org (→ 404),
///     user in-org (→ 404), dup member → 409.</description></item>
///   <item><description>removeCalibrationMember → <c>ninebox:update</c> + <c>requireOrgScope</c>; session in-org (→ 404),
///     member absent (count 0 → 404).</description></item>
///   <item><description>finalizeCalibration → <c>ninebox:update</c> + <c>requireOrgScope</c>; conditional update,
///     count 0 → 404.</description></item>
/// </list>
/// Input validation runs AFTER auth (tRPC parity), and — for createCalibration/addCalibrationMember — BEFORE
/// <c>requireOrgScope</c> (Codex F2: a malformed body must 400 even for a narrow-scoped caller). Every write runs
/// UNDER TenantScope; the RLS session-subquery WITH CHECK (session-org) is the tenant guard for member/vote inserts.
/// Dark-by-default behind <see cref="PlatformOptions.NineBoxWriteEnabled"/> (mapped only when on, or at build-time
/// OpenAPI generation).
/// </summary>
public static class NineBoxWriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";

    private const string SessionNotFoundMessage = "Sesion de calibracion no encontrada";
    private const string NotMemberMessage = "Solo un miembro del comite puede votar";
    private const string EvaluatedNotFoundMessage = "Usuario evaluado no encontrado";
    private const string UserNotFoundMessage = "Usuario no encontrado";
    private const string MemberConflictMessage = "El usuario ya es miembro de este comite";
    private const string MemberNotFoundMessage = "Miembro no encontrado";

    private const int MaxPeriodLength = 100;
    private const int MaxQuadrantLength = 100;
    private const int MaxJustificationLength = 20000;
    private const int MaxMemberIds = 100;

    public static void MapNineBoxWriteEndpoints(this WebApplication app)
    {
        // ---- createCalibration — POST /ninebox/calibrations. ninebox:create + requireOrgScope. 200 / 400 / 401 / 403. ----
        app.MapPost("/ninebox/calibrations", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                NineBoxWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // Codex F2: tRPC validates `.input()` (→ 400) BEFORE requireOrgScope (→ 403). Read+validate FIRST.
                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildCreateCalibration(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // Creating a session is org governance (ninebox.ts:231-234) → org/company scope only; a narrow
                // (team/unit/own) ninebox:create caller → 403, no INSERT.
                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.CreateCalibrationAsync(
                    gate.Context!.OrganizationId, Guid.Parse(gate.Context!.UserId), input, timeProvider.GetUtcNow(),
                    cancellationToken);
                return result.Outcome switch
                {
                    // A memberId is not a user in the caller's org (a cross-tenant reference RLS would not block on
                    // the member insert) → 400, nothing written.
                    CreateCalibrationOutcome.MemberNotInOrg => Results.BadRequest(
                        new { error = "invalid_member", message = "Uno o mas miembros no pertenecen a esta organizacion" }),
                    _ => Results.Ok(result.Session),
                };
            })
            .RequireAuthorization()
            .Accepts<CreateCalibrationBody>("application/json")
            .Produces<CalibrationSessionWithMembers>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxCreateCalibration");

        // ---- submitCalibrationVote — POST /ninebox/calibrations/{sessionId}/votes. ----
        // ninebox:update + MEMBERSHIP+IDENTITY (NO requireOrgScope). 200 / 400 / 401 / 403 / 404.
        app.MapPost("/ninebox/calibrations/{sessionId:guid}/votes", async (
                Guid sessionId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                NineBoxWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildSubmitVote(sessionId, node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // voter_id is ALWAYS the resolved caller — never a body/param value (the identity anchor). NO
                // requireOrgScope: a committee member at ANY scope may vote; membership is the whole authority.
                var voterId = Guid.Parse(gate.Context!.UserId);
                var result = await useCase.SubmitCalibrationVoteAsync(
                    gate.Context!.OrganizationId, voterId, input, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    SubmitCalibrationVoteOutcome.SessionNotFound => Results.NotFound(new { message = SessionNotFoundMessage }),
                    SubmitCalibrationVoteOutcome.NotMember => Results.Json(
                        new { message = NotMemberMessage }, statusCode: StatusCodes.Status403Forbidden),
                    SubmitCalibrationVoteOutcome.EvaluatedNotFound => Results.NotFound(new { message = EvaluatedNotFoundMessage }),
                    _ => Results.Ok(result.Vote),
                };
            })
            .RequireAuthorization()
            .Accepts<SubmitCalibrationVoteBody>("application/json")
            .Produces<CalibrationVoteResultRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .WithName("NineBoxSubmitCalibrationVote");

        // ---- addCalibrationMember — POST /ninebox/calibrations/{sessionId}/members. ----
        // ninebox:update + requireOrgScope. 200 {id} / 400 / 401 / 403 / 404 / 409.
        app.MapPost("/ninebox/calibrations/{sessionId:guid}/members", async (
                Guid sessionId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                NineBoxWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildAddMember(node, out var userId))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // Committee membership is org governance (ninebox.ts:426-430) → org/company scope only; a narrow
                // caller could otherwise self-add to any session and then vote → 403.
                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.AddCalibrationMemberAsync(
                    gate.Context!.OrganizationId, sessionId, userId, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    AddCalibrationMemberOutcome.SessionNotFound => Results.NotFound(new { message = SessionNotFoundMessage }),
                    AddCalibrationMemberOutcome.UserNotFound => Results.NotFound(new { message = UserNotFoundMessage }),
                    AddCalibrationMemberOutcome.Conflict => Results.Json(
                        new { message = MemberConflictMessage }, statusCode: StatusCodes.Status409Conflict),
                    _ => Results.Ok(new CalibrationMemberIdResult(result.MemberId!)),
                };
            })
            .RequireAuthorization()
            .Accepts<AddCalibrationMemberBody>("application/json")
            .Produces<CalibrationMemberIdResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("NineBoxAddCalibrationMember");

        // ---- removeCalibrationMember — DELETE /ninebox/calibrations/{sessionId}/members/{userId}. ----
        // ninebox:update + requireOrgScope. 200 {success} / 401 / 403 / 404.
        app.MapDelete("/ninebox/calibrations/{sessionId:guid}/members/{userId:guid}", async (
                Guid sessionId, Guid userId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                NineBoxWriteUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.RemoveCalibrationMemberAsync(
                    gate.Context!.OrganizationId, sessionId, userId, cancellationToken);
                return result.Outcome switch
                {
                    RemoveCalibrationMemberOutcome.SessionNotFound => Results.NotFound(new { message = SessionNotFoundMessage }),
                    RemoveCalibrationMemberOutcome.MemberNotFound => Results.NotFound(new { message = MemberNotFoundMessage }),
                    _ => Results.Ok(new CalibrationRemoveResult(true)),
                };
            })
            .RequireAuthorization()
            .Produces<CalibrationRemoveResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("NineBoxRemoveCalibrationMember");

        // ---- finalizeCalibration — POST /ninebox/calibrations/{sessionId}/finalize. ----
        // ninebox:update + requireOrgScope. 200 (full session) / 401 / 403 / 404.
        app.MapPost("/ninebox/calibrations/{sessionId:guid}/finalize", async (
                Guid sessionId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                NineBoxWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var row = await useCase.FinalizeCalibrationAsync(
                    gate.Context!.OrganizationId, sessionId, timeProvider.GetUtcNow(), cancellationToken);
                return row is null
                    ? Results.NotFound(new { message = SessionNotFoundMessage })
                    : Results.Ok(row);
            })
            .RequireAuthorization()
            .Produces<CalibrationSessionRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("NineBoxFinalizeCalibration");
    }

    // ---- Zod-parity input validation (runs AFTER auth) --------------------------------------------------------

    // createCalibration: period ≤100 (Zod z.string().max(100) — no min, so "" is valid); scheduledAt? ISO-8601
    // datetime; memberIds? uuid[] ≤100. Codex F1: parsed from a JsonObject so an EXPLICIT null on a Zod `.optional()`
    // field, an empty-string/non-canonical uuid, or a non-array memberIds are REJECTED (→ 400), never collapsed to absent.
    private static bool TryBuildCreateCalibration(JsonNode? node, out CreateCalibrationInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["period"] is not JsonValue periodValue || !periodValue.TryGetValue(out string? period)
            || period is null || period.Length > MaxPeriodLength
            || !TryOptionalDateTime(obj, "scheduledAt", out var scheduledAt)
            || !TryOptionalGuidArray(obj, "memberIds", MaxMemberIds, out var memberIds))
        {
            return false;
        }

        input = new CreateCalibrationInput(period, scheduledAt, memberIds);
        return true;
    }

    // submitCalibrationVote: evaluatedUserId uuid; quadrant ≤100; justification? ≤20000. sessionId is the route param.
    private static bool TryBuildSubmitVote(Guid sessionId, JsonNode? node, out SubmitCalibrationVoteInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["evaluatedUserId"] is not JsonValue evaluatedValue
            || !evaluatedValue.TryGetValue(out string? evaluatedRaw) || evaluatedRaw is null
            || !Guid.TryParseExact(evaluatedRaw, "D", out var evaluatedUserId)
            || obj["quadrant"] is not JsonValue quadrantValue || !quadrantValue.TryGetValue(out string? quadrant)
            || quadrant is null || quadrant.Length > MaxQuadrantLength
            || !TryOptionalString(obj, "justification", MaxJustificationLength, out var justification))
        {
            return false;
        }

        input = new SubmitCalibrationVoteInput(sessionId, evaluatedUserId, quadrant, justification);
        return true;
    }

    // addCalibrationMember: userId uuid. sessionId is the route param.
    private static bool TryBuildAddMember(JsonNode? node, out Guid userId)
    {
        userId = Guid.Empty;
        if (node is not JsonObject obj
            || obj["userId"] is not JsonValue userValue || !userValue.TryGetValue(out string? raw) || raw is null
            || !Guid.TryParseExact(raw, "D", out var parsed))
        {
            return false;
        }

        userId = parsed;
        return true;
    }

    // Zod `.string().max(max).optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a JSON
    // string ≤max (an explicit null, a non-string, or an over-long value ⇒ false → 400).
    private static bool TryOptionalString(JsonObject obj, string key, int max, out string? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out value) || value is null || value.Length > max)
        {
            return false;
        }

        return true;
    }

    // Zod `.string().datetime().optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a JSON
    // string in the Zod-default datetime form — a UTC `Z`-suffixed ISO-8601 (Codex/parity: Zod `.datetime()` rejects
    // zone-less and numeric-offset forms; `Guid`… — an unqualified `DateTimeOffset.TryParse(RoundtripKind)` accepted a
    // zone-less string and stored a machine-timezone-dependent instant). Require the `Z` suffix + parse AsUniversal so
    // the stored instant is UTC regardless of host TZ. Explicit null / non-string / non-`Z` / unparseable ⇒ false → 400.
    private static bool TryOptionalDateTime(JsonObject obj, string key, out DateTimeOffset? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out string? raw) || raw is null
            || !raw.EndsWith('Z')
            || !DateTimeOffset.TryParse(
                raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    // Zod `.array(z.string().uuid()).max(max).optional()` from a JsonObject: absent key ⇒ (true, empty); present key
    // MUST be a JSON array ≤max whose every element is a canonical 8-4-4-4-12 hyphenated uuid (TryParseExact "D" —
    // NOT TryParse, which also accepts braces/parens/no-hyphen forms Zod `.uuid()` rejects). An explicit null, a
    // non-array, an over-max length, or ANY bad/non-string element ⇒ false → 400.
    private static bool TryOptionalGuidArray(JsonObject obj, string key, int max, out IReadOnlyList<Guid> value)
    {
        value = Array.Empty<Guid>();
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonArray array || array.Count > max)
        {
            return false;
        }

        var ids = new List<Guid>(array.Count);
        foreach (var element in array)
        {
            if (element is not JsonValue v || !v.TryGetValue(out string? raw) || raw is null
                || !Guid.TryParseExact(raw, "D", out var parsed))
            {
                return false;
            }

            ids.Add(parsed);
        }

        value = ids;
        return true;
    }

    // Raw JsonNode read for the three write bodies (all builders distinguish absent vs present-null keys).
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
}

/// <summary>OpenAPI request schema for createCalibration. scheduledAt/memberIds optional (declared LAST with
/// <c>= null</c> defaults so the generated schema marks them non-required); the handler parses defensively.</summary>
public sealed record CreateCalibrationBody(
    [property: Required] string Period,
    string? ScheduledAt = null,
    IReadOnlyList<string>? MemberIds = null);

/// <summary>OpenAPI request schema for submitCalibrationVote (sessionId is the route param). justification optional.</summary>
public sealed record SubmitCalibrationVoteBody(
    [property: Required] string EvaluatedUserId,
    [property: Required] string Quadrant,
    string? Justification = null);

/// <summary>OpenAPI request schema for addCalibrationMember (sessionId is the route param).</summary>
public sealed record AddCalibrationMemberBody([property: Required] string UserId);
