using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure;
using Tims.Infrastructure.OrgProvisioning;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 21 (issue #76) — <see cref="OrgProvisioningWriter"/> driven DIRECTLY, which nothing else
/// in this suite does.
///
/// <para><b>Why a separate file.</b> Every other test reaches this writer through
/// <c>PlatformOrganizationsCreateRepository</c>, which always opens a <see cref="TenantScope"/> transaction
/// before calling it. So before this file existed,
/// <c>grep -rn "OrgProvisioningWriter" services/Tims.Platform/tests/</c> returned ZERO hits, and deleting
/// both <c>EnsureCallerTransaction</c> call sites — or the throw inside it — passed the whole suite. That is
/// the exact shape <c>feedback_tripwires_need_their_own_mutation_proof</c> describes: a guard can be
/// reinstated-around with all assertions green.</para>
///
/// <para><b>Why it matters beyond this slice.</b> The guard is recorded divergence #5 (an ADDED guard, not a
/// port), and its stated justification is #75: <c>platform/invitations.ts:100-101</c> is a SECOND caller of
/// this same helper pair, entering through this class rather than through the create repository. A #75 that
/// calls <see cref="OrgProvisioningWriter.ProvisionDefaultsAsync"/> on a context with no open transaction
/// gets six auto-committed non-atomic writes — precisely the hole the guard closes — so the guard must be
/// proved to BITE, not merely to exist.</para>
///
/// <para>Both helpers are covered, and both directions: the throw when there is no transaction, and the
/// anti-vacuity control that the very same call succeeds once one is open. Without the control, deleting the
/// writer's body entirely would also make the negative half pass.</para>
/// </summary>
[Collection("PlatformOrganizationsCreate")]
public sealed class OrgProvisioningWriterTests(PlatformOrganizationsCreateFixture fixture)
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Unspecified);

    [Fact]
    public async Task ProvisionDefaultsAsync_throws_when_the_caller_has_no_open_transaction()
    {
        await using var db = fixture.NewContext(fixture.ConnectionString);
        Assert.Null(db.Database.CurrentTransaction);

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            OrgProvisioningWriter.ProvisionDefaultsAsync(
                db, PlatformOrganizationsCreateFixture.HomeOrg, "No Transaction", Now, CancellationToken.None));

        Assert.Contains("org-provisioning.ts:8-10", thrown.Message, StringComparison.Ordinal);

        // It threw BEFORE writing anything — the guard is a precondition, not a post-hoc complaint.
        Assert.Empty(await fixture.ReadCompaniesAsync(PlatformOrganizationsCreateFixture.HomeOrg));
    }

    [Fact]
    public async Task ProvisionEntitlementsAsync_throws_when_the_caller_has_no_open_transaction()
    {
        await using var db = fixture.NewContext(fixture.ConnectionString);
        Assert.Null(db.Database.CurrentTransaction);

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            OrgProvisioningWriter.ProvisionEntitlementsAsync(
                db, PlatformOrganizationsCreateFixture.HomeOrg, Now, CancellationToken.None));

        Assert.Contains("org-provisioning.ts:8-10", thrown.Message, StringComparison.Ordinal);
        Assert.Empty(await fixture.ReadEntitlementsAsync(PlatformOrganizationsCreateFixture.HomeOrg));
    }

    /// <summary>
    /// The anti-vacuity control for both tests above, and the only DIRECT exercise of the seam #75 will
    /// enter through. Runs against <see cref="PlatformOrganizationsCreateFixture.OtherOrg"/> — a
    /// PRE-EXISTING organization, not one this test creates — which is exactly #75's shape: the org row is
    /// written by the caller, the helpers are handed an id that already exists inside the caller's
    /// transaction.
    /// </summary>
    [Fact]
    public async Task Both_helpers_succeed_inside_a_caller_opened_transaction_and_write_the_TS_row_set()
    {
        var org = PlatformOrganizationsCreateFixture.OtherOrg;
        await using var db = fixture.NewContext(fixture.ConnectionString);
        await using var scope = await TenantScope.BeginAsync(db, org, CancellationToken.None);

        var ids = await OrgProvisioningWriter.ProvisionDefaultsAsync(
            db, org, "Invitación SAS", Now, CancellationToken.None);
        var granted = await OrgProvisioningWriter.ProvisionEntitlementsAsync(db, org, Now, CancellationToken.None);

        await scope.CommitAsync(CancellationToken.None);

        // The triple provisionOrgDefaults returns (org-provisioning.ts:17,33). All three production TS
        // callers discard it; preserved because #75 may want the ids and dropping it would be a narrowing.
        Assert.NotEqual(Guid.Empty, ids.CompanyId);
        Assert.NotEqual(Guid.Empty, ids.BusinessUnitId);
        Assert.NotEqual(Guid.Empty, ids.TeamId);

        var company = Assert.Single(await fixture.ReadCompaniesAsync(org));
        Assert.Equal(ids.CompanyId, company.Id);
        // The company is named from the PARAMETER, not derived from the organization — the seam #75 needs,
        // since it passes input.organizationName rather than the org's own name.
        Assert.Equal("Invitación SAS", company.Name);
        Assert.Equal("CO", company.Country);

        var businessUnit = Assert.Single(await fixture.ReadBusinessUnitsAsync(org));
        Assert.Equal(ids.BusinessUnitId, businessUnit.Id);
        Assert.Equal(company.Id, businessUnit.CompanyId);
        Assert.Equal("General", businessUnit.Name);

        var team = Assert.Single(await fixture.ReadTeamsAsync(org));
        Assert.Equal(ids.TeamId, team.Id);
        Assert.Equal(businessUnit.Id, team.BusinessUnitId);
        Assert.Equal("Equipo General", team.Name);

        Assert.Equal(PlatformOrganizationsCreateFixture.AtsBaseModules.Length, granted);
        var entitlements = await fixture.ReadEntitlementsAsync(org);
        Assert.Equal(
            PlatformOrganizationsCreateFixture.AtsBaseModuleLimits.OrderBy(kv => kv.Key, StringComparer.Ordinal),
            entitlements.Select(e => new KeyValuePair<string, int?>(e.ModuleCode, e.Limit)));
    }
}
