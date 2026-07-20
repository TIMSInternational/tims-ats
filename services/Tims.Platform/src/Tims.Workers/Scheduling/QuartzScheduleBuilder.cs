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

    /// <summary>
    /// The scheduler NAME shared by every clustered replica. Quartz binds nodes into one cluster by identical
    /// scheduler name (each node gets a unique instance id via <c>SchedulerId = "AUTO"</c>), so this MUST be a
    /// constant — a per-replica/config value would split the cluster. Only applied on the clustered store path.
    /// </summary>
    public const string ClusteredSchedulerName = "TimsWorkersScheduler";

    /// <summary>
    /// Configures the job STORE. When <see cref="WorkerOptions.ClusteredSchedulerEnabled"/> is true this switches
    /// Quartz from the in-memory RAMJobStore to the persistent, CLUSTERED ADO store on Postgres so N worker
    /// replicas share one store and each recurring trigger fires exactly once across the cluster (with failover).
    /// When false it is a no-op — Quartz keeps its default RAMJobStore (process-local; the scheduler must then be
    /// pinned to a single replica). This is the SINGLE source of the persistence config: Program.cs and the
    /// clustering integration test both call it, so what ships is what is tested. Call it BEFORE
    /// <see cref="Configure"/> inside the same <c>AddQuartz</c> lambda.
    /// </summary>
    /// <param name="connectionString">
    /// The Postgres connection the scheduler uses for its <c>qrtz_*</c> tables. Required (non-empty) only when
    /// clustering is enabled; ignored otherwise.
    /// </param>
    public static void ApplyPersistentStore(
        IServiceCollectionQuartzConfigurator quartz,
        WorkerOptions options,
        string? connectionString)
    {
        ArgumentNullException.ThrowIfNull(quartz);
        ArgumentNullException.ThrowIfNull(options);

        if (!options.ClusteredSchedulerEnabled)
        {
            // Default: leave Quartz on its in-memory RAMJobStore. No DB dependency at scheduler init.
            return;
        }

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Workers:ClusteredSchedulerEnabled is true but no database connection string is configured; " +
                "the persistent Quartz store needs Platform:DatabaseConnectionString.");
        }

        // AUTO ⇒ each replica self-assigns a unique cluster instance id (required for clustering). The scheduler
        // NAME is shared across replicas — that shared, constant name is what binds them into one cluster.
        quartz.SchedulerName = ClusteredSchedulerName;
        quartz.SchedulerId = "AUTO";

        quartz.UsePersistentStore(store =>
        {
            // Quartz asserts the qrtz_* schema matches at startup (fail-fast if the DDL was not applied / is stale).
            store.PerformSchemaValidation = true;

            // Store JobDataMap as string PROPERTIES, not binary/JSON-serialized objects. Our jobs carry an empty
            // JobDataMap (everything resolves from the per-fire DI scope), so this is both sufficient and the more
            // secure choice — no serialized-payload surface. A serializer is still required by Quartz.
            store.UseProperties = true;

            store.UsePostgres(postgres =>
            {
                postgres.ConnectionString = connectionString;
                // Default Quartz prefix. Emitted unquoted (e.g. QRTZ_TRIGGERS) → Postgres folds to the lowercase
                // qrtz_triggers created by db/quartz/quartz-tables_postgres.sql. Standard Quartz-on-Postgres pairing.
                postgres.TablePrefix = "QRTZ_";
            });

            store.UseSystemTextJsonSerializer();

            store.UseClustering(cluster =>
            {
                cluster.CheckinInterval = TimeSpan.FromSeconds(options.SchedulerCheckinIntervalSeconds);
                cluster.CheckinMisfireThreshold =
                    TimeSpan.FromSeconds(options.SchedulerCheckinMisfireThresholdSeconds);
            });
        });
    }

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
