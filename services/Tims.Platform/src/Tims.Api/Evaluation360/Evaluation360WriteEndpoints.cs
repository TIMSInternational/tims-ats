using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Evaluation360;
using Tims.Application.Identity;
using Tims.Domain.Evaluation360;

namespace Tims.Api.Evaluation360;

/// <summary>
/// The evaluation360 WRITE endpoints (Phase-5 Slice 13) — the C# port of the 6 mutation bodies of the TS
/// <c>evaluation360</c> router. TWO auth patterns, deliberately NOT crossed:
/// <list type="bullet">
///   <item><description>STAFF (createCycle/openCycle/closeCycle/publishCycle/assignRaters): the action-parameterized
///     <see cref="Evaluation360StaffGate"/> — <c>evaluation360:create</c> (create/assign) / <c>:update</c> (the three
///     transitions) + the organization/company org-gate (TS <c>requireOrgScope</c>).</description></item>
///   <item><description>SELF-SERVICE (submitRatings): <see cref="SelfServiceGate"/> — IDENTITY only (any
///     resolved principal; NO grant, NO scope) → every query/write HARD-FILTERS on the caller's own user id as the
///     RATER. There is no rater id param — it is ALWAYS the caller, so an org-scoped admin can NEVER submit forged
///     feedback for another rater (→ NOT_FOUND).</description></item>
/// </list>
/// Input validation runs AFTER auth (tRPC parity — the permission middleware precedes input parsing). Dark-by-default
/// behind <see cref="PlatformOptions.Evaluation360WriteEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class Evaluation360WriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";

    private const string IllegalTransitionMessage = "La transición no es válida para el estado actual del ciclo";
    private const string CycleNotOpenMessage = "El ciclo debe estar en borrador o abierto para asignar evaluadores";
    private const string MissingUsersMessage = "Uno o más usuarios no pertenecen a esta organización";
    private const string SubmissionNotFoundMessage = "Evaluación no encontrada";
    private const string SubmissionConflictMessage = "La evaluación no está abierta o ya fue enviada";

    private const int MaxCycleNameLength = 200;
    private const int MaxAssignments = 500;
    private const int RequiredCompetencyCount = 6;
    private const int MaxCommentLength = 5000;

    public static void MapEvaluation360WriteEndpoints(this WebApplication app)
    {
        // ---- STAFF: createCycle — POST /evaluation360/cycles. 200 {id,name,status,createdAt} / 400 / 401 / 403. ----
        app.MapPost("/evaluation360/cycles", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                Evaluation360WriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360StaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, body) = await TryReadBodyAsync<CreateCycleParse>(httpContext, cancellationToken);
                if (!ok || body is null || !IsValidName(body.Name))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var callerId = Guid.Parse(gate.Context!.UserId);
                var result = await useCase.CreateCycleAsync(
                    gate.Context!.OrganizationId, callerId, body.Name!, timeProvider.GetUtcNow(), cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Accepts<CreateCycleBody>("application/json")
            .Produces<CreateCycleResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("Evaluation360CreateCycle");

        // ---- STAFF: openCycle/closeCycle/publishCycle — guarded transitions (count 0 ⇒ 409). ----
        MapTransition(app, "open", UpdateAction, "Evaluation360OpenCycle",
            (useCase, orgId, cycleId, now, ct) => useCase.OpenCycleAsync(orgId, cycleId, now, ct));
        MapTransition(app, "close", UpdateAction, "Evaluation360CloseCycle",
            (useCase, orgId, cycleId, now, ct) => useCase.CloseCycleAsync(orgId, cycleId, now, ct));
        MapTransition(app, "publish", UpdateAction, "Evaluation360PublishCycle",
            (useCase, orgId, cycleId, now, ct) => useCase.PublishCycleAsync(orgId, cycleId, now, ct));

        // ---- STAFF: assignRaters — POST /evaluation360/cycles/{id}/raters. 200 {created} / 400 / 401 / 403 / 409. ----
        app.MapPost("/evaluation360/cycles/{id:guid}/raters", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                Evaluation360WriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360StaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, parsed) = await TryReadBodyAsync<AssignRatersParse>(httpContext, cancellationToken);
                if (!ok || !TryBuildAssignments(parsed, out var assignments))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.AssignRatersAsync(
                    gate.Context!.OrganizationId, id, assignments, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    AssignRatersOutcome.CycleNotOpen => Results.Json(
                        new { message = CycleNotOpenMessage }, statusCode: StatusCodes.Status409Conflict),
                    AssignRatersOutcome.MissingUsers => Results.Json(
                        new { message = MissingUsersMessage }, statusCode: StatusCodes.Status400BadRequest),
                    _ => Results.Ok(new AssignRatersResponse(result.Created)),
                };
            })
            .RequireAuthorization()
            .Accepts<AssignRatersBody>("application/json")
            .Produces<AssignRatersResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status409Conflict)
            .WithName("Evaluation360AssignRaters");

        // ---- SELF-SERVICE: submitRatings — POST /evaluation360/assignments/{id}/ratings. Identity-anchored. ----
        app.MapPost("/evaluation360/assignments/{id:guid}/ratings", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360WriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, parsed) = await TryReadBodyAsync<SubmitRatingsParse>(httpContext, cancellationToken);
                if (!ok || !TryBuildRatings(parsed, out var ratings))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // raterUserId is ALWAYS the resolved caller — never a body/param value (the identity anchor).
                var raterUserId = Guid.Parse(gate.Context!.UserId);
                var result = await useCase.SubmitRatingsAsync(
                    gate.Context!.OrganizationId, raterUserId, id, ratings, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    SubmitRatingsOutcome.NotFound => Results.NotFound(new { message = SubmissionNotFoundMessage }),
                    SubmitRatingsOutcome.Conflict => Results.Json(
                        new { message = SubmissionConflictMessage }, statusCode: StatusCodes.Status409Conflict),
                    _ => Results.Ok(new SubmitRatingsResponse(id.ToString(), "submitted")),
                };
            })
            .RequireAuthorization()
            .Accepts<SubmitRatingsBody>("application/json")
            .Produces<SubmitRatingsResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status404NotFound).Produces(StatusCodes.Status409Conflict)
            .WithName("Evaluation360SubmitRatings");
    }

    private delegate Task<CycleTransitionResult> TransitionInvoker(
        Evaluation360WriteUseCase useCase, string orgId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken);

    // Shared shape for the three guarded transitions (open/close/publish): staff gate + the conditional transition;
    // Transitioned=false ⇒ 409 (illegal transition — absent, wrong org, or not in the expected current state).
    private static void MapTransition(
        WebApplication app, string verb, string action, string routeName, TransitionInvoker invoke)
    {
        app.MapPost($"/evaluation360/cycles/{{id:guid}}/{verb}", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                Evaluation360WriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360StaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, action,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await invoke(
                    useCase, gate.Context!.OrganizationId, id, timeProvider.GetUtcNow(), cancellationToken);
                return result.Transitioned
                    ? Results.Ok(new CycleTransitionResponse(id.ToString(), result.Status))
                    : Results.Json(new { message = IllegalTransitionMessage }, statusCode: StatusCodes.Status409Conflict);
            })
            .RequireAuthorization()
            .Produces<CycleTransitionResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status409Conflict)
            .WithName(routeName);
    }

    // Defensive JSON body read (mirrors the compensation write endpoints): a malformed/absent body ⇒ (false, null) → 400.
    private static async Task<(bool Ok, T? Body)> TryReadBodyAsync<T>(HttpContext httpContext, CancellationToken cancellationToken)
        where T : class
    {
        try
        {
            var body = await httpContext.Request.ReadFromJsonAsync<T>(cancellationToken);
            return (true, body);
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

    // Zod z.string().min(1).max(200): non-null, 1..200 chars.
    private static bool IsValidName(string? name) => name is { Length: >= 1 and <= MaxCycleNameLength };

    // Zod assignRaters: assignments 1..500; each subjectUserId/raterUserId uuid; relationship ∈ RATER_RELATIONSHIPS.
    private static bool TryBuildAssignments(AssignRatersParse? parsed, out IReadOnlyList<RaterAssignmentInput> assignments)
    {
        assignments = Array.Empty<RaterAssignmentInput>();
        if (parsed?.Assignments is not { Count: >= 1 and <= MaxAssignments } rows)
        {
            return false;
        }

        var built = new List<RaterAssignmentInput>(rows.Count);
        foreach (var row in rows)
        {
            if (row is null
                || !Guid.TryParse(row.SubjectUserId, out var subjectId)
                || !Guid.TryParse(row.RaterUserId, out var raterId)
                || !Eval360Relationships.IsValid(row.Relationship))
            {
                return false;
            }

            built.Add(new RaterAssignmentInput(subjectId, raterId, row.Relationship!));
        }

        assignments = built;
        return true;
    }

    // Zod submitRatings: EXACTLY 6 ratings, each a distinct competency (∈ EVAL360_COMPETENCIES); rating int 1..5;
    // comment optional ≤5000. The 6-distinct-valid refine == all six competencies exactly once.
    private static bool TryBuildRatings(SubmitRatingsParse? parsed, out IReadOnlyList<RatingSubmissionInput> ratings)
    {
        ratings = Array.Empty<RatingSubmissionInput>();
        if (parsed?.Ratings is not { Count: RequiredCompetencyCount } rows)
        {
            return false;
        }

        var built = new List<RatingSubmissionInput>(rows.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (row is null
                || row.CompetencyKey is null
                || !Eval360Competencies.All.Contains(row.CompetencyKey)
                || !seen.Add(row.CompetencyKey)
                || row.Rating is not { } rating || rating is < 1 or > 5
                || (row.Comment is { Length: > MaxCommentLength }))
            {
                return false;
            }

            built.Add(new RatingSubmissionInput(row.CompetencyKey, row.Rating.Value, row.Comment));
        }

        ratings = built;
        return true;
    }
}

/// <summary>{ cycleId, status } — the open/close/publish transition response (TS parity).</summary>
public sealed record CycleTransitionResponse(string CycleId, string Status);

/// <summary>{ created } — the assignRaters response (skipDuplicates-adjusted count).</summary>
public sealed record AssignRatersResponse(int Created);

/// <summary>{ assignmentId, status } — the submitRatings response.</summary>
public sealed record SubmitRatingsResponse(string AssignmentId, string Status);

/// <summary>Internal all-nullable parse shape for createCycle (absent name → null → 400).</summary>
internal sealed record CreateCycleParse(string? Name);

/// <summary>Internal parse shape for assignRaters.</summary>
internal sealed record AssignRatersParse(List<RaterAssignmentParse>? Assignments);

internal sealed record RaterAssignmentParse(string? SubjectUserId, string? RaterUserId, string? Relationship);

/// <summary>Internal parse shape for submitRatings.</summary>
internal sealed record SubmitRatingsParse(List<RatingParse>? Ratings);

internal sealed record RatingParse(string? CompetencyKey, int? Rating, string? Comment);

/// <summary>OpenAPI request schema for createCycle.</summary>
public sealed record CreateCycleBody([property: Required] string Name);

/// <summary>OpenAPI request schema for assignRaters.</summary>
public sealed record AssignRatersBody([property: Required] IReadOnlyList<RaterAssignmentBody> Assignments);

/// <summary>OpenAPI request schema for one rater assignment.</summary>
public sealed record RaterAssignmentBody(
    [property: Required] string SubjectUserId,
    [property: Required] string RaterUserId,
    [property: Required] string Relationship);

/// <summary>OpenAPI request schema for submitRatings.</summary>
public sealed record SubmitRatingsBody([property: Required] IReadOnlyList<RatingBody> Ratings);

/// <summary>OpenAPI request schema for one rating (comment optional).</summary>
public sealed record RatingBody(
    [property: Required] string CompetencyKey,
    [property: Required] int Rating,
    string? Comment = null);
