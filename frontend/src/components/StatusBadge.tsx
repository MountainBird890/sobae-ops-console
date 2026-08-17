import type { OrganizationStatus } from '../lib/api'

const LABELS: Record<OrganizationStatus, string> = {
  active: '有効',
  suspended: '利用停止中',
  terminated: '契約終了',
}

const COLORS: Record<OrganizationStatus, { background: string; color: string }> = {
  active: { background: '#e3f5e9', color: '#1e7a3d' },
  suspended: { background: '#fdf1dc', color: '#9a6400' },
  terminated: { background: '#eceef1', color: '#5b6470' },
}

export function StatusBadge({ status }: { status: OrganizationStatus }) {
  const { background, color } = COLORS[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.8rem',
        fontWeight: 600,
        background,
        color,
      }}
    >
      {LABELS[status]}
    </span>
  )
}
