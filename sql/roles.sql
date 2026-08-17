-- sobae_ops_executor: the DB role the Ops API backend (DATABASE_URL) connects
-- as. Least-privilege by design — EXECUTE on the fn_* lifecycle functions and
-- SELECT on v_organization_summary ONLY, nothing else. See design doc SEC-002/
-- SEC-003 and backend/src/db/client.ts.
--
-- IMPORTANT — the GRANT statements below need their target objects to exist
-- first. Apply this file LAST, after organization_columns.sql,
-- contract_lifecycle_log.sql, v_organization_summary.sql, and all five fn_*
-- files. (Role creation itself doesn't depend on anything — if you'd rather
-- create the role early and grant later, split this file at the marker below.)
--
-- Password: not set here on purpose — do not commit a real password to git.
-- After running this file, set one out of band, e.g.:
--   alter role sobae_ops_executor with password '<generate one, keep it out of git>';
-- and put the resulting connection string in DATABASE_URL (never in this repo).

do $$
begin
  if not exists (select from pg_roles where rolname = 'sobae_ops_executor') then
    create role sobae_ops_executor with login;
  end if;
end
$$;

-- ---- everything below requires organization_columns.sql, contract_lifecycle_log.sql,
-- ---- v_organization_summary.sql, and all fn_*.sql to already be applied ----

grant usage on schema public to sobae_ops_executor;

grant execute on function fn_dryrun_onboarding(jsonb, text) to sobae_ops_executor;
grant execute on function fn_apply_onboarding(jsonb, text) to sobae_ops_executor;
grant execute on function fn_suspend_organization(uuid, text, text) to sobae_ops_executor;
grant execute on function fn_reactivate_organization(uuid, text, text) to sobae_ops_executor;
grant execute on function fn_terminate_organization(uuid, text, text, date) to sobae_ops_executor;

grant select on v_organization_summary to sobae_ops_executor;

-- Defensive/auditable: explicitly confirm no direct table grants exist for
-- this role. No-ops if nothing was ever granted, but make the "no direct
-- DML" intent checkable by reading this file rather than trusting it was
-- never granted elsewhere.
revoke all on organization, office, services, staff, "system_user", contract_lifecycle_log
  from sobae_ops_executor;
