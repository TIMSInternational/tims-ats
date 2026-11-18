using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tims.Infrastructure.Migrations
{
    /// <summary>
    /// Release round 12. (1) <c>create_fences</c>: one create fence PER CREATE instead of the shared
    /// <c>create_started_at</c> (Codex P1: two overlapping creates of one attempt shared it, so the first answer cleared
    /// the fence while the second was still in flight, and an erasure in that window could report done while the second
    /// create re-created the provider subject). Existing unanswered fences are copied in. (2) The FIT v2 provider result
    /// trigger also fires on DELETE (Codex P1: a <c>result_not_visible</c> answer now deletes the stored result, which
    /// must leave FIT). Down restores the previous trigger and copies the newest token back.
    /// </summary>
    public partial class assessment_provider_round12 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime[]>(
                name: "create_fences",
                table: "assessment_provider_attempts",
                type: "timestamp with time zone[]",
                nullable: false,
                defaultValueSql: "'{}'::timestamptz[]");

            // A create announced under the old single fence and never answered keeps protecting its attempt.
            migrationBuilder.Sql(
                """
                UPDATE assessment_provider_attempts
                   SET create_fences = ARRAY[create_started_at]
                 WHERE create_started_at IS NOT NULL AND cardinality(create_fences) = 0;
                """);

            // A stored provider result that is DELETED (the provider answered result_not_visible: the tenant may no
            // longer see it) must leave FIT too: the result trigger now also fires on DELETE, reading the OLD row.
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
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS fit_v2_provider_result_changed ON assessment_provider_results;
                CREATE TRIGGER fit_v2_provider_result_changed
                  AFTER INSERT OR UPDATE OR DELETE ON assessment_provider_results
                  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_result_changed();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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
                BEGIN
                  IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NULL
                     OR NOT has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
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

            // The newest live create token returns to the single fence (best effort for a rollback).
            migrationBuilder.Sql(
                """
                UPDATE assessment_provider_attempts
                   SET create_started_at = (SELECT max(f) FROM unnest(create_fences) AS f)
                 WHERE cardinality(create_fences) > 0;
                """);

            migrationBuilder.DropColumn(
                name: "create_fences",
                table: "assessment_provider_attempts");
        }
    }
}
