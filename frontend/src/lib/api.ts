import { supabase } from './supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError('VITE_API_BASE_URL is not configured', 0)
  }

  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const accessToken = data.session?.access_token

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const body = await res.json().catch(() => undefined)

  if (!res.ok) {
    const message = (body as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }

  return body as T
}

export type OrganizationStatus = 'active' | 'suspended' | 'terminated'

export interface Organization {
  id: string
  name: string
  management_number: string
  status: OrganizationStatus
  contract_start_date: string
  contract_end_date: string | null
}

export interface OrganizationSummary {
  active: number
  suspended: number
  terminated: number
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
  postal_code?: string
  address?: string
  phone?: string
  fax?: string
  email?: string
  display_name?: string
  service_registrations: ServiceRegistrationInput[]
}

export interface OrganizationInput {
  name: string
  login_code?: string
  postal_code?: string
  address?: string
  phone?: string
  fax?: string
  email?: string
  management_number: string
  contract_start_date: string
}

export type OnboardingRoleCode = 'admin' | 'supervisor' | 'staff'

export interface InitialAdminInput {
  office_code: string
  last_name: string
  first_name: string
  last_name_kana?: string
  first_name_kana?: string
  employment_type?: string
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
