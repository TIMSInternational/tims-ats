using System.Globalization;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// <c>getAttentionItems</c> (Phase-5 slice 23 / issue #81, PR 2 of 3) — five capped cross-org reads
/// merged into one severity-ordered worklist. The shaping is a genuine kernel: TS keeps it in a pure
/// helper (<c>dashboard.helpers.ts</c> <c>buildAttentionItems</c>) precisely so it can be reasoned about
/// without a database, and <see cref="BuildAttentionItems"/> is the same function.
/// </summary>
public sealed class PlatformDashboardAttentionUseCase(IPlatformDashboardAttentionRepository repository)
{
    /// <summary>Every one of the five source queries carries <c>take: 20</c>. The MERGED list is NOT
    /// capped — unlike <c>getRecentActivity</c>, there is no final slice, so up to 100 items can be
    /// returned.</summary>
    public const int SourceTake = 20;

    public async Task<IReadOnlyList<AttentionItem>> GetAttentionItemsAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        // `new Date(now.getTime() ± n * 24 * 60 * 60 * 1000)` — exact millisecond arithmetic, which
        // AddDays reproduces exactly (it is defined as whole days of 86_400_000 ms; no calendar or DST
        // adjustment is involved for a UTC instant).
        var sevenDaysFromNow = nowUtc.AddDays(7);
        var fiveDaysAgo = nowUtc.AddDays(-5);

        var overdueInvoices = await repository.GetOverdueInvoicesAsync(nowUtc, SourceTake, cancellationToken).ConfigureAwait(false);
        var expiringTrials = await repository.GetExpiringTrialsAsync(nowUtc, sevenDaysFromNow, SourceTake, cancellationToken).ConfigureAwait(false);
        var pastDueSubs = await repository.GetPastDueSubscriptionsAsync(SourceTake, cancellationToken).ConfigureAwait(false);
        var staleInvitations = await repository.GetStaleInvitationsAsync(fiveDaysAgo, SourceTake, cancellationToken).ConfigureAwait(false);
        var suspendedOrgs = await repository.GetSuspendedOrganizationsAsync(SourceTake, cancellationToken).ConfigureAwait(false);

        return BuildAttentionItems(nowUtc, overdueInvoices, expiringTrials, pastDueSubs, staleInvitations, suspendedOrgs);
    }

    /// <summary>
    /// The port of <c>buildAttentionItems</c>. Pure: no I/O, no clock — <paramref name="nowUtc"/> is the
    /// single instant the caller captured, exactly as TS passes its own <c>now</c> in.
    ///
    /// <para><b>Every string below is PAYLOAD.</b> The titles and descriptions are Spanish user-facing
    /// text that ships inside the JSON response, so a "harmless" wording or accent fix is a parity FAIL.
    /// They are reproduced byte-for-byte, un-accented exactly where TS is un-accented
    /// (<c>organizacion</c>, <c>Invitacion</c>, <c>dias</c>, <c>Suscripcion</c>, <c>periodo</c>).</para>
    ///
    /// <para><b>The append order is load-bearing.</b> Sources are appended overdue → trials → past-due →
    /// invitations → suspended, then sorted by (severity, urgency) with a STABLE sort in both stacks
    /// (<c>Array.prototype.sort</c> has been stable since ES2019; LINQ <c>OrderBy</c>/<c>ThenBy</c> always
    /// were). Items tying on both keys therefore keep source order, and reordering these five calls would
    /// change the output.</para>
    /// </summary>
    public static IReadOnlyList<AttentionItem> BuildAttentionItems(
        DateTime nowUtc,
        IReadOnlyList<OverdueInvoiceRow> overdueInvoices,
        IReadOnlyList<ExpiringTrialRow> expiringTrials,
        IReadOnlyList<PastDueSubscriptionRow> pastDueSubs,
        IReadOnlyList<StaleInvitationRow> staleInvitations,
        IReadOnlyList<SuspendedOrgRow> suspendedOrgs)
    {
        var items = new List<AttentionItem>();

        foreach (var inv in overdueInvoices)
        {
            // `inv.dueDate ? Math.floor(...) : 0`. due_date is nullable in the schema even though the
            // query filters `dueDate < now`, so the guard is reproduced rather than assumed away.
            var daysPastDue = inv.DueDate is { } dueDate ? WholeDaysBetween(nowUtc, dueDate) : 0;

            items.Add(new AttentionItem(
                inv.Id,
                "overdue_invoice",
                "critical",
                $"Factura vencida - {inv.OrgName}",
                // `$${inv.amount.toLocaleString()} ${inv.currency} vencida hace ${daysPastDue} dias` —
                // a LOCALE-FORMATTED number baked into the payload. See JsToLocaleString.
                $"${PlatformDashboardReadUseCase.JsToLocaleString(inv.Amount)} {inv.Currency} vencida hace {daysPastDue} dias",
                inv.OrgId,
                inv.OrgName,
                $"/platform/invoices?org={inv.OrgId}",
                "Ver factura",
                inv.Amount,
                inv.Currency,
                // Negated: an invoice 3 days overdue sorts ahead of a trial expiring in 3 days.
                -daysPastDue));
        }

        foreach (var sub in expiringTrials)
        {
            // Math.ceil, not floor — a trial ending in 12 hours reads "expira en 1 dia", not "0 dias".
            var daysLeft = sub.TrialEndsAt is { } trialEndsAt
                ? (int)Math.Ceiling((trialEndsAt - nowUtc).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay)
                : 0;

            items.Add(new AttentionItem(
                sub.Id,
                "expiring_trial",
                "warning",
                $"Trial expira pronto - {sub.OrgName}",
                // `dia${daysLeft !== 1 ? 's' : ''}` — singular ONLY at exactly 1, so 0 and -1 both
                // pluralise, matching the TS condition rather than a "natural" `> 1`.
                $"El periodo de prueba expira en {daysLeft.ToString(CultureInfo.InvariantCulture)} dia{(daysLeft != 1 ? "s" : string.Empty)}",
                sub.OrgId,
                sub.OrgName,
                $"/platform/organizations/{sub.OrgId}",
                "Gestionar",
                null,
                null,
                daysLeft));
        }

        foreach (var sub in pastDueSubs)
        {
            var price = PlanPrices.For(sub.Plan);

            items.Add(new AttentionItem(
                sub.Id,
                "failed_payment",
                "critical",
                $"Pago fallido - {sub.OrgName}",
                // `($${price}/mes)` — a bare number interpolation, NOT toLocaleString: no grouping
                // separator even at 2499. The two number formats sit four lines apart in the TS helper.
                $"Suscripcion {sub.Plan} con pago pendiente (${price.ToString(CultureInfo.InvariantCulture)}/mes)",
                sub.OrgId,
                sub.OrgName,
                $"/platform/subscriptions?org={sub.OrgId}",
                "Resolver pago",
                price,
                // Hard-coded 'USD' in TS — the plan price is a USD constant, not the org's billing
                // currency, and this is the one item type whose currency is not read from a row.
                "USD",
                null));
        }

        foreach (var invitation in staleInvitations)
        {
            var daysSinceSent = WholeDaysBetween(nowUtc, invitation.CreatedAt);
            var forOrg = invitation.OrgName is null ? string.Empty : $" para {invitation.OrgName}";

            items.Add(new AttentionItem(
                invitation.Id,
                "pending_invitation",
                "info",
                $"Invitacion sin aceptar - {invitation.Email}",
                $"Enviada hace {daysSinceSent} dias{forOrg}",
                // The ONLY nulls that reach the wire: `orgId: inv.organization?.id` is a written key with
                // an undefined value when the invitation has no organization, and superjson renders that
                // as null. See AttentionItemJsonConverter.
                invitation.OrgId,
                invitation.OrgName,
                "/platform/invitations",
                "Reenviar",
                null,
                null,
                null));
        }

        foreach (var org in suspendedOrgs)
        {
            items.Add(new AttentionItem(
                org.Id,
                "suspended_org",
                "warning",
                $"Organizacion suspendida - {org.Name}",
                "La organizacion esta desactivada y sus usuarios no pueden acceder",
                org.Id,
                org.Name,
                $"/platform/organizations/{org.Id}",
                "Revisar",
                null,
                null,
                null));
        }

        return items
            .OrderBy(SeverityRank)
            // `a.daysUntil ?? 0` — the three types without the key sort as if 0, which interleaves them
            // with same-severity items that DO carry one (a suspended org lands between trials expiring
            // in -1 and +1 days).
            .ThenBy(i => i.DaysUntil ?? 0)
            .ToList();
    }

    /// <summary><c>Math.floor((now - then) / 86_400_000)</c>. Both operands carry millisecond resolution
    /// (the columns are <c>timestamp(3)</c> and <see cref="PlatformDashboardReadUseCase.JsNow"/> truncates
    /// to the same), so the division is exact and the floor cannot straddle a boundary the JS side would
    /// land on differently. <see cref="DateTime"/> subtraction is tick arithmetic and ignores
    /// <see cref="DateTime.Kind"/>, which is what we want: the row values are Unspecified-kind naive UTC
    /// and <paramref name="nowUtc"/> is UTC-kind, and both denote UTC.</summary>
    private static int WholeDaysBetween(DateTime nowUtc, DateTime earlier) =>
        (int)Math.Floor((nowUtc - earlier).TotalMilliseconds / PlatformDashboardReadUseCase.MillisecondsPerDay);

    /// <summary><c>{ critical: 0, warning: 1, info: 2 }</c>. The default is unreachable — the kernel above
    /// writes all three severities as literals — and returning a rank that sorts LAST is the least
    /// surprising behaviour if a sixth item type ever adds a fourth severity without updating this.
    /// </summary>
    private static int SeverityRank(AttentionItem item) => item.Severity switch
    {
        "critical" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    };
}
