using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// DESIGN-TIME ONLY. Lets <c>dotnet ef migrations</c> construct a <see cref="FxRateDbContext"/> without booting a
/// host or reading real configuration — a placeholder Npgsql connection string used purely to build the
/// relational model (no connection is opened during <c>migrations add</c>). Runtime wiring is the real
/// <c>AddDbContext&lt;FxRateDbContext&gt;</c> registration in the Api/Workers <c>Program.cs</c>. Carries no secrets.
/// </summary>
public sealed class FxRateDbContextDesignTimeFactory : IDesignTimeDbContextFactory<FxRateDbContext>
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Database=tims_fx_design;Username=postgres;Password=postgres";

    public FxRateDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<FxRateDbContext>()
            .UseNpgsql(DesignTimeConnectionString)
            .Options;

        return new FxRateDbContext(options);
    }
}
