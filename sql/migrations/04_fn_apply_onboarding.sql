-- 目的：organization + office(s) + サービス種別登録 + 初期admin(staff/system_user) を
--       1トランザクションで作成し、contract_lifecycle_logへ記録するSECURITY DEFINER関数。
--       dry-runと実applyの両方から呼ばれる共通実装。
-- 作成日：2026-08-17（2026-08-19: Sobae_Works本体の実スキーマ・実procedureを確認した
--       上で全面改訂。旧版はテーブル名が単数形で、認証をSupabase Auth(auth_uid)前提に
--       していたが、どちらも実態と異なることが判明したため作り直した。詳細は会話ログ参照）
-- 依存する既存オブジェクト：
--   01_roles.sql, 02_organization_alter.sql, 03_contract_lifecycle_log.sql
--   Sobae_Works本体スキーマ（pg_dump --schema-onlyで実在確認済み）：
--     organizations, offices, staff, system_users, roles, service_types,
--     office_service_registrations
--
-- 実スキーマ確認で分かった前提（旧版からの主な変更点）：
--   * この関数の所有者はsobae_ops_executorではなく、専用のsobae_onboarding_executor
--     （01_roles.sqlで新設）。organizations/offices/staff/system_users/
--     office_service_registrations/roles/service_typesへの実際のGRANTはSobae_Works
--     本体側に依頼が必要（本体の既存sobae_app_executorを流用せず専用ロールにしたのは、
--     本体アプリ全体が持つ広い権限にこの関数を相乗りさせないため）。
--   * テーブル名は単数形ではなく複数形（organization→organizations 等）
--   * system_usersにauth_uid列は存在しない。認証はlogin_id + password_hash（bcrypt、
--     アプリ側で計算してこの関数にはハッシュ済みの値を渡す）+ role_id（rolesへのFK）
--     + auth_version（JWT失効用カウンタ、デフォルト1のまま）という自前方式。
--     Supabase Auth Admin APIを呼ぶ「Step 2」は不要になった——login_id/password_hash
--     はどちらもアプリ側で外部API呼び出し無しに用意できるため、dry-runの時点から常に
--     含めてよい（後述の通り、これによりlogin_id重複チェックもdry-runで検証できる）。
--   * organizations/offices/staff/system_usersはFORCE ROW LEVEL SECURITYが有効。
--     Sobae_Works本体のRLSポリシーはINSERT/UPDATEを
--     current_setting('app._procedure_context', true) = 'true' の間だけ許可する
--     設計（本体のproc_create_staff等が使っているのと同じパターン）。SECURITY DEFINER
--     でもこのセッション変数をセットしないと弾かれるため、本体のprocedureに倣い
--     set_config('app._procedure_context', 'true', true) を書き込み区間だけ立てる。
--   * staff.organization_id / staff.org_staff_number は NOT NULL。org_staff_number は
--     本来 proc_create_staff が organizations.next_staff_number を FOR UPDATE ロックの
--     上で採番するが、この関数は同一トランザクション内で今まさに作った新規organizationに
--     対してしか職員を作らないため、他セッションと競合し得ず、常に1決め打ちでよい。
--   * staff.role（admin/supervisor/staffのCHECK付きtext）と system_users.role_id
--     （rolesテーブルへのFK）は別々の列。初期adminなら両方 'admin' に揃える。
--   * サービス種別の事業所ごとの登録は office_service_registrations
--     （office_id, service_type_id, is_enabled, provider_number, service_office_name）。
--     同名で似た office_service_types という廃止済み旧テーブルも実在するが、
--     provider_number列が無く現行コードから一切参照されていないため使わない
--     （Sobae_Works本体 146_harden_remaining_tenant_rls.sql のコメントで廃止済みと確認）。
--     この関数がINSERTする列以外の書き込み用procedureはSobae_Works本体にも存在しない
--     （proc_upsert_office_service_registration相当は本体側にも未実装、と確認済み）。
--   * organizations/offices本体を新規作成するprocedureはSobae_Works本体に1件も無い
--     （調査済み）。つまりこの関数がその役割を初めて担う。既存の作法を踏襲できるのは
--     staff/system_users部分のみ（proc_create_staff, proc_create_system_user_for_staff
--     を参考にした）。
--   * organizations.is_active（既存bool、コメント上「falseの場合はSOBAE側で無効化した
--     法人」）と、こちらで追加したstatus（text）は別列。この関数はstatus='active'で
--     作成するのみ（is_activeは新規行のデフォルトtrueのままでよい）。suspend/reactivate/
--     terminateでの同期は06〜08側の責務。
--
-- ロールバック方針：drop function if exists fn_apply_onboarding(jsonb, text);
--   （実行するとsobae_ops_executorのEXECUTE権限も自動的に失われる）
--
-- ONBOARDING FLOW（確定）：
--   1. dry-run:  fn_dryrun_onboarding() を呼ぶ。login_id/password_hashは既に計算できる
--                ため、この時点から含めてよい（含めるとlogin_id重複もここで検知できる）。
--   2. apply:    fn_apply_onboarding() を同じpayloadで呼ぶ。
--   3. 冪等性/再実行: application_id の重複チェックにより、applyが「未成功」の間は同じ
--                application_idで何度でも安全に再実行できる（失敗時は関数全体が
--                自動ロールバックされる）。既に成功したapplyの再実行は明確なエラーで
--                拒否される（無言で成功扱いにはしない）。
--
-- PAYLOAD CONTRACT — backend/src/schema/application.ts (Zod) が正になる想定。現時点では
-- この関数がドラフトとして定義している。
--
--   {
--     "application_id": "string, required — 申請ごとに一意。成功済みの再送は拒否される",
--     "organization": {
--       "name": "string, required", "login_code": "string, optional",
--       "management_number": "string, required(UNIQUE)",
--       "contract_start_date": "YYYY-MM-DD, required",
--       "postal_code": "string, optional", "address": "string, optional",
--       "phone": "string, optional", "fax": "string, optional", "email": "string, optional"
--     },
--     "offices": [
--       {
--         "code": "string, required(UNIQUE across offices)", "name": "string, required",
--         "postal_code": "string, optional", "address": "string, optional",
--         "phone": "string, optional", "fax": "string, optional",
--         "email": "string, optional", "display_name": "string, optional",
--         "service_registrations": [
--           { "service_code": "string — service_types.code。未知のcodeはエラー",
--             "provider_number": "string, optional — 事業所番号（提供者番号）",
--             "service_office_name": "string, optional — サービス別帳票表示名" }
--         ]
--       }
--     ],
--     "initial_admin": {
--       "office_code": "string — must match one of offices[].code above",
--       "last_name": "string, required", "first_name": "string, required",
--       "last_name_kana": "string, optional", "first_name_kana": "string, optional",
--       "employment_type": "string, optional",
--       "phone": "string, optional", "email": "string, optional — staffの連絡先。
--                 system_users.emailは旧認証項目のためNULLのまま登録する",
--       "postal_code": "string, optional(7桁数字)", "address": "string, optional",
--       "hire_date": "YYYY-MM-DD, optional",
--       "role_code": "'admin'|'supervisor'|'staff', optional. 省略時'admin'",
--       "login_id": "string, required — 半角英小文字・数字・ハイフンのみ。一意（大文字小文字
--                    区別なし）。命名規則(login_code-ローマ字姓+3桁等)はこの関数の責務外、
--                    呼び出し側が決めた値をそのまま使う",
--       "password_hash": "string, required — bcrypt等でアプリ側が計算済みのハッシュ値。
--                         平文パスワードはこの関数に渡さない・DBに保存しない"
--     }
--   }
--
-- KNOWN GAP: 「admin重複確認」（同一人物の初期admin二重登録の検知）は、login_idの
-- UNIQUE制約により、同じlogin_idを使い回そうとした場合のみ自然に検知される
-- （dry-run時点でも検知可能——旧版のGAPはこれで解消）。氏名や連絡先が同じでも
-- login_idが異なれば別人として扱われる点は変わらず未解決。

create or replace function fn_apply_onboarding(p_payload jsonb, p_applied_by text)
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
  v_service_type_id smallint;
  v_system_user_id uuid;
  v_log_id uuid;
begin
  if v_application_id is null or v_application_id = '' then
    raise exception 'application_id is required' using errcode = '22023';
  end if;

  if exists (select 1 from contract_lifecycle_log where application_id = v_application_id) then
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

  insert into contract_lifecycle_log (
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

-- SECURITY DEFINER関数は所有者の権限で実行される。organizations/offices等への実際の
-- INSERT/UPDATE権限を持つのは呼び出し側のsobae_ops_executorではなく、この専用ロール
-- （01_roles.sql参照。Sobae_Works本体側に必要なGRANT/RLSポリシーを別途依頼する）。
alter function fn_apply_onboarding(jsonb, text) owner to sobae_onboarding_executor;
grant execute on function fn_apply_onboarding(jsonb, text) to sobae_ops_executor;
