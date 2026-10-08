-- 目的：事業所（offices）単位の利用停止・再開と、事業所の契約日・状態の表示に必要なDBオブジェクトを追加する
--       （REQ-0001 F-006/F-007。2026-09-30の決定と2026-10-08の範囲：登録と停止・再開。事業所の契約終了は棚上げ）。
--       (1) console.contract_lifecycle_log に office_id（nullable、offices(id)への外部キー）を追加する。
--           organization_id は NOT NULL のまま、事業所単位のイベントでも「イベント発生時点の親法人ID」を直接保存する
--           （offices.organization_id の現在値をJOINで導出しない。事業所が別法人へ移管されても過去の監査記録が
--           書き換わって見えないようにするため）。
--       (2) console.v_office_summary（新規）：事業所の一覧・詳細用。実効ステータス（NULLかつis_active→active、
--           NULLかつ無効→NULL=「要確認」）、親法人の実効ステータス、直近の停止日・再開日を返す。
--       (3) console.fn_suspend_office / console.fn_reactivate_office（新規）：offices.status・is_active・
--           updated_at を同時に更新し、監査ログへ記録する。updated_at はトリガーで更新されないため、明示的に設定する
--           （本体の回答、2026-10-08）。ログインの遮断は offices.is_active（本体のmigration 248）で行われる。
--       (4) console.v_organization_summary に last_suspended_at / last_reactivated_at を末尾に追加する
--           （法人単位の直近の停止日・再開日。office_id が NULL のイベントだけを見る）。
--       (5) console.fn_apply_onboarding の更新：新規の事業所を status='active'、contract_start_date=法人の契約開始日
--           で作る。console.fn_dryrun_onboarding は apply を呼んでロールバックするため、変更不要。
-- 作成日：2026-10-08
-- 依存する既存オブジェクト：03（contract_lifecycle_log）、06・11（法人単位の停止）、09・11（v_organization_summary）、
--       10（fn_apply_onboarding）、本体のmigration 251（offices.status / contract_start_date / contract_end_date と、
--       sobae_onboarding_executor への列単位UPDATE・rls_offices_update_procedure）。
--       ※本体251が適用されていない環境には適用できない。
-- 変更しないもの：法人単位の06・07・08、本体の認証ゲート、事業所の契約終了（fn_terminate_office は作らない。棚上げ）。
-- 前提チェック：console.v_office_summary の所有者 sobae_onboarding_executor は、コンテキスト無し（バックエンドが
--       sobae_ops_executor で読む通常のSELECT）でも offices を読める必要がある。organizations には専用の無条件SELECT
--       ポリシーがある（本体247）が、offices にはコンテキスト限定のSELECTしか無いと、ビューは黙って0行になる
--       （2026-10-08のローカル検証で発見）。そのため、本体側に sobae_onboarding_executor 専用の無条件SELECT
--       ポリシーが無い環境では、このmigrationを適用しない（下のDOブロックで拒否する）。
-- ロールバック方針：新規のビュー・関数は drop し、v_organization_summary と fn_apply_onboarding は11・10の定義に戻す
--       create or replace を、新しい番号のmigrationとして追加する（適用済みのファイルは書き換えない）。

do $$
begin
  if not exists (
    select 1
    from pg_policy p
    where p.polrelid = 'public.offices'::regclass
      and p.polcmd = 'r'
      and p.polqual is not null
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
      and exists (select 1 from pg_roles r where r.rolname = 'sobae_onboarding_executor' and r.oid = any (p.polroles))
  ) then
    raise exception '[12] public.offices に sobae_onboarding_executor 専用の無条件SELECTポリシー（USING true）がありません。本体側のmigrationで追加されてから適用してください（v_office_summary が空になるため）'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- (1) 監査ログ：office_id
alter table console.contract_lifecycle_log
  add column if not exists office_id uuid references public.offices(id);

create index if not exists idx_contract_lifecycle_log_office_id
  on console.contract_lifecycle_log (office_id);

-- (4) 法人のビュー：末尾に列を追加（先頭の6列は11と同じ）
create or replace view console.v_organization_summary as
select
  o.id,
  o.name,
  o.management_number,
  case
    when o.status is not null then o.status
    when o.is_active then 'active'
    else null
  end as status,
  o.contract_start_date,
  o.contract_end_date,
  (select max(l.applied_at) from console.contract_lifecycle_log l
    where l.organization_id = o.id and l.office_id is null and l.event_type = 'suspended') as last_suspended_at,
  (select max(l.applied_at) from console.contract_lifecycle_log l
    where l.organization_id = o.id and l.office_id is null and l.event_type = 'reactivated') as last_reactivated_at
from public.organizations o;

revoke all on console.v_organization_summary from public, anon, authenticated, service_role;
alter view console.v_organization_summary owner to sobae_onboarding_executor;
grant select on console.v_organization_summary to sobae_ops_executor;

-- (2) 事業所のビュー
create or replace view console.v_office_summary as
select
  f.id,
  f.organization_id,
  o.name as organization_name,
  f.code,
  f.name,
  f.postal_code,
  f.address,
  f.phone,
  f.fax,
  f.email,
  f.is_active,
  case
    when f.status is not null then f.status
    when f.is_active then 'active'
    else null
  end as status,
  case
    when o.status is not null then o.status
    when o.is_active then 'active'
    else null
  end as organization_status,
  f.contract_start_date,
  f.contract_end_date,
  f.created_at,
  (select max(l.applied_at) from console.contract_lifecycle_log l
    where l.office_id = f.id and l.event_type = 'suspended') as last_suspended_at,
  (select max(l.applied_at) from console.contract_lifecycle_log l
    where l.office_id = f.id and l.event_type = 'reactivated') as last_reactivated_at
from public.offices f
left join public.organizations o on o.id = f.organization_id;

revoke all on console.v_office_summary from public, anon, authenticated, service_role;
alter view console.v_office_summary owner to sobae_onboarding_executor;
grant select on console.v_office_summary to sobae_ops_executor;

-- (3) 事業所の利用停止
create or replace function console.fn_suspend_office(
  p_office_id uuid,
  p_reason text,
  p_applied_by text
)
returns table (
  office_id uuid,
  status text,
  log_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_status_before text;
  v_management_number text;
  v_log_id uuid;
begin
  perform set_config('app._procedure_context', 'true', true);

  -- 実効ステータス：statusがNULLの事業所は、is_activeがtrueならactiveとして扱う（法人と同じ規則）。
  select f.organization_id, coalesce(f.status, case when f.is_active then 'active' end)
    into v_organization_id, v_status_before
  from offices f
  where f.id = p_office_id
  for update;

  if not found then
    raise exception 'office not found: %', p_office_id
      using errcode = 'P0002';
  end if;

  if v_organization_id is null then
    raise exception 'office % has no organization', p_office_id
      using errcode = '22023';
  end if;

  if v_status_before is distinct from 'active' then
    raise exception 'cannot suspend office in status %: only an active office can be suspended', v_status_before
      using errcode = '22023';
  end if;

  select o.management_number into v_management_number
  from organizations o
  where o.id = v_organization_id;

  -- ログインの遮断は offices.is_active（本体248）で行われる。statusは表示用のラベル。
  update offices
  set status = 'suspended', is_active = false, updated_at = now()
  where id = p_office_id;

  insert into console.contract_lifecycle_log (
    organization_id, office_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  values (
    v_organization_id, p_office_id, v_management_number, 'suspended', v_status_before, 'suspended', p_reason, p_applied_by
  )
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return query select p_office_id, 'suspended'::text, v_log_id;
end;
$$;

revoke execute on function console.fn_suspend_office(uuid, text, text) from public, anon, authenticated, service_role;
alter function console.fn_suspend_office(uuid, text, text) owner to sobae_onboarding_executor;
grant execute on function console.fn_suspend_office(uuid, text, text) to sobae_ops_executor;

-- (3) 事業所の利用再開
create or replace function console.fn_reactivate_office(
  p_office_id uuid,
  p_reason text,
  p_applied_by text
)
returns table (
  office_id uuid,
  status text,
  log_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_status_before text;
  v_management_number text;
  v_log_id uuid;
begin
  perform set_config('app._procedure_context', 'true', true);

  select f.organization_id, coalesce(f.status, case when f.is_active then 'active' end)
    into v_organization_id, v_status_before
  from offices f
  where f.id = p_office_id
  for update;

  if not found then
    raise exception 'office not found: %', p_office_id
      using errcode = 'P0002';
  end if;

  if v_organization_id is null then
    raise exception 'office % has no organization', p_office_id
      using errcode = '22023';
  end if;

  if v_status_before is distinct from 'suspended' then
    raise exception 'cannot reactivate office in status %: only a suspended office can be reactivated', v_status_before
      using errcode = '22023';
  end if;

  select o.management_number into v_management_number
  from organizations o
  where o.id = v_organization_id;

  update offices
  set status = 'active', is_active = true, updated_at = now()
  where id = p_office_id;

  insert into console.contract_lifecycle_log (
    organization_id, office_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  values (
    v_organization_id, p_office_id, v_management_number, 'reactivated', v_status_before, 'active', p_reason, p_applied_by
  )
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return query select p_office_id, 'active'::text, v_log_id;
end;
$$;

revoke execute on function console.fn_reactivate_office(uuid, text, text) from public, anon, authenticated, service_role;
alter function console.fn_reactivate_office(uuid, text, text) owner to sobae_onboarding_executor;
grant execute on function console.fn_reactivate_office(uuid, text, text) to sobae_ops_executor;

-- (5) fn_apply_onboarding：新規の事業所を status='active'、contract_start_date=法人の契約開始日で作る。
create or replace function console.fn_apply_onboarding(p_payload jsonb, p_applied_by text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_application_id text := p_payload ->> 'application_id';
  v_organization_id uuid;
  v_office jsonb;
  v_reg jsonb;
  v_office_id uuid;
  v_office_code_to_id jsonb := '{}'::jsonb;
  v_admin jsonb := p_payload -> 'initial_admin';
  v_admin_office_id uuid;
  v_staff_id uuid;
  v_role_code text := coalesce(v_admin ->> 'role_code', 'admin');
  v_role_id integer;
  v_employment_type text := v_admin ->> 'employment_type';
  v_service_type_id smallint;
  v_system_user_id uuid;
  v_log_id uuid;
begin
  if v_application_id is null or v_application_id = '' then
    raise exception 'application_id is required' using errcode = '22023';
  end if;

  if exists (select 1 from console.contract_lifecycle_log where application_id = v_application_id) then
    raise exception 'application % has already been applied', v_application_id
      using errcode = '23505';
  end if;

  if v_role_code not in ('admin', 'supervisor', 'staff') then
    raise exception 'invalid initial_admin.role_code: %', v_role_code using errcode = '22023';
  end if;

  select id into v_role_id from roles where code = v_role_code;
  if v_role_id is null then
    raise exception 'role not found in roles table: %', v_role_code using errcode = '22023';
  end if;

  -- 新規：staff.employment_typeのCHECK制約と同じ許可リストを、INSERT実行前に
  -- 検証する。role_codeチェックと同じパターン（許可リスト外なら22023で
  -- raise）。空文字はfrontend側でundefinedに変換される前提なので、ここでは
  -- NULLのみ許容し、それ以外は許可リスト厳格一致とする。
  if v_employment_type is not null
     and v_employment_type not in ('full_time_excl', 'full_time_conc', 'part_time_excl', 'part_time_conc') then
    raise exception 'invalid initial_admin.employment_type: %', v_employment_type using errcode = '22023';
  end if;

  -- Sobae_Works本体のRLSポリシー（FORCE ROW LEVEL SECURITY）がこのセッション変数を
  -- 前提にしている。proc_create_staff等、本体側のprocedureと同じパターン。
  perform set_config('app._procedure_context', 'true', true);

  insert into organizations (
    name, login_code, postal_code, address, phone, fax, email,
    management_number, contract_start_date, status
  )
  values (
    p_payload -> 'organization' ->> 'name',
    p_payload -> 'organization' ->> 'login_code',
    p_payload -> 'organization' ->> 'postal_code',
    p_payload -> 'organization' ->> 'address',
    p_payload -> 'organization' ->> 'phone',
    p_payload -> 'organization' ->> 'fax',
    p_payload -> 'organization' ->> 'email',
    p_payload -> 'organization' ->> 'management_number',
    (p_payload -> 'organization' ->> 'contract_start_date')::date,
    'active'
  )
  returning id into v_organization_id;

  for v_office in select jsonb_array_elements(p_payload -> 'offices')
  loop
    -- 事業所の契約ライフサイクル（本体migration 251の列）：新規の事業所はactiveで始まり、契約開始日は
    -- 法人と同じ日付にする（フォームの契約開始日は法人単位の1つだけ）。
    insert into offices (
      organization_id, code, name, postal_code, address, phone, fax, email, display_name,
      status, contract_start_date
    )
    values (
      v_organization_id,
      v_office ->> 'code',
      v_office ->> 'name',
      v_office ->> 'postal_code',
      v_office ->> 'address',
      v_office ->> 'phone',
      v_office ->> 'fax',
      v_office ->> 'email',
      v_office ->> 'display_name',
      'active',
      (p_payload -> 'organization' ->> 'contract_start_date')::date
    )
    returning id into v_office_id;

    v_office_code_to_id := v_office_code_to_id || jsonb_build_object(v_office ->> 'code', v_office_id::text);

    for v_reg in select jsonb_array_elements(coalesce(v_office -> 'service_registrations', '[]'::jsonb))
    loop
      select id into v_service_type_id from service_types where code = v_reg ->> 'service_code';
      if v_service_type_id is null then
        raise exception 'unknown initial_admin service_code: %', v_reg ->> 'service_code'
          using errcode = '22023';
      end if;

      insert into office_service_registrations (
        office_id, service_type_id, is_enabled, provider_number, service_office_name
      )
      values (
        v_office_id, v_service_type_id, true,
        v_reg ->> 'provider_number', v_reg ->> 'service_office_name'
      );
    end loop;
  end loop;

  v_admin_office_id := (v_office_code_to_id ->> (v_admin ->> 'office_code'))::uuid;
  if v_admin_office_id is null then
    raise exception 'initial_admin.office_code % does not match any office in this application', v_admin ->> 'office_code'
      using errcode = '22023';
  end if;

  if v_admin ->> 'last_name' is null or trim(v_admin ->> 'last_name') = '' then
    raise exception 'initial_admin.last_name is required' using errcode = '22023';
  end if;
  if v_admin ->> 'first_name' is null or trim(v_admin ->> 'first_name') = '' then
    raise exception 'initial_admin.first_name is required' using errcode = '22023';
  end if;
  if v_admin ->> 'login_id' is null or trim(v_admin ->> 'login_id') = '' then
    raise exception 'initial_admin.login_id is required' using errcode = '22023';
  end if;
  if v_admin ->> 'password_hash' is null or trim(v_admin ->> 'password_hash') = '' then
    raise exception 'initial_admin.password_hash is required' using errcode = '22023';
  end if;

  -- 新規organizationを同一トランザクション内で今まさに作った直後なので、他セッションが
  -- このorganization_idに対して同時に職員登録することはあり得ない。本体のproc_create_staff
  -- が行うFOR UPDATEロック採番と等価の結果を、ロック無しで安全に決め打ちできる。
  insert into staff (
    office_id, organization_id, org_staff_number,
    last_name, first_name, last_name_kana, first_name_kana,
    role, phone, email, employment_type, postal_code, address, hire_date
  ) values (
    v_admin_office_id, v_organization_id, 1,
    trim(v_admin ->> 'last_name'), trim(v_admin ->> 'first_name'),
    nullif(trim(coalesce(v_admin ->> 'last_name_kana', '')), ''),
    nullif(trim(coalesce(v_admin ->> 'first_name_kana', '')), ''),
    v_role_code,
    nullif(trim(coalesce(v_admin ->> 'phone', '')), ''),
    nullif(lower(trim(coalesce(v_admin ->> 'email', ''))), ''),
    nullif(v_admin ->> 'employment_type', ''),
    v_admin ->> 'postal_code',
    nullif(trim(coalesce(v_admin ->> 'address', '')), ''),
    (v_admin ->> 'hire_date')::date
  )
  returning id into v_staff_id;

  update organizations set next_staff_number = 2 where id = v_organization_id;

  insert into system_users (office_id, staff_id, role_id, login_id, email, password_hash, is_active)
  values (
    v_admin_office_id, v_staff_id, v_role_id,
    lower(trim(v_admin ->> 'login_id')), null, v_admin ->> 'password_hash', true
  )
  returning id into v_system_user_id;

  insert into console.contract_lifecycle_log (
    organization_id, management_number, application_id, event_type, status_before, status_after, contract_date, applied_by
  )
  values (
    v_organization_id,
    p_payload -> 'organization' ->> 'management_number',
    v_application_id,
    'created',
    null,
    'active',
    (p_payload -> 'organization' ->> 'contract_start_date')::date,
    p_applied_by
  )
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return jsonb_build_object(
    'organization_id', v_organization_id,
    'staff_id', v_staff_id,
    'system_user_id', v_system_user_id,
    'log_id', v_log_id
  );
end;
$$;

revoke execute on function console.fn_apply_onboarding(jsonb, text) from public, anon, authenticated, service_role;
alter function console.fn_apply_onboarding(jsonb, text) owner to sobae_onboarding_executor;
grant execute on function console.fn_apply_onboarding(jsonb, text) to sobae_ops_executor;
