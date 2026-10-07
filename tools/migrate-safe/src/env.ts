import { readFileSync } from 'node:fs'
import type { ConnectionInfo } from './conn.ts'

export interface EnvironmentProfile {
  database_id?: string
  project_ref?: string
  loopback_only?: boolean
  // For databases that have no database_id registered (e.g. the test-onboarding branch, whose
  // sobae_meta.database_state is empty). Identification then rests on project_ref, and the profile
  // only accepts a database that has NO database_id, so a database that does have one (staging
  // parent, production) can never be accepted under this name.
  require_no_database_id?: boolean
}

export interface EnvironmentsConfig {
  environments: Record<string, EnvironmentProfile>
  refuse_database_ids: string[]
}

export const KNOWN_ENVIRONMENTS = ['staging', 'test-onboarding', 'local'] as const

export function loadEnvironments(file: string): EnvironmentsConfig {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<EnvironmentsConfig>
  return {
    environments: raw.environments ?? {},
    refuse_database_ids: raw.refuse_database_ids ?? [],
  }
}

// Runs BEFORE any connection is opened. production is never a valid target of this tool.
export function assertEnvironmentName(environment: string): void {
  if (environment === 'production') {
    throw new Error('--environment=production はこのツールでは使えません（本番は、代表の承認なしに接続しません）')
  }
  if (!(KNOWN_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(`未知の環境名です: ${environment}（既知: ${KNOWN_ENVIRONMENTS.join(', ')}）`)
  }
}

export type GateStatus =
  | 'match'
  | 'local_ok'
  | 'mismatch'
  | 'refused_database_id'
  | 'no_database_state'
  | 'database_id_registered'
  | 'project_ref_mismatch'
  | 'loopback_required'
  | 'config_error'

export interface GateResult {
  ok: boolean
  status: GateStatus
  detail: string
}

export interface GateInput {
  environment: string
  config: EnvironmentsConfig
  // database_id read from sobae_meta.database_state; null when it cannot be read
  databaseId: string | null
  connection: ConnectionInfo
}

// The environment is identified by the database_id stored inside the database (not by host
// names). project_ref is an extra check that can only add refusals. Messages never contain
// the actual database_id or project_ref values.
export function evaluateGate(input: GateInput): GateResult {
  const { environment, config, databaseId, connection } = input
  const profile = config.environments[environment]
  if (!profile) {
    return { ok: false, status: 'config_error', detail: `environments.json に ${environment} の設定がありません` }
  }
  if (profile.database_id && config.refuse_database_ids.includes(profile.database_id)) {
    return { ok: false, status: 'config_error', detail: `environments.json の ${environment}.database_id が、拒否リストと同じです（設定エラー）` }
  }

  if (databaseId !== null && config.refuse_database_ids.includes(databaseId)) {
    return {
      ok: false,
      status: 'refused_database_id',
      detail: '接続先の database_id が、拒否リスト（本番）と一致します。環境の指定に関わらず拒否します',
    }
  }

  if (environment === 'local') {
    if (!connection.loopback) {
      return { ok: false, status: 'loopback_required', detail: 'local は、ループバック（127.0.0.1、localhost、::1）への接続でのみ使えます' }
    }
    return { ok: true, status: 'local_ok', detail: 'local: ループバックへの接続です（database_id の照合は省略）' }
  }

  if (profile.require_no_database_id) {
    // Identification by project_ref only, for a database without a registered database_id.
    if (profile.database_id) {
      return { ok: false, status: 'config_error', detail: `environments.json の ${environment} は、database_id と require_no_database_id を同時に指定できません` }
    }
    if (!profile.project_ref) {
      return { ok: false, status: 'config_error', detail: `environments.json の ${environment}.project_ref が未設定です（database_id を使わない環境では必須）` }
    }
    if (databaseId !== null) {
      return {
        ok: false,
        status: 'database_id_registered',
        detail: `--environment=${environment} は、database_id が未登録の DB 用です。接続先には database_id が登録されているため拒否します（staging 親や本番などを取り違えていないか確認してください。値は表示しません）`,
      }
    }
    if (connection.projectRef !== profile.project_ref) {
      return {
        ok: false,
        status: 'project_ref_mismatch',
        detail: `接続文字列のプロジェクト ref が、${environment}.project_ref と一致しない（または取り出せない）ため拒否します（値は表示しません）`,
      }
    }
    return { ok: true, status: 'match', detail: `${environment}: database_id が未登録で、project_ref が一致しています` }
  }

  if (!profile.database_id) {
    return { ok: false, status: 'config_error', detail: `environments.json の ${environment}.database_id が未設定です` }
  }
  if (databaseId === null) {
    return { ok: false, status: 'no_database_state', detail: '接続先の sobae_meta.database_state から database_id を読めません' }
  }
  if (databaseId !== profile.database_id) {
    return {
      ok: false,
      status: 'mismatch',
      detail: `--environment=${environment} が指定されましたが、接続先 DB の database_id が ${environment}.database_id と一致しません（誤った DB への接続の可能性。値は表示しません）`,
    }
  }
  if (profile.project_ref && connection.projectRef !== profile.project_ref) {
    return {
      ok: false,
      status: 'project_ref_mismatch',
      detail: `接続文字列のプロジェクト ref が、${environment}.project_ref と一致しない（または取り出せない）ため拒否します（値は表示しません）`,
    }
  }
  const refNote = profile.project_ref ? '、project_ref も一致' : ''
  return { ok: true, status: 'match', detail: `${environment}.database_id と一致しています${refNote}` }
}
