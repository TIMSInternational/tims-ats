using System.Net;
using System.Text.Json;

namespace Tims.IntegrationTests.Compensation;

public sealed partial class CompensationReadEndpointAuthTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task SimulationUsesRealSalaryAndProjectsFinanceFieldsByRole(bool hr)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        using var response = await Get(client, SalaryPath("simulation"),
            Mint(hr ? CompensationReadFixture.OrgHrSub : CompensationReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var value = body.RootElement;
        Assert.Equal(90000, value.GetProperty("currentSalary").GetDouble());
        Assert.Equal(99000, value.GetProperty("proposedSalary").GetDouble());
        Assert.Equal(10, value.GetProperty("percentageChange").GetDouble());
        foreach (var field in new[] { "currentCompaRatio", "newCompaRatio", "bandMin", "bandMax", "bandCurrency", "withinBand" })
            Assert.Equal(hr, value.TryGetProperty(field, out _));
        if (hr) Assert.Equal(0.9, value.GetProperty("currentCompaRatio").GetDouble());
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(CompensationReadFixture.NoGrantSub, HttpStatusCode.Forbidden)]
    public async Task SimulationRequiresAnAuthorizedStaffCaller(string? subject, HttpStatusCode expected)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        using var response = await Get(client, SalaryPath("simulation"), subject is null ? null : Mint(subject));
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task SimulationDeniesAnOutOfScopeSubject()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        using var response = await Get(client,
            $"/compensation/simulate-adjustment?userId={CompensationReadFixture.EmpId}&proposedSalary=99000&currency=USD",
            Mint(CompensationReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("Infinity")]
    [InlineData("1e309")]
    [InlineData("NaN")]
    [InlineData("-1")]
    [InlineData("0")]
    public async Task SimulationRejectsNonFiniteOrNonPositiveSalary(string salary)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        using var response = await Get(client,
            $"/compensation/simulate-adjustment?userId={CompensationReadFixture.M1Id}&proposedSalary={salary}&currency=USD",
            Mint(CompensationReadFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
