using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// The billing usage/plan/config READ use case — infra-free orchestration, a faithful port of the TS
/// <c>billing.getUsage</c> / <c>getCurrentPlan</c> / <c>getBillingConfig</c> procedures:
///
///   getUsage       → gather subscription plan/status/period + org counts (repository, one TenantScope) →
///                    <see cref="UsageViewBuilder"/> (entitled-plan limits + always-null storage/apiCalls).
///   getCurrentPlan → the org's raw Subscription row mapped to <see cref="SubscriptionV1"/>, or <c>null</c>.
///   getBillingConfig → the pure <see cref="StripeBillingConfig"/> predicate over the deploy's Stripe config.
///
/// Billing is org-level: no per-row scope narrowing and (like the invoice reads) no audit — faithfully
/// reproducing the TS procedures.
/// </summary>
public sealed class BillingUsageUseCase(IBillingReadRepository repository)
{
    private readonly IBillingReadRepository _repository = repository;

    public async Task<UsageV1> GetUsageAsync(string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetUsageAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return UsageViewBuilder.Build(
            data.Employees,
            data.Vacancies,
            data.Assessments,
            data.Plan,
            data.Status,
            data.PeriodStart,
            data.PeriodEnd);
    }

    public async Task<SubscriptionV1?> GetCurrentPlanAsync(string organizationId, CancellationToken cancellationToken)
    {
        var row = await _repository.GetSubscriptionAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : SubscriptionV1Mapper.Map(row);
    }

    /// <summary>
    /// The config-presence gate — pure over the deploy's own Stripe config (absent today → not configured,
    /// honest). The predicate is golden-parity-locked to the TS <c>isBillingConfigured</c>.
    /// </summary>
    public static BillingConfigV1 GetBillingConfig(string? secretKey, string? priceStarter, string? priceProfessional) =>
        new(StripeBillingConfig.IsConfigured(secretKey, priceStarter, priceProfessional));
}
