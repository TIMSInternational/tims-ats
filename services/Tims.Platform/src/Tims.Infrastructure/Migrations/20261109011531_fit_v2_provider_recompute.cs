using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <summary>
    /// FIT v2: a provider attempt's state change (created, voided, expired, cancelled, erased, result_ready, …) or a
    /// stored provider result (a new revision, a validity change, a review flag) enqueues a recompute of the
    /// candidate's FIT v2 row for that vacancy, in the same transaction, through <c>fit_v2_request_recompute</c> (Prisma
    /// migration 20261109100000_fit_v2_integrity, which owns the queue and the function). The provider tables are
    /// EF-owned, so their triggers live here. Each trigger calls the function only when it exists, so applying this
    /// before the Prisma migration never breaks a provider write; the function itself enqueues only for a vacancy
    /// configured for FIT v2. Raw SQL only: no model change.
    /// </summary>
    public partial class fit_v2_provider_recompute : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_attempt_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SET search_path = pg_catalog, public
                AS $fn$
                BEGIN
                  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
                    RETURN NULL;
                  END IF;
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL THEN
                    PERFORM public.fit_v2_request_recompute(NEW.organization_id, NEW.candidate_id, NEW.vacancy_id);
                  END IF;
                  RETURN NULL;
                END
                $fn$;
                """);
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS fit_v2_provider_attempt_changed ON assessment_provider_attempts;
                CREATE TRIGGER fit_v2_provider_attempt_changed
                  AFTER INSERT OR UPDATE OF state ON assessment_provider_attempts
                  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_attempt_changed();
                """);
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_result_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SET search_path = pg_catalog, public
                AS $fn$
                DECLARE
                  a record;
                BEGIN
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NULL THEN
                    RETURN NULL;
                  END IF;
                  SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
                  FROM public.assessment_provider_attempts x
                  WHERE x.id = NEW.attempt_id AND x.organization_id = NEW.organization_id;
                  IF FOUND THEN
                    PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
                  END IF;
                  RETURN NULL;
                END
                $fn$;
                """);
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS fit_v2_provider_result_changed ON assessment_provider_results;
                CREATE TRIGGER fit_v2_provider_result_changed
                  AFTER INSERT OR UPDATE ON assessment_provider_results
                  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_result_changed();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS fit_v2_provider_result_changed ON assessment_provider_results;
                DROP TRIGGER IF EXISTS fit_v2_provider_attempt_changed ON assessment_provider_attempts;
                DROP FUNCTION IF EXISTS public.fit_v2_provider_result_changed();
                DROP FUNCTION IF EXISTS public.fit_v2_provider_attempt_changed();
                """);
        }
    }
}
