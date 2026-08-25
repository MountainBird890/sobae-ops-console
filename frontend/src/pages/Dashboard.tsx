import { useEffect, useState } from 'react'
import { ApiError, fetchOrganizationSummary, type OrganizationSummary } from '../lib/api'

const CARDS: { key: keyof OrganizationSummary; label: string; color: string }[] = [
  { key: 'total', label: '契約事業所数', color: '#3454d1' },
  { key: 'active', label: '有効', color: '#1e7a3d' },
  { key: 'suspended', label: '利用停止中', color: '#9a6400' },
  { key: 'terminated', label: '契約終了', color: '#5b6470' },
]

export function Dashboard() {
  const [summary, setSummary] = useState<OrganizationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchOrganizationSummary()
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '契約サマリーの取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <h1>ダッシュボード</h1>

      {loading && <p>読み込み中…</p>}
      {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
          {CARDS.map(({ key, label, color }) => (
            <div key={key} style={{ border: '1px solid #d9dce1', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#5b6470' }}>{label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{summary[key]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
