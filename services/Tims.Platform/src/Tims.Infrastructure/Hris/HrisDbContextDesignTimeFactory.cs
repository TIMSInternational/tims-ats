using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// DESIGN-TIME ONLY. Lets <c>dotnet ef migrations</c> construct a <see cref="HrisDbContext"/> without
/// booting the Api host or reading real configuration — it hands EF a placeholder Npgsql connection
/// string used purely to build the relational model (no connection is ever opened during
/// <c>migrations add</c>/<c>migrations script</c>). Runtime wiring is the real
/// <c>AddDbContext&lt;HrisDbContext&gt;</c> registration in <c>Program.cs</c>.
///
/// <c>Microsoft.EntityFrameworkCore.Design</c> is a design-time (PrivateAssets=all) dependency; this
/// factory carries no secrets and never touches a database.
/// </summary>
public sealed class HrisDbContextDesignTimeFactory : IDesignTimeDbContextFactory<HrisDbContext>
{
    // Not a real credential — a syntactically valid placeholder so EF can build the model.
    private const string DesignTimeConnectionString =
        "Host=localhost;Database=tims_hris_design;Username=postgres;Password=postgres";

    public HrisDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<HrisDbContext>()
            .UseNpgsql(DesignTimeConnectionString)
            .Options;

        return new HrisDbContext(options);
    }
}
