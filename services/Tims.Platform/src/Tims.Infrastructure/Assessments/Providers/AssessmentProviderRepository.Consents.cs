using Microsoft.EntityFrameworkCore;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>The candidate's decisions on an attempt's OPTIONAL consent purposes (English speaking: voice, ai_scoring).</summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task RecordOptionalConsentDecisionsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> granted, IReadOnlyList<string> declined,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(granted);
        ArgumentNullException.ThrowIfNull(declined);
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        await ApplyOptionalConsentDecisionsAsync(organizationId, attemptId, granted, declined, cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    // Inside the caller's tenant scope, under the attempt lock the caller already holds.
    private async Task ApplyOptionalConsentDecisionsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> granted, IReadOnlyList<string> declined,
        CancellationToken cancellationToken)
    {
        _db.ChangeTracker.Clear();
        var attempt = await _db.Attempts
            .FirstOrDefaultAsync(a => a.Id == attemptId && a.OrganizationId == organizationId, cancellationToken)
            .ConfigureAwait(false);
        if (attempt is not null)
        {
            var offered = OptionalConsents.For(attempt.Instrument);
            var grant = granted.Where(offered.Contains).Distinct(StringComparer.Ordinal).ToList();
            var decline = declined.Where(p => offered.Contains(p) && !grant.Contains(p)).Distinct(StringComparer.Ordinal).ToList();
            var newGranted = attempt.GrantedOptionalConsents.Except(decline, StringComparer.Ordinal).Union(grant, StringComparer.Ordinal)
                .Order(StringComparer.Ordinal).ToArray();
            var newDeclined = attempt.DeclinedOptionalConsents.Except(grant, StringComparer.Ordinal).Union(decline, StringComparer.Ordinal)
                .Order(StringComparer.Ordinal).ToArray();
            if (!newGranted.SequenceEqual(attempt.GrantedOptionalConsents) || !newDeclined.SequenceEqual(attempt.DeclinedOptionalConsents))
            {
                attempt.GrantedOptionalConsents = newGranted;
                attempt.DeclinedOptionalConsents = newDeclined;
                // Purposes only: never consent text, never anything about the person beyond the attempt id.
                AddAudit(organizationId, null, "assessment_provider_optional_consents_recorded", attempt.Id,
                    new Dictionary<string, object?>
                    {
                        ["instrument"] = attempt.Instrument,
                        ["granted"] = newGranted,
                        ["declined"] = newDeclined,
                    });
                await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
