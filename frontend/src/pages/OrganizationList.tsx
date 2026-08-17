import { useEffect, useState } from 'react'
import { ApiError, fetchOrganizations, type Organization, type OrganizationStatus } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

const STATUS_OPTIONS: { value: OrganizationStatus | ''; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'active', label: '有効' },
  { value: 'suspended', label: '利用停止中' },
  { value: 'terminated', label: '契約終了' },
]

export function OrganizationList() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [status, setStatus] = useState<OrganizationStatus | ''>('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchOrganizations({ status: status || undefined, q: q || undefined })
      .then((data) => {
        if (!cancelled) setOrganizations(data.organizations)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '事業所一覧の取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [status, q])

  return (
    <div>
      <h1>事業所一覧</h1>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <input
          type="search"
          placeholder="事業所名・管理番号で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: '0.4rem 0.6rem', flex: 1 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as OrganizationStatus | '')} style={{ padding: '0.4rem 0.6rem' }}>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p>読み込み中…</p>}
      {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}

      {!loading && !error && organizations.length === 0 && <p>該当する事業所がありません。</p>}

      {organizations.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #d9dce1' }}>
              <th style={{ padding: '0.5rem' }}>事業所名</th>
              <th style={{ padding: '0.5rem' }}>管理番号</th>
              <th style={{ padding: '0.5rem' }}>ステータス</th>
              <th style={{ padding: '0.5rem' }}>契約開始日</th>
              <th style={{ padding: '0.5rem' }}>契約終了日</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <tr key={org.id} style={{ borderBottom: '1px solid #eceef1' }}>
                <td style={{ padding: '0.5rem' }}>{org.name}</td>
                <td style={{ padding: '0.5rem' }}>{org.management_number}</td>
                <td style={{ padding: '0.5rem' }}>
                  <StatusBadge status={org.status} />
                </td>
                <td style={{ padding: '0.5rem' }}>{org.contract_start_date}</td>
                <td style={{ padding: '0.5rem' }}>{org.contract_end_date ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
