using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Quartz;
using Quartz.Impl.Matchers;
using Tims.Workers;
using Tims.Workers.Scheduling;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// WP4.1 acceptance for the worker host runtime conventions: boots the real Tims.Workers host in-process
/// (WebApplicationFactory&lt;WorkerHostMarker&gt;) with a placeholder DB connection string (AddDbContext is
/// lazy, so no real DB is needed) and proves /health liveness is 200, the service-info root is 200, and the
/// Quartz scheduler is STARTED with the hris-sync job + its cron trigger registered on the configured cron.
/// </summary>
[Collection(WorkerHostCollection.Name)]
public sealed class WorkerHostSmokeTests
{
    private const string PlaceholderConnectionString =
        "Host=localhost;Port=5432;Database=x;Username=x;Password=x";

    private static WebApplicationFactory<WorkerHostMarker> Factory() =>
        new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", PlaceholderConnectionString);
            builder.UseSetting("Workers:HrisSyncCron", "0 0 * * * ?");
        });

    [Fact]
    public async Task Health_liveness_is_200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Service_info_root_is_200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Scheduler_is_started_with_the_hris_sync_job_and_cron_trigger()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient(); // boots the host → starts the Quartz hosted service

        // Ensure the host is up (and thus the scheduler hosted service has started).
        var health = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        var schedulerFactory = factory.Services.GetRequiredService<ISchedulerFactory>();
        var scheduler = await schedulerFactory.GetScheduler();
        Assert.True(scheduler.IsStarted);

        var jobKeys = await scheduler.GetJobKeys(GroupMatcher<JobKey>.AnyGroup());
        Assert.Contains(QuartzScheduleBuilder.HrisSyncJobKey, jobKeys);

        var triggers = await scheduler.GetTriggersOfJob(QuartzScheduleBuilder.HrisSyncJobKey);
        var cronTrigger = Assert.Single(triggers.OfType<ICronTrigger>());
        Assert.Equal("0 0 * * * ?", cronTrigger.CronExpressionString);
    }
}
