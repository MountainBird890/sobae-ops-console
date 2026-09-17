import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  applyOnboarding,
  dryRunOnboarding,
  fetchServiceTypes,
  type OnboardingApplyResult,
  type OnboardingDryRunResult,
  type OnboardingEmploymentTypeCode,
  type OnboardingPayload,
  type OnboardingRoleCode,
  type ServiceType,
} from '../lib/api'

const ROLE_OPTIONS: { value: OnboardingRoleCode; label: string }[] = [
  { value: 'admin', label: '管理者' },
  { value: 'supervisor', label: '責任者・サービス提供責任者' },
  { value: 'staff', label: 'ヘルパー・訪問スタッフ' },
]

const EMPLOYMENT_TYPE_OPTIONS: { value: OnboardingEmploymentTypeCode; label: string }[] = [
  { value: 'full_time_excl', label: '常勤専従' },
  { value: 'full_time_conc', label: '常勤兼務' },
  { value: 'part_time_excl', label: '非常勤専従' },
  { value: 'part_time_conc', label: '非常勤兼務' },
]

interface ServiceRegistrationForm {
  service_code: string
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
  display_name: string
  service_registrations: ServiceRegistrationForm[]
}

interface OrganizationForm {
  name: string
  login_code: string
  postal_code: string
  address: string
  phone: string
  fax: string
  email: string
  management_number: string
  contract_start_date: string
}

interface InitialAdminForm {
  office_code: string
  last_name: string
  first_name: string
  last_name_kana: string
  first_name_kana: string
  employment_type: string
  phone: string
  email: string
  postal_code: string
  address: string
  hire_date: string
  role_code: OnboardingRoleCode
  login_id: string
  password: string
  password_confirm: string
}

function emptyServiceRegistration(): ServiceRegistrationForm {
  return { service_code: '', provider_number: '', service_office_name: '' }
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
    display_name: '',
    service_registrations: [],
  }
}

function emptyOrganization(): OrganizationForm {
  return {
    name: '',
    login_code: '',
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
    employment_type: '',
    phone: '',
    email: '',
    postal_code: '',
    address: '',
    hire_date: '',
    role_code: 'admin',
    login_id: '',
    password: '',
    password_confirm: '',
  }
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const inputStyle = { display: 'block', width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box' as const }
const fieldStyle = { fontSize: '0.85rem', color: '#3a3f47', display: 'flex', flexDirection: 'column' as const, gap: '0.25rem' }
const sectionStyle = { border: '1px solid #d9dce1', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }
const errorColor = '#b3261e'
const successColor = '#1e7a3d'

// Renders the message for one payload field (e.g. "organization.postal_code",
// "offices.0.postal_code") if the backend's fieldErrors map has one. Placed
// inside each <label> (fieldStyle is a flex column) so it stacks directly
// under that field's input without disturbing the surrounding grid layout.
function FieldError({ path, fieldErrors }: { path: string; fieldErrors: Record<string, string> }) {
  const message = fieldErrors[path]
  if (!message) return null
  return (
    <p role="alert" style={{ color: errorColor, fontSize: '0.75rem', margin: 0 }}>
      {message}
    </p>
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
        login_code: trimOrUndefined(organization.login_code),
        postal_code: trimOrUndefined(organization.postal_code),
        address: trimOrUndefined(organization.address),
        phone: trimOrUndefined(organization.phone),
        fax: trimOrUndefined(organization.fax),
        email: trimOrUndefined(organization.email),
        management_number: organization.management_number.trim(),
        contract_start_date: organization.contract_start_date,
      },
      offices: offices.map((office) => ({
        code: office.code.trim(),
        name: office.name.trim(),
        postal_code: trimOrUndefined(office.postal_code),
        address: trimOrUndefined(office.address),
        phone: trimOrUndefined(office.phone),
        fax: trimOrUndefined(office.fax),
        email: trimOrUndefined(office.email),
        display_name: trimOrUndefined(office.display_name),
        service_registrations: office.service_registrations
          .filter((reg) => reg.service_code.trim() !== '')
          .map((reg) => ({
            service_code: reg.service_code.trim(),
            provider_number: trimOrUndefined(reg.provider_number),
            service_office_name: trimOrUndefined(reg.service_office_name),
          })),
      })),
      initial_admin: {
        office_code: initialAdmin.office_code.trim(),
        last_name: initialAdmin.last_name.trim(),
        first_name: initialAdmin.first_name.trim(),
        last_name_kana: trimOrUndefined(initialAdmin.last_name_kana),
        first_name_kana: trimOrUndefined(initialAdmin.first_name_kana),
        employment_type: trimOrUndefined(initialAdmin.employment_type) as OnboardingEmploymentTypeCode | undefined,
        phone: trimOrUndefined(initialAdmin.phone),
        email: trimOrUndefined(initialAdmin.email),
        postal_code: trimOrUndefined(initialAdmin.postal_code),
        address: trimOrUndefined(initialAdmin.address),
        hire_date: trimOrUndefined(initialAdmin.hire_date),
        role_code: initialAdmin.role_code,
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

  const canCheck = useMemo(() => {
    if (!organization.name.trim() || !organization.management_number.trim() || !organization.contract_start_date) return false
    if (offices.length === 0 || offices.some((o) => !o.code.trim() || !o.name.trim())) return false
    if (!initialAdmin.office_code.trim() || !initialAdmin.last_name.trim() || !initialAdmin.first_name.trim()) return false
    if (!initialAdmin.login_id.trim() || !initialAdmin.password) return false
    if (passwordMismatch) return false
    return true
  }, [organization, offices, initialAdmin, passwordMismatch])

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

  function addServiceRegistration(officeIndex: number) {
    setOffices((prev) =>
      prev.map((o, i) =>
        i === officeIndex ? { ...o, service_registrations: [...o.service_registrations, emptyServiceRegistration()] } : o,
      ),
    )
  }

  function removeServiceRegistration(officeIndex: number, regIndex: number) {
    setOffices((prev) =>
      prev.map((o, i) =>
        i === officeIndex ? { ...o, service_registrations: o.service_registrations.filter((_, ri) => ri !== regIndex) } : o,
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
        <h1>新規契約登録</h1>
        <p style={{ color: successColor, fontWeight: 600 }}>登録が完了しました。</p>
        <p>
          <Link to={`/organizations/${applyResult.organization.organization_id}`}>作成した事業所を見る →</Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1>新規契約登録</h1>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>法人情報</h2>
        <div style={gridStyle}>
          <label style={fieldStyle}>
            法人名 *
            <input
              style={inputStyle}
              value={organization.name}
              onChange={(e) => setOrganization((prev) => ({ ...prev, name: e.target.value }))}
            />
            <FieldError path="organization.name" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            管理番号 *
            <input
              style={inputStyle}
              value={organization.management_number}
              onChange={(e) => setOrganization((prev) => ({ ...prev, management_number: e.target.value }))}
            />
            <FieldError path="organization.management_number" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            契約開始日 *
            <input
              type="date"
              style={inputStyle}
              value={organization.contract_start_date}
              onChange={(e) => setOrganization((prev) => ({ ...prev, contract_start_date: e.target.value }))}
            />
            <FieldError path="organization.contract_start_date" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            ログインコード
            <input
              style={inputStyle}
              value={organization.login_code}
              onChange={(e) => setOrganization((prev) => ({ ...prev, login_code: e.target.value }))}
            />
            <FieldError path="organization.login_code" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            郵便番号（7桁）
            <input
              style={inputStyle}
              value={organization.postal_code}
              onChange={(e) => setOrganization((prev) => ({ ...prev, postal_code: e.target.value }))}
            />
            <FieldError path="organization.postal_code" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            住所
            <input
              style={inputStyle}
              value={organization.address}
              onChange={(e) => setOrganization((prev) => ({ ...prev, address: e.target.value }))}
            />
            <FieldError path="organization.address" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            電話番号
            <input
              style={inputStyle}
              value={organization.phone}
              onChange={(e) => setOrganization((prev) => ({ ...prev, phone: e.target.value }))}
            />
            <FieldError path="organization.phone" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            FAX番号
            <input
              style={inputStyle}
              value={organization.fax}
              onChange={(e) => setOrganization((prev) => ({ ...prev, fax: e.target.value }))}
            />
            <FieldError path="organization.fax" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            メールアドレス
            <input
              type="email"
              style={inputStyle}
              value={organization.email}
              onChange={(e) => setOrganization((prev) => ({ ...prev, email: e.target.value }))}
            />
            <FieldError path="organization.email" fieldErrors={fieldErrors} />
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>事業所</h2>
          <button type="button" onClick={addOffice} style={{ padding: '0.3rem 0.6rem' }}>
            + 事業所を追加
          </button>
        </div>

        {offices.map((office, officeIndex) => (
          <div key={officeIndex} style={{ border: '1px solid #eceef1', borderRadius: '6px', padding: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong>事業所 {officeIndex + 1}</strong>
              {offices.length > 1 && (
                <button type="button" onClick={() => removeOffice(officeIndex)} style={{ padding: '0.2rem 0.5rem' }}>
                  削除
                </button>
              )}
            </div>

            <div style={gridStyle}>
              <label style={fieldStyle}>
                事業所コード *（全事業所で一意）
                <input
                  style={inputStyle}
                  value={office.code}
                  onChange={(e) => updateOffice(officeIndex, { code: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.code`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                事業所名 *
                <input
                  style={inputStyle}
                  value={office.name}
                  onChange={(e) => updateOffice(officeIndex, { name: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.name`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                表示名
                <input
                  style={inputStyle}
                  value={office.display_name}
                  onChange={(e) => updateOffice(officeIndex, { display_name: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.display_name`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                郵便番号（7桁）
                <input
                  style={inputStyle}
                  value={office.postal_code}
                  onChange={(e) => updateOffice(officeIndex, { postal_code: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.postal_code`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                住所
                <input
                  style={inputStyle}
                  value={office.address}
                  onChange={(e) => updateOffice(officeIndex, { address: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.address`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                電話番号
                <input
                  style={inputStyle}
                  value={office.phone}
                  onChange={(e) => updateOffice(officeIndex, { phone: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.phone`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                FAX番号
                <input
                  style={inputStyle}
                  value={office.fax}
                  onChange={(e) => updateOffice(officeIndex, { fax: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.fax`} fieldErrors={fieldErrors} />
              </label>
              <label style={fieldStyle}>
                メールアドレス
                <input
                  type="email"
                  style={inputStyle}
                  value={office.email}
                  onChange={(e) => updateOffice(officeIndex, { email: e.target.value })}
                />
                <FieldError path={`offices.${officeIndex}.email`} fieldErrors={fieldErrors} />
              </label>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={fieldStyle}>提供サービス</span>
                <button type="button" onClick={() => addServiceRegistration(officeIndex)} style={{ padding: '0.2rem 0.5rem' }}>
                  + サービスを追加
                </button>
              </div>
              {serviceTypesError && <p role="alert" style={{ color: errorColor, fontSize: '0.85rem' }}>{serviceTypesError}</p>}

              {office.service_registrations.map((reg, regIndex) => (
                <div key={regIndex} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                  <select
                    style={{ ...inputStyle, flex: 2 }}
                    value={reg.service_code}
                    onChange={(e) => updateServiceRegistration(officeIndex, regIndex, { service_code: e.target.value })}
                  >
                    <option value="">サービス種別を選択</option>
                    {serviceTypes.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.name}（{st.code}）
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="事業所番号"
                    style={{ ...inputStyle, flex: 1 }}
                    value={reg.provider_number}
                    onChange={(e) => updateServiceRegistration(officeIndex, regIndex, { provider_number: e.target.value })}
                  />
                  <input
                    placeholder="サービス別表示名"
                    style={{ ...inputStyle, flex: 1 }}
                    value={reg.service_office_name}
                    onChange={(e) => updateServiceRegistration(officeIndex, regIndex, { service_office_name: e.target.value })}
                  />
                  <button type="button" onClick={() => removeServiceRegistration(officeIndex, regIndex)} style={{ padding: '0.3rem 0.5rem' }}>
                    削除
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>初期管理者</h2>
        <div style={gridStyle}>
          <label style={fieldStyle}>
            所属事業所 *
            <select
              style={inputStyle}
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
          <label style={fieldStyle}>
            権限 *
            <select
              style={inputStyle}
              value={initialAdmin.role_code}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, role_code: e.target.value as OnboardingRoleCode }))}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <FieldError path="initial_admin.role_code" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            姓 *
            <input
              style={inputStyle}
              value={initialAdmin.last_name}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, last_name: e.target.value }))}
            />
            <FieldError path="initial_admin.last_name" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            名 *
            <input
              style={inputStyle}
              value={initialAdmin.first_name}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, first_name: e.target.value }))}
            />
            <FieldError path="initial_admin.first_name" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            姓（カナ）
            <input
              style={inputStyle}
              value={initialAdmin.last_name_kana}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, last_name_kana: e.target.value }))}
            />
            <FieldError path="initial_admin.last_name_kana" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            名（カナ）
            <input
              style={inputStyle}
              value={initialAdmin.first_name_kana}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, first_name_kana: e.target.value }))}
            />
            <FieldError path="initial_admin.first_name_kana" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            雇用形態
            <select
              style={inputStyle}
              value={initialAdmin.employment_type}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, employment_type: e.target.value }))}
            >
              <option value="">未選択</option>
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <FieldError path="initial_admin.employment_type" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            入社日
            <input
              type="date"
              style={inputStyle}
              value={initialAdmin.hire_date}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, hire_date: e.target.value }))}
            />
            <FieldError path="initial_admin.hire_date" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            電話番号
            <input
              style={inputStyle}
              value={initialAdmin.phone}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, phone: e.target.value }))}
            />
            <FieldError path="initial_admin.phone" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            メールアドレス（連絡先）
            <input
              type="email"
              style={inputStyle}
              value={initialAdmin.email}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, email: e.target.value }))}
            />
            <FieldError path="initial_admin.email" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            郵便番号（7桁）
            <input
              style={inputStyle}
              value={initialAdmin.postal_code}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, postal_code: e.target.value }))}
            />
            <FieldError path="initial_admin.postal_code" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            住所
            <input
              style={inputStyle}
              value={initialAdmin.address}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, address: e.target.value }))}
            />
            <FieldError path="initial_admin.address" fieldErrors={fieldErrors} />
          </label>
        </div>

        <div style={{ ...gridStyle, marginTop: '0.75rem' }}>
          <label style={fieldStyle}>
            ログインID *（半角英小文字・数字・ハイフンのみ）
            <input
              style={inputStyle}
              value={initialAdmin.login_id}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, login_id: e.target.value }))}
            />
            <FieldError path="initial_admin.login_id" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            初期パスワード *（8文字以上）
            <input
              type="password"
              style={inputStyle}
              value={initialAdmin.password}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, password: e.target.value }))}
            />
            <FieldError path="initial_admin.password" fieldErrors={fieldErrors} />
          </label>
          <label style={fieldStyle}>
            初期パスワード（確認） *
            <input
              type="password"
              style={inputStyle}
              value={initialAdmin.password_confirm}
              onChange={(e) => setInitialAdmin((prev) => ({ ...prev, password_confirm: e.target.value }))}
            />
          </label>
        </div>
        {passwordMismatch && <p role="alert" style={{ color: errorColor, fontSize: '0.85rem' }}>パスワードが一致しません</p>}
      </section>

      {dryRunResult && (
        <section style={{ ...sectionStyle, borderColor: dryRunResult.valid ? successColor : errorColor }}>
          {dryRunResult.valid ? (
            <p style={{ color: successColor, margin: 0 }}>入力内容は問題ありません。登録を確定できます。</p>
          ) : (
            <div>
              <p style={{ color: errorColor, margin: '0 0 0.5rem' }}>入力内容にエラーがあります：</p>
              <ul style={{ color: errorColor, margin: 0 }}>
                {dryRunResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {submitError && <p role="alert" style={{ color: errorColor }}>{submitError}</p>}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="button" disabled={!canCheck || checking} onClick={handleCheck} style={{ padding: '0.5rem 1rem' }}>
          {checking ? '確認中…' : '入力内容を確認'}
        </button>
        <button type="button" disabled={!isValidated || submitting} onClick={handleApply} style={{ padding: '0.5rem 1rem' }}>
          {submitting ? '登録中…' : '登録を確定する'}
        </button>
      </div>
    </div>
  )
}
