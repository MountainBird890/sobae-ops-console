// Prerequisite: the connected role (postgres) must be able to SET ROLE to the Console owner role.
// `alter function/view ... owner to <role>` (04..09) needs it. PostgreSQL 16+ models this as the
// SET option of the role membership; on Supabase the default grant from supabase_admin can carry
// only ADMIN OPTION (inherit f, set f), which fails at 04 (observed on the staging parent,
// 2026-10-07). Role membership is part of neither the Console nor the Sobae_Works fingerprint.

// Roles the runner must be able to SET ROLE to (owners of the objects the migrations create).
export const SET_ROLE_REQUIRED = ['sobae_onboarding_executor'] as const

export interface SetRoleRow {
  rolname: string
  can_set: boolean
}

export interface SetRoleCheck {
  ok: boolean
  // Roles that exist but the connected role cannot SET ROLE to.
  blocked: string[]
  // Required roles that do not exist (reported by `init` separately; not a SET failure).
  missing: string[]
}

export function evaluateSetRole(rows: readonly SetRoleRow[], required: readonly string[] = SET_ROLE_REQUIRED): SetRoleCheck {
  const blocked = rows.filter((r) => required.includes(r.rolname) && !r.can_set).map((r) => r.rolname).sort()
  const missing = required.filter((n) => !rows.some((r) => r.rolname === n))
  return { ok: blocked.length === 0, blocked, missing: [...missing] }
}

export function describeSetRole(check: SetRoleCheck, currentRole: string): string {
  if (check.ok) {
    return check.missing.length > 0
      ? `ロールがまだありません（${check.missing.join(', ')}）。SET 権限は、ロールの作成後に確認されます`
      : `${currentRole} は ${SET_ROLE_REQUIRED.join(', ')} へ SET ROLE できます`
  }
  return (
    `${currentRole} は ${check.blocked.join(', ')} へ SET ROLE できません（所有者変更の alter ... owner to が失敗します）。` +
    `ロールの付与（grant <role> to ${currentRole} with inherit true, set true）が必要です。` +
    `付与は DB への書き込みなので、ユーザーの承認を得てから、runner の外で実行してください（sql/migrations/README.md §9）`
  )
}
