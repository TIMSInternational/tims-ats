using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Compensation;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Compensation;
using Tims.Infrastructure.Access;

namespace Tims.Api.Compensation;

/// <summary>
/// The compensation WRITE endpoints (Phase-5 Slice 12) — the C# port of the LAST two bodies of the TS
/// <c>compensation</c> router still on TS: <c>createAdjustment</c> + <c>approveAdjustment</c>. Staff-JWT via the
/// action-parameterized <see cref="CompensationStaffGate"/> (<c>compensation:create</c> / <c>compensation:approve</c>).
/// createAdjustment gates the TARGET userId with <see cref="SubjectInScope"/> (write-rule: no row to probe yet);
/// approveAdjustment runs the by-id <see cref="ScopedProbe"/> (assertScoped('salaryAdjustment') → 404-not-403),
/// a FAIL-CLOSED audit BEFORE the mutation, then the atomic conditional transaction (CONFLICT on a lost race).
/// Dark-by-default behind <see cref="PlatformOptions.CompensationWriteEnabled"/> (mapped only when on, or at
/// build-time OpenAPI generation).
/// </summary>
public static class CompensationWriteEndpoints
{
    private const string CreateAction = "create";
    private const string ApproveAction = "approve";
    private const string SubjectForbiddenMessage = "No puedes crear ajustes para este usuario";
    private const string AdjustmentNotFoundMessage = "Ajuste no encontrado o ya procesado";

    public static void MapCompensationWriteEndpoints(this WebApplication app)
    {
        // createAdjustment — POST /compensation/adjustments. 200 {id,status} / 400 / 401 / 403.
        app.MapPost("/compensation/adjustments", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, CompensationWriteUseCase useCase,
                TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    CreateAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                CreateAdjustmentCommand command;
                try
                {
                    var body = await httpContext.Request.ReadFromJsonAsync<CreateAdjustmentParse>(cancellationToken);
                    if (!TryBuildCreateCommand(body, out command))
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }
                }
                catch (JsonException)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }
                catch (InvalidOperationException)
                {
                    return Results.BadRequest(new { error = "request body must be application/json" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);

                // Write-rule subject scope: gate the TARGET userId (no row exists yet). Out-of-set → 403.
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    var satisfied = await SubjectInScope.IsSatisfiedAsync(
                        gate.Scope!.Value, anchors, callerId.ToString(), command.UserId.ToString(), cancellationToken);
                    if (!satisfied)
                    {
                        return Results.Json(
                            new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                    }
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var result = await useCase.CreateAdjustmentAsync(
                    gate.Context!.OrganizationId, callerId, command, timeProvider.GetUtcNow(), cancellationToken);
                // H1: null ⇒ the target userId is NOT a member of the caller's org (a cross-tenant reference the
                // org/company-scope subject-scope no-op would otherwise allow) → 403, no INSERT.
                if (result is null)
                {
                    return Results.Json(
                        new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                }
                return Results.Ok(new AdjustmentWriteResponse(result.Id, result.Status));
            })
            .RequireAuthorization()
            .Accepts<CreateAdjustmentBody>("application/json")
            .Produces<AdjustmentWriteResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationCreateAdjustment");

        // approveAdjustment — POST /compensation/adjustments/{id}/approve. 200 {id,status} / 400 / 401 / 403 / 404 / 409.
        app.MapPost("/compensation/adjustments/{id:guid}/approve", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                CompensationWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    ApproveAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                bool approved;
                try
                {
                    var body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                    if (!TryReadApproveBody(body, out approved))
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }
                }
                catch (JsonException)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }
                catch (InvalidOperationException)
                {
                    return Results.BadRequest(new { error = "request body must be application/json" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);

                // By-id IDOR probe (belt-and-braces): a narrow-scoped caller must not reach an out-of-scope
                // adjustment by id-guessing → ScopedNotFoundException (404, "Ajuste salarial no encontrado").
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    await scopedProbe.AssertScopedAsync(
                        ScopedEntity.SalaryAdjustment, id, gate.Scope!.Value, anchors, orgId, callerId, cancellationToken);
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var forwarded = httpContext.Request.Headers["x-forwarded-for"].ToString();
                var realIp = httpContext.Request.Headers["x-real-ip"].ToString();
                var ipAddress = !string.IsNullOrEmpty(forwarded) ? forwarded : string.IsNullOrEmpty(realIp) ? null : realIp;
                var userAgent = httpContext.Request.Headers.UserAgent.ToString();

                var result = await useCase.ApproveAsync(
                    gate.Context!.OrganizationId, id, callerId, AuditActor.ActorFor(gate.Context!),
                    approved, ipAddress, string.IsNullOrEmpty(userAgent) ? null : userAgent,
                    timeProvider.GetUtcNow(), cancellationToken);

                return result.Outcome switch
                {
                    ApproveOutcome.NotFound => Results.NotFound(new { message = AdjustmentNotFoundMessage }),
                    ApproveOutcome.Conflict => Results.Json(
                        new { message = AdjustmentNotFoundMessage }, statusCode: StatusCodes.Status409Conflict),
                    _ => Results.Ok(new AdjustmentWriteResponse(id.ToString(), result.Status!)),
                };
            })
            .RequireAuthorization()
            .Accepts<ApproveAdjustmentBody>("application/json")
            .Produces<AdjustmentWriteResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("CompensationApproveAdjustment");
    }

    // Zod-parity bounds for createAdjustment: userId uuid; type enum; previousSalary/newSalary > 0; currency?
    // exactly 3 chars; reason? ≤1000; effectiveDate a valid ISO datetime. Any violation ⇒ false (→ 400).
    private static bool TryBuildCreateCommand(CreateAdjustmentParse? body, out CreateAdjustmentCommand command)
    {
        command = null!;
        if (body is null
            || !Guid.TryParse(body.UserId, out var userId)
            || !AdjustmentTypes.IsValid(body.Type)
            || body.PreviousSalary is not { } prev || !(prev > 0)
            || body.NewSalary is not { } next || !(next > 0)
            || (body.Currency is { } currency && currency.Trim().Length != 3)
            || (body.Reason is { Length: > 1000 })
            || body.EffectiveDate is not { } effectiveDateRaw
            || !TryParseZuluIso8601(effectiveDateRaw, out var effectiveDate))
        {
            return false;
        }

        command = new CreateAdjustmentCommand(
            userId, body.Type!, prev, next, body.Currency, body.Reason, effectiveDate);
        return true;
    }

    // Zod-parity for approveAdjustment: `approved` a REQUIRED boolean; `comment` optional string ≤500 (accepted
    // but NEVER persisted — TS parity). Missing/typed-wrong `approved` or an over-long/typed-wrong comment ⇒ 400.
    private static bool TryReadApproveBody(JsonNode? body, out bool approved)
    {
        approved = false;
        if (body is not JsonObject obj)
        {
            return false;
        }

        if (obj["approved"] is not JsonValue approvedValue || !approvedValue.TryGetValue(out bool parsed))
        {
            return false;
        }

        if (obj.TryGetPropertyValue("comment", out var commentNode) && commentNode is not null)
        {
            if (commentNode is not JsonValue commentValue
                || !commentValue.TryGetValue(out string? comment)
                || comment.Length > 500)
            {
                return false;
            }
        }

        approved = parsed;
        return true;
    }

    // Zod `.datetime()` (default opts) accepts ONLY a 'Z'-anchored UTC ISO-8601 instant — it REJECTS date-only,
    // no-zone, and numeric-offset strings. Bare DateTimeOffset.TryParse(RoundtripKind) would accept all three,
    // silently storing a different effectiveDate than the live TS writer would 400 on. Guard with the same
    // grammar (date + strict HH:mm:ss[.fraction] + mandatory 'Z') BEFORE parsing, so the write path is faithful.
    private static readonly Regex ZuluIso8601 = new(
        @"^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static bool TryParseZuluIso8601(string raw, out DateTimeOffset value)
    {
        value = default;
        return ZuluIso8601.IsMatch(raw)
            && DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value);
    }

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}

/// <summary>The §21 minimal write response — ONLY {id, status}; no restricted field is echoed.</summary>
public sealed record AdjustmentWriteResponse(string Id, string Status);

/// <summary>Internal all-nullable parse shape for createAdjustment (absent field → null → 400 at validation).</summary>
internal sealed record CreateAdjustmentParse(
    string? UserId,
    string? Type,
    double? PreviousSalary,
    double? NewSalary,
    string? Currency,
    string? Reason,
    string? EffectiveDate);

/// <summary>OpenAPI request schema for createAdjustment (the accurate contract; the handler parses defensively).
/// Currency/Reason are OPTIONAL (TS Zod `.optional()`) — declared LAST with `= null` defaults so the generated
/// schema marks them non-required (a record positional param with no default is emitted as required).</summary>
public sealed record CreateAdjustmentBody(
    [property: Required] string UserId,
    [property: Required] string Type,
    [property: Required] double PreviousSalary,
    [property: Required] double NewSalary,
    [property: Required] string EffectiveDate,
    string? Currency = null,
    string? Reason = null);

/// <summary>OpenAPI request schema for approveAdjustment. `comment` is OPTIONAL (Zod `.optional()`, `= null`
/// default → non-required in the contract) and accepted but never persisted.</summary>
public sealed record ApproveAdjustmentBody(
    [property: Required] bool Approved,
    string? Comment = null);
