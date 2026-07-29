CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723032952_fx_rates') THEN
    CREATE TABLE fx_rates (
        id uuid NOT NULL,
        base_currency text NOT NULL,
        quote_currency text NOT NULL,
        rate double precision NOT NULL,
        as_of date NOT NULL,
        fetched_at timestamp with time zone NOT NULL,
        source text NOT NULL,
        CONSTRAINT "PK_fx_rates" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723032952_fx_rates') THEN
    GRANT SELECT ON fx_rates TO app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723032952_fx_rates') THEN
    CREATE UNIQUE INDEX ux_fx_rates_base_quote_asof ON fx_rates (base_currency, quote_currency, as_of);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723032952_fx_rates') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260723032952_fx_rates', '10.0.4');
    END IF;
END $EF$;
COMMIT;

