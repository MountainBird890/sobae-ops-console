import { useEffect, useState } from 'react'
import { ApiError, fetchOrganizationSummary, type OrganizationSummary } from '../lib/api'

const CARDS: { key: keyof OrganizationSummary; label: string; colorClassName: string }[] = [
  { key: 'total', label: '契約事業所数', colorClassName: 'text-blue-600' },
  { key: 'active', label: '有効', colorClassName: 'text-green-600' },
  { key: 'suspended', label: '利用停止中', colorClassName: 'text-amber-600' },
  { key: 'terminated', label: '契約終了', colorClassName: 'text-slate-500' },
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
      <h1 className="text-2xl font-medium text-slate-900">ダッシュボード</h1>

      {loading && <p className="text-slate-500">読み込み中…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {CARDS.map(({ key, label, colorClassName }) => (
            <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-500">{label}</div>
              <div className={`text-3xl font-bold ${colorClassName}`}>{summary[key]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
