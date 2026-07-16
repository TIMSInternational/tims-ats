using System.Globalization;
using Tims.Domain.Hris;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Hris;

/// <summary>
/// WP3.6-map — pins <see cref="BambooHrEmployeeMapper"/> against the C#-only golden fixtures
/// (<c>contracts/hris-fixtures/*.json</c>), the greenfield analog of the access goldens: a mapping
/// behavior change edits one JSON file and this test turns red. Also proves
/// <see cref="BambooHrEmployeeMapper.ComputeSourceHash"/> is deterministic and input-sensitive.
/// </summary>
public sealed class BambooHrMapperFixtureTests
{
    private static readonly HrisMapperRoot Directory = Fx.Load<HrisMapperRoot>("hris-fixtures", "bamboo-directory.json");
    private static readonly HrisMapperRoot Employee = Fx.Load<HrisMapperRoot>("hris-fixtures", "bamboo-employee.json");

    public static IEnumerable<object[]> DirectoryCases() => Fx.Rows(Directory.Cases.Select(c => c.Name).ToList());

    public static IEnumerable<object[]> EmployeeCases() => Fx.Rows(Employee.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(DirectoryCases))]
    public void Directory_records_map_to_the_golden_expected(int index, string name) =>
        AssertMapped(Directory.Cases[index], name);

    [Theory]
    [MemberData(nameof(EmployeeCases))]
    public void Employee_records_map_to_the_golden_expected(int index, string name) =>
        AssertMapped(Employee.Cases[index], name);

    private static void AssertMapped(HrisMapperCase testCase, string name)
    {
        Assert.Equal(name, testCase.Name);

        var source = ToSource(testCase.Source);
        var fieldMap = testCase.FieldMap is null ? BambooHrFieldMap.Default : new FieldMap(testCase.FieldMap);

        var actual = BambooHrEmployeeMapper.Map(source, fieldMap);
        var expected = testCase.Expected;

        Assert.Equal(expected.ExternalId, actual.ExternalId);
        Assert.Equal(expected.FirstName, actual.FirstName);
        Assert.Equal(expected.LastName, actual.LastName);
        Assert.Equal(expected.WorkEmail, actual.WorkEmail);
        Assert.Equal(expected.JobTitle, actual.JobTitle);
        Assert.Equal(expected.Department, actual.Department);
        Assert.Equal(expected.Division, actual.Division);
        Assert.Equal(ParseExpectedDate(expected.HireDate), actual.HireDate);
        Assert.Equal(expected.EmploymentStatus, actual.EmploymentStatus);
        Assert.Equal(expected.SupervisorExternalId, actual.SupervisorExternalId);
    }

    [Fact]
    public void ComputeSourceHash_is_stable_for_the_same_input()
    {
        var source = ToSource(Directory.Cases[0].Source);

        // Re-materialize the SAME logical record (different dictionary instance) — the hash is content-
        // addressed, not reference/GetHashCode-based, so both must agree.
        var identical = ToSource(Directory.Cases[0].Source);

        Assert.Equal(
            BambooHrEmployeeMapper.ComputeSourceHash(source),
            BambooHrEmployeeMapper.ComputeSourceHash(identical));
    }

    [Fact]
    public void ComputeSourceHash_is_insensitive_to_field_ordering()
    {
        var original = ToSource(Directory.Cases[0].Source);

        // Same keys/values inserted in reverse order — the hash sorts keys, so order must not matter.
        var reordered = new HrisSourceEmployee(
            original.ExternalId,
            original.Fields.Reverse().ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal));

        Assert.Equal(
            BambooHrEmployeeMapper.ComputeSourceHash(original),
            BambooHrEmployeeMapper.ComputeSourceHash(reordered));
    }

    [Fact]
    public void ComputeSourceHash_changes_when_a_field_value_changes()
    {
        var source = ToSource(Directory.Cases[0].Source);
        var baseline = BambooHrEmployeeMapper.ComputeSourceHash(source);

        var mutatedFields = new Dictionary<string, string?>(source.Fields, StringComparer.Ordinal)
        {
            ["jobTitle"] = "Principal Engineer",
        };
        var mutated = new HrisSourceEmployee(source.ExternalId, mutatedFields);

        Assert.NotEqual(baseline, BambooHrEmployeeMapper.ComputeSourceHash(mutated));
    }

    [Fact]
    public void ComputeSourceHash_distinguishes_a_null_value_from_the_empty_string()
    {
        var withNull = new HrisSourceEmployee("x", new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["workEmail"] = null,
        });
        var withEmpty = new HrisSourceEmployee("x", new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["workEmail"] = string.Empty,
        });

        Assert.NotEqual(
            BambooHrEmployeeMapper.ComputeSourceHash(withNull),
            BambooHrEmployeeMapper.ComputeSourceHash(withEmpty));
    }

    private static HrisSourceEmployee ToSource(HrisSourceEmployeeDto dto) =>
        new(dto.ExternalId, new Dictionary<string, string?>(dto.Fields, StringComparer.Ordinal));

    private static DateOnly? ParseExpectedDate(string? raw) =>
        raw is null ? null : DateOnly.ParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}
