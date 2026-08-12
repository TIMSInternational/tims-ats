using System.Text.Encodings.Web;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Application layer for the platform-owner organization CREATE surface (Phase-5 slice 21, issue #76) —
/// <c>createOrganization</c> (<c>routers/platform/organizations.ts:149-242</c>).
///
/// <para>Thin, like slices 19 and 20: the TS side has no service and no domain kernel, just an inline
/// <c>db.$transaction</c>. What lives here is everything PURE and therefore unit-testable without a
/// database — the Zod bounds, the derived <c>billingEmail</c>/<c>status</c>/<c>trialEndsAt</c> values, the
/// notification copy, and the exact bytes written to <c>audit_logs.changes</c>. Those are the places a port
/// silently drifts, and none of them is observable from a green <c>dotnet test</c> unless it is pulled out
/// of the repository like this.</para>
///
/// <para><b>PORTED EXACTLY, including the parts that are bad.</b> The company is named after the
/// ORGANIZATION and its country is hard-coded <c>'CO'</c>; the entitlement bundle ignores the org's plan
/// entirely; the created role gets no permissions and no member; <c>adminEmail</c> is validated as an email
/// and then used for nothing but the <c>billingEmail</c> fallback. All reproduced. Narrowing any of them
/// here would make the step-5 parity diff uninterpretable.</para>
/// </summary>
public sealed class PlatformOrganizationsCreateUseCase(
    IPlatformOrganizationsCreateRepository repository,
    TimeProvider timeProvider)
{
    /// <summary>Zod bounds from <c>organizations.ts:152-180</c>, reproduced exactly.</summary>
    public const int MinNameLength = 2;

    public const int MaxNameLength = 100;
    public const int MinSlugLength = 2;
    public const int MaxSlugLength = 50;

    /// <summary>
    /// <c>.max(254)</c> on both emails (<c>organizations.ts:179-180</c>), added with #207.
    ///
    /// <para><b>254 comes from RFC 5321 §4.5.3.1.3</b>, which caps the Path (<c>&lt;address&gt;</c>) at 256
    /// octets INCLUDING the angle brackets — so a deliverable address itself is at most 254. Not 320: that
    /// is the sum of the local-part (64) and domain (255) component maxima plus the <c>@</c>, and no
    /// standard guarantees an address of that length is deliverable.</para>
    ///
    /// <para><b>Zod's <c>.max()</c> counts UTF-16 code units and <c>string.Length</c> does the same</b>, so
    /// <c>&gt; 254</c> is exact parity rather than approximate. Moot in practice: <see cref="IsValidEmail"/>
    /// rejects every character above <c>0x7F</c> before the regex runs.</para>
    /// </summary>
    public const int MaxEmailLength = 254;

    /// <summary>
    /// The four accepted plan values.
    ///
    /// <para><b>Shared with slice 20 deliberately — one list, one drift surface — but the two TS schemas are
    /// NOT the same construct.</b> <c>updateOrganization</c> uses <c>z.nativeEnum(OrgPlan)</c>
    /// (<c>organizations.ts:249</c>), which derives its members from the Prisma enum; <c>createOrganization</c>
    /// uses a hand-written string-literal <c>z.enum(['trial','starter','professional','enterprise'])</c>
    /// (<c>:108</c>). They coincide today, so sharing is correct. What would silently desynchronise them is a
    /// rename or an addition to <c>OrgPlan</c> (<c>organization.prisma:23-28</c>): update would follow it,
    /// create would not, and this shared constant would then be wrong for one of the two callers.</para>
    /// </summary>
    public static readonly string[] Plans = PlatformOrganizationsWriteUseCase.Plans;

    /// <summary><c>trialEndsAt = Date.now() + 14 * 24 * 60 * 60 * 1000</c> (<c>organizations.ts:213</c>).</summary>
    private const int TrialDays = 14;

    private const string TrialPlan = "trial";
    private const string TrialingStatus = "trialing";
    private const string ActiveStatus = "active";

    // Notification copy, verbatim from organizations.ts:220-226 — including the unaccented "organizacion",
    // which is what the TS actually writes. "Fixing" the spelling here would be a silent content divergence
    // in a user-visible string, exactly as recorded for the suspension copy in slice 20.
    private const string CreatedTitlePrefix = "Nueva organizacion creada: ";
    private const string CreatedType = "success";
    private const string PlatformModule = "platform";
    private const string OrganizationsActionUrl = "/platform/organizations";

    /// <summary>
    /// The slug pattern as the TS writes it (<c>organizations.ts:153-157</c>), for the OpenAPI contract ONLY —
    /// <see cref="PlatformOrganizationsCreateEndpoints.CreateOrganizationBody.Slug"/> emits it as the
    /// schema's <c>pattern</c>, and OpenAPI patterns are ECMA-262, so the JS anchors are the correct form
    /// there. <see cref="SlugRegex"/> below is what actually VALIDATES, with .NET anchors. The two are kept
    /// adjacent so a change to one is visibly a change to the other.
    /// </summary>
    public const string SlugPattern = "^[a-z0-9-]+$";

    /// <summary>
    /// <c>^[a-z0-9-]+$</c> (<c>organizations.ts:153-157</c>), anchored with <c>\A</c>/<c>\z</c> rather than
    /// <c>^</c>/<c>$</c>. That is not a stylistic choice: .NET's <c>$</c> also matches BEFORE a trailing
    /// newline, so <c>"acme\n"</c> would pass here and fail in JS, where <c>$</c> without the <c>m</c> flag
    /// matches only at end of input. Same reasoning applies to the email pattern below.
    /// </summary>
    private static readonly Regex SlugRegex =
        new(@"\A[a-z0-9-]+\z", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// <b>Copied verbatim from the INSTALLED Zod source</b> —
    /// <c>node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js:384</c>, the live
    /// <c>emailRegex</c> behind <c>z.string().email()</c> (<c>packages/api</c> pins <c>zod ^3.25.0</c>,
    /// resolved to 3.25.76). Not <c>MailAddress</c>, not <c>EmailAddressAttribute</c>, not an invented
    /// pattern: those disagree with Zod on real inputs (<c>a@b</c>, <c>a@b.</c>, quoted local parts,
    /// IP-literal domains) and the disagreement would be invisible until a customer hit it.
    ///
    /// <para>The JS literal is
    /// <c>/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i</c>. Two
    /// deliberate translation adjustments, both to REMOVE .NET-only behaviour rather than add any:
    /// <c>\A</c>/<c>\z</c> for the anchors (see <see cref="SlugRegex"/>), and the ASCII pre-check in
    /// <see cref="IsValidEmail"/> — every character class in the pattern is ASCII-only, and JS's non-unicode
    /// <c>i</c> canonicalization never folds a non-ASCII character INTO an ASCII one, so JS rejects every
    /// non-ASCII input outright. .NET's <c>IgnoreCase</c> does fold U+212A (KELVIN SIGN) to <c>k</c> and
    /// U+017F (LATIN SMALL LETTER LONG S) to <c>s</c>, which would have accepted two inputs Zod rejects.</para>
    /// </summary>
    private static readonly Regex EmailRegex = new(
        @"\A(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}\z",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>
    /// <c>JSON.stringify</c>-equivalent encoding, copied from
    /// <c>PlatformOrganizationsWriteUseCase</c>. The .NET DEFAULT encoder escapes <c>&amp;</c>, <c>&lt;</c>,
    /// <c>&gt;</c>, <c>'</c>, <c>+</c> and every non-ASCII character as <c>\uXXXX</c>; <c>JSON.stringify</c>
    /// escapes none of them. Organization names on this platform are Spanish, so the default encoder would
    /// turn <c>"Fundación"</c> into <c>"Fundación"</c> and every audit row would differ from the TS
    /// bytes — and those bytes survive into the column verbatim, because <c>changes</c> is a jsonb STRING
    /// SCALAR (see <see cref="BuildCreateChangesJson"/>).
    /// </summary>
    private static readonly System.Text.Json.JsonSerializerOptions ChangesEncoding =
        new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>
    /// <c>createOrganization</c>. Re-checks <see cref="IsValidCreateInput"/> rather than trusting the caller,
    /// for the same reason slice 20 does: the endpoint validates so it can return the 400 tRPC would, but a
    /// second caller (a worker, or #75's invitation flow) must not be able to bypass the Zod bounds by
    /// reaching this class directly. Throwing is right for that caller and unreachable for the endpoint,
    /// which has already returned 400.
    ///
    /// <para><b>The notification await is UNCAUGHT, and that is the point.</b>
    /// <c>organizations.ts:220</c> is <c>await notify({ ... })</c> with no <c>try</c> and no <c>.catch</c>,
    /// so a fan-out failure returns 500 to the operator AFTER the whole seven-table transaction has
    /// committed. Issue #76's correction is confirmed against source: it is NOT best-effort. Do NOT wrap
    /// this in try/catch — the 500-after-commit is parity, and an operator who retries will then hit the
    /// duplicate-slug path.</para>
    ///
    /// <para><b>One divergence follows from making the audit transactional</b>, and it is observable on
    /// exactly this path. In TS the audit write is the statement AFTER <c>notify</c>, so a notify failure
    /// leaves the organization committed with NO <c>org_created</c> audit row. Here the audit row is already
    /// committed (it is inside the creation transaction). Both stacks fail the request; they differ in what
    /// is left behind. Same shape as the divergence slice 20 records for <c>suspendOrganization</c>.</para>
    /// </summary>
    /// <exception cref="ArgumentException">The input violates a Zod bound.</exception>
    public async Task<CreateOrganizationResult> CreateAsync(
        PlatformOrganizationCreateInput input,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        if (!IsValidCreateInput(input))
        {
            throw new ArgumentException("create input violates the organizations.ts Zod bounds", nameof(input));
        }

        var result = await repository.CreateAsync(
            input,
            BuildCreateChangesJson(input),
            actorId,
            timeProvider.GetUtcNow().UtcDateTime,
            cancellationToken).ConfigureAwait(false);

        if (result.Outcome != CreateOrganizationOutcome.Created)
        {
            return result;
        }

        // organizations.ts:220 — awaited, UNCAUGHT. Unconditional, unlike suspendOrganization's
        // `if (suspend)` branch. Interpolates the DB-returned name (`org.name`, :151), not the input.
        await repository.NotifyPlatformOwnersAsync(BuildCreatedNotification(result.Row!), cancellationToken)
            .ConfigureAwait(false);

        return result;
    }

    /// <summary>
    /// Builds the exact value TS writes to <c>audit_logs.changes</c> (<c>organizations.ts:236</c>):
    /// <c>JSON.stringify({ name: input.name, slug: input.slug, plan: input.plan })</c>.
    ///
    /// <para><b>It is a hard-coded object literal, not the Zod parse output</b> — which is why the "key
    /// order follows Zod's declaration order" reasoning that governs <c>BuildUpdateChangesJson</c>
    /// (<c>:184</c> <c>const { id, ...rest }</c> → <c>:205</c> <c>JSON.stringify(rest)</c>) does NOT apply
    /// here. The order is fixed by the literal: <c>name</c>, <c>slug</c>, <c>plan</c>. It coincides with the
    /// schema order for those three fields, but do not rely on that reasoning.</para>
    ///
    /// <para><b><c>adminEmail</c> and <c>billingEmail</c> are ABSENT</b> from the payload, and all three
    /// present keys are unconditional (all three are required in Zod). Unlike the update payload there are
    /// no conditionals and no <c>{}</c> case.</para>
    ///
    /// <para><b>Why the bytes matter and are not normalized away.</b> <c>audit_logs.changes</c> is a Prisma
    /// <c>Json?</c> field being handed a JS STRING, so the stored jsonb is a string SCALAR whose content is
    /// the JSON text (<c>jsonb_typeof = 'string'</c>). jsonb re-orders and re-spaces object keys; it
    /// preserves a string scalar verbatim. So key order, spacing and escaping are all part of the stored
    /// value, and a parity diff would catch any of them.</para>
    /// </summary>
    public static string BuildCreateChangesJson(PlatformOrganizationCreateInput input)
    {
        var changes = new JsonObject
        {
            ["name"] = JsonValue.Create(input.Name),
            ["slug"] = JsonValue.Create(input.Slug),
            ["plan"] = JsonValue.Create(input.Plan),
        };

        return changes.ToJsonString(ChangesEncoding);
    }

    /// <summary>The <c>notify()</c> payload for a creation (<c>organizations.ts:220-226</c>).</summary>
    public static PlatformOwnerNotification BuildCreatedNotification(PlatformOrganizationRow row) =>
        new(
            Guid.Parse(row.Id),
            CreatedType,
            CreatedTitlePrefix + row.Name,
            Message: null,
            Module: PlatformModule,
            EntityType: null,
            EntityId: null,
            ActionUrl: OrganizationsActionUrl);

    /// <summary>
    /// The Zod bounds of <c>createOrganization</c> (<c>organizations.ts:150-182</c>). The ENDPOINT calls this
    /// and returns 400 on false — tRPC throws BAD_REQUEST rather than clamping, so rejecting is the parity
    /// behaviour.
    ///
    /// <para><b>Both emails ARE bounded, as of #207 (2026-08-11).</b> They previously were not — Zod bounded
    /// neither, and this port reproduced that faithfully rather than tightening during a migration. The fix
    /// landed in BOTH stacks in one change (<c>organizations.ts:179-180</c> gained <c>.max(254)</c>) so the
    /// two stay in parity; see <see cref="MaxEmailLength"/> for the RFC 5321 derivation. An earlier version
    /// of this paragraph described the absence of the bound as deliberate, and is now false.</para>
    /// </summary>
    public static bool IsValidCreateInput(PlatformOrganizationCreateInput input)
    {
        if (input.Name.Length is < MinNameLength or > MaxNameLength)
        {
            return false;
        }

        if (input.Slug.Length is < MinSlugLength or > MaxSlugLength || !SlugRegex.IsMatch(input.Slug))
        {
            return false;
        }

        if (!Plans.Contains(input.Plan))
        {
            return false;
        }

        if (!IsValidEmail(input.AdminEmail))
        {
            return false;
        }

        // `.optional()` — absent is fine, but a PRESENT value must still be a valid email (including the
        // empty string, which `.email()` rejects).
        return input.BillingEmail is null || IsValidEmail(input.BillingEmail);
    }

    /// <summary>
    /// <c>z.string().email().max(254)</c> as Zod 3.25.76 actually implements it. See
    /// <see cref="EmailRegex"/> for the provenance of the pattern and for why non-ASCII is rejected before
    /// it runs, and <see cref="MaxEmailLength"/> for where 254 comes from.
    ///
    /// <para><b>The bound lives HERE rather than at the two call sites in
    /// <see cref="IsValidCreateInput"/></b> so it cannot be half-applied — <c>adminEmail</c> and
    /// <c>billingEmail</c> are bounded identically in Zod, and one edit covers both. It is also the layer
    /// that actually RUNS: <c>CreateOrganizationBody</c>'s <c>[MaxLength]</c> is never bound and never
    /// validates anything (see that type's remarks); it only fixes the published contract.</para>
    /// </summary>
    public static bool IsValidEmail(string value)
    {
        // `.max()` counts UTF-16 code units, which is exactly what string.Length returns.
        if (value.Length > MaxEmailLength)
        {
            return false;
        }

        foreach (var c in value)
        {
            if (c > 0x7F)
            {
                return false;
            }
        }

        return EmailRegex.IsMatch(value);
    }

    /// <summary>
    /// <c>billingEmail: input.billingEmail || input.adminEmail</c> (<c>organizations.ts:190</c>).
    ///
    /// <para>JS <c>||</c>, not <c>??</c>: an EMPTY STRING also falls through to <c>adminEmail</c>. Zod's
    /// <c>.email()</c> already rejects <c>''</c> so the two are behaviourally equivalent behind the
    /// endpoint, but the equivalence is reproduced rather than assumed — a future relaxation of the input
    /// schema would make it matter, and a <c>??</c> here would then be a silent divergence.</para>
    /// </summary>
    public static string ResolveBillingEmail(PlatformOrganizationCreateInput input) =>
        string.IsNullOrEmpty(input.BillingEmail) ? input.AdminEmail : input.BillingEmail;

    /// <summary><c>status: input.plan === 'trial' ? 'trialing' : 'active'</c> (<c>organizations.ts:212</c>).</summary>
    public static string ResolveSubscriptionStatus(string plan) => plan == TrialPlan ? TrialingStatus : ActiveStatus;

    /// <summary>
    /// <c>trialEndsAt: input.plan === 'trial' ? new Date(Date.now() + 14d) : null</c>
    /// (<c>organizations.ts:213</c>).
    ///
    /// <para>Uses the transaction's single <paramref name="now"/> rather than a second clock read. TS reads
    /// <c>Date.now()</c> here, a few statements after the row timestamps it derives elsewhere; collapsing
    /// that sub-millisecond skew is deliberate and unobservable.</para>
    /// </summary>
    public static DateTime? ResolveTrialEndsAt(string plan, DateTime now) =>
        plan == TrialPlan ? now.AddDays(TrialDays) : null;
}
