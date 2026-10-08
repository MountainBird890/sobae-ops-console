import { z } from 'zod'
import postgres from 'postgres'

// Shared by the organization and office lifecycle routes (suspend / reactivate / terminate).

// `confirm_name` is the target's name typed again by the operator (SEC-004). The UI already blocks the
// button until it matches; the API re-checks it so a direct call cannot skip the confirmation.
export const lifecycleBodySchema = z.object({
  reason: z.string().trim().max(500, '500文字以内で入力してください').optional(),
  confirm_name: z.string().min(1, '確認のため、対象の名前を入力してください'),
})

export const uuidParamSchema = z.object({ id: z.uuid() })

export type LifecycleErrorBody = { error: string; message: string }

// Maps the SQLSTATEs raised by console.fn_*_organization / fn_*_office to HTTP responses:
// P0002 (not found) -> 404, 22023 (state does not allow the action) -> 409.
export function lifecycleErrorResponse(err: unknown): { body: LifecycleErrorBody; status: 404 | 409 } | null {
  if (err instanceof postgres.PostgresError) {
    if (err.code === 'P0002') {
      return { body: { error: 'not_found', message: '対象が見つかりませんでした。' }, status: 404 }
    }
    if (err.code === '22023') {
      return {
        body: {
          error: 'conflict',
          message: '現在の状態では、この操作はできません。状態が変わった可能性があります。画面を更新して確認してください。',
        },
        status: 409,
      }
    }
  }
  return null
}

// What the screens show as an office's state: the organization's state wins unless it is active
// (an office under a suspended / terminated organization cannot log in, whatever its own status says).
export function displayStatus(organizationStatus: string | null, officeStatus: string | null): string | null {
  if (organizationStatus !== 'active') return organizationStatus ?? officeStatus
  return officeStatus
}

// Columns the office screens read from console.v_office_summary (dates as JST 'YYYY-MM-DD' text).
export const OFFICE_COLUMNS = `id, organization_id, organization_name, code, name, postal_code, address, phone, fax, email,
  is_active, status, organization_status,
  contract_start_date::text as contract_start_date,
  contract_end_date::text as contract_end_date,
  to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as created_at,
  to_char(last_suspended_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_suspended_at,
  to_char(last_reactivated_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_reactivated_at`

export interface OfficeSummaryRow {
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
  status: 'active' | 'suspended' | 'terminated' | null
  organization_status: 'active' | 'suspended' | 'terminated' | null
  contract_start_date: string | null
  contract_end_date: string | null
  created_at: string
  last_suspended_at: string | null
  last_reactivated_at: string | null
}
