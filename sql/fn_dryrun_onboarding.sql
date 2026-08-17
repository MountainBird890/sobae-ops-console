-- Validates an onboarding payload by actually running fn_apply_onboarding's
-- logic inside a nested block, then deliberately forcing that block to fail
-- so PL/pgSQL rolls it back to the block's start — nothing persists. This is
-- the standard "safe experiment" idiom for PL/pgSQL: a BEGIN/EXCEPTION block
-- is an implicit savepoint, and raising inside it undoes everything the
-- block did (but not local variable assignments, which is how v_result
-- survives the rollback below).
--
-- Requires: fn_apply_onboarding.sql already applied (same payload contract —
-- see the comment there). Reuses fn_apply_onboarding itself rather than
-- duplicating its logic, so dry-run and apply can't silently drift apart.

create or replace function fn_dryrun_onboarding(p_payload jsonb, p_applied_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  begin
    v_result := fn_apply_onboarding(p_payload, p_applied_by);
    raise exception using errcode = 'DRYRN';
  exception
    when sqlstate 'DRYRN' then
      return jsonb_build_object('valid', true, 'preview', v_result, 'errors', '[]'::jsonb);
    when others then
      return jsonb_build_object('valid', false, 'errors', jsonb_build_array(sqlerrm));
  end;
end;
$$;
