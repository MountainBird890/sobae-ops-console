import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  applyOnboarding,
  dryRunOnboarding,
  fetchServiceTypes,
  type OnboardingApplyResult,
  type OnboardingDryRunResult,
  type OnboardingPayload,
  type ServiceType,
} from '../lib/api'

// 初期管理者の権限は「管理者」のみ（サ責・スタッフは不要、2026-09-18打合せ決定）。画面では選択させず、
// 固定値として送る。バックエンドの enum と DB 関数は変更しない。
const INITIAL_ADMIN_ROLE_CODE = 'admin' as const

// 管理番号は本体のログインコード（organizations.login_code）になる。形式と長さはバックエンドと同じ。
const MANAGEMENT_NUMBER_RE = /^[A-Za-z0-9-]+$/
const MANAGEMENT_NUMBER_MAX = 30

// The five service rows always shown on the office form, matched against the
// backend's service_types by name (fetchServiceTypes) to resolve service_code.
const FIXED_SERVICE_NAMES = ['訪問介護', '重度訪問介護', '居宅介護', '同行援護', '行動援護'] as const

interface ServiceRegistrationForm {
  service_name: string
  enabled: boolean
  provider_number: string
  service_office_name: string
}

interface OfficeForm {
  code: string
  name: string
  postal_code: string
  address: string
  phone: string
  fax: string
  email: string
  service_registrations: ServiceRegistrationForm[]
}

interface OrganizationForm {
  name: string
  postal_code: string
  address: string
  phone: string
  fax: string
  email: string
  management_number: string
  contract_start_date: string
}

// 画面に出す項目だけ（所属事業所・姓名・姓名カナ・ログインID・初期パスワード）。権限は固定値、
// 雇用形態・入社日・電話・メール・郵便番号・住所は画面から非表示（登録ロジックは温存）。
interface InitialAdminForm {
  office_code: string
  last_name: string
  first_name: string
  last_name_kana: string
  first_name_kana: string
  login_id: string
  password: string
  password_confirm: string
}

function emptyServiceRegistrations(): ServiceRegistrationForm[] {
  return FIXED_SERVICE_NAMES.map((name) => ({
    service_name: name,
    enabled: false,
    provider_number: '',
    service_office_name: '',
  }))
}

function emptyOffice(): OfficeForm {
  return {
    code: '',
    name: '',
    postal_code: '',
    address: '',
    phone: '',
    fax: '',
    email: '',
    service_registrations: emptyServiceRegistrations(),
  }
}

function emptyOrganization(): OrganizationForm {
  return {
    name: '',
    postal_code: '',
    address: '',
    phone: '',
    fax: '',
    email: '',
    management_number: '',
    contract_start_date: '',
  }
}

function emptyInitialAdmin(): InitialAdminForm {
  return {
    office_code: '',
    last_name: '',
    first_name: '',
    last_name_kana: '',
    first_name_kana: '',
    login_id: '',
    password: '',
    password_confirm: '',
  }
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const inputClassName =
  'block w-full box-border rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
const fieldClassName = 'flex flex-col gap-1 text-sm text-slate-700'
const sectionClassName = 'mb-4 rounded-md border border-slate-200 p-4'
const gridClassName = 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3'

// Renders the message for one payload field (e.g. "organization.postal_code",
// "offices.0.postal_code") if the backend's fieldErrors map has one. Placed
// inside each <label> (fieldClassName is a flex column) so it stacks directly
// under that field's input without disturbing the surrounding grid layout.
function FieldError({ path, fieldErrors }: { path: string; fieldErrors: Record<string, string> }) {
  const message = fieldErrors[path]
  if (!message) return null
  return (
    <p role="alert" className="m-0 text-xs text-red-600">
      {message}
    </p>
  )
}

// One labelled text input with its inline field error (see FieldError). `required` only adds the
// "*" marker; the real checks are canCheck (button) and the backend's Zod schema.
function TextField({
  label,
  hint,
  required = true,
  type = 'text',
  value,
  onChange,
  path,
  fieldErrors,
}: {
  label: string
  hint?: string
  required?: boolean
  type?: string
  value: string
  onChange: (value: string) => void
  path: string
  fieldErrors: Record<string, string>
}) {
  return (
    <label className={fieldClassName}>
      {label}
      {required ? ' *' : ''}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
      <input type={type} className={inputClassName} value={value} onChange={(e) => onChange(e.target.value)} />
      <FieldError path={path} fieldErrors={fieldErrors} />
    </label>
  )
}

export function Onboarding() {
  const [applicationId] = useState(() => crypto.randomUUID())
  const [organization, setOrganization] = useState(emptyOrganization)
  const [offices, setOffices] = useState<OfficeForm[]>([emptyOffice()])
  const [initialAdmin, setInitialAdmin] = useState(emptyInitialAdmin)

  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [serviceTypesError, setServiceTypesError] = useState<string | null>(null)

  const [dryRunResult, setDryRunResult] = useState<OnboardingDryRunResult | null>(null)
  const [validatedPayloadJson, setValidatedPayloadJson] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [applyResult, setApplyResult] = useState<OnboardingApplyResult | null>(null)

  useEffect(() => {
    fetchServiceTypes()
      .then((data) => setServiceTypes(data.service_types))
      .catch((err: unknown) => {
        setServiceTypesError(err instanceof ApiError ? err.message : 'サービス種別の取得に失敗しました')
      })
  }, [])

  // Only office A gets a code by default; keep the initial admin's office
  // selection pointed at it until the user picks otherwise.
  useEffect(() => {
    const codes = offices.map((o) => o.code.trim()).filter((c) => c !== '')
    if (!codes.includes(initialAdmin.office_code) && codes.length > 0) {
      setInitialAdmin((prev) => ({ ...prev, office_code: codes[0] }))
    }
  }, [offices, initialAdmin.office_code])

  const passwordMismatch =
    initialAdmin.password.length > 0 &&
    initialAdmin.password_confirm.length > 0 &&
    initialAdmin.password !== initialAdmin.password_confirm

  function buildPayload(): OnboardingPayload {
    return {
      application_id: applicationId,
      organization: {
        name: organization.name.trim(),
        postal_code: organization.postal_code.trim(),
        address: organization.address.trim(),
        phone: organization.phone.trim(),
        fax: trimOrUndefined(organization.fax),
        email: organization.email.trim(),
        management_number: organization.management_number.trim(),
        contract_start_date: organization.contract_start_date,
      },
      offices: offices.map((office) => ({
        code: office.code.trim(),
        name: office.name.trim(),
        postal_code: office.postal_code.trim(),
        address: office.address.trim(),
        phone: office.phone.trim(),
        fax: trimOrUndefined(office.fax),
        email: office.email.trim(),
        service_registrations: office.service_registrations
          .filter((reg) => reg.enabled)
          .map((reg) => ({
            service_code: serviceTypes.find((st) => st.name === reg.service_name)?.code ?? '',
            provider_number: trimOrUndefined(reg.provider_number),
            service_office_name: trimOrUndefined(reg.service_office_name),
          }))
          .filter((reg) => reg.service_code !== ''),
      })),
      initial_admin: {
        office_code: initialAdmin.office_code.trim(),
        last_name: initialAdmin.last_name.trim(),
        first_name: initialAdmin.first_name.trim(),
        last_name_kana: initialAdmin.last_name_kana.trim(),
        first_name_kana: initialAdmin.first_name_kana.trim(),
        role_code: INITIAL_ADMIN_ROLE_CODE,
        login_id: initialAdmin.login_id.trim().toLowerCase(),
        password: initialAdmin.password,
      },
    }
  }

  // Re-serialized on every render, but this form is small enough (a handful
  // of offices at most) that it's not worth memoizing beyond re-running per
  // render — it's only used to detect "did the form change since the last
  // successful dry-run".
  const payloadJson = JSON.stringify(buildPayload())
  const isValidated = dryRunResult?.valid === true && validatedPayloadJson === payloadJson

  const managementNumberInvalid =
    organization.management_number.trim() !== '' &&
    (organization.management_number.trim().length > MANAGEMENT_NUMBER_MAX || !MANAGEMENT_NUMBER_RE.test(organization.management_number.trim()))

  // 法人・事業所の項目は全部必須。ただしFAXは任意、事業所の「表示名」は画面に出さないので対象外。
  const canCheck = useMemo(() => {
    const filled = (v: string) => v.trim() !== ''
    const o = organization
    if (![o.name, o.management_number, o.postal_code, o.address, o.phone, o.email].every(filled) || !o.contract_start_date) return false
    if (managementNumberInvalid) return false
    if (offices.length === 0) return false
    if (offices.some((f) => ![f.code, f.name, f.postal_code, f.address, f.phone, f.email].every(filled))) return false
    const a = initialAdmin
    if (![a.office_code, a.last_name, a.first_name, a.last_name_kana, a.first_name_kana, a.login_id].every(filled) || !a.password) return false
    if (passwordMismatch) return false
    return true
  }, [organization, offices, initialAdmin, passwordMismatch, managementNumberInvalid])

  function updateOffice(index: number, patch: Partial<OfficeForm>) {
    setOffices((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  }

  function addOffice() {
    setOffices((prev) => [...prev, emptyOffice()])
  }

  function removeOffice(index: number) {
    setOffices((prev) => prev.filter((_, i) => i !== index))
  }

  function updateServiceRegistration(officeIndex: number, regIndex: number, patch: Partial<ServiceRegistrationForm>) {
    setOffices((prev) =>
      prev.map((o, i) =>
        i === officeIndex
          ? { ...o, service_registrations: o.service_registrations.map((r, ri) => (ri === regIndex ? { ...r, ...patch } : r)) }
          : o,
      ),
    )
  }

  function toggleServiceRegistration(officeIndex: number, regIndex: number) {
    setOffices((prev) =>
      prev.map((o, i) =>
        i === officeIndex
          ? { ...o, service_registrations: o.service_registrations.map((r, ri) => (ri === regIndex ? { ...r, enabled: !r.enabled } : r)) }
          : o,
      ),
    )
  }

  async function handleCheck() {
    setChecking(true)
    setSubmitError(null)
    setFieldErrors({})
    setDryRunResult(null)
    try {
      const payload = buildPayload()
      const result = await dryRunOnboarding(payload)
      setDryRunResult(result)
      setValidatedPayloadJson(JSON.stringify(payload))
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        // Field-level messages are shown inline under each input (see
        // <FieldError> below); this banner just flags that something needs
        // fixing, since with a long form the offending field may be off-screen.
        setFieldErrors(err.fieldErrors)
        setSubmitError('入力内容に誤りがあります。該当する項目のエラーメッセージをご確認ください。')
      } else {
        setSubmitError(err instanceof ApiError ? err.message : '確認に失敗しました')
      }
    } finally {
      setChecking(false)
    }
  }

  async function handleApply() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = buildPayload()
      const result = await applyOnboarding(payload)
      setApplyResult(result)
    } catch (err) {
      // The detailed/technical reason (SQLSTATE, raw DB message, etc.) is
      // only useful for debugging — log it to the console rather than the
      // screen, and show a generic notice so the user at least knows the
      // registration didn't go through.
      if (err instanceof ApiError) {
        console.error('Failed to apply onboarding', err.status, err.detail ?? err.message)
        setSubmitError(err.fieldErrors ? err.message : '登録に失敗しました。時間をおいて再度お試しください。')
        if (err.fieldErrors) setFieldErrors(err.fieldErrors)
      } else {
        console.error('Failed to apply onboarding', err)
        setSubmitError('登録に失敗しました。時間をおいて再度お試しください。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (applyResult) {
    return (
      <div>
        <h1 className="text-2xl font-medium text-slate-900">新規契約登録</h1>
        <p className="font-semibold text-green-700">登録が完了しました。</p>
        <p>
          <Link to={`/organizations/${applyResult.organization.organization_id}`} className="text-blue-600 hover:underline">
            作成した事業所を見る →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-medium text-slate-900">新規契約登録</h1>

      <section className={sectionClassName}>
        <h2 className="mt-0 text-base font-medium text-slate-900">法人情報</h2>
        <p className="mt-0 text-xs text-slate-500">FAX番号以外は必須項目です。</p>
        <div className={gridClassName}>
          <TextField label="法人名" value={organization.name} path="organization.name" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, name: v }))} />
          <TextField
            label="管理番号"
            hint={`半角英数字とハイフン、${MANAGEMENT_NUMBER_MAX}文字以内（本体のログインコードとしても使われます。大文字小文字は区別されません）`}
            value={organization.management_number}
            path="organization.management_number"
            fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, management_number: v }))}
          />
          <TextField label="契約開始日" type="date" value={organization.contract_start_date} path="organization.contract_start_date" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, contract_start_date: v }))} />
          <TextField label="郵便番号（7桁）" value={organization.postal_code} path="organization.postal_code" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, postal_code: v }))} />
          <TextField label="住所" value={organization.address} path="organization.address" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, address: v }))} />
          <TextField label="電話番号" value={organization.phone} path="organization.phone" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, phone: v }))} />
          <TextField label="FAX番号" required={false} value={organization.fax} path="organization.fax" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, fax: v }))} />
          <TextField label="メールアドレス" type="email" value={organization.email} path="organization.email" fieldErrors={fieldErrors}
            onChange={(v) => setOrganization((prev) => ({ ...prev, email: v }))} />
        </div>
        {managementNumberInvalid && (
          <p role="alert" className="text-sm text-red-600">
            管理番号は半角英数字とハイフンのみ、{MANAGEMENT_NUMBER_MAX}文字以内で入力してください
          </p>
        )}
      </section>

      <section className={sectionClassName}>
        <div className="flex items-center justify-between">
          <h2 className="mt-0 text-base font-medium text-slate-900">事業所</h2>
          <button
            type="button"
            onClick={addOffice}
            className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + 事業所を追加
          </button>
        </div>

        {offices.map((office, officeIndex) => (
          <div key={officeIndex} className="mb-3 rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-slate-900">事業所 {officeIndex + 1}</strong>
              {offices.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOffice(officeIndex)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  削除
                </button>
              )}
            </div>

            <div className={gridClassName}>
              <TextField label="事業所コード" hint="全事業所で一意" value={office.code} path={`offices.${officeIndex}.code`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { code: v })} />
              <TextField label="事業所名" value={office.name} path={`offices.${officeIndex}.name`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { name: v })} />
              <TextField label="郵便番号（7桁）" value={office.postal_code} path={`offices.${officeIndex}.postal_code`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { postal_code: v })} />
              <TextField label="住所" value={office.address} path={`offices.${officeIndex}.address`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { address: v })} />
              <TextField label="電話番号" value={office.phone} path={`offices.${officeIndex}.phone`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { phone: v })} />
              <TextField label="FAX番号" required={false} value={office.fax} path={`offices.${officeIndex}.fax`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { fax: v })} />
              <TextField label="メールアドレス" type="email" value={office.email} path={`offices.${officeIndex}.email`} fieldErrors={fieldErrors}
                onChange={(v) => updateOffice(officeIndex, { email: v })} />
            </div>

            <div className="mt-3">
              <span className={fieldClassName}>提供サービス</span>
              {serviceTypesError && (
                <p role="alert" className="text-sm text-red-600">
                  {serviceTypesError}
                </p>
              )}

              <div className="mt-2 grid grid-cols-[minmax(120px,auto)_1fr_1fr_auto] items-center gap-x-3 gap-y-2">
                <span />
                <span className="text-xs font-medium text-slate-500">事業所番号</span>
                <span className="text-xs font-medium text-slate-500">事業所名</span>
                <span />

                {office.service_registrations.map((reg, regIndex) => (
                  <div key={reg.service_name} className="contents">
                    <span className="text-sm text-slate-700">{reg.service_name}</span>
                    <input
                      placeholder="事業所番号"
                      className={inputClassName}
                      value={reg.provider_number}
                      onChange={(e) => updateServiceRegistration(officeIndex, regIndex, { provider_number: e.target.value })}
                    />
                    <input
                      placeholder="事業所名"
                      className={inputClassName}
                      value={reg.service_office_name}
                      onChange={(e) => updateServiceRegistration(officeIndex, regIndex, { service_office_name: e.target.value })}
                    />
                    <div className="flex overflow-hidden rounded border border-slate-300 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => !reg.enabled && toggleServiceRegistration(officeIndex, regIndex)}
                        className={`px-2.5 py-1.5 ${reg.enabled ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                      >
                        ON
                      </button>
                      <button
                        type="button"
                        onClick={() => reg.enabled && toggleServiceRegistration(officeIndex, regIndex)}
                        className={`border-l border-slate-300 px-2.5 py-1.5 ${!reg.enabled ? 'bg-slate-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className={sectionClassName}>
        <h2 className="mt-0 text-base font-medium text-slate-900">初期管理者</h2>
        <div className={gridClassName}>
          <label className={fieldClassName}>
            所属事業所 *
            <select
              className={inputClassName}
              value={initialAdmin.office_code}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, office_code: e.target.value }))}
            >
              <option value="">選択してください</option>
              {offices
                .map((o) => o.code.trim())
                .filter((c) => c !== '')
                .map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
            </select>
            <FieldError path="initial_admin.office_code" fieldErrors={fieldErrors} />
          </label>
          <div className={fieldClassName}>
            権限
            <p className="m-0 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">管理者（固定）</p>
          </div>
          <TextField label="姓" value={initialAdmin.last_name} path="initial_admin.last_name" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, last_name: v }))} />
          <TextField label="名" value={initialAdmin.first_name} path="initial_admin.first_name" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, first_name: v }))} />
          <TextField label="姓（カナ）" value={initialAdmin.last_name_kana} path="initial_admin.last_name_kana" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, last_name_kana: v }))} />
          <TextField label="名（カナ）" value={initialAdmin.first_name_kana} path="initial_admin.first_name_kana" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, first_name_kana: v }))} />
        </div>

        <div className={`${gridClassName} mt-3`}>
          <TextField label="ログインID" hint="半角英小文字・数字・ハイフンのみ" value={initialAdmin.login_id} path="initial_admin.login_id" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, login_id: v }))} />
          <TextField label="初期パスワード" hint="8文字以上" type="password" value={initialAdmin.password} path="initial_admin.password" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, password: v }))} />
          <TextField label="初期パスワード（確認）" type="password" value={initialAdmin.password_confirm} path="initial_admin.password_confirm" fieldErrors={fieldErrors}
            onChange={(v) => setInitialAdmin((prev) => ({ ...prev, password_confirm: v }))} />
        </div>
        {passwordMismatch && (
          <p role="alert" className="text-sm text-red-600">
            パスワードが一致しません
          </p>
        )}
      </section>

      {dryRunResult && (
        <section className={`${sectionClassName} ${dryRunResult.valid ? 'border-green-700' : 'border-red-600'}`}>
          {dryRunResult.valid ? (
            <p className="m-0 text-green-700">入力内容は問題ありません。登録を確定できます。</p>
          ) : (
            <div>
              <p className="m-0 mb-2 text-red-600">入力内容にエラーがあります：</p>
              <ul className="m-0 text-red-600">
                {dryRunResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {submitError && (
        <p role="alert" className="text-red-600">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canCheck || checking}
          onClick={handleCheck}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {checking ? '確認中…' : '入力内容を確認'}
        </button>
        <button
          type="button"
          disabled={!isValidated || submitting}
          onClick={handleApply}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? '登録中…' : '登録を確定する'}
        </button>
      </div>
    </div>
  )
}
