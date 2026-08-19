using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.Notification;

namespace Tims.Api.Notification;

/// <summary>
/// The notification READ endpoints (Phase-5 Slice 25) — the C# port of the three read procedures of the TS
/// <c>notification</c> router: <c>list</c>, <c>unreadCount</c> and <c>getPreferences</c>. All three are bare
/// <c>protectedProcedure</c>, so they authorize through the shared <see cref="SelfServiceGate"/>: identity is
/// the whole boundary, there is NO grant check, and every query hard-filters on the caller's own user id. There
/// is deliberately no id parameter for the subject — it is always the caller, so no IDOR probe applies.
/// Dark-by-default behind <see cref="PlatformOptions.NotificationReadEnabled"/>.
/// </summary>
public static class NotificationReadEndpoints
{
    private const int DefaultLimit = 20;
    private const int MinLimit = 1;
    private const int MaxLimit = 50;

    public static void MapNotificationReadEndpoints(this WebApplication app)
    {
        // 1. list — GET /notifications?cursor&limit&unreadOnly. Gate → input parse → page.
        app.MapGet("/notifications", async (
                [FromQuery(Name = "cursor")] string? cursor,
                [FromQuery(Name = "limit")] string? limit,
                [FromQuery(Name = "unreadOnly")] string? unreadOnly,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (TryParseListInput(cursor, limit, unreadOnly) is not { } input)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.ListAsync(
                    OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), input.Limit, input.Cursor,
                    input.UnreadOnly, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<NotificationListResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationList");

        // 2. unreadCount — GET /notifications/unread-count. Gate only; no input.
        app.MapGet("/notifications/unread-count", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.UnreadCountAsync(
                    OrgIdOrNull(gate.Context!), Guid.Parse(gate.Context!.UserId), cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<UnreadCountResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationUnreadCount");

        // 3. getPreferences — GET /notifications/preferences. ⚠️ A read that WRITES: on a miss it creates the
        //    caller's preference row with database defaults, exactly as the TS query does. It therefore sits
        //    under the READ flag while performing an INSERT — see NotificationReadUseCase.
        app.MapGet("/notifications/preferences", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                NotificationReadUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // An org-less platform owner CANNOT have a notification_preferences row: that table's policy is
                // an EXISTS-through-users on the caller's organization_id and it carries a WITH CHECK, so the
                // lazy INSERT does not silently filter — Postgres RAISES and the request 500s (measured, not
                // reasoned). Fail closed with the same 400 NotificationStaffGate returns for a privileged
                // org-less principal, rather than letting an RLS violation escape as an unhandled exception.
                if (OrgIdOrNull(gate.Context!) is not { } preferencesOrgId)
                {
                    return Results.BadRequest(new { error = "organization_required" });
                }

                var result = await useCase.GetPreferencesAsync(
                    preferencesOrgId, Guid.Parse(gate.Context!.UserId),
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<NotificationPreferencesRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("NotificationGetPreferences");
    }

    /// <summary>
    /// The caller's organization id as a <see cref="Guid"/>, or <see langword="null"/> when they are an org-less
    /// platform owner — <c>TenantContext.OrganizationId</c> is the EMPTY STRING for that principal, and a plain
    /// <c>Guid.Parse</c> would throw a 500 on the one class of user this surface most exists for (the two
    /// <c>notify()</c> call sites target platform owners). A null org makes
    /// <c>TenantScope</c> set the RLS GUC to '' and the fail-closed policy hides every row, so an org-less owner
    /// sees an empty inbox rather than an error. That is a DIVERGENCE from TS, which reads the same rows through
    /// a BYPASSRLS connection and shows them — it is deliberate and recorded in the slice doc's divergence
    /// register.
    ///
    /// <para>⚠️ <b>The empty-inbox guarantee holds for the READS ONLY</b> (<c>list</c>, <c>unreadCount</c>), and
    /// an earlier version of this comment overstated it as a property of the whole surface. The two PREFERENCES
    /// endpoints WRITE, and <c>notification_preferences</c>' policy carries a <c>WITH CHECK</c>, so an org-less
    /// caller's INSERT is REJECTED rather than filtered and the request 500s. Both of those endpoints therefore
    /// refuse an org-less caller with 400 <c>organization_required</c> before touching the database. Pinned by
    /// <c>List_OrgLessPlatformOwner_SeesEmptyInbox_NotAnError</c> AND
    /// <c>Preferences_OrgLessPlatformOwner_Is400_NotAn500</c> — the pair is the point, since either alone
    /// states a rule the surface does not follow.</para>
    /// </summary>
    internal static Guid? OrgIdOrNull(Tims.Domain.Identity.TenantContext context) =>
        Guid.TryParse(context.OrganizationId, out var organizationId) ? organizationId : null;

    /// <summary>
    /// Zod parity for <c>list</c>'s input, parsed AFTER the gate (TRAP 9 — minimal-API binding runs before the
    /// handler body, so a typed <c>int?</c>/<c>bool?</c>/<c>Guid?</c> signature would 400 an unauthenticated
    /// caller before <see cref="SelfServiceGate"/> ever ran, inverting tRPC's middleware-before-Zod order).
    ///   <c>cursor</c>: <c>z.string().uuid().optional()</c> · <c>limit</c>:
    ///   <c>z.number().int().min(1).max(50).default(20)</c> · <c>unreadOnly</c>: <c>z.boolean().default(false)</c>.
    /// An absent OR empty query value takes the default; a present-but-invalid one is a 400.
    /// </summary>
    internal static ListInput? TryParseListInput(string? cursor, string? limit, string? unreadOnly)
    {
        Guid? parsedCursor = null;
        if (!string.IsNullOrEmpty(cursor))
        {
            if (!Guid.TryParseExact(cursor, "D", out var cursorId))
            {
                return null;
            }

            parsedCursor = cursorId;
        }

        var parsedLimit = DefaultLimit;
        if (!string.IsNullOrEmpty(limit))
        {
            // z.number().int() — an integer literal only. "1.5"/"1e2"/" 1" must all fail, so NumberStyles.None
            // (no sign, no decimal point, no exponent, no whitespace) is the exact match.
            if (!int.TryParse(limit, NumberStyles.None, CultureInfo.InvariantCulture, out parsedLimit)
                || parsedLimit is < MinLimit or > MaxLimit)
            {
                return null;
            }
        }

        var parsedUnreadOnly = false;
        if (!string.IsNullOrEmpty(unreadOnly))
        {
            if (!bool.TryParse(unreadOnly, out parsedUnreadOnly))
            {
                return null;
            }
        }

        return new ListInput(parsedCursor, parsedLimit, parsedUnreadOnly);
    }

    /// <summary>The validated <c>list</c> input.</summary>
    internal readonly record struct ListInput(Guid? Cursor, int Limit, bool UnreadOnly);
}
