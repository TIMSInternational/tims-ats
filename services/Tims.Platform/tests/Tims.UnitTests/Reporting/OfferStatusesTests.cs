using System.Reflection;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Reporting;

/// <summary>
/// recruiter-data-78. <c>convertToEmployee</c> moves an accepted offer to <c>status = 'converted'</c>, so a
/// converted offer IS a hire. Every reporting KPI must treat <c>accepted</c> and <c>converted</c> alike via one
/// shared set, <c>OfferStatuses.AcceptedLike</c>, and the reporting repository must not fall back to a bare
/// <c>"accepted"</c> literal (which silently drops every converted hire).
///
/// The constant is resolved by reflection so this suite still compiles before the type exists; the
/// failure is then a test failure naming the missing type, not a build break of the whole unit project.
/// </summary>
public sealed class OfferStatusesTests
{
    private const string OfferStatusesTypeName = "Tims.Domain.Reporting.OfferStatuses";

    private static Type OfferStatusesType()
    {
        var type = typeof(FunnelViewBuilder).Assembly.GetType(OfferStatusesTypeName);
        Assert.True(type is not null, $"{OfferStatusesTypeName} is missing from Tims.Domain");
        return type!;
    }

    [Fact]
    public void AcceptedLike_is_exactly_accepted_and_converted()
    {
        var field = OfferStatusesType().GetField("AcceptedLike", BindingFlags.Public | BindingFlags.Static);
        Assert.True(field is not null, "OfferStatuses.AcceptedLike is missing");

        var values = Assert.IsAssignableFrom<IEnumerable<string>>(field!.GetValue(null));
        Assert.Equal(new[] { "accepted", "converted" }, values.OrderBy(v => v, StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void Accepted_and_Converted_constants_hold_the_stored_status_values()
    {
        var type = OfferStatusesType();

        Assert.Equal("accepted", type.GetField("Accepted", BindingFlags.Public | BindingFlags.Static)?.GetValue(null));
        Assert.Equal("converted", type.GetField("Converted", BindingFlags.Public | BindingFlags.Static)?.GetValue(null));
    }

    [Fact]
    public void ReportingReadRepository_has_no_bare_accepted_literal()
    {
        var path = Path.Combine(SolutionRoot(), "src", "Tims.Infrastructure", "Reporting", "ReportingReadRepository.cs");
        Assert.True(File.Exists(path), $"missing source file: {path}");
        var source = File.ReadAllText(path);

        Assert.DoesNotContain("\"accepted\"", source, StringComparison.Ordinal);
        Assert.DoesNotContain("AcceptedStatus", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ReportingReadRepository_filters_offers_through_AcceptedLike_in_all_five_predicates()
    {
        var path = Path.Combine(SolutionRoot(), "src", "Tims.Infrastructure", "Reporting", "ReportingReadRepository.cs");
        var source = File.ReadAllText(path);

        // Five accepted-offer predicates: KPI accepted rows, KPI offersAccepted, funnel totalHired,
        // source hireSources, recruiter TTF accepted rows.
        var uses = source.Split("OfferStatuses.AcceptedLike.Contains(").Length - 1;
        Assert.Equal(5, uses);
    }

    private static string SolutionRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tims.Platform.slnx")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? throw new InvalidOperationException("Tims.Platform.slnx not found walking up from test bin");
    }
}
