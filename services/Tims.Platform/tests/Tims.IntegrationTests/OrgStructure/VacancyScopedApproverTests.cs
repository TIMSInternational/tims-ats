using System.Net;
using F = Tims.IntegrationTests.OrgStructure.OrgStructureFixture;

namespace Tims.IntegrationTests.OrgStructure;

/// <summary>
/// GET /tenant/people/assignable?purpose=vacancy_approver&amp;vacancyId=… returns exactly the approvers
/// <c>vacancy.submitForApproval</c> would accept for THAT vacancy (approvals.ts → assertScoped per approver).
/// Vacancy1: team Ventas (led by LeaderA), unit Comercial (Hrbp assigned), assigned to Assignee (a
/// team-scope leader who leads nothing), created by Recruiter (no approve grant).
/// </summary>
[Collection("OrgStructure")]
public sealed class VacancyScopedApproverTests(F fixture)
{
    private const string Path = "/tenant/people/assignable?purpose=vacancy_approver";

    private Task<HttpResponseMessage> Get(string query, Guid user) =>
        OrgStructureTestClient.SendAsync(fixture.ConnectionString, HttpMethod.Get, Path + query, user);

    private async Task<Guid[]> Ids(string query, Guid user)
    {
        var response = await Get(query, user);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await OrgStructureTestClient.JsonAsync(response)).GetProperty("people").EnumerateArray()
            .Select(person => person.GetProperty("id").GetGuid()).Order().ToArray();
    }

    // Org-wide approvers for every vacancy: super_admin (no rows, short-circuit), hr_admin (@organization) and
    // Nora (@'all', the legacy scope string). NOT Otto: his @organization grant rides a DEACTIVATED role.
    private static readonly Guid[] OrgWide = [F.Admin, F.Hr, F.Narrow];

    [Fact]
    public async Task VacancyId_KeepsOnlyApproversWhoseScopeCoversThatVacancy()
    {
        // + the leader of the vacancy's team, the unit's HRBP, and the team-scoped assignee. NOT the leader of
        // another team (LeaderB), not the inactive hr_admin user, not Otto (deactivated org-wide role).
        Assert.Equal(OrgWide.Concat([F.LeaderA, F.Hrbp, F.Assignee]).Order().ToArray(),
            await Ids($"&vacancyId={F.Vacancy1}&limit=50", F.Recruiter));
    }

    [Fact]
    public async Task UnanchoredVacancy_ListsOnlyOrgWideApprovers()
    {
        // No team, no unit, no assignee: the state of every existing company's vacancies until #304/#310's org
        // fields are used. Otto CREATED it and holds approve @team (active) + @organization (deactivated role):
        // only a deactivated role could make him cover it, and it must not.
        Assert.Equal(OrgWide.Order().ToArray(), await Ids($"&vacancyId={F.UnanchoredVacancy}&limit=50", F.Recruiter));
    }

    [Fact]
    public async Task InactiveTeamAndUnit_AnchorNobody()
    {
        // LeaderB leads the vacancy's team and Hrbp is assigned to its unit — both inactive, so neither counts.
        Assert.Equal(OrgWide.Order().ToArray(), await Ids($"&vacancyId={F.InactiveAnchorVacancy}&limit=50", F.Recruiter));
    }

    [Fact]
    public async Task OtherUnitsVacancy_ListsItsOwnLeader()
    {
        Assert.Equal(OrgWide.Concat([F.LeaderB]).Order().ToArray(), await Ids($"&vacancyId={F.Unit2Vacancy}&limit=50", F.Recruiter));
    }

    [Fact]
    public async Task VacancyOutsideTheCallersOwnScope_Is404_LikeAnUnknownId()
    {
        // Hrbp holds vacancy:update @unit and is assigned to Unit1 only (Unit3 is inactive): Vacancy1 is in scope,
        // Unit2's vacancy and the inactive-unit vacancy are not — and must be indistinguishable from a random id,
        // or the picker becomes an in-tenant existence oracle (and leaks those vacancies' approvers).
        Assert.Equal(HttpStatusCode.OK, (await Get($"&vacancyId={F.Vacancy1}", F.Hrbp)).StatusCode);
        foreach (var vacancy in new[] { F.Unit2Vacancy, F.InactiveAnchorVacancy, F.UnanchoredVacancy })
        {
            var response = await Get($"&vacancyId={vacancy}", F.Hrbp);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("""{"error":"vacancy_not_found"}""", await response.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task VacancyCreatorWithoutVacancyUpdate_Is403()
    {
        // #304: the picker follows submitForApproval's gate (vacancy:update); a leader holds only create @team.
        Assert.Equal(HttpStatusCode.Forbidden, (await Get($"&vacancyId={F.Vacancy1}", F.LeaderA)).StatusCode);
    }

    [Fact]
    public async Task WithoutVacancyId_EveryApproveHolderIsListed()
    {
        var response = await Get("&limit=50", F.Recruiter);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(F.LeaderB.ToString(), body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ForeignOrDeletedVacancy_Is404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Get($"&vacancyId={F.ForeignVacancy}", F.Recruiter)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get($"&vacancyId={F.DeletedVacancy}", F.Recruiter)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get($"&vacancyId={Guid.NewGuid()}", F.Recruiter)).StatusCode);
    }

    [Theory]
    [InlineData("/tenant/people/assignable?purpose=offer_approver&vacancyId=5a000000-0000-0000-0000-000000000001")]
    [InlineData("/tenant/people/assignable?purpose=interview_evaluator&vacancyId=5a000000-0000-0000-0000-000000000001")]
    [InlineData("/tenant/people/assignable?purpose=vacancy_approver&vacancyId=not-a-uuid")]
    public async Task VacancyId_WithWrongPurposeOrMalformed_Is400(string path)
    {
        var response = await OrgStructureTestClient.SendAsync(fixture.ConnectionString, HttpMethod.Get, path, F.Admin);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
