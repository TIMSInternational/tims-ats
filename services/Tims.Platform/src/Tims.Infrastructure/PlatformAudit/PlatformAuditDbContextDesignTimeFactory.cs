using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Tims.Infrastructure.PlatformAudit;

/// <summary>
/// DESIGN-TIME ONLY. Lets <c>dotnet ef migrations --context PlatformAuditDbContext</c> build the model without a
/// host. The placeholder connection string is never opened by <c>migrations add</c> or <c>migrations script</c>.
/// Carries no secrets.
/// </summary>
public sealed class PlatformAuditDbContextDesignTimeFactory : IDesignTimeDbContextFactory<PlatformAuditDbContext>
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Database=tims_platform_audit_design;Username=postgres;Password=postgres";

    public PlatformAuditDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<PlatformAuditDbContext>()
            .UseNpgsql(DesignTimeConnectionString)
            .Options;

        return new PlatformAuditDbContext(options);
    }
}
