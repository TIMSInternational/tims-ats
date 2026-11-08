using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// DESIGN-TIME ONLY. Lets <c>dotnet ef migrations add|script</c> build the <see cref="AssessmentProviderDbContext"/>
/// model without a host or real configuration. The placeholder connection string is never opened by
/// <c>migrations add</c> or <c>migrations script</c>. Carries no secrets.
/// </summary>
public sealed class AssessmentProviderDbContextDesignTimeFactory : IDesignTimeDbContextFactory<AssessmentProviderDbContext>
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Database=tims_assessment_providers_design;Username=postgres;Password=postgres";

    public AssessmentProviderDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AssessmentProviderDbContext>()
            .UseNpgsql(DesignTimeConnectionString)
            .Options;

        return new AssessmentProviderDbContext(options);
    }
}
