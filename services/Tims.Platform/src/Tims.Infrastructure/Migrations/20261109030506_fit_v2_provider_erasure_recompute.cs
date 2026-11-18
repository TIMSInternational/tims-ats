using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <summary>
    /// FIT v2 × D15: an accepted ATS-initiated erasure (<c>provider_erasure_requested_at</c> set) takes the attempt's
    /// result out of FIT at once (the FIT read skips such attempts), so the marker's write must enqueue a recompute of
    /// the candidate's FIT v2 row, as a state change already does (20261109011531_fit_v2_provider_recompute). This
    /// re-creates that migration's attempt trigger function and trigger to fire on either column. Raw SQL only: no model
    /// change. Down restores the state-only definitions.
    /// </summary>
    public partial class fit_v2_provider_erasure_recompute : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_attempt_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SECURITY DEFINER
                SET search_path = pg_catalog, public
                AS $fn$
                BEGIN
                  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state
                     AND NEW.provider_erasure_requested_at IS NOT DISTINCT FROM OLD.provider_erasure_requested_at THEN
                    RETURN NULL;
                  END IF;
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL
                     AND has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
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
                  AFTER INSERT OR UPDATE OF state, provider_erasure_requested_at ON assessment_provider_attempts
                  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_attempt_changed();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_attempt_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SECURITY DEFINER
                SET search_path = pg_catalog, public
                AS $fn$
                BEGIN
                  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
                    RETURN NULL;
                  END IF;
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL
                     AND has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
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
        }
    }
}
