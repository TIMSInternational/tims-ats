using Tims.Domain.Access;
using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>
/// The FX-free compensation READ use case — infra-free orchestration, a faithful port of the seven FX-free
/// read bodies of the TS <c>compensation</c> router. Reads #1/#2 pass the repository's raw rows straight
/// through; reads #3/#4 run the pure <see cref="CompensationKernels"/> (golden-parity with @tims/shared);
/// reads #5/#6/#7 pass the field-authed JsonObject rows straight through (the endpoint owns the audit + the
/// subject-scope guard). No clock, no scope logic here (the endpoint owns the anchor loader + scopeWhereFor).
/// </summary>
public sealed class CompensationReadUseCase(ICompensationReadRepository repository)
{
    private readonly ICompensationReadRepository _repository = repository;

    public Task<IReadOnlyList<SalaryBandRow>> GetSalaryBandsAsync(
        string organizationId, CancellationToken cancellationToken) =>
        _repository.GetSalaryBandsAsync(organizationId, cancellationToken);

    public Task<IReadOnlyList<MarketComparisonRow>> GetMarketComparisonAsync(
        string organizationId, string? jobLevel, CancellationToken cancellationToken) =>
        _repository.GetMarketComparisonAsync(organizationId, jobLevel, cancellationToken);

    public async Task<IReadOnlyList<BenefitUtilizationItem>> GetBenefitsUtilizationAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetBenefitsUtilizationDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return CompensationKernels.BuildBenefitsUtilization(data.Plans, data.TotalUsers);
    }

    public async Task<CompaRatioDistribution> GetCompaRatioDistributionAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetCompaRatioRowsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return CompensationKernels.BuildCompaRatioDistribution(rows);
    }

    public Task<PendingAdjustmentsResult> ListPendingAdjustmentsAsync(
        string organizationId,
        IReadOnlyList<string> adjustmentFields,
        ScopePredicate scope,
        CancellationToken cancellationToken) =>
        _repository.ListPendingAdjustmentsAsync(organizationId, adjustmentFields, scope, cancellationToken);

    public Task<EmployeeCompReadResult?> GetEmployeeCompAsync(
        string organizationId,
        Guid subjectUserId,
        IReadOnlyList<string> compensationFields,
        CancellationToken cancellationToken) =>
        _repository.GetEmployeeCompAsync(organizationId, subjectUserId, compensationFields, cancellationToken);
}
