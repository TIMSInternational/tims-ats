using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Options;
using Tims.Workers;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// The worker host must FAIL CLOSED on a DB connection string that [Required] accepts but that can never work in
/// production: the Terraform placeholder (a public string in this repo) and, outside Development/Testing, the
/// loopback appsettings.json default it silently falls back to when ECS secret injection is missing. Pure guard
/// cases plus real host boots (no DB needed — the failure happens at ValidateOnStart, before any connection).
/// </summary>
[Collection(WorkerHostCollection.Name)]
public sealed class DatabaseConnectionStringGuardTests
{
    private const string Remote = "Host=aws-0-us-west-2.pooler.supabase.com;Port=6543;Database=postgres;Username=u;Password=p";
    private const string Loopback = "Host=localhost;Port=5432;Database=tims;Username=postgres";

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("REPLACE_ME_OUT_OF_BAND")]
    [InlineData("replace_me_out_of_band")]
    [InlineData("Host=db.example.com;Password=REPLACE_ME_OUT_OF_BAND")]
    [InlineData("Port=5432;Database=x")]
    [InlineData("NotAKey=value")]
    public void Rejects_unusable_values_in_every_environment(string? value)
    {
        Assert.False(DatabaseConnectionStringGuard.IsUsable(value, requireRemoteHost: false));
        Assert.False(DatabaseConnectionStringGuard.IsUsable(value, requireRemoteHost: true));
    }

    [Theory]
    [InlineData(Loopback)]
    [InlineData("Host=127.0.0.1;Database=x")]
    [InlineData("Host=::1;Database=x")]
    [InlineData("Host=LOCALHOST:5432;Database=x")]
    [InlineData("Host=db.example.com,localhost;Database=x")]
    [InlineData("Host=/var/run/postgresql;Database=x")]
    public void Loopback_is_accepted_only_when_a_remote_host_is_not_required(string value)
    {
        Assert.True(DatabaseConnectionStringGuard.IsUsable(value, requireRemoteHost: false));
        Assert.False(DatabaseConnectionStringGuard.IsUsable(value, requireRemoteHost: true));
    }

    [Fact]
    public void A_real_remote_connection_string_is_accepted() =>
        Assert.True(DatabaseConnectionStringGuard.IsUsable(Remote, requireRemoteHost: true));

    [Fact]
    public void The_failure_message_never_contains_the_value()
    {
        Assert.DoesNotContain("Password", DatabaseConnectionStringGuard.FailureMessage, StringComparison.Ordinal);
        Assert.DoesNotContain("pooler", DatabaseConnectionStringGuard.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Host_refuses_to_start_on_the_terraform_placeholder()
    {
        using var factory = Factory("Development", DatabaseConnectionStringGuard.TerraformPlaceholder);
        var ex = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains(FindOptionsFailure(ex), DatabaseConnectionStringGuard.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Host_refuses_to_start_in_production_on_the_loopback_default()
    {
        using var factory = Factory("Production", Loopback);
        var ex = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains(FindOptionsFailure(ex), DatabaseConnectionStringGuard.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Host_starts_in_production_on_a_remote_connection_string()
    {
        // Lazy DbContexts: no connection is opened, so a syntactically remote host is enough to boot.
        using var factory = Factory("Production", Remote);
        using var client = factory.CreateClient();
        Assert.NotNull(client);
    }

    private static WebApplicationFactory<WorkerHostMarker> Factory(string environment, string connectionString) =>
        new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("Platform:DatabaseConnectionString", connectionString);
            builder.UseSetting("Workers:HrisSyncEnabled", "false");
            builder.UseSetting("Workers:FxRefreshEnabled", "false");
        });

    private static string FindOptionsFailure(Exception ex)
    {
        for (Exception? current = ex; current is not null; current = current.InnerException)
        {
            if (current is OptionsValidationException ove)
            {
                return string.Join(" | ", ove.Failures);
            }

            if (current is AggregateException agg)
            {
                foreach (var inner in agg.InnerExceptions)
                {
                    var found = FindOptionsFailure(inner);
                    if (found.Length > 0)
                    {
                        return found;
                    }
                }
            }
        }

        return string.Empty;
    }
}
