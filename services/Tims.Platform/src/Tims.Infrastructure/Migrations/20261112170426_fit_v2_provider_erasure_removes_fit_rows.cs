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
    /// attempt's vacancy when its breakdown holds a provider entry for the attempt's instrument, under FIT v2's own
    /// per-(organization, candidate, vacancy) advisory lock, so a compute in flight cannot write the erased value back
    /// after the delete (Codex ats round 13 run 2 [P1]). A FIT row is derived
    /// data: the next compute for the vacancy scores the candidate again from what remains, and the queued recompute
    /// re-creates it at once when another provider result for a listed instrument remains. Raw SQL only: no model
    /// change; the trigger itself (20261109030506) already fires on both columns. The result trigger function
    /// (20261109233537, fires on DELETE) likewise deletes, under that lock, the FIT row whose breakdown names a deleted
    /// provider result (a result the provider hid, or an erased one), so the FIT flags being off no longer keeps it
    /// (Codex ats round 13 run 6). Down restores both definitions.
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
                    -- FIT v2's lock for this (organization, candidate, vacancy), the key of
                    -- FitEngineWriteRepository.FitV2LockKey: a compute that read the result before this erasure finishes
                    -- its write first, and that write is deleted below; one that starts later waits for this transaction
                    -- and reads the erasure.
                    PERFORM pg_advisory_xact_lock(hashtextextended(
                      'fit_v2:' || NEW.organization_id::text || ':' || NEW.candidate_id::text || ':' || NEW.vacancy_id::text, 0));
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
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_result_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SECURITY DEFINER
                SET search_path = pg_catalog, public
                AS $fn$
                DECLARE
                  a record;
                  r_attempt uuid;
                  r_org uuid;
                BEGIN
                  IF TG_OP = 'DELETE' THEN
                    r_attempt := OLD.attempt_id;
                    r_org := OLD.organization_id;
                  ELSE
                    r_attempt := NEW.attempt_id;
                    r_org := NEW.organization_id;
                  END IF;
                  SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
                  FROM public.assessment_provider_attempts x
                  WHERE x.id = r_attempt AND x.organization_id = r_org;
                  IF NOT FOUND THEN
                    RETURN NULL;
                  END IF;
                  -- A deleted result (the provider hid it, or the subject was erased) leaves the stored FIT row now,
                  -- whatever the FIT flags (the recompute worker runs only with them on), under FIT v2's lock: the row
                  -- whose breakdown names this result is deleted (Codex ats round 13 run 6).
                  IF TG_OP = 'DELETE' AND to_regclass('public.fit_scores') IS NOT NULL THEN
                    PERFORM pg_advisory_xact_lock(hashtextextended(
                      'fit_v2:' || a.organization_id::text || ':' || a.candidate_id::text || ':' || a.vacancy_id::text, 0));
                    DELETE FROM public.fit_scores f
                     WHERE f.organization_id = a.organization_id
                       AND f.candidate_id = a.candidate_id
                       AND f.vacancy_id = a.vacancy_id
                       AND jsonb_path_exists(
                             f.breakdown,
                             '$.assessments[*] ? (@.source == "provider" && @.resultId == $result)',
                             jsonb_build_object('result', OLD.provider_result_id::text));
                  END IF;
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL
                     AND has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
                    PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
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
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION public.fit_v2_provider_result_changed()
                RETURNS trigger
                LANGUAGE plpgsql
                SECURITY DEFINER
                SET search_path = pg_catalog, public
                AS $fn$
                DECLARE
                  a record;
                  r_attempt uuid;
                  r_org uuid;
                BEGIN
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NULL
                     OR NOT has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
                    RETURN NULL;
                  END IF;
                  IF TG_OP = 'DELETE' THEN
                    r_attempt := OLD.attempt_id;
                    r_org := OLD.organization_id;
                  ELSE
                    r_attempt := NEW.attempt_id;
                    r_org := NEW.organization_id;
                  END IF;
                  SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
                  FROM public.assessment_provider_attempts x
                  WHERE x.id = r_attempt AND x.organization_id = r_org;
                  IF FOUND THEN
                    PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
                  END IF;
                  RETURN NULL;
                END
                $fn$;
                """);
        }
    }
}
