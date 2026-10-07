-- 目的：fn_apply_onboarding()にinitial_admin.employment_typeの事前チェックを追加する。
--       これまではPostgresのCHECK制約（staff_employment_type_check）が違反時に
--       生成する機械的なエラー文（"new row for relation \"staff\" violates check
--       constraint \"staff_employment_type_check\""）がそのままdry-run/applyの
--       エラーとして利用者に返っていた。既存のrole_codeチェック（本ファイルの元と
--       なった04_fn_apply_onboarding.sqlの該当箇所）と同じパターンで、INSERT実行
--       前に許可コードかどうかを関数自身が検証し、読みやすいエラー文を返すようにする。
--       Postgres側のCHECK制約自体は変更せず残す（この関数を経由しない書き込みが
--       将来あった場合の保険として機能する）。
-- 作成日：2026-09-14
-- 変更履歴：2026-10-07 consoleスキーマ化（再ベースライン。適用済みの管理環境が無いため既存ファイルを
--       直接書き直した。詳細は README.md §5）。関数のロジックは無変更。
-- 依存する既存オブジェクト：04_fn_apply_onboarding.sql（同じ関数をcreate or replaceで
--       上書きする。関数本体はそちらのコピーに事前チェック1ブロックを追加しただけで、
--       他のロジックは変更していない）
-- 許可コードの出典：staff.employment_typeのCHECK制約定義（pg_get_constraintdefで
--       2026-09-14に実データベースから直接確認）。介護保険の雇用形態区分
--       （常勤専従・常勤兼務・非常勤専従・非常勤兼務）をコード化したものと推定。
-- ロールバック方針：04_fn_apply_onboarding.sqlの内容でcreate or replaceし直す（console.fn_apply_onboarding）
--       （事前チェックのブロックを取り除いたバージョンに戻す）。

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
    insert into offices (
      organization_id, code, name, postal_code, address, phone, fax, email, display_name
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
      v_office ->> 'display_name'
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

-- create or replaceは所有者・権限を維持するため、04_fn_apply_onboarding.sqlの末尾にあった
-- alter function owner to / grant execute はここでは不要（再実行不要）。
