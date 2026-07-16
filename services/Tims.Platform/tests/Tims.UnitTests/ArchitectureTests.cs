using System.Xml.Linq;

namespace Tims.UnitTests;

/// <summary>
/// WP1.1 clean-architecture enforcement. Rather than pull in NetArchTest, this parses the
/// actual .csproj ProjectReference sets and asserts the dependency directions:
///
///   Tims.Domain         -> (nothing)              — the core has zero outward refs
///   Tims.Application    -> Domain
///   Tims.Infrastructure -> Application, Domain
///   Tims.Api            -> Application, Infrastructure
///   Tims.Workers        -> Application, Infrastructure
///
/// A drift (e.g. Domain referencing Infrastructure, or Application taking an infra dep)
/// fails the build.
/// </summary>
public sealed class ArchitectureTests
{
    private static readonly Dictionary<string, string[]> Expected = new()
    {
        ["Tims.Domain"] = [],
        ["Tims.Application"] = ["Tims.Domain"],
        ["Tims.Infrastructure"] = ["Tims.Application", "Tims.Domain"],
        ["Tims.Api"] = ["Tims.Application", "Tims.Infrastructure"],
        ["Tims.Workers"] = ["Tims.Application", "Tims.Infrastructure"],
    };

    [Theory]
    [InlineData("Tims.Domain")]
    [InlineData("Tims.Application")]
    [InlineData("Tims.Infrastructure")]
    [InlineData("Tims.Api")]
    [InlineData("Tims.Workers")]
    public void Project_references_match_clean_architecture(string project)
    {
        var srcDir = Path.Combine(SolutionRoot(), "src");
        var csproj = Path.Combine(srcDir, project, $"{project}.csproj");
        Assert.True(File.Exists(csproj), $"missing csproj: {csproj}");

        var actual = XDocument.Load(csproj)
            .Descendants("ProjectReference")
            .Select(r => Path.GetFileNameWithoutExtension(
                (r.Attribute("Include")?.Value ?? string.Empty).Replace('\\', '/')))
            .Where(name => name.StartsWith("Tims.", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        var expected = Expected[project].OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Domain_has_no_nuget_package_references()
    {
        // The core stays framework-only: no EF, no ASP.NET, no third-party NuGet. A
        // PackageReference leaking into Domain would pass the project-ref check above, so
        // guard it explicitly (a latent gap the project-ref parser alone would miss).
        var csproj = Path.Combine(SolutionRoot(), "src", "Tims.Domain", "Tims.Domain.csproj");
        var packages = XDocument.Load(csproj).Descendants("PackageReference")
            .Select(r => r.Attribute("Include")?.Value)
            .Where(v => v is not null)
            .ToArray();

        Assert.Empty(packages);
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
