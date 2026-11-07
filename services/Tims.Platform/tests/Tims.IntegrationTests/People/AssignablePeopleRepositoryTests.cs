using Microsoft.EntityFrameworkCore;
using Tims.Domain.People;
using Tims.Infrastructure.People;

namespace Tims.IntegrationTests.People;

/// <summary>
/// With seed-access-matrix.ts grants the vacancy and offer approver sets coincide (every staff holder of one
/// approve permission holds the other), so the endpoint tests cannot tell which permission the repository
/// filtered on. Drive the repository with a rule whose eligibility permission has a DIFFERENT holder set.
/// </summary>
[Collection("TenantPeople")]
public sealed class AssignablePeopleRepositoryTests(TenantPeopleFixture fixture)
{
    private static readonly Guid Acme = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private AssignablePeopleRepository Repository() => new(new AssignablePeopleDbContext(
        new DbContextOptionsBuilder<AssignablePeopleDbContext>().UseNpgsql(fixture.ConnectionString).Options));

    [Fact]
    public async Task Eligibility_IsTheRulesModuleAndAction()
    {
        // interview:update — held (MATRIX) by hr_admin, recruiter, leader, committee; NOT by hrbp (create only).
        var byUpdate = await Repository().ListAsync(
            Acme, new AssignablePurposeRule("offer", "create", "interview", "update"), null, 50, vacancy: null, subjects: null, CancellationToken.None) ?? [];
        Assert.Equal(new[]
        {
            TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin, TenantPeopleFixture.Recruiter,
            TenantPeopleFixture.Leader, TenantPeopleFixture.Committee,
        }.Order().ToArray(), byUpdate.Select(p => p.Id).Order().ToArray());

        // interview:create adds hrbp — so the action, not just the module, is read from the rule.
        var byCreate = await Repository().ListAsync(
            Acme, new AssignablePurposeRule("offer", "create", "interview", "create"), null, 50, vacancy: null, subjects: null, CancellationToken.None) ?? [];
        Assert.Contains(TenantPeopleFixture.Hrbp, byCreate.Select(p => p.Id));
        Assert.DoesNotContain(TenantPeopleFixture.Hrbp, byUpdate.Select(p => p.Id));
    }

    [Fact]
    public async Task EligibilityAlsoAction_RequiresBothActions()
    {
        // interview:create AND interview:update: hrbp holds create only, so the second action is what drops Pablo.
        var both = await Repository().ListAsync(
            Acme, new AssignablePurposeRule("offer", "create", "interview", "create", EligibilityAlsoAction: "update"),
            null, 50, vacancy: null, subjects: null, CancellationToken.None) ?? [];
        Assert.Equal(new[]
        {
            TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin, TenantPeopleFixture.Recruiter,
            TenantPeopleFixture.Leader, TenantPeopleFixture.Committee,
        }.Order().ToArray(), both.Select(p => p.Id).Order().ToArray());

        // The real evaluator rule (create + read): everyone above plus hrbp (MATRIX: interview read/create @unit).
        var evaluators = await Repository().ListAsync(
            Acme, AssignablePurposes.RuleFor(AssignablePurpose.InterviewEvaluator),
            null, 50, vacancy: null, subjects: null, CancellationToken.None) ?? [];
        Assert.Equal(new[]
        {
            TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin, TenantPeopleFixture.Recruiter,
            TenantPeopleFixture.Leader, TenantPeopleFixture.Committee, TenantPeopleFixture.Hrbp,
        }.Order().ToArray(), evaluators.Select(p => p.Id).Order().ToArray());
    }
}
