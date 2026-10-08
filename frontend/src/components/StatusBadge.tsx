import type { OrganizationStatus } from '../lib/api'

const LABELS: Record<OrganizationStatus, string> = {
  active: '有効',
  suspended: '利用停止中',
  terminated: '契約終了',
}

const COLOR_CLASSES: Record<OrganizationStatus, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-amber-100 text-amber-700',
  terminated: 'bg-slate-100 text-slate-600',
}

// status が null の法人（本体migration 250より前から存在し、かつ無効なもの）は「要確認」と表示する。
const UNCONFIRMED_LABEL = '要確認'
const UNCONFIRMED_CLASS = 'bg-white text-red-700 ring-1 ring-red-300'

export function StatusBadge({ status }: { status: OrganizationStatus | null }) {
  const label = status === null ? UNCONFIRMED_LABEL : LABELS[status]
  const color = status === null ? UNCONFIRMED_CLASS : COLOR_CLASSES[status]
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{label}</span>
}
