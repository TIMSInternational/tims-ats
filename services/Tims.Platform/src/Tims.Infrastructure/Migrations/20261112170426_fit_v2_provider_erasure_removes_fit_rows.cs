using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <summary>
    /// FIT v2 × D15 (Codex ats round 13 [P1]): an erasure of a provider attempt (<c>provider_erasure_requested_at</c>
    /// set, or the attempt <c>erased</c>) deletes its results, but the stored <c>fit_scores</c> row kept the score, the
    /// result id and the versions in <c>breakdown.assessments[]</c> (and the numbers derived from them) until the
    /// recompute queue drained, and for good when FIT v2 is off (the drain then completes the request without a write).
    /// The attempt trigger function now also deletes, in the erasure's own transaction, the candidate's FIT row for the
    /// attempt's vacancy when its breakdown holds a provider entry for the attempt's instrument. A FIT row is derived
    /// data: the next compute for the vacancy scores the candidate again from what remains, and the queued recompute
    /// re-creates it at once when another provider result for a listed instrument remains. Raw SQL only: no model
    /// change; the trigger itself (20261109030506) already fires on both columns. Down restores that definition.
    /// </summary>
    public partial class fit_v2_provider_erasure_removes_fit_rows : Migration
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
                  -- An erased attempt's data leaves the stored FIT row now, whatever the FIT v2 flag: jsonb_path_exists
                  -- in lax mode is false (never an error) on a v1 row or a breakdown without an assessments array.
                  IF (NEW.provider_erasure_requested_at IS NOT NULL OR NEW.state = 'erased')
                     AND to_regclass('public.fit_scores') IS NOT NULL THEN
                    DELETE FROM public.fit_scores f
                     WHERE f.organization_id = NEW.organization_id
                       AND f.candidate_id = NEW.candidate_id
                       AND f.vacancy_id = NEW.vacancy_id
                       AND jsonb_path_exists(
                             f.breakdown,
                             '$.assessments[*] ? (@.source == "provider" && @.instrument == $instrument)',
                             jsonb_build_object('instrument', NEW.instrument));
                  END IF;
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL
                     AND has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
                    PERFORM public.fit_v2_request_recompute(NEW.organization_id, NEW.candidate_id, NEW.vacancy_id);
                  END IF;
                  RETURN NULL;
                END
                $fn$;
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
        }
    }
}
