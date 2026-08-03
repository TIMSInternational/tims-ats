-- ROLLBACK for 2026-08-02-fix-rls-fail-open-org-isolation.sql (issue #111).
--
-- Restores the 67 `org_isolation` PERMISSIVE policies EXACTLY as they existed in production immediately
-- before the fix was applied (captured verbatim from pg_policies on 2026-08-02).
--
-- ⚠️  APPLYING THIS RE-OPENS THE SECURITY DEFECT. Afterwards, tenant RLS fails OPEN again on an unset org
--     GUC across all 67 tables — `SET LOCAL ROLE app_tenant` with no GUC will once more return every
--     tenant's rows. Use only if the fix caused a production regression, and re-close it immediately.
--
-- APPLY (failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" \
--     -f packages/db/prisma/manual/2026-08-02-fix-rls-fail-open-org-isolation.ROLLBACK.sql
-- VERIFY: BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM users; ROLLBACK;  -- back to 32 (all orgs)

CREATE POLICY org_isolation ON public.action_plans AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.alert_rules AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.alerts AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.api_keys AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.applications AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.assessment_assignments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.assessment_results AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.assessment_types AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.audit_logs AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.benefit_enrollments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.benefit_plans AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.business_units AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.calibration_sessions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.candidate_documents AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.candidate_tags AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.candidates AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.certificates AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.coaching_sessions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.commitments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.companies AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.connector_syncs AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.connectors AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.courses AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.critical_roles AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.employee_compensations AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.enrollments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.feature_flags AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.feedbacks AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.fit_scores AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.interview_scorecards AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.interview_summaries AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.interviews AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.invoices AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.job_profiles AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.key_results AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.leader_commitments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.learning_paths AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.legal_checks AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.nine_box_evaluations AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.notifications AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL) OR (organization_id IS NULL));
CREATE POLICY org_isolation ON public.offer_approvals AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.offers AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.okrs AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.onboarding_check_ins AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.onboarding_plans AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.onboarding_tasks AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.organizations AS PERMISSIVE FOR ALL TO public USING ((id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.pipeline_stages AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.preemployment_validations AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.proctoring_sessions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.publication_channels AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.recognitions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.roles AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.salary_adjustments AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.salary_bands AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.sessions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.stage_movements AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.subscriptions AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.successors AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.survey_responses AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.surveys AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.sync_errors AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.teams AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.users AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL) OR (organization_id IS NULL));
CREATE POLICY org_isolation ON public.vacancies AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.vacancy_approvals AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
CREATE POLICY org_isolation ON public.webhooks AS PERMISSIVE FOR ALL TO public USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL));
