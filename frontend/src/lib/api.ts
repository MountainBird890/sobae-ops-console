import { supabase } from './supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined

// Populated when the backend rejects a request with per-field validation
// errors (see backend/src/routes/onboarding.ts's zodFieldErrorsHook). Keyed
// by `path.join('.')` (e.g. "organization.postal_code",
// "offices.0.postal_code") so callers can look a field's message up directly.
export type FieldErrors = Record<string, string>

export class ApiError extends Error {
  status: number
  fieldErrors?: FieldErrors
  // Raw/technical detail (e.g. a Postgres error message) that's safe to log
  // to the console for debugging but not meant to be shown on screen.
  detail?: string

  constructor(message: string, status: number, options?: { fieldErrors?: FieldErrors; detail?: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = options?.fieldErrors
    this.detail = options?.detail
  }
}

interface ErrorResponseBody {
  message?: string
  error?: string | { message?: string }
  detail?: string
  fieldErrors?: { path: string[]; message: string }[]
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError('VITE_API_BASE_URL is not configured', 0)
  }

  const send = async (accessToken: string | undefined) =>
    await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  let res = await send(data.session?.access_token)

  // The access token can expire between getSession() and the server's check (a tab that sat idle, a slow
  // connection). On a 401, refresh the session once and send the same request again; a request that is
  // really unauthorised still ends as a 401.
  if (res.status === 401 && supabase) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (refreshed.session) res = await send(refreshed.session.access_token)
  }
  const body = (await res.json().catch(() => undefined)) as ErrorResponseBody | undefined

  if (!res.ok) {
    const fieldErrors = body?.fieldErrors
      ? Object.fromEntries(body.fieldErrors.map((fe) => [fe.path.join('.'), fe.message]))
      : undefined
    const message =
      body?.message ??
      (typeof body?.error === 'object' ? body.error.message : undefined) ??
      (fieldErrors ? '入力内容に誤りがあります。各項目のエラーメッセージをご確認ください。' : undefined) ??
      `Request failed (${res.status})`
    throw new ApiError(message, res.status, { fieldErrors, detail: body?.detail })
  }

  return body as T
}

export type OrganizationStatus = 'active' | 'suspended' | 'terminated'

// Organizations that existed before migration 250 have no management number / contract start
// date, and a NULL status when they are not active ("needs review"). Show them as "—".
export interface Organization {
  id: string
  name: string
  management_number: string | null
  status: OrganizationStatus | null
  contract_start_date: string | null
  contract_end_date: string | null
  // Latest organization-level suspend / reactivate (JST date 'YYYY-MM-DD'); null if never.
  last_suspended_at: string | null
  last_reactivated_at: string | null
}

// An office as shown on the screens. `status` is the office's own (effective) status; `display_status` is
// what to show: the organization's state wins unless it is active (an office under a suspended or
// terminated organization cannot log in whatever its own status says).
export interface Office {
  id: string
  organization_id: string
  organization_name: string | null
  code: string
  name: string
  postal_code: string | null
  address: string | null
  phone: string | null
  fax: string | null
  email: string | null
  is_active: boolean
  status: OrganizationStatus | null
  organization_status: OrganizationStatus | null
  display_status: OrganizationStatus | null
  contract_start_date: string | null
  contract_end_date: string | null
  created_at: string
  last_suspended_at: string | null
  last_reactivated_at: string | null
}

export interface OrganizationSummary {
  active: number
  suspended: number
  terminated: number
  // Organizations whose status could not be determined (legacy + not active).
  unconfirmed: number
  total: number
}

export function fetchOrganizations(params: { status?: OrganizationStatus; q?: string } = {}) {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  if (params.q) search.set('q', params.q)
  const query = search.toString()
  return request<{ organizations: Organization[] }>(`/api/organizations${query ? `?${query}` : ''}`)
}

export function fetchOrganizationSummary() {
  return request<OrganizationSummary>('/api/organizations/summary')
}

export function fetchOrganization(id: string) {
  return request<{ organization: Organization }>(`/api/organizations/${encodeURIComponent(id)}`)
}

export function fetchOrganizationOffices(organizationId: string) {
  return request<{ offices: Office[] }>(`/api/organizations/${encodeURIComponent(organizationId)}/offices`)
}

export function fetchOffice(id: string) {
  return request<{ office: Office }>(`/api/offices/${encodeURIComponent(id)}`)
}

// Lifecycle operations. `confirmName` is the target's name typed again by the operator (SEC-004); the
// backend re-checks it. `reason` is optional and only kept in the audit log.
export type OrganizationLifecycleAction = 'suspend' | 'reactivate' | 'terminate'
export type OfficeLifecycleAction = 'suspend' | 'reactivate'

export function runOrganizationAction(id: string, action: OrganizationLifecycleAction, body: { confirmName: string; reason?: string }) {
  return request<{ result: { organization_id: string; status: string; log_id: string } }>(
    `/api/organizations/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', body: { confirm_name: body.confirmName, reason: body.reason || undefined } },
  )
}

export function runOfficeAction(id: string, action: OfficeLifecycleAction, body: { confirmName: string; reason?: string }) {
  return request<{ result: { office_id: string; status: string; log_id: string } }>(
    `/api/offices/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', body: { confirm_name: body.confirmName, reason: body.reason || undefined } },
  )
}

// Mirrors backend/src/routes/onboarding.ts's Zod schema — kept in sync by
// hand until there's a shared package. `password` is plaintext; the backend
// hashes it before it ever reaches the database.
export interface ServiceType {
  code: string
  name: string
  category: string
}

export interface ServiceRegistrationInput {
  service_code: string
  provider_number?: string
  service_office_name?: string
}

export interface OfficeInput {
  code: string
  name: string
  postal_code: string
  address: string
  phone: string
  fax?: string
  email: string
  display_name?: string
  service_registrations: ServiceRegistrationInput[]
}

// login_code is not an input: the backend derives it from management_number.
export interface OrganizationInput {
  name: string
  postal_code: string
  address: string
  phone: string
  fax?: string
  email: string
  management_number: string
  contract_start_date: string
}

export type OnboardingRoleCode = 'admin' | 'supervisor' | 'staff'

// Mirrors the staff.employment_type CHECK constraint on Sobae_Works' real
// schema (confirmed via pg_get_constraintdef, 2026-09-14) — presumed coding
// of 常勤専従/常勤兼務/非常勤専従/非常勤兼務.
export type OnboardingEmploymentTypeCode = 'full_time_excl' | 'full_time_conc' | 'part_time_excl' | 'part_time_conc'

export interface InitialAdminInput {
  office_code: string
  last_name: string
  first_name: string
  last_name_kana: string
  first_name_kana: string
  employment_type?: OnboardingEmploymentTypeCode
  phone?: string
  email?: string
  postal_code?: string
  address?: string
  hire_date?: string
  role_code: OnboardingRoleCode
  login_id: string
  password: string
}

export interface OnboardingPayload {
  application_id: string
  organization: OrganizationInput
  offices: OfficeInput[]
  initial_admin: InitialAdminInput
}

export interface OnboardingDryRunResult {
  valid: boolean
  preview?: { organization_id: string; staff_id: string; system_user_id: string; log_id: string }
  errors: string[]
}

export interface OnboardingApplyResult {
  organization: { organization_id: string; staff_id: string; system_user_id: string; log_id: string }
}

export function fetchServiceTypes() {
  return request<{ service_types: ServiceType[] }>('/api/onboarding/service-types')
}

export function dryRunOnboarding(payload: OnboardingPayload) {
  return request<OnboardingDryRunResult>('/api/onboarding/dry-run', { method: 'POST', body: payload })
}

export function applyOnboarding(payload: OnboardingPayload) {
  return request<OnboardingApplyResult>('/api/onboarding/apply', { method: 'POST', body: payload })
}

export function inviteStaff(email: string) {
  return request<{ user: { id: string; email: string } }>('/api/staff/invite', {
    method: 'POST',
    body: { email },
  })
}
