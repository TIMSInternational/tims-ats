using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Engagement;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Engagement;
using Tims.Infrastructure.Access;

namespace Tims.Api.Engagement;

/// <summary>
/// The engagement WRITE endpoints (Phase-5 Slice 16) — the C# port of the 5 mutation bodies of the TS
/// <c>engagement</c> router (createSurvey / activateSurvey / submitSurveyResponse / createActionPlan /
/// updateActionPlan; all inline <c>db.*</c> — there is no TS service/repo). The 5 writes carry DIFFERENT scope
/// mechanics on the <c>engagement:create/update</c> grants — the action-parameterized
/// <see cref="EngagementStaffGate"/> authorizes the grant and RETURNS the resolved scope, and each endpoint applies
/// its own mechanic (identical pattern to <see cref="EngagementReadEndpoints"/>):
/// <list type="bullet">
///   <item><description>createSurvey / activateSurvey → grant-only (org via ctx; NO scope mechanic beyond the grant).</description></item>
///   <item><description>submitSurveyResponse → IDENTITY-anchored (userId = caller ALWAYS, never an input; NO
///     requireOrgScope — an org-gate would forbid the own-scoped employee). survey not-active → 404 (documented
///     port improvement over the TS plain-Error 500); dedup <c>@@unique([surveyId,userId])</c> → 409.</description></item>
///   <item><description>createActionPlan → <c>assertSubjectInScope(responsibleId)</c> (out-of-set → 403) + the H1
///     in-org backstop (cross-org responsibleId → 403).</description></item>
///   <item><description>updateActionPlan → <c>assertScoped('actionPlan')</c> by-id IDOR probe (→ 404) THEN, on a
///     reassignment, <c>assertSubjectInScope(responsibleId)</c> (→ 403) + the H1 in-org backstop (→ 403).</description></item>
/// </list>
/// <c>type</c>/question-<c>type</c>/<c>status</c> are plain-string enum sets enforced at the endpoint (→ 400 AFTER
/// auth, tRPC parity). createSurvey stamps <c>createdById = caller</c>; submitSurveyResponse stamps
/// <c>userId = caller</c> — both server-side, never from input. targetGroups is stored opaque (NO in-org validation —
/// a documented LOW, spec §2.2). Every write runs UNDER TenantScope + an explicit org filter. Dark-by-default behind
/// <see cref="PlatformOptions.EngagementWriteEnabled"/> (mapped only when on, or at build-time OpenAPI generation).
/// </summary>
public static class EngagementWriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";

    private const string SubjectForbiddenMessage = "No puedes asignar este plan a ese usuario";
    private const string DuplicateResponseMessage = "Ya respondiste esta encuesta";
    private const string SurveyNotActiveMessage = "Encuesta no encontrada o no activa";
    private const string SurveyNotFoundMessage = "Encuesta no encontrada";
    private const string ActionPlanNotFoundMessage = "Plan de accion no encontrado";

    private const int MaxTitleLength = 200;
    private const int MaxQuestionTextLength = 500;
    private const int MaxOptionLength = 200;
    private const int MaxOptions = 100;
    private const int MaxCategoryLength = 100;
    private const int MaxAreaLength = 200;
    private const int MaxNotesLength = 2000;
    private const int MaxTargetGroupIds = 1000;
    private const int MaxAnswerKeyLength = 200;
    private const int MaxAnswerStringLength = 5000;
    private const int MaxAnswers = 100;

    public static void MapEngagementWriteEndpoints(this WebApplication app)
    {
        // ---- createSurvey — POST /engagement/surveys. grant-only. 200 (full row) / 400 / 401 / 403. ----
        app.MapPost("/engagement/surveys", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                EngagementWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildCreateSurvey(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var row = await useCase.CreateSurveyAsync(
                    gate.Context!.OrganizationId, Guid.Parse(gate.Context!.UserId), input, timeProvider.GetUtcNow(),
                    cancellationToken);
                return Results.Ok(row);
            })
            .RequireAuthorization()
            .Accepts<CreateSurveyBody>("application/json")
            .Produces<SurveyRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementCreateSurvey");

        // ---- activateSurvey — POST /engagement/surveys/{surveyId}/activate. grant-only. 200 {id,status} / 404. ----
        app.MapPost("/engagement/surveys/{surveyId:guid}/activate", async (
                Guid surveyId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                EngagementWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // findFirst {id, org} → null ⇒ 404 NOT_FOUND (missing / cross-org, RLS-hidden) — matches the deleted
                // TS activateSurvey mutation.
                var result = await useCase.ActivateSurveyAsync(
                    gate.Context!.OrganizationId, surveyId, timeProvider.GetUtcNow(), cancellationToken);
                return result is null
                    ? Results.NotFound(new { message = SurveyNotFoundMessage })
                    : Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<ActivateSurveyResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("EngagementActivateSurvey");

        // ---- submitSurveyResponse — POST /engagement/surveys/{surveyId}/responses. IDENTITY-anchored, NO org-gate. ----
        // survey not-active → 404 (documented improvement over the TS 500); dedup → 409. userId = caller ALWAYS.
        app.MapPost("/engagement/surveys/{surveyId:guid}/responses", async (
                Guid surveyId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                EngagementWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildSubmitResponse(surveyId, node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.SubmitSurveyResponseAsync(
                    gate.Context!.OrganizationId, Guid.Parse(gate.Context!.UserId), input, timeProvider.GetUtcNow(),
                    cancellationToken);
                return result.Outcome switch
                {
                    // Documented port improvement (architecturally-correct-not-safe): the TS surfaces a missing/inactive
                    // survey as a plain-Error 500; the C# maps it to a clean, leak-free 404.
                    SubmitSurveyResponseOutcome.SurveyNotActive => Results.NotFound(
                        new { message = SurveyNotActiveMessage }),
                    SubmitSurveyResponseOutcome.Conflict => Results.Json(
                        new { message = DuplicateResponseMessage }, statusCode: StatusCodes.Status409Conflict),
                    _ => Results.Ok(result.Row),
                };
            })
            .RequireAuthorization()
            .Accepts<SubmitSurveyResponseBody>("application/json")
            .Produces<SubmitSurveyResponseRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("EngagementSubmitSurveyResponse");

        // ---- createActionPlan — POST /engagement/action-plans. assertSubjectInScope(responsibleId) + H1. ----
        app.MapPost("/engagement/action-plans", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, EngagementWriteUseCase useCase, TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildCreateActionPlan(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);

                // Write-rule (matching the TS createActionPlan mutation): the responsible person must be within the
                // caller's subject set.
                // Out-of-set → 403. Org/company scope short-circuits (true); narrow scopes query the anchors.
                var subjectFailure = await AssertSubjectInScopeAsync(
                    anchorLoaderFactory, gate.Scope!.Value, orgId, callerId, input.ResponsibleId, cancellationToken);
                if (subjectFailure is not null)
                {
                    return subjectFailure;
                }

                // H1 backstop: a null return = the responsibleId is not a member of the caller's org (assertSubjectInScope
                // no-ops for org/company scope) → 403, no INSERT. Fixed in BOTH stacks (the TS createActionPlan
                // mutation too).
                var row = await useCase.CreateActionPlanAsync(
                    gate.Context!.OrganizationId, input, timeProvider.GetUtcNow(), cancellationToken);
                return row is null
                    ? Results.Json(new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden)
                    : Results.Ok(row);
            })
            .RequireAuthorization()
            .Accepts<CreateActionPlanBody>("application/json")
            .Produces<ActionPlanWriteRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementCreateActionPlan");

        // ---- updateActionPlan — PATCH /engagement/action-plans/{id}. assertScoped('actionPlan') → 404 THEN reassign. ----
        app.MapPatch("/engagement/action-plans/{actionPlanId:guid}", async (
                Guid actionPlanId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe, EngagementWriteUseCase useCase,
                TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildUpdateActionPlan(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);

                // (1) The action plan must be in the caller's grant (matching the TS updateActionPlan mutation's
                // in-grant check). Out-of-grant / nonexistent →
                // ScopedNotFoundException (404, "Plan de accion no encontrado") — never confirms the id exists.
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                ScopePredicateSqlTranslator.Translated scopeGuard;
                try
                {
                    await scopedProbe.AssertScopedAsync(
                        ScopedEntity.ActionPlan, actionPlanId, gate.Scope!.Value, anchors, orgId, callerId,
                        cancellationToken);

                    // (2) Reassignment can't push out of scope (matching the TS updateActionPlan mutation) — the
                    // target must be in the caller's
                    // subject set → out-of-set → 403.
                    if (input.ResponsibleId is { } responsibleId)
                    {
                        var satisfied = await SubjectInScope.IsSatisfiedAsync(
                            gate.Scope!.Value, anchors, callerId.ToString(), responsibleId.ToString(), cancellationToken);
                        if (!satisfied)
                        {
                            return Results.Json(
                                new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                        }
                    }

                    // (3) Build the caller's scope predicate ONCE (same scope + anchors as the probe) so the UPDATE can
                    // re-check it ATOMICALLY under FOR UPDATE (Codex HIGH) — closes the probe-then-update reassignment
                    // race. org/company scope → TRUE (a no-op); narrow scope → responsible_id ∈ the subject set.
                    var scopePredicate = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.ActionPlan, gate.Scope!.Value, anchors, callerId.ToString(), cancellationToken);
                    scopeGuard = ScopePredicateSqlTranslator.Translate("action_plans", scopePredicate);
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var result = await useCase.UpdateActionPlanAsync(
                    gate.Context!.OrganizationId, actionPlanId, input, scopeGuard.Sql, scopeGuard.Parameters,
                    timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    // H1 backstop: the reassignment target is not a member of the caller's org → 403, no reassignment.
                    UpdateActionPlanOutcome.ResponsibleNotInOrg => Results.Json(
                        new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden),
                    UpdateActionPlanOutcome.NotFound => Results.NotFound(new { message = ActionPlanNotFoundMessage }),
                    _ => Results.Ok(result.Row),
                };
            })
            .RequireAuthorization()
            .Accepts<UpdateActionPlanBody>("application/json")
            .Produces<ActionPlanWriteRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .WithName("EngagementUpdateActionPlan");
    }

    // The assertSubjectInScope write-rule (createActionPlan): the target responsibleId must be in the caller's subject
    // set. Org/company scope short-circuits (true); narrow scopes query the anchors. Out-of-set → 403, else null.
    private static async Task<IResult?> AssertSubjectInScopeAsync(
        IAnchorLoaderFactory anchorLoaderFactory, AccessScope scope, Guid orgId, Guid callerId, Guid targetUserId,
        CancellationToken cancellationToken)
    {
        var anchors = anchorLoaderFactory.Create(orgId, callerId);
        try
        {
            var satisfied = await SubjectInScope.IsSatisfiedAsync(
                scope, anchors, callerId.ToString(), targetUserId.ToString(), cancellationToken);
            return satisfied
                ? null
                : Results.Json(new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
        }
        finally
        {
            await DisposeAnchorsAsync(anchors);
        }
    }

    // ---- Zod-parity input validation (runs AFTER auth) --------------------------------------------------------

    // createSurvey: title 1..200; type ∈ {pulse,enps,climate,custom}; questions non-empty array (each text 1..500,
    // type ∈ {scale,text,multiple_choice,yes_no}, options? ≤100×≤200, required? bool (default true), category? ≤100);
    // targetGroups? object (companyIds/businessUnitIds/teamIds each uuid[]≤1000, opaque — stored not in-org-validated);
    // startsAt?/endsAt? Zod-datetime. Parsed from a JsonObject so an EXPLICIT null on a Zod `.optional()` field is
    // REJECTED (→ 400) rather than collapsed to "absent". The stored questions/targetGroups are REBUILT to Zod's parse
    // output (required defaulted, unknown keys stripped) — faithful to what Prisma persists.
    private static bool TryBuildCreateSurvey(JsonNode? node, out CreateSurveyInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["title"] is not JsonValue titleValue || !titleValue.TryGetValue(out string? title) || title is null
            || title.Length < 1 || title.Length > MaxTitleLength
            || obj["type"] is not JsonValue typeValue || !typeValue.TryGetValue(out string? type)
            || !SurveyTypeValues.IsValid(type)
            || !TryBuildQuestions(obj["questions"], out var questions)
            || !TryBuildTargetGroups(obj, out var targetGroups)
            || !TryOptionalDateTime(obj, "startsAt", out var startsAt)
            || !TryOptionalDateTime(obj, "endsAt", out var endsAt))
        {
            return false;
        }

        input = new CreateSurveyInput(title, type!, questions, targetGroups, startsAt, endsAt);
        return true;
    }

    // questions: a non-empty array; each item validated + rebuilt to Zod's parse shape {text, type, [options],
    // required (default true), [category]} in a fixed key order.
    private static bool TryBuildQuestions(JsonNode? questionsNode, out JsonArray cleaned)
    {
        cleaned = new JsonArray();
        if (questionsNode is not JsonArray arr || arr.Count < 1)
        {
            return false;
        }

        foreach (var item in arr)
        {
            if (item is not JsonObject q
                || q["text"] is not JsonValue textValue || !textValue.TryGetValue(out string? text) || text is null
                || text.Length < 1 || text.Length > MaxQuestionTextLength
                || q["type"] is not JsonValue qTypeValue || !qTypeValue.TryGetValue(out string? qType)
                || !SurveyQuestionTypeValues.IsValid(qType)
                || !TryOptionalStringArray(q, "options", MaxOptions, MaxOptionLength, out var options)
                || !TryOptionalBool(q, "required", out var required)
                || !TryOptionalString(q, "category", MaxCategoryLength, out var category))
            {
                cleaned = new JsonArray();
                return false;
            }

            var clean = new JsonObject { ["text"] = text, ["type"] = qType };
            if (options is not null)
            {
                clean["options"] = options;
            }

            // Zod `.default(true)` — an ABSENT required parses to true.
            clean["required"] = required ?? true;
            if (category is not null)
            {
                clean["category"] = category;
            }

            cleaned.Add(clean);
        }

        return true;
    }

    // targetGroups?: absent ⇒ null; present MUST be a JSON object; each of companyIds/businessUnitIds/teamIds IF
    // present MUST be a uuid[]≤1000 (canonical form). Rebuilt to only the three recognized keys (Zod strips unknowns).
    // An explicit null / non-object / bad sub-array ⇒ false → 400.
    private static bool TryBuildTargetGroups(JsonObject obj, out JsonObject? targetGroups)
    {
        targetGroups = null;
        if (!obj.TryGetPropertyValue("targetGroups", out var tgNode))
        {
            return true;
        }

        if (tgNode is not JsonObject tg)
        {
            return false;
        }

        var rebuilt = new JsonObject();
        foreach (var key in new[] { "companyIds", "businessUnitIds", "teamIds" })
        {
            if (!TryOptionalUuidArray(tg, key, MaxTargetGroupIds, out var ids))
            {
                return false;
            }

            if (ids is not null)
            {
                rebuilt[key] = ids;
            }
        }

        targetGroups = rebuilt;
        return true;
    }

    // submitSurveyResponse: answers = a record (≤100 keys, each key ≤200 chars, each value a string≤5000 OR a number).
    // surveyId is the route param. Stored opaque (record has no defaults / stripping). Explicit-null value ⇒ 400.
    private static bool TryBuildSubmitResponse(Guid surveyId, JsonNode? node, out SubmitSurveyResponseInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["answers"] is not JsonObject answers
            || answers.Count > MaxAnswers)
        {
            return false;
        }

        foreach (var (key, value) in answers)
        {
            if (key.Length > MaxAnswerKeyLength || !IsValidAnswerValue(value))
            {
                return false;
            }
        }

        input = new SubmitSurveyResponseInput(surveyId, (JsonObject)answers.DeepClone());
        return true;
    }

    // A survey answer value is a JSON string ≤5000 OR a JSON number (Zod `z.union([z.string().max(5000), z.number()])`).
    private static bool IsValidAnswerValue(JsonNode? value)
    {
        if (value is not JsonValue jv)
        {
            return false;
        }

        if (jv.TryGetValue(out string? str))
        {
            return str.Length <= MaxAnswerStringLength;
        }

        return jv.TryGetValue(out double _);
    }

    // createActionPlan: title 1..200; responsibleId uuid; area? ≤200; notes? ≤2000; dueDate? Zod-datetime.
    private static bool TryBuildCreateActionPlan(JsonNode? node, out CreateActionPlanInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["title"] is not JsonValue titleValue || !titleValue.TryGetValue(out string? title) || title is null
            || title.Length < 1 || title.Length > MaxTitleLength
            || obj["responsibleId"] is not JsonValue responsibleValue
            || !responsibleValue.TryGetValue(out string? responsibleRaw) || responsibleRaw is null
            || !Guid.TryParseExact(responsibleRaw, "D", out var responsibleId)
            || !TryOptionalString(obj, "area", MaxAreaLength, out var area)
            || !TryOptionalString(obj, "notes", MaxNotesLength, out var notes)
            || !TryOptionalDateTime(obj, "dueDate", out var dueDate))
        {
            return false;
        }

        input = new CreateActionPlanInput(title, responsibleId, area, notes, dueDate);
        return true;
    }

    // updateActionPlan: every field optional. title? 1..200; notes? ≤2000; status? ∈ {pending,in_progress,completed};
    // responsibleId? uuid; dueDate? Zod-datetime (present ⇒ set — the `.optional()` boundary makes an explicit
    // null unreachable → 400, so the resolver's latent null-clear is exercised only at the repo level, spec §1.1).
    // Each provided key is applied; absent keys are skipped (Prisma undefined-skip parity).
    private static bool TryBuildUpdateActionPlan(JsonNode? node, out UpdateActionPlanInput input)
    {
        input = null!;
        if (node is not JsonObject obj)
        {
            return false;
        }

        // title? — present must be a string 1..200 (an empty string violates Zod `.min(1)` → 400).
        string? title = null;
        var hasTitle = false;
        if (obj.TryGetPropertyValue("title", out var titleNode))
        {
            if (titleNode is not JsonValue tv || !tv.TryGetValue(out title) || title is null
                || title.Length < 1 || title.Length > MaxTitleLength)
            {
                return false;
            }

            hasTitle = true;
        }

        if (!TryOptionalString(obj, "notes", MaxNotesLength, out var notes))
        {
            return false;
        }

        var hasNotes = obj.ContainsKey("notes");

        // status? — present must be a valid enum member.
        string? status = null;
        var hasStatus = false;
        if (obj.TryGetPropertyValue("status", out var statusNode))
        {
            if (statusNode is not JsonValue sv || !sv.TryGetValue(out status) || !ActionPlanStatusValues.IsValid(status))
            {
                return false;
            }

            hasStatus = true;
        }

        if (!TryOptionalGuid(obj, "responsibleId", out var responsibleId)
            || !TryOptionalDateTime(obj, "dueDate", out var dueDate))
        {
            return false;
        }

        var hasDueDate = obj.ContainsKey("dueDate");

        input = new UpdateActionPlanInput(
            title, hasTitle, notes, hasNotes, status, hasStatus, responsibleId, dueDate, hasDueDate);
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

    // Zod `.boolean().optional()` (or `.default(true)`) from a JsonObject: absent key ⇒ (true, null → caller defaults);
    // present key MUST be a JSON boolean (an explicit null / non-bool ⇒ false → 400).
    private static bool TryOptionalBool(JsonObject obj, string key, out bool? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out bool parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    // Zod `.string().uuid().optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a canonical
    // 8-4-4-4-12 hyphenated uuid (TryParseExact "D" — Zod `.uuid()` rejects brace/paren/no-hyphen forms TryParse takes).
    private static bool TryOptionalGuid(JsonObject obj, string key, out Guid? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out string? raw) || string.IsNullOrEmpty(raw)
            || !Guid.TryParseExact(raw, "D", out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    // Zod `.array(z.string().max(itemMax)).max(max).optional()` from a JsonObject (survey question options): absent ⇒
    // (true, null); present MUST be a JSON array ≤max whose every element is a string ≤itemMax. Returns a rebuilt array.
    private static bool TryOptionalStringArray(JsonObject obj, string key, int max, int itemMax, out JsonArray? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonArray arr || arr.Count > max)
        {
            return false;
        }

        var rebuilt = new JsonArray();
        foreach (var element in arr)
        {
            if (element is not JsonValue ev || !ev.TryGetValue(out string? s) || s is null || s.Length > itemMax)
            {
                return false;
            }

            rebuilt.Add(s);
        }

        value = rebuilt;
        return true;
    }

    // Zod `.array(z.string().uuid()).max(max).optional()` from a JsonObject (targetGroups sub-arrays): absent ⇒
    // (true, null); present MUST be a JSON array ≤max whose every element is a canonical uuid. Returns a rebuilt array.
    private static bool TryOptionalUuidArray(JsonObject obj, string key, int max, out JsonArray? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonArray arr || arr.Count > max)
        {
            return false;
        }

        var rebuilt = new JsonArray();
        foreach (var element in arr)
        {
            if (element is not JsonValue ev || !ev.TryGetValue(out string? raw) || string.IsNullOrEmpty(raw)
                || !Guid.TryParseExact(raw, "D", out _))
            {
                return false;
            }

            rebuilt.Add(raw);
        }

        value = rebuilt;
        return true;
    }

    // Zod `.string().datetime().optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a JSON
    // string in the Zod-default datetime form — a UTC `Z`-suffixed ISO-8601 (Zod `.datetime()` rejects zone-less and
    // numeric-offset forms). Require the `Z` suffix + parse AsUniversal so the stored instant is UTC regardless of host
    // TZ. Explicit null / non-string / non-`Z` / unparseable ⇒ false → 400.
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

    // Raw JsonNode read for every write body (the builders distinguish absent vs present-null keys).
    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(
        HttpContext httpContext, CancellationToken cancellationToken)
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

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}

/// <summary>OpenAPI request schema for createSurvey (the accurate contract; the handler parses defensively). The
/// optional fields are declared LAST with <c>= null</c> defaults so the generated schema marks them non-required.</summary>
public sealed record CreateSurveyBody(
    [property: Required] string Title,
    [property: Required] string Type,
    [property: Required] IReadOnlyList<object> Questions,
    object? TargetGroups = null,
    string? StartsAt = null,
    string? EndsAt = null);

/// <summary>OpenAPI request schema for submitSurveyResponse (surveyId is the route param).</summary>
public sealed record SubmitSurveyResponseBody(
    [property: Required] IReadOnlyDictionary<string, object> Answers);

/// <summary>OpenAPI request schema for createActionPlan.</summary>
public sealed record CreateActionPlanBody(
    [property: Required] string Title,
    [property: Required] string ResponsibleId,
    string? Area = null,
    string? Notes = null,
    string? DueDate = null);

/// <summary>OpenAPI request schema for updateActionPlan (id is the route param; every field optional).</summary>
public sealed record UpdateActionPlanBody(
    string? Title = null,
    string? Notes = null,
    string? Status = null,
    string? ResponsibleId = null,
    string? DueDate = null);
