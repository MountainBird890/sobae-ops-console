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

export function StatusBadge({ status }: { status: OrganizationStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLOR_CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
