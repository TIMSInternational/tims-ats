using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Tims.Api.Fx;
using Tims.Application.Fx;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Host-level proofs for the API-hosted FX refresh (2026-08-15), against the REAL migration schema the
/// <see cref="FxSchemaFixture"/> applies:
///   1. flag OFF (the default) → the hosted service is NOT REGISTERED — the same inertness contract every
///      dark route has, asserted at the container rather than the route table since a service maps nothing;
///   2. flag ON → registered exactly once, and the STARTUP run drives discovery → gateway → upsert
///      end-to-end into the real <c>fx_rates</c> (through the real <see cref="FxRateWriteRepository"/>,
///      real unique index, real GRANTs) — only the egress edge (<see cref="IFxRateGateway"/>) is faked.
///
/// <para>TRAP-4 disposition, translated: the service-level loop tests
/// (<see cref="FxRefreshHostedServiceTests"/>) call the service directly, so Program.cs could lose the
/// whole registration block with that suite green. Only asserting against the BOOTED host catches it.</para>
/// </summary>
[Collection(nameof(FxSchemaCollection))]
public sealed class FxRefreshHostTests(FxSchemaFixture fixture)
{
    private readonly FxSchemaFixture _fixture = fixture;

    private WebApplicationFactory<Program> Factory(bool refreshEnabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            if (refreshEnabled)
            {
                builder.UseSetting("Platform:FxRefreshEnabled", "true");
            }

            builder.ConfigureTestServices(services =>
            {
                // Fake ONLY the egress edge; everything inboard of it is production wiring.
                services.RemoveAll<IFxRateGateway>();
                services.AddSingleton<IFxRateGateway>(new FixedGateway());
            });
        });

    [Fact]
    public void FlagOff_TheDefault_RegistersNoRefreshService()
    {
        using var factory = Factory(refreshEnabled: false);

        // Touch the server so the host is actually built.
        using var client = factory.CreateClient();

        Assert.DoesNotContain(
            factory.Services.GetServices<IHostedService>(),
            s => s is FxRefreshHostedService);
    }

    [Fact]
    public async Task FlagOn_RegistersOnce_AndTheStartupRunPinsRatesIntoTheRealSchema()
    {
        await _fixture.ResetAsync();

        await using var factory = Factory(refreshEnabled: true);
        using var client = factory.CreateClient(); // boots the host → StartAsync → the startup run

        Assert.Single(factory.Services.GetServices<IHostedService>(), s => s is FxRefreshHostedService);

        // The startup run is async relative to the boot; poll briefly rather than sleep blindly.
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        List<FxRateEntity> pinned = [];
        while (DateTime.UtcNow < deadline)
        {
            await using var db = _fixture.NewContext();
            pinned = await db.FxRates.AsNoTracking().ToListAsync();
            if (pinned.Count > 0)
            {
                break;
            }

            await Task.Delay(100);
        }

        // The quote set is the seed set — PLUS, when TheDiscoveryUnion_IncludesInvoices has already run
        // in this collection, the GTQ its invoices table contributes (the fixture is shared and that test
        // does not drop it). The assertions are ORDER-INDEPENDENT anyway: the fake returns the same fixed
        // dict whatever it is asked for, and only fetched rates are pinned. Values land verbatim, source
        // and all, through the real ON CONFLICT upsert.
        var cop = Assert.Single(pinned, r => r.QuoteCurrency == "COP");
        Assert.Equal("USD", cop.BaseCurrency);
        Assert.Equal(4321.5, cop.Rate);
        Assert.Equal(new DateOnly(2026, 8, 15), cop.AsOf);
        Assert.Equal("exchangerate-api", cop.Source);
        Assert.Single(pinned, r => r.QuoteCurrency == "EUR");
        Assert.Equal(2, pinned.Count);
    }

    [Fact]
    public async Task TheDiscoveryUnion_IncludesInvoices()
    {
        // The 2026-08-15 gap: `invoices` was absent from FxRateWriteRepository.CurrencyTables, so the
        // dashboard FX reads' currencies were pinned only when a compensation table happened to share
        // them — caveat 9's "first tenant invoiced in a new currency" trap. This proves the union sees a
        // currency that exists NOWHERE except an invoice. The table is created here because the fx
        // fixture deliberately carries only what the migration ships; to_regclass makes absent tables a
        // non-error, which is also why this test creating it is safe for every other test in the
        // collection (discovery tolerates it either way).
        await using (var connection = new NpgsqlConnection(_fixture.ConnectionString))
        {
            await connection.OpenAsync();
            await using var create = connection.CreateCommand();
            create.CommandText =
                """
                CREATE TABLE IF NOT EXISTS invoices (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    currency text
                );
                TRUNCATE TABLE invoices;
                INSERT INTO invoices (currency) VALUES ('GTQ'), ('GTQ'), (NULL);
                """;
            await create.ExecuteNonQueryAsync();
        }

        await using var db = _fixture.NewContext();
        var repository = new FxRateWriteRepository(db);

        var referenced = await repository.ListReferencedCurrenciesAsync(CancellationToken.None);

        Assert.Contains("GTQ", referenced);
    }

    [Fact]
    public void FlagOn_WithABrokenRegistrationGraph_FailsTheHostStart()
    {
        // The security lens's LOW-1: with the flag on and a registration missing, the loop's catch-all
        // would log once per tick and the pins would freeze silently — the incident, again, with a green
        // suite. The StartAsync probe turns that into a loud deploy failure.
        //
        // PRODUCTION environment, deliberately. WebApplicationFactory defaults to Development, where
        // ValidateOnBuild catches a broken graph at Build() — BEFORE the probe runs — so a Development
        // test stays red with the probe DELETED and mutation-proves nothing. Production runs with build
        // validation OFF (the .NET default), which is exactly the environment where the probe is the only
        // thing standing between a lost registration and a silently dead refresh loop. This test deletes
        // the write repo the way a refactor would (the gateway is faked here, so faking THAT away would
        // prove nothing) and asserts the host refuses to start at all.
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FxRefreshEnabled", "true");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IFxRateGateway>();
                services.AddSingleton<IFxRateGateway>(new FixedGateway());
                services.RemoveAll<IFxRateWriteRepository>(); // the simulated lost registration
            });
        });

        var thrown = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(thrown);
        // Whatever wrapper the host puts around it, the chain must name the unresolvable dependency —
        // that is what makes the deploy failure DIAGNOSABLE, not merely fatal.
        var messages = new List<string>();
        for (var e = thrown; e is not null; e = e.InnerException)
        {
            messages.Add(e.Message);
            if (e is AggregateException agg)
            {
                messages.AddRange(agg.InnerExceptions.Select(i => i.Message));
            }
        }

        Assert.Contains(messages, m => m.Contains(nameof(IFxRateWriteRepository), StringComparison.Ordinal));
    }

    private sealed class FixedGateway : IFxRateGateway
    {
        public Task<FxGatewayRates> FetchLatestAsync(
            string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken) =>
            Task.FromResult(new FxGatewayRates(
                baseCurrency,
                new DateOnly(2026, 8, 15),
                new Dictionary<string, double>(StringComparer.Ordinal)
                {
                    ["COP"] = 4321.5,
                    ["EUR"] = 0.91,
                }));
    }
}
