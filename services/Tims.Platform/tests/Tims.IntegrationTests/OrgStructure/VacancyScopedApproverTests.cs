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

    [Fact]
    public async Task VacancyId_KeepsOnlyApproversWhoseScopeCoversThatVacancy()
    {
        var response = await Get($"&vacancyId={F.Vacancy1}&limit=50", F.Recruiter);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var ids = (await OrgStructureTestClient.JsonAsync(response)).GetProperty("people").EnumerateArray()
            .Select(person => person.GetProperty("id").GetGuid()).Order().ToArray();
        // Org-wide (super_admin, hr_admin), the leader of the vacancy's team, the unit's HRBP, and the
        // team-scoped assignee. NOT the leader of another team; not the inactive hr_admin.
        Assert.Equal(new[] { F.Admin, F.Hr, F.LeaderA, F.Hrbp, F.Assignee }.Order().ToArray(), ids);
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
