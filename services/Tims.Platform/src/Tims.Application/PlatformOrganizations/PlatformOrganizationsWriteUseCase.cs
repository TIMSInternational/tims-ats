using System.Text.Encodings.Web;
using System.Text.Json.Nodes;

namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Application layer for the platform-owner organizations WRITE surface (Phase-5 slice 20, issue #76) —
/// <c>updateOrganization</c> and <c>suspendOrganization</c>.
///
/// <para>Thin, like the read use case: the TS side has no service or domain kernel, just two inline
/// Prisma mutations. What DOES live here is everything that is pure and therefore unit-testable without a
/// database — the Zod bounds, and the exact bytes written to <c>audit_logs.changes</c>. Both are places a
/// port silently drifts, and neither is observable from a green <c>dotnet test</c> unless it is pulled
/// out of the repository like this.</para>
/// </summary>
public sealed class PlatformOrganizationsWriteUseCase(
    IPlatformOrganizationsWriteRepository repository,
    TimeProvider timeProvider)
{
    /// <summary>Zod bounds from <c>organizations.ts:244-258</c>, reproduced exactly.</summary>
    public const int MaxNameLength = 100;

    public const int MaxLocaleLength = 10;
    public const int MaxTimezoneLength = 50;
    public const int MaxCurrencyLength = 10;

    /// <summary>The four <c>OrgPlan</c> enum members (<c>organization.prisma:23-28</c>).</summary>
    public static readonly string[] Plans = ["trial", "starter", "professional", "enterprise"];

    // Notification copy, verbatim from organizations.ts:300-306 — including the unaccented "Organizacion",
    // which is what the TS actually writes. "Fixing" the spelling here would be a silent content divergence
    // in a user-visible string.
    private const string SuspendedTitlePrefix = "Organizacion suspendida: ";
    private const string SuspendedType = "warning";
    private const string PlatformModule = "platform";
    private const string OrganizationsActionUrl = "/platform/organizations";

    /// <summary>
    /// <c>JSON.stringify</c>-equivalent encoding. The .NET DEFAULT encoder escapes <c>&amp;</c>,
    /// <c>&lt;</c>, <c>&gt;</c>, <c>'</c>, <c>+</c> and every non-ASCII character as <c>\uXXXX</c>;
    /// <c>JSON.stringify</c> escapes none of them. Organization names on this platform are Spanish, so the default encoder would turn
    /// <c>"Fundación"</c> into <c>"Fundación"</c> and every audit row would differ from the TS bytes.
    /// This matters more than it looks — see <see cref="BuildUpdateChangesJson"/> on why the bytes survive
    /// into the column verbatim instead of being normalized away by jsonb.
    /// </summary>
    private static readonly System.Text.Json.JsonSerializerOptions ChangesEncoding =
        new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>
    /// <c>updateOrganization</c>. Re-checks <see cref="IsValidUpdateInput"/> rather than trusting the
    /// caller: the endpoint validates so it can return the 400 tRPC would, but leaving the bound as the
    /// ENDPOINT's private business would make this class's own docblock ("the Zod bounds live here") false
    /// the moment a second caller appears — slice 21 provisioning, or a worker. Throwing is right for that
    /// caller and unreachable for the endpoint, which has already returned 400.
    /// </summary>
    /// <exception cref="ArgumentException">The input violates a Zod bound.</exception>
    public async Task<PlatformOrganizationRow?> UpdateAsync(
        Guid id,
        PlatformOrganizationUpdateInput input,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        if (!IsValidUpdateInput(input))
        {
            throw new ArgumentException("update input violates the organizations.ts Zod bounds", nameof(input));
        }

        return await repository.UpdateAsync(
            id,
            input,
            BuildUpdateChangesJson(input),
            actorId,
            timeProvider.GetUtcNow().UtcDateTime,
            cancellationToken);
    }

    /// <summary>
    /// <c>suspendOrganization</c>. The notification fan-out runs only when SUSPENDING
    /// (<c>organizations.ts:299</c>) and only AFTER the update+audit transaction has committed — see
    /// <see cref="IPlatformOrganizationsWriteRepository.NotifyPlatformOwnersAsync"/> for why it must not
    /// join that transaction.
    ///
    /// <para><b>One ordering divergence, forced by the fail-closed decision.</b> TS runs
    /// update → notify → audit; here it is update+audit → notify, because the audit row can only be
    /// transactional if it is written before the commit.
    ///
    /// <b>It IS observable, on exactly one path.</b> An earlier draft of this comment claimed the two
    /// inserts were independent so the order could not matter. They are not independent, because the
    /// middle step can throw: when <c>notify</c> fails, TS never reaches its audit write and leaves NO
    /// audit row, while this port has already committed one. Both still fail the request. That is a
    /// second divergence created by making the audit transactional — benign, but real, and recorded
    /// here rather than left to surface as a parity surprise.</para>
    /// </summary>
    public async Task<PlatformOrganizationRow?> SuspendAsync(
        Guid id,
        bool suspend,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        var row = await repository.SuspendAsync(id, suspend, actorId, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
        if (row is null)
        {
            return null;
        }

        if (suspend)
        {
            await repository.NotifyPlatformOwnersAsync(BuildSuspensionNotification(row), cancellationToken);
        }

        return row;
    }

    /// <summary>The <c>notify()</c> payload for a suspension (<c>organizations.ts:301-306</c>).</summary>
    public static PlatformOwnerNotification BuildSuspensionNotification(PlatformOrganizationRow row) =>
        new(
            Guid.Parse(row.Id),
            SuspendedType,
            SuspendedTitlePrefix + row.Name,
            Message: null,
            Module: PlatformModule,
            EntityType: null,
            EntityId: null,
            ActionUrl: OrganizationsActionUrl);

    /// <summary>
    /// Builds the exact value TS writes to <c>audit_logs.changes</c>:
    /// <c>JSON.stringify(rest)</c>, where <c>rest</c> is the Zod-parsed input MINUS <c>id</c>
    /// (<c>organizations.ts:283</c>).
    ///
    /// <para><b>Why the bytes matter, and are not normalized away.</b> <c>changes</c> is a Prisma
    /// <c>Json?</c> field being handed a STRING, so the stored jsonb is a string SCALAR whose content is
    /// the JSON text — not a jsonb object. Measured against a real Postgres 16 through Prisma 6:
    /// <c>changes: JSON.stringify({name:'N',isActive:true})</c> stores
    /// <c>"{\"name\":\"N\",\"isActive\":true}"</c> with <c>jsonb_typeof = 'string'</c>, while passing the
    /// object stores <c>{"name": "N", "isActive": true}</c> with <c>jsonb_typeof = 'object'</c>. jsonb
    /// re-orders and re-spaces object keys; it preserves a string scalar verbatim. So key ORDER, spacing
    /// and escaping are all part of the stored value here and a parity diff would catch any of them.</para>
    ///
    /// <para><b>Key order is Zod's, not the caller's.</b> <c>ZodObject</c> rebuilds the parsed object by
    /// iterating its own <c>shape</c>, so the order is always the schema's declaration order
    /// (name, plan, isActive, settings — and locale, timezone, currency within settings) regardless of the
    /// order the client sent them in. Verified by parsing <c>{"settings":{"currency":..,"locale":..},
    /// "isActive":..}</c> against the real schema, which yields
    /// <c>{"isActive":true,"settings":{"locale":..,"currency":..}}</c>.</para>
    ///
    /// <para>Absent fields are omitted entirely: Zod does not add a key for an omitted <c>.optional()</c>,
    /// and <c>JSON.stringify</c> drops <c>undefined</c>. An input carrying only <c>id</c> therefore yields
    /// <c>{}</c> — TS still issues the UPDATE (bumping <c>updated_at</c> via <c>@updatedAt</c>) and still
    /// writes the audit row, so this port does too.</para>
    /// </summary>
    public static string BuildUpdateChangesJson(PlatformOrganizationUpdateInput input)
    {
        var changes = new JsonObject();

        if (input.Name is not null)
        {
            changes["name"] = JsonValue.Create(input.Name);
        }

        if (input.Plan is not null)
        {
            changes["plan"] = JsonValue.Create(input.Plan);
        }

        if (input.IsActive is not null)
        {
            changes["isActive"] = JsonValue.Create(input.IsActive.Value);
        }

        if (input.Settings is not null)
        {
            changes["settings"] = BuildSettingsJson(input.Settings);
        }

        return changes.ToJsonString(ChangesEncoding);
    }

    /// <summary>
    /// The <c>settings</c> jsonb value Prisma writes to the COLUMN — <c>null</c> when the key was absent,
    /// otherwise the object of present members. Prisma REPLACES a <c>Json</c> column, it does not merge, so
    /// sending <c>settings: { locale }</c> drops any <c>timezone</c>/<c>currency</c> the org already had.
    /// That is destructive and surprising, and it is faithfully reproduced: narrowing it here would make a
    /// step-5 parity diff unreadable. Filed as <b>#201</b> instead — to be done after step 5, together with
    /// the FE.
    /// </summary>
    public static string? BuildSettingsColumnJson(PlatformOrganizationSettingsInput? settings) =>
        settings is null ? null : BuildSettingsJson(settings).ToJsonString(ChangesEncoding);

    private static JsonObject BuildSettingsJson(PlatformOrganizationSettingsInput settings)
    {
        var node = new JsonObject();

        if (settings.Locale is not null)
        {
            node["locale"] = JsonValue.Create(settings.Locale);
        }

        if (settings.Timezone is not null)
        {
            node["timezone"] = JsonValue.Create(settings.Timezone);
        }

        if (settings.Currency is not null)
        {
            node["currency"] = JsonValue.Create(settings.Currency);
        }

        return node;
    }

    /// <summary>
    /// The Zod bounds of <c>updateOrganization</c>. The ENDPOINT calls this and returns 400 on false —
    /// tRPC throws BAD_REQUEST rather than clamping, so rejecting is the parity behaviour.
    /// </summary>
    public static bool IsValidUpdateInput(PlatformOrganizationUpdateInput input)
    {
        if (input.Name is { Length: > MaxNameLength })
        {
            return false;
        }

        if (input.Plan is not null && !Plans.Contains(input.Plan))
        {
            return false;
        }

        return input.Settings is null || IsValidSettings(input.Settings);
    }

    /// <summary>Per-member bounds of the <c>settings</c> sub-object (<c>organizations.ts:251-257</c>).</summary>
    public static bool IsValidSettings(PlatformOrganizationSettingsInput settings) =>
        settings.Locale is not { Length: > MaxLocaleLength }
        && settings.Timezone is not { Length: > MaxTimezoneLength }
        && settings.Currency is not { Length: > MaxCurrencyLength };
}
