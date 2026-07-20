-- Quartz.NET clustered ADO job store — PostgreSQL schema (Phase 4 Slice 2).
--
-- OWNERSHIP: these `qrtz_*` tables are owned by QUARTZ, not by Prisma and not by EF Core. They hold
-- cross-tenant SCHEDULER INFRA state (jobs, triggers, cluster locks, scheduler check-ins) — NOT tenant
-- data. They are recorded in docs/architecture/table-ownership.md under `quartzInfra` and MUST NOT be
-- @@map'd in the Prisma schema nor .ToTable()'d by any EF DbContext (a governance check enforces this).
--
-- RLS-EXEMPT BY DESIGN: unlike every product/HRIS table, these carry no organization_id and get NO
-- EnableTenantRls / row policies. The scheduler connects on the app DB role and is gated only by the DML
-- GRANTs at the foot of this file. Do NOT add ENABLE ROW LEVEL SECURITY here.
--
-- SINGLE SOURCE / NO DROP / IDEMPOTENT: this is the upstream-canonical Quartz 3.x Postgres schema (table
-- names, columns, indexes verbatim from quartznet v3.18.2 database/tables/tables_postgres.sql), with the
-- destructive DROP bootstrap block removed and CREATE ... IF NOT EXISTS applied, so it is safe to apply once
-- to prod AND safe to re-run (a second apply is a no-op, never a hard error, and never drops existing
-- scheduler state). The Testcontainers proof (QuartzClusterFixture) applies THIS EXACT FILE, so what is
-- tested is what ships — zero drift.
--
-- APPLY (Federico, prod — run BEFORE flipping Workers:ClusteredSchedulerEnabled=true):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" -f quartz-tables_postgres.sql

CREATE TABLE IF NOT EXISTS qrtz_job_details
  (
    sched_name TEXT NOT NULL,
    job_name TEXT NOT NULL,
    job_group TEXT NOT NULL,
    description TEXT NULL,
    job_class_name TEXT NOT NULL,
    is_durable BOOL NOT NULL,
    is_nonconcurrent BOOL NOT NULL,
    is_update_data BOOL NOT NULL,
    requests_recovery BOOL NOT NULL,
    job_data BYTEA NULL,
    PRIMARY KEY (sched_name, job_name, job_group)
);

CREATE TABLE IF NOT EXISTS qrtz_triggers
  (
    sched_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    job_name TEXT NOT NULL,
    job_group TEXT NOT NULL,
    description TEXT NULL,
    next_fire_time BIGINT NULL,
    prev_fire_time BIGINT NULL,
    priority INTEGER NULL,
    trigger_state TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NULL,
    calendar_name TEXT NULL,
    misfire_instr SMALLINT NULL,
    misfire_orig_fire_time BIGINT NULL,
    execution_group VARCHAR(200) NULL,
    job_data BYTEA NULL,
    PRIMARY KEY (sched_name, trigger_name, trigger_group),
    FOREIGN KEY (sched_name, job_name, job_group)
      REFERENCES qrtz_job_details (sched_name, job_name, job_group)
);

CREATE TABLE IF NOT EXISTS qrtz_simple_triggers
  (
    sched_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    repeat_count BIGINT NOT NULL,
    repeat_interval BIGINT NOT NULL,
    times_triggered BIGINT NOT NULL,
    PRIMARY KEY (sched_name, trigger_name, trigger_group),
    FOREIGN KEY (sched_name, trigger_name, trigger_group)
      REFERENCES qrtz_triggers (sched_name, trigger_name, trigger_group)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qrtz_simprop_triggers
  (
    sched_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    str_prop_1 TEXT NULL,
    str_prop_2 TEXT NULL,
    str_prop_3 TEXT NULL,
    int_prop_1 INTEGER NULL,
    int_prop_2 INTEGER NULL,
    long_prop_1 BIGINT NULL,
    long_prop_2 BIGINT NULL,
    dec_prop_1 NUMERIC NULL,
    dec_prop_2 NUMERIC NULL,
    bool_prop_1 BOOL NULL,
    bool_prop_2 BOOL NULL,
    time_zone_id TEXT NULL,
    PRIMARY KEY (sched_name, trigger_name, trigger_group),
    FOREIGN KEY (sched_name, trigger_name, trigger_group)
      REFERENCES qrtz_triggers (sched_name, trigger_name, trigger_group)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qrtz_cron_triggers
  (
    sched_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    time_zone_id TEXT,
    PRIMARY KEY (sched_name, trigger_name, trigger_group),
    FOREIGN KEY (sched_name, trigger_name, trigger_group)
      REFERENCES qrtz_triggers (sched_name, trigger_name, trigger_group)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qrtz_blob_triggers
  (
    sched_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    blob_data BYTEA NULL,
    PRIMARY KEY (sched_name, trigger_name, trigger_group),
    FOREIGN KEY (sched_name, trigger_name, trigger_group)
      REFERENCES qrtz_triggers (sched_name, trigger_name, trigger_group)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qrtz_calendars
  (
    sched_name TEXT NOT NULL,
    calendar_name TEXT NOT NULL,
    calendar BYTEA NOT NULL,
    PRIMARY KEY (sched_name, calendar_name)
);

CREATE TABLE IF NOT EXISTS qrtz_paused_trigger_grps
  (
    sched_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    PRIMARY KEY (sched_name, trigger_group)
);

CREATE TABLE IF NOT EXISTS qrtz_fired_triggers
  (
    sched_name TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    trigger_group TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    fired_time BIGINT NOT NULL,
    sched_time BIGINT NOT NULL,
    priority INTEGER NOT NULL,
    state TEXT NOT NULL,
    job_name TEXT NULL,
    job_group TEXT NULL,
    is_nonconcurrent BOOL NOT NULL,
    requests_recovery BOOL NULL,
    execution_group VARCHAR(200) NULL,
    PRIMARY KEY (sched_name, entry_id)
);

CREATE TABLE IF NOT EXISTS qrtz_scheduler_state
  (
    sched_name TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    last_checkin_time BIGINT NOT NULL,
    checkin_interval BIGINT NOT NULL,
    PRIMARY KEY (sched_name, instance_name)
);

CREATE TABLE IF NOT EXISTS qrtz_locks
  (
    sched_name TEXT NOT NULL,
    lock_name TEXT NOT NULL,
    PRIMARY KEY (sched_name, lock_name)
);

CREATE INDEX IF NOT EXISTS idx_qrtz_j_req_recovery ON qrtz_job_details (requests_recovery);
CREATE INDEX IF NOT EXISTS idx_qrtz_t_next_fire_time ON qrtz_triggers (next_fire_time);
CREATE INDEX IF NOT EXISTS idx_qrtz_t_state ON qrtz_triggers (trigger_state);
CREATE INDEX IF NOT EXISTS idx_qrtz_t_nft_st ON qrtz_triggers (next_fire_time, trigger_state);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_trig_name ON qrtz_fired_triggers (trigger_name);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_trig_group ON qrtz_fired_triggers (trigger_group);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_trig_nm_gp ON qrtz_fired_triggers (sched_name, trigger_name, trigger_group);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_trig_inst_name ON qrtz_fired_triggers (instance_name);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_job_name ON qrtz_fired_triggers (job_name);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_job_group ON qrtz_fired_triggers (job_group);
CREATE INDEX IF NOT EXISTS idx_qrtz_ft_job_req_recovery ON qrtz_fired_triggers (requests_recovery);

-- The scheduler connects on the app DB role. These tables have NO RLS, so the GRANTs are the only access
-- gate. If the worker connects as a role other than app_tenant, grant that role the same DML in prod.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    qrtz_job_details,
    qrtz_triggers,
    qrtz_simple_triggers,
    qrtz_simprop_triggers,
    qrtz_cron_triggers,
    qrtz_blob_triggers,
    qrtz_calendars,
    qrtz_paused_trigger_grps,
    qrtz_fired_triggers,
    qrtz_scheduler_state,
    qrtz_locks
  TO app_tenant;
