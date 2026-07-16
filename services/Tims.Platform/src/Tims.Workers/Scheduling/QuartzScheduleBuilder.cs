using Quartz;
using Tims.Workers.Hris;

namespace Tims.Workers.Scheduling;

/// <summary>
/// Registers the recurring jobs + triggers on the Quartz configurator from <see cref="WorkerOptions"/>
/// (identity, cron, misfire policy). Factored out of Program.cs so the schedule is unit-inspectable and the
/// host stays declarative. A malformed cron throws HERE (host build), i.e. fail-fast at startup.
/// </summary>
public static class QuartzScheduleBuilder
{
    /// <summary>The durable JobKey for the HRIS background sweep (group "hris").</summary>
    public static readonly JobKey HrisSyncJobKey = new(HrisSyncQuartzJob.JobName, "hris");

    /// <summary>The CronTrigger key for the HRIS sweep.</summary>
    public static readonly TriggerKey HrisSyncTriggerKey = new($"{HrisSyncQuartzJob.JobName}-trigger", "hris");

    /// <summary>Wires the HRIS sweep job (stored durably) and, when enabled, its cron trigger.</summary>
    public static void Configure(IServiceCollectionQuartzConfigurator quartz, WorkerOptions options)
    {
        ArgumentNullException.ThrowIfNull(quartz);
        ArgumentNullException.ThrowIfNull(options);

        // StoreDurably ⇒ the JobKey exists even with no trigger (HrisSyncEnabled = false), so the job is
        // present + triggerable and the schedule is inspectable regardless of the enablement toggle.
        quartz.AddJob<HrisSyncQuartzJob>(job => job.WithIdentity(HrisSyncJobKey).StoreDurably());

        if (!options.HrisSyncEnabled)
        {
            return;
        }

        quartz.AddTrigger(trigger => trigger
            .ForJob(HrisSyncJobKey)
            .WithIdentity(HrisSyncTriggerKey)
            .WithCronSchedule(
                options.HrisSyncCron,
                // A missed window (host down / long run) is picked up on the NEXT tick — never a
                // thundering catch-up of every window we slept through.
                cron => cron.WithMisfireHandlingInstructionDoNothing()));
    }
}
