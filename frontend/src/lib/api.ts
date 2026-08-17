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

async function request<T>(path: string): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError('VITE_API_BASE_URL is not configured', 0)
  }

  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const accessToken = data.session?.access_token

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
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
