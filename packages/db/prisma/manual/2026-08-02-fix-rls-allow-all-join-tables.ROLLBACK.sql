-- ROLLBACK for 2026-08-02-fix-rls-allow-all-join-tables.sql (issue #111, Defect 2).
--
-- Restores the 7 `allow_all` policies exactly as they existed in production immediately before the fix
-- (captured from pg_policies on 2026-08-02: PERMISSIVE, FOR ALL, TO public, USING (true), no WITH CHECK).
--
-- ⚠️  APPLYING THIS RE-OPENS THE DEFECT, and more completely than the Defect 1 rollback does: `allow_all`
--     is `USING (true)` unconditionally, so these 7 tables revert to having NO effective DB-level tenant
--     isolation in any GUC state. Use only if the fix caused a production regression, and re-close
--     immediately.
--
-- Does NOT touch `permissions` / `platform_owner_emails` — their allow_all was never dropped.
--
-- APPLY (failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<SESSION_POOLER_URI>" \
--     -f packages/db/prisma/manual/2026-08-02-fix-rls-allow-all-join-tables.ROLLBACK.sql
-- VERIFY: BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM user_roles; ROLLBACK;  -- back to 12

CREATE POLICY allow_all ON public.user_roles AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.role_permissions AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.user_teams AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.interview_evaluators AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.calibration_members AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.calibration_votes AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY allow_all ON public.learning_path_courses AS PERMISSIVE FOR ALL TO public USING (true);
