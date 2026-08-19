using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.Notification;

namespace Tims.Api.Notification;

/// <summary>
/// The notification WRITE endpoints (Phase-5 Slice 25) — the C# port of the eight mutations of the TS
/// <c>notification</c> router, across TWO different authorization models that must not be confused:
/// <list type="bullet">
///   <item><description>SELF-SERVICE (<c>markAsRead</c>, <c>markAllAsRead</c>, <c>archive</c>,
///   <c>archiveAllRead</c>, <c>delete</c>, <c>updatePreferences</c>) — <see cref="SelfServiceGate"/>, identity
///   only, every statement hard-filtered to the caller's own rows.</description></item>
///   <item><description>GRANT-GATED (<c>create</c>, <c>bulkCreate</c>) — <see cref="NotificationStaffGate"/>
///   with <c>notification:create</c>, addressing a TARGET user from the body.</description></item>
/// </list>
/// Body validation runs AFTER auth in both cases (tRPC middleware-before-Zod parity), which for the two
/// grant-gated routes also keeps a garbage body from suppressing the <c>authz_denied</c> audit row that
/// <c>SecurityDenialAuditMiddleware</c> writes for a 403. Dark-by-default behind
/// <see cref="PlatformOptions.NotificationWriteEnabled"/>.
/// </summary>
public static class NotificationWriteEndpoints
{
    private const string CreateAction = "create";

    private const int MaxTitleLength = 200;
    private const int MaxMessageLength = 1000;
    private const int MaxModuleLength = 50;
    private const int MaxEntityTypeLength = 50;
    private const int MaxActionUrlLength = 500;
    private const int MaxQuietHoursLength = 10;
    private const int MaxBulkUserIds = 500;

    private static readonly string[] AllowedTypes = ["critical", "warning", "info", "success"];

    public static void MapNotificationWriteEndpoints(this WebApplication app)
    {
        // ---- markAsRead — POST /notifications/{id}/read → { count } ----
        app.MapPost("/notifications/{id:guid}/read", async (
                Guid id,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.MarkAsReadAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), id,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationMarkAsRead");

        // ---- markAllAsRead — POST /notifications/read-all → { count } ----
        app.MapPost("/notifications/read-all", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.MarkAllAsReadAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId),
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationMarkAllAsRead");

        // ---- archive — POST /notifications/{id}/archive → { count } ----
        app.MapPost("/notifications/{id:guid}/archive", async (
                Guid id,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.ArchiveAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), id,
                    cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationArchive");

        // ---- archiveAllRead — POST /notifications/archive-read → { count } ----
        app.MapPost("/notifications/archive-read", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.ArchiveAllReadAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId),
                    cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationArchiveAllRead");

        // ---- delete — DELETE /notifications/{id} → { count } (a HARD delete, TS parity) ----
        app.MapDelete("/notifications/{id:guid}", async (
                Guid id,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.DeleteAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), id,
                    cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationDelete");

        // ---- updatePreferences — PATCH /notifications/preferences → { emailEnabled, pushEnabled } ----
        app.MapPatch("/notifications/preferences", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || TryBuildPreferencesUpdate(node) is not { } update)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.UpdatePreferencesAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), update,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Accepts<UpdateNotificationPreferencesBody>(isOptional: true, contentType: "application/json")
            .Produces<UpdatePreferencesResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationUpdatePreferences");

        // ---- create — POST /notifications → the notificationSelect row. GRANT-GATED. ----
        app.MapPost("/notifications", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NotificationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || node is not JsonObject body
                    || ReadRequiredGuid(body, "userId") is not { } targetUserId
                    || TryBuildContent(body) is not { } content)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // organizationId: ctx.user.organizationId || null — an org-less platform owner writes a NULL org
                // stamp, which is precisely the row shape the RLS policy on this table cannot see back.
                var result = await useCase.CreateAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!),
                    new NotificationCreateInput(targetUserId, content), cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Accepts<CreateNotificationBody>("application/json")
            .Produces<NotificationRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NotificationCreate");

        // ---- bulkCreate — POST /notifications/bulk → { count }. GRANT-GATED. ----
        app.MapPost("/notifications/bulk", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NotificationWriteUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NotificationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || node is not JsonObject body
                    || ReadUserIds(body) is not { } userIds
                    || TryBuildContent(body) is not { } content)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.BulkCreateAsync(
                    NotificationReadEndpoints.OrgIdOrNull(gate.Context!), userIds, content, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Accepts<BulkCreateNotificationBody>("application/json")
            .Produces<BatchCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NotificationBulkCreate");
    }

    /// <summary>
    /// Zod parity for <c>updatePreferences</c>' input — every key <c>.optional()</c>, so an EMPTY body is
    /// valid and writes nothing but <c>updated_at</c>. The three-state distinction is the whole point:
    /// a key that is ABSENT must not be written, while <c>quietHoursStart</c>/<c>quietHoursEnd</c> sent as
    /// explicit <c>null</c> MUST write NULL (they are <c>.nullable().optional()</c>). A JSON <c>null</c> for any
    /// of the other four is a 400 — Zod's <c>.optional()</c> without <c>.nullable()</c> rejects null.
    /// </summary>
    internal static NotificationPreferencesUpdate? TryBuildPreferencesUpdate(JsonNode? node)
    {
        // ReadFromJsonAsync yields a null node for a literal "null" body; an absent body is handled by the
        // caller. Zod parses `{}` for an absent input, so both mean "no keys sent".
        if (node is null)
        {
            return new NotificationPreferencesUpdate(
                null, null, null, null, OptionalValue<string?>.Absent, OptionalValue<string?>.Absent);
        }

        if (node is not JsonObject body)
        {
            return null;
        }

        if (ReadOptionalBool(body, "emailEnabled") is not { } emailEnabled
            || ReadOptionalBool(body, "pushEnabled") is not { } pushEnabled)
        {
            return null;
        }

        if (ReadOptionalBoolRecord(body, "categories") is not { } categories
            || ReadOptionalBoolRecord(body, "modules") is not { } modules)
        {
            return null;
        }

        if (ReadNullableString(body, "quietHoursStart", MaxQuietHoursLength) is not { } quietHoursStart
            || ReadNullableString(body, "quietHoursEnd", MaxQuietHoursLength) is not { } quietHoursEnd)
        {
            return null;
        }

        return new NotificationPreferencesUpdate(
            emailEnabled.Value, pushEnabled.Value, categories.Value, modules.Value,
            quietHoursStart, quietHoursEnd);
    }

    /// <summary>The content shared by <c>create</c> and <c>bulkCreate</c> — identical Zod shapes.</summary>
    internal static NotificationCreateContent? TryBuildContent(JsonObject body)
    {
        if (ReadRequiredString(body, "type") is not { } type || !AllowedTypes.Contains(type, StringComparer.Ordinal))
        {
            return null;
        }

        // z.string().min(1).max(200)
        if (ReadRequiredString(body, "title") is not { } title || title.Length is < 1 or > MaxTitleLength)
        {
            return null;
        }

        if (ReadOptionalString(body, "message", MaxMessageLength) is not { } message
            || ReadOptionalString(body, "module", MaxModuleLength) is not { } module
            || ReadOptionalString(body, "entityType", MaxEntityTypeLength) is not { } entityType
            || ReadOptionalString(body, "actionUrl", MaxActionUrlLength) is not { } actionUrl)
        {
            return null;
        }

        if (ReadOptionalGuid(body, "entityId") is not { } entityId)
        {
            return null;
        }

        return new NotificationCreateContent(
            type, title, message.Value, module.Value, entityType.Value, entityId.Value, actionUrl.Value);
    }

    /// <summary><c>z.array(z.string().uuid()).min(1).max(500)</c> — order preserved, duplicates NOT removed.</summary>
    internal static IReadOnlyList<Guid>? ReadUserIds(JsonObject body)
    {
        if (!body.TryGetPropertyValue("userIds", out var node) || node is not JsonArray array
            || array.Count is < 1 or > MaxBulkUserIds)
        {
            return null;
        }

        var ids = new List<Guid>(array.Count);
        foreach (var element in array)
        {
            if (element is not JsonValue value || value.GetValueKind() != JsonValueKind.String
                || !value.TryGetValue<string>(out var raw) || !Guid.TryParseExact(raw, "D", out var id))
            {
                return null;
            }

            ids.Add(id);
        }

        return ids;
    }

    // ---- Zod primitive readers. Each returns null for INVALID and a wrapper for VALID-possibly-absent. ----

    private static string? ReadRequiredString(JsonObject body, string key) =>
        body.TryGetPropertyValue(key, out var node) && node is JsonValue value
        && value.GetValueKind() == JsonValueKind.String && value.TryGetValue<string>(out var text)
            ? text
            : null;

    private static Guid? ReadRequiredGuid(JsonObject body, string key) =>
        ReadRequiredString(body, key) is { } text && Guid.TryParseExact(text, "D", out var id) ? id : null;

    // z.string().max(n).optional() — absent is fine; present must be a string within bounds. Explicit null is
    // NOT accepted (no .nullable()).
    private static OptionalValue<string?>? ReadOptionalString(JsonObject body, string key, int maxLength)
    {
        if (!body.TryGetPropertyValue(key, out var node))
        {
            return OptionalValue<string?>.Absent;
        }

        return node is JsonValue value && value.GetValueKind() == JsonValueKind.String
            && value.TryGetValue<string>(out var text) && text.Length <= maxLength
                ? OptionalValue<string?>.Present(text)
                : null;
    }

    // z.string().max(10).nullable().optional() — absent OR null OR a bounded string.
    private static OptionalValue<string?>? ReadNullableString(JsonObject body, string key, int maxLength)
    {
        if (!body.TryGetPropertyValue(key, out var node))
        {
            return OptionalValue<string?>.Absent;
        }

        if (node is null || node.GetValueKind() == JsonValueKind.Null)
        {
            return OptionalValue<string?>.Present(null);
        }

        return node is JsonValue value && value.GetValueKind() == JsonValueKind.String
            && value.TryGetValue<string>(out var text) && text.Length <= maxLength
                ? OptionalValue<string?>.Present(text)
                : null;
    }

    private static OptionalValue<Guid?>? ReadOptionalGuid(JsonObject body, string key)
    {
        if (!body.TryGetPropertyValue(key, out var node))
        {
            return OptionalValue<Guid?>.Absent;
        }

        return node is JsonValue value && value.GetValueKind() == JsonValueKind.String
            && value.TryGetValue<string>(out var text) && Guid.TryParseExact(text, "D", out var id)
                ? OptionalValue<Guid?>.Present(id)
                : null;
    }

    private static OptionalValue<bool?>? ReadOptionalBool(JsonObject body, string key)
    {
        if (!body.TryGetPropertyValue(key, out var node))
        {
            return OptionalValue<bool?>.Absent;
        }

        return node is JsonValue value
            && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False
            && value.TryGetValue<bool>(out var flag)
                ? OptionalValue<bool?>.Present(flag)
                : null;
    }

    /// <summary>
    /// <c>z.record(z.boolean()).optional()</c> — an object whose EVERY value is a boolean. Returned as the raw
    /// JSON text to bind straight into the jsonb column. A nested object or a string value is a 400, which is
    /// what keeps arbitrary caller-supplied JSON out of the column.
    /// </summary>
    private static OptionalValue<string?>? ReadOptionalBoolRecord(JsonObject body, string key)
    {
        if (!body.TryGetPropertyValue(key, out var node))
        {
            return OptionalValue<string?>.Absent;
        }

        if (node is not JsonObject record)
        {
            return null;
        }

        foreach (var pair in record)
        {
            if (pair.Value is not JsonValue value
                || value.GetValueKind() is not (JsonValueKind.True or JsonValueKind.False))
            {
                return null;
            }
        }

        return OptionalValue<string?>.Present(record.ToJsonString());
    }

    // Malformed/empty JSON body → handled as "no body". ReadFromJsonAsync rejects an EMPTY body as malformed,
    // which matters here because updatePreferences' every key is optional, so an empty PATCH is legitimate.
    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(
        HttpContext httpContext, CancellationToken cancellationToken)
    {
        if (httpContext.Request.ContentLength is null or 0)
        {
            return (true, null);
        }

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

/// <summary>
/// OpenAPI request schema for <c>updatePreferences</c> (the body is hand-parsed; this shapes the contract only).
/// Init-only NON-nullable properties so nothing emits as <c>["null","string"]</c>, and no <c>[Required]</c>
/// anywhere — every key is genuinely optional, and an empty body is valid (TRAP 5).
/// </summary>
public sealed record UpdateNotificationPreferencesBody
{
    /// <summary>Enable email delivery.</summary>
    public bool EmailEnabled { get; init; }

    /// <summary>Enable push delivery.</summary>
    public bool PushEnabled { get; init; }

    /// <summary>Per-category opt-in map; every value must be a boolean.</summary>
    public Dictionary<string, bool> Categories { get; init; } = [];

    /// <summary>Per-module opt-in map; every value must be a boolean.</summary>
    public Dictionary<string, bool> Modules { get; init; } = [];

    /// <summary>Start of the quiet-hours window; may be sent as null to clear.</summary>
    [MaxLength(10)]
    public string QuietHoursStart { get; init; } = string.Empty;

    /// <summary>End of the quiet-hours window; may be sent as null to clear.</summary>
    [MaxLength(10)]
    public string QuietHoursEnd { get; init; } = string.Empty;
}

/// <summary>OpenAPI request schema for <c>create</c>.</summary>
public sealed record CreateNotificationBody
{
    /// <summary>Target user id (uuid).</summary>
    [Required]
    public string UserId { get; init; } = string.Empty;

    /// <summary>One of critical, warning, info, success.</summary>
    [Required]
    public string Type { get; init; } = string.Empty;

    /// <summary>Notification title, 1..200 characters.</summary>
    [Required, MaxLength(200)]
    public string Title { get; init; } = string.Empty;

    /// <summary>Optional body text.</summary>
    [MaxLength(1000)]
    public string Message { get; init; } = string.Empty;

    /// <summary>Optional originating module.</summary>
    [MaxLength(50)]
    public string Module { get; init; } = string.Empty;

    /// <summary>Optional related entity type.</summary>
    [MaxLength(50)]
    public string EntityType { get; init; } = string.Empty;

    /// <summary>Optional related entity id (uuid).</summary>
    public string EntityId { get; init; } = string.Empty;

    /// <summary>Optional deep link.</summary>
    [MaxLength(500)]
    public string ActionUrl { get; init; } = string.Empty;
}

/// <summary>OpenAPI request schema for <c>bulkCreate</c> — the same content, addressed to 1..500 users.</summary>
public sealed record BulkCreateNotificationBody
{
    /// <summary>Target user ids (uuid), 1..500. Duplicates are NOT removed.</summary>
    [Required]
    public IReadOnlyList<string> UserIds { get; init; } = [];

    /// <summary>One of critical, warning, info, success.</summary>
    [Required]
    public string Type { get; init; } = string.Empty;

    /// <summary>Notification title, 1..200 characters.</summary>
    [Required, MaxLength(200)]
    public string Title { get; init; } = string.Empty;

    /// <summary>Optional body text.</summary>
    [MaxLength(1000)]
    public string Message { get; init; } = string.Empty;

    /// <summary>Optional originating module.</summary>
    [MaxLength(50)]
    public string Module { get; init; } = string.Empty;

    /// <summary>Optional related entity type.</summary>
    [MaxLength(50)]
    public string EntityType { get; init; } = string.Empty;

    /// <summary>Optional related entity id (uuid).</summary>
    public string EntityId { get; init; } = string.Empty;

    /// <summary>Optional deep link.</summary>
    [MaxLength(500)]
    public string ActionUrl { get; init; } = string.Empty;
}
