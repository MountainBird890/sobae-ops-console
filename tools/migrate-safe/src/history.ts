// The history lives in the `console` schema (decision 2026-10-07), not in Sobae_Works'
// sobae_meta.migration_history: the two runners must never share a ledger.
export const HISTORY_DDL = `
create schema if not exists console;

create table if not exists console.migration_history (
  migration_version         integer primary key,
  filename                  text not null unique,
  checksum_sha256           text not null,
  adopted                   boolean not null default false,
  applied_at                timestamptz not null default now(),
  applied_by                text not null,
  source_git_commit         text,
  schema_fingerprint_before text,
  schema_fingerprint_after  text not null
);
`

// Roles that must already exist before the adopted baseline (01_roles.sql) can be recorded.
export const REQUIRED_ROLES = ['sobae_ops_executor', 'sobae_onboarding_executor'] as const
export const ADOPTED_FILE = '01_roles.sql'
export const LOCK_KEY = 'console_migrate_safe'
